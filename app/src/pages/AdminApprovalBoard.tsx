import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { brandMeta } from "@/lib/content-tags";
import { useContentApprover } from "@/hooks/useContentApprover";
import { toast } from "sonner";
import {
  CheckCircle2, RotateCcw, Send, Calendar, Rocket, AlertTriangle,
  Paperclip, ShieldCheck, Clock, PencilRuler, Ban, Copy, Check, Sparkles,
} from "lucide-react";

const db = supabase as any;
const BRAND = "weprintwraps";

// WHO MAY APPROVE — `useContentApprover`, the same gate the Brand Board uses.
//
// This was `const APPROVERS = ["trish@weprintwraps.com"]` — one hardcoded
// address — and every other admin was shown "Waiting on Trish to approve" with
// the Approve and Changes buttons withheld. Jackson holds the `admin` role in
// `user_roles` AND sits on the admin allowlist, and could approve everywhere
// else in the app; here he could only watch. A literal cannot be granted or
// revoked, and it does not fail loudly when it is wrong — it just tells a
// colleague, on the screen where the work waits, that he is not trusted.
//
// Approving is now what it says it is: an admin (or tester) thing, resolved
// from roles. Anyone still outside that gets a message that names the actual
// rule instead of naming one person.

// ── stages (Asana-style columns) ─────────────────────────────────────────────
type Stage =
  | "draft" | "needs_approval" | "changes_requested"
  | "approved" | "scheduled" | "posted";

const STAGES: {
  key: Stage; label: string; icon: any; tint: string; hbg: string; head: string; note?: string;
}[] = [
  { key: "draft",              label: "Draft",             icon: PencilRuler,   tint: "bg-slate-100 border-slate-300",     hbg: "bg-slate-200",   head: "text-slate-700" },
  { key: "needs_approval",     label: "Needs Approval",    icon: Clock,         tint: "bg-amber-100 border-amber-300",     hbg: "bg-amber-200",   head: "text-amber-900" },
  { key: "changes_requested",  label: "Changes Requested", icon: AlertTriangle, tint: "bg-rose-100 border-rose-300",       hbg: "bg-rose-200",    head: "text-rose-900" },
  { key: "approved",           label: "Approved",          icon: CheckCircle2,  tint: "bg-emerald-100 border-emerald-300", hbg: "bg-emerald-200", head: "text-emerald-900", note: "OK to schedule / post" },
  { key: "scheduled",          label: "Scheduled",         icon: Calendar,      tint: "bg-sky-100 border-sky-300",         hbg: "bg-sky-200",     head: "text-sky-900" },
  { key: "posted",             label: "Posted",            icon: Rocket,        tint: "bg-violet-100 border-violet-300",   hbg: "bg-violet-200",  head: "text-violet-900" },
];

const POSTABLE: Stage[] = ["approved", "scheduled", "posted"];

// A task is a "marketing item" that needs approval if it carries real creative
// (attachments / an asset_kind) or has already been given an approval stage.
function isContentItem(t: any): boolean {
  const m = t?.metadata || {};
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  return atts.length > 0 || !!m.asset_kind || !!m.approval_stage ||
    ["social_post", "paid_ad", "reel", "carousel", "blog", "email", "video", "content"].includes(t?.task_type);
}

function stageOf(t: any): Stage {
  const s = t?.metadata?.approval_stage as Stage | undefined;
  if (s && STAGES.some((x) => x.key === s)) return s;
  return "draft";
}

function cleanTitle(title: string): string {
  return (title || "")
    .replace(/^🚫\s*DRAFT — DO NOT POST ·\s*/u, "")
    .replace(/^⏳\s*NEEDS APPROVAL ·\s*/u, "")
    .trim();
}

function useApprovalTasks() {
  return useQuery({
    queryKey: ["approval-board", BRAND],
    queryFn: async () => {
      const { data, error } = await db
        .from("slack_agent_tasks")
        .select("*")
        .eq("brand", BRAND)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).filter(isContentItem);
    },
    refetchInterval: 30000,
  });
}

