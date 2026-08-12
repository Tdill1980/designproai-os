import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateAffiliatePartner } from "@/hooks/useAffiliatePartners";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliatePartner } from "@/types/affiliate";
import { toast } from "sonner";
import {
  CreditCard,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Save,
  Copy,
  RefreshCw,
  Upload,
  ImageIcon,
} from "lucide-react";

const BUCKET = "affiliate-assets";

async function uploadToBucket(partnerId: string, field: string, file: File) {
  const ext = file.name.split(".").pop();
  const path = `affiliate-marketing/${partnerId}/${field}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function AffiliatePartnerAdminControls({ partner }: { partner: AffiliatePartner }) {
  const updatePartner = useUpdateAffiliatePartner();

  // ── Stripe state
  const [stripeLoading, setStripeLoading] = useState(false);
  const [onboardingLink, setOnboardingLink] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState(partner.stripe_onboarded);
  const [hasAccount, setHasAccount] = useState(!!partner.stripe_account_id);

  // ── Marketing state
  const [headshotUrl, setHeadshotUrl] = useState((partner as any).headshot_url || "");
  const [spotlightImageUrl, setSpotlightImageUrl] = useState((partner as any).spotlight_image_url || "");
  const [spotlightVideoUrl, setSpotlightVideoUrl] = useState((partner as any).spotlight_video_url || "");
  const [spotlightQuote, setSpotlightQuote] = useState((partner as any).spotlight_quote || "");
  const [uploading, setUploading] = useState<string | null>(null);
  const [savingMarketing, setSavingMarketing] = useState(false);

  // ── Coupon state
  const [couponId, setCouponId] = useState((partner as any).coupon_id || "");
  const [couponPercentOff, setCouponPercentOff] = useState<string>(
    (partner as any).coupon_percent_off != null ? String((partner as any).coupon_percent_off) : ""
  );
  const [savingCoupon, setSavingCoupon] = useState(false);

  const invokeStripe = async (action: string) => {
    const { data, error } = await supabase.functions.invoke("affiliate-stripe-connect", {
      body: {
        action,
        affiliate_id: partner.id,
        return_url: window.location.origin + "/affiliate/settings",
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleGenerateLink = async () => {
    setStripeLoading(true);
    try {
      const data = await invokeStripe("create_account");
      if (data?.url) {
        setOnboardingLink(data.url);
        setHasAccount(true);
        try {
          await navigator.clipboard.writeText(data.url);
          toast.success("Onboarding link generated and copied to clipboard");
        } catch {
          toast.success("Onboarding link generated");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate Stripe link");
    } finally {
      setStripeLoading(false);
    }
  };

  const handleOpenDashboard = async () => {
    setStripeLoading(true);
    try {
      const data = await invokeStripe("create_login_link");
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open Stripe dashboard");
    } finally {
      setStripeLoading(false);
    }
  };

  const handleRefreshStatus = async () => {
    setStripeLoading(true);
    try {
      const data = await invokeStripe("check_status");
      setHasAccount(!!data?.has_account);
      setStripeOnboarded(!!data?.onboarded);
      toast.success(
        data?.onboarded
          ? "Connected — payouts enabled"
          : data?.has_account
          ? "Account started, onboarding not finished"
          : "No Stripe account connected yet"
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to check Stripe status");
    } finally {
      setStripeLoading(false);
    }
  };

  const handleUpload = async (
    field: "headshot" | "spotlight_image" | "spotlight_video",
    file: File | undefined,
    setter: (v: string) => void
  ) => {
    if (!file) return;
    setUploading(field);
    try {
      const url = await uploadToBucket(partner.id, field, file);
      setter(url);
      toast.success("Uploaded — remember to Save");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const handleSaveCoupon = async () => {
    setSavingCoupon(true);
    try {
      const pct = couponPercentOff === "" ? null : parseInt(couponPercentOff, 10);
      if (pct != null && (isNaN(pct) || pct < 0 || pct > 100)) {
        toast.error("Discount must be between 0 and 100");
        return;
      }
      await updatePartner.mutateAsync({
        id: partner.id,
        updates: {
          coupon_id: couponId || null,
          coupon_percent_off: pct,
        } as any,
      });
      toast.success("Coupon saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save coupon");
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleSaveMarketing = async () => {
    setSavingMarketing(true);
    try {
      await updatePartner.mutateAsync({
        id: partner.id,
        updates: {
          headshot_url: headshotUrl || null,
          spotlight_image_url: spotlightImageUrl || null,
          spotlight_video_url: spotlightVideoUrl || null,
          spotlight_quote: spotlightQuote || null,
        } as any,
      });
      toast.success("Marketing set saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save marketing set");
    } finally {
      setSavingMarketing(false);
    }
  };

  return (
    <>
      {/* ── Stripe Payouts ────────────────────────────── */}
      <div className="pt-4 border-t">
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Stripe Payouts
        </h4>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted mb-3">
          {stripeOnboarded ? (
            <>
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Connected</p>
                <p className="text-xs text-muted-foreground">Payouts are enabled for this rep.</p>
              </div>
            </>
          ) : hasAccount ? (
            <>
              <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Onboarding incomplete</p>
                <p className="text-xs text-muted-foreground">Account started but bank details aren't finished.</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">Generate a link for this rep to enter their bank details.</p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleGenerateLink} disabled={stripeLoading} className="gap-2">
            {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {hasAccount ? "Regenerate Onboarding Link" : "Generate Onboarding Link"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleRefreshStatus} disabled={stripeLoading} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh Status
          </Button>
          {hasAccount && (
            <Button size="sm" variant="outline" onClick={handleOpenDashboard} disabled={stripeLoading} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Open Stripe Dashboard
            </Button>
          )}
        </div>

        {onboardingLink && (
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Onboarding link (send to rep)</Label>
            <div className="flex gap-2 mt-1">
              <Input readOnly value={onboardingLink} className="text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(onboardingLink);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              This link expires after a short time. Regenerate if it stops working.
            </p>
          </div>
        )}
      </div>

      {/* ── Marketing Set ─────────────────────────────── */}
      <div className="pt-4 border-t">
        <h4 className="font-medium mb-1">Marketing Set</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Headshot, spotlight media, and quote used in this rep's marketing kit.
        </p>

        <div className="space-y-4">
          <MediaField
            label="Headshot Image"
            url={headshotUrl}
            accept="image/*"
            uploading={uploading === "headshot"}
            onUpload={(f) => handleUpload("headshot", f, setHeadshotUrl)}
            onUrlChange={setHeadshotUrl}
            isVideo={false}
          />
          <MediaField
            label="Spotlight Image"
            url={spotlightImageUrl}
            accept="image/*"
            uploading={uploading === "spotlight_image"}
            onUpload={(f) => handleUpload("spotlight_image", f, setSpotlightImageUrl)}
            onUrlChange={setSpotlightImageUrl}
            isVideo={false}
          />
          <MediaField
            label="Spotlight Video"
            url={spotlightVideoUrl}
            accept="video/*"
            uploading={uploading === "spotlight_video"}
            onUpload={(f) => handleUpload("spotlight_video", f, setSpotlightVideoUrl)}
            onUrlChange={setSpotlightVideoUrl}
            isVideo
          />
          <div>
            <Label className="text-sm">Spotlight Quote</Label>
            <Textarea
              value={spotlightQuote}
              onChange={(e) => setSpotlightQuote(e.target.value)}
              placeholder="A short testimonial or tagline from this rep…"
              className="mt-1"
              rows={3}
            />
          </div>

          <Button onClick={handleSaveMarketing} disabled={savingMarketing} className="gap-2">
            {savingMarketing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Marketing Set
          </Button>
        </div>
      </div>

      {/* ── Coupon / Discount ─────────────────────────── */}
      <div className="pt-4 border-t">
        <h4 className="font-medium mb-1">Coupon / Discount</h4>
        <p className="text-xs text-muted-foreground mb-3">
          The discount code this rep shares with their audience.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Coupon Code</Label>
            <Input
              value={couponId}
              onChange={(e) => setCouponId(e.target.value)}
              placeholder="e.g. JESS20"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Discount %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={couponPercentOff}
              onChange={(e) => setCouponPercentOff(e.target.value)}
              placeholder="e.g. 20"
              className="mt-1"
            />
          </div>
        </div>
        <Button onClick={handleSaveCoupon} disabled={savingCoupon} className="gap-2 mt-3">
          {savingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Coupon
        </Button>
      </div>

      {/* ── Marketing Kit (per-rep assets) ────────────── */}
      <RepKitManager partner={partner} />
    </>
  );
}

function RepKitManager({ partner }: { partner: AffiliatePartner }) {
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { title: string; thumbnail_url: string; file_url: string }>>({});

  const { data: assets, isLoading } = useQuery({
    queryKey: ["rep-kit-assets", partner.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("affiliate_marketing_assets")
        .select("id, title, asset_type, kit_slot, platform, file_url, thumbnail_url, sort_order")
        .eq("affiliate_id", partner.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const baseFor = (a: any) => ({
    title: a?.title || "",
    thumbnail_url: a?.thumbnail_url || "",
    file_url: a?.file_url || "",
  });

  const draftFor = (a: any) => drafts[a.id] ?? baseFor(a);

  const setDraft = (id: string, patch: Partial<{ title: string; thumbnail_url: string; file_url: string }>) =>
    setDrafts((d) => {
      const current = d[id] ?? baseFor(assets?.find((x) => x.id === id));
      return { ...d, [id]: { ...current, ...patch } };
    });

  const handleReplaceThumb = async (asset: any, file: File | undefined) => {
    if (!file) return;
    setUploadingId(asset.id);
    try {
      const url = await uploadToBucket(partner.id, `kit-${asset.kit_slot || asset.id}`, file);
      setDraft(asset.id, { thumbnail_url: url });
      toast.success("Uploaded — remember to Save");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  const handleSaveAsset = async (asset: any) => {
    const d = draftFor(asset);
    setSavingId(asset.id);
    try {
      const { error } = await supabase
        .from("affiliate_marketing_assets")
        .update({
          title: d.title || null,
          thumbnail_url: d.thumbnail_url || null,
          file_url: d.file_url || null,
        })
        .eq("id", asset.id);
      if (error) throw error;
      toast.success("Asset saved");
      queryClient.invalidateQueries({ queryKey: ["rep-kit-assets", partner.id] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save asset");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="pt-4 border-t">
      <h4 className="font-medium mb-1 flex items-center gap-2">
        <ImageIcon className="h-4 w-4" />
        Marketing Kit
      </h4>
      <p className="text-xs text-muted-foreground mb-3">
        The downloadable assets in this rep's kit. Replace a thumbnail or update the file/title per slot.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading kit…
        </div>
      ) : !assets || assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No kit assets found for this rep.</p>
      ) : (
        <div className="space-y-4">
          {assets.map((asset: any) => {
            const d = draftFor(asset);
            return (
              <div key={asset.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {asset.kit_slot || asset.asset_type}
                    {asset.platform ? ` · ${asset.platform}` : ""}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleSaveAsset(asset)}
                    disabled={savingId === asset.id}
                    className="gap-1 h-7"
                  >
                    {savingId === asset.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                </div>

                <div className="flex gap-3">
                  {d.thumbnail_url ? (
                    <img
                      src={d.thumbnail_url}
                      alt={d.title}
                      className="h-20 w-20 rounded border object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded border flex items-center justify-center text-muted-foreground flex-shrink-0">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}

                  <div className="flex-1 space-y-2">
                    <Input
                      value={d.title}
                      onChange={(e) => setDraft(asset.id, { title: e.target.value })}
                      placeholder="Title"
                      className="text-xs h-8"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={d.thumbnail_url}
                        onChange={(e) => setDraft(asset.id, { thumbnail_url: e.target.value })}
                        placeholder="Thumbnail URL"
                        className="text-xs h-8"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploadingId === asset.id}
                        className="gap-1 relative overflow-hidden h-8"
                      >
                        {uploadingId === asset.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingId === asset.id}
                          onChange={(e) => handleReplaceThumb(asset, e.target.files?.[0])}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </Button>
                    </div>
                    <Input
                      value={d.file_url}
                      onChange={(e) => setDraft(asset.id, { file_url: e.target.value })}
                      placeholder="Downloadable file URL"
                      className="text-xs h-8"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MediaField({
  label,
  url,
  accept,
  uploading,
  onUpload,
  onUrlChange,
  isVideo,
}: {
  label: string;
  url: string;
  accept: string;
  uploading: boolean;
  onUpload: (file: File | undefined) => void;
  onUrlChange: (v: string) => void;
  isVideo: boolean;
}) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      {url && (
        <div className="mt-1 mb-2">
          {isVideo ? (
            <video src={url} controls className="h-24 rounded border" />
          ) : (
            <img src={url} alt={label} className="h-24 rounded border object-cover" />
          )}
        </div>
      )}
      <div className="flex gap-2 mt-1">
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="Paste URL or upload…"
          className="text-xs"
        />
        <Button size="sm" variant="outline" disabled={uploading} className="gap-1 relative overflow-hidden">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload
          <input
            type="file"
            accept={accept}
            disabled={uploading}
            onChange={(e) => onUpload(e.target.files?.[0])}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </Button>
      </div>
    </div>
  );
}
