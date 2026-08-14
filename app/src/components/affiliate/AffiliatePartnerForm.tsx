import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateAffiliatePartner, useUpdateAffiliatePartner } from "@/hooks/useAffiliatePartners";
import { toast } from "sonner";
import type { AffiliatePartner } from "@/types/affiliate";

interface AffiliatePartnerFormProps {
  partner?: AffiliatePartner;
  onSuccess?: () => void;
}

export function AffiliatePartnerForm({ partner, onSuccess }: AffiliatePartnerFormProps) {
  const isEditing = !!partner;
  const createPartner = useCreateAffiliatePartner();
  const updatePartner = useUpdateAffiliatePartner();

  const [form, setForm] = useState({
    email: partner?.email || "",
    full_name: partner?.full_name || "",
    business_name: partner?.business_name || "",
    phone: partner?.phone || "",
    bio: partner?.bio || "",
    instagram_url: partner?.instagram_url || "",
    tiktok_url: partner?.tiktok_url || "",
    youtube_url: partner?.youtube_url || "",
    website_url: partner?.website_url || "",
    commission_rate: String(partner?.commission_rate || 10),
    status: partner?.status || "pending",
    payout_method: partner?.payout_method || "paypal",
    payout_email: partner?.payout_email || "",
    coupon_id: partner?.coupon_id || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.email || !form.full_name) {
      toast.error("Email and full name are required");
      return;
    }

    try {
      if (isEditing && partner) {
        await updatePartner.mutateAsync({
          id: partner.id,
          updates: {
            full_name: form.full_name,
            business_name: form.business_name || undefined,
            phone: form.phone || undefined,
            bio: form.bio || undefined,
            instagram_url: form.instagram_url || undefined,
            tiktok_url: form.tiktok_url || undefined,
            youtube_url: form.youtube_url || undefined,
            website_url: form.website_url || undefined,
            commission_rate: parseInt(form.commission_rate),
            status: form.status as any,
            payout_method: form.payout_method as any,
            payout_email: form.payout_email || undefined,
          },
        });
        toast.success("Partner updated");
      } else {
        await createPartner.mutateAsync({
          email: form.email,
          full_name: form.full_name,
          business_name: form.business_name || undefined,
          phone: form.phone || undefined,
          bio: form.bio || undefined,
          instagram_url: form.instagram_url || undefined,
          tiktok_url: form.tiktok_url || undefined,
          youtube_url: form.youtube_url || undefined,
          website_url: form.website_url || undefined,
          commission_rate: parseInt(form.commission_rate),
          status: form.status as any,
          payout_method: form.payout_method as any,
          payout_email: form.payout_email || undefined,
          coupon_id: form.coupon_id || undefined,
        });
        toast.success("Partner created");
      }
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to save partner");
    }
  };

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} disabled={isEditing} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name *</Label>
          <Input id="full_name" value={form.full_name} onChange={(e) => update("full_name", e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="business_name">Business Name</Label>
          <Input id="business_name" value={form.business_name} onChange={(e) => update("business_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" value={form.bio} onChange={(e) => update("bio", e.target.value)} rows={3} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="instagram_url">Instagram URL</Label>
          <Input id="instagram_url" value={form.instagram_url} onChange={(e) => update("instagram_url", e.target.value)} placeholder="https://instagram.com/..." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tiktok_url">TikTok URL</Label>
          <Input id="tiktok_url" value={form.tiktok_url} onChange={(e) => update("tiktok_url", e.target.value)} placeholder="https://tiktok.com/@..." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="youtube_url">YouTube URL</Label>
          <Input id="youtube_url" value={form.youtube_url} onChange={(e) => update("youtube_url", e.target.value)} placeholder="https://youtube.com/..." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website_url">Website URL</Label>
          <Input id="website_url" value={form.website_url} onChange={(e) => update("website_url", e.target.value)} placeholder="https://..." />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Commission Rate</Label>
          <Select value={form.commission_rate} onValueChange={(v) => update("commission_rate", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10%</SelectItem>
              <SelectItem value="20">20%</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => update("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Payout Method</Label>
          <Select value={form.payout_method} onValueChange={(v) => update("payout_method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="paypal">PayPal</SelectItem>
              <SelectItem value="venmo">Venmo</SelectItem>
              <SelectItem value="check">Check</SelectItem>
              <SelectItem value="stripe_connect">Stripe Connect</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="payout_email">Payout Email</Label>
          <Input id="payout_email" type="email" value={form.payout_email} onChange={(e) => update("payout_email", e.target.value)} />
        </div>
        {!isEditing && (
          <div className="space-y-2">
            <Label htmlFor="coupon_id">Affiliate Coupon ID (optional)</Label>
            <Input id="coupon_id" value={form.coupon_id} onChange={(e) => update("coupon_id", e.target.value)} placeholder="UUID from affiliate_coupons" />
          </div>
        )}
      </div>

      <Button type="submit" disabled={createPartner.isPending || updatePartner.isPending} className="w-full">
        {createPartner.isPending || updatePartner.isPending ? "Saving..." : isEditing ? "Update Partner" : "Create Partner"}
      </Button>
    </form>
  );
}
