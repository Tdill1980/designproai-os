/**
 * AdminContentCalendar — Full-page marketing content calendar
 *
 * White UI with color-coded cards matching the marketing hub 6-point system.
 * Wired to: slack_agent_tasks, agent_social_posts, agent_blog_posts,
 * agent_email_campaigns, agent_content_calendar.
 *
 * Features:
 *  - Weekly grid (Mon–Sun) with card-based entries
 *  - Completed tasks show content thumbnail
 *  - Team member avatars + color-coded left borders
 *  - Task type badges (Blog, Social, Email, Ad, Design, SEO)
 *  - Status indicators (To Do, In Progress, Review, Done)
 *  - Create new task inline → writes to slack_agent_tasks
 *  - Quick links to Marketing Hub, MightyMail, Content Studio
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isOwner } from "@/lib/admin-allowlist";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  Instagram,
  Mail,
  Megaphone,
  Calendar,
  Sparkles,
  Circle,
  Wrench,
  Paintbrush,
  Code2,
  Bot,
  Crown,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Plus,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Zap,
  Loader2,
} from "lucide-react";
import { format, parseISO, isToday, isPast, startOfWeek, addDays, addWeeks } from "date-fns";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

// ─── Shared Constants (match AdminMarketingHub exactly) ────────────────────

const db = supabase;

type Brand = "restylepro" | "weprintwraps" | "wraptv" | "inkandedge";

const TEAM = {
  trish: { name: "Trish Dill", title: "CEO, Marketing & AI Systems", color: "from-pink-400 to-pink-600", bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-300", dot: "bg-pink-500", cardBorder: "border-l-pink-500", icon: Crown, emoji: "💗" },
  jess: { name: "Jess Bonafacio", title: "VinylVixenJess — Head of Restyle & R&D", color: "from-purple-500 to-purple-600", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-300", dot: "bg-purple-500", cardBorder: "border-l-purple-500", icon: Sparkles, emoji: "🟣" },
  carley: { name: "Carley Chavez", title: "Gnarley Graphics — Director of Graphic Design", color: "from-blue-500 to-blue-600", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300", dot: "bg-blue-500", cardBorder: "border-l-blue-500", icon: Paintbrush, emoji: "🟦" },
  amanda: { name: "Amanda", title: "Partnerships & Tier 2+ Sales", color: "from-emerald-500 to-green-600", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300", dot: "bg-emerald-500", cardBorder: "border-l-emerald-500", icon: Briefcase, emoji: "🟩" },
  xavier: { name: "Xavier", title: "High-End Sales & Exotics", color: "from-slate-900 to-slate-700", bg: "bg-slate-100", text: "text-slate-900", border: "border-slate-400", dot: "bg-slate-900", cardBorder: "border-l-slate-900", icon: Crown, emoji: "⚫" },
  houdini: { name: "Gary Guiterrez", title: "Houdini — School of Wrap", color: "from-yellow-400 to-amber-500", bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-300", dot: "bg-yellow-500", cardBorder: "border-l-yellow-500", icon: Sparkles, emoji: "🟨" },
  jackson: { name: "Jackson Obregon", title: "Director of Client Operations", color: "from-red-500 to-red-600", bg: "bg-red-50", text: "text-red-700", border: "border-red-300", dot: "bg-red-500", cardBorder: "border-l-red-500", icon: Wrench, emoji: "🟥" },
  rj: { name: "RJ The Wrapper", title: "Sponsored Wrap Artist", color: "from-violet-700 to-purple-800", bg: "bg-violet-50", text: "text-violet-800", border: "border-violet-300", dot: "bg-violet-700", cardBorder: "border-l-violet-700", icon: Wrench, emoji: "🟪" },
  brice: { name: "Brice", title: "PrintPro / WPW Production", color: "from-orange-500 to-amber-600", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-300", dot: "bg-orange-500", cardBorder: "border-l-orange-500", icon: Wrench, emoji: "🟧" },
  troy: { name: "Troy", title: "WPW Team", color: "from-lime-500 to-lime-600", bg: "bg-lime-50", text: "text-lime-700", border: "border-lime-300", dot: "bg-lime-500", cardBorder: "border-l-lime-500", icon: Wrench, emoji: "🟢" },
  lance: { name: "Lance", title: "WPW Team", color: "from-teal-500 to-teal-600", bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-300", dot: "bg-teal-500", cardBorder: "border-l-teal-500", icon: Wrench, emoji: "🔷" },
  agent: { name: "AI Agent", title: "RP Marketing Agent", color: "from-cyan-500 to-blue-600", bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-300", dot: "bg-cyan-500", cardBorder: "border-l-cyan-500", icon: Bot, emoji: "🤖" },
} as const;

type CalTeamKey = keyof typeof TEAM;

/**
 * WPW-facing team members — used to filter the team directory and
 * assignee dropdowns when brand === "weprintwraps".
 */
// Jess is RP-only — not included in the WPW tenant directory
const WPW_TEAM_KEYS: CalTeamKey[] = ["trish", "carley", "jackson", "brice", "troy", "lance"];

