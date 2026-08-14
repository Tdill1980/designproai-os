/**
 * AdminMarketingHub — The The Engine Room
 *
 * White UI with brand gradient (blue → magenta).
 * Color-coded by team member AND task type.
 * Split into Dev tasks and Marketing tasks.
 * Brand toggle: RestylePro / WePrintWraps.
 *
 * Built to replace Monday.com for the internal team.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Instagram,
  Mail,
  Megaphone,
  Calendar,
  Sparkles,
  Clock,
  CheckCircle2,
  Circle,
  RefreshCw,
  Wrench,
  Paintbrush,
  Code2,
  Bot,
  Rocket,
  Crown,
  Briefcase,
  Facebook,
  Linkedin,
  Twitter,
  Youtube,
  Image as ImageIcon,
  Video,
  Radio,
  ExternalLink,
  Film,
  LayoutGrid,
  Download,
  Paperclip,
  Trash2,
  Plus,
  FileText as FileIcon,
  Copy,
  Bug,
  Gift,
  Pin,
  FolderOpen,
  Target,
} from "lucide-react";
import NarrativeBoard from "@/components/admin/NarrativeBoard";
import PipelineHealthCard from "@/components/admin/PipelineHealthCard";
import { format, parseISO, isToday, isPast, startOfWeek, addWeeks, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import { Link, useSearchParams } from "react-router-dom";
import { isOwner } from "@/lib/admin-allowlist";
import { EngineRoomIssueReporter } from "@/components/admin/EngineRoomIssueReporter";
import EngineRoomUrgentReportsCard from "@/components/engineroom/EngineRoomUrgentReportsCard";
import VideoStudio from "@/components/engineroom/VideoStudio";
import AssetLibrary from "@/components/engineroom/AssetLibrary";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";
import MarketingSystemMap from "@/components/admin/MarketingSystemMap";
import { brandMeta } from "@/lib/content-tags";

// Team member series commitments
const MEMBER_SERIES: Record<string, Array<{name: string; frequency: string; desc: string; cadence?: string}>> = {
  trish: [{ name: "Founder's Voice", frequency: "Weekly", desc: "Sunday blog + 3 social posts from it" }],
  jess: [
    { name: "Designed in the DMs", frequency: "1x/month", desc: "Pick a follower, design their wrap proof live" },
    { name: "The Vinyl Lab", frequency: "1x/month", desc: "R&D — test new features, materials, presets" },
  ],
  carley: [
    { name: "Gnarley by Design", frequency: "1x/month (social)", desc: "Walk through a design from concept to QC" },
    { name: "Gnarley by Design Longform", frequency: "1x/month (YouTube)", desc: "Filmed episode, sectioned into 9:16 clips" },
  ],
  jackson: [
    // Daily (every weekday)
    { name: "Stories", frequency: "Daily", cadence: "daily", desc: "2–3 Stories (WPW + Wrap TV World)" },
    { name: "Engagement ×3/day (9a · 1p · 5p)", frequency: "Daily", cadence: "daily", desc: "Answer DMs + like/comment/share for BOTH @WePrintWraps & @WrapTVWorld — morning, midday, evening" },
    { name: "Scoreboard", frequency: "Daily", cadence: "daily", desc: "Log the day's real numbers in the card" },
    { name: "💵 Sales tracker — $10K/day", frequency: "Daily", cadence: "daily", desc: "NON-NEGOTIABLE: track the day's sales, log revenue, flag if we're off the $10K/day target" },
    // Weekly cadence — two anchors (Tue + Thu)
    { name: "Mon — Quick Tip Monday", frequency: "Weekly", cadence: "weekly", desc: "Social only: prompt/wrap/material/shop tip → IG·FB·LinkedIn·TikTok·X·Stories" },
    { name: "Tue — Behind the Design", frequency: "Weekly", cadence: "weekly", desc: "RestylePro tutorial: publish + distribute (live·email·web·blog·shorts·reels)" },
    { name: "Wed — Community", frequency: "Weekly", cadence: "weekly", desc: "BTS · teaser · polls · office life · Royalty Wraps" },
    { name: "Thu — Wrap TV World + WOTW", frequency: "Weekly", cadence: "weekly", desc: "Publish the episode + distribute Wrap of the Week everywhere (BIG DAY)" },
    { name: "Fri — Community + close-out", frequency: "Weekly", cadence: "weekly", desc: "Community clips/reels/stories + analytics + queue next week" },
    { name: "Meta Ads (run + design + report)", frequency: "Weekly", cadence: "weekly", desc: "NON-NEGOTIABLE: run/design the Meta ads, refresh creative, post the weekly ads report (spend·CPM·CTR·leads·ROAS)" },
    // No Saturday or Sunday publishing.
    // Monthly non-negotiables
    { name: "Ink & Edge Newsletter", frequency: "Monthly", cadence: "monthly", desc: "Deliver the premium monthly newsletter + upload the Freebie Vault download" },
    { name: "Production block", frequency: "Monthly", cadence: "monthly", desc: "Film/bank the month's tutorials + episodes at the studio" },
  ],
  amanda: [{ name: "R&D Feature", frequency: "1x/month", desc: "Partnership spotlights, sales strategy" }],
  rj: [{ name: "Flying Solo", frequency: "1x/month", desc: "One-man shop workflow, start to finish" }],
  houdini: [{ name: "Wrap Tricks", frequency: "1x/month", desc: "Install education, heat gun techniques, tips" }],
  xavier: [{ name: "RestyleRewind", frequency: "1x/month", desc: "Break down a past exotic project" }],
  brice: [{ name: "Daily Row User Push", frequency: "Daily", desc: "5 designs + 5 renders + 1 quote + 2D/3D proof" }],
  lance: [{ name: "WPW Team Tasks", frequency: "Daily", desc: "WPW internal production, marketing, and client ops work" }],
};

// ─── Types ──────────────────────────────────────────────────────────────────

type Brand = "restylepro" | "weprintwraps" | "designproai" | "wraptv" | "inkandedge" | "creatormarket";

// Brand display names. These replace a pile of
// `brand === "restylepro" ? "RP" : "WPW"` ternaries that predated the
// ecosystem having more than two brands — with DesignProAI, WrapTV,
// Ink & Edge or CreatorMarket selected, every one of them claimed you were
// saving to "WePrintWraps". A label must never lie about the destination.
const BRAND_LABEL: Record<Brand, string> = {
  restylepro: "RestylePro",
  weprintwraps: "WePrintWraps",
  designproai: "DesignProAI",
  wraptv: "WrapTVWorld",
  inkandedge: "Ink & Edge",
  creatormarket: "CreatorMarket",
};
const BRAND_SHORT: Record<Brand, string> = {
  restylepro: "RP",
  weprintwraps: "WPW",
  designproai: "DPA",
  wraptv: "WTV",
  inkandedge: "I&E",
  creatormarket: "CM",
};
type Category = "marketing" | "dev";
// Board brands. RestylePro + WePrintWraps are the operating brands; WrapTV and
// Ink & Edge are added so their content cards can be QC'd on the same board.
type TenantMode = "wpw" | undefined;
type TeamMember = "trish" | "jess" | "carley" | "amanda" | "xavier" | "houdini" | "jackson" | "rj" | "brice" | "troy" | "lance";

// ─── Team Config (LOCKED — DO NOT CHANGE WITHOUT TRISH APPROVAL) ────────────

export const TEAM = {
  trish: {
    name: "Trish Dill",
    title: "CEO, Marketing & AI Systems",
    role: "System / Vision",
    email: "trish@restyleproai.com",
    wpwEmail: "trish@weprintwraps.com",
    color: "from-pink-400 to-pink-600",
    ring: "ring-pink-500",
    bg: "bg-pink-50",
    text: "text-pink-700",
    border: "border-pink-300",
    dot: "bg-pink-500",
    cardBorder: "border-l-pink-500",
    icon: Crown,
    emoji: "💗",
  },
  jess: {
    name: "Jess Bonafacio",
    title: "VinylVixenJess — Head of Restyle & R&D",
    role: "Partner / R&D",
    email: "jess@restyleproai.com",
    // Jess is RP-only — hidden from the WPW tenant view
    wpwEmail: null,
    color: "from-purple-500 to-purple-600",
    ring: "ring-purple-500",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-300",
    dot: "bg-purple-500",
    cardBorder: "border-l-purple-500",
    icon: Sparkles,
    emoji: "🟣",
  },
  carley: {
    name: "Carley Chavez",
    title: "Gnarley Graphics — Director of Graphic Design Systems",
    role: "Partner / Design Systems",
    email: "carley@restyleproai.com",
    wpwEmail: "carley@weprintwraps.com",
    color: "from-blue-500 to-blue-600",
    ring: "ring-blue-500",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-300",
    dot: "bg-blue-500",
    cardBorder: "border-l-blue-500",
    icon: Paintbrush,
    emoji: "🟦",
  },
  amanda: {
    name: "Amanda",
    title: "Partnerships & Tier 2+ Sales — RoyaltyWraps Co-Owner",
    role: "Partner / Corp Sales",
    email: "amanda@restyleproai.com",
    wpwEmail: null,
    color: "from-emerald-500 to-green-600",
    ring: "ring-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-300",
    dot: "bg-emerald-500",
    cardBorder: "border-l-emerald-500",
    icon: Briefcase,
    emoji: "🟩",
  },
  xavier: {
    name: "Xavier",
    title: "High-End Sales & Exotics — RoyaltyWraps Co-Owner",
    role: "Sponsored Artist",
    email: null,
    wpwEmail: null,
    color: "from-slate-900 to-slate-700",
    ring: "ring-slate-900",
    bg: "bg-slate-100",
    text: "text-slate-900",
    border: "border-slate-400",
    dot: "bg-slate-900",
    cardBorder: "border-l-slate-900",
    icon: Crown,
    emoji: "⚫",
  },
  houdini: {
    name: "Gary Guiterrez",
    title: "Houdini — School of Wrap",
    role: "Sponsored Artist",
    email: null,
    wpwEmail: null,
    color: "from-yellow-400 to-amber-500",
    ring: "ring-yellow-500",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-300",
    dot: "bg-yellow-500",
    cardBorder: "border-l-yellow-500",
    icon: Sparkles,
    emoji: "🟨",
  },
  jackson: {
    name: "Jackson Obregon",
    title: "Director of Client Operations — WPW & RP",
    role: "Partner / Operations",
    email: "jackson@restyleproai.com",
    wpwEmail: "jackson@weprintwraps.com",
    color: "from-red-500 to-red-600",
    ring: "ring-red-500",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-300",
    dot: "bg-red-500",
    cardBorder: "border-l-red-500",
    icon: Wrench,
    emoji: "🟥",
  },
  rj: {
    name: "RJ The Wrapper",
    title: "Sponsored Wrap Artist",
    role: "Sponsored Artist",
    email: null,
    wpwEmail: null,
    color: "from-violet-700 to-purple-800",
    ring: "ring-violet-700",
    bg: "bg-violet-50",
    text: "text-violet-800",
    border: "border-violet-300",
    dot: "bg-violet-700",
    cardBorder: "border-l-violet-700",
    icon: Wrench,
    emoji: "🟪",
  },
  brice: {
    name: "Brice",
    title: "PrintPro / WPW Production",
    role: "Sponsored Artist",
    email: null,
    wpwEmail: "brice@weprintwraps.com",
    color: "from-orange-500 to-amber-600",
    ring: "ring-orange-500",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-300",
    dot: "bg-orange-500",
    cardBorder: "border-l-orange-500",
    icon: Wrench,
    emoji: "🟧",
  },
  troy: {
    name: "Troy",
    title: "WPW Team",
    role: "WPW Internal",
    email: null,
    wpwEmail: "troy@weprintwraps.com",
    color: "from-lime-500 to-lime-600",
    ring: "ring-lime-500",
    bg: "bg-lime-50",
    text: "text-lime-700",
    border: "border-lime-300",
    dot: "bg-lime-500",
    cardBorder: "border-l-lime-500",
    icon: Wrench,
    emoji: "🟢",
  },
  lance: {
    name: "Lance",
    title: "WPW Team",
    role: "WPW Internal",
    email: null,
    wpwEmail: "lance@weprintwraps.com",
    color: "from-teal-500 to-teal-600",
    ring: "ring-teal-500",
    bg: "bg-teal-50",
    text: "text-teal-700",
    border: "border-teal-300",
    dot: "bg-teal-500",
    cardBorder: "border-l-teal-500",
    icon: Wrench,
    emoji: "🔷",
  },
  agent: {
    name: "AI Agent",
    title: "RP Marketing Agent",
    role: "Dev / Automation",
    email: null,
    wpwEmail: null,
    color: "from-cyan-500 to-blue-600",
    ring: "ring-cyan-500",
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    border: "border-cyan-300",
    dot: "bg-cyan-500",
    cardBorder: "border-l-cyan-500",
    icon: Bot,
    emoji: "🤖",
  },
} as const;

type TeamKey = keyof typeof TEAM;

/**
 * Returns the team member entries that should be visible for a given brand.
 *
 * - WPW brand: only members with a wpwEmail (the WPW-facing team).
 *   This keeps the /wpw/engine-room directory clean and avoids confusing
 *   internal-WPW users with RestylePro-only members like Xavier, Houdini,
 *   RJ, or Amanda.
 * - RestylePro brand: the full team (minus the "agent" automation entry).
 */
function getVisibleTeamEntries(brand: Brand): [TeamKey, typeof TEAM[TeamKey]][] {
  const entries = Object.entries(TEAM) as [TeamKey, typeof TEAM[TeamKey]][];
  if (brand === "weprintwraps") {
    return entries.filter(([k, m]) => k !== "agent" && m.wpwEmail !== null);
  }
  return entries.filter(([k]) => k !== "agent");
}

// ─── Task Type Config (Color Coded) ─────────────────────────────────────────

