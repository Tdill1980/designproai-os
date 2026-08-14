import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageCircle, Loader2, MapPin, Mail, Clock, ExternalLink, Send,
  UserCheck, Globe, Search, Sparkles, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import AdminWrapGuruConsole from "@/components/wrapguru/AdminWrapGuruConsole";
import WrapGuruPublishCard from "@/components/wrapguru/WrapGuruPublishCard";
import WrapGuruFileChecksCard from "@/components/wrapguru/WrapGuruFileChecksCard";

/**
 * AdminWrapGuruChats — /admin/wrapguru  (white UI, on-brand)
 *
 * Every WrapGuru (wpw-sales-chat) conversation, logged with its full
 * transcript (per-message timestamps), IP geolocation, and lead / team-notify /
 * retarget status. Reads public.wpw_chat_conversations (admin RLS). Chats are
 * written by the wpw-sales-chat edge function on every message.
 */

const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

type Convo = {
  id: string;
  session_id: string;
  messages: { role: string; content: string; at?: string }[] | null;
  message_count: number;
  email: string | null;
  last_priced: { product?: string; sqft?: number; total?: number; cart_url?: string } | null;
  ip_address: string | null;
  geo_city: string | null;
  geo_region: string | null;
  geo_country: string | null;
  geo_country_code: string | null;
  geo_org: string | null;
  user_agent: string | null;
  page_path: string | null;
  referrer: string | null;
  lead_captured: boolean;
  team_notified: boolean;
  retarget_enrolled: boolean;
  klaviyo_synced: boolean;
  quote_event_logged: boolean;
  first_message_at: string;
  last_message_at: string;
  created_at: string;
};

