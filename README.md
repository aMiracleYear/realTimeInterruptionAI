# Cadence · Live interview voice

Cadence is a voice-first prototype for **model-initiated interview interruptions**: the interviewer can speak over an ongoing answer when there is a defensible reason to intervene. It also yields when the candidate asks for the floor. The initial role is mechanical engineering, with three questions and explicit references.

## Run locally

Node.js 24+ is required.

```sh
cd realTimeInterruptionAI
npm ci
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge. Keep the terminal running. The API is on port 3001. On a cloud machine, use the existing checkout; the task is already isolated and does not need a Git worktree.

Select **Start voice interview** once. The coach asks the question aloud and listens automatically; there is no recording/upload/send-audio workflow. You can mute, interrupt the coach, request time, ask for a hint, skip, or end. Text practice runs the same controller. Conversation and rubric panels hold the details; they do not dominate the voice screen.

Try these on the first question:

- **“I don't know.”** → acknowledge and automatically ask the next question.
- **“Fatigue is irrelevant to this design.”** → identify the reference-backed error, interrupt and move on.
- **“I don't know the dimensions, but I would calculate torque from the power and speed.”** → keep listening.
- **“Fatigue is irrelevant. Actually, that is wrong; I need to check fatigue.”** → allow self-correction.
- Two substantive, unrelated explanations without a connection back → interrupt once the recovery estimate is low.

## Audio modes

### Native realtime audio (recommended with credentials)

Copy `.env.example` to `.env` and set your server-side `OPENAI_API_KEY`. Restart `npm run dev`. Select **Native realtime audio** in Voice settings (it is selected automatically when a key is present).

```dotenv
OPENAI_API_KEY=your-key-set-locally
OPENAI_MODEL=gpt-4.1-mini
OPENAI_REALTIME_MODEL=gpt-realtime
PORT=3001
```

Never commit `.env` or paste a key into chat. `npm run dev` and `npm start` load `.env` automatically; already-exported environment values take precedence. A ChatGPT subscription is not an API credential; the API account needs appropriate model access and billing.

Native mode sends microphone audio over WebRTC and receives native generated speech. The server proxies the SDP exchange through `/api/realtime/connect`; the long-lived API key never reaches the browser. `echoCancellation`, noise suppression and gain control are requested from the browser. Provider server VAD locates speech; it does **not** decide semantic interventions. Autonomous response creation and automatic VAD barge-in are disabled so that the controller owns speaking decisions.

A browser interim speech monitor runs alongside native audio while the candidate has the floor. This supports **pre-end-of-turn** judgments where the browser supplies partial text. Native provider transcription is also consumed, but can arrive after an utterance; it alone does not guarantee mid-sentence detection. Finalized sidecar/provider chunks are deduplicated by source ownership, and the provider's audio item is tied to the question active when speech started.

On a controller intervention or a true candidate barge-in: cancel the response, mute local playback immediately, clear the provider output buffer, and truncate the assistant audio context at a conservative elapsed playback time. Short acknowledgments such as “yeah” or “uh-huh” do not automatically seize the floor. This is a simple text-based backchannel classifier, not speaker diarization or a trained acoustic intent model. Native input remains open during playback.

**Live provider audio, physical acoustic behavior and latency require credentialed device testing.** The included native tests use mocked WebRTC/provider events. Do not interpret a configured key, passing mocks or SDK compatibility as a successful live native call. The API contracts were checked against the official OpenAI Node SDK 7.57.0 types for `realtime/calls`, response cancellation, output-buffer clearing and conversation truncation.

Required network destinations: `api.openai.com` for SDP and semantic assessment, plus the provider's WebRTC media connectivity. Browser recognition can require its own vendor service. Corporate firewalls may prevent media even when HTTPS works.

### Browser voice (no API key)

The fallback automatically alternates browser recognition and speech synthesis. Recognition stops while coach audio is playing to avoid echo; tap the orb to interrupt the coach and resume listening. This is **not native full duplex**. Chrome/Edge, microphone permission and HTTPS or localhost are generally needed. Partial recognition can be revised, fail, or arrive late. The UI labels the active transport.

Without a key, the controller uses a narrow local reference checker. It detects explicit conversational intent, selected documented technical misconceptions, keyword relevance, repetition and recovery markers. **It cannot judge arbitrary wrong engineering answers.** Semantic AI widens the range of claims assessed, but can still be wrong. No recordings are saved by this app; audio is processed by the selected speech provider.

## Interruption policy

See [the full recovery rubric](docs/interruption-policy.md) for the equation, thresholds, abstention and calibration plan.

See the [multi-model voice architecture research](docs/multi-model-voice-architecture.md) for a proposed faster interruption controller, source comparisons, computational optimizations and a latency evaluation plan.

| Situation                                                            | Behavior                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Explicit “I don't know” / skip request                               | Immediately acknowledge and advance; no old 12-second minimum or cooldown     |
| Specific wrong claim + low recovery estimate + sufficient confidence | Interrupt, give a concise correction, and automatically ask the next question |
| Sustained drift with very low recovery estimate                      | Interrupt and move on, without waiting for silence                            |
| Moderate recovery estimate and persistent drift                      | Offer a targeted redirect                                                     |
| A plausible bridge, new progress or explicit self-correction         | Keep listening                                                                |
| Low-confidence recognition/judgment                                  | Abstain from a technical verdict                                              |
| Long silence                                                         | Offer support once; silence alone is never a wrong-answer verdict             |

The recovery value is a **versioned, uncalibrated estimate** of returning to relevant, defensible reasoning within 15 seconds. It is not a measured probability of the candidate's ability. Both UI and exports label this. A point estimate is not sufficient by itself: actionable content evidence and confidence are required.

Provisional text is held for 900 ms / a stable common prefix before analysis. Repeated identical partials do not count as distinct evidence. Provisional speech never earns competency credit. Decisions preserve their triggering trajectory, rationale and recovery estimate, even after the question changes. Exact skip intent and curated error checks run locally without queuing behind an external model request. Semantic calls are serialized/coalesced with a five-second timeout and stale-result guards; latency is not claimed to match a native model's audio-only latency.

Hints are marked assisted. Recognition with missing confidence can support a conservative conversation control (e.g. explicit skip), but does not earn trusted competency evidence. Known-low ASR confidence abstains. Provider failure leaves local conversational controls available and displays an error.

## Checks and production build

```sh
npm test             # Policy, reference checks, probability factors, provider adapters, cancellation
npm run test:e2e     # Browser UI, continuous voice (mocked), mid-answer partials, native transport (mocked), mobile
npm run evaluate     # Synthetic timing regression; not an independent research benchmark
npm run build        # TypeScript and production frontend
npm start            # Built UI + API, together on port 3001
```

Browser tests use `/usr/bin/chromium` by default. On a Mac, set `CHROMIUM_PATH` to your installed browser, for example:

```sh
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e
```

The repository does not contain API credentials or a deployed production service. Sessions are in memory and are lost when reloading/disconnecting. Export JSON before reloading or starting another interview. Intended coach text and actual playback status are separate; on native cancellation exact word-level playback alignment is unavailable, so context rollback uses audio time and does not claim exact heard words. There is no database, user authentication, speaker enrollment/diarization, custom acoustic VAD model, validated probability calibration, or demonstrated sub-250 ms end-to-end interruption latency.

See [the evaluation plan](docs/evaluation.md). A real benchmark and controlled study are necessary before claiming better evidence efficiency or “best” performance.
