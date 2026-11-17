import { useCallback, useEffect, useRef, useState } from "react";
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    ((e: { resultIndex: number; results: SpeechResult[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useSpeech(
  onFinal: (text: string, confidence: number | null) => void,
  onActivity: () => void,
) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const callbacks = useRef({ onFinal, onActivity });
  callbacks.current = { onFinal, onActivity };
  const supported = Boolean(
    (window as SpeechWindow).SpeechRecognition ||
    (window as SpeechWindow).webkitSpeechRecognition,
  );
  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.abort();
    rec.current = null;
    setListening(false);
    setInterim("");
  }, []);
  const start = useCallback(() => {
    if (wanted.current) return;
    const Constructor =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "Voice recognition is unavailable in this browser. You can use text mode.",
      );
      return;
    }
    setError("");
    wanted.current = true;
    const r = new Constructor();
    rec.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => setListening(true);
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal)
          callbacks.current.onFinal(
            result[0].transcript,
            result[0].confidence > 0 ? result[0].confidence : null,
          );
        else live += result[0].transcript;
      }
      setInterim(live);
      callbacks.current.onActivity();
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      setListening(false);
      setError(
        e.error === "not-allowed"
          ? "Microphone access was denied. Allow it in your browser, or switch to text."
          : `Voice recognition stopped (${e.error}). Try again or use text mode.`,
      );
    };
    r.onend = () => {
      setListening(false);
      if (wanted.current && rec.current === r) {
        try {
          r.start();
        } catch {
          wanted.current = false;
          setError("Microphone stopped. Select Start microphone to reconnect.");
        }
      }
    };
    try {
      r.start();
    } catch {
      wanted.current = false;
      setError("Could not start the microphone. Check browser permissions.");
    }
  }, []);
  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );
  return { start, stop, listening, interim, error, supported };
}
