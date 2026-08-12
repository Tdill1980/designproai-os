import { useState } from "react";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { CopyButton } from "@/components/affiliate/CopyButton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAffiliateProfile } from "@/hooks/useAffiliateData";
import { useMarketingAssets } from "@/hooks/useAffiliateAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Image,
  Video,
  FileText,
  Download,
  Loader2,
  ExternalLink,
  Check,
  CreditCard,
} from "lucide-react";
import type { AffiliateMarketingAsset } from "@/types/affiliate";
import { KitSlotThumbnail } from "@/components/affiliate/KitSlotTemplate";

const ASSET_TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'video_reel', label: 'Video Reels' },
  { value: 'static_image', label: 'Static Images' },
  { value: 'story', label: 'Stories' },
  { value: 'email_copy', label: 'Email Copy' },
  { value: 'social_caption', label: 'Social Captions' },
];

const typeIcons: Record<string, typeof Image> = {
  video_reel: Video,
  static_image: Image,
  story: Image,
  carousel: Image,
  email_copy: FileText,
  social_caption: FileText,
};

// Production-flow accent badges: saturated text on a light tint with a
// matching border (mirrors the ProductionFlow status-badge treatment).
// Palette stays in the black/blue/cyan + magenta accent family.
const platformColors: Record<string, string> = {
  instagram: 'bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-200',
  facebook: 'bg-blue-50 text-blue-600 border border-blue-200',
  tiktok: 'bg-violet-50 text-violet-600 border border-violet-200',
  linkedin: 'bg-sky-50 text-sky-600 border border-sky-200',
  email: 'bg-indigo-50 text-indigo-600 border border-indigo-200',
  all: 'bg-cyan-50 text-cyan-600 border border-cyan-200',
};

