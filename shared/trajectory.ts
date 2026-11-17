/** Versioned, deliberately uncalibrated estimates. Never present these as measured probabilities. */
export const RECOVERY_RUBRIC = {
  version: "recovery-v1",
  horizonSeconds: 15,
  listenAbove: 0.55,
  moveOnBelow: 0.2,
  semanticConfidenceGate: 0.8,
  provisionalHoldMs: 900,
  minimumDriftWindows: 2,
  description:
    "Estimated chance of returning to a relevant, technically defensible explanation within the next 15 seconds without help.",
};
export interface TrajectoryInput {
  correctness: "correct" | "incorrect" | "unknown";
  errorQuote: string | null;
  correction: string | null;
  explicitGiveUp: boolean;
  selfCorrection: boolean;
  connectingBack: boolean;
}
export interface Trajectory extends TrajectoryInput {
  recoveryProbability: number;
  factors: string[];
  basis: "heuristic" | "ai-estimate";
  rubricVersion: string;
  provisional: boolean;
  windowText: string;
}
export const neutralTrajectory = (): TrajectoryInput => ({
  correctness: "unknown",
  errorQuote: null,
  correction: null,
  explicitGiveUp: false,
  selfCorrection: false,
  connectingBack: false,
});
export function giveUpIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (
    !/\b(?:but|however|yet|instead|actually)\b/.test(t) &&
    /^(?:(?:please|can we|could we|let's)[, ]+)?(?:skip (?:this(?: question)?|the question|it)|(?:move|go) (?:on )?to (?:the )?next question|next question(?: please)?|i (?:give up|can't answer(?: (?:this|that|the question))?|cannot answer(?: (?:this|that|the question))?))(?:[, ]+please)?$/.test(
      t,
    )
  )
    return true;
  // Acknowledging uncertainty as part of reasoning is not surrender.
  return /^(?:(?:sorry|well|honestly|actually|um|uh)[, ]+)*(?:i (?:don't|do not) know(?: (?:the answer|this|that|it))?|i have no idea|no idea)(?:[, ]+(?:sorry|please|at all))?$/.test(
    t,
  );
}
export function recoveryEstimate(
  input: TrajectoryInput,
  relevance: number,
  repetition: number,
  productive: boolean,
  driftWindows: number,
) {
  if (input.explicitGiveUp)
    return {
      probability: 0.01,
      factors: ["Candidate explicitly chose not to continue this answer."],
    };
  const factors: string[] = [];
  let z =
    -1.4 +
    2.8 * relevance +
    1.7 *
      (input.correctness === "correct"
        ? 1
        : input.correctness === "incorrect"
          ? 0.02
          : 0.5);
  if (productive && input.correctness !== "incorrect") {
    z += 1.5;
    factors.push("New reasoning or evidence supports recovery.");
  }
  if (input.correctness === "incorrect") {
    z -= 3.4;
    factors.push("A specific claim conflicts with the answer reference.");
  }
  if (input.selfCorrection) {
    z += 3.2;
    factors.push("Candidate is explicitly correcting their reasoning.");
  }
  if (input.connectingBack) {
    z += 2.2;
    factors.push("Candidate is explaining a connection back to the question.");
  }
  if (relevance < 0.35)
    factors.push("Current explanation has little connection to the question.");
  const persistence = Math.min(driftWindows, 3);
  z -= persistence * 0.9;
  if (persistence)
    factors.push(
      `Drift or repetition persists across ${persistence} distinct content windows.`,
    );
  if (repetition > 0.8) {
    z -= 0.5;
    factors.push("Repeated content is adding little new evidence.");
  }
  return {
    probability: Math.round((1 / (1 + Math.exp(-z))) * 100) / 100,
    factors,
  };
}
