import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Mic, X, Send, Sparkles, Copy, RefreshCw, LifeBuoy, MessageCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * SprocketHelper — Sprocket, the persistent on-every-page AI helper.
 *
 * White-UI / on-brand (matches the customer-facing standard): white surface,
 * dark gray text, blue→magenta gradient as an accent only, Sprocket character.
 *
 * Real Claude-backed agent (sprocket-helper edge fn): answers + coaches, an
 * on-the-spot prompt engineer (ace-prompt-engineer), and a one-tap trouble
 * ticket (helper_tickets) that notifies the user by email/SMS when it's fixed.
 *
 * Mounted once globally in App.tsx so it follows the user across every page.
 */

type Msg = { role: "user" | "assistant"; content: string };
type Tab = "ask" | "prompt" | "ticket";

const GREETING =
  "Hey, I'm Sprocket 👋 Ask me anything — how to create a design, design help, or report a problem. Hit a design wall? Tap Upgrade my prompt and I'll engineer a stronger version of exactly what you typed.";

// Brand gradient (blue → magenta), used as an ACCENT only.
const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

export default function SprocketHelper() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ask");

  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typed, setTyped] = useState("");
  const greetingDone = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [rawPrompt, setRawPrompt] = useState("");
  const [upgraded, setUpgraded] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  const [phone, setPhone] = useState("");
  const [filing, setFiling] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [minimized, setMinimized] = useState(() => {
    try { return !!localStorage.getItem("sprocket_helper_min"); } catch (_) { return false; }
  });

  // Admins/owners get the more capable left-docked OwnerSprocketDock, so hide
  // this public right-side helper for them — otherwise two Sprockets render.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setIsAdmin(isAllowlistedAdmin(data.session?.user?.email));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setIsAdmin(isAllowlistedAdmin(session?.user?.email));
    });
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const conversationId = useRef(
    globalThis.crypto?.randomUUID?.() ?? `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const askVoice = useSpeechToText((t) => setInput((p) => (p ? p + " " : "") + t));
  const promptVoice = useSpeechToText((t) => setRawPrompt((p) => (p ? p + " " : "") + t));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, tab, typed]);

  // Typewriter: type out Sprocket's greeting the first time the panel opens.
  useEffect(() => {
    if (!open || greetingDone.current) return;
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setTyped(GREETING.slice(0, i));
      if (i >= GREETING.length) {
        clearInterval(id);
        greetingDone.current = true;
        setTyped(GREETING);
      }
    }, 24);
    return () => clearInterval(id);
  }, [open]);

  // Proactive initiation: after a few seconds, Sprocket pops a one-time nudge
  // bubble inviting the visitor to chat (works logged-out, e.g. on the landing
  // page). Dismissed/opened once → it won't nag again this session.
  useEffect(() => {
    if (open) return;
    if (localStorage.getItem("sprocket_nudged")) return;
    const t = setTimeout(() => setNudge(true), 6000);
    return () => clearTimeout(t);
  }, [open]);

  function openChat() {
    setOpen(true);
    setNudge(false);
    try { localStorage.setItem("sprocket_nudged", "1"); } catch (_) { /* ignore */ }
  }
  function dismissNudge() {
    setNudge(false);
    try { localStorage.setItem("sprocket_nudged", "1"); } catch (_) { /* ignore */ }
  }

  async function getUser() {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    return { id: u?.id, email: u?.email };
  }

  async function sendChat() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const user = await getUser();
      const { data, error } = await supabase.functions.invoke("sprocket-helper", {
        body: { mode: "chat", messages: next, page: location.pathname, user, conversation_id: conversationId.current },
      });
      if (error) throw error;
      setMessages([...next, { role: "assistant", content: data?.reply || "…" }]);
    } catch (e) {
      setMessages([
        ...next,
        { role: "assistant", content: "I hit a snag reaching my brain. Try again, or send a ticket and a human will jump in." },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function upgradePrompt() {
    const text = rawPrompt.trim();
    if (!text || upgrading) return;
    setUpgrading(true);
    setUpgraded("");
    try {
      const { data, error } = await supabase.functions.invoke("ace-prompt-engineer", {
        body: { mode: "restyle", prompt: text },
      });
      if (error) throw error;
      setUpgraded(data?.enhancedPrompt || text);
    } catch (e) {
      toast.error("Couldn't upgrade that prompt — try again in a moment.");
    } finally {
      setUpgrading(false);
    }
  }

  async function fileTicket() {
    if (filing) return;
    setFiling(true);
    try {
      const user = await getUser();
      const summary =
        [...messages].reverse().find((m) => m.role === "user")?.content?.slice(0, 120) ||
        "Help request from Sprocket";
      const { data, error } = await supabase.functions.invoke("sprocket-helper", {
        body: {
          mode: "ticket",
          summary,
          category: "bug",
          messages,
          page: location.pathname,
          contact_phone: phone.trim() || undefined,
          conversation_id: conversationId.current,
          user,
        },
      });
      if (error) throw error;
      toast.success("Ticket sent! We'll email" + (phone.trim() ? " & text" : "") + " you the moment it's fixed.");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "✅ Ticket filed. You'll be notified automatically when the fix is live. Anything else I can help with?" },
      ]);
      setTab("ask");
      setPhone("");
    } catch (e) {
      toast.error("Couldn't file the ticket — please try again.");
    } finally {
      setFiling(false);
    }
  }

  // Starter options Sprocket offers up front. "Report a problem" jumps to the
  // ticket tab; the rest seed the Ask box.
  const QUICK: { label: string; action: () => void }[] = [
    { label: "How do I create a design?", action: () => setInput("How do I create a design?") },
    { label: "I need design help", action: () => setInput("I need design help with my wrap") },
    { label: "Report a problem", action: () => setTab("ticket") },
  ];

  // Owners/admins use OwnerSprocketDock instead — hide this one for them.
  if (isAdmin) return null;

  return (
    <>
      {/* Launcher — alive (floats + online dot) + proactive nudge bubble so it reads as clickable and starts the conversation */}
      {!open && minimized && (
        <button
          type="button"
          onClick={() => { setMinimized(false); try { localStorage.removeItem("sprocket_helper_min"); } catch (_) { /* ignore */ } }}
          aria-label="Show Sprocket Design Agent"
          title="Sprocket · Design Agent"
          className="fixed bottom-3 right-3 z-40 flex h-9 w-9 items-center justify-center rounded-full text-white opacity-70 shadow-md hover:opacity-100"
          style={{ background: GRADIENT }}
        >
          <span className="text-sm">💬</span>
        </button>
      )}
      {!open && !minimized && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex flex-col items-end gap-2">
          {nudge && (
            <div className="relative max-w-[250px] rounded-2xl rounded-br-sm bg-white shadow-xl border border-gray-200 px-3.5 py-2.5">
              <button
                onClick={dismissNudge}
                aria-label="Dismiss"
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-900 text-white text-xs leading-none flex items-center justify-center"
              >
                ×
              </button>
              <button onClick={openChat} className="text-left text-sm text-gray-800">
                <span className="font-bold">Need help with your design? 👋</span> Tap to ask me anything — I'm Sprocket, your AI Design Agent.
              </button>
            </div>
          )}
          <button
            onClick={openChat}
            aria-label="Ask Sprocket, the Design Agent"
            className="flex items-center gap-2.5 rounded-full pl-2 pr-5 py-2 text-white shadow-lg hover:shadow-2xl transition-shadow"
            style={{ background: GRADIENT, animation: "float 3s ease-in-out infinite" }}
          >
            <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-white shrink-0">
              <img src="/characters/sproket-laptop.png" alt="" className="w-10 h-10 object-contain" />
              <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-green-400 ring-2 ring-white animate-pulse" />
            </span>
            <span className="text-left leading-tight">
              <span className="block text-[10px] font-bold uppercase tracking-wider opacity-90">Questions?</span>
              <span className="block text-sm font-bold">Sprocket · Design Agent</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMinimized(true); setNudge(false); try { localStorage.setItem("sprocket_helper_min", "1"); } catch (_) { /* ignore */ } }}
            aria-label="Minimize Sprocket"
            title="Minimize — tap the corner dot to bring it back"
            className="-mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black"
          >
            ×
          </button>
        </div>
      )}

      {open && (
        <div className="fixed bottom-20 right-2 left-2 md:bottom-6 md:right-6 md:left-auto md:w-[400px] z-[60] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden max-h-[78vh]">
          {/* Header — light: gradient bar on top; thin BLACK→MAGENTA bar underneath as the break (no heavy black outline). */}
          <div className="relative px-4 pt-3 pb-2.5 bg-white">
            <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: GRADIENT }} />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-12 h-12 rounded-full shrink-0" style={{ background: GRADIENT }}>
                  <span className="flex items-center justify-center w-[44px] h-[44px] rounded-full bg-white">
                    <img src="/characters/sproket-laptop.png" alt="" className="w-10 h-10 object-contain" />
                  </span>
                </span>
                <div>
                  <div className="text-gray-900 font-bold text-lg leading-tight">Sprocket</div>
                  <div className="text-xs text-gray-500 leading-tight">Design Agent</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* break: thin blue gradient bar */}
            <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: "linear-gradient(90deg,#3b82f6,#00C7FF)" }} />
          </div>

          {/* Tabs — colored buttons: Ask=blue, Upgrade prompt=gradient, Problem Ticket=red */}
          <div className="flex gap-1.5 px-2 pt-2.5 pb-2 bg-white border-b border-gray-100">
            {([
              ["ask", "Ask", MessageCircle, "#2563eb"],
              ["prompt", "Upgrade prompt", Sparkles, GRADIENT],
              ["ticket", "Problem Ticket!", LifeBuoy, "#dc2626"],
            ] as [Tab, string, any, string][]).map(([key, label, Icon, bg]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-lg py-2 px-1 text-[11px] font-bold text-white transition-all ${
                    active ? "shadow-md opacity-100 scale-[1.03]" : "opacity-70 hover:opacity-100"
                  }`}
                  style={{ background: bg }}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" /> {label}
                </button>
              );
            })}
          </div>

          {/* ---------------------------------------------------------- ASK */}
          {tab === "ask" && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-white">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap"
                      style={
                        m.role === "user"
                          ? { background: GRADIENT, color: "#fff" }
                          : undefined
                      }
                    >
                      <span className={m.role === "user" ? "" : "text-gray-800"}>
                        {i === 0 && m.role === "assistant" ? typed : m.content}
                        {i === 0 && m.role === "assistant" && typed.length < GREETING.length && (
                          <span className="animate-pulse">▍</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-600 rounded-2xl px-3 py-2 text-sm flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sprocket is thinking…
                    </div>
                  </div>
                )}
                {messages.length <= 1 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {QUICK.map((q) => (
                      <button
                        key={q.label}
                        onClick={q.action}
                        className="text-[11px] rounded-full px-2.5 py-1 bg-black text-white font-medium hover:opacity-90"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 px-3 pb-1 bg-white">
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
                  title="Reload to get the latest version"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh now
                </button>
              </div>

              <div className="flex items-end gap-2 p-3 border-t border-gray-100 bg-white">
                {askVoice.supported && (
                  <button
                    onClick={askVoice.toggle}
                    title="Speak"
                    className={`p-2 rounded-lg ${askVoice.listening ? "text-white animate-pulse" : "bg-gray-100 text-gray-600"}`}
                    style={askVoice.listening ? { background: GRADIENT } : undefined}
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  rows={1}
                  placeholder={askVoice.listening ? "Listening…" : "Ask Sprocket anything…"}
                  className="flex-1 resize-none rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 max-h-28"
                />
                <Button size="icon" onClick={sendChat} disabled={sending || !input.trim()} className="shrink-0 text-white" style={{ background: GRADIENT }}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}

          {/* ------------------------------------------------------ UPGRADE */}
          {tab === "prompt" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-white">
              <div className="flex items-center gap-2">
                <img src="/characters/ace.png" alt="Ace" className="w-9 h-9 object-contain shrink-0" />
                <p className="text-xs text-gray-600">
                  Hitting a design wall? Paste or 🎤 talk your prompt — <span className="font-semibold text-gray-900">Ace</span>, our prompt engineer, rewrites it into a stronger version of exactly what you wrote.
                </p>
              </div>
              <div className="relative">
                <textarea
                  value={rawPrompt}
                  onChange={(e) => setRawPrompt(e.target.value)}
                  rows={4}
                  placeholder={promptVoice.listening ? "Listening…" : "e.g. blue cybertruck with American flag"}
                  className="w-full resize-none rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
                />
                {promptVoice.supported && (
                  <button
                    onClick={promptVoice.toggle}
                    title="Speak your prompt"
                    className={`absolute bottom-2 right-2 p-1.5 rounded-lg ${promptVoice.listening ? "text-white animate-pulse" : "bg-gray-100 text-gray-600"}`}
                    style={promptVoice.listening ? { background: GRADIENT } : undefined}
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button onClick={upgradePrompt} disabled={upgrading || !rawPrompt.trim()} className="w-full text-white" style={{ background: GRADIENT }}>
                {upgrading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Engineering…</> : <><Sparkles className="w-4 h-4 mr-2" /> Upgrade my prompt</>}
              </Button>

              {upgraded && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Upgraded prompt</div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{upgraded}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(upgraded);
                      toast.success("Copied — paste it into your design tool.");
                    }}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* -------------------------------------------------------- TICKET */}
          {tab === "ticket" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-white">
              <p className="text-xs text-gray-600">
                Something broken or stuck? Send a ticket — we'll email you (and text, if you add a number) the moment it's fixed.
              </p>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Mobile # for a text update (optional)"
                className="w-full rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
              />
              <Button onClick={fileTicket} disabled={filing} className="w-full text-white" style={{ background: GRADIENT }}>
                {filing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><LifeBuoy className="w-4 h-4 mr-2" /> Send a ticket</>}
              </Button>
              <p className="text-[11px] text-gray-400">
                Your recent chat with Sprocket is attached so the team has full context.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
