/** Synthetic CPU microbenchmark; excludes ASR, network, hosted models and audio. */
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { addSegment, baselineAssessment, createSession } from "../server/engine";

const warmup = 100;
const samples = 1000;

function measure(run: () => unknown) {
  for (let i = 0; i < warmup; i++) run();
  const elapsed: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    run();
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  return {
    p50Ms: +elapsed[Math.ceil(samples * 0.5) - 1].toFixed(4),
    p95Ms: +elapsed[Math.ceil(samples * 0.95) - 1].toFixed(4),
    maxMs: +elapsed.at(-1)!.toFixed(4),
  };
}

const results = [8, 80, 500].map((segments) => {
  const session = createSession();
  for (let i = 0; i < segments; i++) {
    addSegment(
      session,
      `For load case ${i}, I would compare the alternating bending stress and torque because the shaft needs a fatigue check. Then I would validate the material choice against the operating load.`,
      0.95,
    );
  }
  return {
    segments,
    transcriptCharacters: session.segments.reduce((n, s) => n + s.text.length, 0),
    clone: measure(() => structuredClone(session)),
    rules: measure(() => baselineAssessment(session)),
    cloneThenRules: measure(() => baselineAssessment(structuredClone(session))),
  };
});

console.log(JSON.stringify({
  scope: "Synthetic warmed CPU microbenchmark, not end-to-end interview latency",
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  warmupPerMeasurement: warmup,
  samplesPerMeasurement: samples,
  fixture: "Same question, 8/80/500 finalized technical chunks, no coach turns or prior evidence; see source for exact text",
  results,
}, null, 2));