function getVisibleCalTeamEntries(brand: Brand): [CalTeamKey, typeof TEAM[CalTeamKey]][] {
  const entries = Object.entries(TEAM) as [CalTeamKey, typeof TEAM[CalTeamKey]][];
  if (brand === "weprintwraps") {
    return entries.filter(([k]) => WPW_TEAM_KEYS.includes(k));
  }
  return entries.filter(([k]) => k !== "agent");
}

// Content type colors — same as marketing hub 6-point system
const CONTENT_TYPE_CONFIG = {
  blog: { label: "Blog", color: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-500", dot: "bg-emerald-500", icon: FileText },
  social: { label: "Social", color: "bg-pink-100 text-pink-700", border: "border-l-pink-500", dot: "bg-pink-500", icon: Instagram },
  email: { label: "Email", color: "bg-orange-100 text-orange-700", border: "border-l-orange-500", dot: "bg-orange-500", icon: Mail },
  ad: { label: "Ad", color: "bg-red-100 text-red-700", border: "border-l-red-500", dot: "bg-red-500", icon: Megaphone },
  design: { label: "Design", color: "bg-purple-100 text-purple-700", border: "border-l-purple-500", dot: "bg-purple-500", icon: Paintbrush },
  seo: { label: "SEO", color: "bg-teal-100 text-teal-700", border: "border-l-teal-500", dot: "bg-teal-500", icon: Sparkles },
  calendar: { label: "Task", color: "bg-blue-100 text-blue-700", border: "border-l-blue-500", dot: "bg-blue-500", icon: Calendar },
  dev: { label: "Dev", color: "bg-indigo-100 text-indigo-700", border: "border-l-indigo-500", dot: "bg-indigo-500", icon: Code2 },
} as const;

const STATUS_ICONS = {
  pending: { icon: Circle, color: "text-slate-400", label: "To Do" },
  in_progress: { icon: Clock, color: "text-blue-500", label: "In Progress" },
  review: { icon: AlertCircle, color: "text-amber-500", label: "Review" },
  completed: { icon: CheckCircle2, color: "text-emerald-500", label: "Done" },
  draft: { icon: Circle, color: "text-slate-400", label: "Draft" },
  published: { icon: CheckCircle2, color: "text-emerald-500", label: "Published" },
  scheduled: { icon: Clock, color: "text-blue-500", label: "Scheduled" },
  sent: { icon: CheckCircle2, color: "text-emerald-500", label: "Sent" },
} as const;

// ─── Unified calendar item type ────────────────────────────────────────────

interface CalendarItem {
  id: string;
  type: keyof typeof CONTENT_TYPE_CONFIG;
  title: string;
  fullText: string;
  status: string;
  date: string;
  assignedTo?: string;
  platform?: string;
  thumbnailUrl?: string | null;
  allMediaUrls?: string[];
  sourceTable: string;
  hashtags?: string[];
}

// ─── Data hook — pulls from all content pipeline tables + tasks ────────────

function useCalendarData(brand: Brand) {
  return useQuery({
    queryKey: ["content-calendar-full", brand],
    queryFn: async () => {
      const [blogs, social, emails, calendar, tasks] = await Promise.all([
        db.from("agent_blog_posts").select("id, title, excerpt, body, status, publish_date, created_at, platform, featured_image_url").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_social_posts").select("id, caption, platform, post_type, status, scheduled_date, created_at, media_urls, assigned_to, hashtags").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_email_campaigns").select("id, campaign_name, campaign_type, status, scheduled_date, created_at").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_content_calendar").select("*").eq("brand", brand).order("date", { ascending: true }).limit(300),
        db.from("slack_agent_tasks").select("id, title, task_type, status, priority, assigned_to, created_at, updated_at, due_date, metadata").eq("brand", brand).order("created_at", { ascending: false }).limit(300),
      ]);

      return {
        blogs: blogs.data || [],
        social: social.data || [],
        emails: emails.data || [],
        calendar: calendar.data || [],
        tasks: tasks.data || [],
      };
    },
    refetchInterval: 15000,
  });
}

// ─── Map task_type to content type ─────────────────────────────────────────

function mapTaskType(taskType: string): keyof typeof CONTENT_TYPE_CONFIG {
  const map: Record<string, keyof typeof CONTENT_TYPE_CONFIG> = {
    blog_post: "blog",
    social_post: "social",
    email_campaign: "email",
    ad_campaign: "ad",
    design_request: "design",
    seo_task: "seo",
    dev_issue: "dev",
    dev_feature: "dev",
    dev_refactor: "dev",
    deployment: "dev",
  };
  return map[taskType] || "calendar";
}

// ─── Component ─────────────────────────────────────────────────────────────

type TenantMode = "wpw" | undefined;

