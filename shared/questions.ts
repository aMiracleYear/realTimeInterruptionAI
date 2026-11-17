import type { Question } from "./types";
export const questions: Question[] = [
  {
    id: "shaft",
    topic: "Design reasoning",
    title:
      "How would you design a shaft that transmits power under a fluctuating load?",
    context:
      "Walk me through your approach, the trade-offs you would consider, and how you would validate your design.",
    rubric: [
      {
        id: "loads",
        label: "Define the problem",
        description:
          "Establish torque, bending loads, speed and operating constraints.",
        keywords: ["torque", "bending", "load", "speed", "power", "rpm"],
        probe: "What loads and operating conditions would you establish first?",
        hint: "Start from the power and rotational speed to estimate torque, then consider bending loads.",
      },
      {
        id: "fatigue",
        label: "Reason through failure",
        description:
          "Explain fatigue, stress concentrations and a suitable safety margin.",
        keywords: [
          "fatigue",
          "stress",
          "goodman",
          "soderberg",
          "endurance",
          "safety factor",
          "keyway",
        ],
        probe: "How would fluctuating loading affect your failure checks?",
        hint: "Fluctuating loads can cause fatigue below yield strength. Think about stress concentrations and a fatigue safety factor.",
      },
      {
        id: "material",
        label: "Evaluate trade-offs",
        description:
          "Justify material or geometry choices against cost and performance.",
        keywords: [
          "material",
          "steel",
          "alloy",
          "diameter",
          "cost",
          "weight",
          "manufactur",
        ],
        probe: "What material or geometry trade-off would guide your choice?",
        hint: "Compare strength, weight, cost and manufacturability; a larger diameter can lower stress but adds weight.",
      },
      {
        id: "validation",
        label: "Validate the solution",
        description:
          "Check deflection, critical speed, simulation or physical testing.",
        keywords: [
          "deflection",
          "critical speed",
          "test",
          "simulation",
          "fea",
          "validate",
          "prototype",
        ],
        probe:
          "How would you verify that the shaft performs safely in service?",
        hint: "Combine analytical checks with simulation or testing. Remember stiffness and critical speed as well as strength.",
      },
    ],
  },
  {
    id: "pump",
    topic: "Problem solving",
    title:
      "A centrifugal pump is vibrating and delivering less flow. How would you investigate?",
    context:
      "Describe a safe, structured diagnosis. Explain how you would separate possible causes and verify the fix.",
    rubric: [
      {
        id: "safety",
        label: "Establish a baseline",
        description:
          "Start with safe inspection and compare pressure, flow or vibration readings.",
        keywords: [
          "safety",
          "isolate",
          "lockout",
          "baseline",
          "pressure",
          "measurement",
          "flow",
        ],
        probe: "What would you check safely before changing the system?",
        hint: "Review operating data and isolate equipment safely before inspection.",
      },
      {
        id: "causes",
        label: "Form hypotheses",
        description:
          "Consider cavitation, misalignment, bearing wear or a blockage.",
        keywords: [
          "cavitation",
          "npsh",
          "alignment",
          "bearing",
          "blockage",
          "impeller",
          "suction",
        ],
        probe: "Which possible causes would you investigate, and why?",
        hint: "Cavitation, misalignment and worn bearings can all produce vibration. Suction conditions help distinguish them.",
      },
      {
        id: "diagnosis",
        label: "Test systematically",
        description:
          "Use measurements to distinguish hypotheses instead of changing everything.",
        keywords: [
          "spectrum",
          "frequency",
          "compare",
          "measure",
          "temperature",
          "inspect",
          "test",
        ],
        probe: "Which measurement would help you distinguish those causes?",
        hint: "Compare vibration spectra and operating pressures to the baseline; test one hypothesis at a time.",
      },
      {
        id: "verification",
        label: "Verify the result",
        description:
          "Confirm restored flow and reduced vibration, then monitor recurrence.",
        keywords: [
          "verify",
          "monitor",
          "retest",
          "restored",
          "trend",
          "confirm",
          "follow-up",
        ],
        probe: "How would you confirm the fix and prevent recurrence?",
        hint: "Repeat the original measurements and trend them under the same operating conditions.",
      },
    ],
  },
  {
    id: "project",
    topic: "Communication & ownership",
    title:
      "Tell me about an engineering project where you had to make a difficult trade-off.",
    context:
      "Use a specific example. Help me understand the situation, your own contribution, and what changed as a result.",
    rubric: [
      {
        id: "context",
        label: "Set the context",
        description: "Describe a concrete project, constraint and objective.",
        keywords: [
          "project",
          "deadline",
          "budget",
          "requirement",
          "constraint",
          "team",
        ],
        probe:
          "What was the project goal, and what made the decision difficult?",
        hint: "Give a brief situation and task: what you were trying to achieve and the main constraint.",
      },
      {
        id: "decision",
        label: "Explain your decision",
        description: "Compare alternatives and explain a reasoned choice.",
        keywords: [
          "alternative",
          "chose",
          "trade-off",
          "compare",
          "option",
          "decided",
          "because",
        ],
        probe:
          "What alternatives did you compare, and why did you choose that one?",
        hint: "Name at least two alternatives and explain the trade-off that mattered most.",
      },
      {
        id: "ownership",
        label: "Show ownership",
        description: "Separate your actions from the wider team effort.",
        keywords: [
          "i designed",
          "i built",
          "i led",
          "i tested",
          "i proposed",
          "i analysed",
          "i analyzed",
        ],
        probe: "What did you personally do to move the project forward?",
        hint: "Use “I” for your own actions and describe one concrete contribution.",
      },
      {
        id: "result",
        label: "Reflect on impact",
        description:
          "Describe the outcome, evidence of impact and a lesson learned.",
        keywords: [
          "result",
          "reduced",
          "improved",
          "learned",
          "saved",
          "achieved",
          "outcome",
        ],
        probe:
          "What was the outcome, and what would you do differently next time?",
        hint: "Share a measurable result if you have one, then one lesson you took into your next project.",
      },
    ],
  },
];
