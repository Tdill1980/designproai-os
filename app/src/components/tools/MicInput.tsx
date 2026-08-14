/**
 * MicInput — Per-field voice input button.
 *
 * A tiny mic icon that sits inside (or next to) a form field. Tap it,
 * speak, and the transcript fills JUST that field. No parsing, no
 * ambiguity — the browser Speech API handles single-field dictation
 * at ~90% accuracy for free.
 *
 * Works in Chrome, Edge, Safari. Falls back to invisible on unsupported
 * browsers (Firefox).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type MicState = "idle" | "listening" | "done";

interface MicInputProps {
  /** Called with the final transcript when the user stops speaking. */
  onTranscript: (text: string) => void;
  /** Optional className for the button wrapper. */
  className?: string;
  /** Size variant. Default "sm" for inline use. */
  size?: "sm" | "md";
  /** Aria label for accessibility. */
  label?: string;
}

const isSupported =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

export const MicInput = ({
  onTranscript,
  className,
  size = "sm",
  label = "Voice input",
}: MicInputProps) => {
  const [state, setState] = useState<MicState>("idle");
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const start = useCallback(() => {
    if (!isSupported) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState("listening");
      transcriptRef.current = "";
    };

    recognition.onresult = (event: any) => {
      const text = event.results[0]?.[0]?.transcript?.trim() || "";
      transcriptRef.current = text;
    };

    recognition.onend = () => {
      const text = transcriptRef.current;
      if (text) {
        onTranscriptRef.current(text);
        setState("done");
        timeoutRef.current = setTimeout(() => setState("idle"), 1500);
      } else {
        setState("idle");
      }
    };

    recognition.onerror = () => {
      setState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
    // Auto-stop after 8 seconds for a single field
    timeoutRef.current = setTimeout(() => {
      try { recognition.stop(); } catch {}
    }, 8000);
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleClick = () => {
    if (state === "listening") stop();
    else start();
  };

  if (!isSupported) return null;

  const sz = size === "md" ? "w-8 h-8" : "w-6 h-6";
  const iconSz = size === "md" ? "w-4 h-4" : "w-3 h-3";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={state === "listening" ? "Listening... tap to stop" : label}
      className={cn(
        "rounded-lg flex items-center justify-center transition-all shrink-0",
        sz,
        state === "idle" &&
          "text-white/40 hover:text-[#60A5FA] hover:bg-[#60A5FA]/10",
        state === "listening" &&
          "text-red-400 bg-red-500/15 animate-pulse",
        state === "done" &&
          "text-emerald-400 bg-emerald-500/15",
        className,
      )}
    >
      {state === "idle" && <Mic className={iconSz} />}
      {state === "listening" && <MicOff className={iconSz} />}
      {state === "done" && <Check className={iconSz} />}
    </button>
  );
};