export default function AdminContentCalendar({ tenantMode }: { tenantMode?: TenantMode } = {}) {
  const isWpwTenant = tenantMode === "wpw";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // In WPW-tenant mode, brand is locked so the internal WPW team can never
  // accidentally toggle into RestylePro data.
  const [brand, setBrand] = useState<Brand>(isWpwTenant ? "weprintwraps" : "restylepro");
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUserEmail(session?.user?.email ?? null);
    })();
  }, []);
  const showSwitcher = isOwner(currentUserEmail);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDate, setAddDate] = useState<string>("");
  const [filter, setFilter] = useState<"all" | keyof typeof CONTENT_TYPE_CONFIG>("all");
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);

  // ── Bulk Ad Sets Generator ──
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, current: "" });
  const [bulkTotal, setBulkTotal] = useState(0);

  const BULK_TOOLS = ["DesignProAI", "ColorPro", "GraphicsPro", "FadeWraps", "PatternPro", "ProductionFlow", "ApprovePro", "RevisionStudio", "QuickQuote"];
  const BULK_ANGLES = ["witty", "premium", "fomo", "cutting_edge", "roi", "us_vs_them", "founders", "features", "authority", "usps"];
  const ANGLE_LABELS: Record<string, string> = {
    witty: "Witty & Clever", premium: "Premium", fomo: "FOMO", cutting_edge: "Cutting Edge",
    roi: "ROI / Leave $ on Table", us_vs_them: "Us vs Them", founders: "Founders Story",
    features: "Features Callout", authority: "Authority", usps: "USP Focused",
  };

  const runBulkAdSets = async () => {
    setBulkRunning(true);
    const total = BULK_TOOLS.length * BULK_ANGLES.length;
    setBulkProgress({ done: 0, total, current: "Starting..." });
    setBulkTotal(0);
    let generated = 0;

    for (const tool of BULK_TOOLS) {
      for (const angle of BULK_ANGLES) {
        setBulkProgress((p) => ({ ...p, current: `${tool} / ${ANGLE_LABELS[angle] || angle}` }));
        try {
          const { data: result, error } = await supabase.functions.invoke("generate-ad-copy-batch", {
            body: { tool, angle, count: 5, brand: "RestyleProAI", persist: true },
          });
          if (!error && result?.count) generated += result.count;
        } catch (e) {
          console.error(`Bulk fail: ${tool}/${angle}`, e);
        }
        setBulkProgress((p) => ({ done: p.done + 1, total, current: p.current }));
      }
    }

    setBulkTotal(generated);
    setBulkRunning(false);
    queryClient.invalidateQueries({ queryKey: ["calendar-data"] });
    queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
  };

  const { data, isLoading } = useCalendarData(brand);

  // ── Build unified items list ───────────────────────────────────────────

  const allItems: CalendarItem[] = useMemo(() => {
    if (!data) return [];
    const items: CalendarItem[] = [];

    data.blogs.forEach((b: any) => items.push({
      id: b.id, type: "blog", title: b.title || "Untitled Blog", fullText: b.excerpt || b.body?.slice(0, 300) || b.title || "",
      status: b.status, date: b.publish_date || b.created_at,
      platform: b.platform, thumbnailUrl: b.featured_image_url, sourceTable: "agent_blog_posts",
    }));

    data.social.forEach((s: any) => {
      const mediaUrls = Array.isArray(s.media_urls) ? s.media_urls : [];
      const thumb = mediaUrls.length > 0 ? mediaUrls[0] : null;
      items.push({
        id: s.id, type: "social", title: s.caption?.slice(0, 80) || "Untitled Post", fullText: s.caption || "",
        status: s.status, date: s.scheduled_date || s.created_at,
        platform: s.platform, thumbnailUrl: thumb, allMediaUrls: mediaUrls, sourceTable: "agent_social_posts", hashtags: s.hashtags || [],
        assignedTo: s.assigned_to || null,
      });
    });

    data.emails.forEach((e: any) => items.push({
      id: e.id, type: "email", title: e.campaign_name || "Untitled Email", fullText: e.campaign_name || "",
      status: e.status, date: e.scheduled_date || e.created_at,
      sourceTable: "agent_email_campaigns",
    }));

    data.calendar.forEach((c: any) => items.push({
      id: c.id, type: (c.content_type as keyof typeof CONTENT_TYPE_CONFIG) || "calendar",
      title: c.title || "Untitled", fullText: c.title || "", status: c.status, date: c.date,
      assignedTo: c.assigned_to, thumbnailUrl: c.media_url || null, sourceTable: "agent_content_calendar",
    }));

    // Tasks from slack_agent_tasks — use calendar_date or due_date as scheduled post date
    data.tasks.forEach((t: any) => {
      const meta = t.metadata as any;
      const taskDate = meta?.calendar_date || t.due_date || t.updated_at || t.created_at;
      const thumb = meta?.thumbnail_url || meta?.media_url || null;
      items.push({
        id: t.id, type: mapTaskType(t.task_type),
        title: t.title || "Untitled Task", fullText: t.description || t.title || "", status: t.status, date: taskDate,
        assignedTo: t.assigned_to, thumbnailUrl: thumb, sourceTable: "slack_agent_tasks",
        ...(meta?.finished_urls ? { finishedUrls: meta.finished_urls } : {}),
      } as any);
    });

    return items;
  }, [data]);

  // ── Week grid computation ──────────────────────────────────────────────

  const today = new Date();
  const baseMonday = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(baseMonday, i));
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const weekLabel = `${format(weekDays[0], "MMM d")} — ${format(weekDays[6], "MMM d, yyyy")}`;

  // Group items by date
  const itemsByDate = useMemo(() => {
    const grouped: Record<string, CalendarItem[]> = {};
    allItems.forEach((item) => {
      if (!item.date) return;
      const key = item.date.slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      // Apply type filter
      if (filter !== "all" && item.type !== filter) return;
      // Apply member filter
      if (memberFilter && item.assignedTo !== memberFilter) return;
      grouped[key].push(item);
    });
    return grouped;
  }, [allItems, filter, memberFilter]);

  // Counts per type (respects active member filter so counts reflect what's visible)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    allItems.forEach((item) => {
      if (memberFilter && item.assignedTo !== memberFilter) return;
      c[item.type] = (c[item.type] || 0) + 1;
    });
    return c;
  }, [allItems, memberFilter]);

  // Counts per member (for avatar badges)
  const memberCounts = useMemo(() => {
    const c: Record<string, number> = {};
    allItems.forEach((item) => {
      if (item.assignedTo) c[item.assignedTo] = (c[item.assignedTo] || 0) + 1;
    });
    return c;
  }, [allItems]);

  // ── Add task mutation ──────────────────────────────────────────────────

  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("social_post");
  const [newAssignee, setNewAssignee] = useState<string>("trish");
  const [newPriority, setNewPriority] = useState<string>("medium");
  const [newNotes, setNewNotes] = useState("");

  const addTaskMutation = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("slack_agent_tasks").insert({
        brand,
        title: newTitle.trim(),
        task_type: newType,
        status: "pending",
        priority: newPriority,
        assigned_to: newAssignee,
        description: newNotes || null,
        metadata: { calendar_date: addDate },
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-calendar-full"] });
      toast({ title: "Task added", description: `"${newTitle}" scheduled for ${addDate}` });
      setShowAddDialog(false);
      setNewTitle("");
      setNewNotes("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to add task", description: err?.message, variant: "destructive" });
    },
  });

  // ── Status update ──────────────────────────────────────────────────────

  const updateStatus = useCallback(async (item: CalendarItem, newStatus: string) => {
    try {
      const statusField = item.sourceTable === "agent_blog_posts" && newStatus === "completed" ? "published" : newStatus;
      await (db as any).from(item.sourceTable).update({ status: statusField }).eq("id", item.id);
      queryClient.invalidateQueries({ queryKey: ["content-calendar-full"] });
      toast({ title: "Updated", description: `${item.title} → ${newStatus}` });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  }, [queryClient, toast]);

  // ── Render ─────────────────────────────────────────────────────────────

  const isCompleted = (status: string) => ["completed", "published", "sent", "done"].includes(status);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-fuchsia-500 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {isWpwTenant ? "WPW Content Calendar" : "Content Calendar"}
                </h1>
                <p className="text-xs text-slate-500">
                  {isWpwTenant
                    ? "WePrintWraps — internal pipeline"
                    : "Marketing pipeline — tasks, content, campaigns"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Owner-only cross-tenant switcher */}
              {showSwitcher && (
                isWpwTenant ? (
                  <Link to="/admin/content-calendar">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white text-xs font-semibold border-0 hover:opacity-90"
                    >
                      ← RP Calendar
                    </Button>
                  </Link>
                ) : (
                  <Link to="/wpw/content-calendar">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-semibold border-0 hover:opacity-90"
                    >
                      WPW Calendar →
                    </Button>
                  </Link>
                )
              )}

              {/* Brand toggle — hidden in WPW-tenant mode */}
              {!isWpwTenant && (
                <Select value={brand} onValueChange={(v) => setBrand(v as Brand)}>
                  <SelectTrigger className="w-[180px] bg-white border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restylepro">RestylePro</SelectItem>
                    <SelectItem value="weprintwraps">WePrintWraps</SelectItem>
                    <SelectItem value="wraptv">Wrap TV World</SelectItem>
                    <SelectItem value="inkandedge">Ink & Edge</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {isWpwTenant && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-600" />
                  <span className="text-xs font-semibold text-purple-700">WePrintWraps</span>
                </div>
              )}

              {/* Quick links */}
              <Link to={isWpwTenant ? "/wpw/engine-room" : "/admin/marketing-hub"}>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <ExternalLink className="w-3 h-3" /> Hub
                </Button>
              </Link>
              <Link to="/admin/mightymail">
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <Mail className="w-3 h-3" /> MightyMail
                </Button>
              </Link>
              <Link to="/admin/content-studio">
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <Paintbrush className="w-3 h-3" /> Studio
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Ad Sets Generator */}
      <div className="max-w-[1600px] mx-auto px-6 pt-4">
        <div className="p-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-fuchsia-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-purple-900">Launch Ad Sets</h3>
              <p className="text-xs text-purple-600">
                {BULK_TOOLS.length} tools × {BULK_ANGLES.length} angles × 5 each = {BULK_TOOLS.length * BULK_ANGLES.length * 5} pieces → agent_social_posts
              </p>
            </div>
            {!bulkRunning && !bulkTotal && (
              <Button
                size="sm"
                onClick={runBulkAdSets}
                className="bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-semibold"
              >
                <Zap className="w-3.5 h-3.5 mr-1" />
                Generate All Ad Sets ({BULK_TOOLS.length * BULK_ANGLES.length * 5} pieces)
              </Button>
            )}
            {bulkRunning && (
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                <div className="text-xs">
                  <span className="font-semibold text-purple-900">{bulkProgress.done}/{bulkProgress.total}</span>
                  <span className="text-purple-600 ml-2">{bulkProgress.current}</span>
                </div>
                <div className="w-40 h-2 bg-purple-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all"
                    style={{ width: bulkProgress.total ? `${(bulkProgress.done / bulkProgress.total) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            )}
            {!bulkRunning && bulkTotal > 0 && (
              <div className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-lg">
                ✓ Generated {bulkTotal} ad copy pieces → agent_social_posts
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-5">
        {/* Summary bar + filters */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              size="sm"
              onClick={() => {
                setAddDate(format(new Date(), "yyyy-MM-dd"));
                setShowAddDialog(true);
              }}
              className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white text-xs gap-1.5 border-0"
            >
              <Plus className="w-3.5 h-3.5" /> New Card
            </Button>
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                filter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              )}
            >
              All ({allItems.length})
            </button>
            {(Object.entries(CONTENT_TYPE_CONFIG) as [keyof typeof CONTENT_TYPE_CONFIG, typeof CONTENT_TYPE_CONFIG[keyof typeof CONTENT_TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = counts[key] || 0;
              if (count === 0) return null;
              const Icon = cfg.icon;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5",
                    filter === key ? `${cfg.color} border-transparent` : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Team avatars — click to filter by member */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {memberFilter && (
              <button
                onClick={() => setMemberFilter(null)}
                className="text-[10px] text-blue-600 hover:underline font-medium mr-1"
              >
                Show all
              </button>
            )}
            {getVisibleCalTeamEntries(brand).map(([key, member]) => {
              const count = memberCounts[key] || 0;
              const active = memberFilter === key;
              return (
                <button
                  key={key}
                  title={`${member.name} (${count})${active ? " — click again to clear" : ""}`}
                  onClick={() => setMemberFilter(active ? null : key)}
                  className={cn(
                    "relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br transition-all",
                    member.color,
                    active ? "ring-2 ring-offset-2 ring-slate-900 scale-110 shadow-md" : "opacity-70 hover:opacity-100 hover:scale-105",
                    memberFilter && !active ? "opacity-40" : "",
                  )}
                >
                  {member.name.charAt(0)}
                  {count > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-200 text-[8px] font-bold text-slate-700 flex items-center justify-center">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active member filter indicator */}
        {memberFilter && TEAM[memberFilter as keyof typeof TEAM] && (() => {
          const m = TEAM[memberFilter as keyof typeof TEAM];
          return (
            <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 mb-4", m.bg, m.border)}>
              <div className={cn("w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center text-[10px] font-bold text-white", m.color)}>
                {m.name.charAt(0)}
              </div>
              <span className={cn("text-xs font-semibold", m.text)}>
                Showing only {m.name}'s calendar items ({memberCounts[memberFilter] || 0})
              </span>
              <button onClick={() => setMemberFilter(null)} className="ml-auto text-xs text-slate-500 hover:text-slate-900">✕ Clear filter</button>
            </div>
          );
        })()}

        {/* Week navigation */}
        <div className="flex items-center justify-between mb-4 bg-white rounded-xl border border-slate-200 px-5 py-3 shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev Week
          </Button>
          <div className="text-center">
            <div className="font-semibold text-slate-900 text-sm">{weekLabel}</div>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-blue-600 hover:underline mt-0.5"
              >
                Back to this week
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="text-slate-600 hover:text-slate-900"
          >
            Next Week <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-20 text-slate-400">Loading calendar...</div>
        ) : (
          /* Weekly grid — 7 columns */
          <div className="grid grid-cols-7 gap-3">
            {weekDays.map((day, i) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayItems = itemsByDate[dateKey] || [];
              const isTodayCol = isToday(day);
              const isPastCol = isPast(day) && !isTodayCol;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "rounded-xl border min-h-[280px] flex flex-col transition-shadow",
                    isTodayCol
                      ? "border-blue-400 bg-blue-50/30 shadow-md shadow-blue-100 ring-1 ring-blue-200"
                      : isPastCol
                      ? "border-slate-200 bg-slate-50/60"
                      : "border-slate-200 bg-white hover:shadow-sm",
                  )}
                >
                  {/* Day header */}
                  <div className={cn(
                    "px-3 py-2.5 border-b rounded-t-xl",
                    isTodayCol ? "bg-blue-500 border-blue-500" : "bg-slate-50 border-slate-100"
                  )}>
                    <div className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      isTodayCol ? "text-blue-100" : "text-slate-400"
                    )}>
                      {dayNames[i]}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        "text-lg font-bold",
                        isTodayCol ? "text-white" : "text-slate-800"
                      )}>
                        {format(day, "d")}
                      </span>
                      {isTodayCol && (
                        <Badge className="bg-white/20 text-white text-[9px] border-0 font-semibold">TODAY</Badge>
                      )}
                      {dayItems.length > 0 && !isTodayCol && (
                        <span className="text-[10px] text-slate-400 font-medium">{dayItems.length}</span>
                      )}
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[400px]">
                    {dayItems.map((item) => {
                      const cfg = CONTENT_TYPE_CONFIG[item.type] || CONTENT_TYPE_CONFIG.calendar;
                      const Icon = cfg.icon;
                      const assignee = item.assignedTo ? TEAM[item.assignedTo as keyof typeof TEAM] : null;
                      const completed = isCompleted(item.status);
                      const statusCfg = STATUS_ICONS[item.status as keyof typeof STATUS_ICONS] || STATUS_ICONS.pending;
                      const StatusIcon = statusCfg.icon;

                      // Completed + has thumbnail → render as image-first card
                      if (completed && item.thumbnailUrl) {
                        return (
                          <div
                            key={`${item.sourceTable}-${item.id}`}
                            onClick={() => setSelectedItem(item)}
                            className={cn("rounded-lg overflow-hidden border border-emerald-200 shadow-sm hover:shadow-md transition-all cursor-pointer group")}
                          >
                            <div className="relative">
                              <img
                                src={item.thumbnailUrl}
                                alt={item.title}
                                className="w-full h-24 object-cover"
                                loading="lazy"
                              />
                              <div className="absolute top-1.5 left-1.5">
                                <Badge variant="outline" className={cn("text-[8px] px-1.5 py-0 h-3.5 font-semibold border-0 shadow-sm", cfg.color)}>
                                  <Icon className="w-2 h-2 mr-0.5" />
                                  {cfg.label}
                                </Badge>
                              </div>
                              <div className="absolute top-1.5 right-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 drop-shadow-md" />
                              </div>
                            </div>
                            <div className="p-1.5 bg-emerald-50/50">
                              <p className="text-[10px] font-medium text-slate-600 line-clamp-1">{item.title}</p>
                              {assignee && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <div className={cn("w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold text-white bg-gradient-to-br", assignee.color)}>
                                    {assignee.name.charAt(0)}
                                  </div>
                                  <span className="text-[8px] text-slate-400">{assignee.name.split(" ")[0]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      // Standard card — text-based with "Due by" label
                      const dueDayName = format(day, "EEEE");

                      return (
                        <div
                          key={`${item.sourceTable}-${item.id}`}
                          onClick={() => setSelectedItem(item)}
                          className={cn(
                            "rounded-lg border-l-[3px] bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group",
                            cfg.border,
                            completed && "opacity-90"
                          )}
                        >
                          <div className="p-2">
                            {/* Type badge + status */}
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 font-semibold border-0", cfg.color)}>
                                <Icon className="w-2.5 h-2.5 mr-0.5" />
                                {cfg.label}
                              </Badge>
                              <StatusIcon className={cn("w-3.5 h-3.5", statusCfg.color)} />
                            </div>

                            {/* Title */}
                            <p className={cn(
                              "text-[11px] font-medium leading-tight line-clamp-2 mb-1",
                              completed ? "text-slate-500 line-through" : "text-slate-800"
                            )}>
                              {item.title}
                            </p>

                            {/* Due by label — shown for non-completed items */}
                            {!completed && (
                              <div className="text-[9px] text-slate-500 font-medium mb-1">
                                Due by {dueDayName}
                              </div>
                            )}

                            {/* Platform tag */}
                            {item.platform && (
                              <span className="text-[9px] text-slate-400 capitalize">{item.platform}</span>
                            )}

                            {/* Assignee */}
                            {assignee && (
                              <div className="flex items-center gap-1 mt-1.5">
                                <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br", assignee.color)}>
                                  {assignee.name.charAt(0)}
                                </div>
                                <span className="text-[9px] text-slate-500">{assignee.name.split(" ")[0]}</span>
                              </div>
                            )}

                            {/* Quick status toggle — visible on hover */}
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 flex gap-1">
                              {!completed && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateStatus(item, "completed"); }}
                                  className="text-[9px] text-emerald-600 hover:text-emerald-800 font-medium"
                                >
                                  Mark done
                                </button>
                              )}
                              {item.status === "pending" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateStatus(item, "in_progress"); }}
                                  className="text-[9px] text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  Start
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add button — only for future/today */}
                    {!isPastCol && (
                      <button
                        onClick={() => { setAddDate(dateKey); setShowAddDialog(true); }}
                        className="w-full rounded-lg border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors py-3 flex items-center justify-center gap-1 text-slate-400 hover:text-blue-500"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium">Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Card Detail Panel — 9:16 slide-out ──────────────────────── */}
      {selectedItem && (() => {
        const item = selectedItem;
        const cfg = CONTENT_TYPE_CONFIG[item.type] || CONTENT_TYPE_CONFIG.calendar;
        const Icon = cfg.icon;
        const assignee = item.assignedTo ? TEAM[item.assignedTo as keyof typeof TEAM] : null;
        const isDone = ["completed", "published", "sent", "done"].includes(item.status);
        const isVideo = /\.(mp4|mov|webm|avi)$/i.test(item.thumbnailUrl || "");

        return (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
            <div className="bg-white w-full sm:w-[380px] h-full shadow-2xl overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Color bar */}
              {assignee && <div className={cn("h-1.5 bg-gradient-to-r shrink-0", assignee.color)} />}

              {/* Close + header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-[10px] px-1.5 py-0 border-0", cfg.color)}>
                    <Icon className="w-3 h-3 mr-0.5" />{cfg.label}
                  </Badge>
                  {item.platform && <Badge variant="outline" className="text-[10px] capitalize">{item.platform}</Badge>}
                  <Badge variant={isDone ? "default" : "secondary"} className="text-[10px]">{isDone ? "Done" : item.status}</Badge>
                </div>
                <button onClick={() => setSelectedItem(null)} className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>

              {/* Assignee + date */}
              {assignee && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-50 shrink-0">
                  <div className={cn("w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold", assignee.color)}>
                    {assignee.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900">{assignee.name}</div>
                    <div className="text-[10px] text-slate-500">{assignee.emoji} {item.date?.slice(0, 10)}</div>
                  </div>
                </div>
              )}

              {/* Media gallery */}
              {(item.allMediaUrls?.length || item.thumbnailUrl) && (
                <div className="px-4 pt-3 shrink-0">
                  <div className={cn("grid gap-1.5 rounded-lg overflow-hidden", (item.allMediaUrls?.length || 0) > 1 ? "grid-cols-2" : "grid-cols-1")}>
                    {(item.allMediaUrls && item.allMediaUrls.length > 0 ? item.allMediaUrls : item.thumbnailUrl ? [item.thumbnailUrl] : []).map((url, idx) => {
                      const isVid = /\.(mp4|mov|webm|avi)$/i.test(url);
                      return isVid ? (
                        <video key={idx} src={url} controls className="w-full rounded-lg max-h-36 object-contain bg-black" />
                      ) : (
                        <img key={idx} src={url} alt="" className="w-full rounded-lg max-h-36 object-cover cursor-pointer hover:opacity-90" />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Copy text */}
              <div className="px-4 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Copy</span>
                  <button onClick={() => { navigator.clipboard.writeText(item.fullText || item.title); toast({ title: "Copied" }); }} className="text-[10px] text-blue-600 hover:underline font-medium">Copy Text</button>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">{item.fullText || item.title}</div>
              </div>

              {/* Source blog */}
              {item.type !== "blog" && (
                <div className="px-4 pt-2">
                  <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
                    <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-emerald-600 uppercase">Source Blog</div>
                      <div className="text-[11px] text-emerald-800 font-medium truncate">The RestyleProAI™ Manifesto</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Hashtags */}
              {item.hashtags && item.hashtags.length > 0 && (
                <div className="px-4 pt-2">
                  <div className="flex flex-wrap gap-1">
                    {item.hashtags.map((tag: string) => (
                      <span key={tag} className="text-[9px] text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">#{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes / Instructions */}
              <div className="px-4 pt-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Notes & Instructions</span>
                <Textarea
                  placeholder="What needs to be done, template to use, notes for the creator..."
                  className="mt-1 text-xs min-h-[60px] resize-none bg-white text-slate-900 border-slate-200"
                  defaultValue=""
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (item.sourceTable === "slack_agent_tasks") {
                      await (db as any).from("slack_agent_tasks").update({ description: val }).eq("id", item.id);
                    } else if (item.sourceTable === "agent_content_calendar") {
                      await (db as any).from("agent_content_calendar").update({ notes: val }).eq("id", item.id);
                    }
                  }}
                />
              </div>

              {/* Template / Reference URL */}
              <div className="px-4 pt-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Template / Reference Link</span>
                <Input
                  placeholder="Canva template URL, photo link, or video reference..."
                  className="mt-1 text-xs h-8 bg-white text-slate-900 border-slate-200"
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (!val) return;
                    if (item.sourceTable === "slack_agent_tasks") {
                      const meta = (item as any).metadata || {};
                      await (db as any).from("slack_agent_tasks").update({ metadata: { ...meta, template_url: val } }).eq("id", item.id);
                    }
                  }}
                />
              </div>

              {/* ── REFERENCE ASSETS (what Trish provides to creator) ── */}
              <div className="px-4 pt-3">
                <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">📂 Reference Assets</span>
                    <span className="text-[9px] text-blue-500">{item.allMediaUrls?.length || 0}</span>
                  </div>
                  {(item.allMediaUrls && item.allMediaUrls.length > 0) && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {item.allMediaUrls.map((url, idx) => (
                        <a key={idx} href={url} download target="_blank" rel="noopener noreferrer" className="inline-block">
                          <Button variant="outline" size="sm" className="text-[9px] h-6 px-1.5 bg-white">⬇ #{idx + 1}</Button>
                        </a>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-1 rounded border border-dashed border-blue-300 bg-white hover:bg-blue-50 py-1.5 cursor-pointer text-blue-600">
                    <ImageIcon className="w-3 h-3" />
                    <span className="text-[9px] font-medium">Upload references / templates / photos</span>
                    <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      const existing = item.allMediaUrls || [];
                      const newUrls: string[] = [];
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const ext = file.name.split(".").pop() || "png";
                        const path = `content-calendar/${item.id}-ref-${Date.now()}-${i}.${ext}`;
                        const { error: upErr } = await db.storage.from("wrap-files").upload(path, file, { upsert: true });
                        if (upErr) { toast({ title: "Upload failed", description: upErr.message, variant: "destructive" }); continue; }
                        const { data: urlData } = db.storage.from("wrap-files").getPublicUrl(path);
                        newUrls.push(urlData.publicUrl);
                      }
                      if (newUrls.length > 0) {
                        const all = [...existing, ...newUrls];
                        if (item.sourceTable === "agent_social_posts") {
                          await db.from("agent_social_posts").update({ media_urls: all }).eq("id", item.id);
                        } else if (item.sourceTable === "agent_content_calendar") {
                          await (db as any).from("agent_content_calendar").update({ media_url: all[0] }).eq("id", item.id);
                        }
                        toast({ title: `${newUrls.length} asset(s) added` });
                        setSelectedItem({ ...item, allMediaUrls: all, thumbnailUrl: all[0] });
                        queryClient.invalidateQueries({ queryKey: ["content-calendar-full"] });
                      }
                    }} />
                  </label>
                </div>
              </div>

              {/* ── FINISHED WORK (what creator uploads back) ── */}
              <div className="px-4 pt-2">
                <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">✅ Finished Work</span>
                    <span className="text-[9px] text-emerald-500">{(item as any).finishedUrls?.length || 0}</span>
                  </div>
                  {(item as any).finishedUrls && (item as any).finishedUrls.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(item as any).finishedUrls.map((url: string, idx: number) => (
                        <a key={idx} href={url} download target="_blank" rel="noopener noreferrer" className="inline-block">
                          <Button variant="outline" size="sm" className="text-[9px] h-6 px-1.5 bg-white text-emerald-700 border-emerald-200">⬇ Final #{idx + 1}</Button>
                        </a>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-1 rounded border border-dashed border-emerald-300 bg-white hover:bg-emerald-50 py-1.5 cursor-pointer text-emerald-600">
                    <ImageIcon className="w-3 h-3" />
                    <span className="text-[9px] font-medium">Upload finished design / render / proof</span>
                    <input type="file" accept="image/*,video/*,application/pdf" multiple className="hidden" onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      const existing = (item as any).finishedUrls || [];
                      const newUrls: string[] = [];
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const ext = file.name.split(".").pop() || "png";
                        const path = `content-calendar/${item.id}-final-${Date.now()}-${i}.${ext}`;
                        const { error: upErr } = await db.storage.from("wrap-files").upload(path, file, { upsert: true });
                        if (upErr) { toast({ title: "Upload failed", description: upErr.message, variant: "destructive" }); continue; }
                        const { data: urlData } = db.storage.from("wrap-files").getPublicUrl(path);
                        newUrls.push(urlData.publicUrl);
                      }
                      if (newUrls.length > 0) {
                        const all = [...existing, ...newUrls];
                        if (item.sourceTable === "slack_agent_tasks") {
                          const meta = (item as any).metadata || {};
                          await (db as any).from("slack_agent_tasks").update({ metadata: { ...meta, finished_urls: all } }).eq("id", item.id);
                        } else if (item.sourceTable === "agent_content_calendar") {
                          await (db as any).from("agent_content_calendar").update({ notes: (item.fullText || "") + "\n\nFinished: " + all.join(", ") }).eq("id", item.id);
                        }
                        toast({ title: `${newUrls.length} finished file(s) uploaded` });
                        setSelectedItem({ ...item, finishedUrls: all } as any);
                        queryClient.invalidateQueries({ queryKey: ["content-calendar-full"] });
                      }
                    }} />
                  </label>
                </div>
              </div>

              {/* Spacer */}
              <div className="flex-1" />
            </div>
          </div>
        );
      })()}

      {/* Add Task Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900">
              Add Content — {addDate && format(parseISO(addDate), "EEEE, MMM d")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">Title *</label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Instagram reel — before/after Camaro wrap"
                className="mt-1 bg-white text-slate-900 border-slate-200"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 font-medium">Type</label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="mt-1 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blog_post">Blog</SelectItem>
                    <SelectItem value="social_post">Social Post</SelectItem>
                    <SelectItem value="email_campaign">Email</SelectItem>
                    <SelectItem value="ad_campaign">Ad Campaign</SelectItem>
                    <SelectItem value="design_request">Design</SelectItem>
                    <SelectItem value="seo_task">SEO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium">Assign to</label>
                <Select value={newAssignee} onValueChange={setNewAssignee}>
                  <SelectTrigger className="mt-1 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getVisibleCalTeamEntries(brand).map(([key, member]) => (
                      <SelectItem key={key} value={key}>
                        {member.emoji} {member.name.split(" ")[0]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Priority</label>
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger className="mt-1 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Notes</label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Brief description or links..."
                className="mt-1 h-20 bg-white text-slate-900 border-slate-200"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() => addTaskMutation.mutate()}
              disabled={!newTitle.trim() || addTaskMutation.isPending}
              className="bg-gradient-to-r from-blue-500 via-purple-500 to-fuchsia-500 text-white"
            >
              {addTaskMutation.isPending ? "Adding..." : "Add to Calendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
