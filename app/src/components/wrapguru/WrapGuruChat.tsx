import { useEffect, useMemo, useRef, useState } from "react";
import { Send, X, MessageCircle, Paperclip, Loader2 } from "lucide-react";
import { renderClient as supabase } from "@/integrations/supabase/renderClient";

/**
 * WrapGuruChat — branded, commercial-style chat box on the wpw-sales-chat
 * backend, in the DARK UI (WrapCommand-style): near-black shell, magenta →
 * purple gradient, light text. This is a deliberate exception to the WHITE UI
 * standard — the chat is a widget that also embeds on weprintwraps.com, and it
 * reads as a product surface rather than a page.
 *
 * Features a live avatar + online status, quick-reply suggestion chips,
 * animated typing dots, per-message timestamps, and — the lead magnet — a real
 * FILE UPLOAD: the visitor attaches artwork, it lands in the private
 * `wrapguru-files` bucket, and wpw-sales-chat's `check_artwork` tool runs the
 * true byte-level print check (dimensions, DPI vs wrap size, color space) and
 * comes back with either a cart link or a paid path to fix it.
 *
 * Two layouts:
 *   - variant="inline"   → a full chat card you drop into a page/section
 *   - variant="floating" → a bottom-right bubble that opens the same card
 *
 * Persists the session in sessionStorage and forwards page_path + referrer so
 * every turn is logged + geo-located server-side (see wpw-sales-chat).
 */

type Msg = { role: "user" | "assistant"; content: string; at?: number };
type Upload = { path: string; name: string; size: number };

const GRADIENT = "linear-gradient(90deg,#e6007e,#7c3aed)";
const SKEY = "wrapguru.chat.v1";

// Dark-pro palette (mirrors the admin console shell).
const C = {
  shell: "#0f1020",
  head: "#0a0a14",
  card: "#16213e",
  input: "#0f3460",
  border: "rgba(139,92,246,0.28)",
  text: "#e8eaf6",
  muted: "#94a3b8",
};

const GREETING =
  "Hey! I'm WrapGuru 👋 I can price printed wrap film instantly, check your print file, or answer anything about your order. What are you working on?";

const SUGGESTIONS = [
  "💲 Price my wrap",
  "📐 How much vinyl do I need?",
  "🖼️ Check my design file",
  "🚚 Turnaround & shipping",
];

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.psd,.ai,.eps,.tif,.tiff";
const MAX_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_UPLOADS = 5; // per session — same guard the WrapCommand widget used

function useSession() {
  return useMemo(() => {
    try {
      let sid = sessionStorage.getItem(SKEY + ".sid");
      if (!sid) {
        sid = "wg-" + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SKEY + ".sid", sid);
      }
      return sid;
    } catch {
      return "wg-anon";
    }
  }, []);
}

function fmtClock(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Render [text](url) + bare URLs; add-to-cart and recreate links become CTAs.
function renderBody(s: string) {
  // Buy links are PRODUCT PAGES (/our-products/…) — these products are
  // configurators, so a raw /cart/?add-to-cart= URL adds nothing. Keep the
  // legacy pattern matching so old transcripts still render as CTAs.
  const isCta = (u: string) => /our-products|add-to-cart|recreatepro/.test(u);
  let h = escapeHtml(s);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) =>
    `<a href="${u}" class="${isCta(u) ? "wg-cta" : "wg-link"}" target="_blank" rel="noopener">${t}</a>`);
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, u) => {
    const label = /our-products|add-to-cart/.test(u)
      ? "Order this material →"
      : /recreatepro/.test(u)
        ? "Get a recreate →"
        : u.replace(/^https?:\/\//, "");
    return `${pre}<a href="${u}" class="${isCta(u) ? "wg-cta" : "wg-link"}" target="_blank" rel="noopener">${label}</a>`;
  });
  return h;
}

function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: GRADIENT }}
    >
      <MessageCircle className="text-white" style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

