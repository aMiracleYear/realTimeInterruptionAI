import {
  RECOVERY_RUBRIC,
  giveUpIntent,
  neutralTrajectory,
  recoveryEstimate,
} from "../shared/trajectory";
import { checkReference } from "../shared/references";
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
    coachTurns: [],
    status: "running",
    budget,
    elapsed: 0,
    questionIndex: 0,
    questionStartedAt: 0,
    segments: [],
    evidence: [],
    decisions: [],
    signals: {
      trajectory: null,
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
    let text = segment.text;
    // Acknowledged uncertainty does not erase a concrete explanation that follows it.
    if (/\b(?:don.t know|do not know|not sure)\b/i.test(text)) {
      const bridge = /\b(?:but|however)\b/i.exec(text);
      if (bridge) text = text.slice(bridge.index + bridge[0].length).trim();
    }
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
  const error = checkReference(q.id, latest);
  const selfCorrection =
    /\b(?:actually|on second thought|let me (?:correct|reconsider)|i (?:meant|was wrong)|rather than|instead i|that(?:'s| is) (?:wrong|incorrect))\b/i.test(
      latest,
    );
  const connectingBack =
    /\b(?:this (?:relates|connects|brings me back)|to (?:relate|connect|bring) (?:this|that) back|the connection (?:is|to)|in terms of the (?:shaft|pump|design))\b/i.test(
      latest,
    );
  return {
    trajectory: {
      correctness: error ? "incorrect" : "unknown",
      errorQuote: error?.quote ?? null,
      correction: error?.correction ?? null,
      explicitGiveUp: giveUpIntent(latest),
      selfCorrection,
      connectingBack,
    },
    relevance: hits.length ? Math.min(1, 0.55 + hits.length * 0.1) : 0.12,
    repetition: repeat,
    confidence: error || giveUpIntent(latest) ? 0.97 : 0.86,
    productiveReasoning: hits.length > 0 && repeat < 0.8 && !error,
    evidence: error || giveUpIntent(latest) ? [] : evidence,
  };
}
export function addSegment(
  s: Session,
  text: string,
  confidence: number | null,
) {
  if (s.status !== "running" || s.awaitingNext) return;
  s.segments.push({
    sequence: s.segments.length + s.coachTurns.length,
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
  preview?: string,
) {
  const latest = preview
    ? { text: preview, confidence: null }
    : s.segments.filter((t) => t.questionIndex === s.questionIndex).at(-1);
  if (!latest) return;
  const q = questions[s.questionIndex];
  s.signals.assessment = source;
  s.signals.assessmentConfidence = a.confidence;
  s.signals.latencyMs = latencyMs;
  const t = a.trajectory ?? neutralTrajectory();
  // Explicit conversational intent is locally checked even when a model fails to identify it.
  t.explicitGiveUp = giveUpIntent(latest.text);
  // Do not trust a model's unsupported assertion of technical error.
  if (
    t.correctness === "incorrect" &&
    (!t.errorQuote || !latest.text.includes(t.errorQuote))
  ) {
    t.correctness = "unknown";
    t.errorQuote = null;
    t.correction = null;
  }
  const knownLowAsr =
    latest.confidence !== null && latest.confidence < POLICY.confidenceGate;
  const confident =
    !knownLowAsr && a.confidence >= RECOVERY_RUBRIC.semanticConfidenceGate;
  s.signals.relevance = a.relevance;
  s.signals.repetition = a.repetition;
  if (!confident) {
    s.signals.driftStreak = 0;
    s.signals.trajectory = null;
    s.insight =
      "The transcript or judgment is uncertain. I’ll listen rather than guess.";
    return;
  }
  const prior = s.signals.trajectory;
  // Repeated identical interim/final results are one window, not corroborating evidence.
  const distinctWindow =
    !prior ||
    (prior.windowText !== latest.text &&
      (!latest.text.startsWith(prior.windowText) ||
        words(latest.text).length - words(prior.windowText).length >= 5));
  const drifting =
    words(latest.text).length >= 6 &&
    (a.relevance < 0.35 || (a.repetition > 0.86 && !a.productiveReasoning));
  if (distinctWindow)
    s.signals.driftStreak = drifting ? s.signals.driftStreak + 1 : 0;
  const estimate = recoveryEstimate(
    t,
    a.relevance,
    a.repetition,
    a.productiveReasoning,
    s.signals.driftStreak,
  );
  s.signals.trajectory = {
    ...t,
    recoveryProbability: estimate.probability,
    factors: estimate.factors,
    basis: source === "rules" ? "heuristic" : "ai-estimate",
    rubricVersion: RECOVERY_RUBRIC.version,
    provisional: Boolean(preview),
    windowText: latest.text,
  };
  if (preview) {
    s.insight =
      t.selfCorrection || t.connectingBack
        ? "You appear to be working back toward the question. I’m listening."
        : "Following the direction of your answer…";
    return;
  }
  let added = 0;
  const segments = s.segments.filter(
    (t) => t.questionIndex === s.questionIndex,
  );
  const transcript = segments.map((t) => t.text).join("\n");
  for (const e of t.correctness === "incorrect" || t.explicitGiveUp
    ? []
    : a.evidence) {
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
  const trajectory = s.signals.trajectory;
  const canAct =
    trajectory &&
    s.signals.assessment !== "unavailable" &&
    (s.signals.assessmentConfidence ?? 0) >=
      RECOVERY_RUBRIC.semanticConfidenceGate;
  if (canAct && trajectory.explicitGiveUp) {
    const d = emit(
      s,
      "NEXT",
      "The candidate explicitly chose not to continue.",
      "No problem. Let’s try another question.",
    );
    Object.assign(d, {
      interrupt: true,
      reasonCode: "give_up",
      recoveryProbability: trajectory.recoveryProbability,
      trajectory: structuredClone(trajectory),
    });
    return d;
  }
  if (
    canAct &&
    !trajectory.selfCorrection &&
    !trajectory.connectingBack &&
    s.elapsed >= s.protectedUntil
  ) {
    const wrong = trajectory.correctness === "incorrect";
    const sustained =
      s.signals.driftStreak >= RECOVERY_RUBRIC.minimumDriftWindows;
    if (
      trajectory.recoveryProbability <= RECOVERY_RUBRIC.moveOnBelow &&
      (wrong || sustained)
    ) {
      const message = wrong
        ? `Let’s stop there. ${trajectory.correction ?? "That reasoning conflicts with the question’s reference."} We’ll move to another question.`
        : "Let me stop you there. We’ve moved away from the question without a clear route back. Let’s try the next one.";
      const d = emit(
        s,
        "NEXT",
        wrong
          ? "A specific technical error and low estimated recovery justify moving on."
          : "Sustained drift and low estimated recovery justify moving on.",
        message,
      );
      Object.assign(d, {
        interrupt: true,
        reasonCode: wrong ? "incorrect_low_recovery" : "drift_low_recovery",
        recoveryProbability: trajectory.recoveryProbability,
        trajectory: structuredClone(trajectory),
      });
      return d;
    }
    if (
      sustained &&
      trajectory.recoveryProbability < RECOVERY_RUBRIC.listenAbove &&
      s.elapsed - s.lastActionAt >= 8
    ) {
      const d = emit(
        s,
        "REDIRECT",
        "Recovery is possible but uncertain; offer a brief route back.",
        `Bring that back to ${q.topic.toLowerCase()}. ${missing?.probe ?? q.context}`,
      );
      Object.assign(d, {
        interrupt: true,
        reasonCode: "recoverable_drift",
        recoveryProbability: trajectory.recoveryProbability,
        trajectory: structuredClone(trajectory),
      });
      return d;
    }
  }
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
    trajectory: null,
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
