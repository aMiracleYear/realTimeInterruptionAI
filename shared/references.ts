export interface Reference {
  expected: string[];
  misconceptions: { id: string; patterns: string[]; correction: string }[];
}
/** Narrow, auditable local checks. Arbitrary technical claims require the semantic assessor. */
export const references: Record<string, Reference> = {
  shaft: {
    expected: [
      "Determine torque from power and angular speed, then account for bending and supports.",
      "Fluctuating loads require fatigue/endurance and stress-concentration checks, not just static yield.",
      "Justify material, geometry, cost and safety factor; verify stiffness and critical speed.",
    ],
    misconceptions: [
      {
        id: "ignore-fatigue",
        patterns: [
          "(?:fatigue|cyclic loading) (?:is |does |really )?(?:not (?:important|relevant|a concern)|doesn.t matter|irrelevant|never (?:matters|happens))",
          "(?:ignore|skip|don.t need to (?:check|consider)|no need to (?:check|consider)) (?:the )?fatigue",
          "(?:only|just) (?:need to |have to )?(?:check|consider) (?:the )?(?:static|yield) (?:stress|strength)",
        ],
        correction:
          "Fluctuating loading requires a fatigue check, even when the stress is below yield.",
      },
      {
        id: "no-torque",
        patterns: [
          "(?:torque|bending) (?:does not|doesn.t) (?:cause|create|produce) (?:any )?stress",
          "(?:torque|load) (?:does not|doesn.t) (?:matter|affect|influence) (?:the )?(?:shaft|design)",
        ],
        correction:
          "Torque produces shear stress, while bending produces normal stress; both affect shaft design.",
      },
      {
        id: "fatigue-above-yield",
        patterns: [
          "fatigue (?:(?:only (?:happens|occurs)) above|cannot (?:happen|occur) below) (?:the )?yield",
        ],
        correction:
          "Fatigue can occur under repeated loading below the static yield strength.",
      },
      {
        id: "unsafe-factor",
        patterns: [
          "(?:safety factor|factor of safety) (?:of |is |should be |must be )?(?:zero|0)(?:\\b|$)",
          "(?:make|build|manufacture) (?:the |a )?shaft (?:out of|from|with) (?:cheese|paper|chocolate)",
        ],
        correction:
          "The shaft needs a load-appropriate engineering material and a justified safety margin.",
      },
    ],
  },
  pump: {
    expected: [
      "Inspect safely and establish operating pressure, flow, suction conditions and vibration baseline.",
      "Differentiate cavitation, blockage, misalignment and bearing wear using measurements.",
      "Verify restored flow and vibration after the intervention under comparable conditions.",
    ],
    misconceptions: [
      {
        id: "cavitation-pressure",
        patterns: [
          "cavitation (?:is caused by|happens (?:only )?(?:at|because of)|occurs (?:only )?(?:at|because of)) (?:very )?high (?:suction |inlet )?pressure",
          "(?:low|lower) (?:suction |inlet )?pressure (?:prevents|stops|eliminates) cavitation",
        ],
        correction:
          "Cavitation is associated with local pressure falling below vapor pressure; check suction conditions and NPSH.",
      },
      {
        id: "unsafe-inspection",
        patterns: [
          "(?:touch|open|remove) (?:the )?(?:rotating|spinning) (?:shaft|impeller|guard)",
          "(?:no need (?:for|to)|skip) (?:lockout|isolation|safety)",
        ],
        correction:
          "Isolate and lock out equipment before intrusive inspection; never touch rotating parts.",
      },
    ],
  },
  project: {
    expected: [
      "Describe a specific engineering situation and constraint.",
      "Compare alternatives, explain your own action and provide a concrete result or lesson.",
    ],
    misconceptions: [],
  },
};
export function checkReference(questionId: string, text: string) {
  // Check sentences independently so a negated incorrect claim is not flagged as the candidate's belief.
  for (const sentence of text.replace(/’/g, "'").split(/(?<=[.!?])\s+/)) {
    if (
      /\b(?:it (?:is|would be) (?:wrong|incorrect) to|not true that|a misconception (?:is|would be)|i used to (?:think|believe)|i (?:don.t|do not) (?:think|believe) that|don.t (?:ignore|skip)|do not (?:ignore|skip))\b/i.test(
        sentence,
      )
    )
      continue;
    for (const item of references[questionId]?.misconceptions ?? []) {
      if (item.patterns.some((p) => new RegExp(p, "i").test(sentence)))
        return {
          quote: sentence.trim(),
          correction: item.correction,
          id: item.id,
        };
    }
  }
  return null;
}
