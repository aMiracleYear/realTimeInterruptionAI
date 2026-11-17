import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSegment,
  advance,
  applyAssessment,
  baselineAssessment,
  createSession,
  decide,
  hint,
  think,
  tick,
} from "../server/engine";
import type { Assessment } from "../shared/types";
import { demoScripts } from "../server/demo";
const relevant =
  "First I would calculate the torque from power and speed to determine the bending loads at the supports.";
const offTopic =
  "The music festival was great and we spent the evening planning snacks and discussing our favourite films.";
const evaluate = (
  s: ReturnType<typeof createSession>,
  at: number,
  text: string,
  confidence: number | null = 1,
) => {
  s.elapsed = at;
  addSegment(s, text, confidence);
  applyAssessment(s, baselineAssessment(s), "rules", 1);
};
test("new rubric evidence is deduplicated, backed by the exact transcript, and protects progress", () => {
  const s = createSession();
  evaluate(s, 5, relevant);
  assert.equal(s.evidence.length, 1);
  assert.equal(s.evidence[0].criterionId, "loads");
  evaluate(s, 10, relevant);
  assert.equal(s.evidence.length, 1);
  assert.equal(decide(s)?.action, undefined);
});
test("one drift chunk is insufficient; sustained drift redirects at a pause", () => {
  const s = createSession();
  evaluate(s, 5, relevant);
  evaluate(s, 13, offTopic);
  tick(s, 16);
  assert.equal(s.decisions.length, 0);
  evaluate(
    s,
    23,
    "The food and music at the party made the whole weekend wonderful, and we talked about another holiday.",
  );
  tick(s, 24);
  assert.equal(s.decisions.length, 0, "no interruption before the boundary");
  tick(s, 25);
  assert.equal(s.decisions.at(-1)?.action, "REDIRECT");
});
test("a long pause offers optional help without declaring the candidate stuck, and cooldown prevents rapid repeat", () => {
  const s = createSession();
  evaluate(s, 5, relevant);
  tick(s, 22);
  assert.equal(s.decisions.length, 0);
  tick(s, 24);
  assert.equal(s.decisions.at(-1)?.action, "PROMPT");
  assert.match(s.decisions[0].message, /Would you like/);
  tick(s, 30);
  assert.equal(s.decisions.length, 1);
});
test("productive reasoning is allowed to continue while incomplete coverage is still progressing", () => {
  const s = createSession();
  for (const event of demoScripts.thinking.slice(0, 3)) {
    evaluate(s, event.at, event.text);
    tick(s, event.at + 5);
  }
  assert.equal(s.evidence.length, 3);
  assert.equal(s.decisions.length, 0);
});
test("unknown and low ASR confidence suppress evidence and content interventions", () => {
  for (const confidence of [null, 0.3]) {
    const s = createSession();
    evaluate(s, 5, relevant, confidence);
    evaluate(s, 15, offTopic, confidence);
    evaluate(s, 25, offTopic, confidence);
    tick(s, 50);
    assert.equal(s.evidence.length, 0);
    assert.equal(s.decisions.length, 0);
  }
});
test("thinking override protects 30 seconds while the hard session budget still applies", () => {
  const s = createSession(180);
  s.elapsed = 20;
  think(s);
  tick(s, 49);
  assert.equal(s.decisions.length, 0);
  s.elapsed = 170;
  think(s);
  tick(s, 180);
  assert.equal(s.status, "completed");
  assert.equal(s.elapsed, 180);
});
test("requested hints label subsequent evidence as assisted", () => {
  const s = createSession();
  hint(s);
  evaluate(s, 8, relevant);
  assert.equal(s.evidence[0].assisted, true);
  assert.match(s.decisions[0].reason, /labelled assisted/);
});
test("fabricated or unknown-criterion evidence is rejected", () => {
  const s = createSession();
  addSegment(s, relevant, 1);
  const a: Assessment = {
    relevance: 1,
    repetition: 0,
    confidence: 1,
    productiveReasoning: true,
    evidence: [
      {
        criterionId: "fatigue",
        quote: "I have tested this shaft in a laboratory.",
      },
      { criterionId: "invented", quote: relevant },
    ],
  };
  applyAssessment(s, a, "ai", 42);
  assert.equal(s.evidence.length, 0);
});
test("keyword lists and explicit lack of knowledge do not count as explanation", () => {
  for (const text of [
    "Torque, bending, fatigue, steel, FEA.",
    "I do not know how fatigue works because I have never studied it.",
  ]) {
    const s = createSession();
    evaluate(s, 5, text);
    assert.equal(s.evidence.length, 0);
  }
});
test("pause freezes elapsed time and question transition resets drift and thinking override", () => {
  const s = createSession();
  evaluate(s, 5, offTopic);
  s.status = "paused";
  tick(s, 60);
  assert.equal(s.elapsed, 5);
  s.status = "running";
  think(s);
  advance(s);
  assert.equal(s.questionIndex, 1);
  assert.equal(s.protectedUntil, 0);
  assert.equal(s.signals.driftStreak, 0);
  assert.equal(s.evidence.length, 0);
  assert.equal(s.awaitingNext, false);
});
test("sufficient evidence invites a transition rather than silently skipping the question", () => {
  const s = createSession();
  for (const event of demoScripts.thinking) evaluate(s, event.at, event.text);
  tick(s, 38);
  assert.equal(s.decisions.at(-1)?.action, "NEXT");
  assert.equal(s.awaitingNext, true);
  assert.equal(s.questionIndex, 0);
});
test("time allocation invites a transition with a budget explanation", () => {
  const s = createSession(180);
  evaluate(s, 2, relevant);
  tick(s, 60);
  assert.equal(s.decisions.at(-1)?.action, "NEXT");
  assert.match(s.decisions.at(-1)!.reason, /budget/);
});
test("unavailable AI assessor abstains from content-based interruption", () => {
  const s = createSession();
  evaluate(s, 5, offTopic);
  evaluate(s, 15, offTopic);
  s.signals.assessment = "unavailable";
  tick(s, 45);
  assert.equal(s.decisions.length, 0);
});
test("low semantic confidence abstains even if ASR is confident", () => {
  const s = createSession();
  s.elapsed = 5;
  addSegment(s, relevant, 1);
  applyAssessment(s, { ...baselineAssessment(s), confidence: 0.3 }, "ai", 10);
  tick(s, 45);
  assert.equal(s.evidence.length, 0);
  assert.equal(s.decisions.length, 0);
});
test("one silent interval does not earn repeated unrequested nudges", () => {
  const s = createSession();
  tick(s, 19);
  tick(s, 40);
  tick(s, 65);
  assert.equal(s.decisions.filter((d) => d.action === "PROMPT").length, 1);
});
test("coalesced fast input still captures trusted evidence from earlier recent chunks", () => {
  const s = createSession();
  addSegment(s, relevant, 1);
  addSegment(s, "Let me organize the next step in my answer.", 1);
  applyAssessment(s, baselineAssessment(s), "rules", 1);
  assert.equal(s.evidence.length, 1);
  assert.equal(s.evidence[0].quote, relevant);
});
test("an AI quote from an uncertain earlier chunk cannot become trusted after a confident latest chunk", () => {
  const s = createSession();
  addSegment(s, relevant, 0.2);
  addSegment(s, "Here is another part of my answer.", 1);
  applyAssessment(
    s,
    {
      relevance: 1,
      repetition: 0,
      confidence: 1,
      productiveReasoning: true,
      evidence: [{ criterionId: "loads", quote: relevant }],
    },
    "ai",
    10,
  );
  assert.equal(s.evidence.length, 0);
});
test("a delayed assessment of pre-hint evidence remains independent", () => {
  const s = createSession();
  addSegment(s, relevant, 1);
  hint(s);
  applyAssessment(s, baselineAssessment(s), "rules", 10);
  assert.equal(s.evidence[0].assisted, false);
});
