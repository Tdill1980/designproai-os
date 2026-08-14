import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechToText — thin wrapper over the browser Web Speech API so customers
 * can TALK their revision instead of typing it. Detailed, multi-layered edits
 * are easier spoken than typed on a phone in the shop.
 *
 * Final transcripts are delivered to `onTranscript` (one phrase at a time) so
 * the caller can append them to the revision box. Gracefully unsupported in
 * browsers without SpeechRecognition (Firefox) — `supported` is false and the
 * caller hides the mic button.
 */
export function useSpeechToText(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Keep the latest callback without re-creating the recognition instance.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      finalText = finalText.trim();
      if (finalText) onTranscriptRef.current(finalText);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [supported]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Stop recognition if the component unmounts mid-listen.
  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, start, stop, toggle };
}
