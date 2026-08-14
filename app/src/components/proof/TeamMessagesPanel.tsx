/**
 * TeamMessagesPanel — the design team's read view of the customer ⇄ team
 * conversation, inside the ApprovePro workbench. Reuses the SAME endpoint the
 * customer portal uses (proof-message-thread, keyed by the proof view token),
 * so the team reads exactly the thread the customer sees. The team mostly
 * reads here and intervenes elsewhere (reply composer / instruct DesignPro).
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MessageSquare, User } from "lucide-react";

interface Msg {
  id: string;
  role: "customer" | "team";
  name?: string | null;
  body: string;
  at: string;
}

interface Props {
  token: string;
  refreshKey?: number;
}

export function TeamMessagesPanel({ token, refreshKey }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return;
      setLoading(true);
      try {
        const { data } = await supabase.functions.invoke("proof-message-thread", { body: { token } });
        if (cancelled) return;
        if (data?.success && Array.isArray(data.messages)) setMessages(data.messages);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#0080dd]" />
        Customer messages
        <span className="text-[10px] text-gray-400 ml-auto">{messages.length}</span>
      </h3>
      {loading ? (
        <div className="flex items-center justify-center py-5 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : messages.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          No messages yet. When the customer uses “Message the team” on their portal, the thread appears here — and you're emailed + texted with an AI-drafted reply to approve.
        </p>
      ) : (
        <ol className="space-y-2">
          {messages.map((m) => {
            const when = new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            const isTeam = m.role === "team";
            return (
              <li key={m.id} className={`rounded-lg border p-2.5 ${isTeam ? "border-blue-200 bg-blue-50/50" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  {isTeam ? <MessageSquare className="w-3 h-3 text-[#0080dd]" /> : <User className="w-3 h-3 text-gray-500" />}
                  <span className="text-[11px] font-semibold text-gray-800">{isTeam ? (m.name || "Design team") : "Customer"}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{when}</span>
                </div>
                <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">{m.body}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
