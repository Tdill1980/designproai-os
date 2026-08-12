import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EarningsCalculator } from "@/components/affiliate/EarningsCalculator";
import { useAffiliateSignup, useAffiliateProfile } from "@/hooks/useAffiliateData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DollarSign,
  Share2,
  Users,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  Loader2,
  Zap,
  Repeat,
  BarChart3,
} from "lucide-react";

const AffiliateOnboarding = lazy(() => import("./AffiliateOnboarding"));

const signupSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  company_name: z.string().optional(),
  tax_id: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  instagram_handle: z.string().optional(),
});

type SignupForm = z.infer<typeof signupSchema>;

export default function AffiliateJoin() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const { data: existingProfile, isLoading: profileLoading } = useAffiliateProfile();
  const signupMutation = useAffiliateSignup();

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user ?? null;
      setUser(u);
      if (u?.email) {
        setValue('email', u.email);
      }
      if (u?.user_metadata?.full_name) {
        setValue('full_name', u.user_metadata.full_name);
      }
    });
  }, [setValue]);

  useEffect(() => {
    if (existingProfile) {
      if (existingProfile.status === 'pending') {
        setSubmitted(true);
      } else if (existingProfile.status === 'approved') {
        setShowWizard(true);
      } else if (existingProfile.status === 'active') {
        navigate('/affiliate/dashboard');
      }
    }
  }, [existingProfile, navigate]);

  const onSubmit = async (formData: SignupForm) => {
    if (!user) {
      toast.error("Please log in or create an account first");
      navigate('/login');
      return;
    }

    try {
      const result = await signupMutation.mutateAsync(formData);
      if (result?.affiliate?.status === 'approved') {
        toast.success("You're approved! Let's get you set up...");
        setShowWizard(true);
      } else if (result?.affiliate?.status === 'active') {
        toast.success("You're approved! Redirecting to your dashboard...");
        navigate('/affiliate/dashboard');
      } else {
        setSubmitted(true);
        toast.success("Application submitted!");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to submit application");
    }
  };

  if (showWizard) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }>
        <AffiliateOnboarding />
      </Suspense>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col bg-background light">
        <div className="flex-1 flex items-center justify-center px-4">
          <Card className="bg-card border-border max-w-md w-full">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Application Submitted!</h2>
              <p className="text-muted-foreground mb-6">
                We'll review your application within 24 hours. You'll receive an email once approved.
              </p>
              <Button onClick={() => navigate('/')} variant="outline">
                Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background light">

      {/* Hero */}
      <section className="py-16 md:py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
            {/* Text content */}
            <div className="flex-1 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <DollarSign className="h-4 w-4" />
                MightyAffiliate Partner Program
              </div>
              <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
                Earn <span className="text-primary">20%</span> Commission
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-8">
                Promote RestyleProAI to wrap shops, installers, and fleet services.
                Earn 20% commission on every subscription you refer.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
                <Button size="lg" className="gap-2" onClick={() => document.getElementById('signup-form')?.scrollIntoView({ behavior: 'smooth' })}>
                  Apply Now <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth' })}>
                  Calculate Earnings
                </Button>
              </div>
            </div>
            {/* Sproket money bag */}
            <div className="flex-shrink-0">
              <img
                src="/characters/sproket/sproket-moneybag2.png"
                alt="SPROKET with money bag"
                className="w-24 sm:w-28 md:w-32 object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-16 px-4 border-t border-border">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Repeat className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Earn Commission</h3>
              <p className="text-muted-foreground text-sm">
                Earn 20% commission on every subscription you refer.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Zap className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Marketing Assets Provided</h3>
              <p className="text-muted-foreground text-sm">
                Video reels, social posts, email templates - everything you need to promote and convert.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="h-6 w-6 text-cyan-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Real-Time Dashboard</h3>
              <p className="text-muted-foreground text-sm">
                Track clicks, signups, commissions, and payouts in real-time from your affiliate dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4 border-t border-border bg-card/30">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Sign Up", desc: "Fill out the application form below. We review and approve within 24 hours.", icon: Users },
              { step: "2", title: "Share Your Link", desc: "Get your unique referral code and marketing assets. Share with your audience.", icon: Share2 },
              { step: "3", title: "Earn Commission", desc: "Earn 20% commission on every subscription your referrals sign up for.", icon: TrendingUp },
            ].map((item) => (
              <div key={item.step} className="relative text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 text-lg font-bold">
                  {item.step}
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Commission */}
      <section className="py-16 px-4 border-t border-border">
        <div className="container mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">20% Commission</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">Earn 20% on every subscription your referrals sign up for. Share your code, grow your income.</p>
          <Card className="bg-card border-border max-w-sm mx-auto">
            <CardContent className="p-8">
              <p className="text-5xl font-black text-primary">20%</p>
              <p className="text-muted-foreground mt-2">commission per referral</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Calculator */}
      <section id="calculator" className="py-16 px-4 border-t border-border bg-card/30">
        <div className="container mx-auto max-w-lg">
          <EarningsCalculator />
        </div>
      </section>

      {/* Signup Form */}
      <section id="signup-form" className="py-16 px-4 border-t border-border">
        <div className="container mx-auto max-w-lg">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-2xl text-center">Apply to Become an Affiliate</CardTitle>
            </CardHeader>
            <CardContent>
              {!user && (
                <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm text-center">
                  <p>You need an account to apply.</p>
                  <Button
                    variant="link"
                    className="text-yellow-400 underline p-0 h-auto"
                    onClick={() => navigate('/signup')}
                  >
                    Create an account first
                  </Button>
                </div>
              )}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="full_name">Full Name *</Label>
                  <Input
                    id="full_name"
                    {...register('full_name')}
                    placeholder="John Smith"
                    className="mt-1"
                  />
                  {errors.full_name && <p className="text-sm text-destructive mt-1">{errors.full_name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    {...register('email')}
                    placeholder="john@wrapshop.com"
                    className="mt-1"
                  />
                  {errors.email && <p className="text-sm text-destructive mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <Label htmlFor="company_name">Company / Shop Name</Label>
                  <Input
                    id="company_name"
                    {...register('company_name')}
                    placeholder="Your business name"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="tax_id">Tax ID / EIN <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="tax_id"
                    {...register('tax_id')}
                    placeholder="e.g., 12-3456789"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    {...register('country')}
                    placeholder="e.g., United States"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    {...register('phone')}
                    placeholder="(555) 123-4567"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    {...register('website')}
                    placeholder="https://yoursite.com"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="instagram_handle">Instagram Handle</Label>
                  <Input
                    id="instagram_handle"
                    {...register('instagram_handle')}
                    placeholder="@yourhandle"
                    className="mt-1"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={signupMutation.isPending || !user}
                >
                  {signupMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Application"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
