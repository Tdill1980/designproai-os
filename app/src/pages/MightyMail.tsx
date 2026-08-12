/**
 * MightyMail — shop-facing email templates & digital downloads library.
 *
 * Three tabs:
 *  1. Templates — browse, filter by voice (formal/witty) + category, preview,
 *     and one-click send to any customer via send-templated-email edge function.
 *  2. Downloads — branded PDFs (wrap care sheet, quote template) that shop
 *     owners can preview and download. All PDFs are pre-branded with shop
 *     logo/name via the existing PDF generators.
 *  3. Scheduled — scheduled retargeting follow-ups queued via quotes.metadata
 *
 * Shop Voice selector at the top saves to shop_profiles.shop_voice and
 * auto-filters the template grid to show only the matching tone variant.
 */

import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Sparkles, Download, Eye, Send, BookOpen, FileText, Calendar,
  Search, Filter, Volume2, Rocket, Sun, Snowflake, Gift, Flame, Heart, Briefcase, Zap,
  Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, Trash2,
  Shield, GraduationCap, Lightbulb, Target, FileCheck, MessageSquareText, BrainCircuit, HeartHandshake, Star, Megaphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TemplatePreview } from "@/components/mightymail/TemplatePreview";
import type { EmailTemplate } from "@/components/mightymail/types";
import { ToolWordmark } from "@/components/dashboard/ToolWordmark";
import { generateWrapCarePDF, type WrapCarePDFData } from "@/lib/wrap-care-pdf-generator";
import { generateQuotePDF, type QuotePDFData } from "@/lib/quote-pdf-generator";

type VoiceOption = "formal" | "witty";
type CategoryFilter = "all" | "retargeting" | "order" | "sales" | "marketing" | "education";

const db = supabase as any;

// ── Voice detection from slug ─────────────────────────────────────────
const getTemplateVoice = (slug: string): VoiceOption | "neutral" => {
  if (slug.endsWith("-formal")) return "formal";
  if (slug.endsWith("-witty")) return "witty";
  return "neutral";
};

// ── Category detection from slug ───────────────────────────────────────
const getTemplateGroup = (slug: string): CategoryFilter => {
  if (slug.startsWith("retarget-") || slug.startsWith("havent-heard")) return "retargeting";
  if (slug.startsWith("order-") || slug.startsWith("install-complete")) return "order";
  if (slug.startsWith("flash-sale") || slug.startsWith("seasonal-")) return "sales";
  if (slug.startsWith("five-reasons") || slug.startsWith("trade-client") || slug.startsWith("2d-proof")) return "education";
  return "marketing";
};

const GROUP_LABELS: Record<CategoryFilter, string> = {
  all: "All Categories",
  retargeting: "Retargeting",
  order: "Order Lifecycle",
  sales: "Sales & Promo",
  marketing: "Marketing & Showcase",
  education: "Education & Pitch",
};

// ── Shop profile hook ─────────────────────────────────────────────────
interface ShopProfile {
  id: string;
  shop_name: string;
  shop_logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  shop_voice: VoiceOption;
}

