import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCampaignSettings,
  CAMPAIGN_SETTING_DEFAULTS,
  CAMPAIGN_SETTINGS_QUERY_KEY,
  type CampaignSettings,
  type CampaignSettingKey,
} from "@/hooks/useCampaignSettings";
import {
  WPW_OFFER_EMAIL_HTML,
  WPW_OFFER_EMAIL_SUBJECT,
  WPW_OFFER_EMAIL_PREVIEW,
  WPW_OFFER_EMAIL_FROM_NAME,
  WPW_OFFER_SMS,
  WPW_OFFER_SMS_FOLLOWUP,
} from "@/data/wpwOfferCampaign";
import {
  LAUNCH_EMAIL_HTML,
  LAUNCH_EMAIL_SUBJECT,
  LAUNCH_EMAIL_PREVIEW,
  LAUNCH_EMAIL_FROM_NAME,
  LAUNCH_SMS,
  LAUNCH_SMS_FOLLOWUP,
} from "@/data/launchOfferCampaign";
import {
  ExternalLink, RefreshCw, Save, Video, Image as ImageIcon, Play,
  Mail, MessageSquare, Monitor, Smartphone, Copy,
} from "lucide-react";

const GRAD_CSS = "linear-gradient(135deg, #E040FB, #8B5CF6, #3B82F6)";
const CYAN = "#00E5FF";
const GOLD = "#D4AF37";

interface VariantConfig {
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  pageUrl: string;
  videoKey: CampaignSettingKey;
  posterKey: CampaignSettingKey;
  orientation: "horizontal" | "vertical";
}

const VARIANTS: VariantConfig[] = [
  {
    title: "WPW — Horizontal",
    description: "Embedded on /wpw-offer. 16:9 video. Best for desktop email landing.",
    badge: "WPW FAMILY",
    badgeColor: GOLD,
    pageUrl: "/wpw-offer",
    videoKey: "wpw_video_horizontal_url",
    posterKey: "wpw_poster_horizontal",
    orientation: "horizontal",
  },
  {
    title: "WPW — Vertical",
    description: "Embedded on /wpw-offer-vertical. 9:16 phone-frame video. Best for SMS / Reels traffic.",
    badge: "WPW FAMILY",
    badgeColor: GOLD,
    pageUrl: "/wpw-offer-vertical",
    videoKey: "wpw_video_vertical_url",
    posterKey: "wpw_poster_vertical",
    orientation: "vertical",
  },
  {
    title: "Launch — Horizontal",
    description: "Embedded on /launch. 16:9 video. Use as Meta Ads landing for feed/banner placements.",
    badge: "PRE-SALE LAUNCH",
    badgeColor: CYAN,
    pageUrl: "/launch",
    videoKey: "launch_video_horizontal_url",
    posterKey: "launch_poster_horizontal",
    orientation: "horizontal",
  },
  {
    title: "Launch — Vertical",
    description: "Embedded on /launch-vertical. 9:16 video. Use as Meta Ads landing for Reels / Stories / Shorts.",
    badge: "PRE-SALE LAUNCH",
    badgeColor: CYAN,
    pageUrl: "/launch-vertical",
    videoKey: "launch_video_vertical_url",
    posterKey: "launch_poster_vertical",
    orientation: "vertical",
  },
];

const TABS = [
  { id: "videos", label: "Videos", icon: Video },
  { id: "landing", label: "Landing pages", icon: Monitor },
  { id: "email", label: "Email", icon: Mail },
  { id: "sms", label: "SMS", icon: MessageSquare },
] as const;

