/**
 * ShopOnboardingWizard — 5-step guided setup for new SaaS customers.
 *
 * Triggers on first login when shop_profiles.onboarding_completed is false.
 * Steps:
 *   1. Welcome — confirm shop name + logo from signup
 *   2. Shop Details — phone, website, shop voice (formal/witty)
 *   3. Import Contacts — CSV upload or paste (seeds email_subscribers)
 *   4. Pick Your First Pack — activate a MightyMail booster pack
 *   5. You're Live — summary + quick links
 *
 * On completion: sets shop_profiles.onboarding_completed = true
 */

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Sparkles, ArrowRight, ArrowLeft, CheckCircle2, Upload,
  Phone, Globe, Mic2, Users, Mail, Rocket, FileText, X,
  Palette, Shield, Heart, Megaphone, BookOpen, Zap,
} from "lucide-react";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import {
  WpwValueRibbon,
  WpwWelcomeHero,
  WpwUpgradeReveal,
} from "./WpwWizardElements";

const db = supabase as any;

const ONBOARDING_KEY = "rp_shop_onboarding_done";
const ONBOARDING_DISMISSED_SESSION_KEY = "rp_shop_onboarding_dismissed";

// Showcase renders from the catalog — rotate between restyle + commercial
const HERO_RENDERS = [
  {
    url: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/e0ca88a7-6007-41cc-8e67-842e57664c5d/designpanelpro/1774991932959_McLaren%20_720%20S%20_rear.png",
    label: "Ten Yang Koi — McLaren 720S",
    type: "restyle",
  },
  {
    url: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1776994922820_commercial.jpg",
    label: "Streetfire Tacos — Chevy Step Van",
    type: "commercial",
  },
  {
    url: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1776912798467_commercial.jpg",
    label: "FlowGuard Plumbing — Ford Transit",
    type: "commercial",
  },
  {
    url: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1773362855965_restyle.jpg",
    label: "Imperial Armor — McLaren 720S",
    type: "restyle",
  },
  {
    url: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1776919357424_commercial.jpg",
    label: "Apex Climate Control — Chevy Cargo Van",
    type: "commercial",
  },
];

const STEPS = [
  { label: "Welcome", icon: Sparkles, sproket: "/characters/sproket/sproket-welcome.png" },
  { label: "Your Shop", icon: Phone, sproket: "/characters/sproket/sproket-clipboard.png" },
  { label: "Pricing", icon: Zap, sproket: "/characters/sproket/sproket-moneybag.png" },
  { label: "Logo", icon: Palette, sproket: "/characters/sproket/sproket-designmasterpiece.png" },
  { label: "Contacts", icon: Users, sproket: "/characters/sproket/sproket-mobile-phone.png" },
  { label: "Email Packs", icon: Mail, sproket: "/characters/sproket/sproket-announce.png" },
  { label: "You're Live", icon: Rocket, sproket: "/characters/sproket/sproket-rocket-launch.png" },
];

const BOOSTER_PACKS = [
  { id: "authority", name: "Authority Builder", desc: "Position your shop as the expert — certifications, process, quality", icon: Shield, gradient: "from-amber-500 to-orange-600", emails: 5 },
  { id: "clientcare", name: "Client Care", desc: "Post-install follow-ups, care instructions, check-ins", icon: Heart, gradient: "from-pink-500 to-rose-600", emails: 4 },
  { id: "promote", name: "Promotions", desc: "Seasonal deals, referral discounts, flash sales", icon: Megaphone, gradient: "from-green-500 to-emerald-600", emails: 5 },
  { id: "educate", name: "Educate", desc: "Teach customers about wraps — materials, care, value", icon: BookOpen, gradient: "from-blue-500 to-indigo-600", emails: 4 },
  { id: "inspire", name: "Inspire", desc: "Gallery showcases, before/after, trending styles", icon: Palette, gradient: "from-purple-500 to-violet-600", emails: 4 },
  { id: "protect", name: "Protect", desc: "PPF, ceramic coating, paint protection education", icon: Zap, gradient: "from-cyan-500 to-teal-600", emails: 3 },
];

