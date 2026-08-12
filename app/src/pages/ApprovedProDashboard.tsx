/**
 * ApprovedPro™ owner dashboard (admin-only, /admin/approve-revisions).
 *
 * The shop-owner workspace from Trish's mockup: a light left-nav app shell
 * (✓ Approved Pro logo, lavender active state, Recent Design + plan footer), an
 * A.C.E-driven review center (big mascot greeting → design preview → chat), and
 * a right rail with Project Details, A.C.E Suggestions, and Approve Design /
 * Request Revisions / Order Production Pack. Lists every order that has customer
 * messages / revision requests and lets the owner revise (one click, Gemini) or
 * reply (saves to the customer's portal thread).
 *
 * Styled to match the supplied mockup (light rail + purple-accent A.C.E hero).
 * Backed by the admin-gated `approvepro-revisions` edge function.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, MessageSquare, Send, Sparkles, User, Wand2, CheckCircle2, RotateCw,
  ShoppingBag, ExternalLink, RefreshCw, Image as ImageIcon, LayoutDashboard,
  FolderKanban, Palette, Package, Layers, ImageIcon as MediaIcon, CreditCard,
  Settings, Eye, Check, ChevronRight, Pencil,
} from "lucide-react";

const ACE_IMG = "/characters/ace-hero.png";
const ACE_FALLBACK = "/characters/ace-robot.png";
const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";
const VIEW_ORDER = ["hero", "side", "driver-side", "passenger-side", "front", "hood_detail", "rear", "close-up", "roof"];

interface ThreadMsg { id: string; role: "customer" | "team"; name: string | null; body: string; at: string; }
interface Suggestion { id: string; text: string; at: string; }
interface Order {
  id: string; customer_name: string | null; customer_email: string | null; vehicle: string;
  design_name: string | null; finish_type: string | null; status: string; mode: string; view_token: string;
  wpw_order_number: string | number | null; ai_revisions_allowed: number | null; ai_revisions_used: number | null;
  version_count: number; active_version_number: number | null; hero_url: string | null;
  render_urls: Record<string, string>; unread_customer: number; last_message_at: string;
  thread: ThreadMsg[]; suggestions: Suggestion[]; created_at: string;
}

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/admin" },
  { icon: FolderKanban, label: "Projects", to: "/admin/approve-revisions" },
  { icon: Palette, label: "Designs", to: "/admin/approvemode" },
  { icon: Package, label: "Orders", to: "/admin/approve-revisions", active: true },
  { icon: Layers, label: "Brand Kits", to: "/admin" },
  { icon: MediaIcon, label: "Media", to: "/admin/approvemode" },
  { icon: CreditCard, label: "Billing", to: "/admin" },
  { icon: Settings, label: "Settings", to: "/admin" },
];

function when(at: string) {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function sortedViews(renderUrls: Record<string, string>) {
  return Object.entries(renderUrls || {})
    .filter(([, url]) => typeof url === "string" && url)
    .sort(([a], [b]) => {
      const ai = VIEW_ORDER.indexOf(a); const bi = VIEW_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}
const StatusPill = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600", sent: "bg-blue-100 text-blue-700",
    viewed: "bg-amber-100 text-amber-700", revision_requested: "bg-pink-100 text-pink-700",
    approved: "bg-green-100 text-green-700", declined: "bg-red-100 text-red-700",
  };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${map[status] || "bg-gray-100 text-gray-600"}`}>{status?.replace(/_/g, " ")}</span>;
};

const AceMark = ({ className = "w-10 h-10" }: { className?: string }) => (
  <img src={ACE_IMG} onError={(e) => ((e.currentTarget as HTMLImageElement).src = ACE_FALLBACK)} alt="A.C.E" className={`object-contain ${className}`} />
);

export default function ApprovedProDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviseText, setReviseText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [heroIdx, setHeroIdx] = useState(0);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["approvedpro-revisions"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("approvepro-revisions", { body: { action: "list" } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return (data?.orders || []) as Order[];
    },
  });

  const orders = useMemo(() => data || [], [data]);
  const selected = useMemo(() => orders.find((o) => o.id === selectedId) || orders[0] || null, [orders, selectedId]);
  const views = selected ? sortedViews(selected.render_urls) : [];
  const heroUrl = views[heroIdx]?.[1] || selected?.hero_url || null;

  const reviseMutation = useMutation({
    mutationFn: async ({ proofId, instruction }: { proofId: string; instruction: string }) => {
      const { data, error } = await renderClient.functions.invoke("approvepro-revisions", { body: { action: "revise", proof_id: proofId, instruction } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error || data?.detail);
      return data;
    },
    onSuccess: (d) => { toast({ title: "New design ready", description: `A.C.E built v${d?.version_number}.` }); setReviseText(""); setHeroIdx(0); queryClient.invalidateQueries({ queryKey: ["approvedpro-revisions"] }); },
    onError: (e: any) => toast({ title: "Revision failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async ({ proofId, body }: { proofId: string; body: string }) => {
      const { data, error } = await supabase.functions.invoke("approvepro-revisions", { body: { action: "reply", proof_id: proofId, body } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => { toast({ title: "Reply sent", description: "Saved to the thread — the customer sees it on their portal." }); setReplyText(""); queryClient.invalidateQueries({ queryKey: ["approvedpro-revisions"] }); },
    onError: (e: any) => toast({ title: "Reply failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  const busy = reviseMutation.isPending;
  const openWorkbench = () => selected && navigate(`/approvepro?id=${selected.id}`);

  return (
    <div className="min-h-screen bg-gray-50 grid grid-cols-1 lg:grid-cols-[230px_1fr]">
      {/* ── LEFT NAV (light app shell — matches mockup) ── */}
      <aside className="hidden lg:flex flex-col bg-white border-r border-gray-200 sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm" style={{ background: GRADIENT }}>
            <Check className="w-5 h-5" strokeWidth={3} />
          </div>
          <span className="font-extrabold tracking-tight text-gray-900 text-[15px]">
            Approved<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Pro</span>
          </span>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <button key={n.label} onClick={() => navigate(n.to)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${n.active ? "bg-violet-50 text-violet-700" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"}`}>
              <n.icon className="w-[18px] h-[18px]" /> {n.label}
            </button>
          ))}
        </nav>
        {selected && (
          <div className="mx-3 mb-3 rounded-xl border border-gray-200 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Recent Design</p>
            <div className="aspect-video rounded-md overflow-hidden bg-gray-100 mb-2">
              {selected.hero_url ? <img src={selected.hero_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-300" /></div>}
            </div>
            <p className="text-[12px] font-semibold text-gray-900 truncate">{selected.design_name || "Wrap design"}</p>
            <button onClick={openWorkbench} className="mt-0.5 text-[11px] text-violet-600 hover:underline font-medium flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open in Designer</button>
          </div>
        )}
        <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: GRADIENT }}>T</div>
          <div className="leading-tight"><p className="text-sm font-semibold text-gray-900">Trish</p><p className="text-[11px] text-gray-400">Pro Plan</p></div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="min-w-0">
        {/* Order chips + refresh */}
        <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-2 overflow-x-auto sticky top-0 z-10">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 shrink-0 mr-1">Orders w/ messages</span>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : orders.map((o) => (
            <button key={o.id} onClick={() => { setSelectedId(o.id); setHeroIdx(0); setReviseText(""); setReplyText(""); }}
              className={`shrink-0 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${selected?.id === o.id ? "border-violet-400 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {o.customer_name?.split(" ")[0] || "Customer"}
              {o.wpw_order_number ? <span className="text-gray-400">#{o.wpw_order_number}</span> : null}
              {o.unread_customer > 0 && <span className="text-[9px] font-bold text-white bg-pink-500 rounded-full px-1.5">{o.unread_customer}</span>}
            </button>
          ))}
          <button onClick={() => refetch()} disabled={isFetching} className="ml-auto shrink-0 text-gray-400 hover:text-gray-700"><RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /></button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading orders…</div>
        ) : isError ? (
          <div className="max-w-md mx-auto mt-24 text-center text-gray-600"><p className="font-semibold">Couldn't load orders.</p><p className="text-sm text-gray-500 mt-1">You need an admin or tester role.</p><button className="mt-4 text-violet-600 font-semibold" onClick={() => refetch()}>Retry</button></div>
        ) : orders.length === 0 ? (
          <div className="max-w-md mx-auto mt-24 text-center text-gray-600">
            <AceMark className="w-24 h-24 mx-auto opacity-90" />
            <p className="font-semibold mt-3">No customer messages right now.</p>
          </div>
        ) : selected && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 p-5">
            {/* CENTER: greeting hero + preview + chat */}
            <div className="space-y-5">
              {/* A.C.E greeting hero — ACE image on the LEFT, chat box on the RIGHT
                  (same card footprint, just a horizontal layout). */}
              <div className="rounded-2xl overflow-hidden border border-violet-100 bg-gradient-to-r from-violet-100/80 via-fuchsia-50 to-white px-6 py-5 flex items-center gap-5">
                <AceMark className="w-28 h-28 shrink-0 drop-shadow-xl" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Hi Trish! 👋</h1>
                  <p className="text-sm text-gray-600 mt-1">
                    {selected.suggestions.length > 0
                      ? <>{selected.customer_name?.split(" ")[0] || "Your customer"} asked for {selected.suggestions.length} change{selected.suggestions.length !== 1 ? "s" : ""} — they're in the checklist on the right. Drop one into Revise and I'll rebuild it.</>
                      : <>This design is looking great. There's a new message on this order — review the conversation below.</>}
                  </p>
                  <div className="mt-3 flex items-end gap-2">
                    <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Message A.C.E…" rows={1} className="resize-none min-h-[40px] text-sm bg-white" />
                    <button onClick={() => replyMutation.mutate({ proofId: selected.id, body: replyText.trim() })} disabled={replyMutation.isPending || replyText.trim().length === 0}
                      className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-white disabled:opacity-40" style={{ background: GRADIENT }}>
                      {replyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Design preview */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Eye className="w-4 h-4 text-gray-500" /> Design Preview {selected.active_version_number ? <span className="text-gray-400 font-normal">· v{selected.active_version_number}</span> : null}</h2>
                  <button onClick={openWorkbench} className="text-xs font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                </div>
                <div className="bg-gray-50">
                  {heroUrl ? <img src={heroUrl} alt="Design" onClick={() => setPreview(heroUrl)} className="w-full max-h-[52vh] object-contain cursor-zoom-in" /> : <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No design on the active version yet</div>}
                </div>
                {views.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto px-3 py-3">
                    {views.map(([k, url], i) => (
                      <button key={k} onClick={() => setHeroIdx(i)} className={`shrink-0 rounded-lg overflow-hidden border-2 w-20 h-14 bg-gray-50 ${i === heroIdx ? "border-violet-500" : "border-transparent hover:border-gray-300"}`}>
                        <img src={url} alt={k} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Chat with A.C.E / customer */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-700 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-violet-500" /> Chat with A.C.E <span className="text-gray-400 font-normal ml-auto">{selected.thread.length}</span></div>
                <div className="p-4 space-y-2.5 max-h-[40vh] overflow-y-auto">
                  {selected.thread.length === 0 ? <p className="text-sm text-gray-400 italic text-center py-4">No messages yet.</p> : selected.thread.map((m) => {
                    const isTeam = m.role === "team";
                    return (
                      <div key={m.id} className={`flex ${isTeam ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${isTeam ? "text-white" : "bg-gray-100 text-gray-800"}`} style={isTeam ? { background: GRADIENT } : undefined}>
                          <div className="flex items-center gap-1.5 mb-0.5">{isTeam ? <Sparkles className="w-3 h-3" /> : <User className="w-3 h-3" />}<span className="text-[10px] font-semibold opacity-80">{isTeam ? (m.name || "You") : (m.name || "Customer")}</span><span className="text-[10px] opacity-60 ml-1">{when(m.at)}</span></div>
                          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-gray-100 p-3 flex items-end gap-2">
                  <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Message A.C.E or reply to the customer…" rows={1} className="resize-none min-h-[40px] text-sm" />
                  <button onClick={() => replyMutation.mutate({ proofId: selected.id, body: replyText.trim() })} disabled={replyMutation.isPending || replyText.trim().length === 0}
                    className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-white disabled:opacity-40" style={{ background: GRADIENT }}>
                    {replyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT RAIL: details, suggestions, actions */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
                <h2 className="text-sm font-bold text-gray-900 mb-3">Project Details</h2>
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Customer</dt><dd className="text-gray-900 font-semibold text-right truncate">{selected.customer_name || "—"}</dd></div>
                  {selected.wpw_order_number && <div className="flex justify-between gap-3"><dt className="text-gray-500">Order</dt><dd className="text-gray-900 font-semibold">#{selected.wpw_order_number}</dd></div>}
                  {selected.vehicle && <div className="flex justify-between gap-3"><dt className="text-gray-500">Vehicle</dt><dd className="text-gray-900 font-semibold text-right">{selected.vehicle}</dd></div>}
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Design</dt><dd className="text-gray-900 font-semibold text-right truncate">{selected.design_name || "—"}</dd></div>
                  <div className="flex justify-between items-center gap-3"><dt className="text-gray-500">Status</dt><dd><StatusPill status={selected.status} /></dd></div>
                </dl>
              </div>

              {/* A.C.E suggestions */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
                <h2 className="text-sm font-bold text-gray-900 mb-2.5 flex items-center gap-1.5"><AceMark className="w-5 h-5" /> A.C.E Suggestions</h2>
                {selected.suggestions.length === 0 ? <p className="text-xs text-gray-400 italic">No specific change requests parsed from the customer yet.</p> : (
                  <div className="space-y-2">
                    {selected.suggestions.map((s, i) => (
                      <button key={s.id} onClick={() => { setReviseText(s.text.slice(0, 500)); document.getElementById("revise-box")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                        className="w-full text-left rounded-xl border border-gray-200 p-2.5 hover:border-violet-300 hover:bg-violet-50/40 transition-colors flex items-start gap-2.5 group">
                        <span className="text-[10px] font-bold text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5" style={{ background: GRADIENT }}>{i + 1}</span>
                        <p className="text-[12px] text-gray-700 leading-snug flex-1">{s.text}</p>
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-violet-500 shrink-0 mt-0.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Revise */}
              <div id="revise-box" className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
                <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5"><Wand2 className="w-4 h-4 text-pink-500" /> Revise with A.C.E</h2>
                <Textarea value={reviseText} onChange={(e) => setReviseText(e.target.value)} placeholder="Describe the change (e.g. center the wildcat, add a trumpet & tuba)…" rows={3} maxLength={500} className="text-sm resize-none" />
                <button className="w-full mt-2 h-11 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50" style={{ background: GRADIENT }}
                  disabled={busy || reviseText.trim().length < 3} onClick={() => reviseMutation.mutate({ proofId: selected.id, instruction: reviseText.trim() })}>
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> A.C.E is revising…</> : <><Wand2 className="w-4 h-4" /> Revise this design</>}
                </button>
                <p className="text-[10px] text-gray-400 mt-1.5 text-center">Surgical edit — keeps the wrap, saves a new version.</p>
              </div>

              {/* Actions */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-2.5">
                <button onClick={openWorkbench} className="w-full h-11 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:brightness-110" style={{ background: GRADIENT }}><CheckCircle2 className="w-4 h-4" /> Approve Design</button>
                <button onClick={openWorkbench} className="w-full h-11 rounded-xl border border-gray-300 bg-white text-gray-800 font-semibold flex items-center justify-center gap-2 hover:bg-gray-50"><RotateCw className="w-4 h-4" /> Request Revisions</button>
                <button onClick={openWorkbench} className="w-full h-11 rounded-xl border border-gray-300 bg-white text-gray-800 font-semibold flex items-center justify-center gap-2 hover:bg-gray-50"><ShoppingBag className="w-4 h-4" /> Order Production Pack</button>
                <button onClick={() => window.open(`/approve/${selected.view_token}`, "_blank")} className="w-full h-10 rounded-xl text-gray-500 text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> See what the customer sees</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <img src={preview} alt="Design" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
