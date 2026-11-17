import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSession,
  addSegment,
  applyAssessment,
  baselineAssessment,
  tick,
  advance,
  think,
  hint,
  decide,
  complete,
} from "./engine";
import { assess, assessorMode } from "./assessor";
import { connectRealtime } from "./realtime";
import { demoScripts } from "./demo";
import { questions } from "../shared/questions";
import { giveUpIntent, RECOVERY_RUBRIC } from "../shared/trajectory";
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
    questionIndex: z.number().int().min(0).max(2).optional(),
  }),
  z.object({
    type: z.literal("preview"),
    text: z.string().trim().min(1).max(4000),
    questionIndex: z.number().int().min(0).max(2),
  }),
  z.object({
    type: z.literal("playback"),
    id: z.string().uuid(),
    status: z.enum(["spoken", "interrupted"]),
    heardText: z.string().max(4000),
    playbackMs: z.number().min(0).max(1800000),
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
app.use(express.json({ limit: "110kb" }));
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    assessor: assessorMode(),
    realtimeConfigured: Boolean(process.env.OPENAI_API_KEY),
    storage: "memory",
    version: "0.2.0",
  }),
);
app.post("/api/realtime/connect", connectRealtime);
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
  let allowed = !req.headers.origin;
  try {
    if (req.headers.origin)
      allowed = new URL(req.headers.origin).host === req.headers.host;
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
  let s: Session | undefined,
    generation = 0,
    revision = 0,
    busy = false,
    pending = false,
    retryAt = 0,
    nextAssessmentAt = 0,
    demoIndex = 0;
  let request: AbortController | undefined;
  let lastTick = performance.now(),
    totalChars = 0,
    publishedDecisions = 0;
  let preview:
    | { text: string; stableText: string; since: number; assessed: string }
    | undefined;
  let assessedRevision = -1;
  const send = (value: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };
  const snapshot = () => {
    if (s) send({ type: "state", session: s });
  };
  const invalidate = () => {
    generation++;
    revision++;
    preview = undefined;
    pending = false;
    request?.abort();
  };
  function coach(text: string, interrupt = false, id: string = randomUUID()) {
    if (!s) return;
    const turn = {
      sequence: s.segments.length + s.coachTurns.length,
      id,
      text,
      questionIndex: s.questionIndex,
      status: "queued" as const,
      heardText: "",
      playbackMs: 0,
    };
    s.coachTurns.push(turn);
    snapshot();
    send({ type: "coach", ...turn, interrupt });
  }
  function publish() {
    if (!s) return;
    const fresh = s.decisions.slice(publishedDecisions);
    publishedDecisions = s.decisions.length;
    for (const d of fresh) {
      if (d.action === "NEXT") {
        invalidate();
        advance(s);
        coach(
          (s as Session).status === "completed"
            ? `${d.message} That completes our interview. Thank you.`
            : `${d.message} ${questions[s.questionIndex].title}`,
          true,
          d.id,
        );
      } else coach(d.message, Boolean(d.interrupt), d.id);
    }
    snapshot();
  }
  send({
    type: "hello",
    assessor: assessorMode(),
    realtimeConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
  function fastControl(
    text: string,
    confidence: number | null,
    provisional: boolean,
  ) {
    if (!s) return false;
    const copy = structuredClone(s);
    if (provisional) addSegment(copy, text, confidence);
    const a = baselineAssessment(copy);
    if (
      !a.trajectory?.explicitGiveUp &&
      a.trajectory?.correctness !== "incorrect"
    )
      return false;
    if (
      provisional &&
      a.trajectory?.explicitGiveUp &&
      !giveUpIntent(preview?.text ?? text)
    )
      return false;
    applyAssessment(
      s,
      a,
      "rules",
      0,
      provisional ? (preview?.text ?? text) : undefined,
    );
    decide(s);
    publish();
    return s.questionIndex !== copy.questionIndex || s.status !== "running";
  }
  async function analyze(provisional = false) {
    if (
      !s ||
      busy ||
      s.status !== "running" ||
      performance.now() < retryAt ||
      performance.now() < nextAssessmentAt
    )
      return;
    if (!provisional && !pending) return;
    if (provisional && !preview) return;
    busy = true;
    if (!provisional) pending = false;
    const current = s,
      token = generation,
      version = revision,
      question = s.questionIndex;
    const text = provisional
      ? preview!.stableText
      : (s.segments.filter((t) => t.questionIndex === question).at(-1)?.text ??
        "");
    if (provisional) preview!.assessed = text;
    const copy = structuredClone(s);
    if (provisional) addSegment(copy, text, null);
    const started = performance.now();
    request = new AbortController();
    try {
      const a = await assess(copy, request.signal);
      if (
        token !== generation ||
        current !== s ||
        s.status !== "running" ||
        question !== s.questionIndex
      )
        return;
      const latest =
        preview?.text ||
        s.segments.filter((t) => t.questionIndex === question).at(-1)?.text ||
        "";
      const extendsSameThought =
        latest.startsWith(text) &&
        !/\b(?:but|actually|instead|correct|reconsider|relate|connect|meant)\b/i.test(
          latest.slice(text.length),
        );
      if (version !== revision && !extendsSameThought) return;
      if (provisional && preview?.text.startsWith(text) && a.trajectory) {
        const tail = preview.text.slice(text.length);
        if (/\b(?:actually|but|correct|reconsider|meant)\b/i.test(tail))
          a.trajectory.selfCorrection = true;
        if (/\b(?:connect|relate|back to)\b/i.test(tail))
          a.trajectory.connectingBack = true;
      }
      applyAssessment(
        s,
        a,
        a.origin ?? assessorMode(),
        Math.round(performance.now() - started),
        provisional
          ? (preview?.text ?? text)
          : version !== revision
            ? text
            : undefined,
      );
      assessedRevision = revision;
      decide(s);
      publish();
    } catch {
      if (token === generation && current === s && !request.signal.aborted) {
        s.signals.assessment = "unavailable";
        s.signals.trajectory = null;
        s.signals.driftStreak = 0;
        s.insight =
          "Semantic assessment is unavailable. Explicit skip requests and local reference checks still work.";
        retryAt = performance.now() + 10000;
        send({
          type: "warning",
          message:
            "AI assessment failed. Check model access, billing and network. Arbitrary technical answers are not being judged.",
        });
        snapshot();
      }
    } finally {
      busy = false;
      nextAssessmentAt =
        performance.now() + (assessorMode() === "ai" ? 700 : 0);
    }
  }
  function ingest(text: string, confidence: number | null) {
    if (!s) return;
    if (totalChars + text.length > 100000 || s.segments.length >= 500) {
      send({
        type: "warning",
        message: "Transcript limit reached. End and export this session.",
      });
      return;
    }
    totalChars += text.length;
    addSegment(s, text, confidence);
    revision++;
    preview = undefined;
    if (confidence === null || confidence >= 0.72) {
      if (
        /^(?:i (?:don.t|do not) know yet[, .]*)?(?:let me think|give me (?:a moment|some time)|i need (?:a moment|some time) to think)[.! ]*$/i.test(
          text.trim(),
        )
      ) {
        think(s);
        coach("Take your time. I’m listening.");
        return;
      }
      if (
        /^(?:(?:can|could) you |please )?(?:repeat|rephrase) (?:the |this )?question(?: please)?[.!? ]*$/i.test(
          text.trim(),
        )
      ) {
        s.signals.trajectory = null;
        s.signals.driftStreak = 0;
        coach(
          `Of course. ${questions[s.questionIndex].title} ${questions[s.questionIndex].context}`,
          true,
        );
        return;
      }
    }
    if (fastControl(text, confidence, false)) return;
    pending = true;
    void analyze();
    snapshot();
  }
  let windowStarted = performance.now(),
    messages = 0;
  ws.on("message", (raw) => {
    if (performance.now() - windowStarted > 1000) {
      windowStarted = performance.now();
      messages = 0;
    }
    if (++messages > 40) return;
    try {
      const m = messageSchema.parse(JSON.parse(raw.toString()));
      if (m.type === "start") {
        if (s && s.status !== "completed") {
          send({
            type: "error",
            message: "End the current interview before starting another.",
          });
          return;
        }
        invalidate();
        s = createSession(m.budget, m.demo);
        demoIndex = 0;
        totalChars = 0;
        publishedDecisions = 0;
        retryAt = 0;
        nextAssessmentAt = 0;
        lastTick = performance.now();
        coach(`Let’s begin. ${questions[0].title}`);
        return;
      }
      if (!s) throw new Error("No session");
      if (m.type === "playback") {
        const turn = s.coachTurns.find((t) => t.id === m.id);
        if (turn)
          Object.assign(turn, {
            status: m.status,
            heardText: m.heardText,
            playbackMs: m.playbackMs,
          });
        return;
      }
      if (m.type === "feedback") {
        const d = s.decisions.find((d) => d.id === m.id);
        if (d) d.feedback = m.value;
        snapshot();
        return;
      }
      if (m.type === "end") {
        invalidate();
        complete(s, "Interview ended by you.");
        snapshot();
        return;
      }
      if (m.type === "pause") {
        if (s.status === "running") s.status = "paused";
        invalidate();
        snapshot();
        return;
      }
      if (m.type === "resume") {
        if (s.status === "paused") {
          s.status = "running";
          lastTick = performance.now();
        }
        snapshot();
        return;
      }
      if (s.status !== "running") return;
      if (
        m.type === "segment" &&
        !s.demo &&
        (m.questionIndex === undefined || m.questionIndex === s.questionIndex)
      )
        ingest(m.text, m.confidence);
      if (
        m.type === "preview" &&
        !s.demo &&
        m.questionIndex === s.questionIndex
      ) {
        if (preview?.text !== m.text) {
          const old = preview;
          const before = (old?.text ?? "").split(/\s+/),
            after = m.text.split(/\s+/);
          let common = 0;
          while (
            common < Math.min(before.length, after.length) &&
            before[common].toLowerCase() === after[common].toLowerCase()
          )
            common++;
          const stableText =
            common >= 3 ? after.slice(0, common).join(" ") : m.text;
          preview = {
            text: m.text,
            stableText,
            since: common >= 3 ? old!.since : performance.now(),
            assessed: old?.assessed ?? "",
          };
          revision++;
        }
        s.signals.lastSpeechAt = s.elapsed;
      }
      if (m.type === "activity" && !s.demo) s.signals.lastSpeechAt = s.elapsed;
      if (m.type === "think") {
        think(s);
        coach("Of course. Take a moment to think.");
      }
      if (m.type === "hint") {
        hint(s);
        publish();
      }
      if (m.type === "finish") {
        if (busy || pending)
          send({
            type: "warning",
            message:
              "Assessing your latest words. Please try finishing in a moment.",
          });
        else {
          decide(s, true);
          publish();
        }
      }
      if (m.type === "next") {
        invalidate();
        advance(s);
        coach(
          (s as Session).status === "completed"
            ? "That completes our interview. Thank you."
            : questions[s.questionIndex].title,
          true,
        );
      }
      snapshot();
    } catch {
      send({
        type: "error",
        message: "Invalid interview event. Please check the input.",
      });
    }
  });
  const interval = setInterval(() => {
    const now = performance.now(),
      delta = (now - lastTick) / 1000;
    lastTick = now;
    if (!s || s.status !== "running") return;
    const elapsed = Math.min(s.budget, s.elapsed + delta * (s.demo ? 4 : 1));
    if (s.demo && s.questionIndex === 0) {
      const script = demoScripts[s.demo];
      while (
        demoIndex < script.length &&
        script[demoIndex].at <= elapsed &&
        s.questionIndex === 0
      ) {
        const chunk = script[demoIndex++];
        s.elapsed = chunk.at;
        ingest(chunk.text, 1);
      }
    }
    // Explicit and reference-grounded urgent checks never queue behind an external model request.
    if (
      preview &&
      preview.assessed !== preview.stableText &&
      now - preview.since >= RECOVERY_RUBRIC.provisionalHoldMs &&
      preview.stableText.split(/\s+/).length >= 3
    ) {
      const text = preview.stableText;
      const recoveryTail =
        /\b(?:actually|but|correct|reconsider|connect|relate|meant)\b/i.test(
          preview.text.slice(text.length),
        );
      if (!recoveryTail && fastControl(text, null, true)) return;
      if (!busy && now >= nextAssessmentAt && now >= retryAt)
        void analyze(true);
    }
    const count = s.decisions.length,
      prior = s.status;
    // No stale semantic decision while a newer content window is being assessed.
    if (
      (busy || pending || (preview && assessedRevision !== revision)) &&
      elapsed < s.budget
    )
      s.elapsed = elapsed;
    else tick(s, elapsed);
    if ((s as Session).status === "completed") {
      invalidate();
      coach(
        "That’s our time. Thank you. Your interview review is ready.",
        true,
      );
    } else if (s.decisions.length !== count) publish();
    else send({ type: "clock", elapsed: s.elapsed });
    if (pending) void analyze();
  }, 150);
  ws.on("close", () => {
    clearInterval(interval);
    invalidate();
    s = undefined;
  });
  ws.on("error", () => {
    clearInterval(interval);
    request?.abort();
  });
});
server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(
    `Cadence API on ${process.env.PORT || 3001}; assessor: ${assessorMode()}`,
  ),
);
