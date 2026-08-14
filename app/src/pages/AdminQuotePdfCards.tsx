/**
 * AdminQuotePdfCards — manage the 4 pricing-tier cards rendered at the
 * bottom of every Quote PDF.
 *
 * Each tier (Starter / DesignProLite / DesignProStudio / DesignProPlus)
 * gets one image + label + price + CTA URL. The PDF generator pulls
 * these on every render via fetchPricingTierCards().
 */

import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, ExternalLink } from "lucide-react";

const db = supabase as any;
const STORAGE_BUCKET = "public-assets";
const STORAGE_PREFIX = "pricing-tier-cards";

interface TierCard {
  id: string;
  tier_slug: string;
  label: string;
  price: string;
  cta_url: string;
  image_url: string | null;
  sort_order: number;
}

export default function AdminQuotePdfCards() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Partial<TierCard>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const { data: cards, isLoading } = useQuery<TierCard[]>({
    queryKey: ["admin-pricing-tier-pdf-cards"],
    queryFn: async () => {
      const { data, error } = await db
        .from("pricing_tier_pdf_cards")
        .select("id, tier_slug, label, price, cta_url, image_url, sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as TierCard[];
    },
  });

  // Hydrate per-row drafts whenever the underlying rows refresh so the
  // form always reflects the persisted values.
  useEffect(() => {
    if (!cards) return;
    const next: Record<string, Partial<TierCard>> = {};
    for (const c of cards) {
      next[c.id] = {
        label: c.label,
        price: c.price,
        cta_url: c.cta_url,
      };
    }
    setDrafts(next);
  }, [cards]);

  const updateDraft = (id: string, patch: Partial<TierCard>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  const handleUpload = async (card: TierCard, file: File) => {
    setUploadingId(card.id);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${STORAGE_PREFIX}/${card.tier_slug}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: dbErr } = await db
        .from("pricing_tier_pdf_cards")
        .update({ image_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", card.id);
      if (dbErr) throw dbErr;

      toast({
        title: "Image uploaded",
        description: `${card.label} card refreshed on every Quote PDF from now on.`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-pricing-tier-pdf-cards"] });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message ?? "Try a smaller image (JPG/PNG/WebP).",
        variant: "destructive",
      });
    } finally {
      setUploadingId(null);
    }
  };

  const handleSaveDraft = async (card: TierCard) => {
    const draft = drafts[card.id];
    if (!draft) return;
    setSavingId(card.id);
    try {
      const { error } = await db
        .from("pricing_tier_pdf_cards")
        .update({
          label: draft.label ?? card.label,
          price: draft.price ?? card.price,
          cta_url: draft.cta_url ?? card.cta_url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id);
      if (error) throw error;
      toast({ title: "Saved", description: `${card.label} updated.` });
      queryClient.invalidateQueries({ queryKey: ["admin-pricing-tier-pdf-cards"] });
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <Helmet>
        <title>Quote PDF Cards · Admin · DesignProAI</title>
      </Helmet>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Quote PDF Cards</h1>
          <p className="text-sm text-white/60 mt-1">
            Upload one image per tier. These show as the 4-card strip at
            the bottom of every Quote PDF and link to the CTA URL you set.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading cards…
          </div>
        ) : !cards || cards.length === 0 ? (
          <div className="text-white/60">
            No tier cards seeded. Re-run the migration.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.map((card) => {
              const draft = drafts[card.id] ?? {};
              const isSaving = savingId === card.id;
              const isUploading = uploadingId === card.id;
              return (
                <div
                  key={card.id}
                  className="rounded-2xl border border-[#48484a] bg-rp-surface p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#60A5FA]">
                        Tier #{card.sort_order}
                      </div>
                      <div className="text-base font-bold text-white mt-0.5">
                        {card.tier_slug}
                      </div>
                    </div>
                    {card.cta_url && (
                      <a
                        href={card.cta_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-[#60A5FA] inline-flex items-center gap-1 hover:underline"
                        title="Open CTA URL in a new tab"
                      >
                        Test link <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Image */}
                  <div className="rounded-lg border border-[#48484a] bg-black aspect-[16/9] overflow-hidden flex items-center justify-center">
                    {card.image_url ? (
                      <img
                        src={card.image_url}
                        alt={card.label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-xs text-white/40">No image yet</div>
                    )}
                  </div>

                  <label className="block">
                    <span className="sr-only">Upload {card.label} image</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUpload(card, f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isUploading}
                      onClick={(e) => {
                        const input = (e.currentTarget.parentElement as HTMLLabelElement)
                          .querySelector("input") as HTMLInputElement | null;
                        input?.click();
                      }}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          {card.image_url ? "Replace image" : "Upload image"}
                        </>
                      )}
                    </Button>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-white/60">
                        Label
                      </Label>
                      <Input
                        value={draft.label ?? card.label}
                        onChange={(e) => updateDraft(card.id, { label: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-white/60">
                        Price
                      </Label>
                      <Input
                        value={draft.price ?? card.price}
                        onChange={(e) => updateDraft(card.id, { price: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-white/60">
                      CTA URL
                    </Label>
                    <Input
                      value={draft.cta_url ?? card.cta_url}
                      onChange={(e) => updateDraft(card.id, { cta_url: e.target.value })}
                      placeholder="https://designproai.com/pricing?tier=…"
                    />
                  </div>

                  <Button
                    onClick={() => handleSaveDraft(card)}
                    disabled={isSaving}
                    className="w-full bg-gradient-rp-pop hover:brightness-110"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Save label / price / CTA"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
