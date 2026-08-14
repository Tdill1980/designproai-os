/**
 * AdminBrandBoard — every piece of content in the ecosystem, as visual cards.
 *
 * White UI (Marketing Hub standard). One board, four lenses:
 *  - By Content Type — colored tabs: Email, Blog, Landing Page, Text, SEO,
 *    Reels, Shorts, Story, YouTube Longform, X, FB, IG, Substack, LinkedIn,
 *    Pinterest, Reddit.
 *  - By Template — Canva Template, Reel/Short 9:16, Story 9:16, Feed Post,
 *    Carousel, Longform 16:9, Email/Newsletter, Blog Article, Landing Page,
 *    Ad Creative, Text/Copy.
 *  - By Brand — the ecosystem: WePrintWraps, RestyleProAI, DesignProAI,
 *    WrapTVWorld, Ink & Edge, CreatorMarket (colors from content-tags).
 *  - Calendar — month grid with thumbnails (Later-style).
 *
 * The board AGGREGATES — it pulls every made piece from the whole marketing
 * system: the agent pipeline (slack_agent_tasks, agent_social_posts,
 * agent_blog_posts, agent_email_campaigns, agent_sms_campaigns,
 * agent_content_calendar), SEO (seo_blog_posts, seo_pages), the site blog
 * (blog_posts), MightyMail (email_templates, email_campaigns), affiliate kits
 * (affiliate_marketing_assets), rendered videos (video_render_jobs), Content
 * Studio templates (social_templates), ContentDirectorIQ (content_concepts,
 * content_hooks), standing series (marketing_standing_tasks), and WrapTV
 * (wraptv_site_content).
 *
 * Cards are media-forward with the copy/text right on the card. The detail
 * dialog is the "place for text": sources whose RLS allows authenticated
 * updates (the agent pipeline tables) are edited INLINE and saved back;
 * everything else shows its copy read-only with a "Refine in <tool>" link to
 * the surface that owns it. Creation still happens in the maker tools — this
 * board is the single view across all of them.
 */

import {
  splitFinished, IDEA_SOURCES, emptyFinishedReason, posterFor, hasPlayableVideo,
} from "@/lib/brandBoardFinished";
import {
  groupByMedia, summarizeGroups, groupingLine, groupBadge,
} from "@/lib/brandBoardDedupe";
import {
  summarizeQueue, queueLabel, progressFor, statusLabel, isFailed, isDone,
  type QueuedJob,
} from "@/lib/queuedWork";
import {
  readReview, buildReviewPatch, isWinner, RATING_MIN, RATING_MAX, WINNER_RATING,
  type PieceVerdict,
} from "@/lib/pieceReview";
import {
  buildSets, setSummary, searchSets,
  type ContentSet, type SetInput, type SetPiece, type PieceState,
} from "@/lib/contentSets";
import { type ChannelKey } from "@/lib/contentDoctrine";
import { buildSitePost, buildYouTubeDraft, youtubeNotice } from "@/lib/wraptvPublish";
import VideoFanOutButton from "@/components/marketing/VideoFanOutButton";
import { isMadeContent, parseBrandBoardCardParam } from "@/lib/contentOsRouting";
import { getCanvaBrandBoardLink } from "@/lib/canvaBrandBoard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Mail,
  FileText,
  LayoutGrid,
  Type,
  Search,
  Film,
  Video,
  Camera,
  Youtube,
  Twitter,
  Facebook,
  Instagram,
  Radio,
  Linkedin,
  Pin,
  MessageCircle,
  Circle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Paintbrush,
  Images,
  Clock,
  CheckCircle2,
  Bot,
  Layers,
  ExternalLink,
  Play,
  X,
  Upload,
  AlertTriangle,
} from "lucide-react";
import {
  format,
  parseISO,
  isToday,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  addDays,
  addMonths,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
// Aliased because two components below do `const { toast } = useToast()`, which
// SHADOWS this import inside them. useToast's toast is the shadcn `toast(props)`
// function — it has no `.error`/`.success`, so `toast.error(...)` in that scope
// is a runtime TypeError, not a compile error (strict mode is off and neither
// `build` nor `lint` typechecks). That shipped once, on both WrapTVWorld
// buttons. Use `notify.*` inside any component that destructures useToast.
// Locked by `tests/video-fan-out.test.ts`.
import { toast, toast as notify } from "sonner";
import { brandMeta, teamFor, tint } from "@/lib/content-tags";
import { thumbnailUrl } from "@/lib/storage-thumbnail";
import EmailDesignPreview, { LandingPagePreview } from "@/components/admin/EmailDesignPreview";
import MarketingSystemMap from "@/components/admin/MarketingSystemMap";
import BrandBoardUploadDialog from "@/components/admin/BrandBoardUploadDialog";
import CaptionAiPanel from "@/components/admin/CaptionAiPanel";
import EditorBrainPanel from "@/components/admin/EditorBrainPanel";
import { adaptEditorBrain } from "@/lib/editorBrainAdapter";
import { useContentApprover } from "@/hooks/useContentApprover";
import {
  buildLegacyApprovalPatch,
  buildLegacyRejectPatch,
  isLegacyUpload,
  isPendingApproval,
} from "@/lib/brandBoardUpload";
import AttentionRibbon from "@/components/brandboard/AttentionRibbon";
import ProvenanceFilter from "@/components/brandboard/ProvenanceFilter";
import BrandBoardShowActions from "@/components/brandboard/BrandBoardShowActions";
import YouTubeConnectionButton from "@/components/brandboard/YouTubeConnectionButton";
// The show catalogue, so a show is named the same here as in the router and
// the editor. Importing rather than restating: a second label table would
// drift, and the board would call an episode something the editor does not.
import { SHOW_FORMATS } from "@/lib/showFormats";
import StuckReasons from "@/components/brandboard/StuckReasons";
import {
  isMachineFailure, machineFailure, failureLabel, failureReasons, FAILURE_META,
  provenanceOptions, personOptions, matchesPerson, showOptions, unshownCount,
} from "@/components/brandboard/boardProvenance";
import CardCover from "@/components/brandboard/CardCover";
import CardSignals, { TileSignal } from "@/components/brandboard/CardSignals";
import {
  countLanes, laneOf, publishReality, summarizeFootage, matchBrandInterest,
  META_CONNECTION_PLATFORM, isPastDue, LANE_BY_KEY,
  type Lane, type FootageSignal,
} from "@/components/brandboard/boardAttention";
import {
  indexSpineByJob,
  boardTypeForKind,
  boardTemplateForKind,
  piecesSummary,
  PIECE_LABEL,
  type JobSpine,
  type VideoPieceKind,
} from "@/lib/brandBoardPieces";

const db = supabase as any;

// ─── Content types (the 16 colored tabs, in the requested order) ─────────────

const TYPE_META = {
  email: { label: "Email", color: "#7C3AED", icon: Mail },
  blog: { label: "Blog", color: "#10B981", icon: FileText },
  landing: { label: "Landing Page", color: "#0EA5E9", icon: LayoutGrid },
  text: { label: "Text", color: "#64748B", icon: Type },
  seo: { label: "SEO", color: "#14B8A6", icon: Search },
  reels: { label: "Reels", color: "#F43F5E", icon: Film },
  shorts: { label: "Shorts", color: "#FF0000", icon: Video },
  story: { label: "Story", color: "#F59E0B", icon: Camera },
  youtube: { label: "Longform YouTube", color: "#991B1B", icon: Youtube },
  x: { label: "X", color: "#0F172A", icon: Twitter },
  fb: { label: "Facebook", color: "#1877F2", icon: Facebook },
  ig: { label: "Instagram", color: "#E1306C", icon: Instagram },
  substack: { label: "Substack", color: "#FF6719", icon: Radio },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: Linkedin },
  pinterest: { label: "Pinterest", color: "#E60023", icon: Pin },
  reddit: { label: "Reddit", color: "#FF4500", icon: MessageCircle },
  other: { label: "Other", color: "#94A3B8", icon: Circle },
} as const;

type TypeKey = keyof typeof TYPE_META;
const TYPE_ORDER: TypeKey[] = [
  "email", "blog", "landing", "text", "seo", "reels", "shorts", "story",
  "youtube", "x", "fb", "ig", "substack", "linkedin", "pinterest", "reddit", "other",
];

// ─── Template types ──────────────────────────────────────────────────────────

const TEMPLATE_META = {
  canva: { label: "Canva Template", color: "#8B5CF6", icon: Paintbrush },
  studio: { label: "Studio Template", color: "#D946EF", icon: Paintbrush },
  reel916: { label: "Reel / Short 9:16", color: "#F43F5E", icon: Film },
  story916: { label: "Story 9:16", color: "#F59E0B", icon: Camera },
  feed: { label: "Feed Post", color: "#3B82F6", icon: Instagram },
  carousel: { label: "Carousel", color: "#06B6D4", icon: Images },
  longform: { label: "Longform 16:9", color: "#991B1B", icon: Youtube },
  newsletter: { label: "Email / Newsletter", color: "#7C3AED", icon: Mail },
  emailtpl: { label: "Email Template", color: "#A78BFA", icon: Mail },
  article: { label: "Blog Article", color: "#10B981", icon: FileText },
  landing: { label: "Landing Page", color: "#0EA5E9", icon: LayoutGrid },
  ad: { label: "Ad Creative", color: "#EF4444", icon: Megaphone },
  sms: { label: "SMS / Text", color: "#475569", icon: MessageCircle },
  copy: { label: "Text / Copy", color: "#64748B", icon: Type },
} as const;

type TemplateKey = keyof typeof TEMPLATE_META;
const TEMPLATE_ORDER = Object.keys(TEMPLATE_META) as TemplateKey[];

// ─── Ecosystem brands (colors match content-tags BRAND_META) ─────────────────

const BOARD_BRANDS: Record<string, { label: string; color: string }> = {
  weprintwraps: { label: "WePrintWraps", color: brandMeta("weprintwraps").color },
  restylepro: { label: "RestyleProAI", color: brandMeta("restylepro").color },
  designproai: { label: "DesignProAI", color: brandMeta("designproai").color },
  wraptvworld: { label: "WrapTVWorld", color: brandMeta("wraptvworld").color },
  inkandedge: { label: "Ink & Edge", color: brandMeta("inkandedge").color },
  creatormarket: { label: "CreatorMarket", color: "#22C55E" },
  thewrap: { label: "The Wrap", color: brandMeta("thewrap").color },
};
const BRAND_KEYS = Object.keys(BOARD_BRANDS);

