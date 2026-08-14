import { useState } from "react";
import { StatCard } from "@/components/affiliate/StatCard";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { AffiliateStatusBadge } from "@/components/affiliate/AffiliateStatusBadge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  useAllAffiliates,
  useUpdateAffiliateStatus,
  useUpdateCommissionRate,
  useMarketingAssets,
  useUploadMarketingAsset,
  useDeleteMarketingAsset,
  useAdminStats,
  useAdminAffiliateReferrals,
  useAdminAdSubmissions,
  useUpdateAdSubmissionStatus,
} from "@/hooks/useAffiliateAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Users,
  DollarSign,
  TrendingUp,
  Award,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Eye,
  Upload,
  Megaphone,
  Download,
  Video,
  Image,
  Percent,
} from "lucide-react";
import type { AffiliatePartner } from "@/types/affiliate";

const AD_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Under Review" },
  approved: { bg: "bg-green-500/20", text: "text-green-400", label: "Approved" },
  promoted: { bg: "bg-primary/20", text: "text-primary", label: "Paid Partner Ad" },
  rejected: { bg: "bg-red-500/20", text: "text-red-400", label: "Not Selected" },
};

export default function AffiliateAdmin() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAffiliate, setSelectedAffiliate] = useState<AffiliatePartner | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);

  const { data: affiliates, isLoading: affLoading } = useAllAffiliates(statusFilter);
  const { data: stats } = useAdminStats();
  const updateStatus = useUpdateAffiliateStatus();
  const { data: assets } = useMarketingAssets();
  const uploadAsset = useUploadMarketingAsset();
  const deleteAsset = useDeleteMarketingAsset();
  const { data: adSubmissions, isLoading: adsLoading } = useAdminAdSubmissions();
  const updateAdStatus = useUpdateAdSubmissionStatus();

  // Asset upload form state
  const [assetForm, setAssetForm] = useState({
    title: "",
    description: "",
    asset_type: "static_image" as string,
    file_url: "",
    thumbnail_url: "",
    platform: "all" as string,
    caption_template: "",
    hashtags: "",
    is_featured: false,
  });

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      await updateStatus.mutateAsync({ id, status: newStatus });
      toast.success(`Affiliate ${newStatus}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update status");
    }
  };

  const handleUploadAsset = async () => {
    if (!assetForm.title || !assetForm.file_url) {
      toast.error("Title and file URL are required");
      return;
    }
    try {
      await uploadAsset.mutateAsync({
        title: assetForm.title,
        description: assetForm.description || null,
        asset_type: assetForm.asset_type as any,
        file_url: assetForm.file_url,
        thumbnail_url: assetForm.thumbnail_url || null,
        platform: assetForm.platform as any,
        caption_template: assetForm.caption_template || null,
        hashtags: assetForm.hashtags || null,
        is_featured: assetForm.is_featured,
        sort_order: (assets?.length || 0) + 1,
      });
      toast.success("Asset uploaded");
      setAssetDialogOpen(false);
      setAssetForm({
        title: "", description: "", asset_type: "static_image", file_url: "",
        thumbnail_url: "", platform: "all", caption_template: "", hashtags: "", is_featured: false,
      });
    } catch (error: any) {
      toast.error(error.message || "Failed to upload asset");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop();
    const path = `${assetForm.asset_type}s/${Date.now()}.${ext}`;

    const { data, error } = await supabase.storage
      .from("affiliate-assets")
      .upload(path, file);

    if (error) {
      toast.error("Upload failed: " + error.message);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("affiliate-assets")
      .getPublicUrl(path);

    setAssetForm((prev) => ({
      ...prev,
      file_url: urlData.publicUrl,
      thumbnail_url: file.type.startsWith("image/") ? urlData.publicUrl : prev.thumbnail_url,
    }));
    toast.success("File uploaded");
  };

  const handleAdStatusUpdate = async (id: string, status: string, notes?: string) => {
    try {
      await updateAdStatus.mutateAsync({ id, status, admin_notes: notes });
      toast.success(status === "promoted" ? "Marked as Paid Partner Ad!" : `Ad ${status}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    }
  };

  const handleTriggerPayouts = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("affiliate-process-payouts");
      if (error) throw error;
      toast.success(`Payouts processed: ${data?.processed || 0} affiliates`);
    } catch (error: any) {
      toast.error(error.message || "Failed to process payouts");
    }
  };

  return (
    <AffiliateLayout
      title="Affiliate Admin"
      subtitle="Manage affiliates, assets, partner ads, and payouts"
    >
      <main className="container mx-auto px-4 py-2">

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="Total Affiliates" value={stats?.total || 0} icon={Users} iconColor="text-primary" />
          <StatCard title="Active Affiliates" value={stats?.active || 0} icon={CheckCircle} iconColor="text-green-400" />
          <StatCard title="Total Commissions Paid" value={`$${(stats?.totalPaid || 0).toFixed(2)}`} icon={DollarSign} iconColor="text-green-400" />
          <StatCard title="Total Referrals" value={stats?.totalReferrals || 0} icon={TrendingUp} iconColor="text-cyan-400" />
        </div>

        <Tabs defaultValue="affiliates">
          <TabsList className="mb-6">
            <TabsTrigger value="affiliates">Affiliates</TabsTrigger>
            <TabsTrigger value="partner-ads">
              Partner Ads
              {adSubmissions && adSubmissions.filter((a: any) => a.status === "pending").length > 0 && (
                <Badge className="ml-2 bg-yellow-500/20 text-yellow-400 border-0 text-xs">
                  {adSubmissions.filter((a: any) => a.status === "pending").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="assets">Marketing Assets</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          {/* Affiliates Tab */}
          <TabsContent value="affiliates">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Affiliate Partners</CardTitle>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {affLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (affiliates || []).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No affiliates found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left py-3 px-2 font-medium">Name</th>
                          <th className="text-left py-3 px-2 font-medium">Email</th>
                          <th className="text-left py-3 px-2 font-medium">Code</th>
                          <th className="text-left py-3 px-2 font-medium">Status</th>
                          <th className="text-right py-3 px-2 font-medium">Commission</th>
                          <th className="text-right py-3 px-2 font-medium">Referrals</th>
                          <th className="text-right py-3 px-2 font-medium">Earned</th>
                          <th className="text-left py-3 px-2 font-medium">Stripe</th>
                          <th className="text-left py-3 px-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(affiliates || []).map((aff) => (
                          <tr key={aff.id} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-3 px-2 text-foreground font-medium">{aff.full_name}</td>
                            <td className="py-3 px-2 text-muted-foreground">{aff.email}</td>
                            <td className="py-3 px-2 font-mono text-xs">{aff.referral_code}</td>
                            <td className="py-3 px-2"><AffiliateStatusBadge status={aff.status} /></td>
                            <td className="py-3 px-2 text-right text-primary font-medium">
                              {(aff.commission_rate ?? 20)}%{aff.recurring_rate > 0 ? ` + ${aff.recurring_rate}%/mo` : ""}
                            </td>
                            <td className="py-3 px-2 text-right">{aff.total_referrals}</td>
                            <td className="py-3 px-2 text-right">${(aff.total_earned || 0).toFixed(2)}</td>
                            <td className="py-3 px-2">
                              {aff.stripe_onboarded ? (
                                <CheckCircle className="h-4 w-4 text-green-400" />
                              ) : (
                                <XCircle className="h-4 w-4 text-muted-foreground" />
                              )}
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex gap-1">
                                {aff.status === "pending" && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                      onClick={() => handleStatusUpdate(aff.id, "approved")}>
                                      <CheckCircle className="h-3 w-3" /> Approve
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive"
                                      onClick={() => handleStatusUpdate(aff.id, "suspended")}>
                                      <XCircle className="h-3 w-3" /> Reject
                                    </Button>
                                  </>
                                )}
                                {aff.status === "approved" && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                    onClick={() => handleStatusUpdate(aff.id, "active")}>
                                    <CheckCircle className="h-3 w-3" /> Activate
                                  </Button>
                                )}
                                {aff.status === "active" && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive"
                                    onClick={() => handleStatusUpdate(aff.id, "suspended")}>
                                    Suspend
                                  </Button>
                                )}
                                {aff.status === "suspended" && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                    onClick={() => handleStatusUpdate(aff.id, "active")}>
                                    Reactivate
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="h-7 text-xs"
                                  onClick={() => setSelectedAffiliate(aff)}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Partner Ads Tab */}
          <TabsContent value="partner-ads">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-purple-400" />
                  Affiliate-Submitted Ads
                </CardTitle>
                <CardDescription>
                  Review ads from affiliates. Download the ones you like, then run them as paid partner ads with their coupon code to grow their audience.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {adsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : !adSubmissions || adSubmissions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No ad submissions yet.</p>
                    <p className="text-sm mt-1">When affiliates submit ads, they'll appear here for review.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {adSubmissions.map((ad: any) => {
                      const statusStyle = AD_STATUS_STYLES[ad.status] || AD_STATUS_STYLES.pending;
                      return (
                        <div key={ad.id} className="p-4 rounded-xl border border-border bg-muted/20">
                          <div className="flex items-start gap-4">
                            {/* Preview */}
                            <div className="w-32 h-24 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                              {ad.ad_type === "reel" ? (
                                <video
                                  src={ad.file_url}
                                  className="w-full h-full object-cover"
                                  muted
                                  preload="metadata"
                                />
                              ) : (
                                <img
                                  src={ad.file_url}
                                  alt={ad.file_name}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-foreground font-medium">{ad.affiliate_name}</p>
                                <Badge className={`${statusStyle.bg} ${statusStyle.text} text-xs border-0`}>
                                  {statusStyle.label}
                                </Badge>
                                <Badge className="bg-muted text-muted-foreground text-xs border-0 capitalize">
                                  {ad.ad_type === "reel" ? (
                                    <><Video className="h-3 w-3 mr-1" />Reel</>
                                  ) : (
                                    <><Image className="h-3 w-3 mr-1" />Static</>
                                  )}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground truncate">{ad.file_name}</p>
                              {ad.caption && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">"{ad.caption}"</p>
                              )}
                              {ad.admin_notes && (
                                <p className="text-xs text-yellow-400 mt-1">Note: {ad.admin_notes}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                Submitted {format(new Date(ad.created_at), "MMM d, yyyy 'at' h:mm a")}
                              </p>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-2 flex-shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-xs"
                                asChild
                              >
                                <a href={ad.file_url} target="_blank" rel="noopener noreferrer" download>
                                  <Download className="h-3 w-3" /> Download
                                </a>
                              </Button>
                              {ad.status === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    className="gap-1 text-xs bg-purple-600 hover:bg-purple-700"
                                    onClick={() => handleAdStatusUpdate(ad.id, "promoted")}
                                  >
                                    <Megaphone className="h-3 w-3" /> Run as Partner Ad
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 text-xs"
                                    onClick={() => handleAdStatusUpdate(ad.id, "approved")}
                                  >
                                    <CheckCircle className="h-3 w-3" /> Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="gap-1 text-xs text-destructive"
                                    onClick={() => handleAdStatusUpdate(ad.id, "rejected", "Does not meet requirements")}
                                  >
                                    <XCircle className="h-3 w-3" /> Reject
                                  </Button>
                                </>
                              )}
                              {ad.status === "approved" && (
                                <Button
                                  size="sm"
                                  className="gap-1 text-xs bg-purple-600 hover:bg-purple-700"
                                  onClick={() => handleAdStatusUpdate(ad.id, "promoted")}
                                >
                                  <Megaphone className="h-3 w-3" /> Run as Partner Ad
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Marketing Assets Tab */}
          <TabsContent value="assets">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Marketing Assets</CardTitle>
                <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2">
                      <Plus className="h-4 w-4" /> Add Asset
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg bg-card border-border">
                    <DialogHeader>
                      <DialogTitle>Upload Marketing Asset</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Title *</Label>
                        <Input value={assetForm.title} onChange={(e) => setAssetForm((p) => ({ ...p, title: e.target.value }))} className="mt-1" />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Textarea value={assetForm.description} onChange={(e) => setAssetForm((p) => ({ ...p, description: e.target.value }))} className="mt-1" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Asset Type</Label>
                          <Select value={assetForm.asset_type} onValueChange={(v) => setAssetForm((p) => ({ ...p, asset_type: v }))}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="video_reel">Video Reel</SelectItem>
                              <SelectItem value="static_image">Static Image</SelectItem>
                              <SelectItem value="story">Story</SelectItem>
                              <SelectItem value="carousel">Carousel</SelectItem>
                              <SelectItem value="email_copy">Email Copy</SelectItem>
                              <SelectItem value="social_caption">Social Caption</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Platform</Label>
                          <Select value={assetForm.platform} onValueChange={(v) => setAssetForm((p) => ({ ...p, platform: v }))}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Platforms</SelectItem>
                              <SelectItem value="instagram">Instagram</SelectItem>
                              <SelectItem value="facebook">Facebook</SelectItem>
                              <SelectItem value="tiktok">TikTok</SelectItem>
                              <SelectItem value="linkedin">LinkedIn</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Upload File</Label>
                        <Input type="file" onChange={handleFileUpload} className="mt-1" accept="image/*,video/*" />
                        {assetForm.file_url && (
                          <p className="text-xs text-green-400 mt-1 truncate">Uploaded: {assetForm.file_url}</p>
                        )}
                      </div>
                      <div>
                        <Label>Or paste File URL directly</Label>
                        <Input value={assetForm.file_url} onChange={(e) => setAssetForm((p) => ({ ...p, file_url: e.target.value }))} className="mt-1" placeholder="https://..." />
                      </div>
                      <div>
                        <Label>Caption Template</Label>
                        <Textarea
                          value={assetForm.caption_template}
                          onChange={(e) => setAssetForm((p) => ({ ...p, caption_template: e.target.value }))}
                          className="mt-1"
                          placeholder="Use {{referral_code}} to insert the affiliate's code"
                          rows={3}
                        />
                      </div>
                      <div>
                        <Label>Hashtags</Label>
                        <Input value={assetForm.hashtags} onChange={(e) => setAssetForm((p) => ({ ...p, hashtags: e.target.value }))} className="mt-1" placeholder="#restyleproai #vehiclewraps" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="is_featured"
                          checked={assetForm.is_featured}
                          onChange={(e) => setAssetForm((p) => ({ ...p, is_featured: e.target.checked }))}
                          className="rounded"
                        />
                        <Label htmlFor="is_featured">Featured (shown in onboarding)</Label>
                      </div>
                      <Button onClick={handleUploadAsset} className="w-full gap-2" disabled={uploadAsset.isPending}>
                        {uploadAsset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Upload Asset
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {(assets || []).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No marketing assets yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(assets || []).map((asset) => (
                      <div key={asset.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30">
                        <div className="w-16 h-12 rounded bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                          {asset.thumbnail_url ? (
                            <img src={asset.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs text-muted-foreground">{asset.asset_type.slice(0, 3)}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground font-medium truncate">{asset.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {asset.asset_type.replace("_", " ")} · {asset.platform}
                            {asset.is_featured && " · Featured"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive h-8"
                          onClick={() => {
                            if (confirm("Delete this asset?")) {
                              deleteAsset.mutate(asset.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Leaderboard Tab */}
          <TabsContent value="leaderboard">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-yellow-400" />
                  Top 10 Affiliates
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats?.topPerformers && stats.topPerformers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left py-3 px-2 font-medium w-10">#</th>
                          <th className="text-left py-3 px-2 font-medium">Affiliate</th>
                          <th className="text-left py-3 px-2 font-medium">Code</th>
                          <th className="text-right py-3 px-2 font-medium">Commission</th>
                          <th className="text-right py-3 px-2 font-medium">Referrals</th>
                          <th className="text-right py-3 px-2 font-medium">Total Earned</th>
                          <th className="text-right py-3 px-2 font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.topPerformers.map((aff: any, i: number) => (
                          <tr key={aff.id} className="border-b border-border/50">
                            <td className="py-3 px-2 text-muted-foreground font-bold">{i + 1}</td>
                            <td className="py-3 px-2 text-foreground font-medium">
                              {aff.full_name || "-"}
                            </td>
                            <td className="py-3 px-2 font-mono text-xs text-muted-foreground">
                              {aff.referral_code || "-"}
                            </td>
                            <td className="py-3 px-2 text-right text-primary">
                              {(aff.commission_rate ?? 20)}%{aff.recurring_rate > 0 ? ` + ${aff.recurring_rate}%/mo` : ""}
                            </td>
                            <td className="py-3 px-2 text-right">{aff.total_referrals}</td>
                            <td className="py-3 px-2 text-right font-medium text-green-400">
                              ${(aff.total_earned || 0).toFixed(2)}
                            </td>
                            <td className="py-3 px-2 text-right text-muted-foreground">
                              ${(aff.pending_balance || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No affiliate data yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payouts Tab */}
          <TabsContent value="payouts">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Payouts</CardTitle>
                  <CardDescription>Process payouts for all eligible affiliates</CardDescription>
                </div>
                <Button onClick={handleTriggerPayouts} className="gap-2">
                  <DollarSign className="h-4 w-4" />
                  Trigger Payouts
                </Button>
              </CardHeader>
              <CardContent>
                <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground mb-4">
                  <p>Payouts will be sent to all affiliates with a pending balance of $10+ and a connected Stripe account.</p>
                  <p className="mt-1">Payouts are normally scheduled for the 1st and 15th of each month.</p>
                </div>
                <div className="text-center py-8 text-muted-foreground">
                  <p>Payout history will be shown here after payouts are processed.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Affiliate Detail Dialog */}
        {selectedAffiliate && (
          <AffiliateDetailDialog
            affiliate={selectedAffiliate}
            open={!!selectedAffiliate}
            onClose={() => setSelectedAffiliate(null)}
          />
        )}
      </main>
    </AffiliateLayout>
  );
}

// Sub-component for affiliate detail view with commission rate editing
function AffiliateDetailDialog({
  affiliate,
  open,
  onClose,
}: {
  affiliate: AffiliatePartner;
  open: boolean;
  onClose: () => void;
}) {
  const { data: referrals } = useAdminAffiliateReferrals(affiliate.id);
  const updateRate = useUpdateCommissionRate();
  const [editingRate, setEditingRate] = useState(false);
  const [rateValue, setRateValue] = useState(
    String(affiliate.commission_rate ?? 20)
  );

  const handleSaveRate = async () => {
    const numVal = parseFloat(rateValue);
    if (isNaN(numVal) || numVal < 0 || numVal > 100) {
      toast.error("Enter a valid percentage (0-100)");
      return;
    }
    try {
      await updateRate.mutateAsync({ id: affiliate.id, commission_rate: numVal });
      toast.success(`Commission rate updated to ${numVal}%`);
      setEditingRate(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to update rate");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle>{affiliate.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Email:</span>
              <span className="ml-2 text-foreground">{affiliate.email}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Company:</span>
              <span className="ml-2 text-foreground">{affiliate.company_name || "-"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Code:</span>
              <span className="ml-2 text-foreground font-mono">{affiliate.referral_code}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>
              <span className="ml-2"><AffiliateStatusBadge status={affiliate.status} /></span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Earned:</span>
              <span className="ml-2 text-green-400 font-medium">${(affiliate.total_earned || 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Pending Balance:</span>
              <span className="ml-2 text-foreground">${(affiliate.pending_balance || 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Paid:</span>
              <span className="ml-2 text-foreground">${(affiliate.total_paid || 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Stripe:</span>
              <span className="ml-2">{affiliate.stripe_onboarded ? "Connected" : "Not connected"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Joined:</span>
              <span className="ml-2 text-foreground">{format(new Date(affiliate.created_at), "MMM d, yyyy")}</span>
            </div>
            {affiliate.instagram_handle && (
              <div>
                <span className="text-muted-foreground">Instagram:</span>
                <span className="ml-2 text-foreground">{affiliate.instagram_handle}</span>
              </div>
            )}
          </div>

          {/* Commission Rate Editor */}
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Commission Rate</span>
              </div>
              {editingRate ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={rateValue}
                    onChange={(e) => setRateValue(e.target.value)}
                    className="w-20 h-8 text-sm text-center"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <Button size="sm" className="h-8 text-xs" onClick={handleSaveRate} disabled={updateRate.isPending}>
                    {updateRate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingRate(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-primary">
                    {(affiliate.commission_rate ?? 20)}%
                    {affiliate.recurring_rate > 0 ? ` + ${affiliate.recurring_rate}%/mo` : ""}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingRate(true)}>
                    Change
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-foreground mb-2">Referrals ({referrals?.length || 0})</h4>
            {referrals && referrals.length > 0 ? (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-1">Email</th>
                      <th className="text-left py-2 px-1">Status</th>
                      <th className="text-right py-2 px-1">Commission</th>
                      <th className="text-right py-2 px-1">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((ref: any) => (
                      <tr key={ref.id} className="border-b border-border/50">
                        <td className="py-2 px-1">{ref.referred_email || "-"}</td>
                        <td className="py-2 px-1"><AffiliateStatusBadge status={ref.status} /></td>
                        <td className="py-2 px-1 text-right">
                          {ref.commission_amount ? `$${ref.commission_amount.toFixed(2)}` : "-"}
                        </td>
                        <td className="py-2 px-1 text-right text-muted-foreground">
                          {format(new Date(ref.created_at), "MMM d")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No referrals yet.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
