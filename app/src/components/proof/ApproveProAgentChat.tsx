/**
 * ApproveProAgentChat — talk to A.C.E about the selected order.
 *
 * A floating chat panel in the ApprovePro workbench. The shop types plain
 * English ("remove the S in Wildcats", "send rebecca the proof", "go back to
 * v2") and A.C.E executes the real platform actions via the shared
 * sprocket-operator brain (sprocket-helper mode:"operator", Claude tool-use →
 * surgical revise / send / reply / switch version / start over — the SAME
 * engine OwnerSprocketDock uses). After any action it calls onActed() so the
 * version list refreshes.
 *
 * Voice: the shop can TALK to A.C.E (mic → speech-to-text, appended to the
 * input) and LISTEN to A.C.E's replies (click-to-listen on any reply, plus
 * auto-speak of the latest reply). A.C.E's voice is the same OpenAI "onyx"
 * voice used by AceRevisionRobot (sprocket-helper mode:"tts"), with a browser
 * speechSynthesis fallback when the API is unavailable.
 *
 * White UI per docs/WHITE_UI_STANDARD.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, X, Mic, Volume2, VolumeX } from "lucide-react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

interface Msg { role: "user" | "assistant"; content: string; }

interface Props {
  proofId: string;
  designName?: string | null;
  customerName?: string | null;
  /** Called after A.C.E takes an action that may change the order (revise,
   *  switch version, start over) so the workbench can refresh. */
  onActed?: () => void;
  /** Bump this (e.g. from a "Revise with A.C.E" button) to OPEN the panel from
   *  outside. Each new value re-opens it. */
  openSignal?: number;
  /** When opened via openSignal, prefill the input with this text and focus it
   *  (e.g. "Revise the current design: ") so the shop can prompt A.C.E directly. */
  seedInput?: string;
}

const EXAMPLES = [
  "What's the status of this order?",
  "Remove the S — make it Wildcat",
  "Add the sponsor logo to the rear",
  "Resend the proof to the customer",
];

// Always-visible one-tap operator actions. The "draft" actions ask A.C.E to
// WRITE a customer-facing message and show it for approval — it never sends on
// its own (the operator requires an explicit yes before reply/send).
const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Status", prompt: "What's the status of this order?" },
  { label: "Latest messages", prompt: "Show me the latest messages from the customer." },
  { label: "Suggest update", prompt: "Draft a friendly update message to the customer about where their order stands. Show it to me to approve — don't send it yet." },
  { label: "Suggest 'ready' note", prompt: "Draft a warm message telling the customer their proof is ready to review and approve. Show it to me first — don't send yet." },
];

// Prefer a deep/robotic voice for A.C.E (approximating an "onyx"-style voice)
// from whatever the browser offers — matches AceRevisionRobot's pick.
function pickAceVoice(): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis?.getVoices?.() || [];
    const byName = vs.find((v) => /onyx|daniel|google uk english male|microsoft guy|fred|arthur|male/i.test(v.name));
    return byName || vs.find((v) => /en[-_]/i.test(v.lang)) || vs[0] || null;
  } catch { return null; }
}