export default function AffiliateMarketing() {
  const [filter, setFilter] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState<AffiliateMarketingAsset | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const { data: profile } = useAffiliateProfile();
  const { data: assets, isLoading } = useMarketingAssets();

  // supabase.functions.invoke throws a FunctionsHttpError on non-2xx and
  // hides the JSON body behind a generic message. The edge function returns
  // actionable Stripe errors (e.g. "Connect platform profile not enabled"),
  // so pull the real message off the response body before falling back.
  const stripeErrorMessage = async (error: any, fallback: string) => {
    try {
      const body = await error?.context?.json?.();
      if (body?.error) return body.error as string;
    } catch {
      /* body not JSON — fall through */
    }
    return error?.message || fallback;
  };

  const handleStripeConnect = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('affiliate-stripe-connect', {
        body: {
          action: 'create_account',
          return_url: window.location.origin + '/affiliate/marketing',
        },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (error: any) {
      toast.error(await stripeErrorMessage(error, "Failed to connect Stripe"));
    } finally {
      setStripeLoading(false);
    }
  };

  const handleStripeDashboard = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('affiliate-stripe-connect', {
        body: { action: 'create_login_link' },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, '_blank');
    } catch (error: any) {
      toast.error(await stripeErrorMessage(error, "Failed to open Stripe dashboard"));
    } finally {
      setStripeLoading(false);
    }
  };

  const filtered = filter === 'all'
    ? assets || []
    : (assets || []).filter(a => a.asset_type === filter);

  const getPersonalizedCaption = (template: string | null) => {
    if (!template || !profile) return template || '';
    return template.replace(/\{\{referral_code\}\}/g, profile.referral_code);
  };

  const handleMarkShared = async (assetId: string, platform: string) => {
    if (!profile) return;
    try {
      await supabase
        .from('affiliate_asset_shares')
        .insert({
          affiliate_id: profile.id,
          asset_id: assetId,
          platform_shared_to: platform,
        });
      toast.success("Marked as shared!");
    } catch {
      // Non-critical, just log
    }
  };

  if (isLoading) {
    return (
      <AffiliateLayout title="Marketing Assets">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#38BDF8]" />
        </div>
      </AffiliateLayout>
    );
  }

  return (
    <AffiliateLayout title="Marketing Assets" subtitle="Download and share ready-made content with your audience">
      {/* Stripe Connect — surfaced in the kit so reps can enable payouts
          without leaving the marketing page. */}
      {profile && (
        <div className="mb-6 rounded-xl bg-white border border-gray-200 shadow-sm p-4 flex items-center gap-4 flex-wrap">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              profile.stripe_onboarded ? "bg-emerald-50" : "bg-[#38BDF8]/10"
            )}
          >
            {profile.stripe_onboarded ? (
              <Check className="h-5 w-5 text-emerald-600" />
            ) : (
              <CreditCard className="h-5 w-5 text-[#0284C7]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900">
              {profile.stripe_onboarded ? "Payouts enabled" : "Connect Stripe to get paid"}
            </p>
            <p className="text-sm text-gray-600">
              {profile.stripe_onboarded
                ? "Your bank account is set up to receive commission payouts."
                : "Link your bank account so your commissions can be paid out."}
            </p>
          </div>
          {profile.stripe_onboarded ? (
            <Button
              variant="outline"
              className="gap-2 border-gray-200 text-gray-700 hover:bg-gray-50"
              onClick={handleStripeDashboard}
              disabled={stripeLoading}
            >
              {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Stripe Dashboard
            </Button>
          ) : (
            <Button
              className="gap-2 bg-[#0A0A0F] text-[#38BDF8] hover:bg-[#1a1a24]"
              onClick={handleStripeConnect}
              disabled={stripeLoading}
            >
              {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Connect Stripe
            </Button>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {ASSET_TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors border whitespace-nowrap",
              filter === f.value
                ? "bg-[#0A0A0F] text-[#38BDF8] border-transparent shadow-sm"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Assets Grid */}
      {filtered.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset) => {
            const Icon = typeIcons[asset.asset_type] || Image;
            return (
              <Card
                key={asset.id}
                className="bg-white border-gray-200 shadow-sm hover:border-[#38BDF8]/50 transition-colors cursor-pointer"
                onClick={() => setSelectedAsset(asset)}
              >
                <CardContent className="p-0">
                  {/* Thumbnail */}
                  <div className="aspect-video bg-gray-100 rounded-t-lg overflow-hidden relative">
                    {asset.thumbnail_url ? (
                      <img
                        src={asset.thumbnail_url}
                        alt={asset.title}
                        className="w-full h-full object-cover"
                      />
                    ) : profile && (asset as any).kit_slot ? (
                      <KitSlotThumbnail
                        slot={(asset as any).kit_slot}
                        rep={{
                          full_name: profile.full_name,
                          referral_code: profile.referral_code,
                          headshot_url: (profile as any).headshot_url || null,
                          accent_color: null,
                        }}
                        targetWidth={400}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon className="h-10 w-10 text-gray-300" />
                      </div>
                    )}
                    {/* Type badge */}
                    <Badge className="absolute top-2 left-2 bg-white/90 text-gray-700 border border-gray-200 text-[10px] font-semibold uppercase tracking-wider">
                      {asset.asset_type.replace('_', ' ')}
                    </Badge>
                    {asset.platform && (
                      <Badge className={cn("absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wider", platformColors[asset.platform] || '')}>
                        {asset.platform}
                      </Badge>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    <h3 className="text-gray-900 font-medium truncate">{asset.title}</h3>
                    {asset.description && (
                      <p className="text-gray-500 text-sm mt-1 line-clamp-2">{asset.description}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-500">
          <Image className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg text-gray-700">No assets found</p>
          <p className="text-sm">
            {filter !== 'all' ? 'Try a different filter.' : 'Marketing assets will be uploaded soon.'}
          </p>
        </div>
      )}

      {/* Asset Detail Dialog */}
      <Dialog open={!!selectedAsset} onOpenChange={() => setSelectedAsset(null)}>
        <DialogContent className="max-w-2xl bg-white border-gray-200 text-gray-900">
          {selectedAsset && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedAsset.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Preview */}
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                  {selectedAsset.asset_type === 'video_reel' && selectedAsset.file_url ? (
                    <video
                      src={selectedAsset.file_url}
                      controls
                      className="w-full h-full object-contain"
                    />
                  ) : selectedAsset.thumbnail_url || selectedAsset.file_url ? (
                    <img
                      src={selectedAsset.thumbnail_url || selectedAsset.file_url}
                      alt={selectedAsset.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image className="h-16 w-16 text-gray-300" />
                    </div>
                  )}
                </div>

                {selectedAsset.description && (
                  <p className="text-gray-600 text-sm">{selectedAsset.description}</p>
                )}

                {/* Caption */}
                {selectedAsset.caption_template && (
                  <div>
                    <label className="text-sm text-gray-500 mb-1 block">Caption (your code auto-inserted)</label>
                    <div className="bg-gray-100 rounded-lg p-3 text-sm text-gray-900 relative">
                      <p className="whitespace-pre-wrap pr-8">
                        {getPersonalizedCaption(selectedAsset.caption_template)}
                      </p>
                      <CopyButton
                        text={getPersonalizedCaption(selectedAsset.caption_template)}
                        label="Copy"
                        className="absolute top-2 right-2"
                        size="sm"
                      />
                    </div>
                  </div>
                )}

                {/* Hashtags */}
                {selectedAsset.hashtags && (
                  <div>
                    <label className="text-sm text-gray-500 mb-1 block">Hashtags</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-xs text-gray-900">
                        {selectedAsset.hashtags}
                      </code>
                      <CopyButton text={selectedAsset.hashtags} />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button asChild className="gap-2">
                    <a href={selectedAsset.file_url} target="_blank" rel="noopener noreferrer" download>
                      <Download className="h-4 w-4" /> Download
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      handleMarkShared(selectedAsset.id, 'general');
                    }}
                  >
                    <Check className="h-4 w-4" /> Mark as Shared
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AffiliateLayout>
  );
}
