/**
 * EngineRoomIssueReporter
 *
 * A side-sheet opened from the Engine Room header's "Report Issue" button.
 * Internal WPW + RestylePro team members can:
 *   1. Log new issues in markdown (the whole body is freeform markdown so
 *      it can be copied straight to Claude for systematic fixes).
 *   2. Browse, resolve, and copy existing issues.
 *   3. See flagged star-rating feedback from render_quality_ratings
 *      surfaced alongside manually-logged issues — the ratings previously
 *      had no home, this is where they land.
 *
 * Data lives in public.engine_room_issues (see
 * sql/create-engine-room-issues.sql). types.ts is auto-generated and
 * does not yet include the new table, so Supabase calls cast through
 * `(supabase as any)` — the same pattern used elsewhere in this page
 * (AdminMarketingHub.tsx:2885).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  Bug,
  Copy,
  Check,
  Star,
  AlertTriangle,
  Flag,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Brand = "restylepro" | "weprintwraps";

type IssueRow = {
  id: string;
  created_at: string;
  reporter_email: string | null;
  reporter_name: string | null;
  brand: string;
  tool: string | null;
  category: string;
  severity: string;
  title: string;
  body_markdown: string;
  page_url: string | null;
  user_agent: string | null;
  render_id: string | null;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
};

type FlaggedRating = {
  id: string;
  created_at: string;
  rating: number;
  render_type: string | null;
  render_id: string | null;
  user_email: string | null;
  is_flagged: boolean | null;
  flag_reason: string | null;
  notes: string | null;
};

const TOOL_OPTIONS = [
  { value: "colorpro", label: "ColorPro" },
  { value: "designpro", label: "DesignPro" },
  { value: "designpanelpro", label: "DesignPanelPro" },
  { value: "fadewraps", label: "FadeWraps" },
  { value: "wbty", label: "WBTY" },
  { value: "graphicspro", label: "GraphicsPro" },
  { value: "printpro", label: "PrintPro" },
  { value: "approvemode", label: "ApproveMode" },
  { value: "visualize", label: "Visualize" },
  { value: "material", label: "MaterialMode" },
  { value: "panelizer", label: "Panelizer" },
  { value: "admin", label: "Admin / Engine Room" },
  { value: "auth", label: "Auth / Signup / Login" },
  { value: "billing", label: "Billing / Subscriptions" },
  { value: "other", label: "Other" },
];

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug" },
  { value: "ux", label: "UX / Copy" },
  { value: "render-quality", label: "Render Quality" },
  { value: "performance", label: "Performance" },
  { value: "feature", label: "Feature Request" },
  { value: "other", label: "Other" },
];

const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  high: "bg-amber-50 text-amber-800 border-amber-300",
  critical: "bg-red-50 text-red-700 border-red-300",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "in-progress": "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-slate-100 text-slate-500 border-slate-200 line-through",
  wontfix: "bg-slate-100 text-slate-500 border-slate-200",
  duplicate: "bg-slate-100 text-slate-500 border-slate-200",
};

const MARKDOWN_PLACEHOLDER = `## What happened
Describe the problem in 1-2 sentences.

## Steps to reproduce
1.
2.
3.

## Expected vs actual
-

## Screenshots / render IDs
- `;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: Brand;
  currentUserEmail: string | null;
  isWpwTenant?: boolean;
}

export function EngineRoomIssueReporter({
  open,
  onOpenChange,
  brand,
  currentUserEmail,
  isWpwTenant,
}: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"new" | "log">("new");

  // ── New-issue form state ────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [tool, setTool] = useState<string>("");
  const [category, setCategory] = useState<string>("bug");
  const [severity, setSeverity] = useState<string>("medium");
  const [bodyMd, setBodyMd] = useState("");
  const [renderId, setRenderId] = useState("");

  // ── Log filter state ────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Fetch issues ────────────────────────────────────────────────────────
  const { data: issues = [], isLoading: issuesLoading } = useQuery<IssueRow[]>({
    queryKey: ["engine-room-issues", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("engine_room_issues")
        .select("*")
        .in("brand", [brand, "both"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as IssueRow[];
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  // ── Fetch flagged / noted star ratings (the "goes nowhere" feedback) ────
  const { data: flaggedRatings = [] } = useQuery<FlaggedRating[]>({
    queryKey: ["engine-room-flagged-ratings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("render_quality_ratings")
        .select("id, created_at, rating, render_type, render_id, user_email, is_flagged, flag_reason, notes")
        .or("is_flagged.eq.true,notes.not.is.null")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as FlaggedRating[];
    },
    enabled: open,
  });

  const openCount = useMemo(
    () => issues.filter((i) => i.status === "open" || i.status === "in-progress").length,
    [issues],
  );

  const filteredIssues = useMemo(() => {
    if (statusFilter === "all") return issues;
    if (statusFilter === "active") {
      return issues.filter((i) => i.status === "open" || i.status === "in-progress");
    }
    return issues.filter((i) => i.status === statusFilter);
  }, [issues, statusFilter]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const { mutateAsync: createIssue, isPending: creating } = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        reporter_user_id: user?.id ?? null,
        reporter_email: currentUserEmail,
        brand: isWpwTenant ? "weprintwraps" : brand,
        tool: tool || null,
        category,
        severity,
        title: title.trim(),
        body_markdown: bodyMd.trim(),
        render_id: renderId.trim() || null,
        page_url: typeof window !== "undefined" ? window.location.href : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      };
      const { data, error } = await (supabase as any)
        .from("engine_room_issues")
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return data as IssueRow;
    },
    onSuccess: () => {
      toast({ title: "Issue logged", description: "The internal team can see it in the Log tab." });
      setTitle("");
      setBodyMd("");
      setRenderId("");
      setCategory("bug");
      setSeverity("medium");
      setTool("");
      queryClient.invalidateQueries({ queryKey: ["engine-room-issues"] });
      setTab("log");
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't log issue",
        description: e?.message ?? "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const { mutateAsync: updateStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "resolved") {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = currentUserEmail;
      }
      const { error } = await (supabase as any)
        .from("engine_room_issues")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["engine-room-issues"] });
    },
  });

  // ── Markdown export helpers ─────────────────────────────────────────────
  const issueToMarkdown = (i: IssueRow) => {
    const meta = [
      `**Severity:** ${i.severity}`,
      `**Category:** ${i.category}`,
      i.tool ? `**Tool:** ${i.tool}` : null,
      `**Reporter:** ${i.reporter_email ?? "unknown"}`,
      `**Logged:** ${new Date(i.created_at).toISOString()}`,
      i.page_url ? `**Page:** ${i.page_url}` : null,
      i.render_id ? `**Render ID:** ${i.render_id}` : null,
      `**Status:** ${i.status}`,
    ]
      .filter(Boolean)
      .join("  \n");
    return `## ${i.title}\n\n${meta}\n\n${i.body_markdown}\n`;
  };

  const copyBatchToClipboard = async () => {
    const active = issues.filter((i) => i.status === "open" || i.status === "in-progress");
    if (active.length === 0) {
      toast({ title: "Nothing to copy", description: "No open issues." });
      return;
    }
    const md = [
      `# Engine Room — Open Issues (${active.length})`,
      `_Exported ${new Date().toISOString()} from ${isWpwTenant ? "WPW" : "RestylePro"} Engine Room._`,
      "",
      ...active.map(issueToMarkdown),
    ].join("\n\n---\n\n");
    await navigator.clipboard.writeText(md);
    toast({
      title: "Copied to clipboard",
      description: `${active.length} issue${active.length === 1 ? "" : "s"} — paste into Claude.`,
    });
  };

  const copySingleToClipboard = async (i: IssueRow) => {
    await navigator.clipboard.writeText(issueToMarkdown(i));
    toast({ title: "Issue copied", description: "Paste into Claude to fix." });
  };

  const canSubmit = title.trim().length > 0 && bodyMd.trim().length > 0 && !creating;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-pink-600" />
            Report an Issue
          </SheetTitle>
          <SheetDescription>
            Internal issue log for {isWpwTenant ? "WePrintWraps" : "RestylePro"}. Written in markdown so open
            reports can be copied straight into Claude for systematic non-breaking fixes.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "new" | "log")} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new">New Issue</TabsTrigger>
            <TabsTrigger value="log" className="gap-2">
              Log
              {openCount > 0 && (
                <Badge variant="secondary" className="bg-pink-100 text-pink-700 border-pink-200">
                  {openCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── New issue form ──────────────────────────────────────────── */}
          <TabsContent value="new" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Title</label>
              <Input
                placeholder="Short, specific — e.g. ColorPro swatch dropdown empty for Tesla"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tool</label>
                <Select value={tool} onValueChange={setTool}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Category
                </label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Severity
                </label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Description (markdown)
              </label>
              <Textarea
                placeholder={MARKDOWN_PLACEHOLDER}
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                rows={14}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-slate-500">
                Plain markdown. Headings, lists, and code blocks all survive the copy-to-Claude step.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Render ID (optional)
              </label>
              <Input
                placeholder="If this is about a specific render"
                value={renderId}
                onChange={(e) => setRenderId(e.target.value)}
              />
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Auto-attached: <span className="font-mono">{currentUserEmail ?? "anonymous"}</span> ·{" "}
              <span className="font-mono">{isWpwTenant ? "weprintwraps" : brand}</span> · current page URL ·
              user agent
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createIssue()}
                disabled={!canSubmit}
                className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white border-0 hover:opacity-90"
              >
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bug className="w-4 h-4 mr-2" />}
                Log Issue
              </Button>
            </div>
          </TabsContent>

          {/* ── Log tab ─────────────────────────────────────────────────── */}
          <TabsContent value="log" className="space-y-3 mt-4">
            <div className="flex items-center justify-between gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active (open + in-progress)</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in-progress">In progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="wontfix">Won't fix</SelectItem>
                  <SelectItem value="duplicate">Duplicate</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={copyBatchToClipboard} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />
                Copy open as markdown
              </Button>
            </div>

            {issuesLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : filteredIssues.length === 0 ? (
              <div className="text-center py-12 text-sm text-slate-500">
                No issues match this filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredIssues.map((issue) => {
                  const expanded = expandedId === issue.id;
                  return (
                    <Card key={issue.id} className="p-3 border border-slate-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center flex-wrap gap-1.5 mb-1">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] font-semibold", SEVERITY_STYLES[issue.severity])}
                            >
                              {issue.severity}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", STATUS_STYLES[issue.status])}
                            >
                              {issue.status}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] bg-white">
                              {issue.category}
                            </Badge>
                            {issue.tool && (
                              <Badge variant="outline" className="text-[10px] bg-white">
                                {issue.tool}
                              </Badge>
                            )}
                          </div>
                          <button
                            onClick={() => setExpandedId(expanded ? null : issue.id)}
                            className="text-left text-sm font-semibold text-slate-900 hover:text-pink-700 flex items-center gap-1"
                          >
                            {issue.title}
                            {expanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {issue.reporter_email ?? "anonymous"} ·{" "}
                            {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => copySingleToClipboard(issue)}
                          >
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                          {issue.status !== "resolved" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-emerald-700"
                              onClick={() => updateStatus({ id: issue.id, status: "resolved" })}
                            >
                              <Check className="w-3 h-3 mr-1" /> Resolve
                            </Button>
                          )}
                        </div>
                      </div>

                      {expanded && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          <pre className="whitespace-pre-wrap text-xs font-mono text-slate-700 bg-slate-50 rounded p-2 max-h-80 overflow-auto">
                            {issue.body_markdown}
                          </pre>
                          {issue.page_url && (
                            <div className="text-[11px] text-slate-500 break-all">
                              <span className="font-semibold">Page:</span> {issue.page_url}
                            </div>
                          )}
                          {issue.render_id && (
                            <div className="text-[11px] text-slate-500 break-all">
                              <span className="font-semibold">Render ID:</span> {issue.render_id}
                            </div>
                          )}
                          {issue.status !== "resolved" && (
                            <div className="flex gap-1.5 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => updateStatus({ id: issue.id, status: "in-progress" })}
                              >
                                Mark in progress
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => updateStatus({ id: issue.id, status: "wontfix" })}
                              >
                                Won't fix
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => updateStatus({ id: issue.id, status: "duplicate" })}
                              >
                                Duplicate
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* ── Flagged star ratings pulled from render_quality_ratings ─ */}
            {flaggedRatings.length > 0 && (
              <div className="pt-4 mt-2 border-t border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Flagged star-rating feedback
                  </h3>
                  <Badge variant="outline" className="text-[10px] bg-white">
                    {flaggedRatings.length}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Low-star and flagged submissions from the post-render rating prompt. Promote any that need
                  a proper fix into a new issue above.
                </p>
                <div className="space-y-1.5">
                  {flaggedRatings.map((r) => (
                    <Card key={r.id} className="p-2.5 border border-amber-100 bg-amber-50/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-white border-amber-200 text-amber-800"
                            >
                              {"★".repeat(Math.max(0, Math.min(5, r.rating)))}{" "}
                              {r.rating}/5
                            </Badge>
                            {r.render_type && (
                              <Badge variant="outline" className="text-[10px] bg-white">
                                {r.render_type}
                              </Badge>
                            )}
                            {r.is_flagged && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-red-50 border-red-200 text-red-700"
                              >
                                <Flag className="w-2.5 h-2.5 mr-0.5" /> flagged
                              </Badge>
                            )}
                          </div>
                          {r.flag_reason && (
                            <div className="text-xs text-red-700 font-medium">{r.flag_reason}</div>
                          )}
                          {r.notes && (
                            <div className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap">
                              {r.notes}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {r.user_email ?? "anonymous"} ·{" "}
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                            {r.render_id ? ` · render ${r.render_id}` : ""}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px] shrink-0"
                          onClick={() => {
                            setTab("new");
                            setTitle(
                              r.flag_reason
                                ? `Flagged render: ${r.flag_reason}`
                                : `${r.rating}/5 render — ${r.render_type ?? "unknown"}`,
                            );
                            setCategory("render-quality");
                            setSeverity(r.rating <= 2 || r.is_flagged ? "high" : "medium");
                            setTool(r.render_type?.toLowerCase() ?? "");
                            setRenderId(r.render_id ?? "");
                            setBodyMd(
                              [
                                `## From star rating (${r.rating}/5)`,
                                "",
                                r.flag_reason ? `**Flag reason:** ${r.flag_reason}` : null,
                                r.notes ? `**Reporter notes:**\n\n${r.notes}` : null,
                                "",
                                "## What should happen instead",
                                "- ",
                                "",
                                "## Additional context",
                                "- ",
                              ]
                                .filter(Boolean)
                                .join("\n"),
                            );
                          }}
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Promote
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