export default function AdminApprovalBoard() {
  const qc = useQueryClient();
  const { data: tasks = [], isLoading } = useApprovalTasks();
  const [scheduleFor, setScheduleFor] = useState<any | null>(null);
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [viewFiles, setViewFiles] = useState<any | null>(null);
  const [editFor, setEditFor] = useState<any | null>(null);
  const [editText, setEditText] = useState<string>("");
  const { isApprover, email, loading: approverLoading } = useContentApprover();

  const requestEdit = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data: rows } = await db.from("slack_agent_tasks").select("metadata,title").eq("id", id).limit(1);
      const cur = rows?.[0] || {};
      let email: string | null = null;
      try { const u = await supabase.auth.getUser(); email = u.data.user?.email ?? null; } catch { /* noop */ }
      const nowIso = new Date().toISOString();
      // Fire the auto-fix pipeline: create a GitHub issue Claude picks up.
      let issueUrl: string | null = null;
      try {
        const { data: fn } = await supabase.functions.invoke("error-fix-dispatch", {
          body: { kind: "marketing_edit", taskId: id, title: cur.title, request: text, requestedBy: email, boardUrl: window.location.href },
        });
        if (fn?.ok) issueUrl = fn.issue_url ?? null;
      } catch { /* pipeline offline — request is still logged on the card below */ }

      const prev = Array.isArray(cur.metadata?.claude_requests) ? cur.metadata.claude_requests : [];
      const meta = {
        ...(cur.metadata || {}),
        claude_requests: [...prev, { text, by: email, at: nowIso, status: "open", issue_url: issueUrl }],
        approval_stage: "changes_requested",
        do_not_post: true,
      };
      const { error } = await db.from("slack_agent_tasks")
        .update({ metadata: meta, title: cleanTitle(cur.title || ""), status: "in_progress", updated_at: nowIso })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-board", BRAND] });
      toast.success("Sent to Claude — it'll show in Changes Requested");
    },
    onError: (e: any) => toast.error("Couldn't send: " + (e?.message || e)),
  });

  const setStage = useMutation({
    mutationFn: async ({ id, stage, patch }: { id: string; stage: Stage; patch?: any }) => {
      const { data: rows } = await db.from("slack_agent_tasks").select("metadata,title").eq("id", id).limit(1);
      const cur = rows?.[0] || {};
      let email: string | null = null;
      try { const u = await supabase.auth.getUser(); email = u.data.user?.email ?? null; } catch { /* noop */ }
      const nowIso = new Date().toISOString();
      const meta = {
        ...(cur.metadata || {}),
        approval_stage: stage,
        do_not_post: !POSTABLE.includes(stage),
        ...(stage === "approved" ? { approved_by: email, approved_at: nowIso } : {}),
        ...(patch || {}),
      };
      // keep the human title clean of gate prefixes; the stage column is the source of truth now
      const title = cleanTitle(cur.title || "");
      const update: any = { metadata: meta, title, updated_at: nowIso };
      if (stage === "posted") update.status = "completed";
      else if (stage === "scheduled") { update.status = "pending"; if (patch?.due_date) update.due_date = patch.due_date; }
      else if (stage === "approved") update.status = "pending";
      else update.status = "in_progress";
      if (stage !== "scheduled") update.due_date = stage === "posted" ? cur.due_date ?? null : (stage === "approved" ? cur.due_date ?? null : null);
      const { error } = await db.from("slack_agent_tasks").update(update).eq("id", id);
      if (error) throw error;

      // Keep a linked Shot List item's status in sync with its board card —
      // approve/post here, and the shot the footage came from reflects it.
      const shotId = meta.shot_list_item_id;
      if (shotId && (stage === "approved" || stage === "posted")) {
        await db.from("shot_list_items")
          .update({ status: stage === "posted" ? "published" : "approved", updated_at: nowIso })
          .eq("id", shotId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-board", BRAND] });
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
    },
    onError: (e: any) => toast.error("Update failed: " + (e?.message || e)),
  });

  const move = (id: string, stage: Stage, patch?: any, msg?: string) =>
    setStage.mutate({ id, stage, patch }, { onSuccess: () => { if (msg) toast.success(msg); } });

  const grouped = (s: Stage) => tasks.filter((t: any) => stageOf(t) === s);
  const pendingCount = grouped("needs_approval").length;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* header */}
      <div className="border-b border-gray-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Marketing Approval Board</h1>
            <p className="text-sm text-gray-500">
              Every marketing item is approved here before it goes out. {pendingCount > 0 && (
                <span className="text-amber-700 font-semibold">{pendingCount} waiting on you.</span>
              )}
            </p>
          </div>
        </div>
        {/* guardrail */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <Ban className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <b>Posting rule:</b> only items in <b>✅ Approved</b>, <b>📅 Scheduled</b>, or <b>🚀 Posted</b> may go out.
            Anything in Draft / Needs Approval / Changes Requested is <b>NOT cleared to post</b>.
          </span>
        </div>
      </div>

      {/* board */}
      <div className="overflow-x-auto p-6">
        <div className="flex gap-4 min-w-max">
          {STAGES.map((col) => {
            const items = grouped(col.key);
            const Icon = col.icon;
            return (
              <div key={col.key} className={cn("w-[300px] shrink-0 rounded-xl border-2 overflow-hidden", col.tint)}>
                <div className={cn("px-3 py-3 flex items-center justify-between", col.hbg)}>
                  <div className={cn("flex items-center gap-2 font-bold", col.head)}>
                    <Icon className="w-4 h-4" />
                    <span>{col.label}</span>
                    <Badge variant="secondary" className="ml-1 bg-white text-gray-800">{items.length}</Badge>
                  </div>
                </div>
                {col.note && (
                  <div className={cn("px-3 py-1.5 text-[11px] font-medium", col.head)}>{col.note}</div>
                )}
                <div className="p-2 space-y-2 min-h-[120px]">
                  {items.length === 0 && (
                    <div className="text-center text-xs text-gray-400 py-8">Nothing here</div>
                  )}
                  {items.map((t: any) => (
                    <ItemCard
                      key={t.id}
                      task={t}
                      stage={col.key}
                      busy={setStage.isPending}
                      isApprover={isApprover}
                      approverLoading={approverLoading}
                      onView={() => setViewFiles(t)}
                      onRequestEdit={() => { setEditFor(t); setEditText(""); }}
                      onSubmit={() => move(t.id, "needs_approval", undefined, "Sent for approval")}
                      onApprove={() => move(t.id, "approved", undefined, "Approved ✅ — cleared to post")}
                      onRequestChanges={() => move(t.id, "changes_requested", undefined, "Sent back for changes")}
                      onSchedule={() => { setScheduleFor(t); setScheduleAt(""); }}
                      onPosted={() => move(t.id, "posted", undefined, "Marked posted 🚀")}
                      onReopen={() => move(t.id, "draft", undefined, "Reopened")}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {isLoading && <p className="text-sm text-gray-400 mt-4">Loading…</p>}
      </div>

      {/* request Claude edit */}
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-fuchsia-600" />
              Request a Claude edit
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-1">
            Describe the change for <b>{editFor && cleanTitle(editFor.title)}</b>. Claude picks it up from the
            board and pushes the fix; the card moves to <b>Changes Requested</b> until it's done.
          </p>
          <Textarea
            rows={4}
            placeholder='e.g. "Make the hook white-UI and swap slide 4 photo for the finished truck."'
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFor(null)}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90"
              disabled={!editText.trim() || requestEdit.isPending}
              onClick={() => {
                requestEdit.mutate({ id: editFor.id, text: editText.trim() }, { onSuccess: () => setEditFor(null) });
              }}
            >
              <Sparkles className="w-4 h-4 mr-1" />Send to Claude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* file viewer */}
      <Dialog open={!!viewFiles} onOpenChange={(o) => !o && setViewFiles(null)}>
        <DialogContent className="bg-white max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewFiles && cleanTitle(viewFiles.title)}</DialogTitle>
          </DialogHeader>
          {(() => {
            const atts = Array.isArray(viewFiles?.metadata?.attachments) ? viewFiles.metadata.attachments : [];
            if (atts.length === 0) return <p className="text-sm text-gray-500">No files on this card.</p>;
            return (
              <>
                <p className="text-xs text-gray-500 -mt-2 mb-1">{atts.length} file{atts.length > 1 ? "s" : ""} — click any to open full size in a new tab.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {atts.map((a: any, i: number) => {
                    const url = a?.url;
                    const isVideo = a?.type === "video" || /\.(mp4|mov|webm|m4v)$/i.test(url || "");
                    return (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                         className="block rounded-lg overflow-hidden border border-gray-200 bg-gray-50 hover:ring-2 hover:ring-blue-400 transition">
                        <div className="aspect-[4/5] bg-gray-100 flex items-center justify-center">
                          {isVideo
                            ? <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                            : <img src={url} alt={a?.name || ""} className="w-full h-full object-cover" loading="lazy" />}
                        </div>
                        <div className="px-2 py-1 text-[10px] text-gray-600 truncate">{a?.name || `File ${i + 1}`}{isVideo ? " ▶" : ""}</div>
                      </a>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* schedule dialog */}
      <Dialog open={!!scheduleFor} onOpenChange={(o) => !o && setScheduleFor(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Schedule “{scheduleFor && cleanTitle(scheduleFor.title)}”</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">Pick the exact date &amp; time it should publish.</p>
          <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleFor(null)}>Cancel</Button>
            <Button
              disabled={!scheduleAt}
              onClick={() => {
                const iso = new Date(scheduleAt).toISOString();
                move(scheduleFor.id, "scheduled", { due_date: iso }, "Scheduled 📅");
                setScheduleFor(null);
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaptionBox({ caption }: { caption?: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  if (!caption) {
    return (
      <div className="mt-2 text-[10px] text-gray-400 italic border border-dashed border-gray-200 rounded px-2 py-1">
        No caption loaded yet
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      toast.success("Caption copied — paste & post");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-200">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Caption</span>
        <button
          onClick={copy}
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold rounded px-2 py-0.5 transition-colors",
            copied ? "bg-emerald-600 text-white" : "bg-gray-900 text-white hover:bg-gray-700"
          )}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={cn("px-2 py-1.5 text-[11px] text-gray-700 whitespace-pre-wrap cursor-pointer", !open && "line-clamp-3")}
        onClick={() => setOpen((v) => !v)}
        title={open ? "Click to collapse" : "Click to expand"}
      >
        {caption}
      </div>
    </div>
  );
}

function ItemCard({
  task, stage, busy, isApprover, approverLoading, onView, onRequestEdit,
  onSubmit, onApprove, onRequestChanges, onSchedule, onPosted, onReopen,
}: {
  task: any; stage: Stage; busy: boolean; isApprover: boolean;
  /** Still resolving the role — say nothing rather than "you can't". */
  approverLoading?: boolean;
  onView: () => void; onRequestEdit: () => void;
  onSubmit: () => void; onApprove: () => void; onRequestChanges: () => void;
  onSchedule: () => void; onPosted: () => void; onReopen: () => void;
}) {
  const m = task.metadata || {};
  const claudeReqs: any[] = Array.isArray(m.claude_requests) ? m.claude_requests : [];
  const openReqs = claudeReqs.filter((r) => r?.status !== "done");
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  const thumb = m.thumbnail_url || atts.find((a: any) => a?.type === "image")?.url || null;
  const formats: string[] = Array.isArray(m.formats) ? m.formats : [];
  const channel = m.primary_channel ? String(m.primary_channel).replace(/_/g, " ") : null;
  const due = task.due_date ? new Date(task.due_date) : null;
  const cardBrand = m.target_brand || task.brand;

  return (
    <Card className="border-l-4 bg-white p-2.5 shadow-sm border-y border-r border-gray-200" style={{ borderLeftColor: brandMeta(cardBrand).color }}>
      <div className="mb-1.5 text-[10px] font-bold" style={{ color: brandMeta(cardBrand).color }}>{brandMeta(cardBrand).label}</div>
      {thumb && (
        <button onClick={onView} className="relative block w-full rounded-md overflow-hidden mb-2 bg-gray-100 aspect-[4/3] group">
          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
          {atts.length > 0 && (
            <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 bg-black/70 text-white text-[10px] font-semibold rounded px-1.5 py-0.5">
              <Paperclip className="w-3 h-3" />{atts.length} · View
            </span>
          )}
        </button>
      )}
      <div className="text-[13px] font-semibold leading-snug text-gray-900 line-clamp-3">
        {cleanTitle(task.title)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {task.assigned_to && <Badge variant="secondary" className="text-[10px] capitalize bg-gray-200 text-gray-700">{task.assigned_to}</Badge>}
        {channel && <Badge variant="secondary" className="text-[10px] capitalize bg-gray-200 text-gray-700">{channel}</Badge>}
        {atts.length > 0 && (
          <button onClick={onView} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 hover:underline">
            <Paperclip className="w-3 h-3" />View {atts.length} file{atts.length > 1 ? "s" : ""}
          </button>
        )}
      </div>
      {formats.length > 0 && (
        <div className="mt-1 text-[10px] text-gray-400">{formats.join(" · ")}</div>
      )}
      <CaptionBox caption={m.caption} />
      {m.revision_note && stage === "changes_requested" && (
        <div className="mt-1.5 text-[11px] text-rose-700 bg-rose-50 rounded p-1.5 line-clamp-4">{m.revision_note}</div>
      )}
      {openReqs.length > 0 && (
        <div className="mt-1.5 rounded-md border border-fuchsia-200 bg-fuchsia-50 p-1.5 space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-fuchsia-700 uppercase tracking-wide">
            <Sparkles className="w-3 h-3" />Claude edit requested
          </div>
          {openReqs.slice(-3).map((r, i) => (
            <div key={i} className="text-[11px] text-fuchsia-900">
              “{r.text}”
              {r.by && <span className="text-fuchsia-500"> — {String(r.by).split("@")[0]}</span>}
            </div>
          ))}
        </div>
      )}
      {due && (
        <div className="mt-1 text-[10px] text-gray-500 flex items-center gap-1">
          <Calendar className="w-3 h-3" />{due.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      )}
      {m.approved_by && stage !== "draft" && stage !== "needs_approval" && (
        <div className="mt-1 text-[10px] text-emerald-700">✓ approved by {m.approved_by}</div>
      )}

      {/* actions */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(stage === "draft" || stage === "changes_requested") && (
          <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={onSubmit}>
            <Send className="w-3 h-3 mr-1" />Submit for approval
          </Button>
        )}
        {stage === "needs_approval" && isApprover && (
          <>
            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={onApprove}>
              <CheckCircle2 className="w-3 h-3 mr-1" />Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-rose-700 border-rose-200" disabled={busy} onClick={onRequestChanges}>
              <AlertTriangle className="w-3 h-3 mr-1" />Changes
            </Button>
          </>
        )}
        {/* NAME THE RULE, NOT A PERSON. The old copy read "Waiting on Trish to
            approve" — which was true of the code and false about the team, and
            it is what a second admin reads as "only she can look at this". The
            gate is a role now, so the message states the role. */}
        {stage === "needs_approval" && !isApprover && !approverLoading && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 rounded px-2 py-1">
            <Clock className="w-3 h-3" />
            Waiting on an admin to approve — you can still submit, request edits and mark posted.
          </span>
        )}
        {stage === "approved" && (
          <>
            <Button size="sm" className="h-7 text-xs bg-sky-600 hover:bg-sky-700" disabled={busy} onClick={onSchedule}>
              <Calendar className="w-3 h-3 mr-1" />Schedule
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onPosted}>
              <Rocket className="w-3 h-3 mr-1" />Mark posted
            </Button>
          </>
        )}
        {stage === "scheduled" && (
          <>
            <Button size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700" disabled={busy} onClick={onPosted}>
              <Rocket className="w-3 h-3 mr-1" />Mark posted
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onSchedule}>
              <Calendar className="w-3 h-3 mr-1" />Reschedule
            </Button>
          </>
        )}
        {stage === "posted" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onReopen}>
            <RotateCcw className="w-3 h-3 mr-1" />Reopen
          </Button>
        )}
      </div>
      {/* request a Claude edit — available on every card */}
      <button
        onClick={onRequestEdit}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-md border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50 py-1.5 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" />Request Claude edit
      </button>
    </Card>
  );
}
