import { simulate, type Observation, type Scenario } from "./guarded-speculation";

export const observation = (at = 0, revision = 1, verdict: Observation["verdict"] = "interrupt"): Observation => ({
  at, eligibleAt: at + 900, snapshot: { epoch: "question-1", revision,
    request: JSON.stringify({ text: revision === 1 ? "A supported wrong claim" : "Actually, the correction is…", provisional: true, model: "unchanged-judge", reference: "v1" }) }, verdict,
});
export const scenarios: Scenario[] = [
  { name: "stable-ready-before-gate", judgeMs: 600, observations: [observation()] },
  { name: "stable-adopt-in-flight", judgeMs: 1400, observations: [observation()] },
  { name: "correction-before-gate", judgeMs: 600, observations: [observation(), observation(899, 2, "listen")] },
  { name: "revision-causes-contention", judgeMs: 1800, observations: [observation(), observation(100, 2)] },
  { name: "end-at-commit-boundary", judgeMs: 900, observations: [observation()], controls: [{ at: 900, type: "end" }] },
  { name: "thinking-protection", judgeMs: 600, observations: [observation()], controls: [{ at: 850, type: "think", until: 30850 }] },
  { name: "future-correction-counterexample", judgeMs: 1000,
    observations: [{ ...observation(), wouldRecover: true }, observation(1500, 2, "listen")] },
  { name: "failed-preparation", judgeMs: 600, observations: [{ ...observation(), fail: true }] },
  { name: "failed-adopted-preparation", judgeMs: 1400, observations: [{ ...observation(), fail: true }] },
];

if (process.argv[1]?.endsWith("guarded-speculation-evaluate.ts")) {
  console.log(JSON.stringify({
    kind: "Deterministic scheduling simulation, NOT measured model/audio performance",
    assumptions: "Same fixed synthetic assessor verdict per exact snapshot; 900ms external eligibility guard; one worker; default one speculative launch; stale work occupies worker until completion; fixed synthetic judge durations; no audio path",
    interpretation: "Zero invalid commits checks freshness/guard compliance only. Future correction can still make an earlier valid commitment harmful. Churn can increase both latency and compute.",
    results: scenarios.map(s => ({ name: s.name, serial: simulate(s, "serial"), speculative: simulate(s, "speculative") })),
  }, null, 2));
}
