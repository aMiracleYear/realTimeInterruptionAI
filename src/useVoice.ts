import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancellationEvents,
  isBackchannel,
  wantsFloor,
  type WireEvent,
} from "./voiceProtocol";
export type VoiceTransport = "browser" | "native" | "text";
export interface CoachMessage {
  id: string;
  text: string;
  questionIndex: number;
  interrupt: boolean;
}
interface Result {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  abort(): void;
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
interface Callbacks {
  onFinal(text: string, confidence: number | null, questionIndex: number): void;
  onPreview(text: string, questionIndex: number): void;
  onPlayback(
    id: string,
    status: "spoken" | "interrupted",
    heardText: string,
    playbackMs: number,
  ): void;
  onActivity(): void;
}
export function useVoice(callbacks: Callbacks) {
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const [phase, setPhase] = useState<
    "off" | "connecting" | "listening" | "speaking" | "muted"
  >("off");
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);
  const active = useRef(false),
    isMuted = useRef(false),
    speaking = useRef(false);
  const mode = useRef<VoiceTransport>("text"),
    q = useRef(0);
  const rec = useRef<Recognition | null>(null),
    retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peer = useRef<RTCPeerConnection | null>(null),
    dc = useRef<RTCDataChannel | null>(null);
  const media = useRef<MediaStream | null>(null),
    audio = useRef<HTMLAudioElement | null>(null);
  const epoch = useRef(0),
    current = useRef<CoachMessage | null>(null),
    lastCoachId = useRef("");
  const playedAt = useRef(0),
    heardIndex = useRef(0),
    responseId = useRef<string | undefined>(undefined),
    itemId = useRef<string | undefined>(undefined);
  const generatedText = useRef(""),
    utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const inputItems = useRef(
    new Map<
      string,
      { text: string; questionIndex: number; ignored: boolean }
    >(),
  );
  const nativeQueue = useRef<CoachMessage | null>(null);
  const Constructor = () =>
    (window as VoiceWindow).SpeechRecognition ||
    (window as VoiceWindow).webkitSpeechRecognition;
  const browserSupported =
    Boolean(Constructor()) && "speechSynthesis" in window;
  const send = (event: WireEvent) => {
    if (dc.current?.readyState === "open")
      dc.current.send(JSON.stringify(event));
  };
  const stopMonitor = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onend = null;
      r.abort();
    }
    setInterim("");
  }, []);
  const listen = useCallback(() => {
    if (
      !active.current ||
      isMuted.current ||
      speaking.current ||
      mode.current === "text" ||
      rec.current
    )
      return;
    const C = Constructor();
    if (!C) {
      if (mode.current === "native") {
        setPhase("listening");
        return;
      }
      setError(
        "Browser speech recognition is unavailable. Use Chrome/Edge, native audio, or text practice.",
      );
      return;
    }
    const r = new C();
    const question = q.current;
    rec.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => {
      if (rec.current === r) setPhase("listening");
    };
    r.onresult = (e) => {
      if (
        rec.current !== r ||
        !active.current ||
        speaking.current ||
        isMuted.current ||
        question !== q.current
      )
        return;
      let preview = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal)
          cb.current.onFinal(
            result[0].transcript.trim(),
            result[0].confidence > 0 ? result[0].confidence : null,
            question,
          );
        else preview += result[0].transcript;
      }
      setInterim(preview);
      if (preview) cb.current.onPreview(preview.trim(), question);
      cb.current.onActivity();
    };
    r.onerror = (e) => {
      if (rec.current !== r || e.error === "aborted" || e.error === "no-speech")
        return;
      setError(
        e.error === "not-allowed"
          ? "Microphone permission denied. Allow microphone access in the browser and reconnect voice."
          : `Speech monitor stopped (${e.error}). Native audio can still receive finalized provider transcripts; reconnect for mid-speech monitoring.`,
      );
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        r.onend = null;
        rec.current = null;
        if (mode.current === "browser") setPhase("off");
      }
    };
    r.onend = () => {
      if (rec.current === r) {
        rec.current = null;
        if (active.current && !speaking.current && !isMuted.current)
          retry.current = setTimeout(() => listen(), 180);
      }
    };
    try {
      r.start();
    } catch {
      rec.current = null;
      setError(
        "Could not start speech recognition. Check microphone permissions.",
      );
    }
  }, []);
  const acknowledge = (status: "spoken" | "interrupted", heardText: string) => {
    if (!current.current) return;
    cb.current.onPlayback(
      current.current.id,
      status,
      heardText,
      playedAt.current ? Math.max(0, performance.now() - playedAt.current) : 0,
    );
    current.current = null;
  };
  const cancel = useCallback(() => {
    if (audio.current) audio.current.muted = true;
    if (
      mode.current === "native" &&
      (speaking.current || responseId.current || itemId.current)
    ) {
      const played = playedAt.current
        ? performance.now() - playedAt.current
        : 0;
      for (const e of cancellationEvents(
        responseId.current,
        itemId.current,
        played,
      ))
        send(e);
    }
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
    }
    window.speechSynthesis?.cancel();
    if (current.current)
      acknowledge(
        "interrupted",
        mode.current === "browser"
          ? current.current.text.slice(0, heardIndex.current)
          : "",
      );
    speaking.current = false;
    responseId.current = undefined;
    itemId.current = undefined;
    playedAt.current = 0;
    generatedText.current = "";
  }, []);
  const say = useCallback(
    (message: CoachMessage) => {
      if (message.id === lastCoachId.current) return;
      lastCoachId.current = message.id;
      q.current = message.questionIndex;
      stopMonitor();
      cancel();
      if (mode.current === "text" || !active.current) return;
      if (mode.current === "native" && dc.current?.readyState !== "open") {
        nativeQueue.current = message;
        return;
      }
      current.current = message;
      heardIndex.current = 0;
      speaking.current = true;
      setPhase("speaking");
      if (mode.current === "native") {
        send({
          type: "response.create",
          response: {
            metadata: { coach_id: message.id },
            output_modalities: ["audio"],
            instructions: `Speak this controller-provided interview utterance and nothing else. Do not answer it yourself: ${message.text}`,
          },
        });
      } else {
        if (!("speechSynthesis" in window)) {
          speaking.current = false;
          setError("Speech playback is unavailable. Use text practice.");
          listen();
          return;
        }
        const u = new SpeechSynthesisUtterance(message.text);
        utterance.current = u;
        u.rate = 1.02;
        u.onstart = () => {
          playedAt.current = performance.now();
        };
        u.onboundary = (e) => {
          heardIndex.current = e.charIndex;
        };
        const done = () => {
          if (utterance.current !== u) return;
          utterance.current = null;
          acknowledge("spoken", message.text);
          speaking.current = false;
          playedAt.current = 0;
          if (active.current) {
            setPhase(isMuted.current ? "muted" : "listening");
            listen();
          }
        };
        u.onend = done;
        u.onerror = (e) => {
          if (e.error !== "canceled" && e.error !== "interrupted")
            setError(
              "Coach audio could not play. You can read the caption and continue.",
            );
          done();
        };
        window.speechSynthesis.speak(u);
      }
    },
    [cancel, listen, stopMonitor],
  );
  const start = useCallback(
    async (transport: VoiceTransport) => {
      const token = ++epoch.current;
      setError("");
      mode.current = transport;
      active.current = true;
      isMuted.current = false;
      setMuted(false);
      lastCoachId.current = "";
      setPhase(transport === "text" ? "off" : "connecting");
      if (transport !== "native") return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (token !== epoch.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        media.current = stream;
        const pc = new RTCPeerConnection();
        peer.current = pc;
        const element = new Audio();
        element.autoplay = true;
        audio.current = element;
        pc.ontrack = (e) => {
          element.srcObject = e.streams[0];
          void element
            .play()
            .catch(() =>
              setError(
                "Audio playback was blocked. Use the Resume audio button.",
              ),
            );
        };
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
          ) {
            setError(
              "Native audio disconnected. End and reconnect the interview.",
            );
            stopMonitor();
            setPhase("off");
          }
        };
        const channel = pc.createDataChannel("oai-events");
        dc.current = channel;
        channel.onmessage = (e) => {
          const event = JSON.parse(e.data);
          const type = event.type;
          if (
            type === "response.created" &&
            event.response.metadata?.coach_id === current.current?.id
          )
            responseId.current = event.response.id;
          if (
            type === "response.output_item.added" &&
            event.item?.role === "assistant" &&
            event.response_id === responseId.current
          )
            itemId.current = event.item.id;
          if (
            type === "output_audio_buffer.started" &&
            event.response_id === responseId.current
          ) {
            speaking.current = true;
            playedAt.current = performance.now();
            if (audio.current) audio.current.muted = false;
            setPhase("speaking");
            stopMonitor();
          }
          if (
            type === "response.output_audio_transcript.delta" &&
            event.response_id === responseId.current
          )
            generatedText.current += event.delta ?? "";
          if (
            type === "output_audio_buffer.stopped" &&
            event.response_id === responseId.current
          ) {
            if (current.current)
              acknowledge(
                "spoken",
                generatedText.current || current.current.text,
              );
            speaking.current = false;
            responseId.current = undefined;
            itemId.current = undefined;
            playedAt.current = 0;
            setPhase(isMuted.current ? "muted" : "listening");
            listen();
          }
          if (
            type === "conversation.item.input_audio_transcription.delta" ||
            type === "conversation.item.input_audio_transcription.completed"
          ) {
            const id = event.item_id;
            let input = inputItems.current.get(id);
            if (!input) {
              input = {
                text: "",
                questionIndex: q.current,
                ignored: Boolean(rec.current) && !speaking.current,
              };
              inputItems.current.set(id, input);
            }
            input.text = type.endsWith("completed")
              ? event.transcript
              : input.text + (event.delta ?? "");
            if (speaking.current && wantsFloor(input.text)) {
              cancel();
              setPhase("listening");
              listen();
            }
            if (
              !input.ignored &&
              !isBackchannel(input.text) &&
              !isMuted.current
            ) {
              if (type.endsWith("completed"))
                cb.current.onFinal(input.text, null, input.questionIndex);
              else cb.current.onPreview(input.text, input.questionIndex);
            }
            if (type.endsWith("completed")) inputItems.current.delete(id);
          }
          if (type === "input_audio_buffer.speech_started") {
            inputItems.current.set(event.item_id, {
              text: "",
              questionIndex: q.current,
              ignored: Boolean(rec.current) && !speaking.current,
            });
            cb.current.onActivity();
          }
          if (
            type === "error" &&
            ![
              "response_cancel_not_active",
              "conversation_already_has_active_response",
            ].includes(event.error?.code)
          )
            setError(
              `Native audio: ${event.error?.message || "provider event failed"}`,
            );
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const response = await fetch("/api/realtime/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: offer.sdp }),
        });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error || "Native audio connection failed.");
        }
        await pc.setRemoteDescription({
          type: "answer",
          sdp: await response.text(),
        });
        if (token !== epoch.current) {
          pc.close();
          return;
        }
        await new Promise<void>((resolve, reject) => {
          if (channel.readyState === "open") resolve();
          else {
            const timeout = setTimeout(
              () => reject(new Error("Realtime data channel timed out.")),
              15000,
            );
            channel.onopen = () => {
              clearTimeout(timeout);
              resolve();
            };
          }
        });
        setPhase("listening");
        if (nativeQueue.current) {
          const pending = nativeQueue.current;
          nativeQueue.current = null;
          lastCoachId.current = "";
          say(pending);
        }
      } catch (e) {
        active.current = false;
        media.current?.getTracks().forEach((t) => t.stop());
        peer.current?.close();
        setPhase("off");
        setError(
          e instanceof Error ? e.message : "Cannot connect native voice.",
        );
        throw e;
      }
    },
    [cancel, listen, say, stopMonitor],
  );
  const stop = useCallback(() => {
    epoch.current++;
    active.current = false;
    nativeQueue.current = null;
    stopMonitor();
    cancel();
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    dc.current?.close();
    peer.current?.close();
    dc.current = null;
    peer.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
    }
    inputItems.current.clear();
    setPhase("off");
  }, [cancel, stopMonitor]);
  const toggleMute = () => {
    isMuted.current = !isMuted.current;
    setMuted(isMuted.current);
    media.current?.getAudioTracks().forEach((t) => {
      t.enabled = !isMuted.current;
    });
    if (isMuted.current) stopMonitor();
    else listen();
    if (!speaking.current) setPhase(isMuted.current ? "muted" : "listening");
  };
  const interruptCoach = () => {
    cancel();
    setPhase(isMuted.current ? "muted" : "listening");
    listen();
  };
  useEffect(() => {
    if (phase !== "speaking") return;
    const timer = setInterval(() => cb.current.onActivity(), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => () => stop(), [stop]);
  return {
    phase,
    error,
    interim,
    muted,
    browserSupported,
    start,
    say,
    stop,
    toggleMute,
    interruptCoach,
    resumeAudio: () => {
      void audio.current?.play();
    },
  };
}
