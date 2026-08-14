/**
 * CorporateOnboardingWizard — floating wizard for RP/WPW corporate team
 * on first login.
 *
 * Triggers when:
 *   1. User's email is in rp_corporate_team
 *   2. User hasn't completed onboarding (checked via localStorage flag)
 *
 * Steps:
 *   1. Welcome — your name, title, role
 *   2. Platform tour — key tools overview
 *   3. Content agreement — must agree to create 2 assigned content pieces/week
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles, ArrowRight, ArrowLeft, CheckCircle, Crown,
  Palette, Calculator, Printer, Users, FileText, Megaphone,
} from "lucide-react";

const db = supabase as any;

interface TeamMemberInfo {
  full_name: string;
  title: string;
  department: string;
  role: string;
  company: string;
  email: string;
}

const TOOL_CARDS = [
  { icon: Palette, name: "DesignProAI", desc: "AI-generated custom wraps via prompt" },
  { icon: Calculator, name: "QuickQuote", desc: "Instant pricing from vehicle measurements" },
  { icon: Printer, name: "PrintPro / WPW Products", desc: "Production packs, WBTY, printed film" },
  { icon: Users, name: "MightyAffiliate", desc: "Referral codes, commissions, Stripe payouts" },
  { icon: FileText, name: "Quote Manager", desc: "Track quotes, email customers, retarget" },
  { icon: Megaphone, name: "Marketing Hub", desc: "Content calendar, campaigns, social" },
];

const ONBOARDING_KEY = "rp_corporate_onboarding_done";

export function CorporateOnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [member, setMember] = useState<TeamMemberInfo | null>(null);
  const [agreedContent, setAgreedContent] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);

  useEffect(() => {
    // Don't show if already completed
    if (localStorage.getItem(ONBOARDING_KEY)) return;

    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data, error } = await db
        .from("rp_corporate_team")
        .select("full_name, title, department, role, company, email")
        .eq("email", user.email)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !data) return;
      setMember(data as TeamMemberInfo);
      setOpen(true);
    };

    check();
  }, []);

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());
    setOpen(false);
  };

  if (!member) return null;

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="space-y-5 text-center">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto">
        <Crown className="w-8 h-8 text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">Welcome, {member.full_name?.split(" ")[0] || "Team Member"}</h2>
        <p className="text-sm text-white/50 mt-1">{member.company} Corporate Team</p>
      </div>
      <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-left space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-white/40">Title</span>
          <span className="text-white font-medium">{member.title}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-white/40">Department</span>
          <span className="text-white font-medium capitalize">{member.department}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-white/40">Role</span>
          <span className="text-white font-medium capitalize">{member.role}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-white/40">Email</span>
          <span className="text-cyan-400 font-medium">{member.email}</span>
        </div>
      </div>
      <p className="text-xs text-white/30">You have full admin access to all platform tools, renders, and quote systems.</p>
    </div>,

    // Step 1: Platform tour
    <div key="tour" className="space-y-5">
      <div className="text-center">
        <Sparkles className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
        <h2 className="text-lg font-bold text-white">Your Platform Tools</h2>
        <p className="text-xs text-white/40">Full access — unlimited renders, quotes, and campaigns</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {TOOL_CARDS.map((tool) => (
          <div key={tool.name} className="bg-white/5 rounded-xl p-3 border border-white/10">
            <tool.icon className="w-5 h-5 text-cyan-400 mb-1.5" />
            <p className="text-xs font-bold text-white">{tool.name}</p>
            <p className="text-[10px] text-white/40 mt-0.5">{tool.desc}</p>
          </div>
        ))}
      </div>
    </div>,

    // Step 2: Content agreement
    <div key="agreement" className="space-y-5">
      <div className="text-center">
        <Megaphone className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
        <h2 className="text-lg font-bold text-white">Content Agreement</h2>
        <p className="text-xs text-white/40">One last thing before you're all set</p>
      </div>
      <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-4">
        <p className="text-sm text-white/70 leading-relaxed">
          As a member of the {member.company} corporate team, you agree to create and deliver
          <span className="text-cyan-400 font-bold"> 2 assigned content pieces per week</span> as
          directed by the Marketing Hub content calendar and your team lead.
        </p>
        <p className="text-xs text-white/40">
          Content includes but is not limited to: social media posts, blog articles, email campaigns,
          video content, customer outreach, design showcases, and sales materials. Assignments are
          tracked in the Marketing Hub board.
        </p>
        <div className="space-y-3 pt-2 border-t border-white/10">
          <div className="flex items-start gap-3">
            <Checkbox
              id="content-agree"
              checked={agreedContent}
              onCheckedChange={(v) => setAgreedContent(!!v)}
              className="mt-0.5 border-white/30 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
            />
            <Label htmlFor="content-agree" className="text-sm text-white/80 leading-snug cursor-pointer">
              I agree to deliver <strong>2 assigned content pieces per week</strong> as outlined in the Marketing Hub.
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="terms-agree"
              checked={agreedTerms}
              onCheckedChange={(v) => setAgreedTerms(!!v)}
              className="mt-0.5 border-white/30 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
            />
            <Label htmlFor="terms-agree" className="text-sm text-white/80 leading-snug cursor-pointer">
              I understand that my platform access, admin tools, and affiliate commission are tied to my active participation on the team.
            </Label>
          </div>
        </div>
      </div>
    </div>,
  ];

  const isLastStep = step === steps.length - 1;
  const canProceed = isLastStep ? (agreedContent && agreedTerms) : true;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && isLastStep && canProceed) handleComplete(); }}>
      <DialogContent className="bg-[#111] border-[#333] max-w-md p-6 sm:rounded-2xl">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                i === step ? "bg-cyan-400 w-6" : i < step ? "bg-cyan-400/50" : "bg-white/15"
              )}
            />
          ))}
        </div>

        {steps[step]}

        {/* Navigation */}
        <div className="flex justify-between mt-5">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} className="text-white/50 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          ) : (
            <div />
          )}
          {isLastStep ? (
            <Button
              size="sm"
              onClick={handleComplete}
              disabled={!canProceed}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold disabled:opacity-30"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" /> I'm Ready — Let's Go
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setStep(step + 1)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold"
            >
              Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
