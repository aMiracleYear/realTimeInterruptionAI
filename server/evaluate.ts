import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import type { Action } from "../shared/types";
import {
  addSegment,
  applyAssessment,
  baselineAssessment,
  createSession,
  think,
  tick,
} from "./engine";
const actionSchema = z.enum([
  "CONTINUE",
  "PROMPT",
  "REDIRECT",
  "PROBE",
  "NEXT",
]);
const traceSchema = z
  .object({
    id: z.string(),
    participantId: z.string(),
    duration: z.number().int().min(1).max(599),
    segments: z.array(
      z.object({
        at: z.number().int().min(0),
        text: z.string().min(1).max(4000),
        confidence: z.number().min(0).max(1).nullable(),
      }),
    ),
    controls: z.array(
      z.object({ at: z.number().int().min(0), type: z.literal("think") }),
    ),
    windows: z.array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        actions: z.array(actionSchema).min(1),
      }),
    ),
  })
  .superRefine((trace, ctx) => {
    if (
      trace.segments.some(
        (e, i) =>
          e.at > trace.duration || (i > 0 && e.at < trace.segments[i - 1].at),
      ) ||
      trace.controls.some((e) => e.at > trace.duration) ||
      trace.windows.some((w) => w.start > w.end || w.end > trace.duration)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Events must be ordered and all times/windows must be within the trace duration.",
      });
    }
  });
export type Trace = z.infer<typeof traceSchema>;
export type Prediction = { at: number; action: Action };
export function scoreWindows(
  predictions: Prediction[],
  windows: Trace["windows"],
) {
  const matched = new Set<number>();
  let tp = 0,
    fp = 0;
  for (const p of predictions) {
    const match = windows.findIndex(
      (w, i) =>
        !matched.has(i) &&
        p.at >= w.start &&
        p.at <= w.end &&
        w.actions.includes(p.action),
    );
    if (match >= 0) {
      tp++;
      matched.add(match);
    } else fp++;
  }
  return { tp, fp, fn: windows.length - matched.size };
}
export function replay(
  trace: Trace,
  policy: "adaptive" | "none" | "timeout",
): Prediction[] {
  if (policy === "none") return [];
  // This intentionally simple comparator fires once at 20s irrespective of transcript content.
  if (policy === "timeout")
    return trace.duration >= 20 ? [{ at: 20, action: "PROMPT" }] : [];
  const s = createSession(1800);
  for (let t = 0; t <= trace.duration; t++) {
    s.elapsed = t;
    for (const event of trace.segments.filter((e) => e.at === t)) {
      addSegment(s, event.text, event.confidence);
      applyAssessment(s, baselineAssessment(s), "rules", 0);
    }
    for (const event of trace.controls.filter((e) => e.at === t))
      if (event.type === "think") think(s);
    tick(s, t);
  }
  return s.decisions.map((d) => ({ at: d.at, action: d.action }));
}
export function evaluate(file: string) {
  const traces = z
    .array(traceSchema)
    .min(1)
    .parse(JSON.parse(readFileSync(file, "utf8")));
  return (["none", "timeout", "adaptive"] as const).map((policy) => {
    const total = traces.reduce(
      (a, trace) => {
        const score = scoreWindows(replay(trace, policy), trace.windows);
        return {
          tp: a.tp + score.tp,
          fp: a.fp + score.fp,
          fn: a.fn + score.fn,
        };
      },
      { tp: 0, fp: 0, fn: 0 },
    );
    const precision =
      total.tp + total.fp ? total.tp / (total.tp + total.fp) : null;
    const recall =
      total.tp + total.fn ? total.tp / (total.tp + total.fn) : null;
    return {
      policy,
      traces: traces.length,
      ...total,
      precision,
      recall,
      f1:
        2 * total.tp + total.fp + total.fn
          ? (2 * total.tp) / (2 * total.tp + total.fp + total.fn)
          : null,
    };
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const file =
    process.argv[2] ||
    fileURLToPath(new URL("../tests/fixtures/timing.json", import.meta.url));
  console.log(
    "Timing regression only. Included traces are synthetic; these results do not establish real-world superiority.",
  );
  console.table(evaluate(file));
}
