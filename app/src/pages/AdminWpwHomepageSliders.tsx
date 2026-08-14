import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Image as ImageIcon, ChevronLeft, ChevronRight, Copy } from "lucide-react";

interface WpwSlider {
  id: string;
  slot: number;
  name: string;
  headline: string;
  pill_text: string | null;
  sub_headline: string | null;
  cta_label: string | null;
  cta_url: string | null;
  image_url: string | null;
  image_alt: string | null;
  is_active: boolean;
  sort_order: number;
  affiliate_id: string | null;
  pack_eyebrow: string | null;
  pack_title: string | null;
  pack_sub: string | null;
}

interface SpotlightRep {
  id: string;
  full_name: string;
  referral_code: string;
  status: string;
  headshot_url: string | null;
  company_name: string | null;
  coupon_percent_off: number | null;
  spotlight_image_url: string | null;
  spotlight_quote: string | null;
}

// Default product-pack copy for the right panel (per-slide editable; these
// are only the fallback when a slide leaves the pack fields blank).
const PACK_DEFAULT = {
  eyebrow: "Design It in DesignProAI",
  title: "Buy a Production Pack for $299",
  sub: "Print-ready files created by a real vehicle wrap designer, emailed in 48 hours.",
};

const packCopy = (slider: WpwSlider) => ({
  eyebrow: slider.pack_eyebrow || PACK_DEFAULT.eyebrow,
  title: slider.pack_title || PACK_DEFAULT.title,
  sub: slider.pack_sub || PACK_DEFAULT.sub,
});

const repPhoto = (rep: SpotlightRep | null) =>
  rep ? rep.spotlight_image_url || rep.headshot_url : null;

const repAttribution = (rep: SpotlightRep) =>
  rep.company_name ? `${rep.full_name}, Owner of ${rep.company_name}` : rep.full_name;

/**
 * Generates a ready-to-paste HTML block for the WPW Elementor slider.
 * Drop into a WordPress HTML widget (or Loop Carousel item) on the
 * WePrintWraps.com homepage.
 *
 * Black 4-zone DesignProAI banner (matches the approved design):
 *   [1] $25 offer  ·  [2] affiliate photo + testimonial  ·
 *   [3] promo code + % off  ·  [4] $299 production pack
 * Affiliate data (photo, quote, company, referral code, % off) is pulled
 * from affiliate_partners when a rep is featured. The whole banner links
 * to the CTA destination.
 */
