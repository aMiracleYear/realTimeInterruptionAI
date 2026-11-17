import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  addSegment,
  applyAssessment,
  baselineAssessment,
  decide,
} from "../server/engine";
import {
  giveUpIntent,
  recoveryEstimate,
  neutralTrajectory,
} from "../shared/trajectory";
import { checkReference } from "../shared/references";
import {
  cancellationEvents,
  isBackchannel,
  wantsFloor,
} from "../src/voiceProtocol";
const classify = (text: string, confidence: number | null = 1) => {
  const s = createSession();
  s.elapsed = 1;
  addSegment(s, text, confidence);
  applyAssessment(s, baselineAssessment(s), "rules", 1);
  return s;
};
for (const text of [
  "I don't know",
  "I do not know the answer.",
  "I have no idea.",
  "Please skip this question.",
  "Move on to the next question.",
]) {
  test(`explicit give-up immediately transitions: ${text}`, () => {
    const s = classify(text);
    s.lastActionAt = 0;
    const d = decide(s);
    assert.equal(d?.action, "NEXT");
    assert.equal(d?.reasonCode, "give_up");
    assert.equal(d?.interrupt, true);
  });
}
for (const text of [
  "I don't know the exact dimensions, but I would calculate the torque from power first.",
  "I don't know yet, let me think.",
  "The candidate in my example said I do not know.",
  "I used to think fatigue is irrelevant, but it actually matters.",
]) {
  test(`uncertainty and reported speech are not surrender: ${text}`, () => {
    assert.equal(giveUpIntent(text), false);
    const s = classify(text);
    assert.equal(decide(s), undefined);
  });
}
for (const text of [
  "Fatigue is irrelevant to this design.",
  "I would ignore fatigue and only check static stress.",
  "Fatigue only occurs above the yield strength.",
  "Fatigue cannot occur below yield strength.",
  "I would use a safety factor of zero for the shaft.",
]) {
  test(`reference-backed error interrupts despite topical keywords: ${text}`, () => {
    const s = classify(text);
    assert.equal(s.evidence.length, 0);
    assert.equal(s.signals.trajectory?.correctness, "incorrect");
    const d = decide(s);
    assert.equal(d?.action, "NEXT");
    assert.equal(d?.reasonCode, "incorrect_low_recovery");
    assert.ok(d.recoveryProbability! <= 0.2);
  });
}
test("an explicit self-correction preserves the floor despite a prior wrong claim", () => {
  const s = classify(
    "Fatigue is irrelevant. Actually that is wrong; I would check fatigue because the load fluctuates.",
  );
  assert.equal(s.signals.trajectory?.selfCorrection, true);
  assert.equal(decide(s), undefined);
});
test("a negated misconception is not a wrong claim", () => {
  assert.equal(checkReference("shaft", "It is wrong to ignore fatigue."), null);
  assert.equal(
    checkReference("shaft", "Do not ignore fatigue when the load fluctuates."),
    null,
  );
  assert.equal(
    checkReference("shaft", "Fatigue can occur below the yield strength."),
    null,
  );
});
test("an uncertain ASR result abstains, but missing browser confidence does not disable explicit skip", () => {
  assert.equal(decide(classify("I don't know", 0.2)), undefined);
  assert.equal(decide(classify("I don't know", null))?.action, "NEXT");
});
test("repeating the exact same partial does not create independent drift windows or evidence", () => {
  const s = createSession();
  const text =
    "My favourite holiday involved beaches, music and wonderful food with friends.";
  const copy = createSession();
  addSegment(copy, text, null);
  const a = baselineAssessment(copy);
  applyAssessment(s, a, "rules", 1, text);
  applyAssessment(s, a, "rules", 1, text);
  assert.equal(s.signals.driftStreak, 1);
  assert.equal(s.evidence.length, 0);
  assert.equal(decide(s), undefined);
});
test("a technical error without a supporting quote is not enough to stop the answer", () => {
  const s = classify(
    "I would calculate the torque to determine the operating loads.",
  );
  const a = {
    ...baselineAssessment(s),
    trajectory: {
      ...neutralTrajectory(),
      correctness: "incorrect" as const,
      errorQuote: "Invented words never spoken.",
      correction: "Invented correction.",
    },
  };
  applyAssessment(s, a, "ai", 1);
  assert.equal(s.signals.trajectory?.correctness, "unknown");
  assert.equal(decide(s), undefined);
});
test("a plausible bridge increases recovery rather than being cut off for a detour", () => {
  const t = neutralTrajectory();
  const drifting = recoveryEstimate(t, 0.1, 0, false, 2).probability;
  const bridging = recoveryEstimate(
    { ...t, connectingBack: true },
    0.1,
    0,
    false,
    2,
  ).probability;
  assert.ok(bridging > drifting);
  assert.ok(bridging > 0.2);
});
test("cancellation flushes generation, audio and provider context in order", () => {
  assert.deepEqual(cancellationEvents("resp_1", "item_1", 1200.8), [
    { type: "response.cancel", response_id: "resp_1" },
    { type: "output_audio_buffer.clear" },
    {
      type: "conversation.item.truncate",
      item_id: "item_1",
      content_index: 0,
      audio_end_ms: 1200,
    },
  ]);
  assert.deepEqual(
    cancellationEvents(undefined, undefined, -10).map((e) => e.type),
    ["response.cancel", "output_audio_buffer.clear"],
  );
});
test("cooperative backchannels do not seize the floor; corrections and stop requests do", () => {
  for (const text of ["uh-huh", "yeah", "right", "okay, thanks"]) {
    assert.equal(isBackchannel(text), true);
    assert.equal(wantsFloor(text), false);
  }
  for (const text of [
    "stop",
    "wait a minute",
    "actually I disagree",
    "could you repeat the question",
  ])
    assert.equal(wantsFloor(text), true);
});
test("quoted skip requests and a possible continuation are not treated as the candidate surrendering", () => {
  for (const text of [
    "I would tell my colleague to skip this question.",
    "I can't answer this yet but I can calculate the torque.",
    "Please do not skip this question.",
  ])
    assert.equal(giveUpIntent(text), false);
});
