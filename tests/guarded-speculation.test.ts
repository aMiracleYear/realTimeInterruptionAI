import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../research/guarded-speculation";
import { observation, scenarios } from "../research/guarded-speculation-evaluate";

test("unchanged snapshot overlaps judge and guard without weakening either", () => {
  for (const judgeMs of [100, 600, 900, 1400, 3000]) {
    const s = { name: "stable", judgeMs, observations: [observation()] };
    const result = simulate(s, "speculative");
    assert.equal(result.firstInterruptionMs, Math.max(900, judgeMs));
    assert.equal(simulate(s, "serial").firstInterruptionMs, 900 + judgeMs);
    assert.equal(result.assessorCalls, 1);
    assert.equal(result.invalidCommits, 0);
  }
});
test("changed epoch, revision, request or trust never reuses earlier judgment", () => {
  const original = observation();
  for (const snapshot of [
    { ...original.snapshot, epoch: "question-2" },
    { ...original.snapshot, revision: 2 },
    { ...original.snapshot, request: original.snapshot.request + " changed reference" },
    { ...original.snapshot, request: original.snapshot.request.replace('"provisional":true', '"provisional":false') },
  ]) {
    const replacement = { ...observation(900, 2, "listen"), snapshot };
    const result = simulate({ name: "revision wins tie", judgeMs: 900, observations: [original, replacement] }, "speculative");
    assert.equal(result.firstInterruptionMs, null);
    assert.equal(result.staleCompletions, 1);
    assert.equal(result.invalidCommits, 0);
  }
});
test("end and thinking controls are evaluated before same-time completion", () => {
  for (const type of ["end", "think"] as const) {
    const r = simulate({ name: "control", judgeMs: 900, observations: [observation()],
      controls: [{ at: 900, type, until: 30000 }] }, "speculative");
    assert.equal(r.firstInterruptionMs, null);
    assert.equal(r.invalidCommits, 0);
  }
});
test("churn is bounded and reports resource contention, not fictitious gains", () => {
  const s = scenarios.find(s => s.name === "revision-causes-contention")!;
  const spec = simulate(s, "speculative"), serial = simulate(s, "serial");
  assert.equal(spec.speculativeCalls, 1);
  assert.equal(spec.assessorCalls, 2);
  assert.equal(spec.maxFallbackQueueMs, 800);
  assert.ok(spec.firstInterruptionMs! > serial.firstInterruptionMs!);
});
test("exact checks cannot eliminate a future-self-correction counterexample", () => {
  const s = scenarios.find(s => s.name === "future-correction-counterexample")!;
  const spec = simulate(s, "speculative");
  assert.equal(spec.invalidCommits, 0);
  assert.equal(spec.harmfulInterruptionCount, 1);
  assert.equal(simulate(s, "serial").harmfulInterruptionCount, 0);
});
test("all scenarios preserve observed-state gates, including provider failure", () => {
  for (const s of scenarios) for (const mode of ["serial", "speculative"] as const) {
    const r = simulate(s, mode);
    assert.equal(r.invalidCommits, 0, s.name);
    if (s.name === "failed-preparation") assert.equal(r.firstInterruptionMs, null);
  }
});
test("a failed adopted preparation gets one bounded normal retry", () => {
  const s = scenarios.find(s => s.name === "failed-adopted-preparation")!;
  const r = simulate(s, "speculative");
  assert.equal(r.assessorCalls, 2);
  assert.equal(r.failures, 2);
  assert.equal(r.firstInterruptionMs, null);
});
test("reject unsorted observations rather than silently corrupting the audit", () => {
  assert.throws(() => simulate({ name: "unsorted", judgeMs: 600,
    observations: [observation(100, 2), observation()] }, "speculative"), /ordered/);
});
test("duplicate observation delivery cannot replay a committed intervention", () => {
  const original = observation();
  const r = simulate({ name: "duplicate", judgeMs: 600, observations: [original,
    { ...original, at: 2000, eligibleAt: 2900, snapshot: { ...original.snapshot } }] }, "speculative");
  assert.equal(r.decisions.length, 1);
  assert.equal(r.assessorCalls, 1);
  assert.equal(r.invalidCommits, 0);
});
test("revision and completion interleavings maintain bounded capacity and current-state gates", () => {
  for (const judgeMs of [1, 600, 899, 900, 901, 1400, 1800]) {
    for (const changeAt of [0, 1, 599, 600, 899, 900, 901, 1399, 1400, 1401, 2000]) {
      const r = simulate({ name: "boundary sweep", judgeMs,
        observations: [observation(), observation(changeAt, 2, "listen")] }, "speculative");
      assert.equal(r.invalidCommits, 0);
      assert.ok(r.speculativeCalls <= 1);
      for (let i = 1; i < r.jobs.length; i++) assert.ok(r.jobs[i].start >= r.jobs[i - 1].end);
    }
  }
});
