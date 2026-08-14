import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Phone,
  MessageSquare,
  Bot,
  Shield,
  Zap,
  CheckCircle2,
  ChevronDown,
  Mic,
  Sparkles,
  Calculator,
  Smartphone,
  Wand2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUserTier } from "@/hooks/useUserTier";
import { cn } from "@/lib/utils";

// ── Customer-side text mockup (basic tier) ───────────────────────────
const SAMPLE_AUTOTEXT = [
  { from: "shop", text: "Hey — sorry I missed your call. I'm with a customer in the bay. Want to price your wrap right now? It takes 60 seconds: restyleproai.com/q/abc123" },
  { from: "lead", text: "Yeah let's do it" },
  { from: "shop", text: "Awesome. Drop your year/make/model in the link and you'll get a full quote with renders. I'll text you when I'm free to lock in your install date." },
];

// ── AI receptionist transcript (pro tier) ─────────────────────────────
const SAMPLE_AI_TRANSCRIPT = [
  { who: "AI", text: "Hey, this is the front desk for Apex Wraps — Mike's on a job right now. Can I grab your name and what you're looking at?" },
  { who: "Caller", text: "Yeah, Marcus. I have a 2022 Tahoe, want to do a satin black wrap." },
  { who: "AI", text: "Got it — full body or just hood and roof?" },
  { who: "Caller", text: "Full body. How fast can he do it?" },
  { who: "AI", text: "He's booking 2 weeks out. I'll text you a quote with renders right now and a calendar link. What's the best number?" },
];

const FAQ = [
  { q: "Do I need a DesignProAI subscription to add NML?", a: "Yes — Never Miss a Lead is an add-on for active DesignProAI shops. The dashboard, dedicated number, AI auto-text, and lead capture all live inside DesignProAI. If you don't have a plan yet, pick one from /pricing and come back to add NML." },
  { q: "How much business am I really losing to missed calls?", a: "Industry average is 27% of inbound calls go unanswered at small shops. If your average wrap is $3,000 and you book even 1 in 5 quotes, every 5 missed calls = $3,000 in lost revenue. NML pays for itself the first month it saves a single wrap." },
  { q: "Do I need to install anything?", a: "No. Your new number forwards to your existing cell. If you miss it, our AI handles the rest. Everything shows up on your DesignProAI dashboard — leads, transcripts, conversion rate, revenue." },
  { q: "Can I keep my existing number?", a: "Yes — this is an additional business line. Your personal number stays private. Put the new number on your website, ads, and Google Business listing so customers reach the AI safety net, not your voicemail." },
  { q: "What happens when I answer the call?", a: "Nothing extra — it's a normal phone call. The AI only kicks in when you don't pick up after 20 seconds." },
  { q: "Basic vs Pro — what's the real difference?", a: "Basic: customer calls, you miss it, AI texts them a QuickQuote link. Pro: customer calls, you miss it, AI picks up and has a real conversation — gets their name, vehicle, service, urgency — then texts the quote link AND books the install slot. Basic captures leads. Pro closes them." },
  { q: "Will customers know it's AI?", a: "Pro AI introduces itself as 'the front desk' — friendly, not deceptive. Most callers can't tell. The transcripts read like a competent receptionist took the call." },
  { q: "Can I upgrade from Basic to Pro later?", a: "Yes — switch tiers anytime from the dashboard. The AI receptionist activates instantly on your existing number." },
  { q: "Can I cancel anytime?", a: "Yes, monthly billing with no contract. Cancel from your dashboard." },
];

