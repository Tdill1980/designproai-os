import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ExternalLink,
  CreditCard,
  Shield,
  Zap,
  Settings,
  Database,
  Server,
  Monitor,
  Users,
  Key,
  BookOpen,
  ClipboardCheck,
  Copy,
  AlertTriangle,
} from "lucide-react";

const STEPS = [
  { num: 1, title: "Welcome", icon: Shield },
  { num: 2, title: "System", icon: Server },
  { num: 3, title: "Supabase", icon: Database },
  { num: 4, title: "Stripe", icon: CreditCard },
  { num: 5, title: "Admin Tools", icon: Settings },
  { num: 6, title: "Ready!", icon: CheckCircle },
];

const OPERATOR_EMAILS = [
  "tdill@restyleproai.com",
  "jackson@weprintwraps.com",
  "carley@restyleproai.com",
];

function CopyBlock({ label, value }: { label: string; value: string }) {
  const copy = () => {
    navigator.clipboard.writeText(value);
    toast.success(`Copied ${label}`);
  };
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono text-foreground truncate">{value}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={copy} className="flex-shrink-0">
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function AdminOperatorOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checklist, setChecklist] = useState({
    supabaseAccess: false,
    stripeAccess: false,
    adminTested: false,
    operatorGuideRead: false,
    emergencyContacts: false,
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email || null;
      setUserEmail(email);
      setLoading(false);
      if (email && !OPERATOR_EMAILS.includes(email)) {
        toast.error("Access restricted to operators only");
        navigate("/admin");
      }
    });
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const allChecked = Object.values(checklist).every(Boolean);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 container mx-auto px-4 py-8 max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            Operator Onboarding
          </h1>
          <p className="text-sm text-muted-foreground">
            System &amp; Stripe walkthrough for operators
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isCompleted = step > s.num;
            const isCurrent = step === s.num;
            return (
              <div key={s.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                      isCompleted
                        ? "bg-green-500 border-green-500 text-white scale-95"
                        : isCurrent
                        ? "bg-primary border-primary text-primary-foreground scale-110 shadow-lg shadow-primary/30"
                        : "bg-muted border-border text-muted-foreground"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs mt-2 transition-colors",
                      isCurrent
                        ? "text-primary font-semibold"
                        : "text-muted-foreground"
                    )}
                  >
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-0.5 mx-2 mt-[-1rem] transition-colors",
                      step > s.num ? "bg-green-500" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 1: WELCOME */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-cyan-500/15 via-primary/10 to-transparent border-cyan-500/30 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <CardContent className="p-8 relative">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto mb-4">
                    <Shield className="h-8 w-8 text-cyan-400" />
                  </div>
                  <h2 className="text-3xl font-bold text-foreground mb-3">
                    Welcome, Operator
                  </h2>
                  <p className="text-lg text-muted-foreground leading-relaxed max-w-lg mx-auto">
                    This wizard walks you through every system you need access to as a{" "}
                    <span className="text-foreground font-semibold">
                      DesignProAI operator
                    </span>
                    . By the end, you'll have Supabase access, Stripe dashboard access,
                    and a full understanding of the admin tools.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border bg-card p-5 text-center">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/15 flex items-center justify-center mx-auto mb-3">
                  <Database className="h-6 w-6 text-cyan-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Supabase</h3>
                <p className="text-sm text-muted-foreground">
                  Database, auth, storage, edge functions
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 text-center">
                <div className="w-12 h-12 rounded-xl bg-green-500/15 flex items-center justify-center mx-auto mb-3">
                  <CreditCard className="h-6 w-6 text-green-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Stripe</h3>
                <p className="text-sm text-muted-foreground">
                  Subscriptions, billing, affiliate payouts
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 text-center">
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
                  <Monitor className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Admin Panel</h3>
                <p className="text-sm text-muted-foreground">
                  QA, batch renders, user management
                </p>
              </div>
            </div>

            <Button
              className="w-full gap-2 h-12 text-base"
              size="lg"
              onClick={() => setStep(2)}
            >
              Let's Get Started <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 2: SYSTEM OVERVIEW */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold text-foreground">
                System Architecture
              </h2>
              <p className="text-muted-foreground mt-1">
                How all the pieces fit together
              </p>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-foreground text-lg">The Stack</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Monitor className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Frontend — React + Vite</p>
                      <p className="text-sm text-muted-foreground">
                        Deployed on Vercel. Auto-deploys when code is pushed to <code className="text-xs bg-muted px-1 rounded">main</code>.
                        The UI users see — ColorPro, DesignPro, admin panel, everything.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Database className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Backend — Supabase</p>
                      <p className="text-sm text-muted-foreground">
                        PostgreSQL database, user authentication, file storage (renders, images),
                        and 112+ Edge Functions (serverless code that handles AI renders, Stripe webhooks, etc).
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Zap className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">AI — Google Gemini</p>
                      <p className="text-sm text-muted-foreground">
                        Model: <code className="text-xs bg-muted px-1 rounded">gemini-3-pro-image-preview</code>.
                        Generates all vehicle renders. Called by edge functions, not directly from the browser.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <CreditCard className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Payments — Stripe</p>
                      <p className="text-sm text-muted-foreground">
                        Handles subscriptions, metered billing ($5/extra render), and affiliate commission payouts
                        via Stripe Connect.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/30">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-foreground">How Renders Work (Don't Touch)</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      User picks color/design &rarr; Frontend calls edge function &rarr; Edge function builds prompt &rarr;
                      Sends to Gemini &rarr; Gets image back &rarr; Saves to Supabase Storage &rarr; Shows to user.
                      The render pipeline files are <span className="text-amber-400 font-medium">locked</span> —
                      never modify them without Trish's explicit approval.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep(3)}>
                Next: Supabase Access <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 3: SUPABASE ACCESS */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold text-foreground">
                Supabase Access
              </h2>
              <p className="text-muted-foreground mt-1">
                Your database, auth, storage, and edge functions — all in one place
              </p>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-foreground">Getting Access</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-cyan-400">1</span>
                    <p className="text-sm text-muted-foreground">
                      Trish will invite you to the Supabase project via email. Accept the invitation.
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-cyan-400">2</span>
                    <p className="text-sm text-muted-foreground">
                      Create a Supabase account (or sign in if you already have one).
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-cyan-400">3</span>
                    <p className="text-sm text-muted-foreground">
                      You'll see the <strong>restylepro</strong> project in your Supabase dashboard.
                    </p>
                  </div>
                </div>

                <CopyBlock label="Supabase Dashboard" value="https://supabase.com/dashboard" />
                <CopyBlock label="Project Ref" value="kfapjdyythzyvnpdeghu" />
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-foreground">Key Areas in Supabase</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Key className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Authentication</p>
                      <p className="text-sm text-muted-foreground">
                        View all users, reset passwords, check email verification status.
                        Go to <span className="font-mono text-xs">Authentication &gt; Users</span>.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Database className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Table Editor</p>
                      <p className="text-sm text-muted-foreground">
                        Browse tables like <code className="text-xs bg-muted px-1 rounded">color_visualizations</code> (renders),
                        <code className="text-xs bg-muted px-1 rounded">user_subscriptions</code>,
                        <code className="text-xs bg-muted px-1 rounded">profiles</code>.
                        You can view, filter, and edit rows directly.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Server className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Edge Functions</p>
                      <p className="text-sm text-muted-foreground">
                        112+ serverless functions. Check logs when renders fail.
                        Go to <span className="font-mono text-xs">Edge Functions &gt; Logs</span>.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Settings className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Storage</p>
                      <p className="text-sm text-muted-foreground">
                        All render images are stored here. Buckets: <code className="text-xs bg-muted px-1 rounded">renders</code>,
                        <code className="text-xs bg-muted px-1 rounded">wrap-files</code>,
                        <code className="text-xs bg-muted px-1 rounded">design-uploads</code>.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep(4)}>
                Next: Stripe Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 4: STRIPE ACCESS */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold text-foreground">
                Stripe Dashboard
              </h2>
              <p className="text-muted-foreground mt-1">
                Subscriptions, billing, and affiliate payouts
              </p>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-foreground">Getting Access</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-green-400">1</span>
                    <p className="text-sm text-muted-foreground">
                      Trish will add you as a <strong>team member</strong> in Stripe. You'll get an email invite.
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-green-400">2</span>
                    <p className="text-sm text-muted-foreground">
                      Accept the invite and set up your Stripe account with 2FA (required).
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-green-400">3</span>
                    <p className="text-sm text-muted-foreground">
                      You'll have <strong>read access</strong> to view subscriptions, payments, and customer data.
                    </p>
                  </div>
                </div>

                <CopyBlock label="Stripe Dashboard" value="https://dashboard.stripe.com" />
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-foreground">What You'll See in Stripe</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Users className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Customers</p>
                      <p className="text-sm text-muted-foreground">
                        Every user who signs up. Search by email to find their subscription status,
                        payment history, and current plan.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <CreditCard className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Subscriptions</p>
                      <p className="text-sm text-muted-foreground">
                        Active subscriptions by tier (Starter, Pro, Enterprise).
                        You can see MRR (Monthly Recurring Revenue), churn, and upcoming renewals.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Zap className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Metered Billing</p>
                      <p className="text-sm text-muted-foreground">
                        Extra renders beyond plan limits are billed at $5/render.
                        Check <span className="font-mono text-xs">Billing &gt; Usage records</span> to see usage.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Users className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Connect (Affiliates)</p>
                      <p className="text-sm text-muted-foreground">
                        Affiliate payouts go through Stripe Connect.
                        Check <span className="font-mono text-xs">Connect &gt; Accounts</span> to see affiliate payout status.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/30">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-foreground">Important: Live vs Test Mode</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Stripe has a toggle at the top: <strong>Live</strong> vs <strong>Test</strong>.
                      Always confirm you're in <span className="text-green-400 font-semibold">Live mode</span> when
                      looking at real customer data. Test mode is for development only.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep(5)}>
                Next: Admin Tools <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 5: ADMIN TOOLS */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold text-foreground">
                Admin Panel Tools
              </h2>
              <p className="text-muted-foreground mt-1">
                Everything you can do from the DesignProAI admin dashboard
              </p>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-foreground">Quick Launch Tools</h3>
                {[
                  {
                    name: "Batch Control Center",
                    route: "/admin/batch-render",
                    desc: "Trigger batch renders for vehicles. Select make/model/year, pick colors, and generate multiple renders at once.",
                    color: "text-blue-400",
                  },
                  {
                    name: "Batch QA Studio",
                    route: "/admin/batch-qa-studio",
                    desc: "Review batch render results. Rate quality (1-5 stars), promote good renders to gallery, delete bad ones.",
                    color: "text-green-400",
                  },
                  {
                    name: "Batch Results",
                    route: "/admin/batch-results",
                    desc: "Grid and list view of all renders. Filter by vehicle, color, status. Export data.",
                    color: "text-yellow-400",
                  },
                  {
                    name: "Production Pipeline Test",
                    route: "/admin/production-test",
                    desc: "Test the Universal Panelizer — the tool that turns 3D renders into flat print-ready panels.",
                    color: "text-orange-400",
                  },
                ].map((tool) => (
                  <div key={tool.name} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Settings className={cn("h-5 w-5 flex-shrink-0 mt-0.5", tool.color)} />
                    <div>
                      <p className="font-medium text-foreground">{tool.name}</p>
                      <p className="text-sm text-muted-foreground">{tool.desc}</p>
                      <button
                        onClick={() => navigate(tool.route)}
                        className={cn("text-xs font-medium mt-1 hover:underline", tool.color)}
                      >
                        Open &rarr;
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-foreground">Content Management</h3>
                {[
                  {
                    name: "Gallery Management",
                    desc: "Curate the public gallery. Add/remove renders, set featured items.",
                  },
                  {
                    name: "Color Swatches",
                    desc: "Manage manufacturer color database — 3M, Avery, KPMF, etc.",
                  },
                  {
                    name: "Vehicle Database",
                    desc: "Add/edit vehicle makes, models, years, and reference images.",
                  },
                  {
                    name: "User Subscriptions",
                    desc: "View and manage user subscription tiers, render counts, and billing status.",
                  },
                  {
                    name: "Affiliate Management",
                    desc: "Track affiliate signups, commission tiers, content submissions, and payouts.",
                  },
                ].map((tool) => (
                  <div key={tool.name} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <ClipboardCheck className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">{tool.name}</p>
                      <p className="text-sm text-muted-foreground">{tool.desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-cyan-500/10 to-transparent border-cyan-500/30">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <BookOpen className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-foreground">Operator Guide</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      For detailed edge function troubleshooting, Supabase table references, and
                      Claude Code templates, check the{" "}
                      <button
                        onClick={() => navigate("/admin/operator-guide")}
                        className="text-cyan-400 font-medium hover:underline"
                      >
                        Operator Guide
                      </button>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(4)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep(6)}>
                Next: Completion Checklist <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 6: COMPLETION CHECKLIST */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 6 && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">
                Onboarding Checklist
              </h2>
              <p className="text-muted-foreground mt-1">
                Confirm each item as you complete it with Trish
              </p>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                {[
                  {
                    key: "supabaseAccess" as const,
                    label: "I have access to the Supabase dashboard and can see the restylepro project",
                    icon: Database,
                  },
                  {
                    key: "stripeAccess" as const,
                    label: "I have access to the Stripe dashboard and can see customers/subscriptions",
                    icon: CreditCard,
                  },
                  {
                    key: "adminTested" as const,
                    label: "I've tested the admin panel — opened Batch QA, viewed renders, navigated the dashboard",
                    icon: Monitor,
                  },
                  {
                    key: "operatorGuideRead" as const,
                    label: "I've read through the Operator Guide and bookmarked it",
                    icon: BookOpen,
                  },
                  {
                    key: "emergencyContacts" as const,
                    label: "I have Trish's contact info for emergencies and know how to check edge function logs",
                    icon: AlertTriangle,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.key}
                      className={cn(
                        "flex items-start gap-3 p-4 rounded-lg border transition-colors",
                        checklist[item.key]
                          ? "bg-green-500/10 border-green-500/30"
                          : "bg-muted/50 border-border"
                      )}
                    >
                      <Checkbox
                        id={item.key}
                        checked={checklist[item.key]}
                        onCheckedChange={(checked) =>
                          setChecklist((prev) => ({ ...prev, [item.key]: !!checked }))
                        }
                        className="mt-0.5"
                      />
                      <Label htmlFor={item.key} className="text-sm leading-relaxed cursor-pointer flex items-start gap-2">
                        <Icon className={cn("h-4 w-4 flex-shrink-0 mt-0.5", checklist[item.key] ? "text-green-400" : "text-muted-foreground")} />
                        {item.label}
                      </Label>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {allChecked && (
              <Card className="bg-gradient-to-br from-green-500/15 via-cyan-500/10 to-transparent border-green-500/30">
                <CardContent className="p-6 text-center">
                  <h3 className="text-xl font-bold text-foreground mb-2">
                    You're all set!
                  </h3>
                  <p className="text-muted-foreground">
                    You now have full operator access to DesignProAI. Head to the admin dashboard to get started.
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(5)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={() => navigate("/admin")}
                disabled={!allChecked}
              >
                {allChecked ? (
                  <>Go to Admin Dashboard <ArrowRight className="h-4 w-4" /></>
                ) : (
                  "Complete all items above"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
