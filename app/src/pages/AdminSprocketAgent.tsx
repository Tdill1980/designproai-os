import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle, LifeBuoy, ScrollText, Send, Loader2, CheckCircle2,
  GitBranch, Mail, Phone, ExternalLink, Sparkles, Copy, AlertTriangle, Clock, Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

/**
 * AdminSprocketAgent — /admin/sprocket  (white UI, on-brand)
 *
 *  - Chat: talk to Sprocket live (same agent customers use).
 *  - Tickets: EVERY trouble ticket — triage, resolve+notify (email/SMS),
 *    or hand off to the Claude Code fix pipeline (GitHub issue).
 *  - Transcripts: EVERY chat logged, with WPW-upsell tagging.
 */

type Tab = "chat" | "tickets" | "transcripts";

// Brand gradient (blue → magenta), used as an accent / on buttons.
const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-100 text-amber-700 border-amber-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  wont_fix: "bg-gray-100 text-gray-600 border-gray-200",
};

function fmt(ts?: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

export default function AdminSprocketAgent() {
  const [tab, setTab] = useState<Tab>("tickets");
  const qc = useQueryClient();

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ["helper_tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helper_tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30_000,
  });

  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ["helper_chats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helper_chats")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30_000,
  });

  const openCount = tickets.filter((t) => t.status === "open").length;

  async function ticketAction(ticketId: string, action: string, extra: any = {}) {
    try {
      const { data, error } = await supabase.functions.invoke("helper-ticket-action", {
        body: { ticketId, action, ...extra },
      });
      if (error) throw error;
      if (action === "resolve") {
        toast.success(`Resolved. Notified: ${data?.emailed ? "email" : "no email"}${data?.texted ? " + text" : ""}.`);
      } else if (action === "handoff") {
        toast.success("Handed off to Claude Code — GitHub issue created.");
      } else {
        toast.success("Updated.");
      }
      qc.invalidateQueries({ queryKey: ["helper_tickets"] });
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-full ring-2 ring-white" style={{ background: GRADIENT }}>
              <span className="flex items-center justify-center w-11 h-11 rounded-full bg-white">
                <img src="/sprocket/sprocket-laptop.png" alt="Sprocket" className="w-10 h-10 object-contain" />
              </span>
            </span>
            <span className="flex items-center justify-center w-12 h-12 rounded-full ring-2 ring-white -ml-3" style={{ background: GRADIENT }}>
              <span className="flex items-center justify-center w-11 h-11 rounded-full bg-white">
                <img src="/characters/ace.png" alt="Ace" className="w-10 h-10 object-contain" />
              </span>
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              Sprocket &amp; Ace <Sparkles className="w-5 h-5" style={{ color: "#ec4899" }} />
            </h1>
            <p className="text-sm text-gray-500">Sprocket helps customers · Ace ships the fixes</p>
          </div>
          {openCount > 0 && (
            <Badge className="ml-auto bg-amber-100 text-amber-700 border-amber-200">{openCount} open</Badge>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {([
            ["tickets", "Tickets", LifeBuoy],
            ["transcripts", "Transcripts", ScrollText],
            ["chat", "Chat", MessageCircle],
          ] as [Tab, string, any][]).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                tab === key ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:text-gray-900"
              }`}
              style={tab === key ? { background: GRADIENT } : undefined}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "tickets" && (
          <TicketList tickets={tickets} loading={ticketsLoading} onAction={ticketAction} />
        )}
        {tab === "transcripts" && <TranscriptList chats={chats} loading={chatsLoading} />}
        {tab === "chat" && <AdminChat />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tickets */
// Build a ready-to-paste prompt for opening a fresh Claude Code session on a
// ticket that needs a big/manual fix.
function buildClaudePrompt(t: any) {
  const tx = (Array.isArray(t.transcript) ? t.transcript : [])
    .map((m: any) => `${m.role}: ${m.content}`).join("\n");
  return [
    `Fix this DesignProAI issue reported via the Sprocket helper.`,
    ``,
    `Page: ${t.page || "unknown"}`,
    `User: ${t.user_email || t.user_id || "anonymous"}`,
    `Reported: ${fmt(t.created_at)}`,
    `Summary: ${t.summary || "(none)"}`,
    t.github_issue_url ? `GitHub issue: ${t.github_issue_url}` : ``,
    ``,
    `Conversation:`,
    tx || "(no transcript)",
    ``,
    `Find the root cause and open a minimal-fix PR that closes the issue. Respect CLAUDE.md locks; do not change locked render files.`,
  ].filter(Boolean).join("\n");
}

function TicketRow({ t, onAction }: { t: any; onAction: (id: string, action: string, extra?: any) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(t.resolution_notes || "");
  const done = t.status === "resolved";
  const needsClaude = t.status === "open" || t.status === "in_progress";

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        {needsClaude
          ? <Badge className="bg-red-100 text-red-700 border-red-300 gap-1"><AlertTriangle className="w-3 h-3" />Open ticket</Badge>
          : t.auto_shipped
          ? <Badge className="bg-violet-100 text-violet-700 border-violet-300 gap-1"><Zap className="w-3 h-3" />Hot fix</Badge>
          : <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Resolved</Badge>}
        <span className="flex-1 truncate text-gray-900">{t.summary || "(no summary)"}</span>
        <span className="text-xs text-gray-500 hidden md:flex items-center gap-1"><Mail className="w-3 h-3" />{t.user_email || "anon"}</span>
        <span className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{fmt(done ? t.resolved_at : t.created_at)}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            {t.user_email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{t.user_email}</span>}
            {t.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{t.contact_phone}</span>}
            <span>Page: {t.page || "—"}</span>
            <span>Reported: {fmt(t.created_at)}</span>
            {t.github_issue_url && (
              <a href={t.github_issue_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                <GitBranch className="w-3 h-3" /> issue #{t.github_issue_number} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* transcript */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 max-h-56 overflow-y-auto space-y-2">
            {(Array.isArray(t.transcript) ? t.transcript : []).map((m: any, i: number) => (
              <div key={i} className="text-sm">
                <span className={m.role === "user" ? "text-blue-600 font-medium" : "text-pink-600 font-medium"}>{m.role}:</span>{" "}
                <span className="text-gray-700 whitespace-pre-wrap">{m.content}</span>
              </div>
            ))}
            {(!t.transcript || t.transcript.length === 0) && <div className="text-gray-400 text-sm">No transcript attached.</div>}
          </div>

          {done ? (
            <div className="text-emerald-600 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Fixed {fmt(t.resolved_at)}</span>
              <span>· User: {t.user_email || "anon"}</span>
              <span>· Email sent {t.notified_at ? "✓" : "—"}</span>
              {t.resolution_notes && <span className="w-full text-gray-600">Fix: {t.resolution_notes}</span>}
            </div>
          ) : (
            <>
              {/* Red copy-paste block for a manual Claude session (big edits) */}
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-red-700 flex items-center gap-1.5"><img src="/characters/ace.png" alt="Ace" className="w-5 h-5 object-contain" /> Big edit / fix — hand to Ace (open a Claude session)</span>
                  <Button size="sm" variant="outline" className="border-red-300 text-red-700 h-7"
                    onClick={() => { navigator.clipboard.writeText(buildClaudePrompt(t)); toast.success("Copied — paste into a new Claude Code session."); }}>
                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy prompt
                  </Button>
                </div>
                <pre className="text-[11px] text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">{buildClaudePrompt(t)}</pre>
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Resolution notes (included in the customer's email)…"
                rows={2}
                className="w-full rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onAction(t.id, "resolve", { resolution_notes: notes })} className="text-white" style={{ background: GRADIENT }}>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Resolve & notify
                </Button>
                <Button size="sm" variant="outline" onClick={() => onAction(t.id, "handoff")} className="border-gray-300">
                  <GitBranch className="w-4 h-4 mr-1.5" /> Hand off to Claude Code
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onAction(t.id, "status", { status: "wont_fix" })} className="text-gray-400">
                  Won't fix
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TicketList({ tickets, loading, onAction }: { tickets: any[]; loading: boolean; onAction: (id: string, action: string, extra?: any) => void }) {
  if (loading) return <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading tickets…</div>;
  if (tickets.length === 0) return <div className="text-gray-500">No tickets yet. They'll appear here the moment Sprocket files one.</div>;

  const needs = tickets.filter((t) => t.status === "open" || t.status === "in_progress");
  const hotFixes = tickets.filter((t) => t.status === "resolved" && t.auto_shipped);
  const teamFixed = tickets.filter((t) => t.status === "resolved" && !t.auto_shipped);
  const other = tickets.filter((t) => !["open", "in_progress", "resolved"].includes(t.status));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Open trouble tickets — need a Claude session ({needs.length})
        </h2>
        {needs.length === 0 && <div className="text-gray-400 text-sm">Nothing open — all caught up. 🎉</div>}
        {needs.map((t) => <TicketRow key={t.id} t={t} onAction={onAction} />)}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-violet-700 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Hot fixes — auto-shipped ({hotFixes.length})
        </h2>
        {hotFixes.length === 0 && <div className="text-gray-400 text-sm">No auto-shipped hot fixes yet.</div>}
        {hotFixes.map((t) => <TicketRow key={t.id} t={t} onAction={onAction} />)}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Resolved by team ({teamFixed.length})
        </h2>
        {teamFixed.length === 0 && <div className="text-gray-400 text-sm">No team-resolved tickets yet.</div>}
        {teamFixed.map((t) => <TicketRow key={t.id} t={t} onAction={onAction} />)}
      </section>

      {other.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500">Closed / won't fix ({other.length})</h2>
          {other.map((t) => <TicketRow key={t.id} t={t} onAction={onAction} />)}
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- transcripts */
function TranscriptList({ chats, loading }: { chats: any[]; loading: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (loading) return <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading transcripts…</div>;
  if (chats.length === 0) return <div className="text-gray-500">No chats logged yet.</div>;

  return (
    <div className="space-y-3">
      {chats.map((c) => {
        const expanded = openId === c.id;
        return (
          <div key={c.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button onClick={() => setOpenId(expanded ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <span className="text-sm text-gray-700">{c.user_email || "anonymous"}</span>
              <span className="text-xs text-gray-400 hidden sm:block">{c.page}</span>
              <span className="text-xs text-gray-400">{c.message_count} msgs</span>
              {c.upsold_wpw && <Badge className="bg-pink-100 text-pink-700 border-pink-200 text-[10px]">WPW upsell</Badge>}
              <span className="ml-auto text-xs text-gray-400">{fmt(c.last_message_at)}</span>
            </button>
            {expanded && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2 max-h-72 overflow-y-auto">
                {(Array.isArray(c.messages) ? c.messages : []).map((m: any, i: number) => (
                  <div key={i} className="text-sm">
                    <span className={m.role === "user" ? "text-blue-600 font-medium" : "text-pink-600 font-medium"}>{m.role}:</span>{" "}
                    <span className="text-gray-700 whitespace-pre-wrap">{m.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- admin chat */
function AdminChat() {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hey, I'm Sprocket. Ask me anything — same agent your customers talk to." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const u = sess?.session?.user;
      const { data, error } = await supabase.functions.invoke("sprocket-helper", {
        body: { mode: "chat", messages: next, page: "/admin/sprocket", user: { id: u?.id, email: u?.email }, conversation_id: "admin-test" },
      });
      if (error) throw error;
      setMessages([...next, { role: "assistant", content: data?.reply || "…" }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Hit a snag reaching the model. Try again." }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col h-[60vh]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap"
              style={m.role === "user" ? { background: GRADIENT, color: "#fff" } : undefined}
            >
              <span className={m.role === "user" ? "" : "text-gray-800"}>{m.content}</span>
            </div>
          </div>
        ))}
        {sending && <div className="text-gray-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> thinking…</div>}
      </div>
      <div className="flex items-end gap-2 p-3 border-t border-gray-100">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Ask Sprocket…"
          className="flex-1 resize-none rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 max-h-28"
        />
        <Button size="icon" onClick={send} disabled={sending || !input.trim()} className="text-white" style={{ background: GRADIENT }}><Send className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}
