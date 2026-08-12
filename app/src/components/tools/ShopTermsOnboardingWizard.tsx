import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowRight, ArrowLeft, Check, FileText, Sparkles, Settings } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TERMS_TEXT } from '@/lib/default-terms';
import { toast } from '@/hooks/use-toast';

const STEPS = ['Welcome', 'Terms & Conditions', 'Confirm'];

interface ShopTermsOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function ShopTermsOnboardingWizard({
  open,
  onOpenChange,
  onComplete,
}: ShopTermsOnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [termsText, setTermsText] = useState(DEFAULT_TERMS_TEXT);
  const [isSaving, setIsSaving] = useState(false);

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('shop_profiles')
        .upsert({
          user_id: user.id,
          custom_terms_text: termsText,
          default_include_disclaimer: true,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'user_id' });

      if (error) throw error;

      toast({ title: 'Terms Saved', description: 'Your terms & conditions have been set up. You can edit them anytime in Shop Settings.' });
      onComplete?.();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to save terms', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Shop Setup - Step {step + 1} of {STEPS.length}
          </DialogTitle>
          <div className="flex gap-1 mt-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="py-4 min-h-[300px]">
          {step === 0 && (
            <div className="space-y-4">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Welcome to Proof Terms Setup</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  When you share 3D proofs with customers, you can include Terms & Conditions
                  that protect your shop and set clear expectations.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We've pre-filled standard wrap industry terms for you. You can customize
                  them now or edit them later in{' '}
                  <span className="font-medium text-foreground">Shop Settings</span>.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Your Terms & Conditions</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTermsText(DEFAULT_TERMS_TEXT)}
                  className="text-xs h-7"
                  disabled={termsText === DEFAULT_TERMS_TEXT}
                >
                  Reset to Default
                </Button>
              </div>
              <Textarea
                value={termsText}
                onChange={(e) => setTermsText(e.target.value)}
                className="min-h-[280px] text-xs font-mono leading-relaxed"
                placeholder="Enter your shop's terms and conditions..."
              />
              <p className="text-[11px] text-muted-foreground">
                Edit as needed. These will appear on your 3D proofs when the T&C checkbox is checked.
                Customers can view them before approving a design.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold">You're All Set!</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your terms will be included on 3D proofs when the T&C checkbox is enabled.
                  Customers will see and acknowledge them before approving designs.
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 border">
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Quick tip</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  You can edit your terms anytime from <strong>Admin &rarr; Shop Settings</strong>.
                  You can also quick-edit terms directly on the 3D proof before sharing with a customer.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>
              Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Complete Setup'}
              {!isSaving && <Check className="w-4 h-4 ml-1" />}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
