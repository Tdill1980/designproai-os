import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface DesignGenieProps {
  prompt: string;
  onAccept: (elevatedPrompt: string) => void;
  disabled?: boolean;
  mode?: "restyle" | "commercial";
  companyName?: string;
  phone?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
}

/**
 * DesignGenie - Glowing genie prompt helper.
 * Takes the user's raw prompt, calls elevate-prompt edge function,
 * shows an elevated version they can accept, edit, or dismiss.
 */
export const DesignGenie = ({ prompt, onAccept, disabled, mode, companyName, phone, mascot, industryType, bulletPoints }: DesignGenieProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isElevating, setIsElevating] = useState(false);
  const [elevatedPrompt, setElevatedPrompt] = useState("");
  const [editablePrompt, setEditablePrompt] = useState("");
  const [preservationNote, setPreservationNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [glowPulse, setGlowPulse] = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const [showTypewriter, setShowTypewriter] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverText, setHoverText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const genieRef = useRef<HTMLDivElement>(null);

  // Pulse the genie glow when user has typed enough
  useEffect(() => {
    setGlowPulse(prompt.trim().length >= 5);
  }, [prompt]);

  // Typewriter effect when genie scrolls into view
  useEffect(() => {
    const el = genieRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !showTypewriter) {
          setShowTypewriter(true);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [showTypewriter]);

  useEffect(() => {
    if (!showTypewriter) return;
    const fullText = "Your Prompt is my Command";
    let i = 0;
    setTypewriterText("");
    const interval = setInterval(() => {
      i++;
      setTypewriterText(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(interval);
    }, 60);
    return () => clearInterval(interval);
  }, [showTypewriter]);

  // Hover typewriter — explains what GENIE does
  useEffect(() => {
    if (!isHovered) {
      setHoverText("");
      return;
    }
    const fullText = "I elevate your prompt into a pro-level design brief — just type a few words and click me!";
    let i = 0;
    setHoverText("");
    const interval = setInterval(() => {
      i++;
      setHoverText(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(interval);
    }, 25);
    return () => clearInterval(interval);
  }, [isHovered]);

  const handleElevate = async () => {
    if (!prompt.trim()) return;
    setIsOpen(true);
    setIsElevating(true);
    setError(null);
    setElevatedPrompt("");
    setEditablePrompt("");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("elevate-prompt", {
        body: {
          prompt: prompt.trim(),
          mode: mode || "restyle",
          companyName: mode === "commercial" ? companyName : undefined,
          phone: mode === "commercial" ? phone : undefined,
          mascot: mode === "commercial" ? mascot : undefined,
          industryType: mode === "commercial" ? industryType : undefined,
          bulletPoints: mode === "commercial" ? bulletPoints?.filter(b => b.trim()) : undefined,
        },
      });

      if (fnError) throw new Error(fnError.message || "Elevation failed");
      if (data?.error) throw new Error(data.error);
      if (!data?.elevated) throw new Error("No elevated prompt returned");

      setElevatedPrompt(data.elevated);
      setEditablePrompt(data.elevated);
      setPreservationNote(data.preservationNote ?? null);
    } catch (err: any) {
      setError(err.message || "Failed to elevate prompt");
    } finally {
      setIsElevating(false);
    }
  };

  const handleAccept = () => {
    onAccept(editablePrompt || elevatedPrompt);
    setIsOpen(false);
    setElevatedPrompt("");
    setEditablePrompt("");
    setPreservationNote(null);
  };

  const handleDismiss = () => {
    setIsOpen(false);
    setElevatedPrompt("");
    setEditablePrompt("");
    setPreservationNote(null);
    setError(null);
  };

  return (
    <div className="relative" ref={genieRef}>
      {/* Genie Bottle Button */}
      <button
        type="button"
        onClick={handleElevate}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        disabled={disabled || !prompt.trim() || prompt.trim().length < 3}
        className={cn(
          "group relative flex flex-col items-center gap-2 transition-all duration-500",
          "disabled:opacity-70 disabled:cursor-default",
          !disabled && prompt.trim().length >= 3 && "cursor-pointer"
        )}
        title="Elevate your prompt with GENIE"
      >
        {/* Genie Image — large and prominent */}
        <div className={cn(
          "relative w-36 h-36 sm:w-44 sm:h-44 transition-all duration-700",
          glowPulse && !disabled && "animate-genie-breathe"
        )}>
          {/* Outer glow */}
          <div className={cn(
            "absolute inset-0 rounded-full transition-all duration-700",
            glowPulse && !disabled
              ? "bg-purple-500/40 blur-2xl scale-150"
              : "bg-cyan-500/15 blur-xl scale-110"
          )} />
          <img
            src="/genie-prompt-helper.png"
            alt="GENIE Prompt Helper"
            className={cn(
              "relative z-10 w-full h-full object-contain transition-all duration-500",
              glowPulse && !disabled
                ? "drop-shadow-[0_0_35px_rgba(124,58,237,0.7)] brightness-110"
                : "drop-shadow-[0_0_20px_rgba(6,182,212,0.6)]"
            )}
          />
        </div>

        {/* Typewriter text label */}
        <p className={cn(
          "text-sm italic font-semibold tracking-wide transition-colors duration-500 min-h-[1.5em]",
          glowPulse && !disabled
            ? "bg-gradient-to-r from-cyan-300 to-purple-400 text-transparent bg-clip-text"
            : "text-cyan-500/60"
        )}>
          {typewriterText}
          {showTypewriter && typewriterText.length < 25 && (
            <span className="animate-pulse">|</span>
          )}
        </p>

        {/* Hover tooltip */}
        {isHovered && hoverText && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-[260px] z-50">
            <div className="rounded-xl px-3.5 py-2.5 shadow-lg bg-[#1a1a30] border border-purple-500/30">
              <p className="text-xs leading-relaxed text-slate-300">
                {hoverText}
                {hoverText.length < 88 && <span className="animate-pulse text-cyan-400">|</span>}
              </p>
            </div>
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[#1a1a30] border-r border-b border-purple-500/30" />
          </div>
        )}
      </button>

      {/* Elevated Prompt Popup */}
      {isOpen && (
        <div className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 w-[380px] max-w-[90vw]">
          <div className="relative rounded-xl border border-cyan-500/30 bg-background/95 backdrop-blur-md shadow-[0_0_30px_rgba(6,182,212,0.15)] overflow-hidden">
            {/* Header glow bar */}
            <div className="h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500" />

            <div className="p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 to-purple-400 text-transparent bg-clip-text">
                    GENIE Elevated Prompt
                  </span>
                </div>
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* Original prompt (small) */}
              <div className="text-[11px] text-muted-foreground/60 border-l-2 border-purple-500/30 pl-2">
                <span className="font-medium text-muted-foreground/80">Your prompt:</span>{" "}
                {prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt}
              </div>

              {/* Elevated prompt or loading */}
              {isElevating ? (
                <div className="flex items-center justify-center py-6 gap-2">
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                  <span className="text-sm text-cyan-400 animate-pulse">GENIE is elevating...</span>
                </div>
              ) : error ? (
                <div className="text-sm text-red-400 text-center py-4">{error}</div>
              ) : (
                <>
                  <textarea
                    ref={textareaRef}
                    value={editablePrompt}
                    onChange={(e) => setEditablePrompt(e.target.value)}
                    className="w-full min-h-[100px] max-h-[200px] bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                  />
                  {preservationNote && (
                    <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
                      <span className="font-semibold">Heads up:</span> {preservationNote}
                    </div>
                  )}
                </>
              )}

              {/* Action buttons */}
              {!isElevating && !error && elevatedPrompt && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleAccept}
                    size="sm"
                    className="flex-1 bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white"
                  >
                    <Check className="w-3.5 h-3.5 mr-1.5" />
                    Use Elevated Prompt
                  </Button>
                  <Button
                    onClick={handleDismiss}
                    size="sm"
                    variant="outline"
                    className="border-border/50"
                  >
                    Keep Original
                  </Button>
                </div>
              )}

              {error && (
                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="outline"
                  className="w-full"
                >
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
