/**
 * AceRevisionRobot — "talk to ACE" customer revision experience (LIVE, default-on).
 *
 * This is the default customer revise experience on /proof. The legacy text flow
 * (<ReviseConversation>) is only used as a fallback when the URL carries ?ace=0.
 *
 * Layout (per Trish): ACE robot front-and-center at the top, his RESPONSE box on
 * the LEFT, the customer's TYPING box on the RIGHT, and the full design image
 * centered BELOW. Voice-first (mic), ACE talks back (TTS). Runs off the existing
 * engine (proof-revise-thread + proof-revise-ai). No new backend.
 *
 * Two revision paths:
 *   1. Talk/type  → whole-image regen via proof-revise-ai (good for broad changes).
 *   2. Tap a spot → precise masked edit (segment-click SAM2 → revise-render-masked
 *                   Flux Fill). Reliable for "remove THIS" / "recolor THIS" where
 *                   whole-image regen is unreliable. See AceSpotEdit below.
 *
 * Avatars live at /characters/ace-robot.png (smiling) and
 * /characters/ace-robot-think.png (focused, while revising), falling back to
 * /characters/ace-v2.png if those 404.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { cn } from "@/lib/utils";
import { RevisionProgress } from "./RevisionProgress";
import { Mic, Send, X, Check, Loader2, RefreshCw, Crosshair, Eraser, Wand2, Volume2 } from "lucide-react";

interface Turn { version_number: number; render_url: string | null; is_active: boolean; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  onChanged: () => void;
  onApprove?: () => void;
  onMessageTeam?: () => void;
  // Optional pre-filled revise prompt (e.g. from an ACE Suggestion the
  // customer tapped in the portal) — drops into the input ready to send.
  seedPrompt?: string | null;
  // Source-render context forwarded to the precise spot-edit engine
  // (revise-render-masked) so its wrap-aware prompt builder knows the base
  // material/finish to paint instead of guessing from pixels.
  finish?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
}

// ACE's live avatars (fall back to ace-v2 if a file 404s).
const ACE_IMG = "/characters/ace-robot.png";          // smiling
const ACE_IMG_THINK = "/characters/ace-robot-think.png"; // focused (while revising)
const ACE_IMG_FALLBACK = "/characters/ace-v2.png";
const GREETING = "Hi! I'm ACE. Tap the mic and just tell me what you'd like changed — like “move the name to the center” or “make the red darker.”";

function idemKey() {
  return (crypto as any).randomUUID?.() || `ace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Prefer a deep/robotic voice for ACE (approximating an "onyx"-style voice)
// from whatever the browser offers.
function pickAceVoice(): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis?.getVoices?.() || [];
    const byName = vs.find((v) => /onyx|daniel|google uk english male|microsoft guy|fred|arthur|male/i.test(v.name));
    return byName || vs.find((v) => /en[-_]/i.test(v.lang)) || vs[0] || null;
  } catch { return null; }
}

export const AceRevisionRobot = ({ open, onOpenChange, token, onChanged, onApprove, onMessageTeam, seedPrompt, finish, vehicleMake, vehicleModel }: Props) => {
  const [thinking, setThinking] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [allowed, setAllowed] = useState(0);
  const [input, setInput] = useState("");
  const [aceLine, setAceLine] = useState(GREETING);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  // Spot-edit ("tap the spot") state — precise masked edit on ONE area.
  const [spotEdit, setSpotEdit] = useState(false);
  // When a precise masked edit finishes we hold its fresh render URL here so the
  // customer immediately SEES the corrected design (the masked engine returns a
  // URL but, today, there is no customer-token endpoint to persist it as a new
  // proof version — see TODO on onSpotDone).
  const [spotResultUrl, setSpotResultUrl] = useState<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voice = useSpeechToText((t) => setInput((p) => (p ? p + " " : "") + t));
  const latestTurn = [...turns].reverse().find((t) => t.render_url);
  // The image shown front-and-center: the freshly masked spot-edit result if we
  // have one this session, otherwise the active proof version from the thread.
  const current = spotResultUrl
    ? { version_number: latestTurn?.version_number ?? 0, render_url: spotResultUrl, is_active: true }
    : latestTurn;

  const stopSpeaking = () => {
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  };

  // ACE's voice = OpenAI "onyx" (deep, warm) via sprocket-helper mode:"tts".
  // Falls back to the browser's deepest voice if the API is unavailable.
  const speak = async (text: string, force = false) => {
    if (muted && !force) return; // auto-speak respects mute; manual replay forces
    stopSpeaking();
    try {
      const { data } = await supabase.functions.invoke("sprocket-helper", { body: { mode: "tts", text } });
      if (data?.audio_base64) {
        const a = new Audio(`data:${data.mime || "audio/mpeg"};base64,${data.audio_base64}`);
        audioRef.current = a;
        await a.play().catch(() => {});
        return;
      }
    } catch { /* fall through to browser TTS */ }
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>“”]/g, "").slice(0, 400));
      if (!voiceRef.current) voiceRef.current = pickAceVoice();
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 0.98; u.pitch = 0.9;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };
  const aceSays = (text: string) => { setAceLine(text); speak(text); };

  const loadThread = async () => {
    try {
      const { data } = await supabase.functions.invoke("proof-revise-thread", { body: { token } });
      if (data?.success) {
        setTurns(data.turns || []);
        setRemaining(data.ai_revisions?.remaining ?? 0);
        setAllowed(data.ai_revisions?.allowed ?? 0);
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    if (!open) { stopSpeaking(); return; }
    setThinking(false); setReveal(false); setError(null); setInput(seedPrompt || ""); setSpotEdit(false); setSpotResultUrl(null);
    setAceLine(seedPrompt ? "Got it — I've teed up that change. Tweak the wording if you like, then send it my way." : GREETING);
    // voices load async on some browsers
    try { window.speechSynthesis.onvoiceschanged = () => { voiceRef.current = pickAceVoice(); }; } catch { /* ignore */ }
    loadThread();
    setTimeout(() => speak(GREETING), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  const submit = async (text: string) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    if (remaining <= 0) { aceSays("Looks like you're out of changes for now — tap “Message the design team” and a human will take it from here."); return; }
    if (voice.listening) voice.toggle();
    setError(null); setReveal(false); setInput(""); setSpotResultUrl(null);
    setThinking(true);
    aceSays("Got it — working on that now. Give me about a minute…");
    try {
      const { data, error: err } = await supabase.functions.invoke("proof-revise-ai", {
        // Omit reference_image_paths so the server auto-carries the customer's
        // most recent references — sending [] used to wipe them on every regen.
        body: { token, prompt: msg },
        headers: { "Idempotency-Key": idemKey() },
      });
      if (err || !data?.success) {
        const m = (data as any)?.error || err?.message || "That one didn't go through — you weren't charged. Try saying it a little differently.";
        setError(m); setThinking(false); aceSays(m); return;
      }
      await loadThread();
      onChanged();
      setThinking(false); setReveal(true);
      aceSays("Here's your updated design! Love it? Tap approve. Want another change? Just tell me.");
    } catch (e: any) {
      setThinking(false); setError(e?.message || "Network hiccup — try again.");
    }
  };

  // Called by AceSpotEdit when a precise masked edit (segment-click +
  // revise-render-masked) finishes. The masked engine returns a fresh render
  // URL directly, which we show immediately so the customer sees the precise
  // fix and the rest of their design untouched.
  //
  // TODO(persist): unlike the talk/type path (proof-revise-ai, which writes a
  // new customer proof_version off the HMAC token), there is currently NO
  // token-authed customer endpoint that commits an arbitrary pre-rendered URL
  // into the proof thread (proof-save-version is shop-auth only). So this
  // corrected render is shown locally but is NOT yet a saved proof version.
  // Persisting it needs a small backend addition — either teach proof-revise-ai
  // to accept { maskUrl } and run revise-render-masked internally before its
  // existing version-write, or add a token-authed "save customer masked version"
  // endpoint (added to config.toml with verify_jwt = false). Documented in the
  // handoff report rather than built here per the no-new-edge-function rule.
  const onSpotDone = async (newUrl: string) => {
    setSpotEdit(false);
    setSpotResultUrl(newUrl || null);
    onChanged();
    setReveal(true);
    aceSays("Done! I cleaned up just that spot — the rest of your design is untouched. Love it? Tap approve.");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-gradient-to-b from-[#0b1020] via-[#131a33] to-[#0b1020] text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-white/10" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2 text-sm font-bold"><span className="text-cyan-300">✦</span> A.C.E · AI Creative Engine</div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/60">{remaining} of {allowed} changes left</span>
          <button onClick={() => setMuted((m) => { if (!m) stopSpeaking(); return !m; })} className="rounded-md bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px]">{muted ? "🔇" : "🔊"}</button>
          <button onClick={() => { stopSpeaking(); onOpenChange(false); }} className="rounded-md bg-white/10 hover:bg-white/20 p-1.5" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 py-5 flex flex-col items-center gap-5">
        {/* ACE — front and center */}
        <div className="relative shrink-0">
          <div className={`absolute inset-0 rounded-full blur-2xl ${thinking ? "bg-cyan-400/50 animate-pulse" : voice.listening ? "bg-fuchsia-400/50" : "bg-blue-500/25"} transition-colors`} />
          <img src={thinking ? ACE_IMG_THINK : ACE_IMG} onError={(e) => { (e.currentTarget as HTMLImageElement).src = ACE_IMG_FALLBACK; }} alt="ACE"
            className={`relative w-32 h-32 sm:w-44 sm:h-44 object-contain drop-shadow-2xl transition-transform ${thinking ? "animate-pulse" : voice.listening ? "scale-105" : ""}`} />
        </div>

        {/* Row: ACE's response (LEFT)  |  your typing (RIGHT) */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* ACE response */}
          <div className="rounded-2xl bg-white/10 border border-white/10 px-4 py-3 min-h-[88px]">
            <div className="text-[11px] font-bold text-cyan-300 mb-1.5 flex items-center gap-1.5">
              <img src={ACE_IMG} onError={(e) => { (e.currentTarget as HTMLImageElement).src = ACE_IMG_FALLBACK; }} alt="" className="w-5 h-5 object-contain" />
              A.C.E <span className="font-semibold text-white/50">· AI Creative Engine</span>
              <button
                type="button"
                onClick={() => speak(aceLine, true)}
                className="ml-auto rounded-md bg-white/10 hover:bg-white/20 p-1 text-cyan-200"
                aria-label="Listen to A.C.E"
                title="Listen"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-[15px] leading-snug">
              {thinking ? <span className="inline-flex items-center gap-2 text-cyan-200"><Loader2 className="w-4 h-4 animate-spin" /> {aceLine}</span> : aceLine}
            </div>
          </div>

          {/* Your typing + voice */}
          <div className="rounded-2xl bg-white/5 border border-white/15 px-4 py-3 flex flex-col gap-2">
            <div className="text-[11px] font-bold text-white/60 text-right">You</div>
            <div className="flex items-end gap-2">
              {voice.supported && (
                <button onClick={voice.toggle} aria-label="Talk to ACE"
                  className={`relative h-12 w-12 shrink-0 rounded-full flex items-center justify-center transition-all ${voice.listening ? "bg-gradient-to-br from-fuchsia-500 to-rose-500 scale-105" : "bg-gradient-to-br from-blue-500 to-cyan-500 hover:scale-105"} shadow-[0_0_24px_rgba(59,130,246,0.5)]`}>
                  {voice.listening && <span className="absolute inset-0 rounded-full animate-ping bg-fuchsia-400/40" />}
                  <Mic className="w-6 h-6 relative" />
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
                rows={1}
                placeholder={voice.listening ? "Listening…" : "Tap the mic and talk — or type here"}
                className="flex-1 resize-none rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-[16px] text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-400 max-h-24"
                disabled={thinking}
              />
              <button onClick={() => submit(input)} disabled={thinking || input.trim().length < 2}
                className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center disabled:opacity-40"><Send className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-white/40">{voice.listening ? "Listening… tap the mic to stop" : "🎙️ Tap the mic to talk to ACE"}</p>
          </div>
        </div>

        {/* Live progress while a whole-image revise is generating, so the
            customer can SEE it working (no exact server events — time-paced). */}
        {thinking && (
          <RevisionProgress active variant="dark" label="ACE is working" estimateSeconds={55} className="max-w-2xl" />
        )}

        {/* Full design image — centered below. In spot-edit mode the image
            becomes a tap target (AceSpotEdit); otherwise it's just the preview. */}
        <div className="w-full flex justify-center">
          {current?.render_url ? (
            spotEdit ? (
              <AceSpotEdit
                imageUrl={current.render_url}
                versionNumber={current.version_number}
                token={token}
                finish={finish}
                vehicleMake={vehicleMake}
                vehicleModel={vehicleModel}
                disabled={thinking}
                onAceSay={aceSays}
                onDone={onSpotDone}
                onCancel={() => { setSpotEdit(false); aceSays("No problem — tell me anything else you'd like to change."); }}
              />
            ) : (
              <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/30 shadow-2xl w-full max-w-2xl">
                <img src={current.render_url} alt="Your design" className="w-full object-contain" />
                <div className="text-center text-[11px] text-white/50 py-1.5">Your design · v{current.version_number}</div>
              </div>
            )
          ) : (
            <div className="text-white/40 text-sm py-10 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading your design…</div>
          )}
        </div>

        {/* Point-at-the-spot affordance — the #1 customer request: "just let me
            click the thing to remove it." Routes ONE tapped area through the
            precise masked engine instead of a full-image regen. */}
        {current?.render_url && !spotEdit && !reveal && (
          <button
            onClick={() => {
              if (remaining <= 0) { aceSays("You're out of changes for now — tap “Message the design team” and a human will finish it."); return; }
              setSpotEdit(true); setError(null);
              aceSays("Sure — tap right on the spot you want me to fix, then tell me to remove it or what to change it to.");
            }}
            disabled={thinking}
            className="w-full max-w-md h-11 rounded-xl bg-white/10 hover:bg-white/20 border border-cyan-400/30 text-cyan-100 font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Crosshair className="w-4 h-4" /> Remove or change a specific spot
          </button>
        )}

        {/* Reveal actions */}
        {reveal && (
          <div className="w-full max-w-md grid grid-cols-1 gap-2">
            {onApprove && (
              <button onClick={() => { stopSpeaking(); onApprove(); }} className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold flex items-center justify-center gap-2"><Check className="w-5 h-5" /> I love it — approve</button>
            )}
            <button onClick={() => { setReveal(false); setSpotResultUrl(null); aceSays("Okay! What else would you like to change?"); }} className="h-11 rounded-xl bg-white/10 hover:bg-white/20 font-semibold flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4" /> Make another change</button>
          </div>
        )}

        {error && <div className="w-full max-w-md rounded-lg bg-red-500/20 border border-red-400/40 text-red-100 text-sm p-2 text-center">{error}</div>}

        {onMessageTeam && (
          <button onClick={() => { stopSpeaking(); onMessageTeam(); }} className="text-[12px] text-cyan-300/80 hover:text-cyan-200 underline underline-offset-2 pb-2">
            Prefer a human? Message the design team
          </button>
        )}
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// AceSpotEdit — "tap the spot" precise masked edit for the customer.
//
// The #1 repeated customer request is "just let me click the thing to remove
// it." Whole-image regen (proof-revise-ai / Gemini) is unreliable for removing
// or recoloring ONE specific area — it tends to redraw the whole design. This
// reuses the EXISTING, reliable masked engine that powers RevisionStudioIQ's
// Precise Edit, kept deliberately minimal for phones:
//
//   1. Customer TAPS one point on the design (mouse or touch).
//   2. segment-click (SAM2) turns that point into a pixel-perfect mask of
//      whatever panel / decal / text block they tapped.
//   3. Customer picks "Remove it" or "Change it" + says/types what to do.
//   4. revise-render-masked (Flux Fill Pro) repaints ONLY inside that mask —
//      every pixel outside stays bit-identical.
//
// ACE narrates each step in his own voice via onAceSay. On success the fresh
// render URL is handed back through onDone (see onSpotDone's persist TODO).
//
// Deferred (TODO): the full MarkupIQ surface (CutLine / box-select / drag-move /
// freehand pen — see PreciseEditCanvas) is intentionally NOT brought into the
// customer genie. Tap-a-point + remove/change is the smallest reliable version;
// richer marking stays in the shop-side RevisionStudioIQ tool.
// ───────────────────────────────────────────────────────────────────────────

interface SpotEditProps {
  imageUrl: string;
  versionNumber: number;
  token: string;
  finish?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  disabled?: boolean;
  onAceSay: (text: string) => void;
  onDone: (newRenderUrl: string) => void;
  onCancel: () => void;
}

type SpotPhase = "tap" | "segmenting" | "instruct" | "rendering";

const AceSpotEdit = ({
  imageUrl,
  versionNumber,
  token,
  finish,
  vehicleMake,
  vehicleModel,
  disabled,
  onAceSay,
  onDone,
  onCancel,
}: SpotEditProps) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [phase, setPhase] = useState<SpotPhase>("tap");
  // Tapped point in normalized image coords (0..1) + a display marker (% of box).
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  // "remove" (clear it + heal the wrap behind) or "change" (recolor / replace).
  const [intent, setIntent] = useState<"remove" | "change">("remove");
  const [instruction, setInstruction] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Reuse ACE's mic for the spot instruction too (phones type slowly).
  const mic = useSpeechToText((t) => setInstruction((p) => (p ? p + " " : "") + t));

  const busy = phase === "segmenting" || phase === "rendering" || !!disabled;

  // Tap → normalized point relative to the rendered image box. Works for both
  // mouse and touch (touchend carries changedTouches).
  const handleTap = async (e: React.MouseEvent | React.TouchEvent) => {
    if (busy || phase !== "tap" || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const pt = "changedTouches" in e ? e.changedTouches[0] : (e as React.MouseEvent);
    const clientX = (pt as any).clientX;
    const clientY = (pt as any).clientY;
    if (clientX == null || clientY == null) return;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setPoint({ x, y });
    setErr(null);
    setPhase("segmenting");
    onAceSay("Got it — finding exactly what you tapped…");
    try {
      const { data, error } = await supabase.functions.invoke("segment-click", {
        body: {
          imageUrl,
          clickX: x,
          clickY: y,
          imageWidth: imgRef.current.naturalWidth || undefined,
          imageHeight: imgRef.current.naturalHeight || undefined,
        },
      });
      if (error || !data?.maskUrl) {
        throw new Error((data as any)?.error || error?.message || "I couldn't lock onto that spot.");
      }
      setMaskUrl(data.maskUrl);
      setPhase("instruct");
      onAceSay("Locked on. Want me to remove it, or change it? Tell me what to do.");
    } catch (e: any) {
      setErr(e?.message || "I couldn't lock onto that spot — try tapping right in the middle of it.");
      setPhase("tap");
      setPoint(null);
      onAceSay("Hmm, I couldn't lock onto that — tap right in the middle of the thing you want me to fix.");
    }
  };

  // Build the Flux Fill instruction. "remove" defaults to a wrap-heal prompt so
  // an empty box still tells Flux what to paint (bare prompt = smeared paint).
  const buildPrompt = (): string => {
    const said = instruction.trim();
    if (intent === "remove") {
      return (
        `Remove ${said || "everything in this area"} and cleanly continue the surrounding ` +
        `${finish || "gloss"} vehicle wrap and bodywork — no logos, text, phone numbers, ` +
        `graphics, or stripes left behind.`
      );
    }
    return said || "Change this area to match the surrounding design cleanly.";
  };

  const apply = async () => {
    if (busy || !maskUrl) return;
    if (intent === "change" && instruction.trim().length < 2) {
      onAceSay("Just tell me what to change it to — like “make it matte black” or “add a chrome accent.”");
      return;
    }
    if (mic.listening) mic.toggle();
    setErr(null);
    setPhase("rendering");
    onAceSay(intent === "remove" ? "On it — erasing just that spot and healing the wrap behind it…" : "On it — changing just that spot…");
    try {
      const { data, error } = await supabase.functions.invoke("revise-render-masked", {
        body: {
          imageUrl,
          maskUrl,
          prompt: buildPrompt(),
          finish: finish || undefined,
          vehicleMake: vehicleMake || undefined,
          vehicleModel: vehicleModel || undefined,
          toolType: "proof",
        },
      });
      if (error || !data?.renderUrl) {
        throw new Error((data as any)?.error || error?.message || "That spot edit didn't go through.");
      }
      onDone(data.renderUrl);
    } catch (e: any) {
      setErr(e?.message || "That spot edit didn't go through — try again.");
      setPhase("instruct");
      onAceSay("That one didn't take — let's try again. Tell me what to do with that spot.");
    }
  };

  return (
    <div className="w-full max-w-2xl flex flex-col gap-3">
      <div
        className={cn(
          "relative rounded-2xl overflow-hidden border bg-black/30 shadow-2xl select-none",
          phase === "tap" ? "border-cyan-400/60 cursor-crosshair" : "border-white/10",
        )}
        onClick={handleTap}
        onTouchEnd={handleTap}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Tap the spot to fix"
          crossOrigin="anonymous"
          className="w-full object-contain pointer-events-none"
          draggable={false}
        />

        {/* Tapped-point marker */}
        {point && (
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          >
            <span className="block w-6 h-6 rounded-full border-2 border-cyan-300 bg-cyan-400/30 animate-pulse" />
          </span>
        )}

        {/* Tap hint / busy overlay */}
        {phase === "tap" && (
          <div className="absolute inset-x-0 top-0 flex justify-center pt-2 pointer-events-none">
            <span className="rounded-full bg-cyan-500/90 text-black text-[12px] font-bold px-3 py-1 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5" /> Tap the exact spot to fix
            </span>
          </div>
        )}
        {(phase === "segmenting" || phase === "rendering") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <span className="inline-flex items-center gap-2 text-cyan-200 text-sm font-semibold">
              <Loader2 className="w-5 h-5 animate-spin" />
              {phase === "segmenting" ? "Locking onto that spot…" : "Fixing just that area…"}
            </span>
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 text-center text-[11px] text-white/60 py-1 bg-black/30 pointer-events-none">
          Spot edit · from v{versionNumber}
        </div>
      </div>

      {/* Live progress while the masked render runs — the customer sees ACE
          working on just that spot. */}
      {phase === "rendering" && (
        <RevisionProgress
          active
          variant="dark"
          compact
          estimateSeconds={40}
          messages={["Fixing just that area…", "Healing the wrap behind it…", "Blending the edges…", "Almost there…"]}
        />
      )}

      {/* Instruction panel — shown once a region is locked. */}
      {phase === "instruct" && (
        <div className="rounded-2xl bg-white/5 border border-white/15 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIntent("remove")}
              className={cn(
                "h-11 rounded-xl font-semibold flex items-center justify-center gap-2 border transition-colors",
                intent === "remove"
                  ? "bg-fuchsia-500/90 border-fuchsia-300 text-white"
                  : "bg-white/10 border-white/15 text-white/80 hover:bg-white/20",
              )}
            >
              <Eraser className="w-4 h-4" /> Remove it
            </button>
            <button
              onClick={() => setIntent("change")}
              className={cn(
                "h-11 rounded-xl font-semibold flex items-center justify-center gap-2 border transition-colors",
                intent === "change"
                  ? "bg-cyan-500/90 border-cyan-300 text-black"
                  : "bg-white/10 border-white/15 text-white/80 hover:bg-white/20",
              )}
            >
              <Wand2 className="w-4 h-4" /> Change it
            </button>
          </div>

          <div className="flex items-end gap-2">
            {mic.supported && (
              <button
                onClick={mic.toggle}
                aria-label="Talk"
                className={cn(
                  "h-11 w-11 shrink-0 rounded-full flex items-center justify-center transition-all",
                  mic.listening
                    ? "bg-gradient-to-br from-fuchsia-500 to-rose-500 scale-105"
                    : "bg-gradient-to-br from-blue-500 to-cyan-500 hover:scale-105",
                )}
              >
                {mic.listening && <span className="absolute rounded-full animate-ping bg-fuchsia-400/40 w-11 h-11" />}
                <Mic className="w-5 h-5 relative" />
              </button>
            )}
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={1}
              placeholder={
                intent === "remove"
                  ? "Optional — e.g. “the phone number” (or just tap Apply)"
                  : "What should it become? e.g. “matte black”, “add chrome”"
              }
              className="flex-1 resize-none rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-[16px] text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-400 max-h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCancel}
              className="h-11 rounded-xl bg-white/10 hover:bg-white/20 font-semibold flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
            <button
              onClick={apply}
              disabled={busy}
              className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Check className="w-4 h-4" /> {intent === "remove" ? "Remove this spot" : "Change this spot"}
            </button>
          </div>
        </div>
      )}

      {/* Cancel while still tapping. */}
      {phase === "tap" && (
        <button
          onClick={onCancel}
          className="self-center text-[12px] text-white/60 hover:text-white/90 underline underline-offset-2"
        >
          Never mind — go back to talking to ACE
        </button>
      )}

      {err && (
        <div className="rounded-lg bg-red-500/20 border border-red-400/40 text-red-100 text-sm p-2 text-center">
          {err}
        </div>
      )}
    </div>
  );
};
