import { randomUUID } from "node:crypto";
import { questions } from "../shared/questions";
import type { Assessment, Decision, Demo, Session } from "../shared/types";
export const POLICY = {
  minimumAnswer: 12,
  pauseTolerance: 18,
  cooldown: 20,
  confidenceGate: 0.72,
  thinkingExtension: 30,
  progressGrace: 14,
  boundary: 1.2,
};
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const stop = new Set(
  "a an the and or but to of in on for is it was i my we as that this with so be would have had then".split(
    " ",
  ),
);
export function createSession(budget = 600, demo?: Demo): Session {
  return {
    id: randomUUID(),
    status: "running",
    budget,
    elapsed: 0,
    questionIndex: 0,
    questionStartedAt: 0,
    segments: [],
    evidence: [],
    decisions: [],
    signals: {
      relevance: null,
      repetition: 0,
      confidence: null,
      driftStreak: 0,
      lastProgressAt: 0,
      lastSpeechAt: 0,
      assessmentConfidence: null,
      assessment: "waiting",
      latencyMs: null,
    },
    lastActionAt: -100,
    protectedUntil: 0,
    hinted: [],
    awaitingNext: false,
    insight: "Take a breath. Start with how you would approach the problem.",
    demo,
  };
}
export function baselineAssessment(s: Session): Assessment {
  const q = questions[s.questionIndex];
  const segments = s.segments.filter(
    (t) => t.questionIndex === s.questionIndex,
  );
  const latest = segments.at(-1)?.text ?? "";
  const tokens = words(latest).filter((w) => !stop.has(w));
  const topical = q.rubric.flatMap((r) => r.keywords);
  const hits = topical.filter((k) => latest.toLowerCase().includes(k));
  const previous = new Set(
    words(
      segments
        .slice(0, -1)
        .map((x) => x.text)
        .join(" "),
    ).filter((w) => !stop.has(w)),
  );
  const repeat = tokens.length
    ? tokens.filter((w) => previous.has(w)).length / tokens.length
    : 0;
  // Scan recent trusted chunks as well as the latest one so coalescing fast updates cannot lose evidence.
  const evidence = segments.slice(-8).flatMap((segment) => {
    const text = segment.text;
    const isExplanation =
      words(text).length >= 9 &&
      /\b(because|to|so|check|would|by|using|compare|first|then|i)\b/i.test(
        text,
      );
    const denied =
      /\b(don't know|do not know|no idea|not sure what|don't understand)\b/i.test(
        text,
      );
    if (
      !isExplanation ||
      denied ||
      segment.confidence === null ||
      segment.confidence < POLICY.confidenceGate
    )
      return [];
    return q.rubric
      .filter((r) => r.keywords.some((k) => text.toLowerCase().includes(k)))
      .map((r) => ({ criterionId: r.id, quote: text }));
  });
  return {
    relevance: hits.length ? Math.min(1, 0.55 + hits.length * 0.1) : 0.12,
    repetition: repeat,
    confidence: 0.8,
    productiveReasoning: hits.length > 0 && repeat < 0.8,
    evidence,
  };
}
export function addSegment(
  s: Session,
  text: string,
  confidence: number | null,
) {
  if (s.status !== "running" || s.awaitingNext) return;
  s.segments.push({
    id: randomUUID(),
    questionIndex: s.questionIndex,
    text,
    at: s.elapsed,
    confidence,
  });
  s.signals.lastSpeechAt = s.elapsed;
  s.signals.confidence = confidence;
}
export function applyAssessment(
  s: Session,
  a: Assessment,
  source: "rules" | "ai",
  latencyMs: number,
) {
  const latest = s.segments
    .filter((t) => t.questionIndex === s.questionIndex)
    .at(-1);
  if (!latest) return;
  const q = questions[s.questionIndex];
  s.signals.assessment = source;
  s.signals.assessmentConfidence = a.confidence;
  s.signals.latencyMs = latencyMs;
  // Unknown ASR confidence remains unknown: abstain instead of inventing certainty.
  const confident =
    latest.confidence !== null &&
    latest.confidence >= POLICY.confidenceGate &&
    a.confidence >= POLICY.confidenceGate;
  s.signals.relevance = a.relevance;
  s.signals.repetition = a.repetition;
  if (!confident) {
    s.signals.driftStreak = 0;
    s.insight =
      "Recognition or assessment is uncertain. Keeping interruptions on hold.";
    return;
  }
  let added = 0;
  const segments = s.segments.filter(
    (t) => t.questionIndex === s.questionIndex,
  );
  const transcript = segments.map((t) => t.text).join("\n");
  for (const e of a.evidence) {
    if (
      !q.rubric.some((r) => r.id === e.criterionId) ||
      e.quote.trim().length < 12 ||
      !transcript.includes(e.quote)
    )
      continue;
    if (
      s.evidence.some(
        (x) =>
          x.questionIndex === s.questionIndex &&
          x.criterionId === e.criterionId,
      )
    )
      continue;
    const quoteStart = transcript.indexOf(e.quote),
      quoteEnd = quoteStart + e.quote.length;
    let offset = 0;
    const sources = segments.filter((segment) => {
      const start = offset;
      offset += segment.text.length + 1;
      return start < quoteEnd && offset - 1 > quoteStart;
    });
    if (
      !sources.length ||
      sources.some(
        (segment) =>
          segment.confidence === null ||
          segment.confidence < POLICY.confidenceGate,
      )
    )
      continue;
    const assisted = s.hinted.some(
      (h) =>
        h.criterionId === e.criterionId &&
        h.afterSegment <= s.segments.indexOf(sources[0]),
    );
    s.evidence.push({
      ...e,
      questionIndex: s.questionIndex,
      at: s.elapsed,
      assisted,
      source,
    });
    added++;
  }
  if (added || a.productiveReasoning) s.signals.lastProgressAt = s.elapsed;
  s.signals.driftStreak =
    a.relevance < 0.35 || (a.repetition > 0.86 && !added)
      ? s.signals.driftStreak + 1
      : 0;
  s.insight = added
    ? `${added} new rubric signal${added > 1 ? "s" : ""} captured. Keep building your answer.`
    : a.productiveReasoning
      ? "Your reasoning is moving forward. There is room to think."
      : s.signals.driftStreak
        ? "Checking whether this connects to the question before stepping in."
        : "Listening for a specific example or a new piece of evidence.";
}
function emit(
  s: Session,
  action: Decision["action"],
  reason: string,
  message: string,
) {
  const d: Decision = {
    id: randomUUID(),
    at: s.elapsed,
    questionIndex: s.questionIndex,
    action,
    reason,
    message,
  };
  s.decisions.push(d);
  s.lastActionAt = s.elapsed;
  s.insight = reason;
  if (action === "NEXT") s.awaitingNext = true;
  return d;
}
export function decide(s: Session, finished = false): Decision | undefined {
  if (s.status !== "running" || s.awaitingNext) return;
  const q = questions[s.questionIndex];
  const age = s.elapsed - s.questionStartedAt;
  const silence = s.elapsed - s.signals.lastSpeechAt;
  const current = s.evidence.filter((e) => e.questionIndex === s.questionIndex);
  const missing = q.rubric.find(
    (r) => !current.some((e) => e.criterionId === r.id),
  );
  if (finished) {
    if (!s.segments.some((t) => t.questionIndex === s.questionIndex))
      return emit(
        s,
        "PROMPT",
        "No answer captured yet.",
        "You can speak or type your approach, or skip to the next question.",
      );
    return missing
      ? emit(
          s,
          "PROBE",
          `There is still a gap: ${missing.label.toLowerCase()}.`,
          missing.probe,
        )
      : emit(
          s,
          "NEXT",
          "All four rubric areas have supporting signals.",
          "Thank you. We have covered the main areas. Ready for the next question?",
        );
  }
  if (
    age < POLICY.minimumAnswer ||
    s.elapsed < s.protectedUntil ||
    s.elapsed - s.lastActionAt < POLICY.cooldown
  )
    return;
  // A hard question allocation is a time-management decision, never a claim of incompetence.
  const allocation = s.budget / questions.length;
  if (age >= allocation && silence >= POLICY.boundary)
    return emit(
      s,
      "NEXT",
      "This question has reached its share of the session budget.",
      "Let’s make room for the next competency. You can move on when ready.",
    );
  if (silence < POLICY.boundary) return;
  if (current.length === q.rubric.length && age >= 25)
    return emit(
      s,
      "NEXT",
      "All rubric areas have supporting signals.",
      "That gives us a useful picture of your approach. Shall we move on?",
    );
  if (
    s.signals.confidence === null &&
    s.segments.some((t) => t.questionIndex === s.questionIndex)
  )
    return;
  if (
    s.signals.confidence !== null &&
    s.signals.confidence < POLICY.confidenceGate
  )
    return;
  if (
    s.signals.assessment === "unavailable" ||
    (s.signals.assessmentConfidence !== null &&
      s.signals.assessmentConfidence < POLICY.confidenceGate)
  )
    return;
  if (
    s.signals.driftStreak >= 2 &&
    s.elapsed - s.signals.lastProgressAt >= POLICY.progressGrace
  ) {
    return emit(
      s,
      "REDIRECT",
      "Two stable updates show drift or repetition without new rubric evidence.",
      `Let’s bring that back to ${q.topic.toLowerCase()}. ${missing?.probe ?? q.context}`,
    );
  }
  if (
    silence >= POLICY.pauseTolerance &&
    s.elapsed - s.signals.lastProgressAt >= POLICY.pauseTolerance &&
    !s.decisions.some(
      (d) =>
        d.questionIndex === s.questionIndex &&
        d.action === "PROMPT" &&
        d.at >= s.signals.lastSpeechAt,
    )
  ) {
    return emit(
      s,
      "PROMPT",
      "A long pause is a chance to offer support, not a judgment that you are stuck.",
      "Take your time. Would you like a small hint, or another 30 seconds to think?",
    );
  }
}
export function advance(s: Session) {
  if (s.status !== "running") return;
  if (s.questionIndex === questions.length - 1)
    return complete(s, "All questions visited.");
  s.questionIndex++;
  s.questionStartedAt = s.elapsed;
  s.awaitingNext = false;
  s.hinted = [];
  s.protectedUntil = 0;
  s.lastActionAt = s.elapsed;
  s.signals = {
    relevance: null,
    repetition: 0,
    confidence: null,
    driftStreak: 0,
    lastProgressAt: s.elapsed,
    lastSpeechAt: s.elapsed,
    assessmentConfidence: null,
    assessment: "waiting",
    latencyMs: null,
  };
  s.insight = "A fresh question. Take a moment to organize your answer.";
}
export function think(s: Session) {
  if (s.status !== "running" || s.awaitingNext) return;
  s.protectedUntil = s.elapsed + POLICY.thinkingExtension;
  s.insight =
    "Thinking space protected for 30 seconds. The session budget still applies.";
}
export function hint(s: Session) {
  if (s.status !== "running" || s.awaitingNext) return;
  const r = questions[s.questionIndex].rubric.find(
    (r) =>
      !s.evidence.some(
        (e) => e.questionIndex === s.questionIndex && e.criterionId === r.id,
      ),
  );
  if (!r) return;
  s.hinted.push({ criterionId: r.id, afterSegment: s.segments.length });
  return emit(
    s,
    "PROBE",
    "Hint requested. Evidence for this rubric area will be labelled assisted.",
    r.hint,
  );
}
export function complete(s: Session, reason: string) {
  s.status = "completed";
  s.completedReason = reason;
  s.insight = reason;
}
export function tick(s: Session, elapsed: number) {
  if (s.status !== "running") return;
  s.elapsed = Math.min(s.budget, elapsed);
  if (s.elapsed >= s.budget)
    complete(s, "The session time budget is complete.");
  else decide(s);
}
