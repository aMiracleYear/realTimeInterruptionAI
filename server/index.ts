import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSession,
  addSegment,
  applyAssessment,
  tick,
  advance,
  think,
  hint,
  decide,
  complete,
} from "./engine";
import { assess, assessorMode } from "./assessor";
import { demoScripts } from "./demo";
import type { Session } from "../shared/types";

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    budget: z.number().int().min(180).max(1800),
    demo: z.enum(["drift", "pause", "thinking"]).optional(),
  }),
  z.object({
    type: z.literal("segment"),
    text: z.string().trim().min(1).max(4000),
    confidence: z.number().min(0).max(1).nullable(),
  }),
  z.object({ type: z.literal("activity") }),
  ...(
    ["pause", "resume", "finish", "next", "think", "hint", "end"] as const
  ).map((type) => z.object({ type: z.literal(type) })),
  z.object({
    type: z.literal("feedback"),
    id: z.string().uuid(),
    value: z.enum(["helpful", "early"]),
  }),
]);
const envFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env",
);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const app = express();
app.disable("x-powered-by");
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    assessor: assessorMode(),
    storage: "memory",
    version: "0.1.0",
  }),
);
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
}
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  // CLI clients have no Origin; browser clients must come from the same application.
  let allowed = !origin;
  try {
    if (origin) allowed = new URL(origin).host === req.headers.host;
  } catch {
    allowed = false;
  }
  if (req.url !== "/ws" || !allowed || wss.clients.size >= 20) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws) => {
  let s: Session | undefined;
  let generation = 0,
    busy = false,
    pending = false,
    retryAt = 0,
    nextAssessmentAt = 0,
    demoIndex = 0;
  let lastTick = performance.now();
  let totalChars = 0,
    activityAt = 0;
  const send = (value: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };
  const snapshot = () => {
    if (s) send({ type: "state", session: s });
  };
  send({ type: "hello", assessor: assessorMode() });
  async function analyze() {
    if (
      !s ||
      busy ||
      !pending ||
      s.status !== "running" ||
      s.awaitingNext ||
      performance.now() < retryAt ||
      performance.now() < nextAssessmentAt
    )
      return;
    busy = true;
    pending = false;
    const current = s,
      token = generation,
      seq = current.segments.length,
      question = current.questionIndex;
    const start = performance.now();
    try {
      // Snapshot prevents overlapping chunk mutations during an external request.
      const a = await assess(structuredClone(current));
      if (
        token === generation &&
        current === s &&
        seq === s.segments.length &&
        question === s.questionIndex &&
        s.status === "running"
      ) {
        applyAssessment(
          s,
          a,
          assessorMode(),
          Math.round(performance.now() - start),
        );
        snapshot();
      }
    } catch {
      if (token === generation && current === s) {
        s.signals.assessment = "unavailable";
        s.signals.driftStreak = 0;
        s.insight =
          "AI assessment is unavailable. Content-based interruptions are on hold; you can continue or move on.";
        retryAt = performance.now() + 20000;
        send({
          type: "warning",
          message:
            "AI assessment failed. Check the server API key, model and network access. No transcript-based judgment was made.",
        });
        snapshot();
      }
    } finally {
      busy = false;
      // At most one LLM request at a time and one per 4 seconds per connection.
      nextAssessmentAt =
        performance.now() + (assessorMode() === "ai" ? 4000 : 0);
    }
  }
  function ingest(text: string, confidence: number | null) {
    if (!s || totalChars + text.length > 100000 || s.segments.length >= 500) {
      send({
        type: "warning",
        message:
          "Session transcript limit reached. End and export this session before starting another.",
      });
      return;
    }
    totalChars += text.length;
    addSegment(s, text, confidence);
    pending = true;
    void analyze();
    snapshot();
  }
  ws.on("message", (raw) => {
    try {
      const m = messageSchema.parse(JSON.parse(raw.toString()));
      if (m.type === "start") {
        if (s && s.status !== "completed") {
          send({
            type: "error",
            message: "End the current session before starting another.",
          });
          return;
        }
        s = createSession(m.budget, m.demo);
        generation++;
        pending = false;
        demoIndex = 0;
        totalChars = 0;
        retryAt = 0;
        nextAssessmentAt = 0;
        lastTick = performance.now();
        snapshot();
        return;
      }
      if (!s) throw new Error("Start a session first.");
      if (m.type === "feedback") {
        const d = s.decisions.find((d) => d.id === m.id);
        if (d) d.feedback = m.value;
        snapshot();
        return;
      }
      if (m.type === "end") {
        complete(s, "Session ended by you.");
        generation++;
        pending = false;
        snapshot();
        return;
      }
      if (m.type === "pause") {
        if (s.status === "running") s.status = "paused";
        generation++;
        snapshot();
        return;
      }
      if (m.type === "resume") {
        if (s.status === "paused") {
          s.status = "running";
          lastTick = performance.now();
          if (s.segments.length) pending = true;
        }
        snapshot();
        return;
      }
      if (s.status !== "running") return;
      if (m.type === "segment" && !s.demo && !s.awaitingNext)
        ingest(m.text, m.confidence);
      if (
        m.type === "activity" &&
        !s.demo &&
        performance.now() - activityAt > 250
      ) {
        s.signals.lastSpeechAt = s.elapsed;
        activityAt = performance.now();
      }
      if (m.type === "think") think(s);
      if (m.type === "hint") hint(s);
      if (m.type === "finish") {
        if (busy || pending)
          send({
            type: "warning",
            message:
              "Your latest answer is still being assessed. Try finishing again in a moment.",
          });
        else decide(s, true);
      }
      if (m.type === "next") {
        generation++;
        pending = false;
        advance(s);
      }
      snapshot();
    } catch {
      send({
        type: "error",
        message: "Invalid request. Check the input and try again.",
      });
    }
  });
  const interval = setInterval(() => {
    const now = performance.now();
    const delta = (now - lastTick) / 1000;
    lastTick = now;
    if (!s || s.status !== "running") return;
    const elapsed = Math.min(s.budget, s.elapsed + delta * (s.demo ? 4 : 1));
    const previousDecisions = s.decisions.length,
      previousStatus = s.status;
    if (s.demo && s.questionIndex === 0) {
      const script = demoScripts[s.demo];
      while (demoIndex < script.length && script[demoIndex].at <= elapsed) {
        const chunk = script[demoIndex++];
        s.elapsed = chunk.at;
        ingest(chunk.text, 1);
      }
    }
    // Avoid acting on stale evidence while a stable chunk is waiting for analysis.
    if ((busy || pending) && elapsed < s.budget) s.elapsed = elapsed;
    else tick(s, elapsed);
    void analyze();
    if (s.decisions.length !== previousDecisions || s.status !== previousStatus)
      snapshot();
    else send({ type: "clock", elapsed: s.elapsed });
  }, 400);
  ws.on("close", () => {
    clearInterval(interval);
    generation++;
    s = undefined;
  });
  ws.on("error", () => {
    clearInterval(interval);
  });
});
const port = Number(process.env.PORT || 3001);
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Cadence API listening on port ${port}; assessor: ${assessorMode()}`,
  ),
);