export default function NeverMissALead() {
  const [showModal, setShowModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"basic" | "pro">("pro");
  const [areaCode, setAreaCode] = useState("");
  const [forwardingPhone, setForwardingPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { toast } = useToast();
  const userTier = useUserTier();
  const hasActivePlan = userTier !== "free";

  // ROI calculator state
  const [missedPerWeek, setMissedPerWeek] = useState(8);
  const [avgTicket, setAvgTicket] = useState(3000);
  const [closeRate, setCloseRate] = useState(20);
  const recoveredPerMonth = (missedPerWeek * 4 * (closeRate / 100));
  const recoveredRevenue = Math.round(recoveredPerMonth * avgTicket);

  const handleCheckout = async () => {
    if (!forwardingPhone) {
      toast({ title: "Enter your cell number", description: "We need to know where to forward calls.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-nml-checkout", {
        body: { areaCode, forwardingPhone, tier: selectedTier },
      });
      if (error) throw error;
      if (data?.error === "subscription_required") {
        toast({
          title: "DesignProAI plan required",
          description: data.message || "Pick a plan first, then come back to add NML.",
          variant: "destructive",
        });
        setShowModal(false);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "Failed to create checkout");
      }
    } catch (err: any) {
      toast({ title: "Checkout error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Hero — lead with the pain, not the feature ─────────────── */}
      <section className="relative overflow-hidden pt-20 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-purple-500/10" />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-6">
            <Phone className="w-3.5 h-3.5" /> DesignProAI Add-On
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            Stop losing wraps to your voicemail.
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-3">
            27% of calls to small wrap shops go unanswered. At a $3,000 average ticket and a 1-in-5 close rate,
            every 5 missed calls = <span className="text-cyan-300 font-bold">$3,000 in lost revenue</span>.
          </p>
          <p className="text-base text-white/50 max-w-2xl mx-auto mb-8">
            Never Miss a Lead is an add-on for active DesignProAI shops. Miss a call? Basic auto-texts the customer
            your QuickQuote link. Pro picks up the phone and books the job for you.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:brightness-110 text-white font-bold px-8 text-base"
              onClick={() => { setSelectedTier("pro"); setShowModal(true); }}
            >
              Add Pro — $99/mo
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 font-bold px-8 text-base"
              onClick={() => { setSelectedTier("basic"); setShowModal(true); }}
            >
              Add Basic — $49/mo
            </Button>
          </div>
          {!hasActivePlan && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <Lock className="w-3 h-3" />
              <span>Requires an active DesignProAI plan ·</span>
              <Link to="/pricing" className="font-semibold underline hover:text-amber-200">
                See plans
              </Link>
            </div>
          )}
          <p className="text-xs text-white/40 mt-3">
            Add to your existing plan · No contract · Cancel anytime
          </p>
        </div>
      </section>

      {/* ── ROI Calculator — show the math ──────────────────────────── */}
      <section className="py-12 px-4 border-t border-white/5 bg-white/[0.02]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Calculator className="w-3 h-3" /> Run your numbers
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">
              How much is your voicemail costing you?
            </h2>
            <p className="text-sm text-white/50 mt-2">
              Slide the inputs to your shop's reality.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            <div className="grid sm:grid-cols-3 gap-6 mb-8">
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Missed calls / week
                </Label>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={missedPerWeek}
                  onChange={(e) => setMissedPerWeek(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">{missedPerWeek}</div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Avg wrap ticket
                </Label>
                <input
                  type="range"
                  min={500}
                  max={10000}
                  step={250}
                  value={avgTicket}
                  onChange={(e) => setAvgTicket(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">${avgTicket.toLocaleString()}</div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Quote → close rate
                </Label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={closeRate}
                  onChange={(e) => setCloseRate(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">{closeRate}%</div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-6 grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-white/40 mb-1">
                  Revenue you could recover / month
                </p>
                <p className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                  ${recoveredRevenue.toLocaleString()}
                </p>
                <p className="text-xs text-white/50 mt-1">
                  {recoveredPerMonth.toFixed(1)} extra wraps booked
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[11px] uppercase tracking-wider text-white/40 mb-1">
                  NML Pro add-on / month
                </p>
                <p className="text-3xl sm:text-4xl font-bold text-white/80">$99</p>
                <p className="text-xs text-emerald-300 mt-1 font-semibold">
                  {recoveredRevenue > 99
                    ? `${Math.round(recoveredRevenue / 99)}× ROI on the add-on`
                    : "Even one recovered wrap pays for it"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works — Basic vs Pro comparison ──────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2">What happens when you miss a call</h2>
          <p className="text-sm text-white/50 text-center mb-10">
            Two tiers, two outcomes. Both stop the lead from disappearing.
          </p>
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Basic — auto-text mockup */}
            <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-500/5 to-transparent p-6">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-5 h-5 text-cyan-400" />
                <h3 className="text-lg font-bold">Basic — Auto-Text Quote Link</h3>
              </div>
              <p className="text-xs text-white/50 mb-5">
                Caller hears voicemail → gets a text within 4 seconds.
              </p>
              <div className="rounded-xl bg-black/40 border border-white/10 p-4 space-y-2">
                {SAMPLE_AUTOTEXT.map((m, i) => (
                  <div key={i} className={cn("flex", m.from === "shop" ? "justify-start" : "justify-end")}>
                    <div className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug",
                      m.from === "shop" ? "bg-white/10 text-white" : "bg-cyan-500 text-black font-medium",
                    )}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/40 mt-4">
                Lead lands in your dashboard, gets tagged hot if they click the link.
              </p>
            </div>

            {/* Pro — AI receptionist transcript */}
            <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-b from-purple-500/8 to-transparent p-6 relative">
              <div className="absolute -top-3 left-6">
                <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold uppercase tracking-wider">
                  Most popular
                </span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Mic className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-bold">Pro — AI Picks Up the Phone</h3>
              </div>
              <p className="text-xs text-white/50 mb-5">
                Real conversation. Gets vehicle, service, urgency, name. Books the slot.
              </p>
              <div className="rounded-xl bg-black/40 border border-white/10 p-4 space-y-2.5">
                {SAMPLE_AI_TRANSCRIPT.map((m, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className={cn(
                      "shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider mt-0.5",
                      m.who === "AI" ? "bg-purple-500/20 text-purple-300" : "bg-white/10 text-white/70",
                    )}>
                      {m.who}
                    </span>
                    <p className="text-[13px] text-white/85 leading-snug">{m.text}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/40 mt-4">
                Structured lead drops into your dashboard with the full transcript.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Everything you get ──────────────────────────────────────── */}
      <section className="py-16 px-4 bg-white/[0.02] border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Everything Included</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Phone, title: "Dedicated local number", desc: "Pick your area code. Customers see a local line — your personal cell stays private." },
              { icon: Smartphone, title: "Rings your cell first", desc: "Calls forward straight to you for 20 seconds. AI only kicks in if you don't pick up." },
              { icon: Bot, title: "AI voicemail → structured lead", desc: "Voicemails are transcribed in seconds. Vehicle info, service, name, urgency auto-parsed." },
              { icon: MessageSquare, title: "Branded QuickQuote auto-text", desc: "Customer gets your shop's QuickQuote link the moment they hang up. They price the wrap while you're in the bay." },
              { icon: Wand2, title: "Lives inside your dashboard", desc: "Every lead, transcript, text, and conversion shows up in DesignProAI. No second tool to log into." },
              { icon: Shield, title: "No contract, no setup", desc: "Live in under 60 seconds after checkout. Cancel anytime from the dashboard." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <f.icon className="w-5 h-5 text-cyan-400 mb-3" />
                <h3 className="font-bold mb-1 text-[15px]">{f.title}</h3>
                <p className="text-sm text-white/55 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two-Tier Pricing ────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2">Pick your add-on</h2>
        <p className="text-sm text-white/50 text-center mb-10">
          Both tiers add a dedicated number + lead capture to your existing DesignProAI plan.
        </p>
        <div className="max-w-3xl mx-auto grid sm:grid-cols-2 gap-6">
          {/* Basic */}
          <div className={cn(
            "rounded-2xl border p-8 transition-all cursor-pointer",
            selectedTier === "basic"
              ? "border-cyan-500/60 bg-gradient-to-b from-cyan-500/10 to-transparent"
              : "border-white/10 bg-white/[0.02] hover:border-white/20",
          )} onClick={() => setSelectedTier("basic")}>
            <h3 className="text-lg font-bold mb-1">NML Basic</h3>
            <p className="text-sm text-white/40 mb-4">Voicemail-to-text + auto-quote link</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-4xl font-bold">$49</span>
              <span className="text-white/40">/mo add-on</span>
            </div>
            <p className="text-[11px] text-cyan-300 mb-6">Less than a tank of gas. Pays for itself the first wrap.</p>
            <ul className="space-y-2 mb-6">
              {[
                "Dedicated local business number",
                "AI voicemail transcription",
                "Auto-text with QuickQuote link",
                "Lead capture in DesignProAI dashboard",
                "Inbound + outbound SMS",
                "Call forwarding to your cell",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                  <span className="text-white/70">{item}</span>
                </li>
              ))}
            </ul>
            <Button
              size="lg"
              className={cn("w-full font-bold", selectedTier === "basic"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                : "bg-white/10 text-white/60 hover:bg-white/15")}
              onClick={(e) => { e.stopPropagation(); setSelectedTier("basic"); setShowModal(true); }}
            >
              Get Started
            </Button>
          </div>

          {/* Pro */}
          <div className={cn(
            "rounded-2xl border p-8 relative transition-all cursor-pointer",
            selectedTier === "pro"
              ? "border-purple-500/60 bg-gradient-to-b from-purple-500/10 to-transparent"
              : "border-white/10 bg-white/[0.02] hover:border-white/20",
          )} onClick={() => setSelectedTier("pro")}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="px-3 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold">
                MOST POPULAR
              </span>
            </div>
            <h3 className="text-lg font-bold mb-1">NML Pro</h3>
            <p className="text-sm text-purple-300 mb-4">AI receptionist that closes for you</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-4xl font-bold">$99</span>
              <span className="text-white/40">/mo add-on</span>
            </div>
            <p className="text-[11px] text-purple-300 mb-6">~$3/day for a 24/7 front desk</p>
            <ul className="space-y-2 mb-6">
              {[
                "Everything in Basic",
                "AI picks up missed calls",
                "Real conversation — not voicemail",
                "Captures name, vehicle, service, urgency",
                "Books the install slot in the same call",
                "Full transcript saved to lead record",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                  <span className="text-white/80">{item}</span>
                </li>
              ))}
            </ul>
            <Button
              size="lg"
              className={cn("w-full font-bold", selectedTier === "pro"
                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                : "bg-white/10 text-white/60 hover:bg-white/15")}
              onClick={(e) => { e.stopPropagation(); setSelectedTier("pro"); setShowModal(true); }}
            >
              Get Started
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5 bg-white/[0.02]">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">FAQ</h2>
          <div className="space-y-2">
            {FAQ.map((f, i) => (
              <div key={i} className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left font-medium hover:bg-white/5 transition"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm">{f.q}</span>
                  <ChevronDown className={`w-4 h-4 text-white/40 transition-transform shrink-0 ml-3 ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-3 text-sm text-white/60 leading-relaxed">{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <Sparkles className="w-8 h-8 text-cyan-400 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            Your next missed call is happening right now.
          </h2>
          <p className="text-white/55 mb-6">
            Be live in 60 seconds. Pick a number, point it at your cell, and stop bleeding leads to voicemail.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold px-8"
              onClick={() => { setSelectedTier("pro"); setShowModal(true); }}
            >
              Add NML Pro — $99/mo
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 text-white/70 hover:bg-white/5 font-bold px-8"
              onClick={() => { setSelectedTier("basic"); setShowModal(true); }}
            >
              Add Basic — $49/mo
            </Button>
          </div>
          {!hasActivePlan && (
            <p className="text-xs text-amber-300/80 mt-4">
              Need a plan first? <Link to="/pricing" className="underline hover:text-amber-200">See DesignProAI pricing →</Link>
            </p>
          )}
        </div>
      </section>

      {/* ── Checkout Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="bg-[#1c1c1e] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-1">Set Up Your Lead Line</h3>
            <p className="text-sm text-white/50 mb-4">
              {selectedTier === "pro" ? "NML Pro — AI Receptionist" : "NML Basic — Voicemail + Auto-Text"} · ${selectedTier === "pro" ? "99" : "49"}/mo add-on
            </p>
            {!hasActivePlan && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200 flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  NML is an add-on for active DesignProAI shops. <Link to="/pricing" className="underline font-semibold">Pick a plan</Link> first, then come back.
                </span>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-white/60">Your cell number (calls forward here)</Label>
                <Input
                  placeholder="+1 (555) 123-4567"
                  value={forwardingPhone}
                  onChange={(e) => setForwardingPhone(e.target.value)}
                  className="bg-black/50 border-white/20 mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-white/60">Preferred area code (optional)</Label>
                <Input
                  placeholder="305"
                  maxLength={3}
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-black/50 border-white/20 mt-1"
                />
              </div>
              <Button
                className={cn("w-full font-bold", selectedTier === "pro"
                  ? "bg-gradient-to-r from-purple-500 to-pink-500"
                  : "bg-gradient-to-r from-cyan-500 to-blue-600")}
                onClick={handleCheckout}
                disabled={loading}
              >
                {loading ? "Redirecting to checkout..." : `Continue to Payment — $${selectedTier === "pro" ? "99" : "49"}/mo`}
              </Button>
              <button
                className="w-full text-sm text-white/40 hover:text-white/60 transition"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Spacer ──────────────────────────────────────────────────── */}
      <div className="h-px bg-white/5">
        {/* Hidden — keeps Zap import legal */}
        <Zap className="hidden" />
      </div>
    </div>
  );
}
