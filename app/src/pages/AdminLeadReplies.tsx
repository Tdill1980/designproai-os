/**
 * AdminLeadReplies — human-approval dashboard for AI-drafted lead replies.
 *
 * Backend: the `lead-inbox-agent` edge function in the WrapCommand-Production
 * Supabase project (the Azure Outlook / Microsoft Graph mail API — see
 * docs/AZURE_OUTLOOK_MARKETING_API.md). It scans trish@ / hello@ / design@
 * inboxes, classifies real leads vs noise, and drafts replies with the locked
 * WPW wholesale pricing. NOTHING SENDS until a human clicks Approve & Send
 * here. Approved sends go out from hello@weprintwraps.com. Delete buttons
 * remove the real message from the mailbox (agent action delete_email).
 *
 * Styling: WHITE UI with Marketing Hub-style gradient color buttons.
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Inbox, RefreshCw, Send, X, Eye, Pencil, Trash2, Sparkles, Paperclip, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_URL =
  "https://qxllysilzonrlyoaomce.supabase.co/functions/v1/lead-inbox-agent";
const JANITOR_URL =
  "https://qxllysilzonrlyoaomce.supabase.co/functions/v1/mailbox-janitor";
// WrapCommand-Production publishable anon key (client-safe by design).
const AGENT_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4bGx5c2lsem9ucmx5b2FvbWNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMzQxMjIsImV4cCI6MjA4MzgxMDEyMn0.s1IyOY7QAVyrTtG_XLhugJUvxi2X_nHCvqvchYCvwtM";

interface LeadAttachment {
  name: string;
  url: string;
  size?: number;
  contentType?: string;
}

interface LeadQuote {
  product_key?: string;
  product_name: string;
  sqft: number;
  price_per_sqft: number;
  total: number;
  cart_url: string | null;
}

/**
 * Mirror of QUOTE_PRODUCTS in the lead-inbox-agent edge function (v15) —
 * keys and list prices must match; the backend recomputes everything.
 */
const QUOTE_PRODUCTS: Record<string, { name: string; per: number }> = {
  avery_wrap: { name: "Avery MPI 1105 + DOL 1460Z printed wrap", per: 5.27 },
  "3m_wrap": { name: "3M IJ180Cv3 + 8518 printed wrap", per: 5.27 },
  avery_contour: { name: "Avery contour-cut vinyl", per: 6.32 },
  "3m_contour": { name: "3M contour-cut vinyl", per: 6.92 },
  window_perf: { name: "Window perf 50/50", per: 5.95 },
  wall_wrap: { name: "Wall wrap printed vinyl", per: 3.25 },
};

interface LeadReply {
  id: string;
  mailbox: string;
  system?: string | null;
  attachments?: LeadAttachment[] | null;
  quote?: LeadQuote | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_preview: string | null;
  received_at: string | null;
  lead_summary: string | null;
  draft_subject: string | null;
  draft_html: string | null;
  status: string;
  sent_from: string | null;
  sent_at: string | null;
  error: string | null;
}

