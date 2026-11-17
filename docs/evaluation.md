# Evaluating interruption timing

The central research claim in the slides is an **unvalidated hypothesis**: better rubric-supported evidence per minute without unacceptable interruption harm. A functioning app and passing regression tests cannot establish that claim.

## Included executable regression

Run `npm run evaluate` (or `npm run evaluate -- path/to/traces.json`). It reads a JSON array with this shape:

```json
[
  {
    "id": "trace-001",
    "participantId": "participant-001",
    "duration": 45,
    "segments": [
      {
        "at": 5,
        "text": "A finalized candidate transcript chunk.",
        "confidence": 0.9
      }
    ],
    "controls": [{ "at": 10, "type": "think" }],
    "windows": [{ "start": 40, "end": 44, "actions": ["PROMPT"] }]
  }
]
```

Times are seconds from the start of question one. Use ordered, stable transcript chunks. `confidence: null` means unknown, not zero. An empty window list means there are no acceptable intervention windows for this trace. An annotation is an acceptable action/time window, not merely a pause. This first evaluator supports a single question, a 1-second time grid and thinking overrides; it does not import complete UI session exports or replay pause/hint/skip controls.

Three policies see the same fixed trace: no intervention; a single 20-second prompt; the adaptive controller with the local rules assessor. The evaluator matches predictions to windows one-to-one with the correct action. Duplicates and wrong actions are false positives; unmatched windows are false negatives. Precision/recall are null when undefined. Micro F1 aggregates counts across traces.

The six included traces are hand-authored **synthetic regression fixtures** built around the policy thresholds. Their labels were not independently collected. Perfect performance on these fixtures verifies intended behavior only. They must not be treated as held-out results or evidence of generalization. No counterfactual candidate response is simulated, so evidence efficiency is not compared across interventions.

## Research benchmark needed next

1. Record consented interviews with the same role, questions, rubric and total time budget. Preserve stable/interim ASR events, confidence, revisions and monotonic timestamps. Keep audio only with a defined purpose, consent and retention period.
2. Have independent annotators mark new rubric evidence, useful thinking, drift/repetition, acceptable intervention windows and suitable actions. Record disagreements and inter-rater agreement. Treat hinted answers as assisted.
3. Split by **participant**, not transcript chunk. Tune thresholds on a development split, lock them, and evaluate once on a held-out split. Keep the synthetic fixtures as separate regression tests.
4. Compare the five policies from the slides: no intervention, fixed timeout, post-answer LLM, turn-level adaptive and the proposed within-answer controller. The latter three need a common validated semantic assessor; the included evaluator implements only the first, second and a rules version of the fifth.
5. Report timing precision/recall/F1, false-interruption rate, missed opportunities, action calibration and end-to-end latency (p50/p95). Separately measure independent rubric evidence per minute, competency coverage and harmful interruptions. Browser/server clocks, stable-ASR delay and LLM latency must be included in the latency measurement.
6. Pilot a controlled live comparison. Counterbalance condition order, hold duration/questions constant and blind evidence raters to policy condition. Include a short candidate survey of fairness, satisfaction, perceived pressure and ability to override the coach.

The UI’s Helpful / Too soon feedback supports inspection; it is not a substitute for independent labels. The semantic assessor’s confidence is self-reported, not calibrated probability. Report subgroup performance and language/accent errors before using a speech confidence gate in a consequential context.