function parseEmails(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split(/[\n\r]+/).filter(Boolean);
  const emails = new Set<string>();
  for (const line of lines) {
    const tokens = line.split(/[,;\t]+/);
    for (const token of tokens) {
      const cleaned = token.trim().replace(/^["']|["']$/g, "");
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
        emails.add(cleaned.toLowerCase());
        break;
      }
    }
  }
  return [...emails];
}

interface ShopOnboardingWizardProps {
  triggerOpen?: boolean;
  onClose?: () => void;
}

export function ShopOnboardingWizard({ triggerOpen, onClose }: ShopOnboardingWizardProps = {}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [shopId, setShopId] = useState<string | null>(null);
  const { data: isWpwTenant = false } = useIsWpwTenant();
  const autoTriggered = useRef(false);

  // Step 1: Welcome
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Step 2: Shop Details
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [shopVoice, setShopVoice] = useState<"formal" | "witty" | "both">("both");

  // Step 2: Products & Pricing
  const [filmBrands, setFilmBrands] = useState<Set<string>>(new Set(["3M", "Avery Dennison"]));
  const [filmCost, setFilmCost] = useState("2.50");
  const [laborRate, setLaborRate] = useState("6.50");
  const [markupPercent, setMarkupPercent] = useState("65");

  // Step 3: Logo Upload
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Step 4: Import Contacts
  const [pasted, setPasted] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 4: Booster Packs
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());

  // Rotate hero render every 4 seconds
  const [heroIdx, setHeroIdx] = useState(0);
  useEffect(() => {
    if (!open || step !== 0) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % HERO_RENDERS.length), 4000);
    return () => clearInterval(t);
  }, [open, step]);

  // Open wizard when parent triggers it
  useEffect(() => {
    if (triggerOpen) loadProfile();
  }, [triggerOpen]);

  // Allow admins to force-replay the wizard via a global event. Used by
  // AdminViewAsCustomerToggle and the WPW Connect Portal badge so an
  // already-onboarded admin can preview the wizard the way a fresh
  // customer sees it, without resetting shop_profiles.onboarding_completed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = async () => {
      // Reset client-side dismissal flags so the wizard can re-open.
      try {
        localStorage.removeItem(ONBOARDING_KEY);
        sessionStorage.removeItem(ONBOARDING_DISMISSED_SESSION_KEY);
      } catch { /* noop */ }
      // Defensive: open immediately with a sane fallback so the user
      // sees content even if the profile query is slow / fails. We then
      // fill in real data when loadProfile resolves.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setShopName((prev) => prev || user.user_metadata?.company_name || user.email?.split("@")[0] || "");
      setStep(0);
      setOpen(true);
      // Then merge in the saved profile when available.
      void loadProfile(true);
    };
    window.addEventListener("restylepro:open-onboarding-wizard", handler);
    return () => window.removeEventListener("restylepro:open-onboarding-wizard", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open for WPW tenants on first dashboard load when onboarding
  // hasn't been completed or dismissed yet. This is the "linked → wizard
  // deploys" path: a Royalty-Wraps-style WPW customer links via
  // wpw-oauth-link, useIsWpwTenant flips to true, and the wizard surfaces
  // itself without needing a manual button click.
  useEffect(() => {
    if (autoTriggered.current) return;
    if (!isWpwTenant) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(ONBOARDING_KEY) === "true") return;
    if (sessionStorage.getItem(ONBOARDING_DISMISSED_SESSION_KEY) === "true") return;
    autoTriggered.current = true;
    loadProfile();
  }, [isWpwTenant]);

  // Load shop profile data when wizard opens (triggered by user action, not auto)
  // `force=true` bypasses the onboarding_completed gate so admins can replay
  // the wizard via the View-as-Customer toggle without resetting the flag.
  const loadProfile = async (force = false) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await db
      .from("shop_profiles")
      .select("id, shop_name, shop_logo_url, phone, website, shop_voice, onboarding_completed")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) return;
    if (profile.onboarding_completed && !force) return;

    setShopId(profile.id);
    setShopName(profile.shop_name || user.user_metadata?.company_name || "");
    setLogoUrl(profile.shop_logo_url || null);
    setPhone(profile.phone || "");
    setWebsite(profile.website || "");
    setShopVoice(profile.shop_voice || "formal");
    setStep(0);
    setOpen(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Logo too large — max 5MB"); return; }
    setUploadingLogo(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const path = `renders/${user?.id || "anon"}/shop-logo/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      setLogoUrl(publicUrl);
      if (shopId) {
        await db.from("shop_profiles").update({ shop_logo_url: publicUrl }).eq("id", shopId);
      }
      toast.success("Logo uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large — max 5MB");
      return;
    }
    const text = await file.text();
    setPasted(text);
    setCsvFileName(file.name);
  };

  const handleImportContacts = async () => {
    const emails = parseEmails(pasted);
    if (!emails.length) return;
    setImporting(true);
    try {
      const rows = emails.map((email) => ({
        email,
        source: "shop_onboarding",
        unsubscribed: false,
      }));
      const { error } = await db
        .from("email_subscribers")
        .upsert(rows, { onConflict: "email" });
      if (error) throw error;
      setImportedCount(emails.length);
      toast.success(`${emails.length} contacts imported`);
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const togglePack = (id: string) => {
    setSelectedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleComplete = async () => {
    if (!shopId) return;
    setSaving(true);
    try {
      // Save shop profile
      await db
        .from("shop_profiles")
        .update({
          shop_name: shopName || undefined,
          phone: phone || undefined,
          website: website || undefined,
          shop_voice: shopVoice,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shopId);

      // Save pricing config
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await db.from("shop_pricing_config").upsert({
          user_id: user.id,
          default_markup_percentage: parseFloat(markupPercent) || 65,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        // Save film pricing for each selected brand
        for (const brand of filmBrands) {
          await db.from("shop_pricing").upsert({
            user_id: user.id,
            manufacturer: brand,
            finish: "Gloss",
            film_cost_per_sqft: parseFloat(filmCost) || 2.50,
            labor_rate_per_sqft: parseFloat(laborRate) || 6.50,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,manufacturer,finish" });
        }
      }

      localStorage.setItem(ONBOARDING_KEY, "true");
      toast.success("You're all set! Welcome to RestyleProAI.");
      setOpen(false);
    } catch (err: any) {
      toast.error("Failed to save — please try again");
    } finally {
      setSaving(false);
    }
  };

  const parsedCount = parseEmails(pasted).length;
  const canNext = () => {
    if (step === 0) return !!shopName.trim();
    return true;
  };

  if (!open) return null;

  const dismissForSession = () => {
    sessionStorage.setItem(ONBOARDING_DISMISSED_SESSION_KEY, "true");
    setOpen(false);
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismissForSession(); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-zinc-950 border-zinc-800 [&>button]:hidden relative">
        {/* Background gradient glow */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-[120px] pointer-events-none" />
        <VisuallyHidden><DialogTitle>Shop Onboarding</DialogTitle></VisuallyHidden>
        <button
          type="button"
          onClick={dismissForSession}
          aria-label="Close onboarding"
          className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/70 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        {/* Progress bar — thick gradient */}
        <div className="flex gap-0">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex-1 relative">
              <div className={cn(
                "h-2 transition-all duration-500",
                i <= step ? "bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-orange-400" : "bg-zinc-800"
              )} />
            </div>
          ))}
        </div>

        {/* Step indicators — Sproket characters */}
        <div className="flex justify-center gap-4 sm:gap-6 pt-4 pb-2 relative">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex flex-col items-center gap-1.5 relative">
              {i < STEPS.length - 1 && (
                <div className={cn(
                  "absolute top-5 left-[calc(50%+20px)] w-[calc(100%-8px)] h-0.5",
                  i < step ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-zinc-800"
                )} />
              )}
              <div className={cn(
                "relative w-11 h-11 rounded-full flex items-center justify-center transition-all",
                i < step ? "bg-emerald-500/20 ring-2 ring-emerald-500/30" :
                i === step ? "ring-2 ring-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.3)]" :
                "bg-zinc-800/50 opacity-40"
              )}>
                {i < step ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <img
                    src={s.sproket}
                    alt={s.label}
                    className={cn("w-10 h-10 object-contain", i === step && "drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]")}
                  />
                )}
              </div>
              <span className={cn(
                "text-[10px] font-bold tracking-wide uppercase",
                i < step ? "text-emerald-400" :
                i === step ? "bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent" :
                "text-zinc-600"
              )}>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="px-8 pb-8 pt-2 min-h-[380px] flex flex-col">
          {/* WPW persistent value-reveal ribbon — every step except the
              final reveal (which has its own comparison). */}
          {isWpwTenant && step < 6 && <WpwValueRibbon className="mb-4" />}

          {/* ─── STEP 0: Welcome ─── */}
          {step === 0 && (
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Left — text + input */}
              <div className="space-y-5">
                {/* Sproket welcome — big character + brand */}
                <div className="flex items-center gap-4 mb-2">
                  <img src="/characters/sproket/sproket-welcome.png" alt="Sproket" className="h-28 w-auto object-contain drop-shadow-[0_0_25px_rgba(6,182,212,0.5)] animate-in zoom-in-50 duration-500" />
                  <div className="flex flex-col leading-none">
                    <span className="text-3xl font-bold tracking-tight">
                      <span className="text-white">Restyle</span>
                      <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">Pro</span>
                      <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>
                      <span className="text-zinc-400 text-[10px] align-super ml-0.5">&#8482;</span>
                    </span>
                    <span className="text-sm font-medium italic bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                      Vehicle Wrap Design System&#8482;
                    </span>
                  </div>
                </div>
                {isWpwTenant ? (
                  <WpwWelcomeHero shopName={shopName} />
                ) : (
                  <div>
                    <h2 className="text-3xl font-black text-white">
                      <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">Supercharge</span> Your Shop
                    </h2>
                    <p className="text-zinc-300 mt-2 text-sm leading-relaxed">
                      Built by a wrap shop, for wrap shops. 2 minutes to set up — your customers see your branding on every render, proof, and email.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-zinc-400 text-xs">Shop / Company Name</Label>
                  <Input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="Your Wrap Shop Name"
                    className="text-lg font-semibold bg-zinc-900 border-zinc-700 h-12"
                  />
                </div>
              </div>
              {/* Right — rotating hero renders from catalog */}
              <div className="relative rounded-xl overflow-hidden aspect-[4/3] bg-zinc-900 hidden md:block">
                <div className="absolute -inset-1 bg-gradient-to-br from-cyan-500 via-purple-500 to-pink-500 rounded-xl opacity-40 blur-xl" />
                <div className="relative rounded-xl overflow-hidden h-full">
                  {HERO_RENDERS.map((render, i) => (
                    <img
                      key={render.url}
                      src={render.url}
                      alt={render.label}
                      className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-1000",
                        i === heroIdx ? "opacity-100" : "opacity-0"
                      )}
                    />
                  ))}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-l from-transparent to-zinc-950/40" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="bg-black/50 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
                      <p className="text-[10px] font-bold tracking-wider uppercase bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                        {HERO_RENDERS[heroIdx]?.label}
                      </p>
                      <p className="text-xs text-zinc-300">
                        {HERO_RENDERS[heroIdx]?.type === "commercial" ? "Commercial wrap — designed to make the phone ring" : "Custom restyle — design-forward, gallery-worthy"}
                      </p>
                    </div>
                  </div>
                  {/* Render dots */}
                  <div className="absolute top-3 right-3 flex gap-1">
                    {HERO_RENDERS.map((_, i) => (
                      <button key={i} onClick={() => setHeroIdx(i)} className={cn(
                        "w-2 h-2 rounded-full transition-all",
                        i === heroIdx ? "bg-white scale-110" : "bg-white/30 hover:bg-white/60"
                      )} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 1: Shop Details ─── */}
          {step === 1 && (
            <div className="flex-1 space-y-6">
              <div className="flex items-center justify-center gap-3">
                <img src="/characters/sproket/sproket-clipboard.png" alt="Sproket" className="h-16 w-auto object-contain" />
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Supercharge Your Sales</h2>
                  <p className="text-zinc-400 text-sm mt-1">This info goes on every proof, quote, and email your customers see</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                <div className="space-y-1">
                  <Label className="text-zinc-400 text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Shop Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className="bg-zinc-900 border-zinc-700" />
                </div>
                <div className="space-y-1">
                  <Label className="text-zinc-400 text-xs flex items-center gap-1"><Globe className="w-3 h-3" /> Website</Label>
                  <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourshop.com" className="bg-zinc-900 border-zinc-700" />
                </div>
              </div>
              <div className="max-w-lg mx-auto space-y-2">
                <Label className="text-zinc-400 text-xs flex items-center gap-1"><Mic2 className="w-3 h-3" /> What does your shop do?</Label>
                <p className="text-zinc-500 text-xs">Pick one or both — we'll tailor your templates</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      id: "formal" as const,
                      title: "Trades & Commercial",
                      tags: "HVAC, Plumbing, Roofing, Fleet, Electrical",
                      desc: "Wraps that make the phone ring. Commercial fleet branding, service vehicles, box trucks.",
                      border: "border-cyan-500",
                      bg: "bg-cyan-500/5",
                      tagColor: "text-cyan-400/70",
                    },
                    {
                      id: "witty" as const,
                      title: "Restyle & Design",
                      tags: "Exotic, Luxury, Custom, Color Change, Racing",
                      desc: "Design-forward wraps that turn heads. Color changes, custom art, graphics, exotics.",
                      border: "border-fuchsia-500",
                      bg: "bg-fuchsia-500/5",
                      tagColor: "text-fuchsia-400/70",
                    },
                  ].map((opt) => {
                    const isSelected = shopVoice === opt.id || shopVoice === "both";
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          if (shopVoice === "both") setShopVoice(opt.id === "formal" ? "witty" : "formal");
                          else if (shopVoice === opt.id) setShopVoice(opt.id === "formal" ? "witty" : "formal");
                          else setShopVoice("both");
                        }}
                        className={cn(
                          "flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all",
                          isSelected ? `${opt.border} ${opt.bg}` : "border-zinc-700 hover:border-zinc-600"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{opt.title}</span>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        </div>
                        <span className={cn("text-[11px] font-medium", opt.tagColor)}>{opt.tags}</span>
                        <span className="text-xs text-zinc-300">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {shopVoice === "both" && (
                  <p className="text-center text-xs text-emerald-400 font-medium">Both selected — you'll get templates for trades AND restyle customers</p>
                )}
              </div>
            </div>
          )}

          {/* ─── STEP 2: Products & Pricing ─── */}
          {step === 2 && (
            <div className="flex-1 space-y-5">
              <div className="flex items-center justify-center gap-3">
                <img src="/characters/sproket/sproket-moneybag.png" alt="Sproket" className="h-16 w-auto object-contain" />
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Products & Pricing</h2>
                  <p className="text-zinc-400 text-sm mt-1">Set your rates so QuickQuote generates accurate quotes instantly</p>
                </div>
              </div>

              {/* Film Brands */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-xs font-semibold">Film Brands You Stock</Label>
                <div className="flex flex-wrap gap-2">
                  {["3M", "Avery Dennison", "Hexis", "KPMF", "Inozetek", "TeckWrap", "VViViD", "Oracal"].map((brand) => (
                    <button
                      key={brand}
                      onClick={() => setFilmBrands((prev) => {
                        const next = new Set(prev);
                        if (next.has(brand)) next.delete(brand); else next.add(brand);
                        return next;
                      })}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all",
                        filmBrands.has(brand)
                          ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                          : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
                      )}
                    >
                      {filmBrands.has(brand) && <span className="mr-1">✓</span>}{brand}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-zinc-300 text-xs">Film Cost (per sq ft)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                    <Input value={filmCost} onChange={(e) => setFilmCost(e.target.value)} className="pl-7 bg-zinc-900 border-zinc-700" placeholder="2.50" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-zinc-300 text-xs">Labor Rate (per sq ft)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                    <Input value={laborRate} onChange={(e) => setLaborRate(e.target.value)} className="pl-7 bg-zinc-900 border-zinc-700" placeholder="6.50" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-zinc-300 text-xs">Markup %</Label>
                  <div className="relative">
                    <Input value={markupPercent} onChange={(e) => setMarkupPercent(e.target.value)} className="pr-7 bg-zinc-900 border-zinc-700" placeholder="65" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">%</span>
                  </div>
                </div>
              </div>

              {/* Quick math preview */}
              <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                <p className="text-xs text-zinc-400 mb-2">Example: Full wrap on a mid-size truck (~250 sq ft)</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-cyan-400">${(250 * (parseFloat(filmCost) || 0)).toFixed(0)}</p>
                    <p className="text-[10px] text-zinc-500">Film Cost</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-fuchsia-400">${(250 * (parseFloat(laborRate) || 0)).toFixed(0)}</p>
                    <p className="text-[10px] text-zinc-500">Labor</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-400">${((250 * ((parseFloat(filmCost) || 0) + (parseFloat(laborRate) || 0))) * (1 + (parseFloat(markupPercent) || 0) / 100)).toFixed(0)}</p>
                    <p className="text-[10px] text-zinc-500">Customer Price</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 3: Logo Upload ─── */}
          {step === 3 && (
            <div className="flex-1 flex flex-col items-center justify-center space-y-6">
              <div className="flex items-center gap-3">
                <img src="/characters/sproket/sproket-designmasterpiece.png" alt="Sproket" className="h-16 w-auto object-contain" />
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Your Shop Logo</h2>
                  <p className="text-zinc-400 text-sm mt-1">Shows on proofs, emails, and branded PDFs your customers receive</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4">
                {/* Logo preview */}
                <div className={cn(
                  "w-40 h-40 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden transition-all",
                  logoUrl ? "border-cyan-500/50 bg-zinc-900" : "border-zinc-600 bg-zinc-900/50 hover:border-zinc-500"
                )}>
                  {logoUrl ? (
                    <img src={logoUrl} alt="Shop logo" className="w-full h-full object-contain p-3" />
                  ) : (
                    <div className="text-center">
                      <Upload className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                      <p className="text-xs text-zinc-500">PNG, JPG, SVG</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {uploadingLogo ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
                  </Button>
                  {logoUrl && (
                    <Button variant="ghost" onClick={() => setLogoUrl(null)} className="text-zinc-500">
                      Remove
                    </Button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />

                {/* Preview of how it looks on a proof */}
                {logoUrl && (
                  <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 w-full max-w-sm">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Preview: how it looks on a proof</p>
                    <div className="flex items-center gap-3 bg-white rounded-lg p-3">
                      <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain" />
                      <div>
                        <p className="text-sm font-bold text-black">{shopName || "Your Shop"}</p>
                        <p className="text-[10px] text-gray-500">{phone || "(555) 123-4567"} · {website || "yourshop.com"}</p>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-center text-xs text-zinc-600">
                  No logo yet? Skip for now — you can upload one later in Settings.
                </p>
              </div>
            </div>
          )}

          {/* ─── STEP 4: Import Contacts ─── */}
          {step === 4 && (
            <div className="flex-1 space-y-5">
              <div className="flex items-center justify-center gap-3">
                <img src="/characters/sproket/sproket-mobile-phone.png" alt="Sproket" className="h-16 w-auto object-contain" />
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Import Your Contacts</h2>
                  <p className="text-zinc-400 text-sm mt-1">
                    Upload from your CMS, Klaviyo, Mailchimp, or any spreadsheet. Add more anytime.
                  </p>
                </div>
              </div>

              {importedCount > 0 ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                  <p className="text-lg font-bold text-white">{importedCount} contacts imported</p>
                  <p className="text-zinc-500 text-sm">Ready for your first campaign</p>
                  <Button variant="outline" size="sm" onClick={() => { setImportedCount(0); setPasted(""); setCsvFileName(null); }}>
                    Import More
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
                        <Upload className="h-4 w-4" /> Upload CSV
                      </Button>
                      {csvFileName && (
                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                          <FileText className="h-4 w-4" />
                          <span className="truncate max-w-[180px]">{csvFileName}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setCsvFileName(null); setPasted(""); }}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFile} />
                    </div>
                    <p className="text-[11px] text-zinc-600">CSV, TXT — first email per line is imported. Headers and extra columns are ignored.</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-zinc-400 text-xs">Or paste emails</Label>
                    <Textarea
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder={"jane@example.com\njohn@example.com\nshop@wrapspot.com"}
                      rows={6}
                      className="font-mono text-sm bg-zinc-900 border-zinc-700"
                    />
                    <p className="text-xs text-zinc-500">
                      {parsedCount > 0 ? `${parsedCount} valid email${parsedCount === 1 ? "" : "s"} detected` : "One email per line, or comma/tab separated"}
                    </p>
                  </div>

                  <Button
                    onClick={handleImportContacts}
                    disabled={importing || parsedCount === 0}
                    className="w-full bg-cyan-600 hover:bg-cyan-700 gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    {importing ? "Importing..." : `Import ${parsedCount || ""} Contact${parsedCount === 1 ? "" : "s"}`}
                  </Button>

                  <p className="text-center text-xs text-zinc-600">
                    No contacts yet? No problem — skip this step and import later from MightyMail.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ─── STEP 5: Booster Packs ─── */}
          {step === 5 && (
            <div className="flex-1 space-y-4">
              <div className="flex items-center justify-center gap-3">
                <img src="/characters/sproket/sproket-announce.png" alt="Sproket" className="h-16 w-auto object-contain" />
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Choose Your Email Packs</h2>
                  <p className="text-zinc-400 text-sm mt-1">
                    Pre-written sequences that sell wraps for you. Pick now, activate anytime from MightyMail.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BOOSTER_PACKS.map((pack) => {
                  const Icon = pack.icon;
                  const selected = selectedPacks.has(pack.id);
                  return (
                    <button
                      key={pack.id}
                      onClick={() => togglePack(pack.id)}
                      className={cn(
                        "flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all",
                        selected
                          ? "border-cyan-500 bg-cyan-500/5"
                          : "border-zinc-700/50 hover:border-zinc-600 bg-zinc-900/50"
                      )}
                    >
                      <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0", pack.gradient)}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{pack.name}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-zinc-700 text-zinc-500">{pack.emails} emails</Badge>
                        </div>
                        <p className="text-xs text-zinc-300 mt-0.5">{pack.desc}</p>
                      </div>
                      {selected && <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-zinc-600">
                {selectedPacks.size > 0 ? `${selectedPacks.size} pack${selectedPacks.size === 1 ? "" : "s"} selected` : "Select packs now or browse all in MightyMail later"}
              </p>
            </div>
          )}

          {/* ─── STEP 6: You're Live ─── */}
          {step === 6 && (
            isWpwTenant ? (
              <WpwUpgradeReveal shopName={shopName} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 relative">
                {/* Celebration gradient burst */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-fuchsia-500/5 rounded-xl pointer-events-none" />
                <div className="relative">
                  <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-orange-500 rounded-full opacity-20 blur-2xl animate-pulse" />
                  <img src="/sproket-rocket-logo.png" alt="Sproket" className="relative h-24 w-auto object-contain drop-shadow-[0_0_30px_rgba(6,182,212,0.5)]" />
                </div>
                <div>
                  <h2 className="text-3xl font-black">
                    <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">{shopName}</span>
                    <span className="text-white"> Is Live!</span>
                  </h2>
                  <p className="text-zinc-300 mt-2 max-w-md">
                    Your shop is set up and ready to close more wraps. Here's your toolkit:
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md text-left">
                  {[
                    { label: "Design a wrap", desc: "AI generates 4K renders in 60 seconds", icon: Palette, color: "from-cyan-500 to-blue-600" },
                    { label: "Send a proof", desc: "Client signs off with one click", icon: Shield, color: "from-emerald-500 to-green-600" },
                    { label: "Email customers", desc: "Automated campaigns that sell", icon: Mail, color: "from-fuchsia-500 to-purple-600" },
                    { label: "Quote a job", desc: "Real pricing, instant delivery", icon: Zap, color: "from-orange-500 to-amber-600" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-700/50 hover:border-zinc-600 transition-all">
                        <div className={cn("w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0", item.color)}>
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{item.label}</p>
                          <p className="text-xs text-zinc-400">{item.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {importedCount > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-sm px-4 py-1">
                    {importedCount} contacts ready for your first campaign
                  </Badge>
                )}
              </div>
            )
          )}

          {/* ─── Navigation ─── */}
          <div className="flex items-center justify-between pt-6 mt-auto border-t border-zinc-800">
            <div>
              {step > 0 && (
                <Button variant="ghost" onClick={() => setStep(step - 1)} className="gap-1 text-zinc-400">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step < 6 && step >= 2 && (
                <Button variant="ghost" onClick={() => setStep(step + 1)} className="text-zinc-500">
                  Skip
                </Button>
              )}
              {step < 6 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={!canNext()}
                  className="gap-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 text-white border-0"
                >
                  Next <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  disabled={saving}
                  className="gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-90 text-white border-0 px-8"
                >
                  {saving ? "Saving..." : "Launch My Shop"} <Rocket className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