const TASK_TYPE_CONFIG = {
  blog_post: { label: "Blog", color: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: FileText },
  social_post: { label: "Social", color: "bg-pink-100 text-pink-700 border-pink-300", icon: Instagram },
  email_campaign: { label: "Email", color: "bg-orange-100 text-orange-700 border-orange-300", icon: Mail },
  ad_campaign: { label: "Ad", color: "bg-red-100 text-red-700 border-red-300", icon: Megaphone },
  design_request: { label: "Design", color: "bg-purple-100 text-purple-700 border-purple-300", icon: Paintbrush },
  seo_task: { label: "SEO", color: "bg-teal-100 text-teal-700 border-teal-300", icon: Sparkles },
  dev_issue: { label: "Bug", color: "bg-red-100 text-red-700 border-red-300", icon: Wrench },
  dev_feature: { label: "Feature", color: "bg-indigo-100 text-indigo-700 border-indigo-300", icon: Code2 },
  dev_refactor: { label: "Refactor", color: "bg-slate-100 text-slate-700 border-slate-300", icon: Wrench },
  deployment: { label: "Deploy", color: "bg-violet-100 text-violet-700 border-violet-300", icon: Code2 },
  other: { label: "Other", color: "bg-slate-100 text-slate-600 border-slate-300", icon: Circle },
} as const;