async function callAgent(payload: Record<string, unknown>) {
  const res = await fetch(AGENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AGENT_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

const STATUS_TABS = [
  { key: "pending_review", label: "Needs Review", active: "from-blue-600 via-purple-600 to-pink-600" },
  { key: "approved_sent", label: "Sent", active: "from-emerald-500 to-green-600" },
  { key: "rejected", label: "Rejected", active: "from-red-500 to-red-600" },
  { key: "skipped", label: "Noise", active: "from-slate-500 to-slate-600" },
  { key: "email_deleted", label: "Deleted", active: "from-orange-500 to-red-500" },
] as const;

/** Color code per inbox so you can see at a glance where a lead came from. */
const MAILBOX_STYLE: Record<string, { border: string; badge: string; label: string }> = {
  "trish@weprintwraps.com": {
    border: "border-l-purple-500",
    badge: "bg-purple-100 text-purple-700 border-purple-200",
    label: "trish@",
  },
  "hello@weprintwraps.com": {
    border: "border-l-blue-500",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    label: "hello@",
  },
  "design@weprintwraps.com": {
    border: "border-l-pink-500",
    badge: "bg-pink-100 text-pink-700 border-pink-200",
    label: "design@",
  },
};
const mailboxStyle = (m: string) =>
  MAILBOX_STYLE[m] || { border: "border-l-slate-300", badge: "bg-slate-100 text-slate-600 border-slate-200", label: m };

/** Marketing Hub-style gradient strip per source inbox (card top bar + avatar). */
const MAILBOX_GRADIENT: Record<string, string> = {
  "trish@weprintwraps.com": "from-purple-500 to-fuchsia-500",
  "hello@weprintwraps.com": "from-blue-500 to-cyan-500",
  "design@weprintwraps.com": "from-pink-500 to-rose-500",
};
const mailboxGradient = (m: string) => MAILBOX_GRADIENT[m] || "from-slate-400 to-slate-500";

/**
 * System tag (button tag system): which product pipeline the email belongs to.
 * `system` is stamped by a DB trigger on the WrapCommand project — ApprovePro
 * traffic auto-surfaces here the day it goes live.
 */
const SYSTEM_STYLE: Record<string, { label: string; gradient: string; badge: string }> = {
  lead_inbox: {
    label: "Leads",
    gradient: "from-blue-600 to-purple-600",
    badge: "bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0",
  },
  orders_proofs: {
    label: "Orders & Proofs",
    gradient: "from-emerald-500 to-teal-600",
    badge: "bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0",
  },
  approvepro: {
    label: "ApprovePro",
    gradient: "from-amber-500 to-orange-600",
    badge: "bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0",
  },
};
const systemStyle = (s?: string | null) => SYSTEM_STYLE[s || "lead_inbox"] || SYSTEM_STYLE.lead_inbox;

/** Marketing Hub-style section title with the gradient bar marker. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500" />
      <h2 className="text-base font-bold text-slate-900">{children}</h2>
    </div>
  );
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

function statusBadge(status: string) {
  if (status === "pending_review")
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Needs review</Badge>;
  if (status === "approved_sent")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Sent</Badge>;
  if (status === "rejected")
    return <Badge className="bg-red-100 text-red-700 border-red-200">Rejected</Badge>;
  if (status === "skipped")
    return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Noise</Badge>;
  if (status === "email_deleted")
    return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Email deleted</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

interface QuoteStatRow {
  id: string;
  customer_name: string | null;
  customer_email: string;
  material: string | null;
  sqft: number;
  total_price: number;
  status: string;
  email_sent: boolean;
  converted_to_order: boolean;
  metadata?: { cart_url?: string | null } | null;
  created_at: string;
}

/** Quote pipeline analytics — every agent quote lands in the retargeting engine. */
function QuoteAnalyticsCard() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["quote-stats"],
    queryFn: async () => {
      const res = await callAgent({ action: "quote_stats" });
      return res as { stats: { drafted: number; drafted_value: number; sent: number; sent_value: number; converted: number; converted_value: number }; recent: QuoteStatRow[] };
    },
    refetchInterval: 120_000,
  });
  const s = data?.stats;
  const money = (n?: number) => `$${(n || 0).toLocaleString()}`;
  return (
    <Card className="rounded-2xl bg-white border border-slate-300 border-l-4 border-l-emerald-500 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_32px_-16px_rgba(15,23,42,0.22)]">
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 p-2">
              <Calculator className="h-5 w-5 text-white" />
            </div>
            <div className="text-sm">
              <div className="text-slate-900 font-semibold">Quote pipeline</div>
              <div className="text-slate-500 hidden sm:block">
                Every quote saved with its cart link for retargeting
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-50 ring-1 ring-blue-200 px-3 py-1 text-sm font-semibold text-blue-700">
              Drafted {s?.drafted ?? "…"} · {money(s?.drafted_value)}
            </span>
            <span className="rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-700">
              Sent {s?.sent ?? "…"} · {money(s?.sent_value)}
            </span>
            <span className="rounded-full bg-purple-50 ring-1 ring-purple-200 px-3 py-1 text-sm font-semibold text-purple-700">
              Won {s?.converted ?? "…"} · {money(s?.converted_value)}
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-slate-500 hover:text-slate-900" onClick={() => setOpen(!open)}>
              {open ? "Hide" : "Recent quotes"}
            </Button>
          </div>
        </div>
        {open && (
          <div className="rounded-xl bg-slate-100 ring-1 ring-slate-300 divide-y divide-slate-200 text-sm">
            {(data?.recent || []).slice(0, 10).map((q) => (
              <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-slate-900">{q.customer_name || q.customer_email}</span>{" "}
                  <span className="text-slate-500">
                    · {q.sqft.toLocaleString()} sq ft · {q.material || "—"} ·{" "}
                    {new Date(q.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">${(q.total_price || 0).toLocaleString()}</span>
                  {q.email_sent || q.status === "sent" ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Sent</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200">Draft</Badge>
                  )}
                  {q.metadata?.cart_url && (
                    <a href={q.metadata.cart_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">
                      Cart ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
            {!data?.recent?.length && <div className="px-3 py-2 text-slate-400">No quotes yet.</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Cleanup status for trish@ + a manual trigger for the mailbox-janitor. */
function CleanupCard() {
  const [running, setRunning] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["janitor-stats"],
    queryFn: async () => {
      const res = await fetch(JANITOR_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${AGENT_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stats", userEmail: "trish@weprintwraps.com" }),
      });
      const json = await res.json();
      const folders = (json?.data?.value || []) as Array<{ displayName: string; totalItemCount: number }>;
      const get = (n: string) => folders.find((f) => f.displayName === n)?.totalItemCount ?? 0;
      return { inbox: get("Inbox"), junk: get("Junk Email"), deleted: get("Deleted Items") };
    },
    refetchInterval: 120_000,
  });

  const runNow = async () => {
    setRunning(true);
    try {
      // 60s budget so the browser request returns; the 2-min cron does the bulk.
      const res = await fetch(JANITOR_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${AGENT_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto", budgetMs: 60_000 }),
      });
      const json = await res.json();
      toast.success(
        `Cleanup pass: ${(json.junk || 0) + (json.clutter || 0) + (json.noise || 0)} junk emails removed`
      );
      refetch();
    } catch (e: any) {
      toast.error(`Cleanup failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="rounded-2xl bg-white border border-slate-300 border-l-4 border-l-cyan-500 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_32px_-16px_rgba(15,23,42,0.22)]">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 p-2">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="text-sm">
            <div className="text-slate-900 font-semibold">trish@ cleanup &amp; folder sorting (auto)</div>
            <div className="text-slate-500">
              Inbox {data ? data.inbox.toLocaleString() : "…"} · Junk {data ? data.junk : "…"} · Deleted{" "}
              {data ? data.deleted : "…"}
              <span className="hidden sm:inline"> — spam deleted, receipts &amp; noise filed into folders</span>
            </div>
          </div>
        </div>
        <Button
          size="sm"
          onClick={runNow}
          disabled={running}
          className="rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white border-0 shadow-sm"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", running && "animate-spin")} />
          {running ? "Cleaning…" : "Run cleanup now"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Structured quote editor: change product / sq ft / price and the backend
 * recomputes the total, swaps the quote block inside the draft HTML, and
 * updates the `quotes` retargeting row — all in one `update` call.
 */
function QuoteEditor({
  rowId,
  quote,
  html,
  subject,
  onSaved,
  onClose,
}: {
  rowId: string;
  quote: LeadQuote | null;
  html: string;
  subject: string;
  onSaved: (q: LeadQuote, html: string) => void;
  onClose: () => void;
}) {
  const [productKey, setProductKey] = useState(quote?.product_key || "avery_wrap");
  const [sqft, setSqft] = useState(String(quote?.sqft || ""));
  const [price, setPrice] = useState(String(quote?.price_per_sqft ?? QUOTE_PRODUCTS[quote?.product_key || "avery_wrap"]?.per ?? ""));
  const [saving, setSaving] = useState(false);

  const product = QUOTE_PRODUCTS[productKey];
  const sqftNum = Math.ceil(Number(sqft) || 0);
  const priceNum = Number(price) || 0;
  const total = sqftNum > 0 && priceNum > 0 ? Math.round(sqftNum * priceNum * 100) / 100 : 0;
  const customPrice = product && Math.abs(priceNum - product.per) >= 0.005;

  const save = async () => {
    if (!product || sqftNum <= 0 || priceNum <= 0) {
      toast.error("Pick a product and enter square footage and price");
      return;
    }
    setSaving(true);
    try {
      const res = await callAgent({
        action: "update",
        id: rowId,
        draft_subject: subject,
        draft_html: html,
        quote_edit: { product_key: productKey, sqft: sqftNum, price_per_sqft: priceNum },
      });
      onSaved(res.quote as LeadQuote, res.draft_html as string);
      toast.success(`Quote updated — ${sqftNum.toLocaleString()} sq ft at $${priceNum.toFixed(2)}/sq ft = $${total.toLocaleString()}`);
      onClose();
    } catch (e: any) {
      toast.error(`Quote save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-emerald-50/60 ring-1 ring-emerald-200 p-4 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
        Edit quote — updates the email + saved quote record together
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Product</span>
          <select
            value={productKey}
            onChange={(e) => {
              setProductKey(e.target.value);
              setPrice(String(QUOTE_PRODUCTS[e.target.value]?.per ?? ""));
            }}
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
          >
            {Object.entries(QUOTE_PRODUCTS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name} (${p.per.toFixed(2)}/sq ft)
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Square feet</span>
          <Input
            type="number"
            min={1}
            value={sqft}
            onChange={(e) => setSqft(e.target.value)}
            className="bg-white text-slate-900 border-slate-200"
            placeholder="e.g. 1200"
          />
        </label>
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Price / sq ft</span>
          <Input
            type="number"
            step="0.01"
            min={0.01}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="bg-white text-slate-900 border-slate-200"
            placeholder={product ? product.per.toFixed(2) : ""}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-bold text-slate-900">
            Total: ${total > 0 ? total.toLocaleString() : "—"}
          </span>
          {customPrice && (
            <span className="ml-2 text-amber-700">
              Custom price — the email shows the quote as text (no cart button, since the cart charges list price).
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 text-white border-0 shadow-sm"
          >
            {saving ? "Saving…" : "Save quote"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-slate-500 hover:text-slate-900">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ThreadMsg {
  graph_id: string;
  from: string;
  from_name: string;
  subject: string;
  received_at: string;
  preview: string;
  has_attachments: boolean;
  direction: "inbound" | "outbound";
}

function DraftCard({ row, onDone }: { row: LeadReply; onDone: () => void }) {
  const [subject, setSubject] = useState(row.draft_subject || "");
  const [html, setHtml] = useState(row.draft_html || "");
  const [quote, setQuote] = useState<LeadQuote | null>(row.quote || null);
  const [atts, setAtts] = useState<LeadAttachment[]>(row.attachments || []);
  const [fullEmail, setFullEmail] = useState<{ html: string; web_link?: string | null } | null>(null);
  const [thread, setThread] = useState<ThreadMsg[] | null>(null);
  const [editingQuote, setEditingQuote] = useState(false);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = row.status === "pending_review";

  const loadFullEmail = async () => {
    if (fullEmail) { setFullEmail(null); return; }
    setBusy("fullemail");
    try {
      const res = await callAgent({ action: "email_body", id: row.id });
      setFullEmail({ html: res.html || "", web_link: res.web_link });
    } catch (e: any) {
      toast.error(`Couldn't load the full email: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const loadThread = async () => {
    if (thread) { setThread(null); return; }
    setBusy("thread");
    try {
      const res = await callAgent({ action: "thread", id: row.id });
      setThread((res.messages || []) as ThreadMsg[]);
    } catch (e: any) {
      toast.error(`Couldn't load the thread: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const getAttachments = async () => {
    setBusy("atts");
    try {
      const res = await callAgent({ action: "fetch_attachments", id: row.id });
      const got = (res.attachments || []) as LeadAttachment[];
      setAtts(got);
      toast.success(got.length ? `${got.length} attachment${got.length === 1 ? "" : "s"} pulled` : "No attachments on this email");
    } catch (e: any) {
      toast.error(`Attachment fetch failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const redraft = async () => {
    setBusy("redraft");
    try {
      const res = await callAgent({ action: "redraft", id: row.id });
      if (res.draft_subject) setSubject(res.draft_subject);
      if (res.draft_html) setHtml(res.draft_html);
      toast.success("Draft regenerated in Trish's voice");
      onDone();
    } catch (e: any) {
      toast.error(`Redraft failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!window.confirm(`Send this reply to ${row.from_email} from hello@weprintwraps.com?`)) return;
    setBusy("approve");
    try {
      await callAgent({ action: "approve", id: row.id, draft_subject: subject, draft_html: html });
      toast.success(`Sent to ${row.from_email}`);
      onDone();
    } catch (e: any) {
      toast.error(`Send failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    try {
      await callAgent({ action: "reject", id: row.id });
      toast.success("Draft rejected");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const saveEdits = async () => {
    setBusy("save");
    try {
      await callAgent({ action: "update", id: row.id, draft_subject: subject, draft_html: html });
      toast.success("Draft saved");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const escalate = async (to: "brice" | "design") => {
    const who = to === "brice" ? "Brice" : "the design team";
    const note = window.prompt(`Forward this email to ${who} asking "what should we do?" — add a note (optional):`, "");
    if (note === null) return;
    setBusy(`escalate-${to}`);
    try {
      await callAgent({ action: "escalate", id: row.id, to, note: note || undefined });
      toast.success(`Sent to ${who} (you're CC'd)`);
    } catch (e: any) {
      toast.error(`Escalation failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const deleteEmail = async () => {
    if (!window.confirm(`Delete the original email from ${row.from_email} out of the ${row.mailbox} mailbox?`)) return;
    setBusy("delete");
    try {
      await callAgent({ action: "delete_email", id: row.id });
      toast.success("Email deleted from mailbox");
      onDone();
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const mbox = mailboxStyle(row.mailbox);
  const sys = systemStyle(row.system);
  const initial = (row.from_name || row.from_email || "?").trim().charAt(0).toUpperCase();
  return (
    <Card className={cn("rounded-2xl overflow-hidden bg-white border border-slate-300 shadow-md hover:shadow-lg transition-all")}>
      <div className={cn("h-1.5 bg-gradient-to-r", mailboxGradient(row.mailbox))} />
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm", mailboxGradient(row.mailbox))}>
              {initial}
            </div>
            <CardTitle className="text-base text-slate-900 truncate">
              {row.from_name || row.from_email}
              <span className="ml-2 text-sm font-normal text-slate-500">&lt;{row.from_email}&gt;</span>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={sys.badge}>{sys.label}</Badge>
            {statusBadge(row.status)}
            <Badge className={mbox.badge}>{mbox.label}</Badge>
          </div>
        </div>
        <div className="text-sm text-slate-500">
          {row.subject} ·{" "}
          {row.received_at ? new Date(row.received_at).toLocaleString() : ""}
        </div>
        {row.lead_summary && (
          <div className="text-sm font-medium text-purple-700 mt-1">{row.lead_summary}</div>
        )}
        {(quote || pending) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {quote && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-700">
                Quote: {quote.sqft.toLocaleString()} sq ft · ${quote.total.toLocaleString()}{" "}
                <span className="font-normal text-emerald-600">
                  ({quote.product_name} @ ${quote.price_per_sqft.toFixed(2)}/sq ft)
                </span>
              </span>
            )}
            {quote?.cart_url && (
              <a
                href={quote.cart_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-1 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              >
                Cart link ↗
              </a>
            )}
            {pending && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 shadow-sm"
                onClick={() => setEditingQuote(!editingQuote)}
              >
                <Calculator className="h-3.5 w-3.5 mr-1.5" />
                {quote ? "Edit quote" : "Add quote"}
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {row.body_preview && (
          <div className="rounded-xl bg-slate-100 ring-1 ring-slate-300 p-4 text-sm text-slate-700">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Their email</div>
            {row.body_preview}
            {atts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Attachments they sent</div>
                <div className="flex flex-wrap gap-2">
                  {atts.map((a) => (
                    <a
                      key={a.url}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {a.name}
                      {a.size ? <span className="text-blue-400">({formatSize(a.size)})</span> : null}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={loadFullEmail} disabled={busy === "fullemail"}
                className="h-7 rounded-full bg-white bg-none text-slate-600 border-slate-300 hover:border-slate-400 hover:bg-white shadow-sm">
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {busy === "fullemail" ? "Loading…" : fullEmail ? "Hide full email" : "Full email"}
              </Button>
              <Button size="sm" variant="outline" onClick={loadThread} disabled={busy === "thread"}
                className="h-7 rounded-full bg-white bg-none text-slate-600 border-slate-300 hover:border-slate-400 hover:bg-white shadow-sm">
                <Inbox className="mr-1.5 h-3.5 w-3.5" />
                {busy === "thread" ? "Loading…" : thread ? "Hide thread" : "Full thread"}
              </Button>
              {atts.length === 0 && (
                <Button size="sm" variant="outline" onClick={getAttachments} disabled={busy === "atts"}
                  className="h-7 rounded-full bg-white bg-none text-slate-600 border-slate-300 hover:border-slate-400 hover:bg-white shadow-sm">
                  <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                  {busy === "atts" ? "Fetching…" : "Get attachments"}
                </Button>
              )}
            </div>
            {fullEmail && (
              <div className="mt-3 rounded-lg bg-white ring-1 ring-slate-300 p-4 max-h-96 overflow-auto">
                <div
                  className="prose prose-sm max-w-none text-slate-900 [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: fullEmail.html }}
                />
              </div>
            )}
            {thread && (
              <div className="mt-3 rounded-lg bg-white ring-1 ring-slate-300 divide-y divide-slate-200 max-h-96 overflow-auto">
                {thread.length === 0 && <div className="p-3 text-slate-400">No other messages found in this conversation.</div>}
                {thread.map((m) => (
                  <div key={m.graph_id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={m.direction === "outbound"
                        ? "bg-blue-100 text-blue-700 border-blue-200"
                        : "bg-emerald-100 text-emerald-700 border-emerald-200"}>
                        {m.direction === "outbound" ? "We sent" : "They sent"}
                      </Badge>
                      <span className="font-medium text-slate-900">{m.from_name || m.from}</span>
                      <span className="text-xs text-slate-400">
                        {m.received_at ? new Date(m.received_at).toLocaleString() : ""}
                      </span>
                      {m.has_attachments && <Paperclip className="h-3 w-3 text-slate-400" />}
                    </div>
                    <div className="mt-1 text-slate-600">{m.preview}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {editingQuote && pending && (
          <QuoteEditor
            rowId={row.id}
            quote={quote}
            html={html}
            subject={subject}
            onSaved={(q, newHtml) => {
              setQuote(q);
              setHtml(newHtml);
              onDone();
            }}
            onClose={() => setEditingQuote(false)}
          />
        )}
        {(pending || row.draft_html) && (
        <div className="rounded-xl bg-slate-100 ring-1 ring-slate-300 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">AI draft reply</div>
            {pending && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-slate-500 hover:text-slate-900"
                onClick={() => setPreview(!preview)}
              >
                {preview ? <Pencil className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {preview ? "Edit" : "Preview"}
              </Button>
            )}
          </div>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!pending}
            className="mb-2 bg-white text-slate-900 border-slate-200"
            placeholder="Reply subject"
          />
          {preview ? (
            <div
              className="prose prose-sm max-w-none rounded-xl bg-white ring-1 ring-slate-200 text-slate-900 p-4 [&_p]:my-2 [&_table]:text-sm"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <Textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={12}
              className="bg-white text-slate-700 border-slate-200 font-mono text-xs"
            />
          )}
        </div>
        )}
        {row.error && <div className="text-sm text-red-600">Last error: {row.error}</div>}
        {row.sent_at && (
          <div className="text-sm text-emerald-600">
            Sent {new Date(row.sent_at).toLocaleString()} from {row.sent_from}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {pending && (
            <>
              <Button
                onClick={approve}
                disabled={!!busy}
                className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 text-white border-0 shadow-sm"
              >
                <Send className="h-4 w-4 mr-2" />
                {busy === "approve" ? "Sending…" : "Approve & Send"}
              </Button>
              <Button
                onClick={saveEdits}
                disabled={!!busy}
                className="rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:opacity-90 text-white border-0 shadow-sm"
              >
                {busy === "save" ? "Saving…" : "Save edits"}
              </Button>
              <Button
                onClick={reject}
                disabled={!!busy}
                variant="outline"
                className="rounded-lg border-red-200 text-red-600 hover:bg-red-50"
              >
                <X className="h-4 w-4 mr-2" />
                {busy === "reject" ? "…" : "Reject"}
              </Button>
              <Button
                onClick={redraft}
                disabled={!!busy}
                className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white border-0 shadow-sm"
                title="Regenerate this draft with the current voice profile"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {busy === "redraft" ? "Redrafting…" : "Redraft"}
              </Button>
            </>
          )}
          <Button
            onClick={() => escalate("brice")}
            disabled={!!busy}
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 hover:opacity-90 text-white border-0 shadow-sm"
            title="Forward to Brice asking what we should do (you're CC'd)"
          >
            <Send className="h-4 w-4 mr-2" />
            {busy === "escalate-brice" ? "Sending…" : "Ask Brice"}
          </Button>
          <Button
            onClick={() => escalate("design")}
            disabled={!!busy}
            className="rounded-lg bg-gradient-to-r from-pink-500 to-rose-600 hover:opacity-90 text-white border-0 shadow-sm"
            title="Forward to design@ asking what we should do (you're CC'd)"
          >
            <Send className="h-4 w-4 mr-2" />
            {busy === "escalate-design" ? "Sending…" : "Design team"}
          </Button>
          {row.status !== "email_deleted" && (
            <Button
              onClick={deleteEmail}
              disabled={!!busy}
              className="rounded-lg bg-gradient-to-r from-red-500 to-orange-600 hover:opacity-90 text-white border-0 shadow-sm"
              title="Delete the original email out of the mailbox"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {busy === "delete" ? "Deleting…" : "Delete email"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminLeadReplies() {
  const [tab, setTab] = useState<string>("pending_review");
  const [mailboxFilter, setMailboxFilter] = useState<string>("all");
  const [systemFilter, setSystemFilter] = useState<string>("all");
  const [quotesOnly, setQuotesOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["lead-replies", tab],
    queryFn: async () => {
      const res = await callAgent({ action: "list", status: tab, limit: 100 });
      return (res.rows || []) as LeadReply[];
    },
    refetchInterval: 60_000,
  });

  const scanNow = async () => {
    setScanning(true);
    try {
      const res = await callAgent({ action: "scan", limit: 25 });
      toast.success(
        `Scanned ${res.scanned} new emails — ${res.new_drafts} new lead draft${res.new_drafts === 1 ? "" : "s"}, ${res.skipped} skipped`
      );
      queryClient.invalidateQueries({ queryKey: ["lead-replies"] });
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  const rows = (data || []).filter(
    (r) =>
      (mailboxFilter === "all" || r.mailbox === mailboxFilter) &&
      (systemFilter === "all" || (r.system || "lead_inbox") === systemFilter) &&
      (!quotesOnly || !!r.quote)
  );

  return (
    <div className="min-h-screen bg-slate-200 text-slate-900 px-4 py-8 pb-32 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
              <span className="rounded-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 p-2">
                <Inbox className="h-5 w-5 text-white" />
              </span>
              Lead{" "}
              <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                Replies
              </span>
            </h1>
            <p className="text-sm text-slate-500">
              Your assistant drafts replies to inbox leads (trish@ + hello@ +
              design@). Review, edit, then Approve &amp; Send — it sends from
              hello@weprintwraps.com with the branded assistant signature and
              CCs trish@ so you always have the record. Delete buttons remove
              the real email from the mailbox.
            </p>
          </div>
          <Button
            onClick={scanNow}
            disabled={scanning}
            className="rounded-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 text-white border-0 shadow-md"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", scanning && "animate-spin")} />
            {scanning ? "Scanning inbox…" : "Scan inbox now"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant="outline"
              className={cn(
                tab === t.key
                  ? `rounded-full bg-gradient-to-r ${t.active} text-white border-transparent shadow-sm hover:opacity-90 hover:text-white`
                  : "rounded-full bg-white bg-none text-slate-600 border-slate-200 shadow-sm hover:border-slate-300 hover:text-slate-900 hover:bg-white"
              )}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="text-slate-500 hover:text-slate-900 bg-none"
            onClick={() => refetch()}
          >
            Refresh
          </Button>
        </div>

        {/* Inbox filter — color-coded to match each card's left border */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Inbox:</span>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-7 rounded-full shadow-sm",
              mailboxFilter === "all"
                ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            )}
            onClick={() => setMailboxFilter("all")}
          >
            All
          </Button>
          {Object.entries(MAILBOX_STYLE).map(([mb, s]) => (
            <Button
              key={mb}
              size="sm"
              variant="outline"
              className={cn(
                "h-7 rounded-full border shadow-sm",
                mailboxFilter === mb ? s.badge + " ring-2 ring-offset-1" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
              onClick={() => setMailboxFilter(mailboxFilter === mb ? "all" : mb)}
            >
              <span className={cn("mr-1.5 inline-block h-2.5 w-2.5 rounded-full", s.border.replace("border-l-", "bg-"))} />
              {s.label}
            </Button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-300" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">System:</span>
          {Object.entries(SYSTEM_STYLE).map(([key, s]) => (
            <Button
              key={key}
              size="sm"
              variant="outline"
              className={cn(
                "h-7 rounded-full border shadow-sm",
                systemFilter === key
                  ? `bg-gradient-to-r ${s.gradient} text-white border-transparent hover:text-white hover:opacity-90`
                  : "bg-white bg-none text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-white"
              )}
              onClick={() => setSystemFilter(systemFilter === key ? "all" : key)}
            >
              {s.label}
            </Button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-300" />
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-7 rounded-full border shadow-sm",
              quotesOnly
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 ring-2 ring-offset-1"
                : "bg-white bg-none text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-white"
            )}
            onClick={() => setQuotesOnly(!quotesOnly)}
            title="Show only leads with a quote attached"
          >
            <Calculator className="mr-1.5 h-3.5 w-3.5" />
            Quote requests
          </Button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <SectionTitle>
            Responses — {STATUS_TABS.find((t) => t.key === tab)?.label}
          </SectionTitle>
          <Badge className="bg-slate-900 text-white border-slate-900">{rows.length}</Badge>
        </div>

        {isLoading ? (
          <div className="text-slate-500 py-10 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-slate-400 py-10 text-center border border-dashed border-slate-300 rounded-2xl bg-white py-14 shadow-sm">
            Nothing here. Hit “Scan inbox now” to pull the latest email.
          </div>
        ) : (
          rows.map((row) => (
            <DraftCard
              key={row.id}
              row={row}
              onDone={() => queryClient.invalidateQueries({ queryKey: ["lead-replies"] })}
            />
          ))
        )}

        <SectionTitle>Agent status</SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <CleanupCard />
          <QuoteAnalyticsCard />
        </div>
      </div>
    </div>
  );
}
