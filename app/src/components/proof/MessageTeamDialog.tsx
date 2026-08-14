/**
 * MessageTeamDialog — the customer's "Message the team" thread in the
 * ApprovePro portal. The customer can ask the design team a question or add
 * info; it's emailed + texted to the team, who approve an AI-drafted reply
 * "as us" (or write their own). The customer sees the running conversation
 * here and gets the reply by email + in this thread.
 *
 * Mobile-first, white UI + blue→magenta gradient accent. Token-based, no login.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageCircle } from "lucide-react";

interface ThreadMessage {
  id: string;
  role: "customer" | "team";
  name?: string | null;
  body: string;
  at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  shopName?: string | null;
}

export function MessageTeamDialog({ open, onOpenChange, token, shopName }: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThread = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("proof-message-thread", { body: { token } });
      if (data?.success && Array.isArray(data.messages)) setMessages(data.messages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) { setJustSent(false); loadThread(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, justSent]);

  const send = async () => {
    const body = draft.trim();
    if (body.length < 2) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("proof-message-send", { body: { token, body } });
      if (error || !data?.success) {
        toast({ title: "Couldn't send", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      // Optimistically append the customer's message.
      setMessages((p) => [...p, { id: `local-${Date.now()}`, role: "customer", body, at: new Date().toISOString() }]);
      setDraft("");
      setJustSent(true);
    } finally {
      setSending(false);
    }
  };

  const team = shopName || "WePrintWraps";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl">
        {/* Brand band */}
        <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
          <DialogTitle className="text-[17px] font-extrabold flex items-center gap-2">
            <MessageCircle className="w-5 h-5" /> Message the {team} team
          </DialogTitle>
          <DialogDescription className="text-[12px] text-white/90 mt-0.5">
            Ask a question or add details — a real person replies, usually same day.
          </DialogDescription>
        </div>

        {/* Thread */}
        <div ref={scrollRef} className="max-h-[46vh] min-h-[180px] overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : messages.length === 0 ? (
            <p className="text-center text-[13px] text-gray-400 py-10">No messages yet. Start the conversation below.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "customer"
                    ? "text-white rounded-br-sm"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
                }`} style={m.role === "customer" ? { background: "linear-gradient(90deg,#3b82f6,#ec4899)" } : undefined}>
                  {m.role === "team" && <div className="text-[11px] font-semibold text-gray-500 mb-0.5">{m.name || `${team} Design Team`}</div>}
                  {m.body}
                </div>
              </div>
            ))
          )}
          {justSent && (
            <p className="text-center text-[12px] text-emerald-600 pt-1">Sent! We'll reply by email and right here.</p>
          )}
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-gray-200 bg-white">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your question or note…"
            className="min-h-[64px] text-[16px] border-gray-200 resize-none mb-2"
            maxLength={4000}
            disabled={sending}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <Button onClick={send} disabled={sending || draft.trim().length < 2}
            className="w-full h-11 text-white font-bold" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
            {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Send to the team</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
