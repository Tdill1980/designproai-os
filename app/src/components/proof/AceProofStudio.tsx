/**
 * AceProofStudio — the friendly, customer-facing "ACE design dashboard" proof
 * experience (the page from Trish's mockup). White UI per WHITE_UI_STANDARD.
 *
 * Layout (matches the mockup):
 *   compact "Hi {name}!" greeting (ACE)
 *   ┌──────────────────────────────────────────┬──────────────────┐
 *   │  Design Preview (canvas) — ABOVE THE FOLD │ Project Details   │
 *   │  ┌─ A.C.E voice ──────┬─ You: type / talk ┤ ACE Suggestions   │
 *   │  │ (his responses)    │ (textarea + mic)  │ Approve / Revise  │
 *   │  └────────────────────┴───────────────────┘                   │
 *   └──────────────────────────────────────────┴──────────────────┘
 *
 * ACE is a CHAT-BASED designer: the customer can TYPE or TALK (voice → text via
 * the ace-transcribe Whisper endpoint) to ask questions or request changes.
 *
 * This is PRESENTATIONAL: it takes the live proof data + callbacks. The real
 * revision engine (AceRevisionRobot) opens via onRequestRevision; approval uses
 * the page's existing sign flow via onApprove; chat answers questions via
 * sprocket-helper (mode:"chat"). Tapping a suggestion pre-loads it into the
 * revision request so the customer can act on ACE's advice in one tap.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Check, Sparkles, RotateCw, ShoppingBag, Send, Loader2, Eye, Wand2, Mic, Square } from "lucide-react";

const ACE_IMG = "/characters/ace-engine.png";
const ACE_IMG_FALLBACK = "/characters/ace-smile.png";
const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

interface Angle { label: string; url: string; key: string; }
interface ChatMsg { role: "ace" | "you"; text: string; }

interface Props {
  token: string;
  customerName?: string | null;
  designName?: string | null;
  shopName?: string | null;
  vehicleLabel?: string | null;
  statusLabel: string;
  angles: Angle[];
  remaining: number;
  allowed: number;
  canRevise: boolean;
  onApprove: () => void;
  onRequestRevision: (seed?: string) => void;
  onOrder?: () => void;
  onZoom?: (url: string) => void;
}

function buildSuggestions(designName?: string | null): { icon: string; title: string; detail: string; seed: string }[] {
  return [
    { icon: "🎯", title: "Logo visibility", detail: "Make sure the logo reads clearly from across a parking lot.", seed: "Make the logo a bit larger and higher-contrast so it reads clearly from a distance." },
    { icon: "📞", title: "Phone number readability", detail: "Bump the phone/contact line so it's legible from ~20 ft.", seed: "Increase the size and contrast of the phone number / contact info so it's easy to read from 20 feet away." },
    { icon: "⚖️", title: "Passenger-side balance", detail: "Even out the graphics so both sides feel balanced.", seed: "Balance the graphics on the passenger side so it matches the driver side." },
  ];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export const AceProofStudio = ({
  token, customerName, designName, shopName, vehicleLabel, statusLabel,
  angles, remaining, allowed, canRevise,
  onApprove, onRequestRevision, onOrder, onZoom,
}: Props) => {
  const [heroIdx, setHeroIdx] = useState(0);
  const hero = angles[heroIdx] || angles[0];
  const suggestions = buildSuggestions(designName);

  const [chat, setChat] = useState<ChatMsg[]>([
    { role: "ace", text: `Hi ${customerName?.split(" ")[0] || "there"}! 👋 I'm ACE, your designer. Your wrap is looking great — I found a few things we could polish (see my suggestions). Type or talk to me and I'll make any change for you.` },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const aceScrollRef = useRef<HTMLDivElement>(null);
  const youScrollRef = useRef<HTMLDivElement>(null);

  const aceMsgs = chat.filter((m) => m.role === "ace");
  const youMsgs = chat.filter((m) => m.role === "you");

  useEffect(() => {
    aceScrollRef.current?.scrollTo({ top: aceScrollRef.current.scrollHeight, behavior: "smooth" });
    youScrollRef.current?.scrollTo({ top: youScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, thinking]);

  // ACE talks back in his Onyx voice (best-effort — silent if unavailable).
  const speak = async (text: string) => {
    try {
      const { data } = await supabase.functions.invoke("ace-speak", { body: { token, text } });
      const b64 = (data as any)?.audio_base64;
      if (!b64) return;
      const audio = new Audio(`data:${(data as any).mime || "audio/mpeg"};base64,${b64}`);
      audio.play().catch(() => {});
    } catch { /* voice is best-effort */ }
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    setChat((c) => [...c, { role: "you", text: msg }]);
    setInput("");
    setThinking(true);
    try {
      const { data } = await supabase.functions.invoke("sprocket-helper", {
        body: {
          mode: "chat",
          page: "/approve",
          context: { design: designName, vehicle: vehicleLabel, shop: shopName },
          messages: [...chat.map((m) => ({ role: m.role === "ace" ? "assistant" : "user", content: m.text })), { role: "user", content: msg }],
        },
      });
      const reply = (data as any)?.reply || "I'm here — want me to make a change for you? Tap “Request a revision”.";
      setChat((c) => [...c, { role: "ace", text: reply }]);
      speak(reply);
    } catch {
      setChat((c) => [...c, { role: "ace", text: "I had a brief hiccup — tap “Request a revision” and I'll get right on it." }]);
    } finally {
      setThinking(false);
    }
  };

  // ── Voice → text (talk to ACE). Records a clip and runs it through the
  //    ace-transcribe Whisper endpoint, dropping the transcript into the box. ──
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const toggleMic = async () => {
    setMicError(null);
    if (recording) { recRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError("Voice input isn't supported on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 800) return;
        setTranscribing(true);
        try {
          const b64 = await blobToBase64(blob);
          const { data } = await supabase.functions.invoke("ace-transcribe", {
            body: { token, audio_base64: b64, mime: blob.type },
          });
          const text = ((data as any)?.text || "").trim();
          if (text) setInput((prev) => (prev ? prev.trim() + " " : "") + text);
          else setMicError("Didn't catch that — try again.");
        } catch {
          setMicError("Couldn't transcribe — try again.");
        } finally {
          setTranscribing(false);
        }
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setMicError("Mic access denied. Allow the microphone to talk to ACE.");
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-5 py-4 space-y-4">

      {/* Compact greeting so the design canvas sits high (above the fold) */}
      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gradient-to-r from-blue-50 to-pink-50 px-4 py-3">
        <img src={ACE_IMG} onError={(e) => { (e.currentTarget as HTMLImageElement).src = ACE_IMG_FALLBACK; }} alt="ACE"
          className="w-14 h-14 object-contain drop-shadow shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-extrabold text-gray-900 leading-tight">Hi {customerName?.split(" ")[0] || "there"}! 👋</p>
          <p className="text-[13px] text-gray-600">Your design is looking great — I found {suggestions.length} things we can polish. Type or talk to me below.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 lg:items-start">

        {/* LEFT: design canvas (above the fold) + the two chat boxes under it */}
        <div className="space-y-4">

          {/* Design Preview — the canvas, shown first/above the scroll */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Eye className="w-4 h-4 text-gray-500" /> Design Preview</h2>
              <span className="text-[11px] font-semibold text-gray-400 truncate max-w-[55%]">{designName || "Your wrap design"}</span>
            </div>
            <div className="bg-gray-50">
              {hero ? (
                <img src={hero.url} alt={hero.label} onClick={() => onZoom?.(hero.url)}
                  className="w-full max-h-[52vh] object-contain cursor-zoom-in" />
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading your design…</div>
              )}
            </div>
            {angles.length > 1 && (
              <div className="flex gap-2 overflow-x-auto px-3 py-3">
                {angles.map((a, i) => (
                  <button key={a.key} onClick={() => setHeroIdx(i)}
                    className={cn("shrink-0 rounded-lg overflow-hidden border-2 w-20 h-14 bg-gray-50", i === heroIdx ? "border-blue-500" : "border-transparent hover:border-gray-300")}>
                    <img src={a.url} alt={a.label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Two chat boxes UNDER the canvas: ACE's voice (left) · You type/talk (right) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* ACE's voice / responses */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col h-[300px]">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100">
                <img src={ACE_IMG} onError={(e) => { (e.currentTarget as HTMLImageElement).src = ACE_IMG_FALLBACK; }} alt="" className="w-6 h-6 object-contain" />
                <h3 className="text-[13px] font-bold text-gray-900">A.C.E</h3>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-blue-500 font-semibold">his voice</span>
              </div>
              <div ref={aceScrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2">
                {aceMsgs.map((m, i) => (
                  <p key={i} className="text-[14px] text-gray-800 leading-relaxed bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2">{m.text}</p>
                ))}
                {thinking && (
                  <p className="text-[13px] text-gray-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> ACE is designing…</p>
                )}
              </div>
            </div>

            {/* You — type or talk */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col h-[300px]">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100">
                <h3 className="text-[13px] font-bold text-gray-900">You</h3>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-pink-500 font-semibold">type or talk</span>
              </div>
              <div ref={youScrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2">
                {youMsgs.length === 0 ? (
                  <p className="text-[12px] text-gray-400 italic">Ask a question or describe a change — e.g. “make the logo bigger”. Tap the mic to talk.</p>
                ) : youMsgs.map((m, i) => (
                  <p key={i} className="text-[14px] text-white leading-relaxed rounded-2xl rounded-br-sm px-3 py-2 ml-auto max-w-[95%] w-fit" style={{ background: GRADIENT }}>{m.text}</p>
                ))}
                {transcribing && (
                  <p className="text-[13px] text-gray-500 flex items-center gap-2 justify-end"><Loader2 className="w-3.5 h-3.5 animate-spin" /> transcribing…</p>
                )}
              </div>
              {micError && <p className="px-3.5 text-[11px] text-red-500">{micError}</p>}
              <div className="border-t border-gray-100 p-2.5">
                <div className="flex items-end gap-2">
                  <button onClick={toggleMic} disabled={transcribing}
                    title={recording ? "Stop recording" : "Talk to ACE"}
                    className={cn("h-11 w-11 shrink-0 rounded-xl flex items-center justify-center border transition-colors",
                      recording ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50")}>
                    {recording ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                    placeholder={recording ? "Listening…" : "Type to ACE…"}
                    className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-pink-400 max-h-24" />
                  <button onClick={() => send(input)} disabled={thinking || input.trim().length < 1}
                    className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-white disabled:opacity-40" style={{ background: GRADIENT }}>
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: details, suggestions, actions */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Project Details</h2>
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Design</dt><dd className="text-gray-900 font-semibold text-right">{designName || "Your wrap"}</dd></div>
              {vehicleLabel && <div className="flex justify-between gap-3"><dt className="text-gray-500">Vehicle</dt><dd className="text-gray-900 font-semibold text-right">{vehicleLabel}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Status</dt><dd className="text-gray-900 font-semibold text-right">{statusLabel}</dd></div>
              {allowed > 0 && <div className="flex justify-between gap-3"><dt className="text-gray-500">Revisions left</dt><dd className="text-blue-600 font-bold text-right">{remaining} / {allowed}</dd></div>}
            </dl>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-pink-500" /> ACE Suggestions</h2>
            <p className="text-[11px] text-gray-400 mb-3">Tap one and I'll make that change for you.</p>
            <div className="space-y-2">
              {suggestions.map((s) => (
                <button key={s.title} onClick={() => canRevise && onRequestRevision(s.seed)} disabled={!canRevise}
                  className="w-full text-left rounded-xl border border-gray-200 hover:border-pink-300 hover:bg-pink-50/40 transition-colors p-3 disabled:opacity-50 disabled:cursor-not-allowed group">
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg leading-none mt-0.5">{s.icon}</span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">{s.title}<Wand2 className="w-3 h-3 text-pink-400 opacity-0 group-hover:opacity-100" /></div>
                      <div className="text-[12px] text-gray-500 leading-snug">{s.detail}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-2.5">
            <button onClick={onApprove}
              className="w-full h-12 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-sm hover:brightness-110" style={{ background: GRADIENT }}>
              <Check className="w-5 h-5" /> Approve Design
            </button>
            <button onClick={() => onRequestRevision()} disabled={!canRevise}
              className="w-full h-11 rounded-xl border border-gray-300 bg-white text-gray-800 font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-50">
              <RotateCw className="w-4 h-4" /> Request a Revision{allowed > 0 ? ` (${remaining} left)` : ""}
            </button>
            {onOrder && (
              <button onClick={onOrder}
                className="w-full h-11 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold flex items-center justify-center gap-2 hover:bg-emerald-100">
                <ShoppingBag className="w-4 h-4" /> Order Production Pack
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
