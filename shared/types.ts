export type Action = "CONTINUE" | "PROMPT" | "REDIRECT" | "PROBE" | "NEXT";
export type Demo = "drift" | "pause" | "thinking";
export type SessionStatus = "ready" | "running" | "paused" | "completed";
export interface Criterion {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  probe: string;
  hint: string;
}
export interface Question {
  id: string;
  topic: string;
  title: string;
  context: string;
  rubric: Criterion[];
}
export interface Segment {
  id: string;
  questionIndex: number;
  text: string;
  at: number;
  confidence: number | null;
}
export interface Evidence {
  questionIndex: number;
  criterionId: string;
  quote: string;
  at: number;
  assisted: boolean;
  source: "rules" | "ai";
}
export interface Decision {
  id: string;
  at: number;
  questionIndex: number;
  action: Action;
  reason: string;
  message: string;
  feedback?: "helpful" | "early";
}
export interface Signals {
  relevance: number | null;
  repetition: number;
  confidence: number | null;
  driftStreak: number;
  lastProgressAt: number;
  lastSpeechAt: number;
  assessmentConfidence: number | null;
  assessment: "waiting" | "rules" | "ai" | "unavailable";
  latencyMs: number | null;
}
export interface Session {
  id: string;
  status: SessionStatus;
  budget: number;
  elapsed: number;
  questionIndex: number;
  questionStartedAt: number;
  segments: Segment[];
  evidence: Evidence[];
  decisions: Decision[];
  signals: Signals;
  lastActionAt: number;
  protectedUntil: number;
  hinted: { criterionId: string; afterSegment: number }[];
  awaitingNext: boolean;
  insight: string;
  demo?: Demo;
  completedReason?: string;
}
export interface Assessment {
  relevance: number;
  repetition: number;
  confidence: number;
  productiveReasoning: boolean;
  evidence: { criterionId: string; quote: string }[];
}
export type ClientMessage =
  | { type: "start"; budget: number; demo?: Demo }
  | { type: "segment"; text: string; confidence: number | null }
  | { type: "activity" }
  | { type: "pause" | "resume" | "finish" | "next" | "think" | "hint" | "end" }
  | { type: "feedback"; id: string; value: "helpful" | "early" };