const STATUS_CONFIG = {
  pending: { label: "To Do", color: "bg-slate-100 text-slate-700 border-slate-300" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700 border-blue-300" },
  completed: { label: "Scheduled Content", color: "bg-amber-100 text-amber-700 border-amber-300" },
  posted: { label: "Posted", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-700 border-rose-300" },
} as const;

const PRIORITY_CONFIG = {
  low: { border: "border-l-slate-300", label: "Low" },
  medium: { border: "border-l-blue-400", label: "Medium" },
  high: { border: "border-l-orange-500", label: "High" },
  urgent: { border: "border-l-red-600", label: "Urgent" },
} as const;

const COLUMNS = [
  { id: "pending", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Scheduled Content" },
  { id: "posted", label: "Posted" },
];

// ─── Channel Config ─────────────────────────────────────────────────────────
// All social channels with supported formats and dimensions

const CHANNELS = {
  instagram: {
    name: "Instagram",
    icon: Instagram,
    color: "from-pink-500 via-rose-500 to-orange-500",
    text: "text-pink-600",
    bg: "bg-pink-50",
    border: "border-pink-300",
    formats: [
      { label: "Feed 4:5", w: 1080, h: 1350, type: "static" },
      { label: "Feed 1:1", w: 1080, h: 1080, type: "static" },
      { label: "Reel 9:16", w: 1080, h: 1920, type: "reel" },
      { label: "Story 9:16", w: 1080, h: 1920, type: "story" },
      { label: "Carousel 1:1", w: 1080, h: 1080, type: "carousel" },
      { label: "Carousel 4:5", w: 1080, h: 1350, type: "carousel" },
    ],
  },
  facebook: {
    name: "Facebook",
    icon: Facebook,
    color: "from-blue-600 to-blue-700",
    text: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-300",
    formats: [
      { label: "Feed 1:1", w: 1080, h: 1080, type: "static" },
      { label: "Feed 4:5", w: 1080, h: 1350, type: "static" },
      { label: "Reel 9:16", w: 1080, h: 1920, type: "reel" },
      { label: "Story 9:16", w: 1080, h: 1920, type: "story" },
      { label: "Cover 820x312", w: 820, h: 312, type: "static" },
      { label: "Ad 1.91:1", w: 1200, h: 628, type: "ad" },
    ],
  },
  x: {
    name: "X (Twitter)",
    icon: Twitter,
    color: "from-slate-900 to-slate-700",
    text: "text-slate-900",
    bg: "bg-slate-50",
    border: "border-slate-300",
    formats: [
      { label: "Post 16:9", w: 1200, h: 675, type: "static" },
      { label: "Post 1:1", w: 1080, h: 1080, type: "static" },
      { label: "Video 16:9", w: 1920, h: 1080, type: "video" },
    ],
  },
  linkedin: {
    name: "LinkedIn",
    icon: Linkedin,
    color: "from-blue-700 to-sky-700",
    text: "text-blue-700",
    bg: "bg-sky-50",
    border: "border-sky-300",
    formats: [
      { label: "Post 1:1", w: 1200, h: 1200, type: "static" },
      { label: "Post 1.91:1", w: 1200, h: 627, type: "static" },
      { label: "Document Carousel", w: 1080, h: 1350, type: "carousel" },
      { label: "Video 16:9", w: 1920, h: 1080, type: "video" },
    ],
  },
  wraptv: {
    name: "WrapTV (YouTube)",
    icon: Youtube,
    color: "from-red-600 to-red-700",
    text: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-300",
    formats: [
      { label: "Longform 16:9", w: 1920, h: 1080, type: "video" },
      { label: "Podcast Audio", w: 0, h: 0, type: "audio" },
      { label: "Thumbnail 16:9", w: 1280, h: 720, type: "static" },
    ],
  },
  youtube_wpw: {
    name: "YouTube WPW",
    icon: Youtube,
    color: "from-red-500 to-orange-600",
    text: "text-red-500",
    bg: "bg-red-50",
    border: "border-red-300",
    formats: [
      { label: "Shorts 9:16", w: 1080, h: 1920, type: "reel" },
      { label: "Print Process 16:9", w: 1920, h: 1080, type: "video" },
      { label: "WOTW Highlight", w: 1920, h: 1080, type: "video" },
    ],
  },
  youtube_rp: {
    name: "YouTube RestylePro",
    icon: Youtube,
    color: "from-red-500 to-pink-600",
    text: "text-red-500",
    bg: "bg-red-50",
    border: "border-red-300",
    formats: [
      { label: "Shorts 9:16", w: 1080, h: 1920, type: "reel" },
      { label: "Tool Demo 16:9", w: 1920, h: 1080, type: "video" },
      { label: "Feature Spotlight", w: 1920, h: 1080, type: "video" },
    ],
  },
  pinterest: {
    name: "Pinterest",
    icon: ImageIcon,
    color: "from-rose-600 to-red-600",
    text: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-300",
    formats: [
      { label: "Pin 2:3", w: 1000, h: 1500, type: "static" },
      { label: "Idea Pin 9:16", w: 1080, h: 1920, type: "reel" },
      { label: "Video Pin 2:3", w: 1000, h: 1500, type: "video" },
    ],
  },
  substack: {
    name: "Substack",
    icon: Radio,
    color: "from-orange-600 to-red-500",
    text: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-300",
    formats: [
      { label: "Newsletter", w: 0, h: 0, type: "email" },
      { label: "Cover Image", w: 1456, h: 816, type: "static" },
      { label: "Thread Post", w: 0, h: 0, type: "text" },
    ],
  },
} as const;

type ChannelKey = keyof typeof CHANNELS;

// ─── Queries ────────────────────────────────────────────────────────────────

const db = supabase as any;

function useAgentTasks(brand: Brand, category: Category) {
  return useQuery({
    queryKey: ["agent-tasks", brand, category],
    queryFn: async () => {
      const { data, error } = await db
        .from("slack_agent_tasks")
        .select("*")
        .eq("brand", brand)
        .eq("category", category)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });
}

function useSocialPosts(brand: Brand) {
  return useQuery({
    queryKey: ["agent-social-posts", brand],
    queryFn: async () => {
      const { data, error } = await db
        .from("agent_social_posts")
        .select("*")
        .eq("brand", brand)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });
}

function useRecommendations() {
  return useQuery({
    queryKey: ["agent-recommendations"],
    queryFn: async () => {
      const { data, error } = await db
        .from("agent_recommendations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });
}

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({ task, onClick }: { task: any; onClick?: () => void }) {
  const typeCfg = TASK_TYPE_CONFIG[task.task_type as keyof typeof TASK_TYPE_CONFIG] || TASK_TYPE_CONFIG.other;
  const assignee = task.assigned_to && TEAM[task.assigned_to as keyof typeof TEAM];
  const TypeIcon = typeCfg.icon;
  const borderClass = assignee ? assignee.cardBorder : "border-l-slate-300";
  const meta = task.metadata as any;
  const attachments = Array.isArray(meta?.attachments) ? meta.attachments : [];
  const thumb = meta?.thumbnail_url || meta?.media_url || attachments.find((a: any) => a?.type === "image")?.url || null;
  const attachCount = attachments.length || (thumb ? 1 : 0);

  return (
    <Card
      onClick={onClick}
      className={cn(
        "mb-2 bg-white border-l-4 hover:shadow-lg transition-all cursor-pointer overflow-hidden",
        borderClass,
      )}
    >
      {thumb && (
        <img src={thumb} alt="" className="w-full h-32 object-cover" loading="lazy" />
      )}
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-slate-900 line-clamp-2 leading-tight">{task.title}</div>
            {task.description && (
              <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{task.description}</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", typeCfg.color)}>
            <TypeIcon className="w-2.5 h-2.5 mr-0.5" />
            {typeCfg.label}
          </Badge>

          <div className="flex items-center gap-2">
            {attachCount > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                <Paperclip className="w-2.5 h-2.5" />
                {attachCount}
              </span>
            )}
            {assignee && (
              <div className="flex items-center gap-1">
                <span className="text-xs">{assignee.emoji}</span>
                <span className="text-[10px] font-medium text-slate-700">{assignee.name.split(" ")[0]}</span>
              </div>
            )}
          </div>
        </div>

        {task.due_date && (
          <div className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Due {format(parseISO(task.due_date), "MMM d")}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Kanban View ────────────────────────────────────────────────────────────

function TaskKanban({ brand, category, initialFilterMember }: { brand: Brand; category: Category; initialFilterMember?: string | null }) {
  const { data: tasks = [], isLoading } = useAgentTasks(brand, category);
  const [localFilter, setFilterMember] = useState<TeamMember | "all">("all");
  const filterMember = initialFilterMember || localFilter;
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("social_post");
  const [newAssignee, setNewAssignee] = useState("trish");
  const [newPriority, setNewPriority] = useState("medium");
  const [newNotes, setNewNotes] = useState("");
  const [newScript, setNewScript] = useState("");
  const [newLinks, setNewLinks] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const detectFileType = (file: File | string): string => {
    const name = typeof file === "string" ? file : file.name;
    const mime = typeof file === "string" ? "" : file.type;
    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "image";
    if (mime.startsWith("video/") || /\.(mp4|mov|webm|avi)$/i.test(name)) return "video";
    if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
    return "file";
  };

  const parseLinks = (text: string): Array<{ url: string; name: string; type: string }> => {
    return text
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s))
      .map((url) => {
        let host = "link";
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
        const label = host.includes("drive.google") ? "Google Drive"
          : host.includes("canva") ? "Canva"
          : host.includes("dropbox") ? "Dropbox"
          : host.includes("figma") ? "Figma"
          : host.includes("notion") ? "Notion"
          : host;
        return { url, name: label, type: "link" };
      });
  };

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setUploading(true);
    try {
      const { data: inserted, error } = await (supabase as any)
        .from("slack_agent_tasks")
        .insert({
          brand,
          category,
          title: newTitle.trim(),
          task_type: newType,
          status: "pending",
          priority: newPriority,
          assigned_to: newAssignee,
          description: newNotes || null,
          due_date: new Date(newDate + "T10:00:00Z").toISOString(),
          metadata: { calendar_date: newDate, notes: newScript || undefined },
        })
        .select("id, metadata")
        .single();
      if (error) { alert("Failed: " + error.message); setUploading(false); return; }

      // Upload any staged files + persist link list
      const taskId = inserted.id;
      const uploaded: Array<{ url: string; name: string; type: string; size?: number }> = [];
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const safeName = file.name.replace(/[^\w.-]+/g, "_");
        const path = `content-calendar/${taskId}-${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { alert(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
        const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
        uploaded.push({ url: urlData.publicUrl, name: file.name, type: detectFileType(file), size: file.size });
      }
      const linkAtts = parseLinks(newLinks);
      const allAtts = [...uploaded, ...linkAtts];
      if (allAtts.length > 0) {
        const firstImg = uploaded.find((a) => a.type === "image")?.url;
        const newMeta = {
          ...(inserted.metadata || {}),
          attachments: allAtts,
          thumbnail_url: firstImg || null,
        };
        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", taskId);
      }

      setShowAdd(false);
      setNewTitle("");
      setNewNotes("");
      setNewScript("");
      setNewLinks("");
      setNewFiles([]);
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
    } finally {
      setUploading(false);
    }
  };

  const isPinned = (t: any) => t?.metadata?.pinned === true || t?.metadata?.pinned === "true";

  // Pinned cards (strategy, marketing engine, agreement) always show at the top,
  // regardless of the member filter — they are the "read first" context.
  const pinnedTasks = useMemo(
    () => tasks.filter(isPinned).sort((a: any, b: any) => (a.title || "").localeCompare(b.title || "")),
    [tasks],
  );

  const filtered = useMemo(() => {
    const base = tasks.filter((t: any) => !isPinned(t));
    if (filterMember === "all") return base;
    return base.filter((t: any) => t.assigned_to === filterMember);
  }, [tasks, filterMember]);

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const col of COLUMNS) groups[col.id] = [];
    for (const task of filtered) {
      const status = task.status || "pending";
      if (groups[status]) groups[status].push(task);
      else groups.pending.push(task);
    }
    // Sort each column chronologically so the soonest due date is on top
    // (no due date sinks to the bottom) — otherwise To Do is an unordered pile.
    const dueVal = (t: any) => (t.due_date ? new Date(t.due_date).getTime() : Number.POSITIVE_INFINITY);
    for (const col of COLUMNS) groups[col.id].sort((a: any, b: any) => dueVal(a) - dueVal(b));
    return groups;
  }, [filtered]);

  if (isLoading) {
    return <div className="text-slate-500 text-center py-12">Loading tasks...</div>;
  }

  return (
    <div>
      {/* New Task button */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          size="sm"
          onClick={() => setShowAdd(true)}
          className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white text-xs gap-1.5 border-0 h-8"
        >
          + New Task ({BRAND_SHORT[brand]})
        </Button>
        <span className="text-xs text-slate-500">Saves to {BRAND_LABEL[brand]} calendar</span>
      </div>

      {/* Add Task Dialog */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o && !uploading) setShowAdd(false); }}>
        <DialogContent className="bg-white w-[90vw] sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900">
              New Task — {BRAND_LABEL[brand]}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Title *</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Task title..." className="mt-1 bg-white text-slate-900 border-slate-200" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Date</label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 h-9 bg-white text-slate-900 border-slate-200" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Priority</label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Type</label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blog_post">Blog</SelectItem>
                    <SelectItem value="social_post">Social</SelectItem>
                    <SelectItem value="email_campaign">Email</SelectItem>
                    <SelectItem value="ad_campaign">Ad</SelectItem>
                    <SelectItem value="design_request">Design</SelectItem>
                    <SelectItem value="seo_task">SEO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Assign To</label>
                <Select value={newAssignee} onValueChange={setNewAssignee}>
                  <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getVisibleTeamEntries(brand).map(([key, m]) => (
                      <SelectItem key={key} value={key}>{m.emoji} {m.name.split(" ")[0]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Content Copy / Caption</label>
              <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="The finished caption/copy. Team will Copy Text from here to post." className="mt-1 h-20 bg-white text-slate-900 border-slate-200" />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Script / Notes / Instructions (BIG BOX)</label>
              <Textarea
                value={newScript}
                onChange={(e) => setNewScript(e.target.value)}
                placeholder={"Full script, shot list, production notes, what to do...\n\nParagraph 1 — hook\nParagraph 2 — middle\nParagraph 3 — CTA"}
                className="mt-1 min-h-[160px] bg-amber-50/40 text-slate-900 border-amber-200 font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Links — Templates, Drive, Canva, Figma, Dropbox</label>
              <Textarea
                value={newLinks}
                onChange={(e) => setNewLinks(e.target.value)}
                placeholder={"Paste one or more links (one per line)\nhttps://drive.google.com/...\nhttps://canva.com/design/..."}
                className="mt-1 h-16 bg-white text-slate-900 border-slate-200 text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center justify-between">
                <span>Upload Templates / Assets / Collateral</span>
                <span className="text-[9px] text-slate-400 font-normal normal-case">PDF · PNG · JPG · MP4 · MOV</span>
              </label>
              <label className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition py-3 cursor-pointer text-slate-500 hover:text-blue-600">
                <Plus className="w-4 h-4" />
                <span className="text-xs font-medium">Choose files (multiple OK)</span>
                <input
                  type="file"
                  accept="image/*,video/*,application/pdf,.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) setNewFiles((prev) => [...prev, ...files]);
                    (e.target as HTMLInputElement).value = "";
                  }}
                />
              </label>
              {newFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {newFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 p-1.5 bg-white">
                      <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                        {detectFileType(f) === "image" ? (
                          <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                        ) : detectFileType(f) === "video" ? (
                          <Video className="w-3.5 h-3.5 text-slate-500" />
                        ) : detectFileType(f) === "pdf" ? (
                          <FileIcon className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <FileIcon className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-800 truncate">{f.name}</div>
                        <div className="text-[9px] uppercase tracking-wider text-slate-400">{(f.size / 1024).toFixed(0)} KB · {detectFileType(f)}</div>
                      </div>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                        onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={addTask} disabled={uploading || !newTitle.trim()} className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white border-0">
              {uploading ? "Creating & uploading..." : "Add Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Team filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilterMember("all")}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
            filterMember === "all"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
          )}
        >
          Everyone ({tasks.length})
        </button>
        {getVisibleTeamEntries(brand).map(([key, member]) => {
          const count = tasks.filter((t: any) => t.assigned_to === key).length;
          const Icon = member.icon;
          return (
            <button
              key={key}
              onClick={() => setFilterMember(key as TeamMember)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all border flex items-center gap-1.5",
                filterMember === key
                  ? `bg-gradient-to-r ${member.color} text-white border-transparent shadow-md`
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
              )}
            >
              <Icon className="w-3 h-3" />
              {member.name.split(" ")[0]} ({count})
            </button>
          );
        })}
      </div>

      {/* Pinned — Strategy, Marketing Engine, Agreement. Always at the top,
          visible under every member filter so the plan leads the board. */}
      {pinnedTasks.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-900/10 bg-gradient-to-r from-slate-50 to-white p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Pin className="w-3.5 h-3.5 text-pink-600" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Pinned — Strategy &amp; Agreement (read first)
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {pinnedTasks.map((t: any) => {
              const cfg = TASK_TYPE_CONFIG[t.task_type as keyof typeof TASK_TYPE_CONFIG] || TASK_TYPE_CONFIG.other;
              const Icon = cfg.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTask(t)}
                  className="text-left rounded-lg border border-slate-200 bg-white hover:shadow-md hover:border-pink-300 transition p-2.5"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{cfg.label}</span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 line-clamp-2 leading-tight">{t.title}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filtered.length === 0 && pinnedTasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
          <Bot className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-2">No tasks yet</p>
          <p className="text-xs text-slate-400">
            Ask the agent in Slack: "@RP Marketing Agent create a{" "}
            {category === "dev" ? "dev task" : "marketing task"}..."
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div
              key={col.id}
              className="bg-slate-50 rounded-lg p-3 border border-slate-200"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm text-slate-700">{col.label}</h3>
                <Badge variant="secondary" className="text-xs">
                  {grouped[col.id]?.length || 0}
                </Badge>
              </div>
              <div className="min-h-[200px]">
                {grouped[col.id]?.map((task: any) => (
                  <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Board card detail panel */}
      {selectedTask && (() => {
        const t = selectedTask;
        const typeCfg = TASK_TYPE_CONFIG[t.task_type as keyof typeof TASK_TYPE_CONFIG] || TASK_TYPE_CONFIG.other;
        const TypeIcon = typeCfg.icon;
        const assignee = t.assigned_to ? TEAM[t.assigned_to as keyof typeof TEAM] : null;
        const meta = (t.metadata as any) || {};
        const isDone = t.status === "completed" || t.status === "posted";
        const isPosted = t.status === "posted";
        const isScheduled = t.status === "completed";

        // Build unified attachments list (new format + legacy fields)
        const existingAttachments = Array.isArray(meta?.attachments) ? meta.attachments : [];
        const legacyUrls: any[] = [];
        if (meta?.thumbnail_url && !existingAttachments.some((a: any) => a?.url === meta.thumbnail_url)) {
          legacyUrls.push({ url: meta.thumbnail_url, name: "thumbnail", type: "image" });
        }
        if (meta?.media_url && meta.media_url !== meta.thumbnail_url && !existingAttachments.some((a: any) => a?.url === meta.media_url)) {
          legacyUrls.push({ url: meta.media_url, name: "media", type: "image" });
        }
        const attachments = [...existingAttachments, ...legacyUrls];
        const notes = meta?.notes || "";

        const detectType = (file: File): string => {
          if (file.type.startsWith("image/")) return "image";
          if (file.type.startsWith("video/")) return "video";
          if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
          return "file";
        };

        const duplicateToRP = async () => {
          const { data: src, error: srcErr } = await (supabase as any)
            .from("slack_agent_tasks")
            .select("*")
            .eq("id", t.id)
            .single();
          if (srcErr || !src) {
            alert(`Duplicate failed: ${srcErr?.message || "row not found"}`);
            return;
          }
          const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = src;
          const { error: insErr } = await (supabase as any)
            .from("slack_agent_tasks")
            .insert({ ...rest, brand: "restylepro", assigned_to: "carley" });
          if (insErr) {
            alert(`Duplicate failed: ${insErr.message}`);
            return;
          }
          queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
          setSelectedTask(null);
        };

        const deleteCard = async () => {
          if (!window.confirm(`Delete "${t.title}"?\n\nThis cannot be undone.`)) return;
          const { error } = await (supabase as any)
            .from("slack_agent_tasks")
            .delete()
            .eq("id", t.id);
          if (error) {
            alert(`Delete failed: ${error.message}`);
            return;
          }
          queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
          setSelectedTask(null);
        };

        return (
          <Dialog open={!!selectedTask} onOpenChange={(o) => { if (!o) setSelectedTask(null); }}>
            <DialogContent className="bg-white p-0 w-[92vw] sm:max-w-[420px] max-h-[90vh] overflow-hidden flex flex-col gap-0">
              <div className={cn("h-1.5 bg-gradient-to-r shrink-0", assignee?.color || "from-slate-400 to-slate-500")} />

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="flex items-center gap-1.5 mb-2 flex-wrap pr-8">
                  <Badge className={cn("text-[10px] px-1.5 py-0 border", typeCfg.color)}>
                    <TypeIcon className="w-2.5 h-2.5 mr-0.5" />{typeCfg.label}
                  </Badge>
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 border",
                      isPosted
                        ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                        : isScheduled
                        ? "bg-amber-100 text-amber-700 border-amber-300"
                        : t.status === "in_progress"
                        ? "bg-blue-100 text-blue-700 border-blue-300"
                        : "bg-slate-100 text-slate-700 border-slate-300",
                    )}
                  >
                    {isPosted ? "Posted" : isScheduled ? "Scheduled Content" : t.status === "in_progress" ? "In Progress" : "To Do"}
                  </Badge>
                  {t.priority && <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{t.priority}</Badge>}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {assignee && (
                    <div className={cn("w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold shrink-0", assignee.color)}>
                      {assignee.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Assigned To</label>
                    <Select
                      value={t.assigned_to || ""}
                      onValueChange={async (val) => {
                        await (supabase as any).from("slack_agent_tasks").update({ assigned_to: val }).eq("id", t.id);
                        setSelectedTask({ ...t, assigned_to: val });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs bg-white border-slate-200"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        {getVisibleTeamEntries(brand).map(([key, m]) => (
                          <SelectItem key={key} value={key}>{m.emoji} {m.name.split(" ")[0]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {t.due_date && (
                    <div className="text-right shrink-0">
                      <div className="text-[10px] font-semibold text-slate-700">Due {format(parseISO(t.due_date), "EEE, MMM d")}</div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Title</h3>
                  <button onClick={() => navigator.clipboard.writeText(t.title || "")} className="text-[10px] text-blue-600 hover:underline font-medium">Copy</button>
                </div>
                <Input
                  key={t.id + "-title"}
                  defaultValue={t.title}
                  className="text-sm font-semibold mb-3 h-8 bg-white text-slate-900 border-slate-200"
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (val === t.title) return;
                    await (supabase as any).from("slack_agent_tasks").update({ title: val }).eq("id", t.id);
                    setSelectedTask({ ...t, title: val });
                    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                    queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                  }}
                />

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Due Date</h3>
                    <Input
                      key={t.id + "-date"}
                      type="date"
                      defaultValue={t.due_date ? t.due_date.slice(0, 10) : ""}
                      className="text-xs h-8 bg-white text-slate-900 border-slate-200"
                      onBlur={async (e) => {
                        const val = e.target.value;
                        if (!val) return;
                        const newDate = new Date(val + "T10:00:00Z").toISOString();
                        await (supabase as any).from("slack_agent_tasks").update({
                          due_date: newDate,
                          metadata: { ...meta, calendar_date: val }
                        }).eq("id", t.id);
                        setSelectedTask({ ...t, due_date: newDate, metadata: { ...meta, calendar_date: val } });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</h3>
                    <Select value={t.status} onValueChange={async (val) => {
                      await (supabase as any).from("slack_agent_tasks").update({ status: val }).eq("id", t.id);
                      setSelectedTask({ ...t, status: val });
                      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                      queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                    }}>
                      <SelectTrigger className="text-xs h-8 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Scheduled Content</SelectItem>
                        <SelectItem value="posted">Posted</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Details / Content Copy</h3>
                  <button onClick={() => navigator.clipboard.writeText(t.description || "")} className="text-[10px] text-blue-600 hover:underline font-medium">Copy</button>
                </div>
                <Textarea
                  key={t.id + "-desc"}
                  defaultValue={t.description || ""}
                  placeholder="Content copy, captions, instructions..."
                  className="text-xs min-h-[110px] mb-3 bg-white text-slate-900 border-slate-200"
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (val === (t.description || "")) return;
                    await (supabase as any).from("slack_agent_tasks").update({ description: val }).eq("id", t.id);
                    setSelectedTask({ ...t, description: val });
                    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                  }}
                />

                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">My Notes — What To Do</h3>
                  <button onClick={() => navigator.clipboard.writeText(notes)} className="text-[10px] text-blue-600 hover:underline font-medium">Copy</button>
                </div>
                <Textarea
                  key={t.id + "-notes"}
                  defaultValue={notes}
                  placeholder="Personal notes, to-do checklist, production instructions..."
                  className="text-xs min-h-[70px] mb-3 bg-amber-50/40 text-slate-900 border-amber-200"
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (val === notes) return;
                    const newMeta = { ...meta, notes: val };
                    await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", t.id);
                    setSelectedTask({ ...t, metadata: newMeta });
                    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                  }}
                />

                {/* Attachments — image grid + file list */}
                <div className="mb-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> Uploaded Content ({attachments.length})
                    </h3>
                    {attachments.length > 0 && (
                      <button
                        onClick={async () => {
                          // Download every attachment (open each in new tab)
                          for (const a of attachments) {
                            if (a?.url) window.open(a.url, "_blank");
                          }
                        }}
                        className="text-[10px] text-blue-600 hover:underline font-medium"
                      >
                        Open all
                      </button>
                    )}
                  </div>
                  {attachments.length > 0 && (() => {
                    const imageAtts = attachments.filter((a: any) => a?.type === "image" || /\.(png|jpe?g|gif|webp|svg)$/i.test(a?.url || ""));
                    const otherAtts = attachments.filter((a: any) => !(a?.type === "image" || /\.(png|jpe?g|gif|webp|svg)$/i.test(a?.url || "")));
                    return (
                      <>
                        {/* Image grid (preview + download + remove) */}
                        {imageAtts.length > 0 && (
                          <div className="grid grid-cols-3 gap-1.5 mb-2">
                            {imageAtts.map((att: any) => {
                              const idx = attachments.indexOf(att);
                              return (
                                <div key={idx} className="relative group rounded-md overflow-hidden border border-slate-200 bg-slate-50 aspect-square">
                                  <a href={att.url} target="_blank" rel="noopener noreferrer">
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" loading="lazy" />
                                  </a>
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
                                    <a href={att.url} target="_blank" rel="noopener noreferrer" download={att.name} className="p-1 rounded bg-white/90 hover:bg-white text-slate-700" title="Download">
                                      <Download className="w-3 h-3" />
                                    </a>
                                    <button
                                      title="Remove"
                                      className="p-1 rounded bg-white/90 hover:bg-red-100 text-red-500"
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        const newList = attachments.filter((_: any, i: number) => i !== idx);
                                        const newMeta = { ...meta, attachments: newList };
                                        if (meta?.thumbnail_url === att.url) newMeta.thumbnail_url = newList.find((a: any) => a?.type === "image")?.url || newList[0]?.url || null;
                                        if (meta?.media_url === att.url) newMeta.media_url = null;
                                        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", t.id);
                                        setSelectedTask({ ...t, metadata: newMeta });
                                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                                      }}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Non-image files list (PDF, video, other) */}
                        {otherAtts.length > 0 && (
                          <div className="space-y-1 mb-2">
                            {otherAtts.map((att: any) => {
                              const idx = attachments.indexOf(att);
                              const url = att?.url;
                              const name = att?.name || `file-${idx + 1}`;
                              const isVid = att?.type === "video" || /\.(mp4|mov|webm|avi)$/i.test(url || "");
                              const isPdf = att?.type === "pdf" || /\.pdf$/i.test(url || "");
                              return (
                                <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-200 p-1.5 bg-white hover:bg-slate-50 transition">
                                  <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                                    {isVid ? <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" /> : isPdf ? <FileIcon className="w-4 h-4 text-red-500" /> : <FileIcon className="w-4 h-4 text-slate-500" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[11px] font-medium text-slate-800 truncate">{name}</div>
                                    <div className="text-[9px] uppercase tracking-wider text-slate-400">{isPdf ? "PDF" : isVid ? "Video" : "File"}</div>
                                  </div>
                                  <a href={url} target="_blank" rel="noopener noreferrer" download={name} title="Download" className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700">
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                  <button
                                    title="Remove"
                                    className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                                    onClick={async () => {
                                      const newList = attachments.filter((_: any, i: number) => i !== idx);
                                      const newMeta = { ...meta, attachments: newList };
                                      if (meta?.thumbnail_url === url) newMeta.thumbnail_url = newList[0]?.url || null;
                                      if (meta?.media_url === url) newMeta.media_url = null;
                                      await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", t.id);
                                      setSelectedTask({ ...t, metadata: newMeta });
                                      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                                      queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                                    }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors py-2 cursor-pointer text-slate-400 hover:text-blue-500">
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium">Add PDFs, images or videos</span>
                    <input
                      type="file"
                      accept="image/*,video/*,application/pdf,.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        const newAttachments: any[] = [];
                        for (let i = 0; i < files.length; i++) {
                          const file = files[i];
                          const ext = file.name.split(".").pop() || "bin";
                          const safeName = file.name.replace(/[^\w.-]+/g, "_");
                          const path = `content-calendar/${t.id}-${Date.now()}-${i}-${safeName}`;
                          const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
                          if (upErr) { alert(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
                          const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
                          newAttachments.push({ url: urlData.publicUrl, name: file.name, type: detectType(file), size: file.size });
                        }
                        if (newAttachments.length === 0) return;
                        const merged = [...attachments, ...newAttachments];
                        const firstImage = merged.find((a: any) => a.type === "image");
                        const newMeta = {
                          ...meta,
                          attachments: merged,
                          thumbnail_url: firstImage?.url || meta?.thumbnail_url || merged[0]?.url || null,
                        };
                        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", t.id);
                        setSelectedTask({ ...t, metadata: newMeta });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                        (e.target as HTMLInputElement).value = "";
                      }}
                    />
                  </label>
                </div>

              </div>

              {/* Sticky action bar — upload/download/mark complete */}
              <div className="border-t border-slate-100 bg-slate-50 px-3 py-2.5 shrink-0 space-y-2">
                {meta?.content_studio_url && (
                  <Link to={meta.content_studio_url} className="block">
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-0 hover:opacity-90"
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1" /> Open in Content Studio
                    </Button>
                  </Link>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Auto-saved as you type</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {t.status === "posted" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 col-span-2 border-slate-300"
                      onClick={async () => {
                        await (supabase as any).from("slack_agent_tasks").update({ status: "completed" }).eq("id", t.id);
                        setSelectedTask({ ...t, status: "completed" });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    >
                      <Circle className="w-3 h-3 mr-1" /> Unpost (back to Scheduled)
                    </Button>
                  ) : t.status === "completed" ? (
                    <Button
                      size="sm"
                      className="text-xs h-8 col-span-2 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white border-0"
                      onClick={async () => {
                        await (supabase as any).from("slack_agent_tasks").update({ status: "posted" }).eq("id", t.id);
                        setSelectedTask({ ...t, status: "posted" });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve &amp; Schedule
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="text-xs h-8 col-span-2 bg-emerald-500 hover:bg-emerald-600 text-white border-0"
                      onClick={async () => {
                        await (supabase as any).from("slack_agent_tasks").update({ status: "completed" }).eq("id", t.id);
                        setSelectedTask({ ...t, status: "completed" });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Mark Complete (Scheduled Content)
                    </Button>
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*,video/*,application/pdf,.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        const newAttachments: any[] = [];
                        for (let i = 0; i < files.length; i++) {
                          const file = files[i];
                          const safeName = file.name.replace(/[^\w.-]+/g, "_");
                          const path = `content-calendar/${t.id}-${Date.now()}-${i}-${safeName}`;
                          const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
                          if (upErr) { alert(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
                          const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
                          newAttachments.push({ url: urlData.publicUrl, name: file.name, type: detectType(file), size: file.size });
                        }
                        if (newAttachments.length === 0) return;
                        const merged = [...attachments, ...newAttachments];
                        const firstImage = merged.find((a: any) => a.type === "image");
                        const newMeta = { ...meta, attachments: merged, thumbnail_url: firstImage?.url || meta?.thumbnail_url || merged[0]?.url || null };
                        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", t.id);
                        setSelectedTask({ ...t, metadata: newMeta });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                        (e.target as HTMLInputElement).value = "";
                      }}
                    />
                    <div className="text-xs h-8 flex items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium gap-1">
                      <Plus className="w-3.5 h-3.5" /> Upload
                    </div>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8"
                    disabled={attachments.length === 0}
                    onClick={() => {
                      for (const a of attachments) {
                        if (a?.url) window.open(a.url, "_blank");
                      }
                    }}
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Download ({attachments.length})
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  {brand === "weprintwraps" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 flex-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                      onClick={duplicateToRP}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Duplicate to RP (Carley)
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-7 flex-1 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={deleteCard}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="text-[10px] h-6 flex-1 text-slate-600" onClick={() => navigator.clipboard.writeText(`${t.title}\n\n${t.description || ""}${notes ? `\n\nNotes:\n${notes}` : ""}`)}>
                    Copy All Text
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[10px] h-6 flex-1 text-slate-700" onClick={() => setSelectedTask(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

// ─── Team Directory ─────────────────────────────────────────────────────────

export function TeamDirectory({ onMemberClick, selectedMember, taskCounts, brand }: {
  onMemberClick?: (key: string) => void;
  selectedMember?: string | null;
  taskCounts?: Record<string, number>;
  brand: Brand;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500" />
        <h2 className="text-sm font-semibold text-slate-700">The Team</h2>
        {selectedMember && (
          <button
            onClick={() => onMemberClick?.("")}
            className="ml-auto text-xs text-blue-600 hover:underline"
          >
            Show All
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {getVisibleTeamEntries(brand).map(([key, member]) => {
          const Icon = member.icon;
          const count = taskCounts?.[key] || 0;
          const isSelected = selectedMember === key;
          return (
            <button
              key={key}
              onClick={() => onMemberClick?.(key)}
              className={cn(
                "flex items-center gap-3 p-2.5 rounded-lg transition-all border text-left",
                isSelected
                  ? `${member.bg} ${member.border} ring-2 ${member.ring} shadow-md`
                  : "border-transparent hover:bg-slate-50 hover:border-slate-200",
              )}
            >
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full bg-gradient-to-br flex items-center justify-center shadow-sm",
                    member.color,
                  )}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
                {count > 0 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-slate-700">{count}</span>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-xs text-slate-900 truncate flex items-center gap-1">
                  <span>{member.emoji}</span> {member.name}
                </div>
                <div className="text-[10px] text-slate-600 truncate font-medium">{member.title}</div>
                <div className="text-[9px] text-slate-400 truncate">{member.role}</div>
                {member.email && <div className="text-[8px] text-blue-500 truncate">{member.email}</div>}
                {member.wpwEmail && <div className="text-[8px] text-cyan-500 truncate">{member.wpwEmail}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Channels View ──────────────────────────────────────────────────────────

// Weekly content quotas per channel
// Source: 1 blog/week (Sunday) → 10 social pieces total (NOT more) + 3 emails separate
// Series: Designed in the DMs (Jess, separate), RJ Flying Solo (2/month), The Edge newsletter (weekly)
const WEEKLY_QUOTAS: Record<string, Record<string, number>> = {
  instagram: { feed: 2, reel: 1, story: 2, carousel: 1 },  // 6
  facebook: { feed: 1, reel: 1 },                            // 2
  x: { feed: 1 },                                            // 1
  linkedin: { feed: 1 },                                     // 1
  wraptv: { video: 0 },                                      // as-needed
  youtube_wpw: { reel: 0 },                                  // as-needed
  youtube_rp: { reel: 0 },                                   // as-needed
  pinterest: { pin: 0 },                                     // as-needed
  substack: { email: 1 },  // The Edge — WPW/VVJ/RJ/Houdini rotating + podcast + monthly giveaway
};
// Total social = 10/week across channels
// Emails separate: 3/week (RP campaign + WPW The Edge + drip)
// Series (separate from quota): Designed in the DMs (Jess), RJ Flying Solo (2/mo)
// Quarterly Magazine: Q2 due ~May 5 — Royalty Wraps Yacht (Amanda+Xavier), Chicago Shaun, Miami Dee WoW

const FORMAT_LABELS: Record<string, string> = {
  feed: "Feed Post", reel: "Reel/Short", story: "Story", carousel: "Carousel",
  ad: "Ad", video: "Video", pin: "Pin", email: "Newsletter", static: "Static",
  audio: "Audio", text: "Text",
};

function ChannelsView({ brand }: { brand: Brand }) {
  const { data: posts = [] } = useSocialPosts(brand);

  // Count scheduled posts per channel + type this week
  const postsByChannel: Record<string, any[]> = {};
  posts.forEach((p: any) => {
    const ch = p.platform || "unknown";
    if (!postsByChannel[ch]) postsByChannel[ch] = [];
    postsByChannel[ch].push(p);
  });

  // Total stats
  const totalQuota = Object.values(WEEKLY_QUOTAS).reduce((sum, ch) => sum + Object.values(ch).reduce((s, n) => s + n, 0), 0);
  const totalScheduled = posts.length;

  return (
    <div>
      {/* Overview stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-2xl font-bold text-slate-900">{Object.keys(CHANNELS).length}</div>
          <div className="text-xs font-medium text-slate-500 mt-1">Channels</div>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{totalQuota}</div>
          <div className="text-xs font-medium text-blue-600 mt-1">Weekly Quota</div>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{totalScheduled}</div>
          <div className="text-xs font-medium text-emerald-600 mt-1">Scheduled</div>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{Math.max(0, totalQuota - totalScheduled)}</div>
          <div className="text-xs font-medium text-amber-600 mt-1">Still Needed</div>
        </div>
      </div>

      {/* Channel matrix */}
      <div className="space-y-3">
        {(Object.keys(CHANNELS) as ChannelKey[]).map((key) => {
          const channel = CHANNELS[key];
          const Icon = channel.icon;
          const channelPosts = postsByChannel[key] || [];
          const quotas = WEEKLY_QUOTAS[key] || {};
          const totalNeeded = Object.values(quotas).reduce((s, n) => s + n, 0);
          const totalHave = channelPosts.length;
          const fillPct = totalNeeded > 0 ? Math.min(100, Math.round((totalHave / totalNeeded) * 100)) : 0;

          // Count posts by type
          const countByType: Record<string, number> = {};
          channelPosts.forEach((p: any) => {
            const t = p.post_type || "feed";
            countByType[t] = (countByType[t] || 0) + 1;
          });

          return (
            <Card key={key} className="bg-white overflow-hidden">
              <div className="flex items-stretch">
                {/* Channel sidebar */}
                <div className={cn("w-[200px] shrink-0 p-4 flex flex-col justify-between border-r border-slate-100", channel.bg)}>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={cn("w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center shadow-sm", channel.color)}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-900">{channel.name}</div>
                        <div className="text-[10px] text-slate-500">{totalHave}/{totalNeeded} per week</div>
                      </div>
                    </div>
                    {/* Fill bar */}
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden mt-2">
                      <div
                        className={cn("h-full rounded-full transition-all", fillPct >= 100 ? "bg-emerald-500" : fillPct >= 50 ? "bg-blue-500" : "bg-amber-500")}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                    <div className={cn("text-[10px] font-bold mt-1", fillPct >= 100 ? "text-emerald-600" : fillPct >= 50 ? "text-blue-600" : "text-amber-600")}>
                      {fillPct}% filled
                    </div>
                  </div>
                  <Link to="/admin/content-studio">
                    <Button variant="outline" size="sm" className="w-full text-[10px] mt-2 gap-1">
                      <Paintbrush className="w-3 h-3" /> Create in Studio
                    </Button>
                  </Link>
                </div>

                {/* Format breakdown */}
                <div className="flex-1 p-4">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Weekly Content Requirements</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {Object.entries(quotas).map(([type, needed]) => {
                      const have = countByType[type] || 0;
                      const isFull = have >= needed;
                      const label = FORMAT_LABELS[type] || type;

                      return (
                        <div key={type} className={cn(
                          "rounded-lg border p-3 text-center transition-all",
                          isFull
                            ? "border-emerald-200 bg-emerald-50"
                            : have > 0
                            ? "border-blue-200 bg-blue-50"
                            : "border-amber-200 bg-amber-50"
                        )}>
                          <div className={cn(
                            "text-lg font-bold",
                            isFull ? "text-emerald-700" : have > 0 ? "text-blue-700" : "text-amber-700"
                          )}>
                            {have}<span className="text-slate-400 font-normal text-sm">/{needed}</span>
                          </div>
                          <div className="text-[10px] font-semibold text-slate-600 mt-0.5">{label}</div>
                          {isFull ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto mt-1" />
                          ) : (
                            <div className="text-[9px] text-amber-600 font-medium mt-1">need {needed - have} more</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Supported formats reference */}
                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <div className="text-[9px] font-semibold text-slate-400 uppercase mb-1">Supported Formats</div>
                    <div className="flex flex-wrap gap-1">
                      {channel.formats.map((f) => (
                        <Badge key={f.label} variant="outline" className={cn("text-[9px] py-0", channel.bg, channel.text, channel.border)}>
                          {f.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Blog Overview Tab ─────────────────────────────────────────────────────

function BlogOverviewTab() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["marketing-hub-blog-posts"],
    queryFn: async () => {
      const { data, error } = await db
        .from("blog_posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        title: string;
        slug: string;
        description: string;
        featured_image_url: string | null;
        tags: string[];
        author: string;
        read_time: string;
        status: string;
        published_at: string | null;
        created_at: string;
      }>;
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <div className="text-slate-500 text-center py-12">Loading blog posts...</div>;
  }

  const published = posts.filter((p) => p.status === "published");
  const drafts = posts.filter((p) => p.status === "draft");
  const scheduled = posts.filter((p) => p.status === "scheduled");

  const statusBadge = (status: string) => {
    if (status === "published") return "bg-emerald-100 text-emerald-700 border-emerald-300";
    if (status === "scheduled") return "bg-amber-100 text-amber-700 border-amber-300";
    return "bg-slate-100 text-slate-600 border-slate-300";
  };

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
          <div className="text-2xl font-bold text-slate-900">{posts.length}</div>
          <div className="text-xs font-medium text-slate-500 mt-1">Total Posts</div>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{published.length}</div>
          <div className="text-xs font-medium text-emerald-600 mt-1">Published</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
          <div className="text-2xl font-bold text-slate-600">{drafts.length}</div>
          <div className="text-xs font-medium text-slate-500 mt-1">Drafts</div>
        </div>
        <div className="bg-white rounded-lg border border-amber-200 p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{scheduled.length}</div>
          <div className="text-xs font-medium text-amber-600 mt-1">Scheduled</div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">All Blog Posts</h3>
        <div className="flex gap-2">
          <Link
            to="/blog"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-400 transition-colors flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Public Blog
          </Link>
          <Link
            to="/admin/blog"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:shadow-md transition-shadow flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" />
            Open Blog Manager
          </Link>
        </div>
      </div>

      {/* Posts list */}
      {posts.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-2">No blog posts yet</p>
          <Link
            to="/admin/blog"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:shadow-md transition-shadow mt-2"
          >
            <FileText className="w-4 h-4" />
            Create First Post
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((post) => (
            <div
              key={post.id}
              className="bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all p-4"
            >
              <div className="flex items-start gap-4">
                {post.featured_image_url ? (
                  <img
                    src={post.featured_image_url}
                    alt=""
                    className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-14 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ImageIcon className="w-5 h-5 text-slate-400" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-slate-900 truncate text-sm">{post.title}</h4>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] capitalize", statusBadge(post.status))}
                    >
                      {post.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{post.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {post.read_time}
                    </span>
                    {post.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(parseISO(post.published_at), "MMM d, yyyy")}
                      </span>
                    )}
                    {post.tags?.length > 0 && (
                      <span className="truncate">{post.tags.join(", ")}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <a
                    href={`/blog/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                    title="View post"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quick Links Bar ────────────────────────────────────────────────────────

// ─── Content Calendar View ──────────────────────────────────────────────────

function useContentCalendarData(brand: Brand) {
  return useQuery({
    queryKey: ["agent-calendar-all", brand],
    queryFn: async () => {
      // Pull from all content pipeline tables + tasks
      const [blogs, social, emails, calendar, tasks] = await Promise.all([
        db.from("agent_blog_posts").select("id, title, excerpt, body, status, publish_date, created_at, platform, featured_image_url").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_social_posts").select("id, caption, platform, post_type, status, scheduled_date, created_at, media_urls, assigned_to").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_email_campaigns").select("id, campaign_name, campaign_type, status, scheduled_date, created_at").eq("brand", brand).order("created_at", { ascending: false }).limit(200),
        db.from("agent_content_calendar").select("*").eq("brand", brand).order("date", { ascending: true }).limit(300),
        db.from("slack_agent_tasks").select("id, title, description, task_type, status, priority, assigned_to, created_at, updated_at, due_date, metadata").eq("brand", brand).order("created_at", { ascending: false }).limit(300),
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

function ContentCalendarView({ brand, filterMember }: { brand: Brand; filterMember?: string | null }) {
  const { data, isLoading } = useContentCalendarData(brand);
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [quickAdd, setQuickAdd] = useState<{ date: string; member: string | null } | null>(null);
  const [qaTitle, setQaTitle] = useState("");
  const [qaType, setQaType] = useState("social_post");
  const [qaPriority, setQaPriority] = useState("medium");
  const [qaAssignee, setQaAssignee] = useState<string>("trish");
  const [qaNotes, setQaNotes] = useState("");
  const [qaScript, setQaScript] = useState("");
  const [qaLinks, setQaLinks] = useState("");
  const [qaFiles, setQaFiles] = useState<File[]>([]);
  const [qaUploading, setQaUploading] = useState(false);
  const [ackChecks, setAckChecks] = useState<Record<string, boolean>>({});

  // Prefill assignee with whoever is currently filtered / who owns the clicked cell
  useEffect(() => {
    if (quickAdd?.member) setQaAssignee(quickAdd.member);
    else if (filterMember) setQaAssignee(filterMember);
  }, [quickAdd, filterMember]);

  const qaDetectType = (file: File): string => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
    return "file";
  };

  const qaParseLinks = (text: string) =>
    text.split(/[\n,\s]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)).map((url) => {
      let host = "link";
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      const label = host.includes("drive.google") ? "Google Drive"
        : host.includes("canva") ? "Canva"
        : host.includes("dropbox") ? "Dropbox"
        : host.includes("figma") ? "Figma"
        : host.includes("notion") ? "Notion"
        : host;
      return { url, name: label, type: "link" };
    });

  const createQuickTask = async () => {
    if (!quickAdd || !qaTitle.trim()) return;
    setQaUploading(true);
    try {
      const { data: inserted, error } = await (supabase as any)
        .from("slack_agent_tasks")
        .insert({
          brand,
          category: "marketing",
          title: qaTitle.trim(),
          task_type: qaType,
          status: "pending",
          priority: qaPriority,
          assigned_to: qaAssignee || quickAdd.member || null,
          description: qaNotes || null,
          due_date: new Date(quickAdd.date + "T10:00:00Z").toISOString(),
          metadata: { calendar_date: quickAdd.date, notes: qaScript || undefined },
        })
        .select("id, metadata")
        .single();
      if (error) { alert("Failed: " + error.message); setQaUploading(false); return; }

      const taskId = inserted.id;
      const uploaded: Array<{ url: string; name: string; type: string; size?: number }> = [];
      for (let i = 0; i < qaFiles.length; i++) {
        const file = qaFiles[i];
        const safeName = file.name.replace(/[^\w.-]+/g, "_");
        const path = `content-calendar/${taskId}-${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { alert(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
        const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
        uploaded.push({ url: urlData.publicUrl, name: file.name, type: qaDetectType(file), size: file.size });
      }
      const links = qaParseLinks(qaLinks);
      const all = [...uploaded, ...links];
      if (all.length > 0) {
        const firstImg = uploaded.find((a) => a.type === "image")?.url;
        const newMeta = { ...(inserted.metadata || {}), attachments: all, thumbnail_url: firstImg || null };
        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", taskId);
      }

      setQuickAdd(null);
      setQaTitle("");
      setQaNotes("");
      setQaScript("");
      setQaLinks("");
      setQaFiles([]);
      setQaType("social_post");
      setQaPriority("medium");
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
    } finally {
      setQaUploading(false);
    }
  };

  if (isLoading) return <div className="text-slate-500 text-center py-12">Loading calendar...</div>;

  const { blogs, social, emails, calendar, tasks } = data || { blogs: [], social: [], emails: [], calendar: [], tasks: [] };
  const totalItems = blogs.length + social.length + emails.length + calendar.length + tasks.length;

  if (totalItems === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
        <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 mb-2">No content in the pipeline yet</p>
        <p className="text-xs text-slate-400">
          Tell the agent: "@RP Marketing Agent build week 1 content pack for {BRAND_LABEL[brand]}"
        </p>
      </div>
    );
  }

  // Combine all content into a unified list
  type CalItem = { id: string; type: string; title: string; description?: string; fullText: string; status: string; date: string; platform?: string; assigned_to?: string; mediaUrl?: string | null; sourceTable: string; hashtags?: string[]; attachCount?: number };
  const allItems: CalItem[] = [];

  blogs.forEach((b: any) => allItems.push({ id: b.id, type: "blog", title: b.title || "Untitled", description: b.excerpt || "", fullText: b.excerpt || b.body?.slice(0, 300) || b.title || "", status: b.status, date: b.publish_date || b.created_at, platform: b.platform, assigned_to: "trish", mediaUrl: b.featured_image_url || null, sourceTable: "agent_blog_posts" }));
  social.forEach((s: any) => {
    const urls = s.media_urls;
    const thumb = Array.isArray(urls) && urls.length > 0 ? urls[0] : null;
    allItems.push({ id: s.id, type: "social", title: s.caption?.slice(0, 80) || "Untitled", description: s.caption || "", fullText: s.caption || "", status: s.status, date: s.scheduled_date || s.created_at, platform: s.platform, mediaUrl: thumb, assigned_to: s.assigned_to || null, sourceTable: "agent_social_posts", hashtags: s.hashtags || [], attachCount: Array.isArray(urls) ? urls.length : 0 });
  });
  emails.forEach((e: any) => allItems.push({ id: e.id, type: "email", title: e.campaign_name || "Untitled", fullText: e.campaign_name || "", status: e.status, date: e.scheduled_date || e.created_at, sourceTable: "agent_email_campaigns" }));
  calendar.forEach((c: any) => allItems.push({ id: c.id, type: c.content_type || "calendar", title: c.title || "Untitled", fullText: c.title || "", status: c.status, date: c.date, assigned_to: c.assigned_to, mediaUrl: c.media_url || null, sourceTable: "agent_content_calendar" }));

  const taskTypeMap: Record<string, string> = { blog_post: "blog", social_post: "social", email_campaign: "email", ad_campaign: "ad", design_request: "design", seo_task: "seo", dev_issue: "dev", dev_feature: "dev", dev_refactor: "dev", deployment: "dev" };
  tasks.forEach((t: any) => {
    const meta = t.metadata as any;
    const taskDate = meta?.calendar_date || t.due_date || t.updated_at || t.created_at;
    const attachments0 = Array.isArray(meta?.attachments) ? meta.attachments : [];
    // Fall back to a video attachment so video-only uploads still show a thumbnail on the card face.
    const thumb = meta?.thumbnail_url || meta?.media_url
      || attachments0.find((a: any) => a?.type === "image")?.url
      || attachments0.find((a: any) => a?.type === "video")?.url
      || null;
    const attachments = attachments0;
    const attachCount = attachments.length || (thumb ? 1 : 0);
    allItems.push({ id: t.id, type: taskTypeMap[t.task_type] || "calendar", title: t.title || "Untitled Task", description: t.description || "", fullText: t.description || t.title || "", status: t.status, date: taskDate, assigned_to: t.assigned_to, mediaUrl: thumb, sourceTable: "slack_agent_tasks", attachCount });
  });

  // Content type config
  const typeConfig: Record<string, { label: string; bg: string; text: string; dot: string; icon: any }> = {
    blog: { label: "Blog", bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", icon: FileText },
    social: { label: "Social", bg: "bg-pink-100", text: "text-pink-700", dot: "bg-pink-500", icon: Instagram },
    email: { label: "Email", bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500", icon: Mail },
    ad: { label: "Ad", bg: "bg-red-100", text: "text-red-700", dot: "bg-red-500", icon: Megaphone },
    design: { label: "Design", bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500", icon: Paintbrush },
    seo: { label: "SEO", bg: "bg-teal-100", text: "text-teal-700", dot: "bg-teal-500", icon: Sparkles },
    dev: { label: "Dev", bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-500", icon: Code2 },
    calendar: { label: "Task", bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500", icon: Calendar },
  };

  // Week grid
  const today = new Date();
  const baseMonday = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(baseMonday, i));
  const weekLabel = `${format(weekDays[0], "MMM d")} — ${format(weekDays[6], "MMM d, yyyy")}`;

  // Group items by date
  const itemsByDate: Record<string, CalItem[]> = {};
  allItems.forEach((item) => {
    const key = item.date ? item.date.slice(0, 10) : null;
    if (key) {
      if (!itemsByDate[key]) itemsByDate[key] = [];
      itemsByDate[key].push(item);
    }
  });

  // Determine visible team members — either filtered or all with content this week
  const weekKeys = weekDays.map((d) => format(d, "yyyy-MM-dd"));
  const weekItems = weekKeys.flatMap((k) => itemsByDate[k] || []);
  const activeMemberKeys = filterMember
    ? [filterMember]
    : [...new Set(weekItems.map((i) => i.assigned_to).filter(Boolean))] as string[];
  // Add "unassigned" row if items exist without assigned_to
  const hasUnassigned = weekItems.some((i) => !i.assigned_to);

  const filterName = filterMember ? TEAM[filterMember as keyof typeof TEAM]?.name : null;

  return (
    <div>
      {/* Add task button + summary */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button
          size="sm"
          onClick={() => setQuickAdd({ date: format(new Date(), "yyyy-MM-dd"), member: filterMember || null })}
          className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white text-xs gap-1.5 border-0 h-8"
        >
          <Plus className="w-3.5 h-3.5" /> Add Task ({BRAND_SHORT[brand]})
        </Button>
        <span className="text-xs text-slate-500">Or click any empty day cell to add for that date/person.</span>
      </div>

      {/* Summary bar */}
      <div className="flex gap-3 flex-wrap mb-4 items-center">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">
          <FileText className="w-3 h-3 mr-1" /> {blogs.length} Blogs
        </Badge>
        <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-300">
          <Instagram className="w-3 h-3 mr-1" /> {social.length} Social
        </Badge>
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
          <Mail className="w-3 h-3 mr-1" /> {emails.length} Emails
        </Badge>
        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-300">
          <CheckCircle2 className="w-3 h-3 mr-1" /> {tasks.length} Tasks
        </Badge>
        <span className="text-xs text-slate-400 ml-auto">{allItems.length} total items</span>
        {filterName && (
          <Badge className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white border-0 text-xs">
            Filtered: {filterName}
          </Badge>
        )}
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4 bg-white rounded-xl border border-slate-200 px-5 py-3 shadow-sm">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w - 1)}>
          ← Prev Week
        </Button>
        <div className="text-center">
          <div className="font-bold text-slate-900">{weekLabel}</div>
          <div className="text-xs text-slate-500">{weekItems.length} items this week</div>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs text-blue-600 hover:underline mt-0.5">
              Back to this week
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w + 1)}>
          Next Week →
        </Button>
      </div>

      {/* Team-lane calendar grid */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm overflow-x-auto">
       <div className="min-w-[900px]">
        {/* Header row — day columns */}
        <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-slate-200">
          <div className="px-3 py-2 bg-slate-50 border-r border-slate-200">
            <span className="text-xs font-bold text-slate-500 uppercase">Team Member</span>
          </div>
          {weekDays.map((day) => {
            const isTodayCol = isToday(day);
            return (
              <div key={format(day, "yyyy-MM-dd")} className={cn(
                "px-2 py-2 text-center border-r border-slate-100 last:border-r-0",
                isTodayCol ? "bg-blue-50" : "bg-slate-50"
              )}>
                <div className={cn("text-[10px] font-bold uppercase tracking-wider", isTodayCol ? "text-blue-600" : "text-slate-400")}>
                  {format(day, "EEE")}
                </div>
                <div className={cn("text-sm font-bold", isTodayCol ? "text-blue-700" : "text-slate-700")}>
                  {format(day, "MMM d")}
                </div>
                {isTodayCol && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mx-auto mt-1" />}
              </div>
            );
          })}
        </div>

        {/* Team member rows */}
        {activeMemberKeys.map((memberKey) => {
          const member = TEAM[memberKey as keyof typeof TEAM];
          if (!member) return null;

          return (
            <div key={memberKey} className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-slate-100 last:border-b-0 group/row">
              {/* Member sidebar */}
              <div className={cn("px-3 py-3 border-r border-slate-200 flex items-start gap-2.5")}>
                <div className="relative shrink-0">
                  <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-white shadow-sm", member.color)}>
                    {(() => { const Icon = member.icon; return <Icon className="w-4 h-4" />; })()}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-xs text-slate-900 truncate">{member.name.split(" ")[0]}</div>
                  <div className="text-[9px] text-slate-500 truncate">{member.title.split("—")[0].trim()}</div>
                </div>
              </div>

              {/* Day cells for this member */}
              {weekDays.map((day) => {
                const dateKey = format(day, "yyyy-MM-dd");
                const dayItems = (itemsByDate[dateKey] || []).filter((i) => i.assigned_to === memberKey);
                const isTodayCol = isToday(day);

                return (
                  <div
                    key={dateKey}
                    onClick={(e) => {
                      // Only trigger on blank area, not when clicking an item card
                      if ((e.target as HTMLElement).closest("[data-calendar-card]")) return;
                      setQuickAdd({ date: dateKey, member: memberKey });
                    }}
                    className={cn(
                      "px-1.5 py-2 border-r border-slate-50 last:border-r-0 min-h-[90px] cursor-pointer group/cell relative",
                      isTodayCol && "bg-blue-50/30",
                      "hover:bg-blue-50/40"
                    )}
                    title={`Click to add task for ${TEAM[memberKey as keyof typeof TEAM]?.name?.split(" ")[0] || ""} on ${dateKey}`}
                  >
                    {dayItems.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition pointer-events-none">
                        <div className="flex items-center gap-1 text-[10px] text-blue-500 font-medium bg-white/90 rounded-full px-2 py-0.5 border border-blue-200 shadow-sm">
                          <Plus className="w-2.5 h-2.5" /> Add task
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5 relative">
                      {dayItems.map((item) => {
                        const tc = typeConfig[item.type] || typeConfig.calendar;
                        const TypeIcon = tc.icon;
                        const isDone = ["completed", "published", "sent", "done"].includes(item.status);

                        const memberAssignee = item.assigned_to ? TEAM[item.assigned_to as keyof typeof TEAM] : null;
                        const borderClass = memberAssignee ? memberAssignee.cardBorder : "border-l-slate-300";
                        return (
                          <div key={item.id} data-calendar-card onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }} className={cn(
                            "rounded-md border border-l-4 overflow-hidden cursor-pointer hover:shadow-lg transition-all group/card bg-white",
                            borderClass,
                            isDone ? "opacity-80" : "",
                          )}>
                            {/* Thumbnail if available */}
                            {item.mediaUrl && (
                              /\.(mp4|mov|webm|avi)$/i.test(item.mediaUrl) ? (
                                <video src={item.mediaUrl} muted playsInline preload="metadata" className="w-full h-16 object-cover" />
                              ) : (
                                <img src={item.mediaUrl} alt="" className="w-full h-16 object-cover" loading="lazy" />
                              )
                            )}

                            <div className="p-1.5">
                              {/* Title with click-to-check checkbox */}
                              <div className="flex items-start gap-1.5">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newStatus = isDone ? "pending" : "completed";
                                    const table = item.sourceTable || "slack_agent_tasks";
                                    await (supabase as any).from(table).update({ status: newStatus }).eq("id", item.id);
                                    queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                                    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                                  }}
                                  title={isDone ? "Mark not done" : "Mark done"}
                                  className="mt-0.5 shrink-0"
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  ) : (
                                    <Circle className="w-3.5 h-3.5 text-slate-300 hover:text-emerald-500 transition-colors" />
                                  )}
                                </button>
                                <p className={cn(
                                  "text-[11px] font-medium leading-tight line-clamp-2",
                                  isDone ? "text-slate-400 line-through" : "text-slate-900"
                                )}>
                                  {item.title}
                                </p>
                              </div>

                              {/* Description — matches board card */}
                              {item.description && (
                                <p className="text-[9px] text-slate-500 mt-0.5 line-clamp-2 leading-tight">
                                  {item.description}
                                </p>
                              )}

                              {/* Type badge + attachment + status — matches board card layout */}
                              <div className="flex items-center justify-between gap-1 mt-1 flex-wrap">
                                <Badge variant="outline" className={cn("text-[8px] px-1 py-0 h-3.5 border-0", tc.bg, tc.text)}>
                                  <TypeIcon className="w-2 h-2 mr-0.5" />{tc.label}
                                </Badge>
                                <div className="flex items-center gap-1.5">
                                  {item.attachCount && item.attachCount > 0 ? (
                                    <span className="flex items-center gap-0.5 text-[8px] text-slate-400">
                                      <Paperclip className="w-2 h-2" />
                                      {item.attachCount}
                                    </span>
                                  ) : null}
                                  {isDone ? (
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                                  ) : (
                                    <Clock className="w-2.5 h-2.5 text-blue-400" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Unassigned row */}
        {hasUnassigned && (
          <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-slate-100">
            <div className="px-3 py-3 border-r border-slate-200 flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center">
                <Circle className="w-4 h-4 text-slate-400" />
              </div>
              <div>
                <div className="font-bold text-xs text-slate-500">Unassigned</div>
                <div className="text-[9px] text-slate-400">No team member</div>
              </div>
            </div>
            {weekDays.map((day) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayItems = (itemsByDate[dateKey] || []).filter((i) => !i.assigned_to);
              return (
                <div
                  key={dateKey}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-calendar-card]")) return;
                    setQuickAdd({ date: dateKey, member: null });
                  }}
                  className="px-1.5 py-2 border-r border-slate-50 last:border-r-0 min-h-[90px] cursor-pointer hover:bg-blue-50/40 group/cell relative"
                  title={`Click to add unassigned task on ${dateKey}`}
                >
                  {dayItems.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition pointer-events-none">
                      <div className="flex items-center gap-1 text-[10px] text-blue-500 font-medium bg-white/90 rounded-full px-2 py-0.5 border border-blue-200 shadow-sm">
                        <Plus className="w-2.5 h-2.5" /> Add task
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5 relative">
                    {dayItems.map((item) => {
                      const tc = typeConfig[item.type] || typeConfig.calendar;
                      const TypeIcon = tc.icon;
                      return (
                        <div key={item.id} data-calendar-card onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }} className="rounded-lg border border-slate-200 p-1.5 cursor-pointer hover:shadow-sm bg-white">
                          <Badge variant="outline" className={cn("text-[7px] px-1 py-0 h-3.5 border-0 mb-1", tc.bg, tc.text)}>
                            <TypeIcon className="w-2 h-2 mr-0.5" />{tc.label}
                          </Badge>
                          <p className="text-[10px] font-medium text-slate-700 line-clamp-2">{item.title}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
       </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap mt-4 pt-3">
        {Object.entries(typeConfig).map(([type, tc]) => {
          const Icon = tc.icon;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <div className={cn("w-2.5 h-2.5 rounded-full", tc.dot)} />
              <Icon className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] font-medium text-slate-500">{tc.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Detail Panel — opens when a card is clicked ─────────────── */}
      {selectedItem && (() => {
        const item = selectedItem as CalItem;
        const tc = typeConfig[item.type] || typeConfig.calendar;
        const TypeIcon = tc.icon;
        const assignee = item.assigned_to ? TEAM[item.assigned_to as keyof typeof TEAM] : null;
        const isDone = ["completed", "published", "sent", "done"].includes(item.status);
        const isVideo = /\.(mp4|mov|webm|avi)$/i.test(item.mediaUrl || "");

        return (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
            <div className="bg-white w-full sm:w-[380px] h-full shadow-2xl overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
              {assignee && <div className={cn("h-1.5 bg-gradient-to-r shrink-0", assignee.color)} />}

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-[10px] px-1.5 py-0 border-0", tc.bg, tc.text)}>
                    <TypeIcon className="w-3 h-3 mr-0.5" />{tc.label}
                  </Badge>
                  {item.platform && <Badge variant="outline" className="text-[10px] capitalize">{item.platform}</Badge>}
                  <Badge variant={isDone ? "default" : "secondary"} className="text-[10px]">{isDone ? "Done" : item.status}</Badge>
                </div>
                <button onClick={() => setSelectedItem(null)} className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>

              {/* Assignee + date (editable for tasks) */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-50 shrink-0">
                {assignee && (
                  <div className={cn("w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold shrink-0", assignee.color)}>
                    {assignee.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Assigned To</label>
                  {item.sourceTable === "slack_agent_tasks" || item.sourceTable === "agent_social_posts" ? (
                    <Select
                      value={item.assigned_to || ""}
                      onValueChange={async (val) => {
                        const table = item.sourceTable;
                        await (supabase as any).from(table).update({ assigned_to: val }).eq("id", item.id);
                        setSelectedItem({ ...item, assigned_to: val });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs bg-white border-slate-200"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        {getVisibleTeamEntries(brand).map(([key, m]) => (
                          <SelectItem key={key} value={key}>{m.emoji} {m.name.split(" ")[0]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-xs font-semibold text-slate-900">{assignee ? assignee.name : "Unassigned"}</div>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 shrink-0">{item.date?.slice(0, 10)}</div>
              </div>

              {/* Media gallery */}
              {item.mediaUrl && (
                <div className="px-4 pt-3 shrink-0">
                  {isVideo ? (
                    <video src={item.mediaUrl} controls className="w-full rounded-lg max-h-44 object-contain bg-black" />
                  ) : (
                    <img src={item.mediaUrl} alt="" className="w-full rounded-lg max-h-44 object-cover" />
                  )}
                </div>
              )}

              {/* Editable copy text */}
              <div className="px-4 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Copy (editable)</span>
                  <button onClick={() => { navigator.clipboard.writeText(item.fullText); }} className="text-[10px] text-blue-600 hover:underline font-medium">Copy Text</button>
                </div>
                <Textarea
                  key={item.id}
                  defaultValue={item.fullText}
                  className="text-xs min-h-[100px] font-normal leading-relaxed bg-white text-slate-900 border-slate-200"
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (item.sourceTable === "agent_social_posts") {
                      await (supabase as any).from("agent_social_posts").update({ caption: val }).eq("id", item.id);
                    } else if (item.sourceTable === "agent_content_calendar") {
                      await (supabase as any).from("agent_content_calendar").update({ title: val }).eq("id", item.id);
                    } else if (item.sourceTable === "slack_agent_tasks") {
                      await (supabase as any).from("slack_agent_tasks").update({ description: val }).eq("id", item.id);
                    } else if (item.sourceTable === "agent_email_campaigns") {
                      await (supabase as any).from("agent_email_campaigns").update({ campaign_name: val }).eq("id", item.id);
                    }
                    queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                  }}
                />
              </div>


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

              {/* Attachments list (for slack_agent_tasks with metadata.attachments) */}
              {(() => {
                const rawTask = (tasks as any[]).find((tk: any) => tk.id === item.id);
                const meta = rawTask?.metadata || {};
                const existing = Array.isArray(meta?.attachments) ? meta.attachments : [];
                const legacy: any[] = [];
                if (meta?.thumbnail_url && !existing.some((a: any) => a?.url === meta.thumbnail_url)) {
                  legacy.push({ url: meta.thumbnail_url, name: "thumbnail", type: "image" });
                }
                if (item.sourceTable === "agent_social_posts" && Array.isArray((rawTask as any)?.media_urls)) {
                  (rawTask as any).media_urls.forEach((u: string, i: number) => {
                    if (!existing.some((a: any) => a?.url === u)) {
                      legacy.push({ url: u, name: `media-${i + 1}`, type: "image" });
                    }
                  });
                }
                const all = [...existing, ...legacy];
                if (all.length === 0) return null;
                return (
                  <div className="px-4 pt-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                      <Paperclip className="w-3 h-3" /> Attachments ({all.length})
                    </div>
                    <div className="space-y-1">
                      {all.map((att: any, idx: number) => {
                        const url = att?.url;
                        const name = att?.name || `file-${idx + 1}`;
                        const type = att?.type || "file";
                        const isImg = type === "image" || /\.(png|jpe?g|gif|webp|svg)$/i.test(url || "");
                        const isVid = type === "video" || /\.(mp4|mov|webm|avi)$/i.test(url || "");
                        const isPdf = type === "pdf" || /\.pdf$/i.test(url || "");
                        return (
                          <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-200 p-1.5 bg-white">
                            <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                              {isImg ? (
                                <img src={url} alt={name} className="w-full h-full object-cover" loading="lazy" />
                              ) : isVid ? (
                                <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                              ) : isPdf ? (
                                <FileIcon className="w-3.5 h-3.5 text-red-500" />
                              ) : (
                                <FileIcon className="w-3.5 h-3.5 text-slate-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-medium text-slate-800 truncate">{name}</div>
                              <div className="text-[9px] uppercase tracking-wider text-slate-400">{isPdf ? "PDF" : isVid ? "Video" : isImg ? "Image" : "File"}</div>
                            </div>
                            <a href={url} target="_blank" rel="noopener noreferrer" download={name} title="Download" className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700">
                              <Download className="w-3 h-3" />
                            </a>
                            <button
                              title="Remove"
                              className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                              onClick={async () => {
                                if (!window.confirm(`Remove "${name}"?\n\nThis detaches it from the card.`)) return;
                                const tbl = item.sourceTable;
                                if (tbl === "slack_agent_tasks") {
                                  const cur = rawTask?.metadata || {};
                                  const atts = (Array.isArray(cur.attachments) ? cur.attachments : []).filter((a: any) => a?.url !== url);
                                  const newMeta: any = { ...cur, attachments: atts };
                                  if (newMeta.thumbnail_url === url) newMeta.thumbnail_url = atts.find((a: any) => a?.type === "image")?.url || null;
                                  if (newMeta.media_url === url) newMeta.media_url = null;
                                  await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", item.id);
                                } else if (tbl === "agent_social_posts") {
                                  const urls = (Array.isArray((rawTask as any)?.media_urls) ? (rawTask as any).media_urls : []).filter((u: string) => u !== url);
                                  await (supabase as any).from("agent_social_posts").update({ media_urls: urls }).eq("id", item.id);
                                } else if (tbl === "agent_content_calendar") {
                                  await (supabase as any).from("agent_content_calendar").update({ media_url: null }).eq("id", item.id);
                                }
                                setSelectedItem({ ...item, mediaUrl: item.mediaUrl === url ? null : item.mediaUrl });
                                queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                                queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Upload */}
              <div className="px-4 pt-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upload Content</span>
                <label className="flex items-center justify-center gap-1.5 mt-1 rounded-lg border border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors py-2 cursor-pointer text-slate-400 hover:text-blue-500">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">Add PDFs, images or videos</span>
                  <input
                    type="file"
                    accept="image/*,video/*,application/pdf,.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      const uploaded: any[] = [];
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const safeName = file.name.replace(/[^\w.-]+/g, "_");
                        const path = `content-calendar/${item.id}-${Date.now()}-${i}-${safeName}`;
                        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
                        if (upErr) continue;
                        const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
                        const t = file.type.startsWith("image/") ? "image"
                          : file.type.startsWith("video/") ? "video"
                          : (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) ? "pdf"
                          : "file";
                        uploaded.push({ url: urlData.publicUrl, name: file.name, type: t, size: file.size });
                      }
                      if (uploaded.length === 0) return;
                      const firstImageUrl = uploaded.find((a) => a.type === "image")?.url;
                      if (item.sourceTable === "slack_agent_tasks") {
                        const rawTask = (tasks as any[]).find((tk: any) => tk.id === item.id) || {};
                        const curMeta = rawTask.metadata || {};
                        const existing = Array.isArray(curMeta.attachments) ? curMeta.attachments : [];
                        const newMeta = {
                          ...curMeta,
                          attachments: [...existing, ...uploaded],
                          thumbnail_url: firstImageUrl || curMeta.thumbnail_url || uploaded[0].url,
                        };
                        await (supabase as any).from("slack_agent_tasks").update({ metadata: newMeta }).eq("id", item.id);
                      } else if (item.sourceTable === "agent_social_posts") {
                        const rawPost = (social as any[]).find((p: any) => p.id === item.id) || {};
                        const existingUrls = Array.isArray(rawPost.media_urls) ? rawPost.media_urls : [];
                        const newUrls = [...existingUrls, ...uploaded.filter((u: any) => u.type !== "pdf").map((u: any) => u.url)];
                        await (supabase as any).from("agent_social_posts").update({ media_urls: newUrls }).eq("id", item.id);
                      } else if (item.sourceTable === "agent_content_calendar") {
                        await (supabase as any).from("agent_content_calendar").update({ media_url: firstImageUrl || uploaded[0].url }).eq("id", item.id);
                      }
                      setSelectedItem({ ...item, mediaUrl: firstImageUrl || item.mediaUrl || uploaded[0].url });
                      queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                      (e.target as HTMLInputElement).value = "";
                    }}
                  />
                </label>
              </div>

              {/* Download primary media */}
              {item.mediaUrl && (
                <div className="px-4 pt-2">
                  <a href={item.mediaUrl} download target="_blank" rel="noopener noreferrer" className="inline-block">
                    <Button variant="outline" size="sm" className="text-[10px] h-7 px-2">⬇ Download Primary</Button>
                  </a>
                </div>
              )}

              {/* Contract sign-off (checkboxes + one-click sign) OR generic mark-complete */}
              {(() => {
                const rawTask = (tasks as any[]).find((tk: any) => tk.id === item.id);
                const tmeta = rawTask?.metadata || {};
                const isAgreement = /AGREEMENT/i.test(item.title || "");
                const isDoneNow = ["completed", "posted", "sent", "done"].includes(item.status);

                if (isAgreement) {
                  const terms = [
                    { k: "board", t: "I check off every card on its due date — the board is the record, no reminders." },
                    { k: "ads", t: "I run + design the Meta ads and post a weekly ads report every Friday." },
                    { k: "email", t: "I send the Thursday email from the pre-built draft (review & send)." },
                    { k: "terms", t: "If the board isn't green for 14 days (Jul 7–20), full scope ($5,000) ends — Option B is ads-only management + creation at $2,000/mo, or a 30-day wind-down." },
                  ];
                  const alreadySigned = !!tmeta.signed_at;
                  const allChecked = terms.every((x) => ackChecks[x.k]);
                  return (
                    <div className="px-4 pt-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Acknowledge &amp; Sign</div>
                        {alreadySigned ? (
                          <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <div className="text-[11px] text-emerald-800 font-semibold">
                              Signed by {tmeta.signed_by || "Jackson"} · {String(tmeta.signed_at).slice(0, 10)}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-1.5 mb-3">
                              {terms.map((x) => (
                                <label key={x.k} className="flex items-start gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!ackChecks[x.k]}
                                    onChange={(e) => setAckChecks((p) => ({ ...p, [x.k]: e.target.checked }))}
                                    className="mt-0.5 w-3.5 h-3.5 accent-pink-600 shrink-0"
                                  />
                                  <span className="text-[11px] text-slate-700 leading-tight">{x.t}</span>
                                </label>
                              ))}
                            </div>
                            <Button
                              size="sm"
                              disabled={!allChecked}
                              className="w-full h-8 text-xs bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white border-0 disabled:opacity-40"
                              onClick={async () => {
                                const signedAt = new Date().toISOString();
                                const newMeta = { ...tmeta, signed_by: "Jackson", signed_at: signedAt, acknowledged: true };
                                await (supabase as any).from("slack_agent_tasks")
                                  .update({ status: "completed", metadata: newMeta }).eq("id", item.id);
                                setSelectedItem({ ...item, status: "completed" });
                                queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                                queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                              }}
                            >
                              ✍️ Sign &amp; Agree {allChecked ? "" : "(check all boxes)"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }

                // Generic task: upload work above, then mark complete here
                return (
                  <div className="px-4 pt-3">
                    <Button
                      size="sm"
                      variant={isDoneNow ? "outline" : "default"}
                      className={cn("w-full h-8 text-xs", isDoneNow ? "border-emerald-300 text-emerald-700" : "bg-emerald-600 hover:bg-emerald-700 text-white")}
                      onClick={async () => {
                        const newStatus = isDoneNow ? "pending" : "completed";
                        await (supabase as any).from(item.sourceTable || "slack_agent_tasks")
                          .update({ status: newStatus }).eq("id", item.id);
                        setSelectedItem({ ...item, status: newStatus });
                        queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                      }}
                    >
                      {isDoneNow ? (<><Circle className="w-3 h-3 mr-1" /> Mark not done</>) : (<><CheckCircle2 className="w-3 h-3 mr-1" /> Mark complete</>)}
                    </Button>
                  </div>
                );
              })()}

              <div className="flex-1" />

              {/* Delete */}
              <div className="px-4 py-3 border-t border-slate-100 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-7 w-full border-red-200 text-red-600 hover:bg-red-50"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${item.title}"?\n\nThis cannot be undone.`)) return;
                    const { error } = await (supabase as any)
                      .from(item.sourceTable)
                      .delete()
                      .eq("id", item.id);
                    if (error) {
                      alert(`Delete failed: ${error.message}`);
                      return;
                    }
                    queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
                    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
                    setSelectedItem(null);
                  }}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Task Dialog (same rich form as Board) */}
      <Dialog
        open={!!quickAdd}
        onOpenChange={(o) => { if (!o && !qaUploading) setQuickAdd(null); }}
      >
        <DialogContent className="bg-white w-[90vw] sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900 text-sm">
              Add Task — {BRAND_SHORT[brand]}
              {quickAdd?.date && <span className="ml-1 text-slate-400 font-normal text-xs">on {quickAdd.date}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Title *</label>
              <Input autoFocus value={qaTitle} onChange={(e) => setQaTitle(e.target.value)} placeholder="Task title..." className="mt-1 bg-white text-slate-900 border-slate-200" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Assign To *</label>
                <Select value={qaAssignee} onValueChange={setQaAssignee}>
                  <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getVisibleTeamEntries(brand).map(([key, m]) => (
                      <SelectItem key={key} value={key}>{m.emoji} {m.name.split(" ")[0]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Priority</label>
                <Select value={qaPriority} onValueChange={setQaPriority}>
                  <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Type</label>
              <Select value={qaType} onValueChange={setQaType}>
                <SelectTrigger className="mt-1 h-9 bg-white text-slate-900 border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blog_post">Blog</SelectItem>
                  <SelectItem value="social_post">Social</SelectItem>
                  <SelectItem value="email_campaign">Email</SelectItem>
                  <SelectItem value="ad_campaign">Ad</SelectItem>
                  <SelectItem value="design_request">Design</SelectItem>
                  <SelectItem value="seo_task">SEO</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Content Copy / Caption</label>
              <Textarea value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} placeholder="The finished caption/copy." className="mt-1 h-20 bg-white text-slate-900 border-slate-200 text-xs" />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Script / Notes / Instructions</label>
              <Textarea
                value={qaScript}
                onChange={(e) => setQaScript(e.target.value)}
                placeholder={"Full script, shot list, production notes..."}
                className="mt-1 min-h-[140px] bg-amber-50/40 text-slate-900 border-amber-200 font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Links — Templates, Drive, Canva, Figma, Dropbox</label>
              <Textarea
                value={qaLinks}
                onChange={(e) => setQaLinks(e.target.value)}
                placeholder={"Paste one or more links (one per line)"}
                className="mt-1 h-14 bg-white text-slate-900 border-slate-200 text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center justify-between">
                <span>Upload Templates / Assets / Collateral</span>
                <span className="text-[9px] text-slate-400 font-normal normal-case">PDF · PNG · JPG · MP4 · MOV</span>
              </label>
              <label className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition py-2.5 cursor-pointer text-slate-500 hover:text-blue-600">
                <Plus className="w-4 h-4" />
                <span className="text-xs font-medium">Choose files (multiple OK)</span>
                <input
                  type="file"
                  accept="image/*,video/*,application/pdf,.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) setQaFiles((prev) => [...prev, ...files]);
                    (e.target as HTMLInputElement).value = "";
                  }}
                />
              </label>
              {qaFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {qaFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 p-1.5 bg-white">
                      <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                        {qaDetectType(f) === "image" ? <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                          : qaDetectType(f) === "video" ? <Video className="w-3.5 h-3.5 text-slate-500" />
                          : qaDetectType(f) === "pdf" ? <FileIcon className="w-3.5 h-3.5 text-red-500" />
                          : <FileIcon className="w-3.5 h-3.5 text-slate-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-800 truncate">{f.name}</div>
                        <div className="text-[9px] uppercase tracking-wider text-slate-400">{(f.size / 1024).toFixed(0)} KB · {qaDetectType(f)}</div>
                      </div>
                      <button type="button" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                        onClick={() => setQaFiles((prev) => prev.filter((_, idx) => idx !== i))} title="Remove">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setQuickAdd(null)} disabled={qaUploading}>Cancel</Button>
            <Button size="sm" onClick={createQuickTask} disabled={qaUploading || !qaTitle.trim()} className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white border-0">
              {qaUploading ? "Creating & uploading..." : "Add Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Quick Links ────────────────────────────────────────────────────────────

function QuickLinksBar({ isWpwTenant = false }: { isWpwTenant?: boolean }) {
  const links = [
    ...(isWpwTenant
      ? [
          {
            to: "/from/weprintwraps",
            label: "WPW Founder Offer",
            icon: Gift,
            gradient: "from-cyan-500 to-fuchsia-500",
          },
          {
            to: "/admin/wpw-founder-assets",
            label: "Founder Page Assets",
            icon: ImageIcon,
            gradient: "from-blue-500 to-fuchsia-500",
          },
          {
            to: "/admin/wpw-founder-campaign",
            label: "Send Founder Campaign",
            icon: Megaphone,
            gradient: "from-fuchsia-500 to-blue-500",
          },
        ]
      : []),
    {
      // THE approval queue — approve = scheduled = published (IG/FB/WrapTV site/email)
      to: "/admin/content-director",
      label: "Content Director",
      icon: CheckCircle2,
      gradient: "from-blue-600 to-pink-600",
    },
    {
      // Every piece of content across the ecosystem, sorted by type/template/brand
      to: "/admin/brand-board",
      label: "Brand Board",
      icon: LayoutGrid,
      gradient: "from-fuchsia-500 to-amber-500",
    },
    { to: "/admin/marketing-agent", label: "Marketing Agent", icon: Sparkles, gradient: "from-blue-500 to-pink-500" },
    { to: "/admin/blog", label: "Blog Manager", icon: FileText, gradient: "from-emerald-500 to-green-600" },
    { to: "/admin/content-studio", label: "Content Studio", icon: Paintbrush, gradient: "from-purple-500 to-pink-500" },
    { to: "/admin/composer", label: "Composer", icon: Sparkles, gradient: "from-blue-500 to-purple-500" },
    { to: "/admin/script-studio", label: "Script Studio (Transcripts)", icon: Film, gradient: "from-indigo-500 to-violet-500" },
    { to: "/admin/ads-launch-pack", label: "Ads Launch Pack", icon: Rocket, gradient: "from-neutral-900 to-neutral-700" },
    { to: "/admin/mightymail", label: "MightyMail", icon: Mail, gradient: "from-orange-500 to-red-500" },
    { to: "/admin/email-campaigns", label: "Email Campaigns", icon: Megaphone, gradient: "from-blue-500 to-cyan-500" },
    { to: "/admin/gallery", label: "Gallery", icon: ImageIcon, gradient: "from-emerald-500 to-teal-500" },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500" />
        <h2 className="text-sm font-semibold text-slate-700">Quick Access</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r hover:shadow-md transition-shadow flex items-center gap-1.5",
                link.gradient,
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Recommendations ────────────────────────────────────────────────────────

function RecommendationsView() {
  const { data: recs = [] } = useRecommendations();

  if (recs.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
        <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500">No recommendations yet</p>
        <p className="text-xs text-slate-400 mt-2">
          The agent will post ideas and opportunities here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recs.map((rec: any) => (
        <Card key={rec.id} className="p-4 bg-white hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs capitalize">
                  {rec.category}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {rec.brand}
                </Badge>
              </div>
              <h4 className="font-semibold text-slate-900">{rec.title}</h4>
              <p className="text-sm text-slate-600 mt-1">{rec.description}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <Badge variant="secondary" className="text-xs">
              {rec.status}
            </Badge>
            {rec.source && (
              <span className="text-xs text-slate-400">Source: {rec.source}</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Video Production (native RestylePro Video Studio) ─────────────────────
// The old wrapcommandai.com launcher was retired (2026-07): heavy media
// production now runs natively on the RestylePro pipeline (drive-sync →
// video-auto-assemble → video-captions/video-music → video-render → ffmpeg
// worker). VideoStudio is the Engine Room front door to it.

function VideoProductionView() {
  return <VideoStudio />;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AdminMarketingHub({ tenantMode }: { tenantMode?: TenantMode } = {}) {
  const isWpwTenant = tenantMode === "wpw";
  // In WPW-tenant mode, brand is locked — the WPW team should never see RestylePro data.
  const [brand, setBrand] = useState<Brand>(isWpwTenant ? "weprintwraps" : "restylepro");
  const [category, setCategory] = useState<Category>("marketing");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  // WPW content ops runs off the day-by-day schedule, so open on the calendar
  // (Mon/Tue/Wed…) instead of the status-pile Kanban. RP keeps the board default.
  // Deep-link support: /engine-room?tab=video opens the Video Studio tab
  // directly (so the "one-button auto-build" links land on Auto-Build, not
  // the task board). Valid values match the TabsTrigger values below.
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const VALID_TABS = ["board", "calendar", "channels", "blog", "ideas", "video", "assets"];
  const [activeTab, setActiveTab] = useState(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : (isWpwTenant ? "calendar" : "board")
  );
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [issueSheetOpen, setIssueSheetOpen] = useState(false);
  const queryClient = useQueryClient();

  // Figure out the current user — only owners (Trish/tdill) get the
  // cross-tenant "Switch View" button so WPW team members can never
  // land on the RP Engine Room by accident.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUserEmail(session?.user?.email ?? null);
    })();
  }, []);
  const showSwitcher = isOwner(currentUserEmail);

  // Fetch task counts per team member for the directory badges
  const { data: allTasks = [] } = useQuery({
    queryKey: ["agent-tasks-all", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("slack_agent_tasks")
        .select("assigned_to, status")
        .eq("brand", brand);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allTasks.forEach((t: any) => {
      if (t.assigned_to) counts[t.assigned_to] = (counts[t.assigned_to] || 0) + 1;
    });
    return counts;
  }, [allTasks]);

  const handleMemberClick = (key: string) => {
    if (!key || key === selectedMember) {
      setSelectedMember(null);
    } else {
      setSelectedMember(key);
      // Jump to Calendar if not already on Board or Calendar
      if (activeTab !== "board" && activeTab !== "calendar") {
        setActiveTab("calendar");
      }
    }
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["agent-social-posts"] });
    queryClient.invalidateQueries({ queryKey: ["agent-calendar-all"] });
    queryClient.invalidateQueries({ queryKey: ["agent-recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["marketing-hub-blog-posts"] });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto px-6 pt-4"><MarketingSystemMap page="hub" /></div>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-7 rounded-full bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500" />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                  {isWpwTenant ? "WPW Engine Room" : "The Engine Room"}
                </h1>
              </div>
              <p className="text-sm font-medium text-slate-500 mt-1 tracking-wide">
                {isWpwTenant ? "WEPRINTWRAPS — INTERNAL TEAM" : "DESIGN. OUTPUT. PROFIT."}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link to="/admin/content-director">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs font-semibold gap-1.5 border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Content Director
                </Button>
              </Link>

              {/* Owner-only cross-tenant switcher — hidden from the WPW team */}
              {showSwitcher && (
                isWpwTenant ? (
                  <Link to="/engine-room">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white text-xs font-semibold border-0 hover:opacity-90 gap-1.5"
                    >
                      ← RP Engine Room
                    </Button>
                  </Link>
                ) : (
                  <Link to="/wpw/engine-room">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-semibold border-0 hover:opacity-90 gap-1.5"
                    >
                      WPW Engine Room →
                    </Button>
                  </Link>
                )
              )}

              {/* Brand Toggle — hidden in WPW-tenant mode (brand is locked to WPW) */}
              {!isWpwTenant && (
                <Select value={brand} onValueChange={(v) => setBrand(v as Brand)}>
                  <SelectTrigger className="w-[200px] bg-white border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Brand dots render from THE registry (src/lib/content-tags.ts
                        BRAND_META.gradient) — these values started here, so the
                        registry mirrors them; reading from it means SocialIQ,
                        Brand Board and this switcher can never disagree again. */}
                    {([
                      ["restylepro", "RestyleProAi.com"],
                      ["weprintwraps", "WePrintWraps.com"],
                      ["designproai", "DesignProAI.com"],
                      ["wraptv", "Wrap TV World"],
                      ["inkandedge", "Ink & Edge"],
                      ["creatormarket", "CreatorMarket"],
                    ] as const).map(([slug, label]) => (
                      <SelectItem key={slug} value={slug}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${brandMeta(slug).gradient}`} />
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {isWpwTenant && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-600" />
                  <span className="text-xs font-semibold text-purple-700">WePrintWraps.com</span>
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => setIssueSheetOpen(true)}
                className="text-xs font-semibold gap-1.5 border-pink-200 text-pink-700 hover:bg-pink-50"
              >
                <Bug className="w-3.5 h-3.5" /> Report Issue
              </Button>

              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Brand gradient accent */}
          <div className="mt-4 h-1 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <TeamDirectory
          onMemberClick={handleMemberClick}
          selectedMember={selectedMember}
          taskCounts={taskCounts}
          brand={brand}
        />
        <div className="mb-6">
          <MarketingSuiteGuide />
        </div>
        <QuickLinksBar isWpwTenant={isWpwTenant} />

        {/* Urgent bug reports from users + team — copy straight into Claude */}
        <EngineRoomUrgentReportsCard />

        {/* Category Tabs — Marketing vs Dev */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setCategory("marketing")}
            className={cn(
              "px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2",
              category === "marketing"
                ? "bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white shadow-md"
                : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400",
            )}
          >
            <Megaphone className="w-4 h-4" />
            Marketing Tasks
          </button>
          <button
            onClick={() => setCategory("dev")}
            className={cn(
              "px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2",
              category === "dev"
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md"
                : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400",
            )}
          >
            <Code2 className="w-4 h-4" />
            Dev Tasks
          </button>

          {/* Active member filter indicator */}
          {selectedMember && TEAM[selectedMember as keyof typeof TEAM] && (
            <div className={cn(
              "ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border",
              TEAM[selectedMember as keyof typeof TEAM].bg,
              TEAM[selectedMember as keyof typeof TEAM].border,
            )}>
              <div className={cn("w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center text-[9px] font-bold text-white", TEAM[selectedMember as keyof typeof TEAM].color)}>
                {TEAM[selectedMember as keyof typeof TEAM].name.charAt(0)}
              </div>
              <span className={cn("text-xs font-semibold", TEAM[selectedMember as keyof typeof TEAM].text)}>
                {TEAM[selectedMember as keyof typeof TEAM].name.split(" ")[0]}'s Tasks
              </span>
              <button onClick={() => setSelectedMember(null)} className="text-xs text-slate-400 hover:text-slate-700 ml-1">✕</button>
            </div>
          )}
        </div>

        {/* Member series summary banner */}
        {selectedMember && MEMBER_SERIES[selectedMember] && TEAM[selectedMember as keyof typeof TEAM] && (() => {
          const member = TEAM[selectedMember as keyof typeof TEAM];
          const series = MEMBER_SERIES[selectedMember];
          return (
            <div className={cn("rounded-xl border p-4 mb-4", member.bg, member.border)}>
              <div className="flex items-start gap-3">
                <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-lg font-bold shrink-0", member.color)}>
                  {member.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-bold", member.text)}>{member.name} — Non-Negotiable Duties</div>
                  <div className="text-[11px] text-slate-600 mb-3">{member.title} · this is the standing duty sheet — the cards &amp; calendar below are this week's actual instances</div>
                  {series.some((s) => s.cadence) ? (
                    <div className="space-y-3">
                      {[
                        { key: "daily", label: "📌 Daily — every weekday" },
                        { key: "weekly", label: "🔁 Weekly — non-negotiable, by day" },
                        { key: "monthly", label: "🗓️ Monthly — non-negotiable" },
                      ].map((g) => {
                        const items = series.filter((s) => s.cadence === g.key);
                        if (!items.length) return null;
                        return (
                          <div key={g.key}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{g.label}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {items.map((s, i) => (
                                <div key={i} className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                  <div className={cn("text-xs font-bold mb-0.5", member.text)}>{s.name}</div>
                                  <div className="text-[10px] text-slate-500 leading-tight">{s.desc}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {series.map((s, i) => (
                        <div key={i} className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={cn("text-xs font-bold", member.text)}>{s.name}</span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5">{s.frequency}</Badge>
                          </div>
                          <div className="text-[10px] text-slate-500 leading-tight">{s.desc}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Is anything actually running? Built after a day when the parser had
            been dead 12 days and nothing anywhere said so. */}
        <div className="mb-4"><PipelineHealthCard /></div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="board">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Board
            </TabsTrigger>
            {/* The layer above content management: what we're SAYING and
                whether it's carried everywhere. */}
            <TabsTrigger value="narrative">
              <Target className="w-4 h-4 mr-2" />
              Narrative
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <Calendar className="w-4 h-4 mr-2" />
              30-Day Calendar
            </TabsTrigger>
            <TabsTrigger value="channels">
              <LayoutGrid className="w-4 h-4 mr-2" />
              Channels
            </TabsTrigger>
            <TabsTrigger value="blog">
              <FileText className="w-4 h-4 mr-2" />
              Blog
            </TabsTrigger>
            <TabsTrigger value="ideas">
              <Sparkles className="w-4 h-4 mr-2" />
              Ideas
            </TabsTrigger>
            <TabsTrigger value="video">
              <Film className="w-4 h-4 mr-2" />
              Video Studio
            </TabsTrigger>
            <TabsTrigger value="assets">
              <FolderOpen className="w-4 h-4 mr-2" />
              Asset Library
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="mt-4">
            <TaskKanban brand={brand} category={category} initialFilterMember={selectedMember} />
          </TabsContent>

          <TabsContent value="narrative" className="mt-4">
            <NarrativeBoard brand={brand} />
          </TabsContent>

          <TabsContent value="calendar" className="mt-4">
            <ContentCalendarView brand={brand} filterMember={selectedMember} />
          </TabsContent>

          <TabsContent value="channels" className="mt-4">
            <ChannelsView brand={brand} />
          </TabsContent>

          <TabsContent value="blog" className="mt-4">
            <BlogOverviewTab />
          </TabsContent>

          <TabsContent value="ideas" className="mt-4">
            <RecommendationsView />
          </TabsContent>

          <TabsContent value="video" className="mt-4">
            <VideoProductionView />
          </TabsContent>

          <TabsContent value="assets" className="mt-4">
            <AssetLibrary />
          </TabsContent>
        </Tabs>
      </div>

      <EngineRoomIssueReporter
        open={issueSheetOpen}
        onOpenChange={setIssueSheetOpen}
        brand={brand}
        currentUserEmail={currentUserEmail}
        isWpwTenant={isWpwTenant}
      />
    </div>
  );
}