export const ApproveProAgentChat = ({ proofId, designName, customerName, onActed, openSignal, seedInput }: Props) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  // Index of the assistant message currently being spoken (for the speaker UI).
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Talk-to-text: append each final transcript phrase to the input box.
  const mic = useSpeechToText((t) => setInput((p) => (p ? p + " " : "") + t));

  // Reset the conversation when the staff switches to a different order.
  useEffect(() => { setMessages([]); setInput(""); stopSpeaking(); }, [proofId]);

  // External open trigger (the detail-pane "Revise with A.C.E" button): open
  // the panel, prefill the seed prompt, and focus the input so the shop can
  // immediately dictate or type the precise edit.
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    if (seedInput != null) setInput(seedInput);
    setTimeout(() => { try { inputRef.current?.focus(); } catch { /* ignore */ } }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // Browser voices load async on some platforms — keep our pick fresh.
  useEffect(() => {
    try { window.speechSynthesis.onvoiceschanged = () => { voiceRef.current = pickAceVoice(); }; } catch { /* ignore */ }
  }, []);

  // Stop any in-flight audio when the panel closes or the component unmounts.
  useEffect(() => { if (!open) stopSpeaking(); }, [open]);
  useEffect(() => () => stopSpeaking(), []);

  function stopSpeaking() {
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setSpeakingIdx(null);
  }

  // A.C.E's voice = OpenAI "onyx" (deep, warm) via sprocket-helper mode:"tts".
  // Falls back to the browser's deepest voice if the API is unavailable.
  const speak = async (text: string, idx: number | null) => {
    stopSpeaking();
    const clean = text.replace(/[#*_`>“”]/g, "").trim();
    if (!clean) return;
    setSpeakingIdx(idx);
    try {
      const { data } = await supabase.functions.invoke("sprocket-helper", { body: { mode: "tts", text: clean.slice(0, 600) } });
      if (data?.audio_base64) {
        const a = new Audio(`data:${data.mime || "audio/mpeg"};base64,${data.audio_base64}`);
        audioRef.current = a;
        a.onended = () => setSpeakingIdx(null);
        await a.play().catch(() => {});
        return;
      }
    } catch { /* fall through to browser TTS */ }
    if (typeof window === "undefined" || !window.speechSynthesis) { setSpeakingIdx(null); return; }
    try {
      const u = new SpeechSynthesisUtterance(clean.slice(0, 400));
      if (!voiceRef.current) voiceRef.current = pickAceVoice();
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 0.98; u.pitch = 0.9;
      u.onend = () => setSpeakingIdx(null);
      window.speechSynthesis.speak(u);
    } catch { setSpeakingIdx(null); }
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    if (mic.listening) mic.toggle();
    const next = [...messages, { role: "user" as const, content: msg }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      // The real, shared A.C.E (AI Creative Engine) brain: sprocket-operator's
      // Claude tool-use agent, exposed as sprocket-helper mode:"operator" (the
      // SAME endpoint OwnerSprocketDock uses). ORDER mode (proof_id) → act on
      // this order: get_status, read_conversation, revise_design (surgical),
      // reply_to_customer, send_proof_to_customer, switch_version,
      // start_over_from_brief. Returns { reply, actions }.
      const { data, error } = await supabase.functions.invoke("sprocket-helper", {
        body: { mode: "operator", proof_id: proofId, message: msg, history: messages.slice(-10) },
      });
      if (error || (data as any)?.error) {
        const reply = `⚠️ ${(data as any)?.error || error?.message || "Something went wrong."}`;
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } else {
        const reply = (data as any)?.reply || "Done.";
        setMessages((m) => {
          const out = [...m, { role: "assistant" as const, content: reply }];
          if (!muted) speak(reply, out.length - 1); // auto-speak A.C.E's latest reply
          return out;
        });
        if (Array.isArray((data as any)?.actions) && (data as any).actions.length > 0) onActed?.();
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e?.message || "Network error"}` }]);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[110] flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white pl-2 pr-4 h-12 shadow-lg hover:brightness-110"
        title="Ask A.C.E — AI Creative Engine — to design, revise, send, or manage this order"
      >
        <img
          src="/characters/ace-engine.png"
          alt="A.C.E — AI Creative Engine"
          className="w-8 h-8 rounded-full object-cover bg-white/20"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <span className="text-sm font-bold leading-tight text-left">Ask A.C.E<span className="block text-[9px] font-semibold opacity-90 -mt-0.5">AI Creative Engine</span></span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[110] w-[min(94vw,380px)] h-[min(80vh,560px)] flex flex-col rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shrink-0">
        <img
          src="/characters/ace-engine.png"
          alt="A.C.E — AI Creative Engine"
          className="w-8 h-8 rounded-full object-cover bg-white/20 shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div className="leading-tight min-w-0">
          <div className="text-sm font-bold">A.C.E <span className="font-semibold opacity-90">— AI Creative Engine</span></div>
          <div className="text-[10px] opacity-90 truncate max-w-[200px]">{designName || "this order"}{customerName ? ` · ${customerName}` : ""}</div>
        </div>
        <button
          type="button"
          onClick={() => { if (muted) { setMuted(false); } else { stopSpeaking(); setMuted(true); } }}
          className="ml-auto rounded-md hover:bg-white/20 p-1"
          aria-label={muted ? "Unmute A.C.E" : "Mute A.C.E"}
          title={muted ? "Unmute A.C.E's voice" : "Mute A.C.E's voice"}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => { stopSpeaking(); setOpen(false); }} className="rounded-md hover:bg-white/20 p-1" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50">
        {messages.length === 0 ? (
          <div className="text-[13px] text-gray-500 space-y-3">
            <p>Tell me what to do with this order — type it or tap the mic and talk. For example:</p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => send(ex)}
                  className="text-left text-[13px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2">{ex}</button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">Revisions are surgical (they keep the wrap). I’ll always confirm before emailing the customer.</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {m.role === "assistant" ? (
                <div className="max-w-[85%] flex items-start gap-1.5">
                  <div className="rounded-2xl rounded-bl-sm bg-white border border-gray-200 text-gray-800 text-[14px] leading-snug px-3 py-2 whitespace-pre-wrap">{m.content}</div>
                  <button
                    type="button"
                    onClick={() => (speakingIdx === i ? stopSpeaking() : speak(m.content, i))}
                    className={`mt-1 shrink-0 rounded-md p-1 ${speakingIdx === i ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"}`}
                    aria-label={speakingIdx === i ? "Stop listening" : "Listen to A.C.E"}
                    title={speakingIdx === i ? "Stop" : "Listen"}
                  >
                    {speakingIdx === i ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ) : (
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 text-white text-[14px] leading-snug px-3 py-2 whitespace-pre-wrap">{m.content}</div>
              )}
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white border border-gray-200 px-3 py-2 text-gray-500 text-[13px] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> A.C.E is working…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 p-2.5 bg-white shrink-0">
        {/* One-tap operator actions — incl. A.C.E-drafted customer messages
            (proposed for approval, never auto-sent). */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => send(qa.prompt)}
              disabled={sending}
              className="shrink-0 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 text-[11px] font-semibold px-3 h-7 disabled:opacity-40"
            >
              {qa.label}
            </button>
          ))}
        </div>
        {mic.listening && (
          <div className="mb-1.5 flex items-center gap-2 text-[12px] text-pink-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pink-500" />
            </span>
            Listening… speak now, tap the mic when done.
          </div>
        )}
        <div className="flex items-end gap-2">
          {mic.supported && (
            <Button
              type="button"
              onClick={() => mic.toggle()}
              disabled={sending}
              className={`h-11 w-11 shrink-0 p-0 ${mic.listening ? "bg-pink-600 hover:bg-pink-700 text-white animate-pulse" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
              aria-label={mic.listening ? "Stop talking" : "Talk to A.C.E"}
              title={mic.listening ? "Stop listening" : "Talk to A.C.E"}
            >
              <Mic className="w-5 h-5" />
            </Button>
          )}
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mic.listening ? "Listening…" : "Tell A.C.E what to do…"}
            className="min-h-[42px] max-h-28 text-[15px] border-gray-200 bg-white text-gray-900 resize-none"
            disabled={sending}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          />
          <Button type="button" onClick={() => send(input)} disabled={sending || input.trim().length === 0}
            className="h-11 w-11 shrink-0 p-0 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
};
