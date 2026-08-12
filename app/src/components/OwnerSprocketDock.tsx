/**
 * OwnerSprocketDock — Trish's Sprocket Agent.
 *
 * A LEFT-docked, admin/owner-only operator agent (separate from the public
 * right-side "Sprocket · Design Agent" helper that everyone sees). This one can
 * actually DO things: when open on an ApprovePro order (/approvepro?id=…) it
 * drives the real order operator (approvepro-agent) — revise (surgical), send,
 * switch versions, read the thread, start over. Anywhere else it's a general
 * helper (sprocket-helper). It self-gates: nothing renders for non-admins.
 *
 * White UI per docs/WHITE_UI_STANDARD.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { Button } from "@/components/ui/button";
import { Loader2, Send, X, Bot, Mic, Volume2, VolumeX } from "lucide-react";

interface Msg { role: "user" | "assistant"; content: string; }

const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

export default function OwnerSprocketDock() {
  const location = useLocation();
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(() => {
    try { return !!localStorage.getItem("sprocket_dock_min"); } catch (_) { return false; }
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voice IN — talk to Sprocket; transcript appends to the input box.
  const voice = useSpeechToText((t) => setInput((p) => (p ? p + " " : "") + t));

  const stopSpeaking = () => {
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  };

  // Voice OUT — Sprocket speaks his replies in the SAME natural OpenAI "onyx"
  // voice as the customer ACE robot (sprocket-helper mode:"tts"), falling back
  // to the browser's robotic voice only if the API is unavailable.
  const speak = async (text: string) => {
    if (!voiceReplies) return;
    stopSpeaking();
    const clean = text.replace(/[#*_`>]/g, "").slice(0, 800);
    try {
      const { data } = await supabase.functions.invoke("sprocket-helper", { body: { mode: "tts", text: clean } });
      if (data?.audio_base64) {
        const a = new Audio(`data:${data.mime || "audio/mpeg"};base64,${data.audio_base64}`);
        audioRef.current = a;
        await a.play().catch(() => {});
        return;
      }
    } catch { /* fall through to browser TTS */ }
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(clean.slice(0, 600));
      u.rate = 1.0; u.pitch = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  // Self-gate: only the owner/admins see this dock.
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setAllowed(isAllowlistedAdmin(session?.user?.email));
    });
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAllowed(isAllowlistedAdmin(data.session?.user?.email));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  const proofId = () =>
    location.pathname.startsWith("/approvepro")
      ? new URLSearchParams(location.search).get("id")
      : null;

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || sending) return;
    const prior = [...messages];
    setMessages([...messages, { role: "user", content: msg }]);
    setInput("");
    setSending(true);
    try {
      // Always the operator brain: with an order → acts on it; without one →
      // queue mode ("what needs my attention?" across all the shop's orders).
      const pid = proofId();
      const { data, error } = await supabase.functions.invoke("sprocket-helper", {
        body: { mode: "operator", proof_id: pid || undefined, message: msg, history: prior.slice(-10) },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      const reply = (data as any)?.reply || "Done.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
      if (pid && Array.isArray((data as any)?.actions) && (data as any).actions.length > 0) {
        window.dispatchEvent(new CustomEvent("sprocket:order-changed", { detail: { proofId: pid } }));
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e?.message || "Network error"}` }]);
    } finally {
      setSending(false);
    }
  }

  if (!allowed) return null;

  const onOrder = !!proofId();

  // Sprocket's draft-and-approve flow ends his message with a go-ahead question
  // ("Just say the word!", "Approve, or want changes?", "Want me to queue…").
  // When his last message is awaiting that yes/no, show one-tap reply buttons so
  // the owner doesn't have to hunt for a place to type "yes".
  const lastMsg = messages[messages.length - 1];
  const awaitingGo =
    !sending &&
    lastMsg?.role === "assistant" &&
    /(just say the word|approve,? or|go ahead|shall i|should i|want me to|queue (that|the)|ready to|say the word|want another change|confirm|let me know|just the word)/i.test(
      lastMsg.content,
    );

  if (!open) {
    // Minimized-to-a-dot state persists — the pill was floating mid-content
    // and blocking cards/buttons on busy pages (owner: "chat bubble still
    // blocked site"). Corner dot only; expands on tap.
    if (minimized) {
      return (
        <button
          type="button"
          onClick={() => { setMinimized(false); try { localStorage.removeItem("sprocket_dock_min"); } catch (_) { /* ignore */ } }}
          aria-label="Show Sprocket Agent"
          title="Sprocket Agent"
          className="fixed z-[55] bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full text-white opacity-70 shadow-md hover:opacity-100"
          style={{ background: GRADIENT }}
        >
          <Bot className="h-4 w-4" />
        </button>
      );
    }
    return (
      <div className="fixed z-[55] bottom-3 left-3 flex items-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open your Sprocket Agent"
          className="flex items-center gap-2 rounded-full pl-2.5 pr-3 py-2 text-white shadow-lg hover:brightness-110"
          style={{ background: GRADIENT }}
        >
          <Bot className="w-5 h-5 shrink-0" />
          <span className="text-xs font-bold">Sprocket Agent</span>
        </button>
        <button
          type="button"
          onClick={() => { setMinimized(true); try { localStorage.setItem("sprocket_dock_min", "1"); } catch (_) { /* ignore */ } }}
          aria-label="Minimize Sprocket Agent"
          title="Minimize — tap the dot to bring it back"
          className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed z-[115] inset-x-2 bottom-24 top-2 sm:inset-x-auto sm:left-3 sm:top-3 sm:bottom-6 sm:w-[360px] flex flex-col rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 text-white shrink-0" style={{ background: GRADIENT }}>
        <Bot className="w-5 h-5" />
        <div className="leading-tight">
          <div className="text-sm font-bold">Sprocket Agent</div>
          <div className="text-[10px] opacity-90">{onOrder ? "Operating this order" : "Your queue"}</div>
        </div>
        <button
          type="button"
          onClick={() => { if (voiceReplies) stopSpeaking(); setVoiceReplies((v) => !v); }}
          className="ml-auto rounded-md hover:bg-white/20 p-1.5"
          title={voiceReplies ? "Sprocket is speaking replies — tap to mute" : "Tap so Sprocket speaks his replies"}
          aria-label="Toggle voice replies"
        >
          {voiceReplies ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md hover:bg-white/20 p-1" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50">
        {messages.length === 0 ? (
          <div className="text-[13px] text-gray-500 space-y-2">
            <p className="font-semibold text-gray-700">Hey Trish 👋 I'm your Sprocket Agent.</p>
            {onOrder ? (
              <>
                <p>You're on an order — I can run it for you. Try:</p>
                <div className="flex flex-col gap-1.5">
                  {["What's the status of this order?", "Remove the S — make it Wildcat", "Resend the proof to the customer", "Go back to v2"].map((ex) => (
                    <button key={ex} type="button" onClick={() => send(ex)} className="text-left text-[13px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2">{ex}</button>
                  ))}
                </div>
              </>
            ) : (
              <p>Open an order in ApprovePro and I can revise it, send proofs, switch versions, and read the customer thread for you. Ask me anything else here too.</p>
            )}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user"
                ? "max-w-[85%] rounded-2xl rounded-br-sm text-white text-[14px] leading-snug px-3 py-2 whitespace-pre-wrap"
                : "max-w-[85%] rounded-2xl rounded-bl-sm bg-white border border-gray-200 text-gray-800 text-[14px] leading-snug px-3 py-2 whitespace-pre-wrap"}
                style={m.role === "user" ? { background: GRADIENT } : undefined}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white border border-gray-200 px-3 py-2 text-gray-500 text-[13px] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sprocket is working…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 p-2.5 bg-white shrink-0" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
        {/* One-tap replies when Sprocket is waiting on your go-ahead — so there's
            always an obvious "reply" button, not just the text box. */}
        {awaitingGo && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => send("Yes — go ahead and do it.")}
              className="rounded-full px-3 py-1.5 text-[13px] font-bold text-white shadow-sm hover:brightness-110"
              style={{ background: GRADIENT }}
            >
              ✅ Yes — do it
            </button>
            <button
              type="button"
              onClick={() => setInput("Change this first: ")}
              className="rounded-full px-3 py-1.5 text-[13px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              ✏️ Tweak it
            </button>
            <button
              type="button"
              onClick={() => send("Not yet — hold off.")}
              className="rounded-full px-3 py-1.5 text-[13px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              ✋ Not yet
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {voice.supported && (
            <button
              type="button"
              onClick={voice.toggle}
              title="Talk to Sprocket"
              aria-label="Voice input"
              className={`h-11 w-11 shrink-0 flex items-center justify-center rounded-lg ${voice.listening ? "text-white animate-pulse" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              style={voice.listening ? { background: GRADIENT } : undefined}
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder={voice.listening ? "Listening…" : onOrder ? "Tell me what to do with this order…" : "Ask Sprocket — “what needs my attention?”"}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 max-h-28"
            disabled={sending}
          />
          <Button type="button" onClick={() => send(input)} disabled={sending || !input.trim()} className="h-11 w-11 shrink-0 p-0 text-white" style={{ background: GRADIENT }}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