const buildElementorBlock = (
  slider: WpwSlider,
  rep: SpotlightRep | null,
  ctaHref: string
): string => {
  const esc = (s: string | null | undefined) =>
    (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pack = packCopy(slider);
  const photo = repPhoto(rep);
  const quoteBlock = rep && rep.spotlight_quote
    ? `<div style="position:absolute;left:0;right:0;bottom:0;padding:24px;background:linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%);color:#fff;">
        <div style="font-size:18px;font-weight:700;font-style:italic;line-height:1.3;">&ldquo;${esc(rep.spotlight_quote)}&rdquo;</div>
        <div style="margin-top:8px;font-size:13px;color:#cbd5e1;">-${esc(repAttribution(rep))}</div>
      </div>`
    : "";
  const promoZone = rep && rep.referral_code
    ? `<div style="font-size:30px;font-weight:800;line-height:1.08;">Enter Promo Code: <span style="color:#00C7FF;">${esc(rep.referral_code)}</span></div>
       ${rep.coupon_percent_off ? `<div style="font-size:26px;font-weight:800;line-height:1.1;margin-top:18px;">Get ${rep.coupon_percent_off}% off a monthly subscription</div>` : ""}`
    : `<div style="color:#64748b;font-weight:600;">Feature a rep to show their promo code</div>`;
  return `<!-- WPW Slider · Slot ${slider.slot} · ${esc(slider.name)} -->
<a href="${esc(ctaHref)}" target="_blank" rel="noopener" style="text-decoration:none;display:block;">
<div style="position:relative;width:100%;max-width:2400px;margin:0 auto;background:#000;color:#fff;font-family:'Poppins',sans-serif;overflow:hidden;border-radius:12px;">
  <div style="display:flex;flex-wrap:wrap;align-items:stretch;">
    <div style="flex:1 1 24%;min-width:240px;padding:32px;display:flex;flex-direction:column;justify-content:center;">
      <div style="font-weight:800;font-size:24px;line-height:1;">Design<span style="color:#a855f7;">Pro</span><span style="color:#00C7FF;">AI</span><span style="font-size:13px;vertical-align:super;">&trade;</span></div>
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#a855f7;font-weight:700;margin:4px 0 22px 0;">Graphic Design System</div>
      <h2 style="font-size:34px;line-height:1.05;font-weight:800;margin:0;color:#fff;">${esc(slider.headline)}</h2>
      ${slider.sub_headline ? `<p style="font-size:14px;line-height:1.45;color:#cbd5e1;margin:14px 0 0 0;">${esc(slider.sub_headline)}</p>` : ""}
    </div>
    <div style="flex:1 1 28%;min-width:240px;position:relative;background:#111;min-height:240px;">
      ${photo ? `<img src="${esc(photo)}" alt="${esc(rep ? repAttribution(rep) : slider.name)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />` : '<div style="min-height:240px;display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:600;">Feature a rep to show their photo + quote</div>'}
      ${quoteBlock}
    </div>
    <div style="flex:1 1 22%;min-width:220px;padding:32px;display:flex;flex-direction:column;justify-content:center;">
      ${promoZone}
    </div>
    <div style="flex:1 1 26%;min-width:240px;padding:24px;display:flex;flex-direction:column;justify-content:center;gap:12px;">
      ${slider.image_url ? `<img src="${esc(slider.image_url)}" alt="${esc(slider.image_alt || "DesignProAI production pack")}" style="display:block;width:100%;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,0.5);" />` : ""}
      <div>
        <div style="font-weight:700;color:#fff;font-size:15px;">${esc(pack.eyebrow)}</div>
        <div style="font-weight:800;color:#fff;font-size:20px;line-height:1.1;margin-top:2px;">${esc(pack.title)}</div>
        <div style="color:#cbd5e1;font-size:13px;line-height:1.45;margin-top:6px;">${esc(pack.sub)}</div>
      </div>
    </div>
  </div>
</div>
</a>
<!-- /WPW Slider · Slot ${slider.slot} -->`;
};

/**
 * Plain-text content sheet for the 3-panel slide. The native Elementor
 * Slides widget can't render a 3-column testimonial layout, so the HTML
 * block (buildElementorBlock) is the way to ship this design - this sheet
 * is a content reference / for an HTML widget paste.
 */
const buildElementorFields = (
  slider: WpwSlider,
  rep: SpotlightRep | null,
  ctaHref: string
): string => {
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "-");
  const pack = packCopy(slider);
  return `WPW Slider · Slot ${slider.slot} · ${slider.name}
Black 4-zone DesignProAI banner. Use the "Copy HTML" block for the live
layout; this is the editable text content. Whole banner links to: ${v(ctaHref)}

ZONE 1 - Offer
  Brand: DesignProAI™ · Graphic Design System
  Headline: ${v(slider.headline)}
  Sub-line: ${v(slider.sub_headline)}

ZONE 2 - Affiliate spotlight ${rep ? "" : "(none selected)"}
  Photo: ${rep ? v(repPhoto(rep)) : "-"}
  Quote: ${rep ? v(rep.spotlight_quote) : "-"}
  Attribution: ${rep ? repAttribution(rep) : "-"}

ZONE 3 - Promo code
  ${rep && rep.referral_code ? `Enter Promo Code: ${rep.referral_code}` : "-"}
  ${rep && rep.coupon_percent_off ? `Get ${rep.coupon_percent_off}% off a monthly subscription` : "-"}

ZONE 4 - Production pack
  ${pack.eyebrow}
  ${pack.title}
  ${pack.sub}
  Image: ${v(slider.image_url)}`;
};

const resolveCtaHref = (slider: WpwSlider, rep: SpotlightRep | null) =>
  rep
    ? `https://designproai.com/wpw/${rep.full_name.toLowerCase().split(" ")[0]}`
    : slider.cta_url || "https://designproai.com";

const SliderPreview = ({ slider, rep }: { slider: WpwSlider; rep?: SpotlightRep | null }) => {
  const photo = repPhoto(rep || null);
  const pack = packCopy(slider);
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black shadow-sm ring-1 ring-gray-800"
      style={{ aspectRatio: "2000 / 440", containerType: "inline-size" }}
    >
      <div className="absolute inset-0 flex">
        {/* Zone 1 - offer */}
        <div className="flex w-[24%] flex-col justify-center overflow-hidden px-[2.5%]">
          <div className="font-extrabold leading-none text-white" style={{ fontSize: "clamp(8px, 1.3cqw, 26px)" }}>
            Design<span className="text-[#a855f7]">Pro</span><span className="text-[#00C7FF]">AI</span>
            <span style={{ fontSize: "0.55em", verticalAlign: "super" }}>™</span>
          </div>
          <div
            className="font-bold uppercase tracking-wider text-violet-400"
            style={{ fontSize: "clamp(5px, 0.65cqw, 13px)", marginBottom: "1cqw" }}
          >
            Graphic Design System
          </div>
          <h2
            className="font-bold leading-tight text-white"
            style={{ fontFamily: "Oswald, sans-serif", fontSize: "clamp(8px, 2cqw, 40px)" }}
          >
            {slider.headline}
          </h2>
          {slider.sub_headline && (
            <p className="mt-2 text-gray-300" style={{ fontSize: "clamp(5px, 0.7cqw, 14px)" }}>
              {slider.sub_headline}
            </p>
          )}
        </div>

        {/* Zone 2 - affiliate photo + testimonial */}
        <div className="relative w-[28%] bg-neutral-900">
          {photo ? (
            <img src={photo} alt={rep ? repAttribution(rep) : slider.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center text-neutral-500" style={{ fontSize: "clamp(6px, 0.65cqw, 13px)" }}>
              Feature a rep to show their photo + quote
            </div>
          )}
          {rep && rep.spotlight_quote && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-[5%] text-white">
              <div className="font-bold italic leading-snug" style={{ fontSize: "clamp(6px, 0.9cqw, 18px)" }}>
                “{rep.spotlight_quote}”
              </div>
              <div className="mt-1 text-gray-300" style={{ fontSize: "clamp(5px, 0.65cqw, 13px)" }}>
                - {repAttribution(rep)}
              </div>
            </div>
          )}
        </div>

        {/* Zone 3 - promo code */}
        <div className="flex w-[22%] flex-col justify-center overflow-hidden px-[2.5%]">
          {rep && rep.referral_code ? (
            <>
              <div className="font-extrabold leading-tight text-white" style={{ fontSize: "clamp(8px, 1.5cqw, 30px)" }}>
                Enter Promo Code: <span className="text-[#00C7FF]">{rep.referral_code}</span>
              </div>
              {rep.coupon_percent_off ? (
                <div className="mt-3 font-extrabold leading-tight text-white" style={{ fontSize: "clamp(7px, 1.3cqw, 26px)" }}>
                  Get {rep.coupon_percent_off}% off a monthly subscription
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-neutral-500" style={{ fontSize: "clamp(5px, 0.65cqw, 13px)" }}>
              Feature a rep to show their promo code
            </div>
          )}
        </div>

        {/* Zone 4 - production pack */}
        <div className="flex w-[26%] flex-col justify-center gap-[3%] overflow-hidden px-[2.5%]">
          {slider.image_url ? (
            <img
              src={slider.image_url}
              alt={slider.image_alt || "DesignProAI production pack"}
              className="w-full rounded shadow-lg"
            />
          ) : (
            <div className="flex items-center justify-center rounded bg-neutral-900 py-[10%] text-neutral-500">
              <div className="flex flex-col items-center gap-1">
                <ImageIcon className="h-8 w-8" />
                <span style={{ fontSize: "clamp(5px, 0.55cqw, 11px)" }}>No image - upload below</span>
              </div>
            </div>
          )}
          <div>
            <div className="font-bold text-white" style={{ fontSize: "clamp(5px, 0.75cqw, 15px)" }}>
              {pack.eyebrow}
            </div>
            <div className="font-extrabold leading-tight text-white" style={{ fontSize: "clamp(6px, 1cqw, 20px)" }}>
              {pack.title}
            </div>
            <div className="mt-1 text-gray-300" style={{ fontSize: "clamp(5px, 0.65cqw, 13px)" }}>
              {pack.sub}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
        <ChevronLeft className="h-6 w-6 text-white/40" />
        <ChevronRight className="h-6 w-6 text-white/40" />
      </div>
    </div>
  );
};

const SliderRotator = ({
  sliders,
  repById,
}: {
  sliders: WpwSlider[];
  repById: (id: string | null) => SpotlightRep | null;
}) => {
  const [index, setIndex] = useState(0);
  const active = sliders.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);

  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % active.length), 7000);
    return () => clearInterval(t);
  }, [active.length]);

  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 bg-black/40 p-8 text-center text-gray-400">
        No active sliders. Toggle at least one slider to active to see the rotation preview.
      </div>
    );
  }

  const current = active[index % active.length];
  return (
    <div className="space-y-3">
      <SliderPreview slider={current} rep={repById(current.affiliate_id)} />
      <div className="flex items-center justify-center gap-2">
        {active.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setIndex(i)}
            className={`h-2 rounded-full transition-all ${
              i === index ? "w-8 bg-cyan-400" : "w-2 bg-gray-600 hover:bg-gray-500"
            }`}
            aria-label={`Show slide ${i + 1}`}
          />
        ))}
      </div>
      <p className="text-center text-xs text-gray-500">
        Auto-rotates every 7 seconds. Click dots to jump. {active.length} of {sliders.length} slides active.
      </p>
    </div>
  );
};

