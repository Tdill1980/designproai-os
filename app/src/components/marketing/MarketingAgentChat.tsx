/**
 * MarketingAgentChat — chat with the marketing agent.
 *
 * The operator types plainly ("write me 3 WePrintWraps reels about 1-2 day
 * turnaround"); the agent replies AND, when asked for content, drafts finished
 * pieces onto the QC board (slack_agent_tasks, To Do / marketing) for review.
 * Nothing is ever auto-published. Backed by marketing-agent action:"chat".
 */
import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Send, Loader2, User, CheckCircle2 } from "lucide-react";

type Brand = "weprintwraps" | "restylepro" | "wraptv" | "inkandedge";
type Created = { id: string; type: string; title: string; design_url?: string; scheduled_for?: string };
type Msg = { role: "user" | "assistant"; content: string; created?: Created[] };

const SUGGESTIONS: Record<string, string[]> = {
  weprintwraps: [
    "Write 3 reels about our 1-2 day turnaround",
    "Draft a carousel on what makes a file print-ready",
    "Give me a post pushing the $199 File Output",
  ],
  restylepro: [
    "Write 3 narrative posts on why DesignProAI is the new way",
    "Draft a carousel: Illustrator → Photoshop → DesignProAI",
    "A teaser post about RecreatePro (pre-launch, soft CTA)",
  ],
  wraptv: ["Write a Submit-Your-Build reel script", "Draft an install-tip post"],
  inkandedge: ["Draft an installer profile feature", "A project deep-dive post"],
};

export default function MarketingAgentChat({ brand }: { brand: Brand }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "chat", brand, message: msg, history },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply || "Done.", created: data.created || [] },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${e?.message || "Something went wrong."}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden h-[520px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
        <Bot className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-semibold text-slate-900">Chat with the Marketing Agent</span>
        <span className="text-[11px] text-slate-500">— it drafts to your QC board, never auto-posts</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-slate-500">
            <p className="mb-2">Ask me to write content and I'll draft it onto your board to QC. Try:</p>
            <div className="flex flex-wrap gap-2">
              {(SUGGESTIONS[brand] || []).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[12px] px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && <Bot className="w-5 h-5 text-blue-600 shrink-0 mt-1" />}
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900",
              )}
            >
              {m.content}
              {m.created && m.created.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200/60 space-y-1">
                  <div className="text-[11px] font-semibold flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="w-3 h-3" /> Drafted {m.created.length} to your QC board
                  </div>
                  {m.created.map((c) => (
                    <div key={c.id} className="text-[12px] text-slate-600">
                      <div>• {c.type}: {c.title}</div>
                      {c.scheduled_for && (
                        <div className="text-[11px] text-amber-700 font-semibold">
                          ⏰ scheduled to post {new Date(c.scheduled_for).toLocaleString()}
                        </div>
                      )}
                      {c.design_url && (
                        <img
                          src={c.design_url}
                          alt={c.title}
                          className="mt-1 rounded-md border border-slate-200 max-h-40 w-auto"
                          loading="lazy"
                        />
                      )}
                    </div>
                  ))}
                  <Link to="/engine-room" className="text-[12px] text-blue-600 underline">
                    Review on the board →
                  </Link>
                </div>
              )}
            </div>
            {m.role === "user" && <User className="w-5 h-5 text-slate-400 shrink-0 mt-1" />}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 items-center text-slate-500 text-sm">
            <Bot className="w-5 h-5 text-blue-600" />
            <Loader2 className="w-4 h-4 animate-spin" /> thinking…
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder={`Message the ${brand} marketing agent…`}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          disabled={sending}
        />
        <button
          onClick={() => send()}
          disabled={sending || !input.trim()}
          className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40 flex items-center gap-1 text-sm"
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

function cn(...c: (string | false | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