function fmt(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
function fmtTime(ts?: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
// 2-letter country code → flag emoji
function flag(cc?: string | null) {
  if (!cc || cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => A + c.charCodeAt(0) - 65));
}
function geoLine(c: Convo) {
  const parts = [c.geo_city, c.geo_region, c.geo_country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown location";
}

export default function AdminWrapGuruChats() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "leads" | "today">("all");
  const [q, setQ] = useState("");
  const [consoleOpen, setConsoleOpen] = useState(false);

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ["wpw_chat_conversations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wpw_chat_conversations")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Convo[];
    },
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayMs = startOfDay.getTime();
    return {
      total: chats.length,
      leads: chats.filter((c) => c.lead_captured).length,
      klaviyo: chats.filter((c) => c.klaviyo_synced).length,
      today: chats.filter((c) => new Date(c.last_message_at).getTime() >= todayMs).length,
    };
  }, [chats]);

  const rows = useMemo(() => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayMs = startOfDay.getTime();
    const term = q.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === "leads" && !c.lead_captured) return false;
      if (filter === "today" && new Date(c.last_message_at).getTime() < todayMs) return false;
      if (term) {
        const hay = [c.email, geoLine(c), c.page_path, c.session_id,
          ...(Array.isArray(c.messages) ? c.messages.map((m) => m.content) : [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [chats, filter, q]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="flex items-center justify-center w-12 h-12 rounded-full ring-2 ring-white" style={{ background: GRADIENT }}>
            <MessageCircle className="w-6 h-6 text-white" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">WrapGuru Chats</h1>
            <p className="text-sm text-gray-500">Every weprintwraps.com chat — transcript, location, lead status, retargeting</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* The real customer page — test quoting, order status and the
                print-file check exactly as a visitor sees them. */}
            <a
              href="/wrapguru"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:border-gray-400"
            >
              <ExternalLink className="w-4 h-4" /> Open test page
            </a>
            <button
              onClick={() => setConsoleOpen(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
              style={{ background: GRADIENT }}
            >
              <Sparkles className="w-4 h-4" /> Test WrapGuru
            </button>
          </div>
        </div>

        {/* Publish the customer-facing page to weprintwraps.com (safe publisher) */}
        <WrapGuruPublishCard />

        {/* Print-file checks — the follow-up queue for flagged artwork */}
        <WrapGuruFileChecksCard />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {([
            ["Total chats", stats.total, MessageCircle],
            ["Leads captured", stats.leads, UserCheck],
            ["Klaviyo synced", stats.klaviyo, Send],
            ["Chats today", stats.today, Clock],
          ] as [string, number, any][]).map(([label, val, Icon]) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1"><Icon className="w-3.5 h-3.5" />{label}</div>
              <div className="text-2xl font-semibold">{val}</div>
            </div>
          ))}
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([["all", "All"], ["leads", "Leads only"], ["today", "Today"]] as [typeof filter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium border transition-colors ${
                filter === key ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:text-gray-900"
              }`}
              style={filter === key ? { background: GRADIENT } : undefined}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email, location, message…"
              className="pl-9 pr-3 h-9 w-64 max-w-full rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading chats…</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-500">No chats {filter !== "all" || q ? "match this filter" : "logged yet"}.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((c) => {
              const expanded = openId === c.id;
              const msgs = Array.isArray(c.messages) ? c.messages : [];
              return (
                <div key={c.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  <button onClick={() => setOpenId(expanded ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <span className="text-lg leading-none" title={c.geo_country || ""}>{flag(c.geo_country_code)}</span>
                    <span className="flex flex-col min-w-0">
                      <span className="text-sm text-gray-900 truncate flex items-center gap-1.5">
                        {c.email ? <><Mail className="w-3 h-3 text-gray-400" />{c.email}</> : <span className="text-gray-400">anonymous</span>}
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1 truncate"><MapPin className="w-3 h-3" />{geoLine(c)}</span>
                    </span>
                    <span className="hidden md:block text-xs text-gray-400 truncate max-w-[160px]">{c.page_path || "—"}</span>
                    <span className="text-xs text-gray-400">{c.message_count} msgs</span>
                    {c.lead_captured && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Lead</Badge>}
                    {c.quote_event_logged && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Quote</Badge>}
                    {c.klaviyo_synced && <Badge className="bg-violet-100 text-violet-700 border-violet-200 text-[10px]">Klaviyo</Badge>}
                    {c.retarget_enrolled && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Retarget</Badge>}
                    {c.team_notified && <Badge className="bg-pink-100 text-pink-700 border-pink-200 text-[10px]">Notified</Badge>}
                    <span className="ml-auto text-xs text-gray-500 whitespace-nowrap flex items-center gap-1"><Clock className="w-3 h-3" />{fmt(c.last_message_at)}</span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                      {/* meta */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{c.ip_address || "no ip"}{c.geo_org ? ` · ${c.geo_org}` : ""}</span>
                        <span>Started: {fmt(c.first_message_at)}</span>
                        {c.last_priced?.total != null && <span>Last quote: {c.last_priced.product} — ${c.last_priced.total}</span>}
                        {c.referrer && (
                          <a href={c.referrer} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                            referrer <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {/* transcript */}
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 max-h-96 overflow-y-auto space-y-3">
                        {msgs.length === 0 && <div className="text-gray-400 text-sm">No messages stored.</div>}
                        {msgs.map((m, i) => (
                          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                              m.role === "user" ? "bg-gray-900 text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
                            }`}>
                              {m.content}
                            </div>
                            <span className="text-[10px] text-gray-400 mt-0.5 px-1">
                              {m.role === "user" ? "visitor" : "WrapGuru"} · {m.at ? fmtTime(m.at) : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin test console — slide-in drawer */}
      {consoleOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setConsoleOpen(false)}
            aria-hidden
          />
          <div className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <button
              onClick={() => setConsoleOpen(false)}
              aria-label="Close console"
              className="absolute -left-11 top-3 hidden sm:flex items-center justify-center w-9 h-9 rounded-full bg-white shadow text-gray-500 hover:text-gray-900"
            >
              <X className="w-4 h-4" />
            </button>
            <AdminWrapGuruConsole />
          </div>
        </div>
      )}
    </div>
  );
}