const AdminWpwHomepageSliders = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Partial<WpwSlider>>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const { data: sliders = [], isLoading } = useQuery({
    queryKey: ["wpw_homepage_sliders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wpw_homepage_sliders" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as WpwSlider[];
    },
  });

  const { data: spotlightReps = [] } = useQuery({
    queryKey: ["affiliate_partners_spotlight"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("affiliate_partners" as any)
        .select("id, full_name, referral_code, status, headshot_url, company_name, coupon_percent_off, spotlight_image_url, spotlight_quote")
        .eq("status", "active")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SpotlightRep[];
    },
  });

  const repById = (id: string | null) =>
    (id ? spotlightReps.find((r) => r.id === id) : null) || null;

  const saveMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WpwSlider> }) => {
      const { error } = await supabase
        .from("wpw_homepage_sliders" as any)
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wpw_homepage_sliders"] });
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.id];
        return next;
      });
      toast({ title: "Saved", description: "Slider updated." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpload = async (slider: WpwSlider, file: File) => {
    setUploadingId(slider.id);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `wpw-sliders/slot-${slider.slot}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("carousel-images")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("carousel-images").getPublicUrl(path);
      await saveMutation.mutateAsync({ id: slider.id, patch: { image_url: publicUrl } });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingId(null);
    }
  };

  const getDraft = (slider: WpwSlider): WpwSlider => ({ ...slider, ...drafts[slider.id] });
  const isDirty = (id: string) => drafts[id] && Object.keys(drafts[id]).length > 0;
  const updateDraft = (id: string, key: keyof WpwSlider, value: any) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading sliders…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-gray-800 bg-gray-950/50">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Admin
            </Button>
            <div>
              <h1 className="text-2xl font-bold">WePrintWraps.com Homepage Sliders</h1>
              <p className="text-sm text-gray-400">
                Preview, swap images, and edit the 5 rotating hero slides for WePrintWraps.com.
                These are mirrored to the live site's Elementor slider - changes here are the
                source of truth for the copy + imagery.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto space-y-8 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Live Rotation Preview</span>
              <Badge variant="secondary">7s auto-advance</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SliderRotator sliders={sliders} repById={repById} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          {sliders.map((slider) => {
            const draft = getDraft(slider);
            const dirty = isDirty(slider.id);
            return (
              <Card key={slider.id} className={dirty ? "border-cyan-500/50" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-3">
                      <Badge variant="outline">Slot {slider.slot}</Badge>
                      <span>{slider.name}</span>
                    </span>
                    <div className="flex items-center gap-3">
                      <Label htmlFor={`active-${slider.id}`} className="text-sm">
                        Active
                      </Label>
                      <Switch
                        id={`active-${slider.id}`}
                        checked={draft.is_active}
                        onCheckedChange={(v) => updateDraft(slider.id, "is_active", v)}
                      />
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <SliderPreview slider={draft} rep={repById(draft.affiliate_id)} />

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Zone 1 · Headline</Label>
                      <Input
                        value={draft.headline}
                        onChange={(e) => updateDraft(slider.id, "headline", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Banner link URL</Label>
                      <Input
                        placeholder="https://designproai.com/..."
                        value={draft.cta_url || ""}
                        onChange={(e) => updateDraft(slider.id, "cta_url", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Zone 1 · Sub-line (Includes…)</Label>
                      <Textarea
                        value={draft.sub_headline || ""}
                        onChange={(e) => updateDraft(slider.id, "sub_headline", e.target.value)}
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2 border-t border-gray-800 pt-4">
                      <Label className="text-cyan-300">Panel 3 · Production pack copy</Label>
                      <p className="text-xs text-gray-500">
                        The right-hand "$299 Production Pack" panel. Leave blank to use the default copy.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Pack · Eyebrow</Label>
                      <Input
                        placeholder="Design It in DesignProAI"
                        value={draft.pack_eyebrow || ""}
                        onChange={(e) => updateDraft(slider.id, "pack_eyebrow", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pack · Title</Label>
                      <Input
                        placeholder="Buy a Production Pack for $299"
                        value={draft.pack_title || ""}
                        onChange={(e) => updateDraft(slider.id, "pack_title", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Pack · Sub-line</Label>
                      <Textarea
                        placeholder="Print-ready files created by a real vehicle wrap designer, emailed in 48 hours."
                        value={draft.pack_sub || ""}
                        onChange={(e) => updateDraft(slider.id, "pack_sub", e.target.value)}
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Image alt text</Label>
                      <Input
                        value={draft.image_alt || ""}
                        onChange={(e) => updateDraft(slider.id, "image_alt", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sort order</Label>
                      <Input
                        type="number"
                        value={draft.sort_order}
                        onChange={(e) =>
                          updateDraft(slider.id, "sort_order", parseInt(e.target.value) || 0)
                        }
                      />
                    </div>

                    {/* Per-rep spotlight: pick an active rep to feature on this slide.
                        When set, the rep's branded /wpw/<rep> landing becomes the
                        CTA destination and their card on /affiliate/marketing shows
                        "You're live on WPW.com this week". */}
                    <div className="space-y-2 md:col-span-2">
                      <Label className="flex items-center gap-2">
                        <span>Feature a Rep on this Slide</span>
                        {draft.affiliate_id && (() => {
                          const rep = repById(draft.affiliate_id);
                          return rep ? (
                            <Badge className="bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40">
                              Spotlight · {rep.full_name} · {rep.referral_code}
                            </Badge>
                          ) : null;
                        })()}
                      </Label>
                      <select
                        className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
                        value={draft.affiliate_id || ""}
                        onChange={(e) =>
                          updateDraft(slider.id, "affiliate_id", e.target.value || null)
                        }
                      >
                        <option value="">No rep spotlight (default slide)</option>
                        {spotlightReps.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.full_name} ({rep.referral_code})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Picking a rep makes this a "spotlight" slide. Their referral
                        code auto-attaches to the CTA URL and they see "You're live
                        on WPW.com this week" on their dashboard.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 pt-4">
                    <Label
                      htmlFor={`upload-${slider.id}`}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-cyan-500/20 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-500/30"
                    >
                      <Upload className="h-4 w-4" />
                      {uploadingId === slider.id ? "Uploading…" : "Upload Zone 4 product image"}
                      <input
                        id={`upload-${slider.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingId === slider.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(slider, f);
                          e.target.value = "";
                        }}
                      />
                    </Label>
                    <span className="text-xs text-gray-500">
                      Zone 4 = the DesignProAI screenshot (right panel). Zone 2 (affiliate
                      photo + quote + % off) is pulled from the featured rep&apos;s record.
                      Recommended: square or 4:3 JPG, &lt;350&nbsp;KB.
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        const rep = repById(draft.affiliate_id);
                        const fields = buildElementorFields(draft, rep, resolveCtaHref(draft, rep));
                        navigator.clipboard.writeText(fields).then(() => {
                          toast({
                            title: "Elementor fields copied",
                            description:
                              "Paste each value into the native Slides widget on weprintwraps.com.",
                          });
                        });
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-cyan-500/20 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-500/30"
                      title="Copy per-slide values for Elementor's native Slides widget"
                    >
                      <Copy className="h-4 w-4" />
                      Copy Elementor fields
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const rep = repById(draft.affiliate_id);
                        const html = buildElementorBlock(draft, rep, resolveCtaHref(draft, rep));
                        navigator.clipboard.writeText(html).then(() => {
                          toast({
                            title: "HTML block copied",
                            description: rep
                              ? "Affiliate spotlight slide - paste into an Elementor HTML widget / Loop Carousel item."
                              : "Paste into a WordPress HTML widget on weprintwraps.com.",
                          });
                        });
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-fuchsia-500/20 px-3 py-2 text-sm text-fuchsia-300 hover:bg-fuchsia-500/30"
                      title="Copy ready-to-paste HTML block (use for affiliate spotlight slides - includes headshot overlay)"
                    >
                      <Copy className="h-4 w-4" />
                      Copy HTML (affiliate spotlight)
                    </button>

                    <div className="flex-1" />
                    <Button
                      disabled={!dirty || saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ id: slider.id, patch: drafts[slider.id] })}
                    >
                      {dirty ? "Save changes" : "Saved"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Publish to WePrintWraps.com</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-400">
            <p>
              These sliders are the source of truth for the Elementor hero on WePrintWraps.com.
              When the copy and images here are approved, paste them into the Elementor Slides
              widget on the homepage (or use the Elementor instructions in{" "}
              <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs">
                docs/wpw-homepage-sliders.md
              </code>
              ).
            </p>
            <p>
              The DesignPro $25 product referenced by Slot 1 is created separately on
              WePrintWraps via the{" "}
              <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs">
                wpw-create-designpro-product
              </code>{" "}
              edge function (currently dormant - runs only when invoked).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminWpwHomepageSliders;