function ChatCard({ onClose }: { onClose?: () => void }) {
  const sessionId = useSession();
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const saved = sessionStorage.getItem(SKEY);
      if (saved) return JSON.parse(saved).slice(-30);
    } catch { /* ignore */ }
    return [{ role: "assistant", content: GREETING, at: Date.now() }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(SKEY, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, uploading]);

  const showChips = !busy && !uploading && !messages.some((m) => m.role === "user");

  // `upload` rides along with the turn so the server can run check_artwork
  // against a file the visitor actually attached (never one the model invents).
  async function send(preset?: string, upload?: Upload) {
    const text = (preset ?? input).trim();
    if ((!text && !upload) || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text, at: Date.now() }];
    setMessages(next);
    if (!preset) setInput("");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("wpw-sales-chat", {
        body: {
          message: text,
          session_id: sessionId,
          history: next.filter((m) => m.content !== GREETING).slice(-10).map((m) => ({ role: m.role, content: m.content })),
          page_path: (location.pathname + location.search).slice(0, 300),
          referrer: (document.referrer || "").slice(0, 400),
          ...(upload ? { upload } : {}),
        },
      });
      if (error) throw error;
      const reply = data?.reply || "Sorry — hiccup on my end. Call us at 549-622-4678 or try again.";
      setMessages([...next, { role: "assistant", content: reply, at: Date.now() }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Connection hiccup — try again, or call 549-622-4678.", at: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    const say = (t: string) =>
      setMessages((prev) => [...prev, { role: "assistant", content: t, at: Date.now() }]);

    if (uploadCount >= MAX_UPLOADS) {
      say("You've hit the upload limit for this session. Email the file to design@weprintwraps.com and the team will take it from there.");
      return;
    }
    if (file.size > MAX_BYTES) {
      say(`That file is ${fmtSize(file.size)} — over the 50MB limit. Compress it, or email it to design@weprintwraps.com.`);
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!ACCEPT.includes(`.${ext}`)) {
      say(`I can't read .${ext} files. Send a PDF, AI, EPS, PNG, JPG, TIFF or PSD.`);
      return;
    }

    setUploading(true);
    try {
      // Private bucket: the visitor can write into uploads/ but never read it.
      // wrapguru-file-check signs the object server-side to parse the bytes.
      const path = `uploads/${sessionId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage
        .from("wrapguru-files")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;

      setUploadCount((n) => n + 1);
      await send(`I've attached my artwork: ${file.name} (${fmtSize(file.size)}). Can you check if it will print?`, {
        path,
        name: file.name,
        size: file.size,
      });
    } catch {
      say("That upload didn't go through. Try again, or email the file to design@weprintwraps.com.");
    } finally {
      setUploading(false);
    }
  }

  const disabled = busy || uploading;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ background: C.shell, color: C.text }}>
      {/* header */}
      <div className="relative px-4 py-3 flex items-center gap-2.5" style={{ background: C.head }}>
        <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: GRADIENT }} />
        <span className="relative">
          <Avatar size={36} />
          <span className="absolute -right-0 -bottom-0 w-3 h-3 rounded-full bg-emerald-400" style={{ boxShadow: `0 0 0 2px ${C.head}` }} />
        </span>
        <div className="leading-tight">
          <div className="font-extrabold text-sm text-white">WrapGuru</div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Online · replies instantly
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close chat" className="ml-auto p-1 text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <Avatar size={26} />}
            <div className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}>
              {m.role === "user" ? (
                <div
                  className="rounded-2xl rounded-br-sm px-3 py-2 text-sm text-white whitespace-pre-wrap"
                  style={{ background: GRADIENT }}
                >
                  {m.content}
                </div>
              ) : (
                <div
                  className="wg-a rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap"
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                  dangerouslySetInnerHTML={{ __html: renderBody(m.content) }}
                />
              )}
              <span className="text-[10px] mt-0.5 px-1" style={{ color: C.muted }}>{fmtClock(m.at)}</span>
            </div>
          </div>
        ))}

        {(busy || uploading) && (
          <div className="flex gap-2 justify-start items-center">
            <Avatar size={26} />
            <div className="rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: C.muted }} />
                  <span className="text-[12px]" style={{ color: C.muted }}>Uploading your file…</span>
                </>
              ) : (
                <span className="wg-typing"><i /><i /><i /></span>
              )}
            </div>
          </div>
        )}

        {showChips && (
          <div className="flex flex-wrap gap-2 pt-1 pl-8">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => (s.includes("design file") ? fileRef.current?.click() : send(s.replace(/^\S+\s/, "")))}
                className="text-[12.5px] font-medium rounded-full px-3 py-1.5 transition-colors hover:border-pink-500"
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="flex items-center gap-2 p-2.5" style={{ borderTop: `1px solid ${C.border}`, background: C.head }}>
        <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach artwork for a free print check"
          title="Attach artwork for a free print check"
          className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 hover:text-white"
          style={{ background: C.input, color: C.muted, border: `1px solid ${C.border}` }}
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          className="flex-1 min-w-0 h-11 rounded-xl px-3 text-sm focus:outline-none"
          style={{ background: C.input, border: `1px solid ${C.border}`, color: C.text }}
        />
        <button
          onClick={() => send()}
          disabled={disabled || !input.trim()}
          aria-label="Send"
          className="h-11 w-11 shrink-0 rounded-xl text-white flex items-center justify-center disabled:opacity-50"
          style={{ background: GRADIENT }}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <div className="text-center text-[10px] pb-2" style={{ background: C.head, color: C.muted }}>
        Powered by <span className="font-semibold" style={{ color: C.text }}>WrapGuru</span> · We Print Wraps
      </div>

      <style>{`
        .wg-a .wg-link{color:#60a5fa;font-weight:600;text-decoration:underline;}
        .wg-a .wg-cta{background:${GRADIENT};margin-top:8px;display:inline-block;color:#fff;font-weight:800;font-size:13px;padding:8px 14px;border-radius:8px;text-decoration:none;}
        .wg-typing{display:inline-flex;gap:4px;align-items:center;height:14px;}
        .wg-typing i{width:6px;height:6px;border-radius:50%;background:#7c8299;display:inline-block;animation:wg-bounce 1.2s infinite ease-in-out;}
        .wg-typing i:nth-child(2){animation-delay:.15s;}
        .wg-typing i:nth-child(3){animation-delay:.3s;}
        @keyframes wg-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}
      `}</style>
    </div>
  );
}

export default function WrapGuruChat({ variant = "inline" }: { variant?: "inline" | "floating" }) {
  const [open, setOpen] = useState(false);

  if (variant === "floating") {
    return (
      <div className="fixed right-4 bottom-4 z-[2147483000] font-sans">
        {open && (
          <div
            className="absolute right-0 bottom-[74px] w-[min(370px,calc(100vw-32px))] h-[min(560px,calc(100vh-120px))] rounded-2xl shadow-2xl overflow-hidden"
            style={{ border: `1px solid ${C.border}` }}
          >
            <ChatCard onClose={() => setOpen(false)} />
          </div>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Open WrapGuru chat"
          className="relative w-[60px] h-[60px] rounded-full text-white shadow-xl flex items-center justify-center"
          style={{ background: C.head }}
        >
          <span className="absolute -inset-[3px] rounded-full -z-10" style={{ background: GRADIENT }} />
          <MessageCircle className="w-6 h-6" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-[420px] h-[580px] rounded-2xl shadow-xl overflow-hidden"
      style={{ border: `1px solid ${C.border}` }}
    >
      <ChatCard />
    </div>
  );
}
