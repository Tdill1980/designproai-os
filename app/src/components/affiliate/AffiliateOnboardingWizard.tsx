import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpdateAffiliatePartner } from "@/hooks/useAffiliatePartners";
import { toast } from "sonner";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";

interface AffiliateOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  partnerName: string;
  commissionRate: number;
}

const STEPS = ["Welcome", "Program Terms", "Commission Structure", "Payout Details", "Create Profile"];

export function AffiliateOnboardingWizard({
  open,
  onOpenChange,
  partnerId,
  partnerName,
  commissionRate,
}: AffiliateOnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const updatePartner = useUpdateAffiliatePartner();

  const [form, setForm] = useState({
    payout_email: "",
    payout_method: "paypal",
    business_name: "",
    bio: "",
    instagram_url: "",
    tiktok_url: "",
    youtube_url: "",
    website_url: "",
  });

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const canNext = () => {
    if (step === 1) return termsAccepted;
    if (step === 3) return !!form.payout_email;
    return true;
  };

  const handleFinish = async () => {
    try {
      await updatePartner.mutateAsync({
        id: partnerId,
        updates: {
          payout_email: form.payout_email,
          payout_method: form.payout_method as any,
          business_name: form.business_name || undefined,
          bio: form.bio || undefined,
          instagram_url: form.instagram_url || undefined,
          tiktok_url: form.tiktok_url || undefined,
          youtube_url: form.youtube_url || undefined,
          website_url: form.website_url || undefined,
          onboarding_completed: true,
          terms_accepted_at: new Date().toISOString(),
        },
      });
      toast.success("Onboarding complete!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to complete onboarding");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/characters/sproket/sproket-clipboard.png" alt="SPROKET" className="w-8 h-8 object-contain" />
            Partner Onboarding - Step {step + 1} of {STEPS.length}
          </DialogTitle>
          <div className="flex gap-1 mt-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="py-4 min-h-[300px]">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img src="/characters/sproket/sproket-welcome.png" alt="SPROKET" className="w-14 h-14 object-contain" />
                <h3 className="text-xl font-bold">Welcome, {partnerName}!</h3>
              </div>
              <p className="text-muted-foreground">
                Thank you for joining the DesignProAI Affiliate Partner Program. As a partner, you'll earn
                recurring commissions on every subscription you refer - for the lifetime of the customer's subscription.
              </p>
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <p className="font-medium">What you'll get:</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>- Your own unique promo code for referrals</li>
                  <li>- Lifetime recurring commission on referred subscriptions</li>
                  <li>- Upload reels and ads to promote your work</li>
                  <li>- Monthly payouts via your preferred method</li>
                  <li>- Partner Ad promotion for top performers</li>
                </ul>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Affiliate Program Terms</h3>
              <ScrollArea className="h-[200px] rounded-md border p-4">
                <div className="text-sm text-muted-foreground space-y-3">
                  <p><strong>1. Commission Structure:</strong> You will receive {commissionRate}% commission on subscription revenue from customers you refer, paid monthly, for the lifetime of their subscription.</p>
                  <p><strong>2. Payment:</strong> Commissions are calculated monthly and paid out by the 15th of the following month, subject to a minimum payout threshold of $25.</p>
                  <p><strong>3. Referral Tracking:</strong> Referrals are tracked via your unique promo code. The customer must use your code at checkout for the referral to be attributed to you.</p>
                  <p><strong>4. Content Guidelines:</strong> All uploaded content (reels, static ads) must be original work and comply with our brand guidelines. We reserve the right to approve or reject content submissions.</p>
                  <p><strong>5. Termination:</strong> Either party may terminate this arrangement at any time. Outstanding commissions will be paid out within 30 days of termination.</p>
                  <p><strong>6. Independent Contractor:</strong> You are an independent contractor, not an employee. You are responsible for your own taxes on commission income.</p>
                  <p><strong>7. Non-Exclusivity:</strong> This is a non-exclusive arrangement. You may promote competing products.</p>
                </div>
              </ScrollArea>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(!!checked)}
                />
                <Label htmlFor="terms" className="text-sm">
                  I have read and agree to the Affiliate Program Terms
                </Label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Commission Structure</h3>
              <p className="text-muted-foreground">Your commission rate: <span className="text-primary font-bold text-xl">{commissionRate}%</span></p>

              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-muted">
                  <p className="font-medium mb-2">Example: Starter Plan ($29/mo)</p>
                  <p className="text-sm text-muted-foreground">
                    Commission per month: <span className="font-medium text-green-400">${(29 * commissionRate / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Annual earnings per referral: <span className="font-medium text-green-400">${(29 * commissionRate / 100 * 12).toFixed(2)}</span>
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted">
                  <p className="font-medium mb-2">Example: Complete Plan ($99/mo)</p>
                  <p className="text-sm text-muted-foreground">
                    Commission per month: <span className="font-medium text-green-400">${(99 * commissionRate / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Annual earnings per referral: <span className="font-medium text-green-400">${(99 * commissionRate / 100 * 12).toFixed(2)}</span>
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Commissions are calculated on the actual amount paid after any discounts. Recurring monthly for the lifetime of each referred subscription.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Payout Details</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Payout Email *</Label>
                  <Input value={form.payout_email} onChange={(e) => update("payout_email", e.target.value)} placeholder="your@email.com" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label>Payout Method</Label>
                  <Select value={form.payout_method} onValueChange={(v) => update("payout_method", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="venmo">Venmo</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Business Name (optional)</Label>
                  <Input value={form.business_name} onChange={(e) => update("business_name", e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Create Your Profile</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Bio</Label>
                  <Textarea value={form.bio} onChange={(e) => update("bio", e.target.value)} rows={3} placeholder="Tell us about your wrap business..." />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Instagram</Label>
                    <Input value={form.instagram_url} onChange={(e) => update("instagram_url", e.target.value)} placeholder="https://instagram.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label>TikTok</Label>
                    <Input value={form.tiktok_url} onChange={(e) => update("tiktok_url", e.target.value)} placeholder="https://tiktok.com/@..." />
                  </div>
                  <div className="space-y-2">
                    <Label>YouTube</Label>
                    <Input value={form.youtube_url} onChange={(e) => update("youtube_url", e.target.value)} placeholder="https://youtube.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input value={form.website_url} onChange={(e) => update("website_url", e.target.value)} placeholder="https://..." />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <div>
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
          </div>
          <div>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={updatePartner.isPending}>
                <Check className="h-4 w-4 mr-1" />
                {updatePartner.isPending ? "Saving..." : "Complete Onboarding"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
