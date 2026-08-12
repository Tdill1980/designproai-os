import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Database, ChevronDown, DollarSign } from "lucide-react";
import { renderClient as supabase } from "@/integrations/supabase/renderClient";

/**
 * AdminWrapGuruConsole — an admin-only test console for the WrapGuru
 * (wpw-sales-chat) assistant. Chat with WrapGuru live to verify answers and the
 * knowledge base, WITHOUT the customer side effects: it sends `preview: true`,
 * so the backend returns the reply + the KB facts that grounded it while
 * skipping persistence, team notifications, lead capture and retargeting. Test
 * chats never show up in the conversation log or fire emails.
 *
 * Reuses the WHITE UI standard (black header, blue→magenta accent). Mounted in
 * AdminWrapGuruChats as a side drawer.
 */

type Priced = { product?: string; sqft?: number; total?: number; cart_url?: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  at?: number;
  priced?: Priced | null;
  kb?: string | null;
};

const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";
const GREETING =
  "Admin test console — chat with WrapGuru to check answers and the knowledge base. Nothing here is logged as a lead or emailed to the team.";

function fmtClock(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Render [text](url) + bare URLs as links (admin view — no CTA styling needed).
function renderBody(s: string) {
  let h = escapeHtml(s);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener" class="text-blue-600 font-semibold underline">${t}</a>`);
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener" class="text-blue-600 underline break-all">${u.replace(/^https?:\/\//, "")}</a>`);
  return h;
}

function newSession() {
  return "admin-test-" + Math.random().toString(36).slice(2, 10);
}

function KbPanel({ kb }: { kb: string }) {
  const [open, setOpen] = useState(false);
  const count = kb.split(/\n\nQ: /).filter(Boolean).length;
  return (
    <div className="mt-1.5 w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-800"
      >
        <Database className="w-3 h-3" />
        Grounded on {count} KB {count === 1 ? "fact" : "facts"}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-200 p-2 text-[11px] leading-snug text-gray-600 max-h-52 overflow-y-auto">
          {kb}
        </pre>
      )}
    </div>
  );
}

export default function AdminWrapGuruConsole() {
  const [sessionId, setSessionId] = useState(newSession);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING, at: Date.now() }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function reset() {
    setSessionId(newSession());
    setMessages([{ role: "assistant", content: GREETING, at: Date.now() }]);
    setInput("");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text, at: Date.now() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("wpw-sales-chat", {
        body: {
          message: text,
          session_id: sessionId,
          preview: true,
          history: next
            .filter((m) => m.content !== GREETING)
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          page_path: "/admin/wrapguru#console",
        },
      });
      if (error) throw error;
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data?.reply || "No reply returned.",
          at: Date.now(),
          priced: data?.priced ?? null,
          kb: data?.kb ?? null,
        },
      ]);
    } catch (e: any) {
      setMessages([
        ...next,
        { role: "assistant", content: `⚠️ Error calling wpw-sales-chat: ${e?.message || e}`, at: Date.now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col w-full h-full bg-white overflow-hidden">
      {/* header — always black (WHITE UI standard) */}
      <div className="relative bg-black text-white px-4 py-3 flex items-center gap-2.5">
        <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: GRADIENT }} />
        <span className="flex items-center justify-center w-9 h-9 rounded-full" style={{ background: GRADIENT }}>
          <Database className="w-4 h-4 text-white" />
        </span>
        <div className="leading-tight">
          <div className="font-extrabold text-sm">WrapGuru — Test Console</div>
          <div className="text-[11px] text-gray-400">preview mode · not logged, no emails</div>
        </div>
        <button
          onClick={reset}
          title="New test chat"
          className="ml-auto flex items-center gap-1 text-[11px] text-gray-300 hover:text-white border border-white/20 rounded-lg px-2 py-1"
        >
          <RotateCcw className="w-3 h-3" /> New
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-gray-50">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[88%] ${m.role === "user" ? "" : "w-full"}`}>
              {m.role === "user" ? (
                <div className="rounded-2xl rounded-br-sm px-3 py-2 text-sm bg-gray-900 text-white whitespace-pre-wrap">{m.content}</div>
              ) : (
                <div
                  className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm bg-white border border-gray-200 text-gray-800 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: renderBody(m.content) }}
                />
              )}
            </div>
            {/* deterministic quote returned by the backend */}
            {m.priced?.total != null && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                <DollarSign className="w-3 h-3" />
                {m.priced.product} · {m.priced.sqft} sqft · ${m.priced.total}
              </div>
            )}
            {/* KB facts that grounded the answer */}
            {m.kb && <KbPanel kb={m.kb} />}
            <span className="text-[10px] text-gray-400 mt-0.5 px-1">{fmtClock(m.at)}</span>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="wg-typing"><i /><i /><i /></span> WrapGuru is thinking…
          </div>
        )}
      </div>

      {/* composer */}
      <div className="flex items-center gap-2 p-2.5 border-t border-gray-200 bg-white">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask WrapGuru something…"
          className="flex-1 min-w-0 h-11 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="h-11 w-11 shrink-0 rounded-xl text-white flex items-center justify-center disabled:opacity-50"
          style={{ background: GRADIENT }}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <style>{`
        .wg-typing{display:inline-flex;gap:4px;align-items:center;height:14px;}
        .wg-typing i{width:6px;height:6px;border-radius:50%;background:#c4c9d4;display:inline-block;animation:wg-bounce 1.2s infinite ease-in-out;}
        .wg-typing i:nth-child(2){animation-delay:.15s;}
        .wg-typing i:nth-child(3){animation-delay:.3s;}
        @keyframes wg-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}
      `}</style>
    </div>
  );
}