function normalizeYouTubeUrl(url: string): string {
  if (!url) return url;
  const watch = url.match(/youtube\.com\/watch\?v=([\w-]+)/);
  if (watch) return `https://www.youtube.com/embed/${watch[1]}`;
  const shorts = url.match(/youtube\.com\/shorts\/([\w-]+)/);
  if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`;
  const youtu = url.match(/youtu\.be\/([\w-]+)/);
  if (youtu) return `https://www.youtube.com/embed/${youtu[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

function substituteMergeTags(template: string, sampleName = "Trish") {
  return template
    .replace(/\{\{customer_name\}\}/g, sampleName)
    .replace(/\{\{customer_email\}\}/g, `${sampleName.toLowerCase()}@weprintwraps.com`)
    .replace(/\{\{current_year\}\}/g, String(new Date().getFullYear()))
    .replace(/\{\{unsubscribe_url\}\}/g, "#");
}

const SmsBubble = ({ message, sender }: { message: string; sender: string }) => (
  <div className="rounded-2xl border border-[#1A1A1A] bg-[#050505] p-4">
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs text-[#888] font-mono">{sender}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px] border-[#222] hover:bg-[#1A1A1A] text-white"
        onClick={() => {
          navigator.clipboard.writeText(message);
          toast.success("Copied to clipboard");
        }}
      >
        <Copy className="w-3 h-3 mr-1.5" /> Copy
      </Button>
    </div>
    <div className="bg-[#0F1A2A] border border-cyan-500/20 rounded-2xl rounded-tl-md px-4 py-3 max-w-[440px]">
      <p className="text-[14px] text-white leading-relaxed whitespace-pre-wrap">{message}</p>
    </div>
    <p className="mt-2 text-[10px] text-[#555] font-mono">
      {message.length} chars · {message.length <= 160 ? "1 segment" : `${Math.ceil(message.length / 160)} segments`}
    </p>
  </div>
);

const AdminCampaignVideos = () => {
  const { data: settings, isLoading, refetch } = useCampaignSettings();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<CampaignSettings>({ ...CAMPAIGN_SETTING_DEFAULTS });
  const [saving, setSaving] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<CampaignSettingKey | null>(null);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]["id"]>("videos");
  const [activeLanding, setActiveLanding] = useState<string>(VARIANTS[0].pageUrl);
  const [sampleName, setSampleName] = useState("Trish");

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const wpwEmailHtml = useMemo(() => substituteMergeTags(WPW_OFFER_EMAIL_HTML, sampleName), [sampleName]);
  const launchEmailHtml = useMemo(() => substituteMergeTags(LAUNCH_EMAIL_HTML, sampleName), [sampleName]);
  const wpwSubject = useMemo(() => substituteMergeTags(WPW_OFFER_EMAIL_SUBJECT, sampleName), [sampleName]);
  const launchSubject = useMemo(() => substituteMergeTags(LAUNCH_EMAIL_SUBJECT, sampleName), [sampleName]);
  const wpwSmsRendered = useMemo(() => substituteMergeTags(WPW_OFFER_SMS, sampleName), [sampleName]);
  const wpwSmsFollowupRendered = useMemo(() => substituteMergeTags(WPW_OFFER_SMS_FOLLOWUP, sampleName), [sampleName]);
  const launchSmsRendered = useMemo(() => substituteMergeTags(LAUNCH_SMS, sampleName), [sampleName]);
  const launchSmsFollowupRendered = useMemo(() => substituteMergeTags(LAUNCH_SMS_FOLLOWUP, sampleName), [sampleName]);

  const isDirty = (variant: VariantConfig) =>
    settings &&
    (draft[variant.videoKey] !== settings[variant.videoKey] ||
      draft[variant.posterKey] !== settings[variant.posterKey]);

  const handleChange = (key: CampaignSettingKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSave = async (variant: VariantConfig) => {
    const normalizedVideo = normalizeYouTubeUrl(draft[variant.videoKey].trim());
    const normalizedPoster = draft[variant.posterKey].trim();

    if (!normalizedVideo || !normalizedPoster) {
      toast.error("Video URL and poster path are both required.");
      return;
    }

    setSaving(variant.title);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = [
        { key: variant.videoKey, value: normalizedVideo, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
        { key: variant.posterKey, value: normalizedPoster, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
      ];
      const { error } = await supabase
        .from("campaign_settings" as any)
        .upsert(rows, { onConflict: "key" });
      if (error) throw error;
      setDraft((d) => ({ ...d, [variant.videoKey]: normalizedVideo, [variant.posterKey]: normalizedPoster }));
      await queryClient.invalidateQueries({ queryKey: CAMPAIGN_SETTINGS_QUERY_KEY });
      toast.success(`${variant.title} saved. Live in ~30 seconds.`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save. Make sure you're an admin.");
    } finally {
      setSaving(null);
    }
  };

  const togglePreview = (key: CampaignSettingKey) => {
    setPreviewKey((curr) => (curr === key ? null : key));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A]" style={{ fontFamily: "'DM Sans', sans-serif", color: "#EAEAEA" }}>
      <Helmet>
        <title>Campaign Studio — Admin</title>
      </Helmet>

      <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <header className="mb-6">
          <p className="text-[11px] font-mono tracking-widest text-[#666] mb-2">ADMIN · MARKETING</p>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Campaign Studio</h1>
          <p className="text-sm text-[#888] max-w-2xl leading-relaxed">
            Preview every selling page, email, and SMS in one place. Swap videos and posters from
            the <span style={{ color: CYAN }}>Videos</span> tab — changes propagate to the live pages within 30 seconds.
          </p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Button onClick={() => refetch()} variant="outline" size="sm" className="border-[#222] hover:bg-[#111] text-white">
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
              Reload from DB
            </Button>
            <div className="flex items-center gap-2 text-xs">
              <Label htmlFor="sample-name" className="text-[#666] font-mono">SAMPLE NAME</Label>
              <Input
                id="sample-name"
                value={sampleName}
                onChange={(e) => setSampleName(e.target.value || "there")}
                className="h-8 w-32 bg-[#0A0A0A] border-[#222] text-white text-xs"
              />
            </div>
            {isLoading && <span className="text-xs text-[#666] font-mono">loading…</span>}
          </div>
        </header>

        {/* Sticky tab nav */}
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#0A0A0A]/95 backdrop-blur border-b border-[#1A1A1A] mb-8">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                    active ? "text-white" : "text-[#777] hover:text-[#bbb]"
                  }`}
                  style={active ? { background: GRAD_CSS } : { background: "#111", border: "1px solid #1A1A1A" }}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===== VIDEOS TAB ===== */}
        {activeTab === "videos" && (
          <div className="space-y-5">
            {VARIANTS.map((variant) => {
              const dirty = isDirty(variant);
              const previewVideo = previewKey === variant.videoKey;
              const videoUrl = draft[variant.videoKey];
              return (
                <section key={variant.title} className="rounded-2xl border border-[#1A1A1A] bg-[#111] overflow-hidden">
                  <div className="px-5 sm:px-6 py-4 border-b border-[#1A1A1A] flex flex-wrap items-center gap-3">
                    <span
                      className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest font-mono"
                      style={{
                        background: `${variant.badgeColor}1A`,
                        border: `1px solid ${variant.badgeColor}55`,
                        color: variant.badgeColor,
                      }}
                    >
                      {variant.badge}
                    </span>
                    <h2 className="text-base sm:text-lg font-bold flex-1 min-w-0">{variant.title}</h2>
                    <a
                      href={variant.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 font-medium"
                    >
                      Open page <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="p-5 sm:p-6 space-y-4">
                    <p className="text-xs text-[#777] leading-relaxed">{variant.description}</p>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 lg:gap-6">
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor={variant.videoKey} className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase text-[#999] mb-1.5">
                            <Video className="w-3.5 h-3.5" /> Video URL
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id={variant.videoKey}
                              value={videoUrl}
                              onChange={(e) => handleChange(variant.videoKey, e.target.value)}
                              placeholder="https://youtube.com/watch?v=…  or  https://player.vimeo.com/video/…"
                              className="bg-[#0A0A0A] border-[#222] text-white placeholder:text-[#444] focus:border-cyan-500/50"
                            />
                            <Button
                              type="button"
                              onClick={() => togglePreview(variant.videoKey)}
                              variant="outline"
                              size="sm"
                              className="shrink-0 border-[#222] hover:bg-[#1A1A1A] text-white"
                            >
                              <Play className="w-3.5 h-3.5 mr-1.5" />
                              {previewVideo ? "Hide" : "Preview"}
                            </Button>
                          </div>
                          <p className="mt-1.5 text-[11px] text-[#555] font-mono">
                            Watch links auto-convert to /embed/. Direct .mp4 URLs also work.
                          </p>
                        </div>

                        <div>
                          <Label htmlFor={variant.posterKey} className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase text-[#999] mb-1.5">
                            <ImageIcon className="w-3.5 h-3.5" /> Poster image URL
                          </Label>
                          <Input
                            id={variant.posterKey}
                            value={draft[variant.posterKey]}
                            onChange={(e) => handleChange(variant.posterKey, e.target.value)}
                            placeholder="/screenshots/your-poster.png  or  https://…"
                            className="bg-[#0A0A0A] border-[#222] text-white placeholder:text-[#444] focus:border-cyan-500/50"
                          />
                          <p className="mt-1.5 text-[11px] text-[#555] font-mono">
                            Drop a still frame in /public/screenshots/ and reference as /screenshots/file.png — or paste a full https URL.
                          </p>
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                          <Button
                            type="button"
                            onClick={() => handleSave(variant)}
                            disabled={!dirty || saving === variant.title}
                            className="text-white border-0 disabled:opacity-50"
                            style={{ background: GRAD_CSS }}
                          >
                            <Save className="w-4 h-4 mr-2" />
                            {saving === variant.title ? "Saving…" : dirty ? "Save changes" : "Saved"}
                          </Button>
                          {dirty && <span className="text-[11px] text-amber-400 font-mono">unsaved changes</span>}
                        </div>
                      </div>

                      <div className="lg:w-[280px] shrink-0">
                        <p className="text-xs text-[#666] font-mono uppercase tracking-wider mb-2">Poster preview</p>
                        <div
                          className={`relative bg-black rounded-xl overflow-hidden border border-[#1A1A1A] ${variant.orientation === "vertical" ? "aspect-[9/16] max-w-[180px]" : "aspect-video"}`}
                        >
                          <img
                            key={draft[variant.posterKey]}
                            src={draft[variant.posterKey]}
                            alt={`${variant.title} poster`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div
                              className="w-12 h-12 rounded-full flex items-center justify-center"
                              style={{ background: GRAD_CSS }}
                            >
                              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {previewVideo && videoUrl && (
                      <div className="mt-2">
                        <p className="text-xs text-[#666] font-mono uppercase tracking-wider mb-2">Video preview</p>
                        <div
                          className={`relative bg-black rounded-xl overflow-hidden border border-[#1A1A1A] ${variant.orientation === "vertical" ? "aspect-[9/16] max-w-[280px]" : "aspect-video max-w-2xl"}`}
                        >
                          <iframe
                            src={`${normalizeYouTubeUrl(videoUrl)}?rel=0&playsinline=1`}
                            title={`${variant.title} preview`}
                            className="absolute inset-0 w-full h-full"
                            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* ===== LANDING PAGES TAB ===== */}
        {activeTab === "landing" && (
          <div className="space-y-5">
            <p className="text-xs text-[#666] leading-relaxed mb-2">
              Live render of each selling page. Switch variants below — the page loads in an inline frame so you can scroll and click around.
            </p>
            <div className="flex gap-2 flex-wrap">
              {VARIANTS.map((v) => {
                const active = activeLanding === v.pageUrl;
                return (
                  <button
                    key={v.pageUrl}
                    onClick={() => setActiveLanding(v.pageUrl)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${active ? "text-white" : "text-[#888] hover:text-white"}`}
                    style={active ? { background: GRAD_CSS } : { background: "#111", border: "1px solid #1A1A1A" }}
                  >
                    {v.orientation === "vertical" ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                    {v.title}
                  </button>
                );
              })}
            </div>

            {VARIANTS.filter((v) => v.pageUrl === activeLanding).map((v) => (
              <section key={v.pageUrl} className="rounded-2xl border border-[#1A1A1A] bg-[#111] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1A1A1A] flex items-center justify-between">
                  <p className="text-sm text-white font-mono">{v.pageUrl}</p>
                  <a href={v.pageUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">
                    Open in new tab <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="bg-[#0A0A0A] flex items-start justify-center p-4">
                  <iframe
                    key={v.pageUrl}
                    src={v.pageUrl}
                    title={v.title}
                    className={`bg-black rounded-lg border border-[#1A1A1A] ${v.orientation === "vertical" ? "w-[390px] h-[820px]" : "w-full h-[1200px] max-w-[1100px]"}`}
                    loading="lazy"
                  />
                </div>
              </section>
            ))}
          </div>
        )}

        {/* ===== EMAIL TAB ===== */}
        {activeTab === "email" && (
          <div className="space-y-6">
            {[
              { id: "wpw-email", label: "WPW", subject: wpwSubject, preview: WPW_OFFER_EMAIL_PREVIEW, from: WPW_OFFER_EMAIL_FROM_NAME, html: wpwEmailHtml, color: GOLD, badge: "WPW FAMILY" },
              { id: "launch-email", label: "Launch", subject: launchSubject, preview: LAUNCH_EMAIL_PREVIEW, from: LAUNCH_EMAIL_FROM_NAME, html: launchEmailHtml, color: CYAN, badge: "PRE-SALE LAUNCH" },
            ].map((e) => (
              <section key={e.id} className="rounded-2xl border border-[#1A1A1A] bg-[#111] overflow-hidden">
                <div className="px-5 sm:px-6 py-4 border-b border-[#1A1A1A] flex flex-wrap items-center gap-3">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest font-mono" style={{ background: `${e.color}1A`, border: `1px solid ${e.color}55`, color: e.color }}>
                    {e.badge}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold flex-1 min-w-0">{e.label} email</h2>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs border-[#222] hover:bg-[#1A1A1A] text-white"
                    onClick={() => {
                      navigator.clipboard.writeText(e.html);
                      toast.success("Rendered HTML copied — paste into AdminEmailCampaigns");
                    }}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy HTML
                  </Button>
                </div>

                <div className="px-5 sm:px-6 py-4 space-y-2 text-xs border-b border-[#1A1A1A] bg-[#0A0A0A]">
                  <div className="flex gap-2"><span className="text-[#666] font-mono w-16 shrink-0">FROM</span><span className="text-white">{e.from}</span></div>
                  <div className="flex gap-2"><span className="text-[#666] font-mono w-16 shrink-0">SUBJECT</span><span className="text-white">{e.subject}</span></div>
                  <div className="flex gap-2"><span className="text-[#666] font-mono w-16 shrink-0">PREVIEW</span><span className="text-[#aaa]">{e.preview}</span></div>
                </div>

                <div className="bg-white">
                  <iframe
                    title={`${e.label} email preview`}
                    srcDoc={e.html}
                    sandbox="allow-same-origin"
                    className="w-full h-[1100px] border-0"
                  />
                </div>
              </section>
            ))}
          </div>
        )}

        {/* ===== SMS TAB ===== */}
        {activeTab === "sms" && (
          <div className="space-y-6">
            {[
              { label: "WPW", color: GOLD, badge: "WPW FAMILY", initial: wpwSmsRendered, follow: wpwSmsFollowupRendered, sender: "From: WePrintWraps · +1 (555) 555-0101" },
              { label: "Launch", color: CYAN, badge: "PRE-SALE LAUNCH", initial: launchSmsRendered, follow: launchSmsFollowupRendered, sender: "From: DesignProAI · +1 (555) 555-0202" },
            ].map((c) => (
              <section key={c.label} className="rounded-2xl border border-[#1A1A1A] bg-[#111] overflow-hidden">
                <div className="px-5 sm:px-6 py-4 border-b border-[#1A1A1A] flex flex-wrap items-center gap-3">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest font-mono" style={{ background: `${c.color}1A`, border: `1px solid ${c.color}55`, color: c.color }}>
                    {c.badge}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold flex-1 min-w-0">{c.label} SMS</h2>
                </div>
                <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[#666] font-mono uppercase tracking-wider mb-2">Initial</p>
                    <SmsBubble message={c.initial} sender={c.sender} />
                  </div>
                  <div>
                    <p className="text-xs text-[#666] font-mono uppercase tracking-wider mb-2">Follow-up (3 days later)</p>
                    <SmsBubble message={c.follow} sender={c.sender} />
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-10 text-xs text-[#555] font-mono leading-relaxed">
          <p>
            Settings are stored in <span style={{ color: CYAN }}>public.campaign_settings</span>. Read-access is open;
            write-access requires an <span style={{ color: CYAN }}>admin</span> or <span style={{ color: CYAN }}>tester</span> role.
            Email + SMS templates are bundled in <span style={{ color: CYAN }}>src/data/wpwOfferCampaign.ts</span> and <span style={{ color: CYAN }}>src/data/launchOfferCampaign.ts</span>.
          </p>
        </footer>
      </main>
    </div>
  );
};

export default AdminCampaignVideos;
