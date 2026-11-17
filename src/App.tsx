import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Headphones,
  Info,
  Lightbulb,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Settings2,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import type { ClientMessage, Session } from "../shared/types";
import { questions } from "../shared/questions";
import { references } from "../shared/references";
import { RECOVERY_RUBRIC } from "../shared/trajectory";
import { useVoice, type CoachMessage, type VoiceTransport } from "./useVoice";
const formatTime = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
export default function App() {
  const [session, setSession] = useState<Session>();
  const [connected, setConnected] = useState(false),
    [assessor, setAssessor] = useState("rules"),
    [nativeAvailable, setNativeAvailable] = useState(false);
  const [transport, setTransport] = useState<VoiceTransport>("browser"),
    [budget, setBudget] = useState(600);
  const [starting, setStarting] = useState(false),
    [warning, setWarning] = useState(""),
    [input, setInput] = useState("");
  const [coachText, setCoachText] = useState(""),
    [drawer, setDrawer] = useState<"transcript" | "rubric" | "setup" | null>(
      null,
    );
  const [showText, setShowText] = useState(false);
  const ws = useRef<WebSocket | null>(null),
    state = useRef<Session | undefined>(undefined),
    selectedMode = useRef(false);
  const send = useCallback((event: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(event));
    else
      setWarning(
        "Coach connection lost. Export your session, then reload to reconnect.",
      );
  }, []);
  const voice = useVoice({
    onFinal: (text, confidence, questionIndex) => {
      if (text) send({ type: "segment", text, confidence, questionIndex });
    },
    onPreview: (text, questionIndex) =>
      send({ type: "preview", text, questionIndex }),
    onActivity: () => send({ type: "activity" }),
    onPlayback: (id, status, heardText, playbackMs) =>
      send({ type: "playback", id, status, heardText, playbackMs }),
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(() => {
    let disposed = false;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws.current = socket;
    socket.onopen = () => {
      if (!disposed) setConnected(true);
    };
    socket.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "hello") {
        setAssessor(event.assessor);
        setNativeAvailable(event.realtimeConfigured);
        if (!selectedMode.current && event.realtimeConfigured)
          setTransport("native");
      }
      if (event.type === "state") {
        state.current = event.session;
        setSession(event.session);
      }
      if (event.type === "clock")
        setSession((s) => {
          if (!s) return s;
          const next = { ...s, elapsed: event.elapsed };
          state.current = next;
          return next;
        });
      if (event.type === "coach") {
        setCoachText(event.text);
        voiceRef.current.say(event as CoachMessage);
      }
      if (event.type === "error" || event.type === "warning")
        setWarning(event.message);
    };
    socket.onclose = () => {
      if (!disposed) {
        setConnected(false);
        voiceRef.current.stop();
        setWarning(
          "Connection closed. Your last visible session can still be exported. Reload to reconnect.",
        );
      }
    };
    socket.onerror = () => {
      if (!disposed)
        setWarning(
          "Cannot connect to the interview server. Check that npm run dev is running.",
        );
    };
    return () => {
      disposed = true;
      voiceRef.current.stop();
      socket.close();
    };
  }, []);
  useEffect(() => {
    if (session?.status === "completed" || session?.status === "paused")
      voiceRef.current.stop();
  }, [session?.status]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const active = session?.status === "running",
    completed = session?.status === "completed";
  const question = questions[session?.questionIndex ?? 0],
    trajectory = session?.signals.trajectory;
  const decision = session?.decisions.at(-1);
  const timeline = session
    ? [
        ...session.coachTurns.map((turn) => ({
          kind: "coach" as const,
          data: turn,
        })),
        ...session.segments.map((segment) => ({
          kind: "user" as const,
          data: segment,
        })),
      ].sort((a, b) => a.data.sequence - b.data.sequence)
    : [];
  const start = async (mode = transport) => {
    if (starting || active) return;
    setStarting(true);
    setWarning("");
    setInput("");
    setCoachText("");
    setTransport(mode);
    setShowText(mode === "text");
    try {
      await voice.start(mode);
      send({ type: "start", budget });
      setDrawer(null);
    } catch {
      /* Voice hook provides the specific connection error. */
    } finally {
      setStarting(false);
    }
  };
  const end = () => {
    voice.stop();
    send({ type: "end" });
  };
  const submit = () => {
    if (!input.trim() || !active) return;
    send({
      type: "segment",
      text: input.trim(),
      confidence: 1,
      questionIndex: session.questionIndex,
    });
    setInput("");
  };
  const exportSession = () => {
    if (!session) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 2,
              exportedAt: new Date().toISOString(),
              transport,
              assessor,
              recoveryRubric: RECOVERY_RUBRIC,
              questions,
              references,
              session,
              note: "Recovery values are uncalibrated estimates, not measured probabilities. No raw audio is stored by this app.",
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cadence-${session.id.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const phaseLabel = !active
    ? completed
      ? "INTERVIEW COMPLETE"
      : "LIVE VOICE INTERVIEW"
    : voice.phase === "speaking"
      ? "CADENCE IS SPEAKING"
      : voice.phase === "connecting"
        ? "CONNECTING AUDIO"
        : voice.muted
          ? "MICROPHONE MUTED"
          : transport === "text"
            ? "TEXT PRACTICE"
            : "LISTENING TO YOUR THINKING";
  return (
    <div className="voice-app">
      <header className="app-header">
        <a className="wordmark" href="#" onClick={(e) => e.preventDefault()}>
          <span>
            <AudioLines size={21} />
          </span>
          cadence<span className="brand-dot">.</span>
        </a>
        <div className="header-center">
          <span className={`status-dot ${connected ? "" : "disconnected"}`} />
          {connected ? "Interview coach connected" : "Connecting to coach"}
        </div>
        <button
          className="header-button"
          onClick={() => setDrawer("setup")}
          aria-label="Voice settings"
        >
          <Settings2 size={17} />
          <span>Voice settings</span>
        </button>
      </header>
      <main className="voice-main">
        {(warning || voice.error) && (
          <div className="notification" role="alert">
            <Info size={17} />
            <span>{warning || voice.error}</span>
            <button
              onClick={() => {
                setWarning("");
                if (voice.error) setDrawer("setup");
              }}
              aria-label="Notification details"
            >
              <Settings2 size={15} />
            </button>
          </div>
        )}
        <div className="session-meta">
          <span>MECHANICAL ENGINEERING</span>
          <span className="meta-separator">/</span>
          <span>
            {active
              ? `${String(session.questionIndex + 1).padStart(2, "0")} OF 03 QUESTIONS`
              : "DESIGN · REASONING · OWNERSHIP"}
          </span>
          {active && (
            <span className="remaining">
              <Clock3 size={12} />
              {formatTime(session.budget - session.elapsed)}
            </span>
          )}
        </div>
        <section className={`conversation ${active ? "in-session" : ""}`}>
          <div className="question-heading">
            <div className="eyebrow">{phaseLabel}</div>
            <h1>
              {active ? (
                question.title
              ) : completed ? (
                "A little more practice. A little more confidence."
              ) : (
                <>
                  An interview that
                  <br />
                  <span>follows your thinking.</span>
                </>
              )}
            </h1>
            {!active && !completed && (
              <p>
                Talk naturally. Your coach listens, spots a wrong turn,
                <br className="desktop-break" /> and steps in when it’s time to
                help you move forward.
              </p>
            )}
            {active && <p>{question.context}</p>}
          </div>
          <button
            className={`voice-orb ${active ? voice.phase : ""}`}
            aria-label={
              voice.phase === "speaking"
                ? "Interrupt coach"
                : "Voice conversation status"
            }
            disabled={voice.phase !== "speaking"}
            onClick={voice.interruptCoach}
          >
            <span className="orb-aura" />
            <span className="orb-surface">
              <span className="orb-cloud cloud-one" />
              <span className="orb-cloud cloud-two" />
              <span className="orb-cloud cloud-three" />
              <AudioLines size={57} strokeWidth={1.1} />
            </span>
          </button>
          <div className="conversation-caption" aria-live="polite">
            {active ? (
              <>
                <span className="speaker-label">
                  {voice.interim ? "YOU" : "CADENCE"}
                </span>
                <p>
                  {voice.interim ||
                    coachText ||
                    "Take your time. I’m listening."}
                </p>
                {voice.phase === "speaking" && (
                  <button
                    className="interrupt-link"
                    onClick={voice.interruptCoach}
                  >
                    Tap to interrupt & speak
                  </button>
                )}
              </>
            ) : completed ? (
              <>
                <span className="speaker-label">YOUR SESSION</span>
                <p>
                  {session.completedReason} {session.evidence.length} rubric
                  signals captured across {session.questionIndex + 1} questions.
                </p>
                <div className="completion-actions">
                  <button
                    className="button secondary"
                    onClick={() => setDrawer("transcript")}
                  >
                    <FileText size={15} />
                    Review conversation
                  </button>
                  <button className="button secondary" onClick={exportSession}>
                    <ArrowDownToLine size={15} />
                    Export
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="caption-icon">
                  <Headphones size={15} />
                </span>
                <p>A live conversation. No record-and-submit steps.</p>
              </>
            )}
          </div>
          {!active && (
            <div className="start-area">
              <button
                className="button primary start-voice"
                disabled={
                  !connected ||
                  starting ||
                  (transport === "native" && !nativeAvailable)
                }
                onClick={() => void start()}
              >
                <AudioLines size={19} />
                {starting
                  ? "Connecting…"
                  : completed
                    ? "Start a new interview"
                    : "Start voice interview"}
                <ArrowRight size={16} />
              </button>
              <button
                className="text-link"
                disabled={!connected || starting}
                onClick={() => void start("text")}
              >
                Prefer typing? Try text practice
              </button>
              <p className="consent-note">
                Starting voice allows microphone processing by your selected
                speech provider.
                <br />
                Cadence does not save an audio recording.
              </p>
            </div>
          )}
        </section>
        {active && (
          <div className="live-controls-area">
            <div className="live-status">
              <span
                className={`status-dot ${voice.muted ? "disconnected" : ""}`}
              />
              <span>
                {transport === "text"
                  ? "Send each thought as you go"
                  : voice.phase === "speaking"
                    ? "You can interrupt the coach"
                    : voice.muted
                      ? "Unmute to continue"
                      : "Speak freely — no send button needed"}
              </span>
            </div>
            <div className="live-controls">
              <button
                className={`round-control ${voice.muted ? "muted" : ""}`}
                onClick={voice.toggleMute}
                disabled={transport === "text"}
                aria-label={
                  voice.muted ? "Unmute microphone" : "Mute microphone"
                }
              >
                {voice.muted ? <MicOff size={21} /> : <Mic size={21} />}
              </button>
              <button
                className={`round-control ${showText ? "selected" : ""}`}
                onClick={() => setShowText(!showText)}
                aria-label="Toggle text input"
              >
                <MessageSquare size={20} />
              </button>
              <button
                className="end-control"
                onClick={end}
                aria-label="End interview"
              >
                <PhoneOff size={22} />
              </button>
              <button
                className="round-control"
                onClick={() => setDrawer("transcript")}
                aria-label="Open transcript"
              >
                <FileText size={20} />
              </button>
              <button
                className="round-control"
                onClick={() => setDrawer("rubric")}
                aria-label="Open interruption rubric"
              >
                <Activity size={20} />
              </button>
            </div>
            <div className="secondary-controls">
              <button onClick={() => send({ type: "think" })}>
                <Clock3 size={13} />
                Give me a moment
              </button>
              <span>·</span>
              <button onClick={() => send({ type: "hint" })}>
                <Lightbulb size={13} />A small hint
              </button>
              <span>·</span>
              <button onClick={() => send({ type: "next" })}>
                Skip question
                <ArrowRight size={13} />
              </button>
            </div>
            {showText && (
              <div className="text-composer">
                <textarea
                  aria-label="Your answer"
                  placeholder="Type a thought, or say ‘I don’t know’ to move on…"
                  value={input}
                  maxLength={4000}
                  rows={2}
                  onChange={(e) => {
                    setInput(e.target.value);
                    send({ type: "activity" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <button
                  aria-label="Send answer"
                  onClick={submit}
                  disabled={!input.trim()}
                >
                  <Send size={18} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="transport-note">
          <ShieldCheck size={13} />
          <span>
            {transport === "native"
              ? "Native WebRTC audio · AEC requested · separate interruption controller"
              : transport === "browser"
                ? "Browser voice · automatic turn-taking · local prototype"
                : "Text practice · same interruption controller"}
          </span>
          <button onClick={() => setDrawer("rubric")}>
            {assessor === "ai"
              ? "AI semantic assessment"
              : "Limited local reference checks"}
            <Info size={12} />
          </button>
        </div>
        {!active && (
          <div className="principles">
            <div>
              <span>01</span>
              <strong>Listens through uncertainty</strong>
              <p>A plausible way back earns more time.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Interrupts with a reason</strong>
              <p>A clear error or sustained drift triggers action.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Moves the interview forward</strong>
              <p>“I don’t know” can be an honest next step.</p>
            </div>
          </div>
        )}
      </main>
      <footer className="app-footer">
        <span>LESS SCRIPT. MORE CONVERSATION.</span>
        <span>Listen. Understand. Intervene.</span>
        <button onClick={() => setDrawer("rubric")}>
          How the timing works
          <ArrowRight size={12} />
        </button>
      </footer>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <span className="eyebrow">BEHIND THE CONVERSATION</span>
                <h2 id="drawer-title">
                  {drawer === "setup"
                    ? "Voice settings"
                    : drawer === "rubric"
                      ? "The interruption rubric"
                      : "Your conversation"}
                </h2>
              </div>
              <button
                aria-label="Close panel"
                className="close-panel"
                onClick={() => setDrawer(null)}
              >
                <X size={19} />
              </button>
            </div>
            {drawer === "setup" && (
              <div className="settings-body">
                <p>
                  Choose your audio path. Native audio keeps input and output
                  streams open; browser voice is an automatic fallback.
                </p>
                <label
                  className={`transport-option ${transport === "native" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="transport"
                    checked={transport === "native"}
                    disabled={active}
                    onChange={() => {
                      selectedMode.current = true;
                      setTransport("native");
                    }}
                  />
                  <span>
                    <strong>
                      Native realtime audio <span className="tag">WebRTC</span>
                    </strong>
                    <small>
                      Speech-to-speech transport, echo cancellation, candidate
                      barge-in and playback cancellation.{" "}
                      {nativeAvailable
                        ? "Server key configured; provider access is verified on connection."
                        : "Requires OPENAI_API_KEY on the server."}
                    </small>
                  </span>
                </label>
                <label
                  className={`transport-option ${transport === "browser" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="transport"
                    checked={transport === "browser"}
                    disabled={active}
                    onChange={() => {
                      selectedMode.current = true;
                      setTransport("browser");
                    }}
                  />
                  <span>
                    <strong>
                      Browser voice <span className="tag">No API key</span>
                    </strong>
                    <small>
                      Automatically speaks and listens between turns. Uses
                      browser recognition and speech synthesis; this is not
                      native full duplex.
                    </small>
                  </span>
                </label>
                <label className="duration-setting">
                  <Clock3 size={16} />
                  Interview duration
                  <select
                    aria-label="Interview duration"
                    value={budget}
                    disabled={active}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  >
                    <option value={300}>5 minutes</option>
                    <option value={600}>10 minutes</option>
                    <option value={900}>15 minutes</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
                <div className="info-box">
                  <Info size={17} />
                  <p>
                    Native mode uses your browser’s interim speech monitor for
                    pre-end-of-turn judgments where supported. Provider
                    transcription alone may arrive after a turn. No measured
                    sub-250 ms latency or speaker identification is claimed.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={voice.resumeAudio}
                >
                  <Volume2 size={16} />
                  Resume native audio
                </button>
                <p className="small-print">
                  Chrome or Edge recommended. Use headphones to reduce acoustic
                  echo. No audio recordings are saved by this app; selected
                  providers process microphone audio. Live provider performance
                  depends on credentials, network and browser support.
                </p>
              </div>
            )}
            {drawer === "rubric" && (
              <div className="rubric-body">
                <p className="drawer-intro">
                  Estimate the chance that the current answer will return to
                  relevant, defensible reasoning within{" "}
                  {RECOVERY_RUBRIC.horizonSeconds} seconds without help.
                </p>
                <div className="probability-card">
                  <span>ESTIMATED RECOVERY</span>
                  <strong>
                    {trajectory
                      ? `${Math.round(trajectory.recoveryProbability * 100)}%`
                      : "—"}
                  </strong>
                  <small>
                    {trajectory
                      ? `${trajectory.basis === "heuristic" ? "Heuristic estimate" : "Model-informed estimate"} · ${trajectory.provisional ? "provisional speech" : "finalized chunk"}`
                      : "Speak an answer to see the current estimate."}
                  </small>
                  <div className="probability-track">
                    <i
                      style={{
                        width: `${(trajectory?.recoveryProbability ?? 0) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="uncalibrated">
                  <Info size={13} />
                  These are uncalibrated estimates, not measured probabilities
                  of ability.
                </p>
                <div className="threshold-row">
                  <span className="threshold-dot green" />
                  <div>
                    <strong>55–100% · Keep listening</strong>
                    <p>
                      Useful reasoning, a plausible connection, or
                      self-correction. Let the candidate finish the thought.
                    </p>
                  </div>
                </div>
                <div className="threshold-row">
                  <span className="threshold-dot amber" />
                  <div>
                    <strong>20–55% · Watch, then redirect</strong>
                    <p>
                      Wait for distinct content windows. Offer a route back when
                      drift persists.
                    </p>
                  </div>
                </div>
                <div className="threshold-row">
                  <span className="threshold-dot red" />
                  <div>
                    <strong>0–20% · Interrupt & move on</strong>
                    <p>
                      Requires sustained drift or a quote-backed technical error
                      and sufficient assessment confidence. An explicit skip
                      request acts immediately.
                    </p>
                  </div>
                </div>
                <h3>What influenced this estimate?</h3>
                {trajectory ? (
                  <ul className="factor-list">
                    {trajectory.factors.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    {trajectory.factors.length === 0 && (
                      <li>No decisive error or drift signal.</li>
                    )}
                  </ul>
                ) : (
                  <p className="small-print">
                    Relevance, correctness, repetition, progress, and signs of
                    recovery.
                  </p>
                )}
                {trajectory?.errorQuote && (
                  <blockquote>
                    “{trajectory.errorQuote}”
                    <small>{trajectory.correction}</small>
                  </blockquote>
                )}
                <h3>Question reference</h3>
                <ul className="reference-list">
                  {references[question.id].expected.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h3>Latest intervention</h3>
                <p className="small-print">
                  {decision?.reason || "No intervention yet."}
                </p>
                {decision && (
                  <div className="feedback-buttons">
                    <button
                      className={
                        decision.feedback === "helpful" ? "chosen" : ""
                      }
                      onClick={() =>
                        send({
                          type: "feedback",
                          id: decision.id,
                          value: "helpful",
                        })
                      }
                    >
                      Well timed
                    </button>
                    <button
                      className={decision.feedback === "early" ? "chosen" : ""}
                      onClick={() =>
                        send({
                          type: "feedback",
                          id: decision.id,
                          value: "early",
                        })
                      }
                    >
                      Too early
                    </button>
                  </div>
                )}
                <div className="info-box">
                  <ShieldCheck size={17} />
                  <p>
                    The local prototype catches only documented reference errors
                    and obvious conversational signals. Enable semantic AI to
                    evaluate a wider range of technical claims; it can still be
                    wrong.
                  </p>
                </div>
              </div>
            )}
            {drawer === "transcript" && (
              <div className="transcript-body">
                <div className="transcript-toolbar">
                  <span>
                    {session
                      ? `${formatTime(session.elapsed)} · ${session.evidence.length} rubric signals`
                      : "No session yet"}
                  </span>
                  <button disabled={!session} onClick={exportSession}>
                    <ArrowDownToLine size={14} />
                    Export JSON
                  </button>
                </div>
                {!session && (
                  <p className="drawer-intro">
                    Start an interview to see your conversation here.
                  </p>
                )}
                {timeline.map((entry) =>
                  entry.kind === "coach" ? (
                    <div className="chat-turn coach-turn" key={entry.data.id}>
                      <span>CADENCE · Q{entry.data.questionIndex + 1}</span>
                      <p>{entry.data.text}</p>
                      {entry.data.status === "interrupted" && (
                        <small>
                          Interrupted · {Math.round(entry.data.playbackMs)} ms
                          played.{" "}
                          {entry.data.heardText
                            ? `Heard prefix: “${entry.data.heardText}”`
                            : "Exact heard words unavailable; native context is truncated by audio time."}
                        </small>
                      )}
                    </div>
                  ) : (
                    <div className="chat-turn user-turn" key={entry.data.id}>
                      <span>
                        YOU · Q{entry.data.questionIndex + 1} ·{" "}
                        {formatTime(entry.data.at)}
                      </span>
                      <p>{entry.data.text}</p>
                    </div>
                  ),
                )}
                {session && (
                  <>
                    <h3>Evidence captured</h3>
                    {session.evidence.length === 0 && (
                      <p className="small-print">
                        No trusted rubric signals captured. An incomplete answer
                        is not a diagnosis of ability.
                      </p>
                    )}
                    {session.evidence.map((e) => (
                      <div
                        className="evidence-row"
                        key={`${e.questionIndex}-${e.criterionId}`}
                      >
                        <Check size={13} />
                        <p>
                          <strong>
                            {
                              questions[e.questionIndex].rubric.find(
                                (r) => r.id === e.criterionId,
                              )?.label
                            }
                          </strong>
                          <span>
                            {e.assisted ? "Assisted" : "Independent"} · Q
                            {e.questionIndex + 1}
                          </span>
                          <q>{e.quote}</q>
                        </p>
                      </div>
                    ))}
                  </>
                )}
                <p className="small-print retention-note">
                  Session data stays in memory. Export before reloading. Coach
                  text is the intended utterance; playback status distinguishes
                  spoken, interrupted and queued turns.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
