# Cadence · Adaptive AI interview coach

A working speech-and-text prototype for **real-time candidate state modelling and adaptive interview interruption**, based on the supplied project presentation. The initial scope is one role (mechanical engineer), three interview questions and a four-area rubric per question.

The controller listens by default. It tracks new rubric evidence, repetition, topic drift, recognition uncertainty and a fixed time budget. It can offer a light prompt, redirect, probe a gap or invite the next question. It never diagnoses cognitive state from a pause.

## Run

Use Node.js 24 (see `.nvmrc`) and npm.

```sh
cd /workspace/realTimeInterruptionAI
npm ci --cache /tmp/cadence-npm-cache
npm run dev
```

Vite serves the app on port **5173** and proxies the API/WebSocket to port **3001**. Use the existing checkout; each cloud task is already isolated and does not need another Git worktree.

```sh
npm run build       # TypeScript checks and production frontend
npm start           # API + built frontend, served together on port 3001
npm test            # Policy and AI-adapter regression tests
npm run test:e2e    # Chromium: interview, feedback/export, 3 replays, mobile/navigation
npm run evaluate    # Synthetic timing regression against simple baselines
```

`npm run test:e2e` uses `/usr/bin/chromium`. Set `CHROMIUM_PATH` for another installed Chromium, or install the Playwright browser and adjust `playwright.config.ts` for your machine. No browser microphone is required by the tests.

## Try it

1. Open Live studio, choose a session duration and select **Let’s start practicing**.
2. Send one thought at a time in text mode, or select **Use microphone**, read the disclosure, consent and start the microphone. Only finalized speech results are assessed; interim recognition is displayed separately.
3. Explore a guided replay to see a drifting answer, a long pause and productive reasoning. These are explicitly labelled **synthetic**, at 4× speed; they are not saved candidate interviews.
4. Ask for **+30s to think** (protects thinking time without extending the fixed session budget), request a hint, pause, finish an answer or move to the next question. Transitions are invitations; the candidate remains in control until the hard session deadline.
5. Mark a coaching moment Helpful / Too soon. End the session to review supporting quotes, gaps, independent versus assisted signals and the intervention timeline. Export JSON before reloading or starting a new session.

Microphone input uses the browser Web Speech API. Chrome/Edge and HTTPS or localhost are generally required. Browser recognition may use a vendor speech service; this app does not capture/store raw audio. Where recognition confidence is absent, content interventions abstain. Text mode always works without a microphone. Optional coach speech uses browser speech synthesis and turns off recognition while speaking to avoid echo.

## Enable AI semantic assessment

The default is a **local keyword/rule baseline**, clearly labelled in the UI. It is useful for developing and demonstrating the timing controller, but does not understand arbitrary paraphrases or reliably assess technical correctness.

For semantic assessment, copy `.env.example` to `.env` and securely set `OPENAI_API_KEY` on the server. Both development and production servers load `.env` automatically. An exported environment variable takes precedence. The default model is `gpt-4.1-mini`; override `OPENAI_MODEL` with a compatible chat-completions model that supports JSON output. Restart the server after changes. No key is ever sent to the browser.

Allow outbound HTTPS to `api.openai.com` if your environment restricts networking. The health endpoint reports `assessor: "ai"` when a key is configured; this does **not** prove provider access. Verify an answer in the UI to test credentials, model access and connectivity. The live provider path was not tested without a credential; its request/response validation is covered with a mocked provider.

Each AI call receives the current question/rubric, existing evidence and up to eight recent finalized transcript chunks. Candidate input is isolated as data in the prompt. Output is schema-validated. Evidence must use a known criterion and an exact quote present in the candidate transcript. This validates attribution, not truth; technical judgments and quote relevance can still be wrong.

Calls are serialized and coalesced, with a four-second minimum gap, an eight-second timeout, a capped context, and a twenty-second retry backoff on failure. The controller never waits for an AI call to enforce the session deadline. Stale responses after new input, pause, question change or session end are discarded. On provider failure, content-based interventions abstain; the app does not silently substitute a different assessor.

## Timing policy

| Condition                                                                           | Response                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| New evidence or useful reasoning                                                    | Keep listening; protect recent progress                  |
| Unstable/interim transcript, low or unknown ASR confidence, low semantic confidence | Abstain from content judgments                           |
| Two confident stable updates showing drift/repetition, no recent progress           | Redirect after a natural pause                           |
| 18-second pause without recent progress                                             | Offer help or more thinking time; do not infer inability |
| Explicitly finish an incomplete answer                                              | Probe the first missing rubric area                      |
| Sufficient coverage or question time allocation reached                             | Invite a transition; candidate chooses when to move on   |
| Session time budget exhausted                                                       | End and show the review                                  |

Defaults: 12-second minimum answer time; 1.2-second quiet boundary; 14-second recent-progress grace; 20-second intervention cooldown; confidence gate 0.72; 30-second thinking override. Each silent interval gets at most one unsolicited support prompt. Explicit hint/finish requests bypass the automatic cooldown. These values are initial engineering choices, **not calibrated research findings**.

The same deterministic policy wraps either assessor. Hinted rubric areas are labelled assisted. The ledger counts at most one signal per criterion per question, rather than rewarding verbosity. Full session snapshots are sent when content changes; timer updates are small separate WebSocket messages.

## Structure

```text
src/                  React UI, speech recognition and voice controls
shared/questions.ts   Mechanical engineering questions, rubric, probes and hints
shared/types.ts       Shared session, evidence and event contracts
server/engine.ts      Pure timing policy and evidence ledger
server/assessor.ts    Local baseline / optional OpenAI semantic assessment
server/index.ts       Validated WebSocket protocol, live clock and HTTP server
server/demo.ts        Synthetic streaming examples
server/evaluate.ts    Annotated trace evaluator, independent of the live UI
tests/                Controller, provider adapter and browser regressions
```

## Evaluation and scope

The included synthetic traces are regression fixtures, not an independently annotated benchmark. `npm run evaluate` compares timing against no-intervention and fixed-timeout baselines; it cannot establish improved evidence efficiency, fairness, human preference, or statistical superiority. See `docs/evaluation.md` for the trace format and a human evaluation plan aligned with the slides.

The review’s “signals per minute” is a descriptive prototype count, including assisted signals, divided by elapsed session time (including coaching time). It is not a competency score. The app does not predict emotion, ability or employability from silence, voice or facial cues.

Sessions live only in the WebSocket connection’s memory. Closing/reloading the page or restarting the server loses server state. The browser keeps its last visible snapshot if disconnected so it can still be exported. There is no database, account system, session history, audio recording, multi-tenant authorization, resume-after-disconnect or production deployment included. Review feedback is self-reported and must not be presented as a human-labelled false-interruption rate. Before a public deployment, add authentication, explicit retention controls and measured ASR/LLM latency and reliability checks.
