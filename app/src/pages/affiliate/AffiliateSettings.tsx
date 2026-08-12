import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AffiliateStatusBadge } from "@/components/affiliate/AffiliateStatusBadge";
import { useAffiliateProfile, useUpdateAffiliateProfile } from "@/hooks/useAffiliateData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  CreditCard,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Link as LinkIcon,
} from "lucide-react";

const profileSchema = z.object({
  full_name: z.string().min(2),
  company_name: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  instagram_handle: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function AffiliateSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: profile, isLoading, refetch } = useAffiliateProfile();
  const updateProfile = useUpdateAffiliateProfile();
  const [stripeLoading, setStripeLoading] = useState(false);

  // Handle Stripe return — verify status and activate if needed
  useEffect(() => {
    const stripeStatus = searchParams.get("stripe");
    if (!stripeStatus || !profile) return;

    if (stripeStatus === "complete") {
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("affiliate-stripe-connect", {
            body: { action: "check_status" },
          });
          if (error) throw error;
          if (data?.onboarded) {
            if (profile.status === "approved") {
              await supabase.functions.invoke("affiliate-activate", {
                body: { affiliate_id: profile.id },
              });
            }
            toast.success("Bank account connected! Payouts are now enabled.");
            refetch();
          } else {
            toast.info("Stripe setup needs a few more details — click Connect Stripe to finish.");
          }
        } catch (err: any) {
          toast.error(err.message || "Could not verify Stripe status");
        } finally {
          setSearchParams({}, { replace: true });
        }
      })();
    } else if (stripeStatus === "refresh") {
      toast.info("Stripe setup was interrupted — click Connect Stripe to try again.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, profile?.id, profile?.status, refetch, setSearchParams]);

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    if (profile) {
      reset({
        full_name: profile.full_name,
        company_name: profile.company_name || '',
        phone: profile.phone || '',
        website: profile.website || '',
        instagram_handle: profile.instagram_handle || '',
      });
    }
  }, [profile, reset]);

  const onSubmit = async (data: ProfileForm) => {
    try {
      await updateProfile.mutateAsync(data);
      toast.success("Profile updated");
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    }
  };

  const handleStripeRelink = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('affiliate-stripe-connect', {
        body: {
          action: 'create_account',
          return_url: window.location.origin + '/affiliate/settings',
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to connect Stripe");
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
      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to open Stripe dashboard");
    } finally {
      setStripeLoading(false);
    }
  };

  if (isLoading) {
    return (
      <AffiliateLayout title="Settings">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AffiliateLayout>
    );
  }

  if (!profile) return null;

  return (
    <AffiliateLayout title="Settings" subtitle="Manage your affiliate profile and payout settings">
      <div className="max-w-2xl space-y-6">
        {/* Profile Form */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your contact and business information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="full_name">Full Name</Label>
                <Input id="full_name" {...register('full_name')} className="mt-1" />
                {errors.full_name && <p className="text-sm text-destructive mt-1">{errors.full_name.message}</p>}
              </div>
              <div>
                <Label htmlFor="company_name">Company Name</Label>
                <Input id="company_name" {...register('company_name')} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...register('phone')} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="website">Website</Label>
                <Input id="website" {...register('website')} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="instagram_handle">Instagram Handle</Label>
                <Input id="instagram_handle" {...register('instagram_handle')} className="mt-1" />
              </div>
              <Button
                type="submit"
                disabled={!isDirty || updateProfile.isPending}
                className="gap-2"
              >
                {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Referral Code (read-only) */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Referral Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Referral Code</Label>
              <div className="mt-1 bg-muted rounded-lg px-4 py-3 font-mono text-foreground">
                {profile.referral_code}
              </div>
            </div>
            <div>
              <Label>Referral Link</Label>
              <div className="mt-1 bg-muted rounded-lg px-4 py-3 text-sm text-foreground break-all">
                {profile.referral_link}
              </div>
            </div>
            <div className="flex items-center gap-6 pt-2">
              <div>
                <Label className="text-muted-foreground">
                  {profile.recurring_rate > 0 ? "Initial Commission" : "Commission"}
                </Label>
                <p className="text-2xl font-bold text-primary">{profile.commission_rate}%</p>
                <p className="text-xs text-muted-foreground">
                  {profile.recurring_rate > 0 ? "on every new subscription" : "one-time payment"}
                </p>
              </div>
              {profile.recurring_rate > 0 && (
                <div>
                  <Label className="text-muted-foreground">Monthly Recurring</Label>
                  <p className="text-2xl font-bold text-primary">{profile.recurring_rate}%</p>
                  <p className="text-xs text-muted-foreground">on your active subscribers</p>
                </div>
              )}
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div className="mt-1"><AffiliateStatusBadge status={profile.status} /></div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stripe Connect */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payout Settings
            </CardTitle>
            <CardDescription>Manage your Stripe Connect account for receiving payouts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
              {profile.stripe_onboarded ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-foreground font-medium">Stripe Connected</p>
                    <p className="text-sm text-muted-foreground">Your account is set up to receive payouts.</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                  <div>
                    <p className="text-foreground font-medium">Stripe Not Connected</p>
                    <p className="text-sm text-muted-foreground">Connect your bank account to receive commission payouts.</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {profile.stripe_onboarded ? (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleStripeDashboard}
                  disabled={stripeLoading}
                >
                  {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Open Stripe Dashboard
                </Button>
              ) : (
                <Button
                  className="gap-2"
                  onClick={handleStripeRelink}
                  disabled={stripeLoading}
                >
                  {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Connect Stripe
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Payouts are processed on the 1st and 15th of each month. Minimum payout: $10.00.
            </p>
          </CardContent>
        </Card>
      </div>
    </AffiliateLayout>
  );
}
