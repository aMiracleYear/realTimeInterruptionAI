import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  FileText,
  Headphones,
  Lightbulb,
  Mic,
  MicOff,
  MoveUpRight,
  Pause,
  Play,
  Radio,
  Send,
  ShieldCheck,
  Square,
  Target,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import type { Action, ClientMessage, Demo, Session } from "../shared/types";
import { questions } from "../shared/questions";
import { useSpeech } from "./useSpeech";
const time = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const actionLabels: Record<Action, string> = {
  CONTINUE: "Listening",
  PROMPT: "A gentle nudge",
  REDIRECT: "Let’s refocus",
  PROBE: "Go a little deeper",
  NEXT: "Ready to move on",
};
type Page = "studio" | "review" | "approach";
export default function App() {
  const [page, setPage] = useState<Page>("studio");
  const [session, setSession] = useState<Session>();
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<"rules" | "ai">("rules");
  const [budget, setBudget] = useState(600);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [warning, setWarning] = useState("");
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [expanded, setExpanded] = useState<string>();
  const [showEnd, setShowEnd] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastSpoken = useRef("");
  const outputRef = useRef(voiceOutput);
  outputRef.current = voiceOutput;
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const send = useCallback((m: ClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setWarning(
        "Connection lost. Reconnect to start a new session. Export any captured work first.",
      );
      return;
    }
    socket.current.send(JSON.stringify(m));
  }, []);
  const speech = useSpeech(
    (text, confidence) => send({ type: "segment", text, confidence }),
    () => send({ type: "activity" }),
  );
  const speechRef = useRef(speech);
  speechRef.current = speech;
  useEffect(() => {
    let disposed = false;
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    socket.current = ws;
    ws.onopen = () => {
      if (!disposed) setConnected(true);
    };
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.type === "hello") setMode(m.assessor);
      if (m.type === "state") setSession(m.session);
      if (m.type === "clock")
        setSession((previous) =>
          previous ? { ...previous, elapsed: m.elapsed } : previous,
        );
      if (m.type === "warning" || m.type === "error") setWarning(m.message);
    };
    ws.onclose = () => {
      if (!disposed) {
        setConnected(false);
        speechRef.current.stop();
        setWarning(
          "Connection closed. Your captured session is still available to export. Reload to reconnect; sessions are not stored on the server.",
        );
      }
    };
    ws.onerror = () => {
      if (!disposed)
        setWarning(
          "Cannot reach the coach service. Check that the API server is running.",
        );
    };
    return () => {
      disposed = true;
      ws.close();
    };
  }, []);
  const running = session?.status === "running";
  const active = running || session?.status === "paused";
  const q = questions[session?.questionIndex ?? 0];
  const currentEvidence =
    session?.evidence.filter(
      (e) => e.questionIndex === session.questionIndex,
    ) ?? [];
  const latestDecision = session?.decisions
    .filter((d) => d.questionIndex === session.questionIndex)
    .at(-1);
  const recentDecision =
    latestDecision && session && session.elapsed - latestDecision.at < 16
      ? latestDecision
      : undefined;
  const protectedTime = Math.ceil(
    (session?.protectedUntil ?? 0) - (session?.elapsed ?? 0),
  );
  useEffect(() => {
    if (!running || session?.awaitingNext || page !== "studio")
      speechRef.current.stop();
  }, [running, session?.status, session?.awaitingNext, page]);
  useEffect(() => {
    if (session?.status === "completed") {
      window.speechSynthesis?.cancel();
      setPage("review");
    }
  }, [session?.status]);
  useEffect(() => {
    if (!session || !running || !outputRef.current || session.demo) return;
    const decision = session.decisions
      .filter((d) => d.questionIndex === session.questionIndex)
      .at(-1);
    const key = decision
      ? decision.id
      : `${session.id}-q${session.questionIndex}`;
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    if (!("speechSynthesis" in window)) return;
    // Stop recognition before synthesis to keep the coach out of the candidate transcript.
    const resume = speechRef.current.listening;
    speechRef.current.stop();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      decision?.questionIndex === session.questionIndex
        ? decision.message
        : q.title,
    );
    utterance.rate = 0.98;
    utterance.onend = () => {
      if (
        resume &&
        sessionRef.current?.status === "running" &&
        !sessionRef.current.awaitingNext
      )
        speechRef.current.start();
    };
    window.speechSynthesis.speak(utterance);
  }, [
    session?.decisions.length,
    session?.questionIndex,
    session?.id,
    running,
    q.title,
  ]);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [session?.segments.length, speech.interim]);
  const start = (demo?: Demo) => {
    speech.stop();
    window.speechSynthesis?.cancel();
    setWarning("");
    setInput("");
    setTab("transcript");
    setPage("studio");
    lastSpoken.current = "";
    send({ type: "start", budget, ...(demo ? { demo } : {}) });
  };
  const submit = () => {
    if (!input.trim() || !running || session?.awaitingNext) return;
    send({ type: "segment", text: input.trim(), confidence: 1 });
    setInput("");
  };
  const stopAudio = () => {
    speech.stop();
    window.speechSynthesis?.cancel();
  };
  const download = () => {
    if (!session) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            assessor: mode,
            questions,
            session,
            note: "Prototype rubric signals, not validated competency or hiring scores. Replay runs are synthetic.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cadence-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const evidenceCount = session?.evidence.length ?? 0;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("studio");
          }}
          aria-label="Cadence home"
        >
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          cadence<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          {(
            [
              ["studio", "Live studio"],
              ["review", "Session review"],
              ["approach", "Our approach"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={page === id ? "nav-active" : ""}
              onClick={() => setPage(id)}
            >
              {label}
              {id === "studio" && active && <span className="tiny-dot" />}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className={`connection ${connected ? "" : "offline"}`}>
            <i />
            {connected ? "Coach connected" : "Connecting"}
          </span>
          <span className="avatar">You</span>
        </div>
      </header>
      <main>
        {warning && (
          <div className="notice" role="alert">
            <CircleHelp size={18} />
            <span>{warning}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setWarning("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {page === "studio" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> YOUR SPACE TO GET BETTER
                </div>
                <h1>Find your interview rhythm.</h1>
                <p>
                  Thoughtful practice. Timely guidance. A more confident you.
                </p>
              </div>
              <div className="heading-detail">
                <ShieldCheck size={17} />
                <span>Built to listen first.</span>
              </div>
            </div>
            <div className="session-bar">
              <div>
                <span className="small-icon">
                  <Target size={18} />
                </span>
                <strong>Mechanical engineer</strong>
                <span className="bar-divider" />
                <span>3 questions</span>
                <span className="desktop-only">·</span>
                <span className="desktop-only">
                  Design, problem solving & ownership
                </span>
              </div>
              <label className="duration">
                <Clock3 size={15} />
                <select
                  aria-label="Session duration"
                  value={budget}
                  disabled={active}
                  onChange={(e) => setBudget(Number(e.target.value))}
                >
                  <option value={300}>5 minute session</option>
                  <option value={600}>10 minute session</option>
                  <option value={900}>15 minute session</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
            {session?.demo && active && (
              <div className="demo-banner">
                <Play size={15} /> Guided replay ·{" "}
                {session.demo === "drift"
                  ? "Off-topic drift"
                  : session.demo === "pause"
                    ? "A long pause"
                    : "Productive reasoning"}
                <span>
                  Synthetic answer · 4× speed ·{" "}
                  {mode === "rules" ? "rules baseline" : "AI assessor"}
                </span>
              </div>
            )}
            <div className="studio-grid">
              <div className="main-column">
                <section className="question-card">
                  <div className="question-meta">
                    <span>
                      QUESTION{" "}
                      {String((session?.questionIndex ?? 0) + 1).padStart(
                        2,
                        "0",
                      )}{" "}
                      <span className="muted">/ 03</span>
                    </span>
                    <span className="topic-pill">{q.topic}</span>
                  </div>
                  <h2>{q.title}</h2>
                  <p>{q.context}</p>
                </section>
                <section
                  className={`coach-stage ${active ? "is-active" : ""} ${speech.listening ? "is-listening" : ""} ${recentDecision?.action === "REDIRECT" ? "is-redirect" : ""}`}
                  aria-label="Interview coach"
                >
                  <div className="stage-top">
                    <span className="stage-label">
                      <span className="tiny-dot" />
                      {active
                        ? session?.status === "paused"
                          ? "SESSION PAUSED"
                          : "ADAPTIVE COACH"
                        : "MEET YOUR PRACTICE PARTNER"}
                    </span>
                    <button
                      className={`icon-button ${voiceOutput ? "selected" : ""}`}
                      aria-label={
                        voiceOutput ? "Mute coach voice" : "Enable coach voice"
                      }
                      title="Coach voice"
                      onClick={() => {
                        setVoiceOutput(!voiceOutput);
                        if (voiceOutput) window.speechSynthesis?.cancel();
                      }}
                    >
                      {voiceOutput ? (
                        <Volume2 size={18} />
                      ) : (
                        <VolumeX size={18} />
                      )}
                    </button>
                  </div>
                  <div className="coach-content">
                    <div className="orb-wrap">
                      <div className="orb-ring ring-one" />
                      <div className="orb-ring ring-two" />
                      <div className="coach-orb">
                        <AudioLines size={49} strokeWidth={1.2} />
                      </div>
                      <span className="orb-spark spark-one" />
                      <span className="orb-spark spark-two" />
                    </div>
                    <span
                      className={`coach-state ${recentDecision?.action === "REDIRECT" ? "amber" : ""}`}
                    >
                      <span className="tiny-dot" />
                      {!active
                        ? "A LITTLE GUIDANCE. A LOT OF GROWTH."
                        : session?.status === "paused"
                          ? "TAKE A BREATHER"
                          : protectedTime > 0
                            ? `THINKING SPACE · ${protectedTime}s`
                            : recentDecision
                              ? actionLabels[
                                  recentDecision.action
                                ].toUpperCase()
                              : speech.listening
                                ? "LISTENING TO YOU"
                                : "READY WHEN YOU ARE"}
                    </span>
                    <h3 aria-live="polite">
                      {!active
                        ? "Good answers start with a little space."
                        : session?.status === "paused"
                          ? "We’ll be right here."
                          : protectedTime > 0
                            ? "Take your time. You have room to think."
                            : recentDecision
                              ? recentDecision.message
                              : "I’m listening. Walk me through your thinking."}
                    </h3>
                    <p>
                      {!active
                        ? "Think out loud. Explore your ideas. Your coach will help you find your way back when you need it."
                        : session?.status === "paused"
                          ? "Your timer is paused. Resume whenever you’re ready."
                          : session?.insight}
                    </p>
                    {!active && (
                      <button
                        className="button primary start-button"
                        disabled={!connected}
                        onClick={() => start()}
                      >
                        Let’s start practicing <ArrowRight size={17} />
                      </button>
                    )}
                    {active && recentDecision && protectedTime <= 0 && (
                      <div className="feedback">
                        <span>Was that well timed?</span>
                        <button
                          className={
                            recentDecision.feedback === "helpful"
                              ? "chosen"
                              : ""
                          }
                          onClick={() =>
                            send({
                              type: "feedback",
                              id: recentDecision.id,
                              value: "helpful",
                            })
                          }
                        >
                          Helpful
                        </button>
                        <button
                          className={
                            recentDecision.feedback === "early" ? "chosen" : ""
                          }
                          onClick={() =>
                            send({
                              type: "feedback",
                              id: recentDecision.id,
                              value: "early",
                            })
                          }
                        >
                          Too soon
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="stage-bottom">
                    <span>
                      <Headphones size={15} />
                      {!active
                        ? "A conversation, not a countdown."
                        : session?.demo
                          ? "Watch how the coach responds to this answer."
                          : "No rush. A pause is part of the process."}
                    </span>
                    <span className="mode-label">
                      {mode === "ai"
                        ? "AI semantic assessor"
                        : "Local rules baseline"}
                    </span>
                  </div>
                </section>
                <section className="transcript-card">
                  <div className="transcript-header">
                    <div className="tabs">
                      <button
                        className={tab === "transcript" ? "active" : ""}
                        onClick={() => setTab("transcript")}
                      >
                        <FileText size={16} />
                        Live transcript
                        {running && <span className="tiny-dot" />}
                      </button>
                      <button
                        className={tab === "notes" ? "active" : ""}
                        onClick={() => setTab("notes")}
                      >
                        Coach notes{" "}
                        <span className="count">
                          {session?.decisions.length ?? 0}
                        </span>
                      </button>
                    </div>
                    <span className="caption">
                      {session?.demo
                        ? "Sample transcript"
                        : "Only finalized text is assessed"}
                    </span>
                  </div>
                  <div className="transcript-scroll" aria-live="polite">
                    {tab === "transcript" ? (
                      <>
                        {!session?.segments.length && (
                          <div className="empty-transcript">
                            <span>
                              <AudioLines size={19} />
                            </span>
                            <p>
                              Your thoughts go here.
                              <small>
                                Start a session, then speak or type an answer.
                              </small>
                            </p>
                          </div>
                        )}
                        {session?.segments.map((seg) => (
                          <div className="transcript-line" key={seg.id}>
                            <span className="transcript-avatar">Y</span>
                            <div>
                              <div className="transcript-byline">
                                <strong>You</strong>
                                <time>{time(seg.at)}</time>
                                <span>Q{seg.questionIndex + 1}</span>
                                {seg.confidence === null && (
                                  <span>Confidence unavailable</span>
                                )}
                              </div>
                              <p>{seg.text}</p>
                            </div>
                          </div>
                        ))}
                        {speech.interim && (
                          <div className="interim">
                            {speech.interim}
                            <span className="blinking"> ▍</span>
                          </div>
                        )}
                        <div ref={transcriptEnd} />
                      </>
                    ) : (
                      <>
                        {!session?.decisions.length && (
                          <div className="empty-transcript">
                            <span>
                              <Lightbulb size={19} />
                            </span>
                            <p>
                              Help when it matters.
                              <small>
                                Prompts and their reasons will appear here.
                              </small>
                            </p>
                          </div>
                        )}
                        {session?.decisions.map((d) => (
                          <div key={d.id} className="note-row">
                            <span
                              className={`action-dot action-${d.action.toLowerCase()}`}
                            />
                            <div>
                              <strong>
                                {actionLabels[d.action]}{" "}
                                <time>{time(d.at)}</time>
                              </strong>
                              <p>{d.message}</p>
                              <small>{d.reason}</small>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="input-area">
                    <div className="input-mode">
                      <button
                        className={inputMode === "text" ? "active" : ""}
                        onClick={() => {
                          stopAudio();
                          setInputMode("text");
                        }}
                      >
                        <FileText size={13} />
                        Type answer
                      </button>
                      <button
                        className={inputMode === "voice" ? "active" : ""}
                        onClick={() => setInputMode("voice")}
                      >
                        <Mic size={13} />
                        Use microphone
                      </button>
                      <span>
                        {inputMode === "text"
                          ? "Shift + Enter for a new line"
                          : "Chrome / Edge recommended"}
                      </span>
                    </div>
                    {inputMode === "text" ? (
                      <div className="composer">
                        <textarea
                          aria-label="Your answer"
                          placeholder={
                            active
                              ? "Think out loud, one thought at a time…"
                              : "Start your session to begin…"
                          }
                          rows={2}
                          maxLength={4000}
                          value={input}
                          disabled={
                            !running ||
                            Boolean(session?.demo) ||
                            session?.awaitingNext
                          }
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
                          className="send-button"
                          onClick={submit}
                          disabled={
                            !running || !input.trim() || session?.awaitingNext
                          }
                        >
                          <Send size={18} />
                        </button>
                      </div>
                    ) : (
                      <div className="voice-area">
                        {!voiceConsent ? (
                          <>
                            <p>
                              Your browser’s speech service may process audio.
                              Only finalized text is sent to this app
                              {mode === "ai" ? " and the AI provider" : ""};
                              audio is not stored by Cadence.
                            </p>
                            <button
                              className="button secondary"
                              onClick={() => setVoiceConsent(true)}
                            >
                              I agree to use browser speech recognition
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className={`button ${speech.listening ? "recording" : "secondary"}`}
                              disabled={
                                !running ||
                                Boolean(session?.demo) ||
                                session?.awaitingNext ||
                                !speech.supported
                              }
                              onClick={() =>
                                speech.listening
                                  ? speech.stop()
                                  : speech.start()
                              }
                            >
                              {speech.listening ? (
                                <MicOff size={16} />
                              ) : (
                                <Mic size={16} />
                              )}
                              {speech.listening
                                ? "Stop microphone"
                                : "Start microphone"}
                            </button>
                            <span>
                              {speech.listening
                                ? "Microphone on · speak naturally"
                                : speech.supported
                                  ? "Microphone is off"
                                  : "Speech recognition unavailable. Use text mode."}
                            </span>
                          </>
                        )}
                        {speech.error && (
                          <p className="error-text" role="alert">
                            {speech.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>
                {active && (
                  <div className="session-controls">
                    {recentDecision && protectedTime <= 0 && (
                      <div className="control-alert" role="status">
                        <Lightbulb size={16} />
                        <p>
                          <strong>{actionLabels[recentDecision.action]}</strong>
                          {recentDecision.message}
                        </p>
                      </div>
                    )}
                    <div className="timer">
                      <Clock3 size={17} />
                      <strong>
                        {time(
                          (session?.budget ?? budget) - (session?.elapsed ?? 0),
                        )}
                      </strong>
                      <span>remaining</span>
                    </div>
                    <div className="control-buttons">
                      <button
                        className="button plain"
                        onClick={() => {
                          stopAudio();
                          send({ type: running ? "pause" : "resume" });
                        }}
                      >
                        {running ? <Pause size={15} /> : <Play size={15} />}
                        {running ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="button plain"
                        onClick={() => setShowEnd(true)}
                      >
                        <Square size={13} />
                        End
                      </button>
                      <button
                        className="button secondary"
                        disabled={!running || Boolean(session?.demo)}
                        onClick={() => {
                          speech.stop();
                          send({ type: "finish" });
                        }}
                      >
                        Finish answer <Check size={15} />
                      </button>
                      <button
                        className="button primary"
                        disabled={!running}
                        onClick={() => {
                          stopAudio();
                          setInput("");
                          send({ type: "next" });
                        }}
                      >
                        {session?.questionIndex === 2
                          ? "Complete"
                          : "Next question"}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <aside className="side-column">
                <section className="evidence-card">
                  <div className="card-title">
                    <span className="small-icon">
                      <CheckCheck size={19} />
                    </span>
                    <h3>Your answer, taking shape</h3>
                  </div>
                  <p className="card-description">
                    Useful evidence, one idea at a time.
                  </p>
                  <div className="coverage-meta">
                    <span>QUESTION COVERAGE</span>
                    <strong>
                      {currentEvidence.length}
                      <span> / {q.rubric.length}</span>
                    </strong>
                  </div>
                  <div className="coverage-bars">
                    {q.rubric.map((r) => (
                      <span
                        key={r.id}
                        className={
                          currentEvidence.some((e) => e.criterionId === r.id)
                            ? "filled"
                            : ""
                        }
                      />
                    ))}
                  </div>
                  <div className="rubric-list">
                    {q.rubric.map((r, i) => {
                      const e = currentEvidence.find(
                        (e) => e.criterionId === r.id,
                      );
                      return (
                        <div
                          className={`rubric-item ${e ? "has-evidence" : ""}`}
                          key={r.id}
                        >
                          <button
                            aria-expanded={expanded === r.id}
                            onClick={() =>
                              setExpanded(expanded === r.id ? undefined : r.id)
                            }
                          >
                            <span className="rubric-number">
                              {e ? <Check size={13} /> : `0${i + 1}`}
                            </span>
                            <span>
                              <strong>{r.label}</strong>
                              <small>
                                {e
                                  ? e.assisted
                                    ? "Assisted signal"
                                    : "Evidence captured"
                                  : "Listening for evidence"}
                              </small>
                            </span>
                            <ChevronRight
                              size={15}
                              className={expanded === r.id ? "rotated" : ""}
                            />
                          </button>
                          {expanded === r.id && (
                            <div className="rubric-detail">
                              <p>{r.description}</p>
                              {e && <blockquote>“{e.quote}”</blockquote>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="evidence-footnote">
                    <ShieldCheck size={14} />
                    <span>
                      {mode === "rules"
                        ? "Keyword-based signals, not validated scores."
                        : "Quote-backed AI signals, not hiring scores."}
                    </span>
                  </div>
                </section>
                <section className="thinking-card">
                  <div className="thinking-icon">
                    <Coffee size={22} />
                  </div>
                  <h3>A little space to think.</h3>
                  <p>
                    A thoughtful pause is a good thing. Ask for more time or a
                    small nudge.
                  </p>
                  <div>
                    <button
                      className="button secondary"
                      disabled={!running || session?.awaitingNext}
                      onClick={() => send({ type: "think" })}
                    >
                      <Clock3 size={14} />
                      +30s to think
                    </button>
                    <button
                      className="hint-button"
                      disabled={!running || session?.awaitingNext}
                      onClick={() => send({ type: "hint" })}
                    >
                      Give me a hint
                      <Lightbulb size={14} />
                    </button>
                  </div>
                  <small>
                    Hints are labelled. Your session timer stays fixed.
                  </small>
                </section>
                <section className="replay-card">
                  <div className="replay-heading">
                    <span>
                      <Play size={13} />
                    </span>
                    <h3>See the timing in action</h3>
                    <span className="mini-pill">DEMO</span>
                  </div>
                  <p>Three sample answers. Three different rhythms.</p>
                  {(
                    [
                      [
                        "drift",
                        "An answer goes off track",
                        "Watch a gentle redirect",
                      ],
                      [
                        "pause",
                        "A longer moment of silence",
                        "See support without pressure",
                      ],
                      [
                        "thinking",
                        "Good thinking takes time",
                        "See when the coach stays quiet",
                      ],
                    ] as const
                  ).map(([id, title, detail]) => (
                    <button
                      key={id}
                      disabled={active || !connected}
                      className="replay-option"
                      onClick={() => start(id)}
                    >
                      <span className="replay-play">
                        <Play size={12} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </section>
              </aside>
            </div>
            <div className="studio-foot">
              <Waves size={16} />
              <span>
                The best coach knows when to speak — and when to let you find
                the words.
              </span>
              <span>Listen. Understand. Guide.</span>
            </div>
          </>
        )}
        {page === "review" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> REFLECT. RESET. KEEP GROWING.
                </div>
                <h1>Your practice, in perspective.</h1>
                <p>
                  Look at the evidence behind your answer, not just how long you
                  spoke.
                </p>
              </div>
              {session && (
                <button className="button secondary" onClick={download}>
                  <ArrowDownToLine size={16} />
                  Export session
                </button>
              )}
            </div>
            {!session ? (
              <section className="review-empty">
                <div className="empty-review-icon">
                  <FileText size={34} />
                </div>
                <h2>Your next step starts with one answer.</h2>
                <p>
                  Complete a practice session or explore a guided replay to see
                  your evidence, coaching moments, and areas to revisit.
                </p>
                <button
                  className="button primary"
                  onClick={() => setPage("studio")}
                >
                  Go to live studio <ArrowRight size={16} />
                </button>
              </section>
            ) : (
              <>
                <div className="review-status">
                  <span className="tiny-dot" />
                  {session.status === "completed"
                    ? session.completedReason
                    : "Session in progress — this is a live snapshot."}
                  {session.demo && (
                    <span className="mini-pill">SYNTHETIC REPLAY</span>
                  )}
                  <span>
                    {mode === "rules"
                      ? "Rules baseline"
                      : "AI semantic assessor"}{" "}
                    · {time(session.elapsed)} elapsed
                  </span>
                </div>
                <div className="metrics-grid">
                  {[
                    [
                      `${evidenceCount}/${questions.length * 4}`,
                      "Rubric signals",
                      "Across all three questions",
                    ],
                    [
                      String(
                        session.evidence.filter((e) => !e.assisted).length,
                      ),
                      "Independent signals",
                      "Before hints for that rubric area",
                    ],
                    [
                      String(session.decisions.length),
                      "Coaching moments",
                      `${session.decisions.filter((d) => d.feedback === "early").length} marked “too soon”`,
                    ],
                    [
                      session.elapsed >= 1
                        ? (evidenceCount / (session.elapsed / 60)).toFixed(1)
                        : "—",
                      "Signals per minute",
                      "Exploratory, not a validated measure",
                    ],
                  ].map(([value, label, detail]) => (
                    <section className="metric-card" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{detail}</small>
                    </section>
                  ))}
                </div>
                <div className="review-grid">
                  <section className="review-card">
                    <div className="section-heading">
                      <h2>Your evidence ledger</h2>
                      <span className="caption">
                        Click an area to read the supporting quote
                      </span>
                    </div>
                    {questions.map((question, index) => (
                      <div className="review-question" key={question.id}>
                        <div className="review-question-title">
                          <span>0{index + 1}</span>
                          <div>
                            <strong>{question.topic}</strong>
                            <p>{question.title}</p>
                          </div>
                        </div>
                        {question.rubric.map((r) => {
                          const e = session.evidence.find(
                            (e) =>
                              e.questionIndex === index &&
                              e.criterionId === r.id,
                          );
                          return (
                            <details key={r.id}>
                              <summary>
                                <span
                                  className={`ledger-check ${e ? "filled" : ""}`}
                                >
                                  {e ? <Check size={12} /> : "–"}
                                </span>
                                <span>{r.label}</span>
                                <small>
                                  {e
                                    ? e.assisted
                                      ? "Assisted"
                                      : "Independent"
                                    : "No signal captured"}
                                </small>
                                <ChevronDown size={13} />
                              </summary>
                              <p>{e ? `“${e.quote}”` : r.description}</p>
                            </details>
                          );
                        })}
                      </div>
                    ))}
                  </section>
                  <div className="review-side">
                    <section className="review-card">
                      <div className="section-heading">
                        <h2>Coaching timeline</h2>
                        <Clock3 size={17} />
                      </div>
                      {session.decisions.length === 0 ? (
                        <p className="card-description">
                          No interruptions so far. Listening is a decision, too.
                        </p>
                      ) : (
                        session.decisions.map((d) => (
                          <div key={d.id} className="timeline-item">
                            <span className="timeline-time">{time(d.at)}</span>
                            <div>
                              <strong>{actionLabels[d.action]}</strong>
                              <p>{d.reason}</p>
                              <div className="timeline-feedback">
                                <button
                                  className={
                                    d.feedback === "helpful" ? "chosen" : ""
                                  }
                                  onClick={() =>
                                    send({
                                      type: "feedback",
                                      id: d.id,
                                      value: "helpful",
                                    })
                                  }
                                >
                                  Helpful
                                </button>
                                <button
                                  className={
                                    d.feedback === "early" ? "chosen" : ""
                                  }
                                  onClick={() =>
                                    send({
                                      type: "feedback",
                                      id: d.id,
                                      value: "early",
                                    })
                                  }
                                >
                                  Too soon
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                    <section className="review-tip">
                      <Lightbulb size={22} />
                      <h3>Something to try next time</h3>
                      <p>
                        {session.evidence.length
                          ? "Build each answer around your approach, a reasoned choice, and how you would verify the result. Use one concrete example for each."
                          : "Start with what you know. Explain one concrete step and why it matters, then build your answer from there."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => setPage("studio")}
                      >
                        {active ? "Return to your session" : "Back to studio"}
                        <ArrowRight size={16} />
                      </button>
                    </section>
                    <p className="privacy-note">
                      <ShieldCheck size={15} />
                      This session lives in memory. Export it before reloading.
                      No audio is stored by this app. Signals may be inaccurate;
                      review the quotes.
                    </p>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {page === "approach" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> THE THOUGHT BEHIND THE TIMING
                </div>
                <h1>More listening. Better questions.</h1>
                <p>A coach that follows your reasoning, not just the clock.</p>
              </div>
            </div>
            <section className="approach-hero">
              <div>
                <span className="topic-pill">OUR GUIDING PRINCIPLE</span>
                <h2>
                  A pause is not proof
                  <br />
                  that you’re stuck.
                </h2>
                <p>
                  Cadence follows the problem in your project slides: collect
                  useful competency evidence within a fixed interview budget,
                  while minimizing unnecessary interruptions.
                </p>
              </div>
              <div className="approach-orb">
                <AudioLines size={88} strokeWidth={1} />
              </div>
            </section>
            <div className="principles-grid">
              {[
                [
                  Headphones,
                  "01",
                  "Listen by default",
                  "Finalized transcript chunks are assessed against a small, explicit question rubric. New evidence and productive reasoning protect thinking time.",
                ],
                [
                  Target,
                  "02",
                  "Intervene proportionately",
                  "Sustained drift can trigger a redirect. A long pause earns an offer of support. A targeted probe fills a gap; sufficient coverage invites the next question.",
                ],
                [
                  ShieldCheck,
                  "03",
                  "Leave you in control",
                  "Minimum answer time, confidence gates, a natural pause, and a 20-second cooldown limit interruptions. Request thinking space, pause, skip, or mark coaching as too early.",
                ],
              ].map(([Icon, number, title, text]) => {
                const I = Icon as typeof Headphones;
                return (
                  <section className="principle-card" key={String(number)}>
                    <div>
                      <I size={23} />
                      <span>{String(number)}</span>
                    </div>
                    <h3>{String(title)}</h3>
                    <p>{String(text)}</p>
                  </section>
                );
              })}
            </div>
            <div className="approach-details">
              <section className="review-card">
                <h2>A small, transparent first step</h2>
                <p>
                  The local baseline matches engineering terms and simple
                  explanation patterns. It can confuse keyword overlap with
                  genuine understanding, and miss good paraphrases. Its signals
                  are demonstrations, not validated competency assessments.
                </p>
                <p>
                  With a server-side API key, an AI assessor evaluates
                  relevance, repetition, productive reasoning, and quote-backed
                  evidence. The same explicit timing policy controls
                  interventions. Candidate answers are treated as data, never
                  instructions.
                </p>
                <span className="tech-pill">
                  <Radio size={14} />
                  Your current mode:{" "}
                  {mode === "ai"
                    ? "AI semantic assessor"
                    : "local rules baseline"}
                </span>
              </section>
              <section className="review-card">
                <h2>Efficiency is a hypothesis to test</h2>
                <p>
                  The included automated scenarios check productive thinking,
                  drift, uncertainty, long pauses, hints and time budgets.
                  Session exports preserve the evidence and decision timeline
                  for replay and human annotation.
                </p>
                <p>
                  Showing better evidence per minute requires a
                  participant-separated benchmark and controlled comparison with
                  timeout and turn-level baselines. This prototype does not
                  claim a measured improvement or estimate cognitive state from
                  silence.
                </p>
              </section>
            </div>
          </>
        )}
        <footer>
          <span className="footer-brand">
            <AudioLines size={16} />
            cadence.
          </span>
          <span>A calmer way to find your voice.</span>
          <span>
            Practice with purpose <MoveUpRight size={12} />
          </span>
        </footer>
      </main>
      {showEnd && (
        <div className="modal-backdrop" onClick={() => setShowEnd(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="small-icon">
              <Coffee size={24} />
            </span>
            <h2 id="end-title">Ready to wrap up?</h2>
            <p>
              Your captured answers and coaching moments will be available in
              the session review.
            </p>
            <div>
              <button
                className="button secondary"
                onClick={() => setShowEnd(false)}
              >
                Keep practicing
              </button>
              <button
                className="button primary"
                autoFocus
                onClick={() => {
                  stopAudio();
                  send({ type: "end" });
                  setShowEnd(false);
                }}
              >
                End & review
                <ArrowRight size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