function normalizeBrand(raw?: string | null): string {
  const s = (raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "restylepro";
  if (s.includes("wraptv")) return "wraptvworld";
  if (s.includes("inkandedge") || s.includes("inkedge")) return "inkandedge";
  if (s.includes("designpro")) return "designproai";
  if (s.includes("creatormarket")) return "creatormarket";
  if (s.includes("weprintwraps") || s === "wpw") return "weprintwraps";
  if (s.includes("restylepro")) return "restylepro";
  if (s.includes("thewrap")) return "thewrap";
  return s in BOARD_BRANDS ? s : "restylepro";
}

function brandFromEmail(email?: string | null): string {
  const s = (email || "").toLowerCase();
  if (s.includes("restylepro")) return "restylepro";
  return "weprintwraps";
}

// ─── Where each piece is refined/edited ──────────────────────────────────────
// editField = the column saved inline from this board (RLS allows
// authenticated UPDATE on the agent pipeline tables). Sources without an
// editField are read-only here and deep-link to the tool that owns them.

// perRowPath  → append /<id>            (e.g. /admin/seo/blog/<id>)
// perRowQuery → append ?<key>=<id>       (e.g. /engine-room?tab=video&render=<id>)
// A source with NEITHER lands on the bare page — fine for a manager view, but
// WRONG for a render: "Refine" on a specific video must open THAT video.
const SOURCE_CONFIG: Record<string, { label: string; editField?: string; editorPath?: string; editorLabel?: string; perRowPath?: boolean; perRowQuery?: string }> = {
  slack_agent_tasks: { label: "Engine Room card", editField: "description", editorPath: "/admin/marketing-hub", editorLabel: "Engine Room" },
  // perRowQuery lands ON this post in the Director queue. Without it, "Edit"
  // dropped you on 200 cards with no way to find the designed piece you just
  // clicked — which is what "view ai design should allow us to edit" meant.
  agent_social_posts: { label: "Social post", editField: "caption", editorPath: "/admin/content-director", editorLabel: "Content Director", perRowQuery: "post" },
  agent_blog_posts: { label: "Blog draft", editField: "excerpt", editorPath: "/admin/blog", editorLabel: "Blog Manager" },
  agent_email_campaigns: { label: "Email campaign", editField: "subject_line", editorPath: "/admin/mightymail", editorLabel: "MightyMail" },
  agent_sms_campaigns: { label: "SMS campaign", editField: "message_template" },
  agent_content_calendar: { label: "Planned content", editField: "notes", editorPath: "/admin/marketing-hub?tab=calendar", editorLabel: "Hub Calendar" },
  seo_blog_posts: { label: "SEO blog post", editorPath: "/admin/seo/blog", editorLabel: "SEO Blog Editor", perRowPath: true },
  seo_pages: { label: "SEO page", editorPath: "/admin/seo/blog", editorLabel: "SEO Manager" },
  blog_posts: { label: "Site blog post", editorPath: "/admin/blog", editorLabel: "Blog Manager" },
  email_templates: { label: "Email template", editorPath: "/admin/mightymail", editorLabel: "MightyMail" },
  email_campaigns: { label: "Email campaign", editorPath: "/admin/mightymail", editorLabel: "MightyMail" },
  affiliate_marketing_assets: { label: "Affiliate asset", editorPath: "/admin/affiliate-content", editorLabel: "Affiliate Content" },
  // Opens the Cut Editor ON THIS RENDER. /admin/creator dropped you on the
  // whole studio with no way to find the video you clicked.
  video_render_jobs: { label: "Rendered video", editorPath: "/engine-room?tab=video", editorLabel: "Cut Editor", perRowQuery: "render" },
  social_templates: { label: "Studio template", editorPath: "/admin/content-studio", editorLabel: "Content Studio" },
  content_concepts: { label: "Content concept", editorPath: "/admin/content-director", editorLabel: "Content Director" },
  content_hooks: { label: "Hook", editorPath: "/admin/hooks", editorLabel: "Hooks Manager" },
  marketing_standing_tasks: { label: "Standing series", editorPath: "/admin/marketing-hub", editorLabel: "Engine Room" },
  wraptv_site_content: { label: "WrapTV episode", editorPath: "/admin/content-director", editorLabel: "Content Director" },
};

// ─── Classification ──────────────────────────────────────────────────────────

/** Keyword scan used for rows whose only signal is text. */
function typeFromText(text: string): TypeKey | null {
  const s = text.toLowerCase();
  if (/landing\s*page|landing/.test(s)) return "landing";
  if (/\bseo\b/.test(s)) return "seo";
  if (/\breels?\b/.test(s)) return "reels";
  if (/\bshorts?\b/.test(s)) return "shorts";
  if (/\bstor(y|ies)\b/.test(s)) return "story";
  if (/longform|youtube|wrap\s*tv|wraptv/.test(s)) return "youtube";
  if (/substack/.test(s)) return "substack";
  if (/linkedin/.test(s)) return "linkedin";
  if (/pinterest/.test(s)) return "pinterest";
  if (/reddit/.test(s)) return "reddit";
  if (/twitter|\bx\s*post\b|\(x\)/.test(s)) return "x";
  if (/facebook|\bfb\b/.test(s)) return "fb";
  if (/instagram|\big\b|insta/.test(s)) return "ig";
  if (/\bsms\b|text\s*message/.test(s)) return "text";
  if (/newsletter|email/.test(s)) return "email";
  if (/blog/.test(s)) return "blog";
  return null;
}

function typeFromPlatform(platform?: string | null): TypeKey | null {
  const p = (platform || "").toLowerCase();
  if (!p) return null;
  if (p.includes("substack")) return "substack";
  if (p === "x" || p.includes("twitter")) return "x";
  if (p.includes("linkedin")) return "linkedin";
  if (p.includes("pinterest")) return "pinterest";
  if (p.includes("reddit")) return "reddit";
  if (p.includes("youtube") || p.includes("wraptv")) return "youtube";
  if (p.includes("facebook")) return "fb";
  if (p.includes("instagram")) return "ig";
  if (p.includes("email")) return "email";
  return null;
}

function typeForSocialPost(p: any): TypeKey {
  const platform = (p.platform || "").toLowerCase();
  const postType = (p.post_type || "").toLowerCase();
  // Landing pages / websites are first-class board citizens — without this
  // they fell into the gray "other" bucket and read as missing (owner:
  // "landing page is not in Brand Board").
  if (postType.includes("landing") || postType.includes("website") || postType === "page" || postType === "webpage") return "landing";
  if (platform.includes("youtube") || platform.includes("wraptv")) {
    return postType.includes("reel") || postType.includes("short") ? "shorts" : "youtube";
  }
  if (postType.includes("reel")) return "reels";
  if (postType.includes("story")) return "story";
  const byPlatform = typeFromPlatform(platform);
  if (byPlatform) return byPlatform;
  if (postType.includes("text") || !(p.media_urls || []).length) return "text";
  return "other";
}

/**
 * Which DOCTRINE channel a social row runs on — or null when there isn't one.
 *
 * This is deliberately NOT `typeForSocialPost`. That function answers "which
 * coloured tab does this card live under" and has an `other` bucket to catch
 * everything; a set grid answers "which of the eleven channels got made", and
 * a wrong answer there is worse than no answer. Filing a Reddit post under
 * Instagram because Instagram was the nearest match would show a channel as
 * COVERED when nothing was ever made for it — the one lie this whole screen
 * exists to prevent. So an unmapped platform returns null and `buildSets`
 * leaves it out of the grid entirely; the channel then reads `missing`, which
 * is the truth.
 *
 * The one real branch is YouTube: the platform alone cannot tell a Short from
 * a longform, and they are two separate channels with two separate hook rules
 * (contentDoctrine). `post_type` carries that, so it decides.
 */
function channelForSocialPost(p: any): ChannelKey | null {
  const platform = String(p?.platform || "").toLowerCase();
  const postType = String(p?.post_type || "").toLowerCase();
  if (!platform) return null;
  if (platform.includes("youtube") || platform.includes("wraptv")) {
    return postType.includes("short") || postType.includes("reel") ? "youtube_short" : "youtube";
  }
  if (platform.includes("instagram")) return "instagram";
  if (platform.includes("facebook")) return "facebook";
  if (platform.includes("tiktok")) return "tiktok";
  if (platform.includes("linkedin")) return "linkedin";
  if (platform.includes("pinterest")) return "pinterest";
  if (platform.includes("substack")) return "substack";
  if (platform.includes("threads")) return "threads";
  if (platform === "x" || platform.includes("twitter")) return "x";
  if (platform.includes("email")) return "email";
  if (platform.includes("blog")) return "blog";
  // reddit, landing pages, anything new — no doctrine channel, so no guess.
  return null;
}

function typeForTask(t: any): TypeKey {
  const haystack = `${t.task_type || ""} ${t.title || ""} ${JSON.stringify(t.metadata || {})}`;
  const byType: Record<string, TypeKey> = {
    blog_post: "blog",
    email_campaign: "email",
    seo_task: "seo",
  };
  if (byType[t.task_type]) return byType[t.task_type];
  return typeFromText(haystack) || (t.task_type === "social_post" ? "ig" : "other");
}

function templateFor(row: any, type: TypeKey): TemplateKey {
  if (row.canva_design_id || row.canva_template_thumbnail_url) return "canva";
  const postType = (row.post_type || row.format || "").toLowerCase();
  if (postType.includes("carousel")) return "carousel";
  if (type === "reels" || type === "shorts") return "reel916";
  if (type === "story") return "story916";
  if (type === "youtube") return "longform";
  if (type === "email" || type === "substack") return "newsletter";
  if (type === "blog") return "article";
  if (type === "landing") return "landing";
  if (row.task_type === "ad_campaign") return "ad";
  if (type === "text") return "copy";
  if (type === "seo") return "copy";
  if (["x", "fb", "ig", "linkedin", "pinterest", "reddit"].includes(type)) return "feed";
  return "copy";
}

// ─── Unified card model ──────────────────────────────────────────────────────

interface BoardCard {
  id: string;
  source: string;
  brand: string;
  type: TypeKey;
  template: TemplateKey;
  title: string;
  text: string;
  status: string;
  date: string | null;
  thumb: string | null;
  mediaUrl: string | null;
  /** All attached media — carousels render a slide strip, not one static. */
  mediaUrls?: string[];
  /** Durable Canva identity; temporary edit links are refreshed on click. */
  canvaDesignId?: string | null;
  isVideo: boolean;
  /** The canonical source cut that production/editor actions operate on. */
  renderJobId?: string | null;
  /** For a render card: what this cut became on the spine, and what it did not. */
  spine?: JobSpine | null;
  /** Which of the four pieces THIS card is. Absent on non-spine cards. */
  pieceKind?: VideoPieceKind | null;
  assignedTo: string | null;
  /**
   * The rendered email DESIGN (agent_email_campaigns.body_html). Present on
   * email cards so the board can show the piece itself rather than its subject
   * line. Rendered in a locked-down sandboxed iframe — see EmailDesignPreview.
   */
  html?: string | null;
  /** A landing page's live URL — the only thing that can show that piece. */
  url?: string | null;
  /** Row metadata, where the source has it — carries the Klaviyo build stamp. */
  meta: Record<string, any> | null;
  /**
   * The editor brain's verdict for the cut behind this card — `mismatch`,
   * `no_beats`, or absent. A refusal means this is a ONE-CLIP STUB rendered on
   * purpose so a human could judge it, NOT an edit; on a grid of thumbnails the
   * two are identical, which is why it has to travel on the card.
   */
  brainStatus?: string | null;
  /** The pipeline's own sentence explaining the stub. Printed verbatim. */
  stubReason?: string | null;
  /**
   * `blueprint.kind` — `static_post` means a single frame yanked out of a video
   * with text drawn on it. 49 of 140 completed renders. It is not film, and on
   * a grid of thumbnails it is indistinguishable from film.
   */
  renderKind?: string | null;
  /** `edit_kind` — `stub` means one clip start to end, i.e. nothing was cut. */
  editKind?: string | null;
  /** What made this: `blueprint.source` on a render, `created_by` on a post. */
  provenance?: string | null;
  /** `blueprint.show_format` — a SHOW_FORMATS key, or null, which is common. */
  showFormat?: string | null;
  /** A named human, only where the row records one. Never inferred. */
  person?: string | null;
  /** The idea behind it — part of the tile's group identity, see brandBoardDedupe. */
  ideaKey?: string | null;
  /** Best-scoring moment in the SOURCE FOOTAGE. Never a claim about the cut. */
  footage?: FootageSignal | null;
  /** Is a render in flight / a creative composing for this card? */
  building?: boolean;
}

/**
 * The first REAL image in a media list.
 *
 * This used to end in `|| urls[0]`, which handed back whatever was first even
 * when it was a video. A post whose only media is an mp4 then set that mp4 as
 * the card's `thumb`, and `<img src="…mp4">` paints NOTHING while still
 * downloading the whole file — live examples on this board are 23 MB and
 * 38 MB. That is why finished work showed as blank cards: the picture was a
 * broken image tag, not missing data.
 *
 * No fallback now. No image means no image, and the card shows its copy panel
 * with the type icon instead — which is honest and free.
 */
function firstImage(urls?: string[] | null): string | null {
  if (!Array.isArray(urls)) return null;
  return urls.find((u) => typeof u === "string" && /\.(png|jpe?g|gif|webp|avif)($|\?)/i.test(u)) || null;
}

/**
 * Rows out of one of the board's ~18 source queries.
 *
 * This used to be `r?.data || []` — which swallowed EVERY query error. A
 * source that failed (RLS refusing it, a renamed column, a timeout) returned
 * zero rows and was indistinguishable from a source that was genuinely empty,
 * so the board just went quiet. "All the content is gone" and "that table has
 * nothing in it" rendered identically, with nothing on screen to tell them
 * apart. Errors are collected now and shown (see SourceErrors below).
 */
const data = (r: any) => r?.data || [];

/** Which sources failed, in query order, so a silent failure can't hide. */
const SOURCE_NAMES = [
  "agent_blog_posts", "agent_social_posts", "agent_email_campaigns",
  "agent_content_calendar", "slack_agent_tasks", "agent_sms_campaigns",
  "seo_blog_posts", "seo_pages", "blog_posts", "email_templates",
  "email_campaigns", "affiliate_marketing_assets", "video_render_jobs",
  "social_templates", "content_concepts", "content_hooks",
  "marketing_standing_tasks", "wraptv_site_content",
  "content_artifacts", "content_narratives",
  // Appended, never inserted: this list is POSITIONAL against the Promise.all
  // results and renumbering it would mis-attribute every failure above.
  "tenant_site_connections", "media_sources", "shot_list_items",
];

export interface SourceFailure { source: string; message: string }

function collectFailures(results: any[]): SourceFailure[] {
  const out: SourceFailure[] = [];
  results.forEach((r, i) => {
    if (r?.error) out.push({ source: SOURCE_NAMES[i] || `source ${i}`, message: String(r.error.message || r.error) });
  });
  return out;
}

function useBrandBoardData() {
  return useQuery({
    queryKey: ["brand-board-all"],
    queryFn: async () => {
      const results = await Promise.all([
        db.from("agent_blog_posts").select("id, brand, title, excerpt, body, status, publish_date, created_at, featured_image_url").order("created_at", { ascending: false }).limit(400),
        // `created_by` is the provenance the owner asked for and the board had
        // never selected: idea_approve 113 · agent 88 · content-director 58 ·
        // bulk-ad-generator 35 · … (measured 2026-08-07). Without it "whose is
        // this" was answerable only by recognising a thumbnail.
        db.from("agent_social_posts").select("id, brand, caption, platform, post_type, status, scheduled_date, posted_date, created_at, updated_at, media_urls, canva_design_id, canva_template_thumbnail_url, generation_meta, created_by").order("created_at", { ascending: false }).limit(500),
        // body_html is the DESIGN. Without it an email card could only show its
        // name and subject ("just showing the text of the email") even though
        // 186 of 210 campaigns store their rendered HTML right here.
        db.from("agent_email_campaigns").select("id, brand, campaign_name, subject_line, preview_text, body_html, status, scheduled_date, created_at, klaviyo_campaign_id").order("created_at", { ascending: false }).limit(400),
        db.from("agent_content_calendar").select("*").order("date", { ascending: false }).limit(400),
        db.from("slack_agent_tasks").select("*").order("created_at", { ascending: false }).limit(1000),
        db.from("agent_sms_campaigns").select("id, brand, name, message_template, status, sent_at, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("seo_blog_posts").select("id, title, excerpt, focus_keyword, status, featured_image_url, published_at, created_at").order("created_at", { ascending: false }).limit(300),
        db.from("seo_pages").select("id, url, page_type, current_title, current_meta_description, ai_suggested_meta_description, is_active, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("blog_posts").select("id, title, description, status, featured_image_url, published_at, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("email_templates").select("id, slug, name, description, subject, category, from_email, is_active, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(300),
        db.from("email_campaigns").select("id, name, subject, status, from_email, scheduled_at, sent_at, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("affiliate_marketing_assets").select("id, title, description, asset_type, file_url, thumbnail_url, platform, caption_template, created_at").order("created_at", { ascending: false }).limit(300),
        db.from("video_render_jobs").select("id, brand, source_ref, blueprint, music_url, status, final_url, thumbnail_url, created_at").order("created_at", { ascending: false }).limit(300),
        db.from("social_templates").select("id, brand, name, description, format, thumbnail_url, is_active, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(200),
        db.from("content_concepts").select("id, brand, platform, output_format, title, angle, status, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("content_hooks").select("id, brand, hook_text, text, hook_type, active, created_at").order("created_at", { ascending: false }).limit(200),
        db.from("marketing_standing_tasks").select("id, brand, task_type, title, description, cadence, is_active, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(200),
        db.from("wraptv_site_content").select("id, brand, title, caption, media_url, thumbnail_url, media_type, status, published_at, created_at").order("created_at", { ascending: false }).limit(200),
        // The narrative spine. Without these two the board could not see a
        // single piece the fan-out made: a 9:16 cut IS both the Reel and the
        // Short, and both artifacts point at the same render row, so the board
        // showed one card and the Short had nowhere to appear.
        db.from("content_artifacts").select("narrative_id, kind, target_table, target_id, title, status, produced_by").order("created_at", { ascending: false }).limit(2000),
        db.from("content_narratives").select("id, brand, topic").order("created_at", { ascending: false }).limit(500),
        // CAN ANYTHING ACTUALLY PUBLISH? Facebook and Instagram both dispatch
        // through one stored Meta connection; without it `content-deploy`
        // throws before it reaches the API. Measured 2026-08-07: no such row
        // exists, and 0 of 358 posts have ever published. `config` is
        // deliberately NOT selected — it holds page access tokens and the RLS
        // policy on this table is `USING true`, so pulling it would hand a
        // token to every authenticated browser for a banner.
        db.from("tenant_site_connections").select("platform, is_active"),
        // The footage catalogue, for the viral signal. Small (481 rows) and
        // only two columns; the moments themselves are fetched below, keyed to
        // just the sources this board's renders actually reference.
        db.from("media_sources").select("id, storage_url").limit(1000),
        // WHOSE CARDS. "I dont see jacksons cards add a sort by team member"
        // (owner, 2026-08-07). The person is REAL, not inferred from a pipeline
        // key: 92 of 102 shot-list items name `responsible_person = "Jackson
        // (camera)"`, and `render_job_id` links three of them to the exact
        // three `shot_list` renders on this board. 102 rows, five columns.
        db.from("shot_list_items").select("id, render_job_id, responsible_person, on_camera_person, shot_title").limit(500),
      ]);

      // A failed source must never look like an empty one.
      const failures = collectFailures(results);

      const [
        blogs, social, emails, calendar, tasks,
        sms, seoBlogs, seoPages, siteBlogs, emailTpls, emailCamps,
        affiliateAssets, videos, socialTpls, concepts, hooks, standing, wraptv,
        artifacts, narratives, connections, mediaSources, shotListItems,
      ] = results;

      // Render job → the human responsible for the footage it was cut from.
      // Only rows that actually record one contribute; nothing is inferred.
      const personByJob = new Map<string, string>();
      for (const s of data(shotListItems)) {
        const job = String(s?.render_job_id || "");
        const who = String(s?.responsible_person || "").trim();
        if (job && who) personByJob.set(job, who);
      }

      // ── THE VIRAL SIGNAL ────────────────────────────────────────────────────
      //
      // A cut's footage reaches its scored moments through
      //   blueprint.scenes[].clipUrl → media_sources.storage_url
      //                              → content_moments.source_id
      // which resolves for 80 of the 130 jobs that have scenes (measured
      // 2026-08-07). The other 50 get nothing and say nothing.
      //
      // Fetched as a SECOND round keyed to the sources actually referenced,
      // because `content_moments` holds 11,675 rows and pulling them all to
      // decorate 130 cards would cost more than the whole rest of this board.
      const sourceIdByClip = new Map<string, string>();
      for (const ms of data(mediaSources)) {
        const url = String(ms?.storage_url || "").split("?")[0];
        if (url && ms?.id) sourceIdByClip.set(url, String(ms.id));
      }
      const clipsByJob = new Map<string, Set<string>>();
      const neededSources = new Set<string>();
      for (const v of data(videos)) {
        const scenes = Array.isArray(v?.blueprint?.scenes) ? v.blueprint.scenes : [];
        for (const s of scenes) {
          const clip = String(s?.clipUrl || "").split("?")[0];
          if (!clip) continue;
          const sid = sourceIdByClip.get(clip);
          if (!sid) continue;
          if (!clipsByJob.has(String(v.id))) clipsByJob.set(String(v.id), new Set());
          clipsByJob.get(String(v.id))!.add(sid);
          neededSources.add(sid);
        }
      }

      let momentsBySource = new Map<string, any[]>();
      if (neededSources.size) {
        const { data: moments } = await db
          .from("content_moments")
          .select("source_id, hook_score, soundbite_score, broll_score, verbatim_quote")
          .in("source_id", [...neededSources])
          .not("hook_score", "is", null)
          .limit(4000);
        for (const m of moments || []) {
          const sid = String(m?.source_id || "");
          if (!sid) continue;
          if (!momentsBySource.has(sid)) momentsBySource.set(sid, []);
          momentsBySource.get(sid)!.push(m);
        }
      }
      const footageForJob = (jobId: string): FootageSignal | null => {
        const sources = clipsByJob.get(String(jobId));
        if (!sources?.size) return null;
        const rows: any[] = [];
        for (const sid of sources) rows.push(...(momentsBySource.get(sid) || []));
        return summarizeFootage(rows);
      };

      // What each finished render actually became on the spine. Built once,
      // read per video row below.
      //
      // `canvaMappedBrands` is deliberately NOT passed: RLS on
      // `brand_canva_templates` grants service_role only, so a browser read is
      // empty whether or not a template is mapped, and passing that empty read
      // would print "no Canva template is mapped" as fact on every card.
      const spineByJob = indexSpineByJob(data(artifacts), data(narratives));

      // Hide duplicates: Engine Room cards and calendar rows that merely POINT
      // at a piece already on the board (Content Studio / Social Batch /
      // Content Review mirrors carry social_post_id / post_ids / pipeline_id
      // in their metadata) would show the same content twice — the real
      // pipeline row is the publishable truth, so it wins and the mirror hides.
      const pipelineIds = new Set<string>(
        [...data(social), ...data(blogs), ...data(emails)].map((r: any) => r.id),
      );

      const cards: BoardCard[] = [];
      const push = (c: Partial<BoardCard> & { id: string; source: string; type: TypeKey; title: string }) =>
        cards.push({
          brand: "restylepro",
          template: "copy",
          text: "",
          status: "draft",
          date: null,
          thumb: null,
          mediaUrl: null,
          isVideo: false,
          assignedTo: null,
          meta: null,
          ...c,
        } as BoardCard);

      for (const b of data(blogs)) {
        push({
          id: b.id, source: "agent_blog_posts", brand: normalizeBrand(b.brand),
          type: "blog", template: "article",
          title: b.title || "Untitled blog post",
          text: b.excerpt || b.body || "",
          status: b.status || "draft",
          date: b.publish_date || b.created_at,
          thumb: b.featured_image_url || null,
        });
      }

      // POSTERS FOR VIDEO POSTS. A post whose only media is an .mp4 had no
      // thumbnail, so its card rendered a blank player — the row of empty
      // squares behind "every thumbnail shows image". The renders already
      // carry posters (73 of 73 complete jobs do); they were simply never
      // joined to the post that points at them.
      const posterByFinalUrl = new Map<string, string>();
      const jobByFinalUrl = new Map<string, string>();
      for (const v of data(videos)) {
        if (v.final_url && v.thumbnail_url) posterByFinalUrl.set(String(v.final_url), String(v.thumbnail_url));
        if (v.final_url && v.id) jobByFinalUrl.set(String(v.final_url), String(v.id));
      }
      const renderJobFor = (urls?: string[] | null): string | null => {
        for (const u of urls || []) { const hit = u && jobByFinalUrl.get(String(u)); if (hit) return hit; }
        return null;
      };
      const renderPoster = (urls?: string[] | null): string | null => {
        for (const u of urls || []) {
          const hit = u && posterByFinalUrl.get(String(u));
          if (hit) return hit;
        }
        return null;
      };

      for (const p of data(social)) {
        const type = typeForSocialPost(p);
        const thumb = p.canva_template_thumbnail_url || firstImage(p.media_urls) || renderPoster(p.media_urls);
        push({
          id: p.id, source: "agent_social_posts", brand: normalizeBrand(p.brand),
          type, template: templateFor(p, type),
          title: (p.caption || "").split("\n")[0] || `${p.platform || "Social"} post`,
          text: p.caption || "",
          status: p.status || "draft",
          // Back-catalog uploads are dated by when they ORIGINALLY ran, not by
          // when someone got round to uploading them — otherwise a 2024 reel
          // lands on today's calendar square.
          date: p.posted_date || p.generation_meta?.original_posted_at || p.scheduled_date || p.created_at,
          thumb,
          mediaUrl: (p.media_urls || [])[0] || thumb,
          mediaUrls: (p.media_urls || []).filter(Boolean),
          canvaDesignId: p.canva_design_id || p.generation_meta?.canva?.design_id || null,
          isVideo: /\.(mp4|mov|webm)($|\?)/i.test((p.media_urls || [])[0] || ""),
          // A show-output card retains the ORIGINAL source cut so editing the
          // human-entered BTI credit makes a revision from source rather than
          // recursively re-editing the already-rendered Reel. Ordinary posts
          // still resolve their render from the attached media URL.
          renderJobId: p.generation_meta?.source_render_job || renderJobFor(p.media_urls),
          // Carries the upload's provenance + intended_state, which is what
          // the approve control reads.
          meta: p.generation_meta || null,
          showFormat: p.generation_meta?.show_format || null,
          // WHAT MADE IT, and WHOSE it is. Both were already stored and neither
          // reached a tile.
          provenance: p.created_by || p.generation_meta?.source || null,
          person: p.created_by || null,
          // THE IDEA. A frame-grab still gets reused across unrelated ideas, so
          // the file alone is not the tile's identity — see brandBoardDedupe.
          // Live example: one .jpg carrying five posts from idea 7f559895 and
          // one from a different idea entirely, merged into a tile that claimed
          // seven pieces and opened on one post.
          ideaKey: p.generation_meta?.idea_id || null,
          // IS THIS A MACHINE FAILURE WEARING A THUMBNAIL? 46 posts carry a
          // stub creative (45 of them with media), and every one of those was
          // sitting in Finished Work looking like finished work. The creative's
          // own fields say so; the board simply never read them.
          editKind: p.generation_meta?.creative_edit_kind
            || p.generation_meta?.sourced_edit_kind || null,
          // TWO SHAPES, ONE VERDICT. `sourced_editor_brain.status` is what a
          // post carries when a creative was SOURCED for it. But a refusal no
          // longer produces a creative at all — the runner writes the card and
          // stops — and for those it records the verdict at the TOP level, as
          // `editor_brain_status` / `edit_stub_reason`, the same two names the
          // render-job push reads off a blueprint.
          //
          // Read only the sourced path and every refusal card reports `null`,
          // `laneOf` never sees `brainRefused`, and the piece lands in Waiting
          // — reading as "a human must decide" when the pipeline has already
          // decided and is explaining why. Both halves shipped correct and the
          // join between them was the gap.
          brainStatus: p.generation_meta?.editor_brain_status
            || p.generation_meta?.sourced_editor_brain?.status || null,
          stubReason: p.generation_meta?.edit_stub_reason
            || p.generation_meta?.creative_edit_stub_reason
            || p.generation_meta?.sourced_edit_stub_reason || null,
          // A post whose creative is still composing is BUILDING, not waiting
          // on a human — same rule the queue uses. Filing it under "needs you"
          // is what makes somebody press the button again and buy a second
          // render.
          building: !!p.generation_meta?.pending_render_job_id
            && !(p.media_urls || []).filter(Boolean).length,
        });
      }

      for (const e of data(emails)) {
        // ONLY A DESIGNED EMAIL BELONGS ON AN APPROVAL BOARD.
        //
        // Owner, 2026-08-10: "Only content ready for design approval are
        // allowed on brand board … if it's text then it should be in the other
        // location intent director."
        //
        // An email's artwork is its HTML, and `isMadeContent` now knows that
        // (`hasEmailDesign`). Measured the same day: of 194 campaigns carrying
        // body_html, TEN had a layout and 184 were a bare copy fragment — and
        // all 194 sat here, where 184 of them could not be design-approved
        // because there was no design to approve.
        //
        // The rule is IMPORTED, never restated. `contentOsRouting` is the one
        // place that decides which surface owns a card, and the Director reads
        // the same function — so the two pages cannot disagree and nothing can
        // fall between them.
        if (!isMadeContent({ kind: "email_campaign", body_html: e.body_html })) continue;
        push({
          id: e.id, source: "agent_email_campaigns", brand: normalizeBrand(e.brand),
          type: "email", template: "newsletter",
          title: e.campaign_name || e.subject_line || "Email campaign",
          text: e.subject_line || e.preview_text || "",
          status: e.status || "draft",
          date: e.scheduled_date || e.created_at,
          // The DESIGN, so the card renders the email instead of its subject
          // line. Only 9 of 210 campaigns carry a klaviyo_campaign_id, so
          // "View in Klaviyo" was never a general answer to "let me see it" —
          // body_html is, and it is present on 186.
          html: e.body_html || null,
          meta: e.klaviyo_campaign_id ? { klaviyo_campaign_id: e.klaviyo_campaign_id } : null,
        });
      }

      for (const c of data(calendar)) {
        if (c.pipeline_id && pipelineIds.has(c.pipeline_id)) continue; // mirror of a piece already on the board
        const type = typeFromText(`${c.content_type || ""} ${c.title || ""}`) || "other";
        push({
          id: c.id, source: "agent_content_calendar", brand: normalizeBrand(c.brand),
          type, template: templateFor(c, type),
          title: c.title || c.content_type || "Planned content",
          text: c.notes || "",
          status: c.status || "planned",
          date: c.date,
          assignedTo: c.assigned_to || null,
        });
      }

      for (const t of data(tasks)) {
        // Content only — dev tasks stay in the Engine Room.
        if (t.category === "dev") continue;
        const meta = t.metadata || {};
        const mirrorRefs = [meta.social_post_id, meta.source_post_id, ...(Array.isArray(meta.post_ids) ? meta.post_ids : [])].filter(Boolean);
        if (mirrorRefs.some((id: string) => pipelineIds.has(id))) continue; // mirror of a piece already on the board
        const type = typeForTask(t);
        const attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
        push({
          id: t.id, source: "slack_agent_tasks", brand: normalizeBrand(t.brand),
          type, template: templateFor(t, type),
          title: t.title || "Untitled",
          text: t.description || meta.notes || "",
          status: t.status || "pending",
          date: t.due_date || t.created_at,
          thumb: meta.thumbnail_url || attachments.find((a: any) => a?.type === "image")?.url || null,
          assignedTo: t.assigned_to || t.created_by || null,
          person: t.assigned_to || t.created_by || null,
          meta,
        });
      }

      for (const s of data(sms)) {
        push({
          id: s.id, source: "agent_sms_campaigns", brand: normalizeBrand(s.brand),
          type: "text", template: "sms",
          title: s.name || "SMS campaign",
          text: s.message_template || "",
          status: s.status || "draft",
          date: s.sent_at || s.created_at,
        });
      }

      for (const b of data(seoBlogs)) {
        push({
          id: b.id, source: "seo_blog_posts", brand: "weprintwraps",
          type: "seo", template: "article",
          title: b.title || "SEO blog post",
          text: b.excerpt || (b.focus_keyword ? `Focus: ${b.focus_keyword}` : ""),
          status: b.status || "draft",
          date: b.published_at || b.created_at,
          thumb: b.featured_image_url || null,
        });
      }

      for (const p of data(seoPages)) {
        const host = (p.url || "").replace(/https?:\/\/(www\.)?/, "").split("/")[0];
        push({
          id: p.id, source: "seo_pages", brand: normalizeBrand(host.split(".")[0]),
          type: "landing", template: "landing",
          title: p.current_title || p.url || "SEO page",
          text: p.ai_suggested_meta_description || p.current_meta_description || p.url || "",
          status: p.is_active ? "active" : "inactive",
          date: p.created_at,
          // seo_pages stores no HTML or image, so the live page IS the design.
          // Without this the card could only show its meta description.
          url: p.url || null,
        });
      }

      for (const b of data(siteBlogs)) {
        push({
          id: b.id, source: "blog_posts", brand: "restylepro",
          type: "blog", template: "article",
          title: b.title || "Blog post",
          text: b.description || "",
          status: b.status || "draft",
          date: b.published_at || b.created_at,
          thumb: b.featured_image_url || null,
        });
      }

      for (const t of data(emailTpls)) {
        push({
          id: t.id, source: "email_templates", brand: brandFromEmail(t.from_email),
          type: "email", template: "emailtpl",
          title: t.name || t.slug || "Email template",
          text: t.subject || t.description || "",
          status: t.category || "template",
          date: t.created_at,
        });
      }

      for (const c of data(emailCamps)) {
        push({
          id: c.id, source: "email_campaigns", brand: brandFromEmail(c.from_email),
          type: "email", template: "newsletter",
          title: c.name || c.subject || "Email campaign",
          text: c.subject || "",
          status: c.status || "draft",
          date: c.sent_at || c.scheduled_at || c.created_at,
        });
      }

      for (const a of data(affiliateAssets)) {
        const type = typeFromPlatform(a.platform) || (String(a.asset_type || "").includes("video") ? "reels" : "ig");
        push({
          id: a.id, source: "affiliate_marketing_assets", brand: "restylepro",
          type, template: templateFor(a, type),
          title: a.title || "Affiliate asset",
          text: a.caption_template || a.description || "",
          status: "ready",
          date: a.created_at,
          thumb: a.thumbnail_url || (/\.(png|jpe?g|gif|webp)($|\?)/i.test(a.file_url || "") ? a.file_url : null),
          mediaUrl: a.file_url || null,
          isVideo: /\.(mp4|mov|webm)($|\?)/i.test(a.file_url || ""),
        });
      }

      for (const v of data(videos)) {
        const bp = v.blueprint || {};
        const fallbackTitle = bp.title || bp.topic || v.source_ref || "Rendered video";
        const base = {
          source: "video_render_jobs", brand: normalizeBrand(v.brand),
          text: bp.caption || bp.hook || "",
          status: v.status || "queued",
          date: v.created_at,
          thumb: v.thumbnail_url || null,
          mediaUrl: v.final_url || null,
          isVideo: true,
          renderJobId: v.id,
          // THE BRAIN'S VERDICT, ON THE CARD. 33 jobs carry one and 13 of those
          // are `mismatch` — a refusal, meaning the pipeline rendered a
          // deliberate ONE-CLIP STUB rather than an edit. The blueprint was
          // already in this query; the verdict was simply never read out of it,
          // so a refused stub looked exactly like a finished cut.
          brainStatus: bp.editor_brain_status ?? null,
          stubReason: bp.edit_stub_reason ?? null,
          // WHICH SHOW THIS IS. The field was already loaded and already read
          // by the detail dialog; it just never reached a chip, so an episode
          // could only be found by recognising its thumbnail.
          showFormat: bp.show_format ?? bp.showFormat ?? null,
          // Show output blueprints carry the editable installer credit and
          // source/revision identity. Put the blueprint on the card so the
          // BrandBoard control can reopen those real values after creation.
          meta: { ...bp, music_url: v.music_url || bp.music_url || null },
          // The other two ways a failure ships as a picture. 49 of 140 complete
          // renders are frame grabs and 42 are one-clip stubs; both rendered,
          // both look finished, neither is an edit.
          renderKind: bp.kind ?? null,
          editKind: bp.edit_kind ?? null,
          provenance: bp.source ?? null,
          person: personByJob.get(String(v.id)) ?? null,
          ideaKey: bp.idea_id ?? null,
          footage: footageForJob(v.id),
          building: !["complete", "failed"].includes(String(v.status || "").toLowerCase()),
        };
        const spine = spineByJob.get(String(v.id));

        // ONE CARD PER PIECE THIS CUT ACTUALLY IS.
        //
        // This loop used to push exactly one card per render row, hardcoded to
        // `type: "reels"`. A 9:16 cut that the spine had already adopted as
        // BOTH the Reel and the YouTube Short showed up once, under Reels, and
        // the Short — a real, drafted artifact in the database — had nowhere on
        // the board to appear. A 16:9 longform was filed under Reels too. That
        // is what "missing all the content it's supposed to make" was: the
        // pieces existed, the board rendered one card and dropped the rest.
        //
        // Same file, same job row, no duplicate render — the fan-out's `reuse`
        // pieces are one video doing several jobs, and each job is a card on
        // its own tab because that is the surface a human approves it for.
        if (spine?.made.length) {
          for (const kind of spine.made) {
            const type = boardTypeForKind(kind);
            if (!type) continue;
            push({
              ...base,
              // Per-piece id so React keys stay unique. `renderJobId` still
              // carries the real job, so Refine / Publish / Make all formats
              // all act on the video, not on the card.
              id: `${v.id}:${kind}`,
              type, template: boardTemplateForKind(kind),
              title: spine.titles[kind] || spine.topic || fallbackTitle,
              spine,
              pieceKind: kind,
            });
          }
          continue;
        }

        // Not on the spine yet (still rendering, failed, or older than the
        // cron's window). Unchanged behaviour — one card, as before.
        push({ ...base, id: v.id, type: "reels", template: "reel916", title: fallbackTitle });
      }

      for (const t of data(socialTpls)) {
        const fmt = (t.format || "").toLowerCase();
        const type: TypeKey = fmt.includes("reel") ? "reels" : fmt.includes("story") ? "story" : "ig";
        push({
          id: t.id, source: "social_templates", brand: normalizeBrand(t.brand),
          type, template: "studio",
          title: t.name || "Studio template",
          text: t.description || "",
          status: "template",
          date: t.created_at,
          thumb: t.thumbnail_url || null,
        });
      }

      for (const c of data(concepts)) {
        const type = typeFromPlatform(c.platform) || "other";
        push({
          id: c.id, source: "content_concepts", brand: normalizeBrand(c.brand),
          type, template: templateFor({ format: c.output_format }, type),
          title: c.title || "Content concept",
          text: c.angle || "",
          status: c.status || "draft",
          date: c.created_at,
        });
      }

      for (const h of data(hooks)) {
        push({
          id: h.id, source: "content_hooks", brand: normalizeBrand(h.brand),
          type: "text", template: "copy",
          title: (h.hook_text || h.text || "Hook").slice(0, 80),
          text: h.hook_text || h.text || "",
          status: h.active === false ? "inactive" : "active",
          date: h.created_at,
        });
      }

      for (const s of data(standing)) {
        const type = typeFromText(`${s.task_type || ""} ${s.title || ""}`) || "other";
        push({
          id: s.id, source: "marketing_standing_tasks", brand: normalizeBrand(s.brand),
          type, template: templateFor(s, type),
          title: s.title || "Standing series",
          text: s.description || (s.cadence ? `Cadence: ${s.cadence}` : ""),
          status: s.cadence || "recurring",
          date: null,
          assignedTo: s.assigned_to || null,
        });
      }

      for (const w of data(wraptv)) {
        push({
          id: w.id, source: "wraptv_site_content", brand: "wraptvworld",
          type: "youtube", template: "longform",
          title: w.title || "WrapTV episode",
          text: w.caption || "",
          status: w.status || "draft",
          date: w.published_at || w.created_at,
          thumb: w.thumbnail_url || null,
          mediaUrl: w.media_url || null,
          isVideo: (w.media_type || "").includes("video"),
        });
      }

      const dateVal = (c: BoardCard) => (c.date ? new Date(c.date).getTime() : 0);
      cards.sort((a, b) => dateVal(b) - dateVal(a));

      // WORK IN FLIGHT. A render that is still going has no thumbnail, so
      // `isFinishedWork` correctly keeps it out of the Finished lane — and
      // there was nowhere else for it to surface. The board looked identical
      // whether six jobs were running or none were.
      //
      // Two sources, because a piece can be in flight in two different ways:
      // a render job the worker is chewing on, and a Director post whose
      // creative is composing (`pending_render_job_id`, written by
      // makeCreative and by contentRunner on the server).
      const queue: QueuedJob[] = [
        ...data(videos)
          .filter((v: any) => !["complete", "failed"].includes(String(v.status || "").toLowerCase()))
          .map((v: any) => ({
            id: String(v.id),
            brand: normalizeBrand(v.brand),
            label: v.blueprint?.title || v.source_ref || "Rendered video",
            status: v.status,
            createdAt: v.created_at,
            kind: "render" as const,
          })),
        ...data(social)
          .filter((p: any) => p.generation_meta?.pending_render_job_id && !(p.media_urls || []).filter(Boolean).length)
          .map((p: any) => ({
            id: `post:${p.id}`,
            brand: normalizeBrand(p.brand),
            label: (p.caption || "").split("\n")[0]?.slice(0, 60) || "Composing creative",
            status: "processing",
            createdAt: p.created_at,
            kind: "creative" as const,
          })),
      ];

      // ── CONTENT SETS — one idea, and everything it did (and didn't) become ──
      //
      // Every other lane on this board is a FLAT LIST, and a flat list cannot
      // answer the question a human actually has after approving an idea:
      // "what came out of it?" The pieces are all here — a Reel on one tab, a
      // Short on another, four channels never made at all — and finding them
      // means scrolling and remembering. Grouping them is what turns "58 social
      // drafts" into "this idea is 4 of 11 done, and here is which 7 aren't".
      //
      // Built ONCE here rather than per render: `buildSets` walks every row and
      // this hook already refetches on a 60s interval, so recomputing it inside
      // a component would redo the whole grouping on every keystroke of the
      // search box.
      //
      // All the rules live in src/lib/contentSets.ts (grouping, gap detection,
      // per-channel best-row selection) and none of them are re-stated here —
      // a second copy would drift from the tested one. This maps rows to its
      // input shape and nothing more.
      const setInputs: SetInput[] = data(social).map((p: any) => ({
        id: String(p.id),
        source: "agent_social_posts",
        brand: normalizeBrand(p.brand),
        channel: channelForSocialPost(p),
        caption: p.caption || null,
        status: p.status || null,
        // Same still the card grid paints — resolved through posterFor so an
        // .mp4 can never end up as a piece tile's image.
        thumb: posterFor({ thumb: p.canva_template_thumbnail_url, mediaUrls: p.media_urls })
          || renderPoster(p.media_urls),
        meta: p.generation_meta || null,
        updatedAt: p.updated_at ?? p.created_at ?? null,
        // A post whose creative is still composing is BUILDING, not missing.
        // Showing it as missing is what makes somebody press the button a
        // second time and buy a duplicate render — same rule the queue uses.
        building: !!p.generation_meta?.pending_render_job_id
          && !(p.media_urls || []).filter(Boolean).length,
      }));
      const sets = buildSets(setInputs);

      // ── CAN ANY OF THIS ACTUALLY SHIP? ──────────────────────────────────────
      //
      // Measured 2026-08-07: 0 of 358 posts have ever published, and
      // `tenant_site_connections` holds only Google properties and WordPress —
      // there is no social destination configured at all. A board that shows
      // "48 scheduled" without saying so is misleading in the most expensive
      // direction, because the owner waits on content that cannot leave the
      // building.
      //
      // A FAILED read is reported as "could not check", never as "not
      // connected" — same discipline as brandBoardPieces' Canva case. Asserting
      // a blocker that may not exist would send someone to reconnect a working
      // integration.
      const connRows = data(connections);
      const connectionsKnown = !connections?.error;
      const metaConnected = connRows.some(
        (c: any) => String(c?.platform || "") === META_CONNECTION_PLATFORM && c?.is_active,
      );
      const socialRows = data(social);
      const now = new Date();
      const publish = {
        known: connectionsKnown,
        metaConnected,
        everPublished: socialRows.filter(
          (p: any) => p?.posted_date || String(p?.status || "").toLowerCase() === "published",
        ).length,
        blockedPieces: socialRows.filter((p: any) => {
          const plat = String(p?.platform || "").toLowerCase();
          return plat.includes("instagram") || plat.includes("facebook");
        }).length,
        pastDue: socialRows.filter(
          (p: any) => String(p?.status || "").toLowerCase() === "scheduled"
            && isPastDue(p?.scheduled_date, now),
        ).length,
      };

      return { cards, failures, queue, sets, publish };
    },
    refetchInterval: 60000,
  });
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  posted: "bg-emerald-100 text-emerald-700 border-emerald-300",
  published: "bg-emerald-100 text-emerald-700 border-emerald-300",
  live: "bg-emerald-100 text-emerald-700 border-emerald-300",
  sent: "bg-emerald-100 text-emerald-700 border-emerald-300",
  done: "bg-emerald-100 text-emerald-700 border-emerald-300",
  ready: "bg-emerald-100 text-emerald-700 border-emerald-300",
  completed: "bg-amber-100 text-amber-700 border-amber-300",
  scheduled: "bg-amber-100 text-amber-700 border-amber-300",
  in_progress: "bg-blue-100 text-blue-700 border-blue-300",
  approved: "bg-blue-100 text-blue-700 border-blue-300",
  needs_review: "bg-purple-100 text-purple-700 border-purple-300",
  active: "bg-blue-100 text-blue-700 border-blue-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] px-1.5 py-0 h-4 capitalize",
        STATUS_STYLE[status] || "bg-slate-100 text-slate-600 border-slate-300",
      )}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function ColorPill({
  active,
  color,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  count?: number;
  icon?: any;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium transition-all border flex items-center gap-1.5",
        active ? "text-white shadow-md border-transparent" : "text-slate-700 hover:shadow-sm",
      )}
      style={
        active
          ? { backgroundColor: color }
          : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }
      }
    >
      {Icon && <Icon className="w-3 h-3" />}
      {label}
      {typeof count === "number" && <span className="opacity-75">({count})</span>}
    </button>
  );
}

/**
 * Media-forward tile (Later-style): the visual on top, the copy — the
 * "place for text" — right under it. Cards with no media show the copy on a
 * type-tinted panel so text content is just as scannable.
 */
function ContentCard({ card, onClick, onDelete, stackBadge }: {
  card: BoardCard; onClick: () => void; onDelete?: (c: BoardCard) => void;
  /** "3 pieces · Reels, Shorts" when this tile stands for several cards. */
  stackBadge?: string;
}) {
  const typeCfg = TYPE_META[card.type];
  const brand = BOARD_BRANDS[card.brand] || { label: card.brand, color: "#64748B" };
  const TypeIcon = typeCfg.icon;
  const team = card.assignedTo ? teamFor(card.assignedTo) : null;
  // Resolved from the card's media, not from `thumb`: a card can carry its
  // poster second, behind an .mp4.
  const poster = posterFor(card);
  // The actual video file, used as the cover when there is no still: a
  // <video preload="metadata"> seeked to its first frame IS the poster, and
  // shows the work instead of apologising for it. See CardCover.
  // Is this tile a machine failure wearing a thumbnail? Decided from stored
  // blueprint facts, never from the picture — see boardProvenance.
  const failure = machineFailure(card);
  const videoUrl = !poster && hasPlayableVideo(card)
    ? [card.mediaUrl, ...(card.mediaUrls || [])].find(
        (u) => typeof u === "string" && /\.(mp4|mov|webm|m4v)($|\?)/i.test(u),
      ) || null
    : null;

  return (
    <Card onClick={onClick} className="bg-white overflow-hidden cursor-pointer hover:shadow-lg transition-all group">
      {/* Brand band — same hard color coding as the Shot List cards */}
      <div className="flex items-center gap-1 px-2 py-1" style={{ backgroundColor: brand.color }}>
        <span className="truncate text-[9px] font-extrabold uppercase tracking-wide text-white">{brand.label}</span>
        {team && <span className="ml-auto shrink-0 rounded bg-white/20 px-1 text-[8px] font-bold text-white">{team.label}</span>}
      </div>
      <div className="relative aspect-square bg-slate-100">
        {/* Delete — for the ones not worth opening. Appears on hover so the
            grid stays clean, but is always present on touch (no hover there).
            stopPropagation, or deleting would also open the card. */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(card); }}
            title="Delete this permanently"
            aria-label={`Delete ${card.title}`}
            className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100 focus:opacity-100 md:opacity-0 max-md:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Poster, or an HONEST placeholder — never <img src="…mp4">, which
            paints nothing while downloading the whole 23-38 MB file. That
            broken tag was the real cause of the blank cards, not the absence
            of a still, so a poster-less video says what it is instead of
            disappearing from the board. */}
        {/* An email has no poster, so CardCover could only ever fall back to
            its copy — the "just showing the text of the email" complaint. When
            the design is stored, show the design. */}
        {card.html ? (
          <EmailDesignPreview html={card.html} title={card.title} />
        ) : (
          <CardCover
            poster={poster}
            video={videoUrl}
            text={card.text || card.title}
            tintColor={typeCfg.color}
            icon={TypeIcon}
          />
        )}
        {poster && (card.mediaUrls?.length || 0) > 1 && (
          <span className="absolute bottom-1.5 right-1.5 z-10 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {card.mediaUrls!.length} slides
          </span>
        )}
        {/* WHY THIS EXISTS, at a glance. Only the two signals worth breaking a
            scan for: a brain REFUSAL (this is a stub, not an edit) and a strong
            hook score on the source footage. Both were in the database and
            neither was on the board. */}
        <TileSignal brainStatus={card.brainStatus} hook={card.footage?.hook ?? null} />
        {card.isVideo && poster && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </span>
          </span>
        )}
        <span
          className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white"
          style={{ backgroundColor: typeCfg.color }}
        >
          <TypeIcon className="w-2.5 h-2.5" />
          {typeCfg.label}
        </span>
        {/* THE STACK BADGE. One file cut for several channels is several
            pieces, and the grid used to paint each as its own tile with no
            sign they were the same video — which is what reads as "the same
            music videos over and over". Saying the count on ONE tile keeps
            every piece accounted for without repeating the picture. */}
        {stackBadge && (
          <span
            className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[8px] font-bold text-white"
            title={`${stackBadge} — switch to “Every piece” above to open them individually`}
          >
            <Layers className="w-2.5 h-2.5" />
            {stackBadge}
          </span>
        )}
      </div>
      <div className="p-2">
        {/* WHAT THIS ACTUALLY IS. A frame grab and a real cut are the same
            rectangle at thumbnail size, which is the whole reason two thirds of
            this board read as slop. The label sits in the card BODY rather than
            over the picture so it never fights the hook badge or the stack
            badge for the same corner, and so it can carry the full phrase
            ("Brain refused · one-clip stub · frame grab") instead of an
            abbreviation. The pipeline's own sentence is on the tooltip and in
            full when the card is opened. */}
        {failure && (
          <div
            className="mb-1 flex items-center gap-1 rounded bg-red-50 px-1 py-0.5 text-[9px] font-bold text-red-700"
            title={failure.reason || FAILURE_META[failure.primary].blurb}
          >
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{failureLabel(failure)}</span>
          </div>
        )}
        <div className="text-[11px] font-semibold text-slate-900 line-clamp-1 leading-tight">{card.title}</div>
        <div className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 min-h-[24px]">
          {card.text || <span className="italic text-slate-300">No copy yet — click to add</span>}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <StatusBadge status={card.status} />
          <span className="flex items-center gap-1 text-[9px] text-slate-400">
            {team && <span style={{ color: team.color }}>{team.label}</span>}
            {card.date && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {format(parseISO(card.date), "MMM d")}
              </span>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function CardGrid({ cards, onSelect, onDelete, badgeFor }: {
  cards: BoardCard[]; onSelect: (c: BoardCard) => void; onDelete?: (c: BoardCard) => void;
  /** Optional per-card stack badge — only the Finished lane passes one. */
  badgeFor?: (c: BoardCard) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? cards : cards.slice(0, 60);
  if (cards.length === 0) {
    return (
      <div className="text-center py-10 bg-white rounded-lg border border-slate-200">
        <Bot className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No content here yet</p>
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
        {visible.map((c) => (
          <ContentCard
            key={`${c.source}-${c.id}`}
            card={c}
            onClick={() => onSelect(c)}
            onDelete={onDelete}
            stackBadge={badgeFor?.(c)}
          />
        ))}
      </div>
      {cards.length > 60 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2.5 w-full rounded-lg border border-gray-300 bg-white py-2 text-xs font-bold text-gray-700 hover:border-pink-400 hover:text-pink-600"
        >
          {cards.length - 60} more not shown — Show all {cards.length} →
        </button>
      )}
    </div>
  );
}

function SectionHeader({ color, label, count, icon: Icon }: { color: string; label: string; count: number; icon?: any }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-6 first:mt-0">
      <span className="w-1 h-5 rounded-full" style={{ backgroundColor: color }} />
      {Icon && <Icon className="w-4 h-4" style={{ color }} />}
      <h3 className="text-sm font-bold text-slate-800">{label}</h3>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );
}

// ─── Content Sets — one idea, and every piece it did or didn't become ────────

/**
 * The five states a piece can be in, and the colour each one wears.
 *
 * Two rules are doing work here and neither is decoration:
 *
 *  - MISSING IS A MEMBER OF THE SET, not an omission. It gets the flattest
 *    colour on the board (slate) AND a dashed outline, because a set showing
 *    four green tiles tells you nothing unless you can also see the seven that
 *    were never made. Colour alone would not be enough — a dashed edge reads
 *    as "gap" without asking anyone to distinguish two pale washes, which is
 *    the same reason the queue bars carry a label as well as a fill.
 *  - BUILDING IS NOT MISSING. A render in flight wearing the "not made"
 *    colour is what makes someone press the button again and pay for a
 *    duplicate cut. It gets its own colour and says so.
 *
 * Same formula as every other coloured control on this board (see ColorPill):
 * tinted fill + tinted border + the colour as text when idle, SOLID with white
 * text when it is the piece currently open. No gradients, no second palette.
 */
const SET_STATE_META: Record<PieceState, { label: string; color: string }> = {
  posted: { label: "Posted", color: "#059669" },
  approved: { label: "Approved", color: "#2563EB" },
  review: { label: "In review", color: "#F59E0B" },
  building: { label: "Building", color: "#6366F1" },
  missing: { label: "Not made", color: "#94A3B8" },
};

/**
 * One channel's tile inside a set.
 *
 * "no publisher" is printed on any channel `content-deploy` cannot actually
 * post to (contentDoctrine's `canAutoPublish`, verified against the real
 * dispatch — five platforms, no more). Saying it HERE, on the review screen,
 * is the point: a piece approved for TikTok looks identical to one approved
 * for Instagram right up until the moment nobody notices it never went out.
 * The operator finds out while they are looking at it, not a week later.
 */
function SetPieceTile({ piece, isOpen, onOpen }: {
  piece: SetPiece; isOpen: boolean; onOpen?: () => void;
}) {
  const meta = SET_STATE_META[piece.state];
  const missing = piece.state === "missing";
  const clickable = !!onOpen;
  const style = isOpen
    ? { backgroundColor: meta.color, borderColor: meta.color, color: "#fff" }
    : { backgroundColor: tint(meta.color), borderColor: tint(meta.color, 0.4), color: meta.color };

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!clickable}
      title={clickable ? `Open ${piece.channelLabel} — ${meta.label}` : `${piece.channelLabel} — ${meta.label}`}
      className={cn(
        "rounded-lg border p-1.5 text-left transition-all",
        missing ? "border-dashed" : "border-solid",
        clickable ? "cursor-pointer hover:shadow-sm" : "cursor-default",
      )}
      style={style}
    >
      <div className="text-[10px] font-bold leading-tight truncate">{piece.channelLabel}</div>
      {piece.thumb && !isOpen && (
        <img
          src={thumbnailUrl(piece.thumb, 200)}
          alt=""
          className="mt-1 h-12 w-full rounded object-cover"
          loading="lazy"
        />
      )}
      <div className="mt-0.5 text-[9px] font-semibold leading-tight opacity-90">{meta.label}</div>
      {/* Only worth saying on a channel that has something (or is expected) to
          go out — repeating it on every gap would drown the signal. */}
      {!piece.canAutoPublish && (
        <div className={cn("text-[8px] leading-tight", isOpen ? "text-white/80" : "opacity-70")}>
          no publisher
        </div>
      )}
      {piece.review?.rating != null && (
        <div className={cn("text-[8px] font-bold leading-tight", isOpen ? "text-white/90" : "opacity-80")}>
          rated {piece.review.rating}/10
        </div>
      )}
    </button>
  );
}

function ContentSetCard({ set, openId, findCard, onSelect }: {
  set: ContentSet;
  openId: string | null;
  findCard: (piece: SetPiece) => BoardCard | null;
  onSelect: (card: BoardCard) => void;
}) {
  const brand = BOARD_BRANDS[set.brand] || { label: set.brand, color: "#64748B" };
  const percent = set.total > 0 ? Math.round((set.made / set.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-snug text-slate-900 line-clamp-2">{set.topic}</h3>
          {/* setSummary is the shared sentence — made / waiting / building /
              blocked. Re-deriving those counts here would give this card its
              own arithmetic to drift from the tested one. */}
          <p className="mt-0.5 text-[11px] text-slate-500">{setSummary(set)}</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: tint(brand.color), border: `1px solid ${tint(brand.color, 0.4)}`, color: brand.color }}
        >
          {brand.label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: brand.color }} />
        </div>
        <span className="shrink-0 text-[10px] font-bold text-slate-500">{set.made}/{set.total}</span>
      </div>

      {/* EVERY channel, including the ones with nothing in them. Rendering only
          what exists is what made "is this idea done?" unanswerable. */}
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {set.pieces.map((p) => {
          // Clickable ONLY when the board actually holds that card. A piece
          // whose row never became a card (filtered out, deleted, or past the
          // query's row limit) simply does not open — synthesising a card to
          // click would put invented content in the detail dialog, which is
          // the one thing worse than an unclickable tile.
          const card = findCard(p);
          return (
            <SetPieceTile
              key={p.channel}
              piece={p}
              isOpen={!!p.id && p.id === openId}
              onOpen={card ? () => onSelect(card) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Calendar view (thumbnails in the grid, Later-style) ─────────────────────

function BoardCalendar({ cards, onSelect }: { cards: BoardCard[]; onSelect: (c: BoardCard) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const byDay = useMemo(() => {
    const map: Record<string, BoardCard[]> = {};
    for (const c of cards) {
      if (!c.date) continue;
      let key: string;
      try {
        key = format(parseISO(c.date), "yyyy-MM-dd");
      } catch {
        continue;
      }
      (map[key] ||= []).push(c);
    }
    return map;
  }, [cards]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfMonth(month);
    const days: Date[] = [];
    let d = start;
    while (d <= end || days.length % 7 !== 0) {
      days.push(d);
      d = addDays(d, 1);
    }
    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [month]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          {format(month, "MMMM yyyy")}
        </h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-slate-50 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500 py-1.5">
            {d}
          </div>
        ))}
        {weeks.flat().map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const items = byDay[key] || [];
          const inMonth = day.getMonth() === month.getMonth();
          return (
            <div key={i} className={cn("min-h-[110px] p-1", inMonth ? "bg-white" : "bg-slate-50/70")}>
              <div
                className={cn(
                  "text-[10px] font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full",
                  isToday(day) ? "bg-gradient-to-r from-blue-600 to-pink-600 text-white" : inMonth ? "text-slate-700" : "text-slate-400",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map((c) => {
                  const brand = BOARD_BRANDS[c.brand] || { label: c.brand, color: "#64748B" };
                  return c.thumb ? (
                    <button
                      key={`${c.source}-${c.id}`}
                      onClick={() => onSelect(c)}
                      className="relative w-full h-10 rounded overflow-hidden block border-l-2 hover:opacity-80"
                      style={{ borderLeftColor: brand.color }}
                      title={c.title}
                    >
                      <img src={thumbnailUrl(c.thumb, 200)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      <span
                        className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: TYPE_META[c.type].color }}
                      />
                    </button>
                  ) : (
                    <button
                      key={`${c.source}-${c.id}`}
                      onClick={() => onSelect(c)}
                      className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 border-l-2 hover:opacity-80"
                      style={{ borderLeftColor: brand.color, backgroundColor: tint(TYPE_META[c.type].color, 0.12) }}
                      title={c.title}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_META[c.type].color }} />
                      <span className="text-[9px] text-slate-700 truncate leading-tight">{c.title}</span>
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <div className="text-[9px] text-slate-400 pl-1">+{items.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t border-slate-100">
        {TYPE_ORDER.filter((t) => t !== "other").map((t) => (
          <span key={t} className="flex items-center gap-1 text-[9px] text-slate-500">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_META[t].color }} />
            {TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Klaviyo build — the card becomes a real DRAFT ───────────────────────────
//
// An email card used to be a sentence describing a campaign someone would
// hand-build later ("Campaign built from Klaviyo master template S4HD3g…").
// This panel makes the sentence true: it clones the master in Klaviyo, fills
// its slots from the card's brief, pulls the hero image from our own media
// library (agent_media_assets), and leaves a DRAFT campaign for a human to
// review and send. It never sends.

interface BuildResult {
  master?: { key: string; id: string; label: string };
  subject?: string;
  preview_text?: string;
  hero?: { asset_id: string; title: string; url: string; kind: string } | null;
  library_candidates?: number;
  klaviyo_campaign_url?: string;
  list?: { id: string; name: string };
  error?: string;
}

function KlaviyoBuildPanel({ card }: { card: BoardCard }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"preview" | "build" | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);

  const meta = card.meta || {};
  const builtId = meta.klaviyo_campaign_id as string | undefined;
  const builtUrl =
    (meta.klaviyo_campaign_url as string | undefined) ||
    (builtId ? `https://www.klaviyo.com/campaign/${builtId}/wizard` : null);

  const run = async (mode: "preview" | "build") => {
    setBusy(mode);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("klaviyo-build-email", {
      body: {
        action: "build",
        task_id: card.id,
        dry_run: mode === "preview",
        ...(mode === "build" && builtId ? { force: true } : {}),
      },
    });
    setBusy(null);

    // Edge errors carry the useful message in the response body, not `error`.
    const payload = (data || {}) as BuildResult;
    if (error || payload.error) {
      const msg = payload.error || error?.message || "Build failed";
      setResult(payload.error ? payload : null);
      toast({ title: "Klaviyo build failed", description: msg, variant: "destructive" });
      return;
    }
    setResult(payload);
    if (mode === "build") {
      toast({
        title: "Draft built in Klaviyo",
        description: `${payload.master?.label ?? "Master"} → ${payload.list?.name ?? "list"}. Review and send in Klaviyo.`,
      });
      queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
          Klaviyo
        </span>
        {builtId && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border bg-emerald-50 text-emerald-700 border-emerald-200"
          >
            Draft built
          </Badge>
        )}
      </div>

      {builtId ? (
        <div className="text-xs text-slate-600 space-y-1">
          <div>
            Built from{" "}
            <span className="font-medium text-slate-800">
              {(meta.klaviyo_master_key as string)?.toUpperCase() || "master"}
            </span>{" "}
            <span className="font-mono text-[11px] text-slate-500">
              {meta.klaviyo_master_id as string}
            </span>
            {meta.klaviyo_list_name ? <> → {meta.klaviyo_list_name as string}</> : null}
          </div>
          {builtUrl && (
            <a
              href={builtUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:text-pink-600 font-medium flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Open the draft in Klaviyo
            </a>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Clones the master template, fills it from this card, and pulls the hero image from
          the media library. Creates a <span className="font-medium">draft only</span> — nobody
          gets emailed until a human sends it in Klaviyo.
        </p>
      )}

      {result && !result.error && (
        <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700 space-y-1">
          <div>
            <span className="text-slate-400">Subject:</span> {result.subject}
          </div>
          {result.preview_text && (
            <div>
              <span className="text-slate-400">Preview:</span> {result.preview_text}
            </div>
          )}
          <div>
            <span className="text-slate-400">Master:</span> {result.master?.label}
          </div>
          <div>
            <span className="text-slate-400">Hero:</span>{" "}
            {result.hero
              ? `${result.hero.title} (${result.hero.kind})`
              : `none picked — ${result.library_candidates ?? 0} candidates in the library`}
          </div>
          {result.hero && (
            <img
              // Transformed like every other image on this board. Raw, this is
              // a full-resolution render (multi-MB) painted into a preview
              // strip — the exact cost the grid tiles were fixed for.
              src={thumbnailUrl(result.hero.url, 600)}
              alt=""
              className="w-full rounded border border-slate-200 mt-1"
            />
          )}
        </div>
      )}

      {result?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {result.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => run("preview")}
          disabled={busy !== null}
          className="h-8 text-xs border-slate-300"
        >
          {busy === "preview" ? "Filling…" : "Preview fill"}
        </Button>
        <Button
          size="sm"
          onClick={() => run("build")}
          disabled={busy !== null}
          className="h-8 text-xs bg-gradient-to-r from-blue-600 to-pink-600 text-white border-0"
        >
          {busy === "build" ? "Building…" : builtId ? "Rebuild draft" : "Build in Klaviyo"}
        </Button>
      </div>
    </div>
  );
}

// ─── Detail dialog — the place for text ──────────────────────────────────────

/**
 * PieceReviewPanel — approve / decline / rate ONE piece.
 *
 * Owner: "we will approve each piece individually … or we can individually
 * approve or decline and rate between one and 10. 10 is a winner, 1 is not."
 *
 * The rating is stored on the row's `generation_meta` under `piece_review`
 * rather than in a new column, so it needs no migration and rides along with
 * everything else already recorded about the piece.
 *
 * An unrated piece stays NULL. There is deliberately no default: `clampRating`
 * refuses to coerce a blank into a number, because a fabricated 5 would enter
 * the average as though somebody had judged it.
 */
function PieceReviewPanel({ card }: { card: BoardCard }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const review = readReview(card.meta);

  const save = useCallback(async (input: { verdict?: PieceVerdict; rating?: number | null }) => {
    setSaving(true);
    try {
      const patch = buildReviewPatch(card.meta as Record<string, unknown>, {
        verdict: input.verdict ?? review.verdict,
        rating: input.rating === undefined ? review.rating : input.rating,
        reviewedBy: "brand_board",
      });
      const { error } = await db.from("agent_social_posts").update(patch).eq("id", card.id.split(":")[0]);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [card.id, card.meta, review.verdict, review.rating, queryClient]);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-slate-700">This piece:</span>
        {(["approved", "declined"] as PieceVerdict[]).map((v) => {
          const on = review.verdict === v;
          const color = v === "approved" ? "#059669" : "#DC2626";
          return (
            <button
              key={v}
              disabled={saving}
              onClick={() => save({ verdict: on ? "pending" : v })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-50",
                on ? "text-white shadow-md border-transparent" : "hover:shadow-sm",
              )}
              style={on ? { backgroundColor: color } : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }}
            >
              {v === "approved" ? "Approve" : "Decline"}
            </button>
          );
        })}
        {review.reviewedAt && (
          <span className="text-[10px] text-slate-400">
            {review.verdict} · {format(parseISO(review.reviewedAt), "MMM d")}
          </span>
        )}
      </div>

      {/* 1–10. 10 is a winner, 1 is not. Solid in the brand-board formula once
          chosen; a rating of 8+ reads as a winner (WINNER_RATING). */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] font-bold text-slate-700">Rate:</span>
        {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => {
          const on = review.rating === n;
          const color = n >= WINNER_RATING ? "#059669" : n >= 5 ? "#F59E0B" : "#64748B";
          return (
            <button
              key={n}
              disabled={saving}
              onClick={() => save({ rating: on ? null : n })}
              title={n === RATING_MAX ? "Winner" : n === RATING_MIN ? "Not a winner" : undefined}
              className={cn(
                "h-6 w-6 rounded-full border text-[10px] font-bold transition-all disabled:opacity-50",
                on ? "text-white shadow-md border-transparent" : "hover:shadow-sm",
              )}
              style={on ? { backgroundColor: color } : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }}
            >
              {n}
            </button>
          );
        })}
        {review.rating === null && (
          <span className="ml-1 text-[10px] text-slate-400">unrated</span>
        )}
        {isWinner(review) && (
          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
            winner
          </span>
        )}
      </div>
    </div>
  );
}

function CardDetail({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cfg = SOURCE_CONFIG[card.source] || { label: card.source };
  const [text, setText] = useState(card.text);
  const [saving, setSaving] = useState(false);
  const [canvaLinkBusy, setCanvaLinkBusy] = useState(false);
  const brand = BOARD_BRANDS[card.brand] || { label: card.brand, color: "#64748B" };
  // Same rule as the tile: the still to paint, or nothing. A video with no
  // poster still plays here — the <video> below needs no poster to work.
  const poster = posterFor(card);
  // A card whose media is a finished render opens the CUT EDITOR on that
  // render — song, logo, ticker, scene trims, grade. Sending it to the
  // Content Director instead is what "I click edit and it does nothing" was:
  // the Director can approve and reschedule a post, it cannot change a song.
  const editorPath = card.renderJobId
    ? `/engine-room?tab=video&render=${card.renderJobId}&edit=music`
    : !cfg.editorPath ? undefined
    : cfg.perRowPath ? `${cfg.editorPath}/${card.id}`
    : cfg.perRowQuery ? `${cfg.editorPath}${cfg.editorPath.includes("?") ? "&" : "?"}${cfg.perRowQuery}=${card.id}`
    : cfg.editorPath;
  const editorLabel = card.renderJobId ? "Cut Editor" : cfg.editorLabel;

  const openCanvaDesign = useCallback(async () => {
    if (!card.canvaDesignId) return;
    const canvaWindow = window.open("about:blank", "_blank");
    if (canvaWindow) canvaWindow.opener = null;
    setCanvaLinkBusy(true);
    try {
      const design = await getCanvaBrandBoardLink({
        postId: card.id,
        brand: card.brand,
        designId: card.canvaDesignId,
      });
      const rawUrl = design.editUrl || design.viewUrl;
      const url = rawUrl ? new URL(rawUrl) : null;
      if (!url || url.protocol !== "https:" || !(url.hostname === "canva.com" || url.hostname.endsWith(".canva.com"))) {
        throw new Error("Canva did not return a valid edit or view URL.");
      }
      if (!canvaWindow) throw new Error("Allow pop-ups for BrandBoard, then try Edit in Canva again.");
      canvaWindow.location.replace(url.toString());
    } catch (error) {
      canvaWindow?.close();
      notify.error(error instanceof Error ? error.message : "Could not open this Canva design.");
    } finally {
      setCanvaLinkBusy(false);
    }
  }, [card.id, card.brand, card.canvaDesignId]);

  // ── WHY THIS CUT IS THE CUT IT IS ─────────────────────────────────────────
  //
  // An automated cut is a black box: a finished video appears and the only way
  // to judge it is to watch the whole thing and guess at intent. The reasoning
  // belongs HERE, in the dialog where a human watches the cut and then approves
  // or rates it — not on a separate screen nobody opens.
  //
  // The board's list query does not carry `blueprint`, so the reasoning is read
  // per-cut, only when a render dialog is actually open.
  const { data: renderJob } = useQuery({
    queryKey: ["render-job-brain", card.renderJobId],
    enabled: !!card.renderJobId,
    queryFn: async () => {
      const { data } = await db
        .from("video_render_jobs")
        .select("id, status, blueprint, final_url")
        .eq("id", card.renderJobId)
        .maybeSingle();
      return data || null;
    },
  });

  // The edge function and the panel were built from the same brief and their
  // schemas diverged (verdict/status, reasoning.why/because, a separate cuts[]
  // array, two different meanings of "refusals"). `editorBrainAdapter` is the
  // one translation between them — never re-derive it inline here.
  const brain = useMemo(() => {
    const bp = (renderJob?.blueprint || {}) as Record<string, any>;
    const raw = bp.editor_brain ?? bp.editorBrain ?? null;
    if (!raw) return null;
    return adaptEditorBrain(raw, {
      brand: card.brand,
      // Fallbacks only — the brain's own answer wins where it has one.
      contentType: bp.content_type ?? bp.contentType ?? null,
      showFormat: bp.show_format ?? bp.showFormat ?? null,
    });
  }, [renderJob, card.brand]);

  // ── WrapTVWorld delivery ──────────────────────────────────────────────────
  const [wtwBusy, setWtwBusy] = useState<null | "site" | "yt">(null);

  const sendToSite = useCallback(async () => {
    setWtwBusy("site");
    try {
      const payload = buildSitePost({
        title: card.title,
        blueprintTitle: card.title,
        isVideo: card.isVideo,
        mediaUrl: card.mediaUrl,
        thumbnailUrl: card.thumb,
        caption: card.text,
      });
      if ("error" in payload) { notify.error(payload.error); return; }
      const { error } = await db.from("agent_social_posts").insert({
        brand: "wraptvworld", created_by: "brand_board", hashtags: [], ...payload,
      });
      if (error) throw new Error(error.message);
      notify.success("Sent to WrapTVWorld — live on the site within ~5 minutes.");
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally { setWtwBusy(null); }
  }, [card]);

  const makeYouTubeCaption = useCallback(async () => {
    setWtwBusy("yt");
    try {
      // Reuse the caption brain the rest of the suite uses — no new producer.
      const { data } = await supabase.functions.invoke("video-captions", {
        body: { mode: "youtube_meta", topic: card.title, transcript: (card.text || "").slice(0, 4000), brand: "wraptvworld" },
      });
      const title = String(data?.title || card.title || "").trim();
      const description = String(data?.description || card.text || "").trim();
      if (!title && !description) { notify.error("Couldn't write a caption for this one."); return; }
      const draft = buildYouTubeDraft({ title, description, mediaUrl: card.mediaUrl, tags: [] });
      const { error } = await db.from("agent_social_posts").insert({
        brand: "wraptvworld", created_by: "brand_board", ...draft,
      });
      if (error) throw new Error(error.message);
      notify.success(youtubeNotice(), { duration: 9000 });
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally { setWtwBusy(null); }
  }, [card]);

  const [approving, setApproving] = useState<"approve" | "reject" | null>(null);
  const { isApprover, email: approverEmail, loading: approverLoading } = useContentApprover();

  // A back-catalog upload waiting on a higher-up. Anyone on the team can put
  // one here; only an approver can clear it.
  const pendingLegacy = isPendingApproval(card.meta, card.status);
  const fromUpload = isLegacyUpload(card.meta);

  // Approve straight from the board — this IS the approval for a made piece,
  // not a copy of one. Only for sources the Director can schedule.
  const canApprove =
    isApprover &&
    card.source === "agent_social_posts" &&
    !["approved", "published", "posted"].includes((card.status || "").toLowerCase());

  const approve = async () => {
    setApproving("approve");

    // A BACK-CATALOG UPLOAD knows what approving it MEANS: one that already ran
    // is filed into history as "posted", one that never ran becomes "approved".
    // Neither gets a schedule — re-publishing old work is never the intent.
    if (pendingLegacy) {
      const { error } = await db
        .from("agent_social_posts")
        .update(buildLegacyApprovalPatch(card.meta, approverEmail))
        .eq("id", card.id);
      setApproving(null);
      if (error) {
        toast({ title: "Approve failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({
        title: "Approved ✓",
        description: card.meta?.intended_state === "archive"
          ? "Filed into the brand's history. It is not re-published."
          : "Approved and filed. It is not scheduled.",
      });
      queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
      onClose();
      return;
    }

    // A MADE PIECE approves THROUGH THE DIRECTOR'S OWN ACTION.
    //
    // This used to write `status: "approved"` and tell the approver to go
    // schedule it in the Content Director. That was survivable while the
    // Director also listed made pieces — it doesn't any more (they route here,
    // see src/lib/contentOsRouting.ts), so a bare status flip would approve
    // content into a dead end that nothing ever publishes. `director_approve`
    // assigns the next open programming slot and content-deploy ships it, which
    // is the same "approve = scheduled = published" contract the Director has
    // always had. Approving where the work IS, instead of relaying the person
    // to another page to do it again, is the point of the wiring.
    const { data, error } = await supabase.functions.invoke("marketing-agent", {
      body: { action: "director_approve", post_id: card.id },
    });
    setApproving(null);
    const failure = error?.message || (data as any)?.error;
    if (failure) {
      toast({ title: "Approve failed", description: String(failure), variant: "destructive" });
      return;
    }
    const when = (data as any)?.scheduled_date;
    const slot = (data as any)?.slot;
    toast({
      title: "Approved ✓",
      description: when
        ? `Scheduled for ${new Date(when).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${slot ? ` (${slot})` : ""} — publishes automatically.`
        : "Approved — it publishes automatically from here.",
    });
    queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    onClose();
  };

  const reject = async () => {
    const reason = window.prompt("Why is this being rejected? (optional)") ?? undefined;
    setApproving("reject");
    const { error } = await db
      .from("agent_social_posts")
      .update(buildLegacyRejectPatch(card.meta, approverEmail, reason))
      .eq("id", card.id);
    setApproving(null);
    if (error) {
      toast({ title: "Reject failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Rejected", description: "Kept on the board, marked rejected." });
    queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    onClose();
  };

  const save = async () => {
    if (!cfg.editField) return;
    setSaving(true);
    const { error } = await db.from(card.source).update({ [cfg.editField]: text }).eq("id", card.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: "Copy updated." });
    queryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    onClose();
  };

  return (
    <DialogContent className="bg-white w-[92vw] sm:max-w-[520px] max-h-[88vh] overflow-y-auto"
      style={{ width: "min(92vw, 33rem)", maxWidth: "33rem" }}>
      {/* Brand band — same coding as the card grid */}
      <div className="-mx-6 -mt-6 mb-1 flex items-center gap-1.5 px-4 py-1.5" style={{ backgroundColor: brand.color }}>
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-white">{brand.label}</span>
        <span className="ml-auto h-1 w-10 rounded-full" style={{ backgroundColor: TYPE_META[card.type].color }} title={TYPE_META[card.type].label} />
      </div>
      <DialogHeader>
        <DialogTitle className="text-slate-900 text-base leading-snug pr-6">{card.title}</DialogTitle>
      </DialogHeader>

      {(card.mediaUrls?.length || 0) > 1 ? (
        <div>
          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Carousel — {card.mediaUrls!.length} slides</label>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {card.mediaUrls!.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="relative block">
                <img src={thumbnailUrl(u, 800)} alt={`Slide ${i + 1}`} className="w-full rounded-lg border border-slate-200" loading="lazy" />
                <span className="absolute top-1 left-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{i + 1}</span>
              </a>
            ))}
          </div>
        </div>
      ) : card.isVideo && card.mediaUrl ? (
        /* Play the ACTUAL video at its true aspect — the old thumb-only view
           stretched a horizontal frame-grab full width ("opens horizontal and
           stretched") and gave no way to watch the cut. */
        <video
          src={card.mediaUrl}
          controls
          playsInline
          preload="metadata"
          poster={poster ? thumbnailUrl(poster, 800) : undefined}
          className="mx-auto max-h-[60vh] w-auto max-w-full rounded-lg border border-slate-200 bg-black"
        />
      ) : card.html ? (
        /* THE EMAIL DESIGN. An email card has no image to poster, so without
           this the drawer showed a subject line and nothing else. */
        <EmailDesignPreview html={card.html} mode="full" title={card.title} />
      ) : card.url ? (
        <LandingPagePreview url={card.url} title={card.title} />
      ) : (
        poster && <img src={thumbnailUrl(poster, 1200)} alt="" className="mx-auto max-h-[60vh] w-auto max-w-full rounded-lg border border-slate-200 object-contain" />
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 border"
          style={{ backgroundColor: tint(TYPE_META[card.type].color), color: TYPE_META[card.type].color, borderColor: tint(TYPE_META[card.type].color, 0.4) }}
        >
          {TYPE_META[card.type].label}
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 border"
          style={{ backgroundColor: tint(TEMPLATE_META[card.template].color, 0.08), color: TEMPLATE_META[card.template].color, borderColor: tint(TEMPLATE_META[card.template].color, 0.3) }}
        >
          {TEMPLATE_META[card.template].label}
        </Badge>
        <StatusBadge status={card.status} />
        <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: brand.color }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: brand.color }} />
          {brand.label}
        </span>
      </div>

      {/* The place for text */}
      <div>
        <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center justify-between">
          <span>Copy / Caption / Text</span>
          {!cfg.editField && <span className="normal-case font-normal text-slate-400">read-only here</span>}
        </label>
        {cfg.editField ? (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write the caption / copy for this piece…"
            className="mt-1 min-h-[140px] bg-white text-slate-900 border-slate-200 text-sm"
          />
        ) : (
          <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg border border-slate-200 p-3 min-h-[60px]">
            {card.text || <span className="italic text-slate-400">No copy stored on this piece.</span>}
          </div>
        )}
      </div>

      {/* Copy help, right where the copy is judged. Proposals only — nothing
          it writes is saved until the human hits "Save copy" below. */}
      {cfg.editField && (
        <CaptionAiPanel
          brand={card.brand}
          caption={text}
          imageUrl={card.thumb && !card.isVideo ? card.thumb : null}
          format={card.template === "reel916" ? "Reel" : card.template === "carousel" ? "Carousel" : "Post"}
          context={typeof card.meta?.note === "string" ? card.meta.note : undefined}
          onAccept={({ caption }) => setText(caption)}
        />
      )}

      {/* Where an uploaded piece came from — who put it here and when it
          originally ran, so the approver is not judging it blind. */}
      {fromUpload && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
          <div className="mb-1 flex items-center gap-1.5">
            <Upload className="h-3 w-3 text-slate-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Uploaded content
            </span>
            {pendingLegacy && (
              <Badge variant="outline" className="border-purple-300 bg-purple-100 px-1.5 py-0 text-[9px] text-purple-700">
                Awaiting approval
              </Badge>
            )}
          </div>
          <div>
            {card.meta?.uploaded_by ? <>By {String(card.meta.uploaded_by)}</> : "By the team"}
            {card.meta?.channel_label ? <> · {String(card.meta.channel_label)}</> : null}
            {card.meta?.intended_state === "archive" ? " · already posted" : " · never posted"}
          </div>
          {typeof card.meta?.original_posted_at === "string" && (
            <div className="text-slate-500">
              Originally ran {format(parseISO(card.meta.original_posted_at), "MMM d, yyyy")}
            </div>
          )}
          {typeof card.meta?.note === "string" && card.meta.note && (
            <div className="mt-1 italic text-slate-500">“{card.meta.note}”</div>
          )}
          {typeof card.meta?.rejected_reason === "string" && card.meta.rejected_reason && (
            <div className="mt-1 text-red-600">Rejected: {card.meta.rejected_reason}</div>
          )}
        </div>
      )}

      {card.type === "email" && card.source === "slack_agent_tasks" && (
        <KlaviyoBuildPanel card={card} />
      )}

      {/* An email campaign already pushed to Klaviyo: its DESIGN lives there,
          not in this database, so link straight to the wizard rather than
          leaving the reviewer to hunt for it by name. Not the build panel —
          that posts a slack task id and would fail on a campaign row. */}
      {card.source === "agent_email_campaigns" && card.meta?.klaviyo_campaign_id && (
        <a
          href={`https://www.klaviyo.com/campaign/${card.meta.klaviyo_campaign_id}/wizard`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline"
        >
          View design &amp; send in Klaviyo →
        </a>
      )}

      {/* WHAT THIS CUT MADE, AND WHAT IT DID NOT.
          An absent piece used to be indistinguishable from a piece that was
          never wanted — the board simply had fewer cards. Naming each gap and
          what would close it is the whole difference between "missing all the
          content" and a checklist. */}
      {card.spine && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
            <Film className="w-3 h-3" />
            {piecesSummary(card.spine)}
          </div>
          <div className="flex flex-wrap gap-1">
            {card.spine.made.map((k) => (
              <span
                key={k}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  k === card.pieceKind
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-100 text-emerald-800"
                }`}
                title={k === card.pieceKind ? "This card" : "Same file, shown on its own tab"}
              >
                {PIECE_LABEL[k]}
              </span>
            ))}
          </div>
          {card.spine.missing.map((m) => (
            <div key={m.kind} className="text-[10px] leading-snug text-amber-800">
              <span className="font-semibold">{m.label} — not made.</span> {m.reason}
            </div>
          ))}
        </div>
      )}

      {/* WHY THIS PIECE EXISTS — the brain's refusal (if any), the viral score
          of the footage behind it, and the brand interest it serves. Placed
          directly ABOVE the editor-brain panel so the headline reason is read
          first and the full reasoning sits underneath it, rather than the
          operator having to infer the verdict from a wall of decisions. */}
      {/* NOT AN EDIT — for the two kinds CardSignals cannot speak for. It
          prints the stub reason only behind a brain REFUSAL, so a frame grab or
          a one-clip stub with no refusal recorded had nowhere to say what it
          was. Rendered only when the refusal panel below will not already say
          it, so the dialog never states the same thing twice. */}
      {(() => {
        const f = machineFailure(card);
        if (!f || f.primary === "brain_refused") return null;
        return (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {failureLabel(f)} — this rendered, but it is not an edit
            </div>
            <p className="mt-1 text-[10px] leading-snug text-red-700">
              {f.reason || FAILURE_META[f.primary].blurb}
            </p>
          </div>
        );
      })()}

      <CardSignals
        brainStatus={card.brainStatus}
        stubReason={card.stubReason}
        footage={card.footage}
        interest={matchBrandInterest(`${card.title} ${card.text}`, card.brand)}
        className="mt-3"
      />

      {/* REAL BRAND-SCOPED PRODUCTION. These are not route shortcuts and they
          do not relabel the generic fan-out: each control plans and runs a
          canonical server action against this exact source job. A completed
          BTI output carries its original source job + human credit in metadata,
          so opening the resulting card exposes the fields for a safe revision. */}
      {card.renderJobId && (card.brand === "wraptvworld" || card.brand === "weprintwraps") && (
        <BrandBoardShowActions
          renderJobId={card.renderJobId}
          brand={card.brand}
          initialInstallerHandle={card.meta?.featured_installer_handle || null}
          initialInstallerLocation={card.meta?.featured_installer_location || null}
          initialMusicUrl={card.meta?.music_url || null}
          initialMusicTitle={card.meta?.music_title || null}
          initialMusicSelectionMode={
            card.meta?.music_selection_mode === "manual"
              || (card.showFormat === "behind_the_install" && card.meta?.music_url && !card.meta?.music_assignment_key)
              ? "manual"
              : "auto"
          }
          initialMusicReuseGroupKey={card.meta?.music_reuse_group_key || null}
          onQueued={() => queryClient.invalidateQueries({ queryKey: ["brand-board-all"] })}
        />
      )}

      {/* THE EDITOR BRAIN — what it did, and why, for THIS cut.
          Directly above the approve/rate control on purpose: the reasoning is
          what the human is judging, and a decision nobody can see is a decision
          nobody can check. No `onRunBrain` is passed because nothing on this
          board runs the brain — a button that did nothing would be a worse lie
          than its absence. With no stored reasoning the panel says so itself,
          in a sentence that names the cause and the next step. */}
      {card.renderJobId && (
        <EditorBrainPanel
          report={brain?.report ?? null}
          hasCut={Boolean(card.mediaUrl || renderJob?.final_url)}
          cutId={card.renderJobId}
          jobs={renderJob ? [{ id: String(renderJob.id), status: String(renderJob.status || ""), kind: "render" }] : undefined}
          // The row's own verdict, so the panel can tell "the brain refused"
          // apart from "the brain never ran". `no_beats` stores a NULL
          // reasoning object, so without this the panel printed "never run" on
          // 20 jobs where it had in fact run and answered.
          storedVerdict={card.brainStatus}
          stubReason={card.stubReason}
        />
      )}

      {/* PER-PIECE REVIEW. Approve or decline THIS piece, and rate it 1–10.
          The rating is a human prediction — "this is great work" — and is kept
          deliberately separate from the audience signal that drives paid
          promotion (views ≥ 2× the brand's median, see contentDoctrine). They
          disagree often enough that collapsing them would lose the
          information. Both are recorded; neither overrides the other. */}
      {card.source === "agent_social_posts" && (
        <PieceReviewPanel card={card} />
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-slate-400">
          {cfg.label}
          {card.date && <> · {format(parseISO(card.date), "MMM d, yyyy")}</>}
        </span>
        <div className="flex items-center gap-2">
          {card.mediaUrl && (
            <a
              href={card.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-slate-600 hover:text-blue-600 flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Open media
            </a>
          )}
          {card.canvaDesignId && (
            <button
              type="button"
              onClick={openCanvaDesign}
              disabled={canvaLinkBusy}
              className="text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50 flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              {canvaLinkBusy ? "Opening Canva…" : "Edit in Canva"}
            </button>
          )}
          {editorPath && (
            <Link
              to={editorPath}
              className="text-xs font-medium text-blue-600 hover:text-pink-600 flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Refine in {editorLabel}
            </Link>
          )}

          {/* ONE CUT → FOUR PIECES. Longform, Reel, YouTube Short and a Canva
              graphic, all hung off one narrative. Any brand, not just
              WrapTVWorld — the spine is ecosystem-wide. */}
          {card.renderJobId && <VideoFanOutButton renderJobId={card.renderJobId} />}

          {/* WRAPTVWORLD DELIVERY. The publisher already existed — content-deploy's
              publishWrapTVSite writes wraptv_site_content, which is what
              weprintwraps.com/wraptvworld renders — and had been used exactly
              ONCE, because nothing ever created a wraptv_site post. These are
              that missing button. */}
          {card.renderJobId && card.brand === "wraptvworld" && (
            <>
              <button
                onClick={sendToSite}
                disabled={!!wtwBusy}
                className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-pink-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                title="Publishes to weprintwraps.com/wraptvworld within ~5 minutes"
              >
                {wtwBusy === "site" ? "Sending…" : "Send to WrapTVWorld site →"}
              </button>
              <button
                onClick={makeYouTubeCaption}
                disabled={!!wtwBusy}
                className="rounded-lg border border-red-300 px-2.5 py-1 text-[11px] font-bold text-red-700 disabled:opacity-50"
                title="Writes the title + description. There is no YouTube auto-publisher — upload by hand."
              >
                {wtwBusy === "yt" ? "Writing…" : "YouTube caption"}
              </button>
            </>
          )}
          {/* Approval is the higher-up's call. Someone without the role sees
              why the buttons are missing rather than a silent failure. */}
          {pendingLegacy && !isApprover && !approverLoading && (
            <span className="text-[11px] text-slate-400">
              {/* Names the RULE, not a person. "Waiting on an approver" left
                  every teammate to guess it meant one specific someone. */}
              Waiting on an admin to approve — you can still fix the copy.
            </span>
          )}
          {pendingLegacy && isApprover && (
            <Button
              size="sm"
              variant="outline"
              onClick={reject}
              disabled={approving !== null}
              className="h-8 border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-600"
            >
              {approving === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          )}
          {canApprove && (
            <Button
              size="sm"
              onClick={approve}
              disabled={approving !== null}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 h-8"
            >
              {approving === "approve" ? "Approving…" : "✓ Approve"}
            </Button>
          )}
          {cfg.editField && (
            <Button
              size="sm"
              onClick={save}
              disabled={saving || text === card.text}
              className="bg-gradient-to-r from-blue-600 to-pink-600 text-white border-0 h-8"
            >
              {saving ? "Saving…" : "Save copy"}
            </Button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminBrandBoard() {
  const { data: board, isLoading } = useBrandBoardData();
  const cards = board?.cards ?? [];
  const failures = board?.failures ?? [];
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [showQueue, setShowQueue] = useState(false);
  // Queued work follows the brand filter, so "Queued work" under WrapTVWorld
  // answers "what is building for THIS brand" rather than for everything.
  const queueJobs = useMemo(
    () => (board?.queue ?? []).filter((j) => brandFilter === "all" || j.brand === brandFilter),
    [board?.queue, brandFilter],
  );
  const queueSummary = useMemo(() => summarizeQueue(queueJobs), [queueJobs]);
  const [typeFilter, setTypeFilter] = useState<TypeKey | "all">("all");
  const [templateFilter, setTemplateFilter] = useState<TemplateKey | "all">("all");
  const [selected, setSelected] = useState<BoardCard | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const boardQueryClient = useQueryClient();

  // DEEP LINK FROM THE CONTENT DIRECTOR — ?card=<source>:<id>.
  //
  // The Director hands made pieces over to this board. A handoff that dumps
  // someone on a board of hundreds of cards to go hunt for the one they just
  // clicked is not a handoff, so the link opens the PIECE. Fires once per id:
  // the URL is left alone so the link stays shareable, and reopening on every
  // refetch would make the dialog un-closable.
  const [cardParams] = useSearchParams();
  const focusCard = cardParams.get("card");
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCard || openedRef.current === focusCard || !cards.length) return;
    const want = parseBrandBoardCardParam(focusCard);
    if (!want) return;
    const hit = cards.find((c) => c.id === want.id && c.source === want.source)
      // The Director keys email campaigns to their own table; a card that moved
      // tables is still worth opening if the id matches uniquely.
      || cards.find((c) => c.id === want.id);
    openedRef.current = focusCard;
    if (hit) setSelected(hit);
    else toast.error("That piece isn't on the board — it may have been deleted or not loaded yet.");
  }, [focusCard, cards]);

  /**
   * Delete a card for good — for the ones not worth opening to edit.
   *
   * The board unions ~18 tables, and each card already carries the table it
   * came from (`source`), so the delete goes to the right one. Two things this
   * deliberately does NOT do:
   *  - It does not optimistically drop the card. Not every one of those tables
   *    grants delete to authenticated staff, and a card that vanished from the
   *    screen but survived in the database would reappear on the next refetch
   *    with no explanation. So it asks the row back (`.select("id")`) and only
   *    reports success when a row actually came back.
   *  - It does not cascade. Deleting a board card removes THAT record, not the
   *    published post, the render, or the asset it may point at.
   */
  const deleteCard = useCallback(async (card: BoardCard) => {
    const label = card.title?.slice(0, 60) || "this card";
    if (!window.confirm(`Delete "${label}" permanently?\n\nThis removes the record from ${card.source}. It cannot be undone.`)) return;
    try {
      const { data, error } = await (supabase as any)
        .from(card.source)
        .delete()
        .eq("id", card.id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) {
        // RLS refused it, or something else already removed it. Either way the
        // honest answer is "it's still there", not a success toast.
        toast.error(`Couldn't delete it — ${card.source} didn't allow the delete. Nothing was removed.`);
        return;
      }
      toast.success("Deleted.");
      boardQueryClient.invalidateQueries({ queryKey: ["brand-board-all"] });
    } catch (e: unknown) {
      toast.error("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [boardQueryClient]);

  // ── PROVENANCE ────────────────────────────────────────────────────────────
  //
  // "I dont see jacksons cards add a sort by team member, tonights 12????"
  // (owner, 2026-08-07). Both facts were loaded and neither reached a tile.
  // The chips are counted off the cards themselves, so a pipeline that starts
  // producing tomorrow gets its own chip with no code change — see
  // boardProvenance.provenanceOptions.
  //
  // Applied to the WHOLE population, exactly like the brand chips, so the
  // ribbon and the lane counts move with it: "Jackson's cards" should answer
  // "what of his needs me" too, not just narrow one grid.
  const [makerFilter, setMakerFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  // WHICH SHOW. Applied to the whole population like the others, so picking
  // Behind the Install answers "what of it needs me" as well as narrowing the
  // grid — reviewing a show means seeing its stuck pieces too.
  const [showFilter, setShowFilter] = useState<string | null>(null);

  const brandFiltered = useMemo(() => {
    const byBrand = brandFilter === "all" ? cards : cards.filter((c) => c.brand === brandFilter);
    const byMaker = makerFilter ? byBrand.filter((c) => c.provenance === makerFilter) : byBrand;
    const byPerson = personFilter ? byMaker.filter((c) => matchesPerson(c, personFilter)) : byMaker;
    return showFilter ? byPerson.filter((c) => String(c.showFormat || "") === showFilter) : byPerson;
  }, [cards, brandFilter, makerFilter, personFilter, showFilter]);

  // Options are derived from everything this brand has, NOT from the already
  // provenance-filtered list — otherwise picking one chip would delete all the
  // others and there would be no way back except reloading the page.
  const provenanceScope = useMemo(
    () => (brandFilter === "all" ? cards : cards.filter((c) => c.brand === brandFilter)),
    [cards, brandFilter],
  );
  const makerOptions = useMemo(() => provenanceOptions(provenanceScope), [provenanceScope]);
  const peopleOptions = useMemo(() => personOptions(provenanceScope), [provenanceScope]);
  // Labels come from SHOW_FORMATS so a show is named the same on this board as
  // in the router and the editor.
  const showChipOptions = useMemo(
    () => showOptions(provenanceScope, (k) => SHOW_FORMATS.find((f) => f.key === k)?.label || ""),
    [provenanceScope],
  );
  const showsUnrecorded = useMemo(() => unshownCount(provenanceScope), [provenanceScope]);

  // FINISHED WORK — the lane this board existed for and never had.
  //
  // Measured 2026-08-05: of 670 cards created in the previous 7 days, 505 were
  // hooks, 98 were tasks, 58 were captionless drafts, and NINE were finished
  // pieces. Finished work was 1.3% of the board and every tab mixed it in with
  // the ideas, so opening the board to review designs showed whatever happened
  // to be visible last time. The content was never missing — there was nowhere
  // to see it. Rule lives in src/lib/brandBoardFinished.ts.
  // ── THE ATTENTION RIBBON — "what needs me, what is happening without me" ──
  //
  // POPULATION: produced work only. Ideas, tasks and templates are excluded by
  // the same `IDEA_SOURCES` denylist the Finished lane uses, because a lane
  // count is only trustworthy if its DENOMINATOR is the population that can
  // actually be in that state — 505 hooks reported as "waiting" would drown
  // every real number on the ribbon.
  //
  // Failed renders ARE in the population even though they have no media: a dead
  // render is produced work that broke, and it having no thumbnail is precisely
  // why it was invisible before.
  const [lane, setLane] = useState<Lane | null>(null);
  const laneNow = useMemo(() => new Date(), [board]);
  const workCards = useMemo(
    () => brandFiltered.filter((c) => !IDEA_SOURCES.has(String(c.source || ""))),
    [brandFiltered],
  );
  const laneInput = useCallback(
    (c: BoardCard) => ({
      source: c.source,
      status: c.status,
      date: c.date,
      hasMedia: !!posterFor(c) || hasPlayableVideo(c),
      building: c.building,
      brainStatus: c.brainStatus,
      // A frame grab, a one-clip stub or a refused cut is STUCK, not finished.
      // ~97 tiles were the system reporting a failure and painting it exactly
      // like work — "Brand Board shows no real content. All AI slop."
      machineFailure: isMachineFailure(c),
    }),
    [],
  );
  const laneCounts = useMemo(
    () => countLanes(workCards.map(laneInput), laneNow),
    [workCards, laneInput, laneNow],
  );
  const publishNote = useMemo(
    () => (board?.publish ? publishReality(board.publish) : null),
    [board],
  );

  const finishedSplit = useMemo(() => splitFinished(brandFiltered), [brandFiltered]);

  // ── THE SLOP ──────────────────────────────────────────────────────────────
  //
  // Owner, 2026-08-07, looking at this lane: "Brand Board shows no real
  // content. All AI slop." Measured the same day over 140 completed renders:
  // 49 frame grabs, 42 one-clip stubs, 42 refusals — union 52, plus 45 posts
  // carrying a stub creative. Roughly two thirds of the tiles were the system
  // reporting a failure, painted identically to finished work.
  //
  // They are MOVED, not deleted and not hidden: every one is in the Stuck lane,
  // which Content Director owns and works (see boardAttention's LaneSurface), with
  // the pipeline's own explanation printed above the grid, because "the footage
  // does not carry the angle" is what tells the crew what to reshoot. Deleting
  // rows to clean a view would delete work awaiting approval — see
  // brandBoardDedupe's header for why that instinct keeps being wrong here.
  const finishedReal = useMemo(
    () => finishedSplit.finished.filter((c) => !isMachineFailure(c)),
    [finishedSplit.finished],
  );
  const finishedSlop = finishedSplit.finished.length - finishedReal.length;

  const ideaCount = useMemo(
    () => brandFiltered.filter((c) => IDEA_SOURCES.has(String(c.source || ""))).length,
    [brandFiltered],
  );

  // ── THE REPETITION ────────────────────────────────────────────────────────
  //
  // Measured 2026-08-07: 267 finished cards resolve to 164 distinct media
  // files, and the 60 tiles this lane actually paints resolve to 34 — so
  // nearly half of what an operator sees is a file already on the screen. One
  // cut appeared six times. The cause is the per-channel fan-out (one 9:16
  // file is genuinely the Reel AND the Short AND the TikTok post, each its own
  // row awaiting its own approval) rendered into a flat grid that never said
  // so. Rules and numbers live in src/lib/brandBoardDedupe.ts.
  //
  // Grouped is the DEFAULT because it is the view that answers "what have we
  // made"; the toggle is there because the other question — "which pieces am I
  // approving" — is equally real, and hiding rows with no way back would be
  // the same disappearing act this board keeps being accused of.
  const [groupFinished, setGroupFinished] = useState(true);

  // WHAT THE LANE SHOWS. With no lane selected this is the Finished lane exactly
  // as before. With one selected it is that lane out of the PRODUCED-WORK
  // population — which is deliberately a different set, because `stuck` is
  // mostly cards `splitFinished` throws away: a failed render has no media, and
  // filtering the finished list by lane would show an empty Stuck tab beside a
  // ribbon reporting twelve.
  const laneCards = useMemo(
    () => (lane === null
      ? finishedReal
      : workCards.filter((c) => laneOf(laneInput(c), laneNow) === lane)),
    [lane, finishedReal, workCards, laneInput, laneNow],
  );

  // The pipeline's own sentences for whatever is on screen, grouped. Three of
  // them cover all 43 stub renders in production, so it is printed once with a
  // count instead of stamped on forty tiles. See StuckReasons.
  const laneFailures = useMemo(() => failureReasons(laneCards), [laneCards]);
  const laneFailureCount = useMemo(
    () => laneFailures.reduce((n, r) => n + r.count, 0),
    [laneFailures],
  );

  const finishedGroups = useMemo(
    () => groupByMedia(laneCards),
    [laneCards],
  );
  const finishedSummary = useMemo(() => summarizeGroups(finishedGroups), [finishedGroups]);
  const finishedVisible = useMemo(
    () => (groupFinished ? finishedGroups.map((g) => g.card) : laneCards),
    [groupFinished, finishedGroups, laneCards],
  );
  // Card id → its badge, resolved once. Looked up per tile during render.
  const finishedBadges = useMemo(() => {
    const map = new Map<string, string>();
    if (!groupFinished) return map;
    for (const g of finishedGroups) {
      const badge = groupBadge(g, (t) => TYPE_META[t as TypeKey]?.label || t);
      if (badge) map.set(`${g.card.source}-${g.card.id}`, badge);
    }
    return map;
  }, [groupFinished, finishedGroups]);

  // CONTENT SETS — "I approved that idea, what came out of it?"
  //
  // The sets themselves are grouped once in the data hook. Here they are only
  // narrowed: by the same brand chips every other tab uses, then by the search
  // box. Search goes through `searchSets` rather than a local `.filter()` so
  // "find our cards" matches on the same normalised topic key the grouping
  // used — a search that tokenised differently from the grouping would fail to
  // find a set that plainly exists, which is indistinguishable from the set
  // being absent.
  const [setQuery, setSetQuery] = useState("");
  const allSets = board?.sets ?? [];
  const visibleSets = useMemo(() => {
    const byBrand = brandFilter === "all" ? allSets : allSets.filter((s) => s.brand === brandFilter);
    return searchSets(byBrand, setQuery);
  }, [allSets, brandFilter, setQuery]);

  // Piece → the card the detail dialog already knows how to open. Indexed once;
  // a set grid is up to eleven lookups per card and this board carries
  // thousands of cards.
  const socialCardById = useMemo(() => {
    const map = new Map<string, BoardCard>();
    for (const c of cards) if (c.source === "agent_social_posts") map.set(String(c.id), c);
    return map;
  }, [cards]);
  const findSetCard = useCallback(
    (piece: SetPiece) => (piece.id ? socialCardById.get(String(piece.id)) ?? null : null),
    [socialCardById],
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of brandFiltered) counts[c.type] = (counts[c.type] || 0) + 1;
    return counts;
  }, [brandFiltered]);

  const templateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of brandFiltered) counts[c.template] = (counts[c.template] || 0) + 1;
    return counts;
  }, [brandFiltered]);

  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of cards) counts[c.brand] = (counts[c.brand] || 0) + 1;
    return counts;
  }, [cards]);

  const brandChips = (
    <div className="mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ColorPill active={brandFilter === "all"} color="#0f172a" label="All Brands" count={cards.length} onClick={() => setBrandFilter("all")} />
        {BRAND_KEYS.map((k) => (
          <ColorPill
            key={k}
            active={brandFilter === k}
            color={BOARD_BRANDS[k].color}
            label={BOARD_BRANDS[k].label}
            count={brandCounts[k] || 0}
            onClick={() => setBrandFilter(k)}
          />
        ))}
        {/* QUEUED WORK. Work in flight was completely invisible here: a render
            that is still going has no thumbnail, so `isFinishedWork` correctly
            excludes it from the Finished lane — and there was nowhere else for
            it to appear. The board therefore looked identical whether six jobs
            were running or none were, which is most of what "nothing is
            happening" actually was. Same colour formula as every other pill. */}
        <ColorPill
          active={showQueue}
          color="#F59E0B"
          label="Queued work"
          count={queueJobs.length}
          icon={Clock}
          onClick={() => setShowQueue((v) => !v)}
        />
      </div>

      {showQueue && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-amber-900">{queueLabel(queueJobs)}</span>
            <span className="text-[11px] font-semibold text-amber-800">{queueSummary.percent}%</span>
          </div>
          {/* One bar for the whole queue, then one per job. The aggregate is
              the answer to "is anything happening"; the per-job rows are the
              answer to "what is stuck". */}
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${queueSummary.percent}%` }} />
          </div>

          {queueJobs.length === 0 ? (
            <p className="mt-2 text-[11px] text-amber-800">
              Nothing is queued. That is idle, not broken — the renderer polls every few seconds.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {queueJobs.slice(0, 12).map((j) => {
                const pct = progressFor(j);
                return (
                  <div key={j.id} className="rounded-lg bg-white p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-slate-800">{j.label || j.id}</span>
                      <span className={`shrink-0 text-[10px] font-bold ${isFailed(j) ? "text-red-600" : "text-slate-500"}`}>
                        {statusLabel(j)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${isFailed(j) ? "bg-red-500" : isDone(j) ? "bg-emerald-500" : "bg-blue-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {queueJobs.length > 12 && (
                <p className="text-[10px] text-amber-800">+{queueJobs.length - 12} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1600px] mx-auto px-4 py-6">
        <div className="mb-4"><MarketingSystemMap page="brandboard" /></div>
        {/* Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Brand{" "}
                <span className="bg-gradient-to-r from-blue-600 to-pink-600 bg-clip-text text-transparent">Board</span>
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {cards.length > 0 ? `${cards.length.toLocaleString()} pieces of content` : "Every piece of content"} across the ecosystem —
                sorted by type, template, and brand. Click a card to read or edit its copy.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <YouTubeConnectionButton />
              {/* The back-catalog door. Everything NEW still comes from the
                  Content Director — this is for what we already made. */}
              <button
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-400 hover:text-blue-600"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Content
              </button>
              <Link
                to="/admin/marketing-hub"
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-pink-600 hover:shadow-md transition-shadow flex items-center gap-1.5"
              >
                <Megaphone className="w-3.5 h-3.5" />
                Marketing Hub
              </Link>
              <Link
                to="/admin/marketing-hub?tab=calendar"
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-blue-500 to-purple-600 hover:shadow-md transition-shadow flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5" />
                Content Calendar
              </Link>
              <Link
                to="/admin/content-director"
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-md transition-shadow flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Content Director
              </Link>
            </div>
          </div>
        </div>

        {/* A source that failed says so. Silently rendering an empty board is
            how "all the content is gone" becomes unexplainable. */}
        {failures.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <div className="text-sm font-bold text-amber-900">
              {failures.length} content source{failures.length === 1 ? "" : "s"} failed to load —
              cards from {failures.length === 1 ? "it" : "them"} are missing from this board.
            </div>
            <ul className="mt-1 space-y-0.5">
              {failures.map((f) => (
                <li key={f.source} className="text-xs text-amber-800">
                  <span className="font-mono font-semibold">{f.source}</span>: {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLoading ? (
          <div className="text-slate-500 text-center py-16">Loading content…</div>
        ) : (
          <>
          {/* THE RIBBON — above the tabs, because the tabs are a TAXONOMY and
              the operator's question is not taxonomic. "Reels (48)" cannot tell
              you whether anything is waiting on you. */}
          <AttentionRibbon
            counts={laneCounts}
            active={lane}
            onSelect={setLane}
            publishNote={publishNote}
            publishBlocked={!!board?.publish && board.publish.known && !board.publish.metaConnected}
          />
          <Tabs defaultValue="finished">
            <TabsList className="bg-white border border-slate-200 mb-4">
              {/* FIRST and DEFAULT. This board is where humans review, approve
                  and revise finished designs — so finished work leads, instead
                  of being 1.3% of a pile of hooks and tasks. */}
              <TabsTrigger value="finished" className="text-xs font-bold">
                ✅ Finished Work
                {/* The count is REAL work only. It used to include the frame
                    grabs and stubs, so the badge asserted a volume of finished
                    output that did not exist. */}
                {finishedReal.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                    {finishedReal.length}
                  </span>
                )}
              </TabsTrigger>
              {/* CONTENT SETS. Sits directly behind Finished Work because it
                  answers the question a reviewer has the moment AFTER they
                  look at a finished piece: what else did that idea produce,
                  and what is still outstanding. */}
              <TabsTrigger value="sets" className="text-xs font-bold">
                <Layers className="mr-1 h-3 w-3" />
                Content Sets
                {allSets.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold text-indigo-700">
                    {allSets.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="type" className="text-xs">By Content Type</TabsTrigger>
              <TabsTrigger value="template" className="text-xs">By Template</TabsTrigger>
              <TabsTrigger value="brand" className="text-xs">By Brand</TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs">Calendar</TabsTrigger>
            </TabsList>

            {/* FINISHED WORK — produced artwork only: something a human can
                actually look at and approve. Ideas, tasks and templates are
                excluded by source; a draft with no artwork is excluded because
                it has nothing to review. */}
            <TabsContent value="finished">
              {brandChips}
              {/* WHO MADE IT. Options counted off the cards, never listed in
                  code, so a new pipeline appears here on its own. */}
              <ProvenanceFilter
                options={makerOptions}
                people={peopleOptions}
                maker={makerFilter}
                onMaker={setMakerFilter}
                person={personFilter}
                onPerson={setPersonFilter}
                shows={showChipOptions}
                unshown={showsUnrecorded}
                show={showFilter}
                onShow={setShowFilter}
              />
              {/* THE BOARD IS FINISHED WORK. NOTHING ELSE.
                  Owner, 2026-08-10: "Brand board shows completed and we either
                  approve for calendar or revise and edit."

                  A red banner counting 174 failures, and a panel of pieces
                  waiting on a human, both used to sit here. The COUNT was
                  true — two thirds of what this tab showed was not an edit —
                  but putting the failures on the board solved "the badge is
                  lying" by creating "the gallery is a work queue." That is not
                  what this screen is for.

                  Nothing is deleted and nothing is hidden. The counts are on
                  the ribbon above, in the HANDOFF strip, which names them and
                  links to the page that owns them — Content Director, where
                  the Assist now lives (see boardAttention's LaneSurface). From
                  that strip a refusal and its reason are still one click away
                  for anyone who goes LOOKING; a failed render is not an idea
                  and has no row in the Director's queue, so being able to look
                  at it from here matters. It simply does not greet you on the
                  tab whose job is to show what is DONE. */}
              {/* When a lane is selected the grid IS that lane, so the heading
                  says which — otherwise clicking "Stuck" and landing on a tab
                  still titled Finished Work reads as a filter that did nothing. */}
              {lane && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-xs font-bold text-slate-800">
                    {LANE_BY_KEY[lane].label}
                  </span>
                  <span className="text-[11px] text-slate-500">{LANE_BY_KEY[lane].blurb}</span>
                  <button
                    onClick={() => setLane(null)}
                    className="ml-auto text-[11px] font-semibold text-slate-500 underline hover:text-slate-900"
                  >
                    Show all finished work
                  </button>
                </div>
              )}
              {laneCards.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white py-12 text-center">
                  <Bot className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-700">
                    {lane ? `Nothing is ${LANE_BY_KEY[lane].label.toLowerCase()}.` : "No finished work here yet."}
                  </p>
                  {/* Never a bare "nothing here" — an empty view that says
                      nothing is indistinguishable from a broken one. An empty
                      STUCK lane is good news and should read as good news, not
                      as a failed query. */}
                  <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
                    {lane === "stuck"
                      ? "Nothing has failed, no cut was refused by the editor brain, and no scheduled post is past its date. That is the lane doing its job."
                      : lane
                        ? `No produced work is in this lane right now, out of ${workCards.length.toLocaleString()} pieces on the board.`
                        : finishedSlop > 0
                          // The honest version of "no finished work". Saying
                          // nothing here would read as an empty database when
                          // in fact the pipeline produced this many artifacts
                          // and every one of them is a failure.
                          ? `Nothing here is finished work. ${finishedSlop.toLocaleString()} piece${finishedSlop === 1 ? "" : "s"} rendered, but every one is a frame grab, a one-clip stub, or a cut the editor brain refused — they are worked in Content Director, with the reason each one gave.`
                          : emptyFinishedReason(brandFiltered.length, ideaCount)}
                  </p>
                </div>
              ) : (
                <>
                  {/* THE REFUSAL, VERBATIM. A refusal is genuinely useful — it
                      names the clip and the fix, which is a reshoot list. It is
                      printed once per distinct sentence with a count, because
                      three sentences cover all 43 stub renders and stamping the
                      same paragraph on forty tiles gets it read zero times. */}
                  {/* ONLY when you have gone and asked to look at the stuck
                      pile. This used to render on the DEFAULT Finished Work
                      view, which is the screen somebody opens to look at work —
                      so the gallery led with a reshoot list. Owner, 2026-08-10:
                      "That's a work queue wearing the gallery's clothes."
                      Diagnosis is still worth having HERE (it names what to
                      reshoot); the ASSIST that acts on it moved to Content
                      Director, which is the page that owns this lane. */}
                  {lane === "stuck" && (
                    <StuckReasons reasons={laneFailures} total={laneFailureCount} />
                  )}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {/* Same colour formula as every other control here: tinted
                        when idle, SOLID with white text when it is the view you
                        are in (see ColorPill / ChannelAngleCard). */}
                    {([
                      { on: true, label: "Grouped by file", count: finishedSummary.files },
                      { on: false, label: "Every piece", count: finishedSummary.pieces },
                    ]).map((o) => (
                      <ColorPill
                        key={String(o.on)}
                        active={groupFinished === o.on}
                        color="#4F46E5"
                        label={o.label}
                        count={o.count}
                        icon={Layers}
                        onClick={() => setGroupFinished(o.on)}
                      />
                    ))}
                  </div>
                  <p className="mb-3 text-xs text-slate-500">
                    {groupingLine(finishedSummary, groupFinished)}
                    {ideaCount > 0 && (
                      <> The other {ideaCount.toLocaleString()} card{ideaCount === 1 ? " is an idea" : "s are ideas"}, task
                      {ideaCount === 1 ? "" : "s"} or templates; they live in the tabs to the right.</>
                    )}
                  </p>
                  <CardGrid
                    cards={finishedVisible}
                    onSelect={setSelected}
                    onDelete={deleteCard}
                    badgeFor={(c) => finishedBadges.get(`${c.source}-${c.id}`) || ""}
                  />
                </>
              )}
            </TabsContent>

            {/* CONTENT SETS — one idea, grouped, with its gaps named.
                Everything else on this board is a flat list, and a flat list
                cannot say whether an approved idea is finished. */}
            <TabsContent value="sets">
              <div className="mb-3 flex items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={setQuery}
                  onChange={(e) => setSetQuery(e.target.value)}
                  placeholder="Find an idea…"
                  className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                />
                {setQuery && (
                  <button
                    onClick={() => setSetQuery("")}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Clear
                  </button>
                )}
              </div>
              {brandChips}

              {visibleSets.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white py-12 text-center">
                  <Layers className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-700">No sets to show.</p>
                  {/* Never a bare "nothing here". An empty view that does not
                      say WHY reads exactly like a broken one — that is how a
                      dead parser went unnoticed for twelve days. Each of the
                      three reasons a set can be absent gets named. */}
                  <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
                    {setQuery
                      ? <>Nothing matches “{setQuery}”. {allSets.length.toLocaleString()} set{allSets.length === 1 ? "" : "s"} exist{allSets.length === 1 ? "s" : ""} — search matches the topic or the brand, not the caption body.</>
                      : allSets.length > 0
                        ? <>{allSets.length.toLocaleString()} set{allSets.length === 1 ? "" : "s"} loaded, but none belongs to this brand. Pick another brand chip, or All Brands.</>
                        : <>Sets are grouped by TOPIC, and none of the {socialCardById.size.toLocaleString()} social post{socialCardById.size === 1 ? "" : "s"} on the board carries one yet — a piece needs a narrative topic or a first line of copy of at least 8 characters to key a set to. A piece with neither is left out on purpose: guessing a grouping would merge unrelated work and make every count on this screen a lie.</>}
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-xs text-slate-500">
                    {visibleSets.length.toLocaleString()} set{visibleSets.length === 1 ? "" : "s"} — newest first.
                    Every channel is shown, including the ones nothing was made for.
                  </p>
                  <div className="grid gap-2.5 lg:grid-cols-2">
                    {visibleSets.slice(0, 60).map((s) => (
                      <ContentSetCard
                        key={s.key}
                        set={s}
                        openId={selected?.source === "agent_social_posts" ? String(selected.id) : null}
                        findCard={findSetCard}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                  {visibleSets.length > 60 && (
                    <p className="mt-2.5 text-center text-xs text-slate-500">
                      Showing the 60 most recent of {visibleSets.length.toLocaleString()} — search to narrow it.
                    </p>
                  )}
                </>
              )}
            </TabsContent>

            {/* By Content Type */}
            <TabsContent value="type">
              {brandChips}
              <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                <ColorPill active={typeFilter === "all"} color="#0f172a" label="All" count={brandFiltered.length} onClick={() => setTypeFilter("all")} />
                {TYPE_ORDER.map((t) => (
                  <ColorPill
                    key={t}
                    active={typeFilter === t}
                    color={TYPE_META[t].color}
                    label={TYPE_META[t].label}
                    count={typeCounts[t] || 0}
                    icon={TYPE_META[t].icon}
                    onClick={() => setTypeFilter(t)}
                  />
                ))}
              </div>
              {typeFilter === "all" ? (
                TYPE_ORDER.filter((t) => (typeCounts[t] || 0) > 0).map((t) => (
                  <div key={t}>
                    <SectionHeader color={TYPE_META[t].color} label={TYPE_META[t].label} count={typeCounts[t] || 0} icon={TYPE_META[t].icon} />
                    <CardGrid cards={brandFiltered.filter((c) => c.type === t)} onSelect={setSelected} onDelete={deleteCard} />
                  </div>
                ))
              ) : (
                <CardGrid cards={brandFiltered.filter((c) => c.type === typeFilter)} onSelect={setSelected} onDelete={deleteCard} />
              )}
            </TabsContent>

            {/* By Template */}
            <TabsContent value="template">
              {brandChips}
              <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                <ColorPill active={templateFilter === "all"} color="#0f172a" label="All" count={brandFiltered.length} onClick={() => setTemplateFilter("all")} />
                {TEMPLATE_ORDER.map((t) => (
                  <ColorPill
                    key={t}
                    active={templateFilter === t}
                    color={TEMPLATE_META[t].color}
                    label={TEMPLATE_META[t].label}
                    count={templateCounts[t] || 0}
                    icon={TEMPLATE_META[t].icon}
                    onClick={() => setTemplateFilter(t)}
                  />
                ))}
              </div>
              {templateFilter === "all" ? (
                TEMPLATE_ORDER.filter((t) => (templateCounts[t] || 0) > 0).map((t) => (
                  <div key={t}>
                    <SectionHeader color={TEMPLATE_META[t].color} label={TEMPLATE_META[t].label} count={templateCounts[t] || 0} icon={TEMPLATE_META[t].icon} />
                    <CardGrid cards={brandFiltered.filter((c) => c.template === t)} onSelect={setSelected} onDelete={deleteCard} />
                  </div>
                ))
              ) : (
                <CardGrid cards={brandFiltered.filter((c) => c.template === templateFilter)} onSelect={setSelected} onDelete={deleteCard} />
              )}
            </TabsContent>

            {/* By Brand — full ecosystem, every brand shown even at zero */}
            <TabsContent value="brand">
              {BRAND_KEYS.map((k) => {
                const brand = BOARD_BRANDS[k];
                const brandCards = cards.filter((c) => c.brand === k);
                return (
                  <div key={k}>
                    <SectionHeader color={brand.color} label={brand.label} count={brandCards.length} />
                    <CardGrid cards={brandCards} onSelect={setSelected} onDelete={deleteCard} />
                  </div>
                );
              })}
            </TabsContent>

            {/* Calendar */}
            <TabsContent value="calendar">
              {brandChips}
              <BoardCalendar cards={brandFiltered} onSelect={setSelected} />
            </TabsContent>
          </Tabs>
          </>
        )}

        {/* Detail dialog */}
        <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
          {selected && <CardDetail card={selected} onClose={() => setSelected(null)} />}
        </Dialog>

        {/* Upload our own finished content */}
        <BrandBoardUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          brands={BOARD_BRANDS}
          defaultBrand={brandFilter === "all" ? "restylepro" : brandFilter}
          onUploaded={() => boardQueryClient.invalidateQueries({ queryKey: ["brand-board-all"] })}
        />
      </div>
    </div>
  );
}