const useShopProfile = () => {
  return useQuery<ShopProfile | null>({
    queryKey: ["mightymail-shop-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await db
        .from("shop_profiles")
        .select("id, shop_name, shop_logo_url, phone, email, website, shop_voice")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    staleTime: 60 * 1000,
  });
};

// ── Templates hook ────────────────────────────────────────────────────
const useEmailTemplates = () => {
  return useQuery<EmailTemplate[]>({
    queryKey: ["mightymail-templates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("email_templates")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as EmailTemplate[];
    },
  });
};

// ── MightyMail Pack System ────────────────────────────────────────────
// LOCKED — Five core packs + QuickText (built-in) + MightyMail Booster (separate).
// Slugs resolve against the shop's voice (formal/witty) at render time.

interface BoosterPack {
  id: string;
  name: string;
  tagline: string;
  whatItIs: string;
  whatItDoes: string[];
  icon: LucideIcon;
  gradient: string; // Tailwind gradient classes for the card header
  templateSlugs: string[];
  intervals: number[];
  cta: string;
}

// ── 6 Core Packs (LOCKED — DO NOT ADD/SPLIT) ────────────────────────
// Sell + Quote Conversion consolidated into Promote.
// Amplify consolidated into Inspire.
const BOOSTER_PACKS: BoosterPack[] = [
  {
    id: "authority",
    name: "Authority Pack",
    tagline: "Make your shop look professional and worth the price",
    whatItIs: "Emails that position your shop at a higher level so customers trust you, take you seriously, and understand why your pricing is higher.",
    whatItDoes: [
      "Builds trust before the sale",
      "Justifies premium pricing",
      "Separates you from cheap competitors",
    ],
    icon: Shield,
    gradient: "from-blue-600 to-blue-400",
    templateSlugs: ["authority-trust", "authority-premium", "authority-showcase"],
    intervals: [0, 5, 10],
    cta: "Activate Pack",
  },
  {
    id: "educate",
    name: "Educate Pack",
    tagline: "Help customers understand before they decide",
    whatItIs: "Emails that explain wraps, materials, process, and options so customers feel confident and stop second-guessing.",
    whatItDoes: [
      "Reduces confusion",
      "Removes common objections",
      "Speeds up decisions",
    ],
    icon: GraduationCap,
    gradient: "from-emerald-600 to-teal-400",
    templateSlugs: ["educate-materials", "educate-process", "educate-options"],
    intervals: [0, 5, 10],
    cta: "Activate Pack",
  },
  {
    id: "inspire",
    name: "Inspire Pack",
    tagline: "Show what's possible and get customers excited",
    whatItIs: "Emails that showcase ideas, styles, transformations, and finished work. Also handles social post promotion, sharing builds and reels, and driving engagement to your content.",
    whatItDoes: [
      "Creates desire and gets customers thinking",
      "Moves them from \"maybe\" to \"I want this\"",
      "Promotes your social content, builds, and reels",
      "Drives engagement to your best work",
    ],
    icon: Lightbulb,
    gradient: "from-purple-600 to-violet-400",
    templateSlugs: ["inspire-showcase", "inspire-styles", "inspire-transform", "inspire-social"],
    intervals: [0, 5, 10, 14],
    cta: "Activate Pack",
  },
  // Promote Pack Subtypes (LOCKED)
  // - Follow-Up Series (3/7/14, quote follow-ups)
  // - Promotions (service pushes, offers)
  // - Announcements (shop updates)
  // DO NOT ADD MORE SUBTYPES
  //
  // Promote → Promotions (LOCKED)
  // 1. Production Openings — fill schedule gaps, limited install slots
  // 2. Service Spotlight — window perf, tint, PPF, partial wraps
  // 3. Full Wrap Push — full vehicle wraps, fleet wraps, high-ticket
  // 4. Add-On / Upgrade — flames, graphics, accents, premium finishes
  // 5. Seasonal Campaigns — spring refresh, summer heat, end-of-year
  // 6. Soft Offer — value add, bonus/upgrade, limited inclusion
  // 7. Capacity Push — schedule filling, "booking out soon"
  // DO NOT ADD MORE SUBTYPES
  {
    id: "promote",
    name: "Promote Pack",
    tagline: "Create momentum and drive action",
    whatItIs: "The single pack for all action and conversion. Three clear entry points: follow up on quotes, run a service promo, or announce something new. If you need someone to book, reply, or act\u2014this is the pack.",
    whatItDoes: [
      "Follow-Up Series \u2014 stay in touch without sounding pushy (3/7/14 day)",
      "Promotions \u2014 create a reason to act now (perf, tint, PPF, wraps)",
      "Announcements \u2014 share what's new with your shop",
    ],
    icon: Megaphone,
    gradient: "from-green-600 to-emerald-400",
    // Follow-Up Series (LOCKED)
    // Day 3 = soft nudge
    // Day 7 = reframe/value
    // Day 14 = final touch
    // Tone must remain non-salesy and low pressure
    // DO NOT add aggressive urgency or discounts
    templateSlugs: ["promote-followup-3d", "promote-followup-7d", "promote-followup-14d", "promote-promo-perf", "promote-promo-tint", "promote-promo-ppf", "promote-promo-fullwrap", "promote-announce"],
    intervals: [3, 7, 14, 0, 3, 6, 9, 0],
    cta: "Activate Pack",
  },
  {
    id: "clientcare",
    name: "ClientCare Pack",
    tagline: "Make every customer feel taken care of from start to finish",
    whatItIs: "Customer service emails that keep clients informed and appreciated throughout the entire job\u2014from order confirmation to asking for a review.",
    whatItDoes: [
      "Thanks for your order + what to expect next",
      "Project status updates so they never wonder",
      "Your order is ready + thanks for your business",
      "Ask for review, referral, and next project",
    ],
    icon: HeartHandshake,
    gradient: "from-sky-500 to-cyan-400",
    templateSlugs: ["clientcare-thanks", "clientcare-status", "clientcare-ready", "clientcare-review"],
    intervals: [0, 3, 7, 14],
    cta: "Activate Pack",
  },
  {
    id: "protect",
    name: "Protect Pack",
    tagline: "Get sign-off and cover your shop before the wrap hits the wall",
    whatItIs: "Emails that deliver design proofs and 3D visualizations with manufacturer name and color, request customer signature, and attach terms and conditions\u2014so nothing ships without approval.",
    whatItDoes: [
      "Attached design proof for customer review",
      "3D visualization showing manufacturer + color",
      "Please sign using this email\u2014digital approval",
      "Terms and conditions attached for protection",
    ],
    icon: Shield,
    gradient: "from-slate-600 to-slate-400",
    templateSlugs: ["protect-proof", "protect-visual", "protect-sign", "protect-terms"],
    intervals: [0, 1, 2, 3],
    cta: "Activate Pack",
  },
];

// Resolve base slug to voice-specific slug (e.g. "retarget-3day" + "witty" → "retarget-3day-witty")
const resolveSlug = (baseSlug: string, voice: VoiceOption): string => {
  return `${baseSlug}-${voice}`;
};

// ══════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════

const MightyMail = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: shopProfile } = useShopProfile();
  const { data: templates, isLoading } = useEmailTemplates();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState<EmailTemplate | null>(null);
  const [viewingPack, setViewingPack] = useState<BoosterPack | null>(null);

  // Booster-pack activation state — opens a customer picker so the admin
  // can queue the pack's drip sequence for a specific customer. Each pick
  // inserts N rows into public.scheduled_emails (one per template slug),
  // staggered by `intervals`. The process-scheduled-emails pg_cron worker
  // fires each row at its send_at.
  const [activatingPack, setActivatingPack] = useState<BoosterPack | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");
  const [activating, setActivating] = useState(false);

  const shopVoice: VoiceOption = shopProfile?.shop_voice || "formal";

  // ── Recent customers for booster-pack targeting ────────────────────
  const { data: recentCustomers } = useQuery<
    Array<{ id: string; name: string | null; email: string; phone: string | null }>
  >({
    queryKey: ["mightymail-recent-customers", shopProfile?.id],
    enabled: !!shopProfile?.id && !!activatingPack,
    queryFn: async () => {
      const { data } = await db
        .from("customers")
        .select("id, name, email, phone, created_at")
        .eq("shop_id", shopProfile!.id)
        .not("email", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);
      return (data || []).filter((c: { email: string | null }) => !!c.email);
    },
    staleTime: 30 * 1000,
  });

  const filteredCustomers = useMemo(() => {
    if (!recentCustomers) return [];
    if (!customerSearch.trim()) return recentCustomers;
    const q = customerSearch.toLowerCase();
    return recentCustomers.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q)
    );
  }, [recentCustomers, customerSearch]);

  const resetActivationState = () => {
    setActivatingPack(null);
    setCustomerSearch("");
    setSelectedCustomerId(null);
    setManualEmail("");
    setManualName("");
  };

  // Queue all templates in a booster pack for a single customer, staggered
  // by the pack's `intervals` array (day-offsets from now). Each row is
  // inserted into scheduled_emails where the process-scheduled-emails cron
  // worker picks it up at send_at.
  const handleActivatePack = async () => {
    if (!activatingPack) return;

    const selected =
      selectedCustomerId && recentCustomers
        ? recentCustomers.find((c) => c.id === selectedCustomerId) || null
        : null;

    const email = (selected?.email || manualEmail || "").trim();
    const name = (selected?.name || manualName || "").trim() || "there";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast({
        title: "Pick or enter a valid email",
        description: "Booster packs need a recipient before they can be queued.",
        variant: "destructive",
      });
      return;
    }

    if (!shopProfile?.id) {
      toast({
        title: "Shop profile missing",
        description: "Set up your shop profile before activating booster packs.",
        variant: "destructive",
      });
      return;
    }

    setActivating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const intervals = activatingPack.intervals;
      const slugs = activatingPack.templateSlugs;
      const lastInterval = intervals[intervals.length - 1] ?? 0;

      const rows = slugs.map((baseSlug, idx) => {
        const dayOffset = intervals[idx] ?? lastInterval + (idx - intervals.length + 1) * 3;
        const sendAt = new Date();
        sendAt.setDate(sendAt.getDate() + dayOffset);
        return {
          send_at: sendAt.toISOString(),
          template_slug: resolveSlug(baseSlug, shopVoice),
          recipient_email: email,
          merge_data: {
            customer_name: name,
            customer_email: email,
            pack_name: activatingPack.name,
            pack_step: String(idx + 1),
            pack_total: String(slugs.length),
          },
          shop_id: shopProfile.id,
          source: "booster_pack",
          source_ref: `${activatingPack.id}:${selected?.id || email}`,
          status: "pending",
          created_by: user?.id || null,
        };
      });

      const { error } = await db.from("scheduled_emails").insert(rows);
      if (error) throw error;

      toast({
        title: `${activatingPack.name} activated`,
        description: `${rows.length} ${rows.length === 1 ? "email" : "emails"} queued for ${email}. First sends ${
          intervals[0] === 0 ? "now" : `in ${intervals[0]} day${intervals[0] === 1 ? "" : "s"}`
        }.`,
      });
      queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
      resetActivationState();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to activate booster pack";
      toast({
        title: "Activation failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setActivating(false);
    }
  };

  // ── Scheduled emails queue (live view of public.scheduled_emails) ──
  // RLS filters rows to the current shop automatically (shop_owner_read
  // policy). Refetches every 30s so you can watch the cron worker
  // flip rows from pending → sent in near real time.
  const { data: scheduledEmails } = useQuery<
    Array<{
      id: string;
      send_at: string;
      template_slug: string;
      recipient_email: string;
      status: string;
      source: string;
      source_ref: string | null;
      attempts: number;
      last_error: string | null;
      sent_at: string | null;
      created_at: string;
      merge_data: Record<string, string> | null;
    }>
  >({
    queryKey: ["scheduled-emails", shopProfile?.id],
    enabled: !!shopProfile?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("scheduled_emails")
        .select(
          "id, send_at, template_slug, recipient_email, status, source, source_ref, attempts, last_error, sent_at, created_at, merge_data"
        )
        .order("send_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  });

  const scheduledStats = useMemo(() => {
    const rows = scheduledEmails || [];
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      sent: rows.filter((r) => r.status === "sent").length,
      failed: rows.filter((r) => r.status === "failed").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
    };
  }, [scheduledEmails]);

  const [scheduledFilter, setScheduledFilter] = useState<
    "all" | "pending" | "sent" | "failed" | "cancelled"
  >("pending");

  const filteredScheduled = useMemo(() => {
    const rows = scheduledEmails || [];
    if (scheduledFilter === "all") return rows;
    return rows.filter((r) => r.status === scheduledFilter);
  }, [scheduledEmails, scheduledFilter]);

  // Cancel a pending row — allowed by the shop_owner_update RLS policy.
  const handleCancelScheduled = async (id: string) => {
    const { error } = await db
      .from("scheduled_emails")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      toast({
        title: "Cancel failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Scheduled email cancelled" });
    queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
  };

  // Retry a failed row — flip back to pending so the next cron tick picks it up.
  const handleRetryScheduled = async (id: string) => {
    const { error } = await db
      .from("scheduled_emails")
      .update({ status: "pending", attempts: 0, last_error: null })
      .eq("id", id);
    if (error) {
      toast({
        title: "Retry failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Re-queued",
      description: "Row will fire on the next cron tick (~5 min).",
    });
    queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
  };

  // Manually kick the cron worker now (admin convenience — no need to wait 5 min).
  const handleRunCronNow = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "process-scheduled-emails",
        { body: {} }
      );
      if (error) throw error;
      toast({
        title: "Cron kicked",
        description: `Processed ${data?.processed ?? 0} · sent ${data?.sent ?? 0} · failed ${data?.failed ?? 0}`,
      });
      queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invocation failed";
      toast({
        title: "Cron kick failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  // ── Update shop voice ──────────────────────────────────────────────
  const updateShopVoice = async (newVoice: VoiceOption) => {
    if (!shopProfile?.id) return;
    const { error } = await db
      .from("shop_profiles")
      .update({ shop_voice: newVoice })
      .eq("id", shopProfile.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["mightymail-shop-profile"] });
    toast({
      title: `Shop voice set to ${newVoice === "formal" ? "Formal / Pro" : "Witty / Funny"}`,
      description: "Templates will now match your brand tone.",
    });
  };

  // ── Filtered templates (voice + search + category) ─────────────────
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter((t) => {
      const voice = getTemplateVoice(t.slug);
      // Show templates matching shop voice, OR neutral templates (no voice suffix)
      const matchesVoice = voice === shopVoice || voice === "neutral";
      const matchesSearch =
        !search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description?.toLowerCase().includes(search.toLowerCase()) ||
        t.subject.toLowerCase().includes(search.toLowerCase());
      const group = getTemplateGroup(t.slug);
      const matchesCategory = categoryFilter === "all" || group === categoryFilter;
      return matchesVoice && matchesSearch && matchesCategory;
    });
  }, [templates, shopVoice, search, categoryFilter]);

  // ── Downloadable branded PDFs ──────────────────────────────────────
  const downloadWrapCarePDF = async () => {
    const data: WrapCarePDFData = {
      shopName: shopProfile?.shop_name || "RestylePro",
      shopLogoUrl: shopProfile?.shop_logo_url ?? null,
      shopPhone: shopProfile?.phone,
      shopEmail: shopProfile?.email,
      shopWebsite: shopProfile?.website,
      customerName: "[Customer Name]",
      vehicle: { year: "[Year]", make: "[Make]", model: "[Model]" },
      manufacturer: "[Manufacturer]",
      colorName: "[Color]",
      finish: "[Finish]",
      installDate: new Date().toISOString(),
    };
    await generateWrapCarePDF(data);
    toast({
      title: "Wrap Care Guide downloaded",
      description: "Branded template ready to customize for any client.",
    });
  };

  const downloadQuoteSamplePDF = async () => {
    const data: QuotePDFData = {
      quoteNumber: "SAMPLE-001",
      createdAt: new Date().toISOString(),
      shopName: shopProfile?.shop_name || "RestylePro",
      shopLogoUrl: shopProfile?.shop_logo_url ?? null,
      customer: { name: "John Doe", email: "john@example.com", phone: "(555) 123-4567" },
      vehicle: { year: "2024", make: "BMW", model: "M4" },
      manufacturer: "3M",
      colorName: "Satin Black",
      finish: "Satin",
      category: "Full Wrap",
      sqFt: 220,
      customerTotal: 3200,
      lineItems: [
        { label: "Film (3M Satin Black)", detail: "220 sq ft", amount: 1100 },
        { label: "Labor & Install", detail: "2-day install", amount: 1800 },
        { label: "Prep & Detail", amount: 300 },
      ],
    };
    await generateQuotePDF(data);
    toast({ title: "Sample Quote PDF downloaded" });
  };

  return (
    <>
      <Helmet>
        <title>MightyMail — Templates & Downloads</title>
      </Helmet>

      <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── Header ── */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-md">
                <Mail className="w-7 h-7 text-white" />
              </div>
              <div>
                <ToolWordmark toolKey="mightymail" size="3xl" className="[&>span:first-child]:text-gray-900" />
                <p className="text-sm text-gray-500 mt-1 font-inter">
                  The Email System Built to Supercharge Your Shop, Build Brand Equity, and Drive Profit
                </p>
              </div>
            </div>

            {/* Shop Voice Selector */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500 font-semibold uppercase tracking-wider">
                <Volume2 className="w-4 h-4" />
                Shop Voice
              </div>
              <Select value={shopVoice} onValueChange={(v) => updateShopVoice(v as VoiceOption)}>
                <SelectTrigger className="w-[180px] bg-white border-gray-200 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">
                    <div className="flex flex-col">
                      <span className="font-semibold">Formal / Pro</span>
                      <span className="text-[10px] text-gray-400">Professional & high-end</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="witty">
                    <div className="flex flex-col">
                      <span className="font-semibold">Witty / Funny</span>
                      <span className="text-[10px] text-gray-400">Interesting & playful</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="templates" className="w-full">
          <TabsList className="bg-gray-100 border border-gray-200 p-1">
            <TabsTrigger value="templates" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Email Templates ({filteredTemplates.length})
            </TabsTrigger>
            <TabsTrigger value="boosters" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500 text-xs font-bold uppercase tracking-wider">
              <Rocket className="w-3.5 h-3.5 mr-1.5" />
              Packs ({BOOSTER_PACKS.length})
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500 text-xs font-bold uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              Scheduled ({scheduledStats.pending})
            </TabsTrigger>
            <TabsTrigger value="downloads" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500 text-xs font-bold uppercase tracking-wider">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Digital Downloads
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════ PACKS TAB ═══════════════════ */}
          <TabsContent value="boosters" className="mt-6 space-y-8">
            {/* ── MightyPacks ── */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-900 mb-3">Pre-built email packs designed to help you get more wrap jobs, educate your customers, and stay top of mind.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {BOOSTER_PACKS.map((pack) => {
                  const Icon = pack.icon;
                  return (
                    <Card
                      key={pack.id}
                      className="bg-white border-gray-200 hover:shadow-lg transition group overflow-hidden"
                    >
                      {/* Gradient Header */}
                      <div className={`bg-gradient-to-r ${pack.gradient} px-5 py-4 flex items-center gap-3`}>
                        <Icon className="w-6 h-6 text-white" />
                        <div>
                          <h3 className="font-bold text-white text-base leading-tight">{pack.name}</h3>
                          <p className="text-[11px] text-white/80 mt-0.5 font-inter">{pack.tagline}</p>
                        </div>
                      </div>

                      <CardContent className="p-5 space-y-4">
                        {/* What it is */}
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it is</div>
                          <p className="text-xs text-gray-600 font-inter leading-relaxed">
                            {pack.whatItIs}
                          </p>
                        </div>

                        {/* What it does */}
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it does</div>
                          <ul className="space-y-1">
                            {pack.whatItDoes.map((item) => (
                              <li key={item} className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 text-gray-600 hover:text-gray-900 hover:bg-gray-50 h-9 text-xs"
                            onClick={() => setViewingPack(pack)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1.5" />
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            className={`flex-1 text-white h-9 text-xs bg-gradient-to-r ${pack.gradient}`}
                            onClick={() => setActivatingPack(pack)}
                          >
                            {pack.cta}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* ── QuickText Built-In ── */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Built Into Every Pack</h3>
              <Card className="bg-white border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-violet-600 to-indigo-400 px-5 py-4 flex items-center gap-3">
                  <MessageSquareText className="w-6 h-6 text-white" />
                  <div>
                    <h3 className="font-bold text-white text-base leading-tight">QuickText&trade;</h3>
                    <p className="text-[11px] text-white/80 mt-0.5 font-inter">Never miss a sale</p>
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it is</div>
                      <p className="text-xs text-gray-600 font-inter leading-relaxed">
                        A short, ready-to-send version of every email you can use for text messages, DMs, or fast follow-ups.
                      </p>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it does</div>
                      <ul className="space-y-1">
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <Zap className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                          Speeds up response time
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <Zap className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                          Keeps leads warm
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <Zap className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                          Turns conversations into sales
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── MightyMail Booster (Separate) ── */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Separate System</h3>
              <Card className="bg-white border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 via-fuchsia-500 to-pink-500 px-5 py-4 flex items-center gap-3">
                  <BrainCircuit className="w-6 h-6 text-white" />
                  <div>
                    <h3 className="font-bold text-white text-base leading-tight">MightyMail Booster</h3>
                    <p className="text-[11px] text-white/80 mt-0.5 font-inter">AI-powered emails built to convert</p>
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it is</div>
                      <p className="text-xs text-gray-600 font-inter leading-relaxed">
                        A separate system that analyzes customer behavior and automatically generates highly targeted emails designed to close specific leads.
                      </p>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">What it does</div>
                      <ul className="space-y-1">
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <BrainCircuit className="w-3.5 h-3.5 text-fuchsia-500 mt-0.5 shrink-0" />
                          Sends the right message at the right time
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <BrainCircuit className="w-3.5 h-3.5 text-fuchsia-500 mt-0.5 shrink-0" />
                          Adapts to each customer
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-700 font-inter">
                          <BrainCircuit className="w-3.5 h-3.5 text-fuchsia-500 mt-0.5 shrink-0" />
                          Increases conversion without manual effort
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══════════════════ SCHEDULED TAB ═══════════════════
              Live view of public.scheduled_emails for this shop.
              Rows are queued by SavedQuotesTable (quote retargets) and
              the Booster Pack activation dialog above. The process-
              scheduled-emails pg_cron worker runs every 5 minutes and
              flips rows from pending → sent / failed. This view
              refetches every 30s. */}
          <TabsContent value="scheduled" className="mt-6 space-y-4">
            {/* Header + kick button */}
            <div className="rounded-xl border border-gray-200 bg-blue-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0 shadow-sm">
                    <Clock className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-gray-900 font-bold text-sm">Scheduled Email Queue</h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-inter">
                      Rows written by quote retargets and booster pack activations. The
                      cron worker runs every 5 minutes and fires anything that's due.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRunCronNow}
                  className="shrink-0 text-xs border-gray-200 text-gray-700 hover:bg-white"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Run Cron Now
                </Button>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { key: "all", label: "All", count: scheduledStats.total, icon: Mail, color: "text-gray-500" },
                { key: "pending", label: "Pending", count: scheduledStats.pending, icon: Clock, color: "text-amber-500" },
                { key: "sent", label: "Sent", count: scheduledStats.sent, icon: CheckCircle2, color: "text-green-500" },
                { key: "failed", label: "Failed", count: scheduledStats.failed, icon: AlertCircle, color: "text-red-500" },
                { key: "cancelled", label: "Cancelled", count: scheduledStats.cancelled, icon: XCircle, color: "text-gray-400" },
              ].map((stat) => {
                const Icon = stat.icon;
                const active = scheduledFilter === stat.key;
                return (
                  <button
                    key={stat.key}
                    type="button"
                    onClick={() => setScheduledFilter(stat.key as typeof scheduledFilter)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition",
                      active
                        ? "border-blue-300 bg-blue-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-3.5 h-3.5", stat.color)} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {stat.label}
                      </span>
                    </div>
                    <div className="text-xl font-bold text-gray-900 mt-1">{stat.count}</div>
                  </button>
                );
              })}
            </div>

            {/* Row list */}
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
              <div className="grid grid-cols-[100px_1.5fr_1fr_110px_110px_80px] gap-3 px-4 py-2 bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <div>Status</div>
                <div>Template · Recipient</div>
                <div>Source</div>
                <div>Send At</div>
                <div>Attempts</div>
                <div className="text-right">Actions</div>
              </div>
              {filteredScheduled.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  {scheduledEmails === undefined
                    ? "Loading…"
                    : `No ${scheduledFilter === "all" ? "" : scheduledFilter} scheduled emails yet.`}
                </div>
              ) : (
                filteredScheduled.map((row) => {
                  const sendDate = new Date(row.send_at);
                  const isPast = sendDate.getTime() <= Date.now();
                  const statusMeta: Record<
                    string,
                    { icon: LucideIcon; color: string; label: string }
                  > = {
                    pending: { icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", label: "Pending" },
                    processing: { icon: RefreshCw, color: "text-blue-600 bg-blue-50 border-blue-200", label: "Processing" },
                    sent: { icon: CheckCircle2, color: "text-green-600 bg-green-50 border-green-200", label: "Sent" },
                    failed: { icon: AlertCircle, color: "text-red-600 bg-red-50 border-red-200", label: "Failed" },
                    cancelled: { icon: XCircle, color: "text-gray-400 bg-gray-50 border-gray-200", label: "Cancelled" },
                  };
                  const meta = statusMeta[row.status] || statusMeta.pending;
                  const StatusIcon = meta.icon;
                  const customerName = row.merge_data?.customer_name || "";
                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[100px_1.5fr_1fr_110px_110px_80px] gap-3 px-4 py-3 border-t border-gray-100 items-center text-xs"
                    >
                      {/* Status badge */}
                      <div>
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold",
                            meta.color
                          )}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {meta.label}
                        </div>
                      </div>

                      {/* Template + recipient */}
                      <div className="min-w-0">
                        <div className="font-mono text-gray-800 truncate">{row.template_slug}</div>
                        <div className="text-gray-500 truncate">
                          {customerName ? `${customerName} · ` : ""}
                          {row.recipient_email}
                        </div>
                        {row.last_error && (
                          <div className="text-red-500 text-[10px] mt-0.5 truncate" title={row.last_error}>
                            {row.last_error}
                          </div>
                        )}
                      </div>

                      {/* Source */}
                      <div className="min-w-0">
                        <div className="text-gray-700 capitalize">{row.source.replace(/_/g, " ")}</div>
                        {row.source_ref && (
                          <div className="text-gray-400 text-[10px] truncate font-mono">{row.source_ref}</div>
                        )}
                      </div>

                      {/* Send at */}
                      <div className="text-gray-600">
                        <div>{sendDate.toLocaleDateString()}</div>
                        <div className="text-[10px] text-gray-400">
                          {sendDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          {row.status === "pending" && isPast && " · due"}
                        </div>
                      </div>

                      {/* Attempts */}
                      <div className="text-gray-500">
                        {row.attempts} / 3
                        {row.sent_at && (
                          <div className="text-[10px] text-green-500">
                            {new Date(row.sent_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1">
                        {row.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => handleCancelScheduled(row.id)}
                            className="w-7 h-7 rounded-md border border-gray-200 hover:border-red-300 hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition"
                            title="Cancel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {row.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => handleRetryScheduled(row.id)}
                            className="w-7 h-7 rounded-md border border-gray-200 hover:border-blue-300 hover:bg-blue-50 flex items-center justify-center text-gray-400 hover:text-blue-500 transition"
                            title="Re-queue"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* ═══════════════════ TEMPLATES TAB ═══════════════════ */}
          <TabsContent value="templates" className="mt-6 space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search templates..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-white border-gray-200 text-gray-900"
                />
              </div>
              <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}>
                <SelectTrigger className="w-full sm:w-[240px] bg-white border-gray-200 text-gray-900">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(GROUP_LABELS) as CategoryFilter[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {GROUP_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Template Grid */}
            {isLoading ? (
              <div className="py-20 text-center text-gray-400">Loading templates…</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="py-20 text-center">
                <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <h3 className="text-gray-900 font-semibold">No templates match your filters</h3>
                <p className="text-sm text-gray-500 mt-1">Try adjusting search or category</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTemplates.map((template) => {
                  const voice = getTemplateVoice(template.slug);
                  const group = getTemplateGroup(template.slug);
                  return (
                    <Card
                      key={template.id}
                      className="bg-white border-gray-200 hover:border-blue-300 hover:shadow-md transition group"
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-bold text-gray-900 text-sm leading-tight truncate">
                              {template.name.replace(/ \((Formal|Witty)\)$/, "")}
                            </h3>
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                              {template.slug}
                            </p>
                          </div>
                          {voice === "formal" && (
                            <Badge className="bg-blue-50 text-blue-600 border-blue-200 text-[9px] shrink-0">
                              Pro
                            </Badge>
                          )}
                          {voice === "witty" && (
                            <Badge className="bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200 text-[9px] shrink-0">
                              Witty
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-gray-500 line-clamp-2 min-h-[32px] font-inter">
                          {template.description || template.subject}
                        </p>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px] border-gray-200 text-gray-500">
                            {GROUP_LABELS[group]}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] border-gray-200 text-gray-500">
                            {template.category}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 text-gray-600 hover:text-gray-900 hover:bg-gray-50 h-8 text-xs"
                            onClick={() => setPreviewTemplate(template)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1.5" />
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white h-8 text-xs"
                            onClick={() => setSendingTemplate(template)}
                          >
                            <Send className="w-3.5 h-3.5 mr-1.5" />
                            Use
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ═══════════════════ DOWNLOADS TAB ═══════════════════ */}
          <TabsContent value="downloads" className="mt-6 space-y-4">
            <div className="text-sm text-gray-500 mb-4">
              Branded PDFs ready to print or email to clients. All use your shop logo, name, and contact info automatically.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Wrap Care Sheet */}
              <Card className="bg-white border-gray-200 hover:border-blue-300 hover:shadow-md transition">
                <CardContent className="p-5 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-50 to-fuchsia-50 border border-gray-200 flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-base">Wrap Care Guide</h3>
                    <p className="text-xs text-gray-500 mt-1 font-inter">
                      3-page branded PDF. Post-install deliverable covering first-48-hours, washing, warranty, and shop contact.
                    </p>
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white"
                    onClick={downloadWrapCarePDF}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Sample
                  </Button>
                </CardContent>
              </Card>

              {/* Quote PDF */}
              <Card className="bg-white border-gray-200 hover:border-blue-300 hover:shadow-md transition">
                <CardContent className="p-5 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-50 to-fuchsia-50 border border-gray-200 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-base">Quote Template</h3>
                    <p className="text-xs text-gray-500 mt-1 font-inter">
                      Branded 8.5×11 quote PDF template. Includes shop header, line items, total, and terms.
                    </p>
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white"
                    onClick={downloadQuoteSamplePDF}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Sample
                  </Button>
                </CardContent>
              </Card>

              {/* Placeholder for future downloads */}
              <Card className="bg-gray-50 border-dashed border-gray-200 opacity-60">
                <CardContent className="p-5 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-gray-300" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-500 text-base">More Coming Soon</h3>
                    <p className="text-xs text-gray-400 mt-1 font-inter">
                      Print-ready marketing flyers, social media templates, and branded invoice packs.
                    </p>
                  </div>
                  <Button disabled variant="outline" className="w-full border-gray-200 text-gray-400">
                    Coming Soon
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>

      {/* ── Preview Modal ── */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {previewTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  {previewTemplate.name}
                  {getTemplateVoice(previewTemplate.slug) === "formal" && (
                    <Badge className="bg-blue-50 text-blue-600 border-blue-200">Formal / Pro</Badge>
                  )}
                  {getTemplateVoice(previewTemplate.slug) === "witty" && (
                    <Badge className="bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200">Witty / Funny</Badge>
                  )}
                </DialogTitle>
                <p className="text-sm text-gray-500">{previewTemplate.description}</p>
              </DialogHeader>
              <div className="mt-4">
                <TemplatePreview
                  html={previewTemplate.html_content}
                  subject={previewTemplate.subject}
                />
              </div>
              <div className="flex items-center gap-2 pt-4 border-t">
                <Button
                  className="flex-1 bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white"
                  onClick={() => {
                    setSendingTemplate(previewTemplate);
                    setPreviewTemplate(null);
                  }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Use This Template
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Pack Preview Modal ── */}
      <Dialog open={!!viewingPack} onOpenChange={(open) => !open && setViewingPack(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {viewingPack && (
            <>
              {/* Gradient header inside dialog */}
              <div className={`bg-gradient-to-r ${viewingPack.gradient} px-6 py-5 flex items-center gap-3 rounded-t-lg`}>
                <viewingPack.icon className="w-7 h-7 text-white" />
                <div>
                  <div className="font-bold text-white text-lg">{viewingPack.name}</div>
                  <div className="text-xs text-white/80 mt-0.5 font-inter">
                    {viewingPack.tagline}
                  </div>
                </div>
              </div>

              <div className="px-6 pt-4 pb-2">
                <p className="text-sm text-gray-600 font-inter leading-relaxed">{viewingPack.whatItIs}</p>
                <ul className="mt-3 space-y-1.5">
                  {viewingPack.whatItDoes.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-gray-700 font-inter">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="px-6 space-y-3 py-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Emails in this pack · {shopVoice === "formal" ? "Formal / Pro" : "Witty / Funny"} voice
                </h4>
                {viewingPack.templateSlugs.map((baseSlug, idx) => {
                  const voiceSlug = resolveSlug(baseSlug, shopVoice);
                  const resolved =
                    templates?.find((t) => t.slug === voiceSlug) ||
                    templates?.find((t) => t.slug === baseSlug);
                  if (!resolved) {
                    return (
                      <div key={baseSlug} className="rounded-lg border border-dashed p-3 text-xs text-gray-400">
                        <div className="font-mono">{baseSlug}</div>
                        <div className="text-[10px] mt-1">Template not yet seeded</div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={resolved.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${viewingPack.gradient} flex items-center justify-center shrink-0 text-white font-bold text-xs`}>
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">
                          {resolved.name.replace(/ \((Formal|Witty)\)$/, "")}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {resolved.subject}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPreviewTemplate(resolved);
                          setViewingPack(null);
                        }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 px-6 pb-6 pt-3 border-t">
                <Button
                  className={`flex-1 text-white bg-gradient-to-r ${viewingPack.gradient}`}
                  onClick={() => {
                    const pack = viewingPack;
                    setViewingPack(null);
                    setActivatingPack(pack);
                  }}
                >
                  <Rocket className="w-4 h-4 mr-2" />
                  {viewingPack.cta}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Booster Pack Activation Dialog ──
          Picks a recipient and inserts N rows into scheduled_emails.
          The process-scheduled-emails cron worker fires each row at send_at. */}
      <Dialog
        open={!!activatingPack}
        onOpenChange={(open) => {
          if (!open && !activating) resetActivationState();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {activatingPack && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${activatingPack.gradient} flex items-center justify-center`}>
                    <activatingPack.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div>Activate "{activatingPack.name}"</div>
                    <div className="text-xs font-normal text-gray-500 mt-0.5">
                      {activatingPack.templateSlugs.length} emails · {shopVoice === "formal" ? "Formal / Pro" : "Witty / Funny"} voice
                    </div>
                  </div>
                </DialogTitle>
                <p className="text-sm text-gray-500 pt-2">
                  Pick a customer — every email in this pack will be queued in{" "}
                  <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">scheduled_emails</code>{" "}
                  and the cron worker will send each one at its scheduled time.
                </p>
              </DialogHeader>

              {/* Send schedule summary */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Send Schedule
                </div>
                {activatingPack.templateSlugs.map((baseSlug, idx) => {
                  const offset = activatingPack.intervals[idx] ?? activatingPack.intervals[activatingPack.intervals.length - 1] ?? 0;
                  const sendDate = new Date();
                  sendDate.setDate(sendDate.getDate() + offset);
                  return (
                    <div key={baseSlug} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-gray-500">
                        {idx + 1}. {resolveSlug(baseSlug, shopVoice)}
                      </span>
                      <span className="text-gray-900 font-medium">
                        {offset === 0 ? "immediately" : `+${offset}d`} ({sendDate.toLocaleDateString()})
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Customer picker */}
              <div className="space-y-2 pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Pick a Recent Customer
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search name, email, or phone..."
                    className="pl-10"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                  {filteredCustomers.length === 0 ? (
                    <div className="p-4 text-xs text-center text-gray-500">
                      {recentCustomers ? "No matching customers" : "Loading customers..."}
                    </div>
                  ) : (
                    filteredCustomers.slice(0, 30).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setManualEmail("");
                          setManualName("");
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition",
                          selectedCustomerId === c.id && "bg-blue-50"
                        )}
                      >
                        <div className="font-semibold">{c.name || "Unnamed"}</div>
                        <div className="text-gray-500">{c.email}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Manual entry fallback */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Or Enter Manually
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Name"
                    value={manualName}
                    onChange={(e) => {
                      setManualName(e.target.value);
                      if (e.target.value) setSelectedCustomerId(null);
                    }}
                  />
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={manualEmail}
                    onChange={(e) => {
                      setManualEmail(e.target.value);
                      if (e.target.value) setSelectedCustomerId(null);
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={resetActivationState}
                  disabled={activating}
                >
                  Cancel
                </Button>
                <Button
                  className={`flex-1 text-white bg-gradient-to-r ${activatingPack.gradient}`}
                  onClick={handleActivatePack}
                  disabled={activating}
                >
                  <Rocket className="w-4 h-4 mr-2" />
                  {activating ? "Queuing..." : `Queue ${activatingPack.templateSlugs.length} emails`}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Send Modal (placeholder — could expand to customer picker) ── */}
      <Dialog open={!!sendingTemplate} onOpenChange={(open) => !open && setSendingTemplate(null)}>
        <DialogContent className="max-w-md">
          {sendingTemplate && (
            <>
              <DialogHeader>
                <DialogTitle>Send "{sendingTemplate.name}"</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <p className="text-sm text-gray-500">
                  This template will pull your shop branding automatically.
                  Pick a customer from your Quotes page to send it to them.
                </p>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs space-y-1">
                  <div><strong>Subject:</strong> {sendingTemplate.subject}</div>
                  <div><strong>From:</strong> {shopProfile?.shop_name || "Your shop"}</div>
                  <div><strong>Category:</strong> {sendingTemplate.category}</div>
                </div>
                <Button
                  className="w-full bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white"
                  asChild
                >
                  <a href="/quotes">
                    <Send className="w-4 h-4 mr-2" />
                    Go to Quotes to Send
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MightyMail;
