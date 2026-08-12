import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, AlertTriangle, Database, Terminal, Zap, Palette, Layers, CreditCard, Mail, Shield, Bot, Package } from "lucide-react";
import { Link } from "react-router-dom";

// ── Edge Function Categories ──────────────────────────────────────

const CATEGORIES = [
  {
    id: "render",
    title: "Render Generation",
    icon: Palette,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/30",
    functions: [
      { name: "generate-color-render", desc: "Core render engine — generates photorealistic 3D vehicle wraps via Gemini. Called by ColorPro, FadeWraps, WBTY, GraphicsPro, ApproveMode.", critical: true, troubleshoot: "Supabase → Edge Function Logs → filter 'generate-color-render'. Check for Gemini 500 errors, NO_IMAGE responses, or timeout. Common fix: prompt too long (>6K chars) or Gemini rate limit." },
      { name: "design-panel-ai-generate", desc: "DesignIQ — generates custom wrap designs via Gemini. Called by DesignPro premium.", critical: true, troubleshoot: "Same as generate-color-render. If renders are blurry, check prompt length — must stay under 6K chars. DO NOT add enforcement blocks." },
      { name: "revise-render", desc: "RevisionStudioIQ — single-turn image editing via Gemini. Edits existing renders.", critical: true, troubleshoot: "Check if input render URL is valid/not expired. Look for 'geometry lock' failures in logs." },
      { name: "edit-vehicle-photo", desc: "Edits customer vehicle photos (crop, enhance). Called by vehicle upload flow.", critical: false, troubleshoot: "Check uploaded image size — Gemini has a 20MB limit." },
      { name: "generate-printpro-render", desc: "Product photography renders for PrintPro. Hood detail, close-up views.", critical: false, troubleshoot: "Same as generate-color-render — Gemini-based." },
      { name: "elevate-prompt", desc: "Upgrades short user prompts into designer-quality prompts via Gemini Flash.", critical: false, troubleshoot: "Low priority — if this fails, user just gets their original prompt." },
    ],
  },
  {
    id: "production",
    title: "Production Pipeline (Panelizer)",
    icon: Package,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/30",
    functions: [
      { name: "run-production-flow", desc: "PRODUCTIONFLOW™ orchestrator. State machine that runs one step per invocation. Manages panelizer + QA + upsells.", critical: true, troubleshoot: "Supabase → Table Editor → production_jobs. Check 'status' and 'current_step'. If stuck, check Edge Function Logs for the job_id." },
      { name: "panelizer-os-orchestrator", desc: "GENIE Panelizer — extracts flat 2D panels from 3D renders, then vectorizes to EPS.", critical: true, troubleshoot: "Check production_panels table for per-panel status. If a panel is stuck at 'extracting', check panelizer-extract logs." },
      { name: "panelizer-extract", desc: "Step 1: 3D render → flat 2D panel via Gemini. Mirrors passenger side automatically.", critical: true, troubleshoot: "If output has 3D body lines, this is the GENIE composite issue. Check that few-shot examples exist in wrap-files/genie-examples/ storage bucket." },
      { name: "panelizer-vectorize", desc: "Step 2: Flat panel PNG → production EPS via Vectorizer.AI.", critical: false, troubleshoot: "Check Vectorizer.AI API key is valid. Look for 'vectorization failed' in logs." },
      { name: "panelizer-qc-edit-panel", desc: "Regenerates a single panel via Gemini with edit instructions. Called from QC admin.", critical: false, troubleshoot: "Same as panelizer-extract. Check that the source render URL hasn't expired." },
      { name: "panelizer-qc-upscale", desc: "Upscales panels via Replicate Real-ESRGAN for print resolution.", critical: false, troubleshoot: "Check Replicate API key. Look for timeout errors — upscaling large panels can take 30s+." },
      { name: "generate-production-files", desc: "CMYK TIFF output — deterministic, no AI. Converts panels to print-ready files.", critical: false, troubleshoot: "No AI calls — if this fails, it's a storage or memory issue." },
      { name: "generate-cut-files", desc: "SVG cut files for plotters.", critical: false, troubleshoot: "Check input panel dimensions are valid." },
      { name: "diagnose-panelizer-job", desc: "Diagnostic tool — shows status of all 12 steps and per-panel progress.", critical: false, troubleshoot: "Run this first when debugging production issues. It tells you exactly where things broke." },
    ],
  },
  {
    id: "batch",
    title: "Batch Operations",
    icon: Layers,
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/30",
    functions: [
      { name: "batch-pipeline-executor", desc: "Server-side batch render pipeline. Runs parallel renders independent of browser.", critical: true, troubleshoot: "Supabase → Table Editor → batch_jobs. Check status column. If renders are failing, check generate-color-render logs for the batch_job_id." },
      { name: "generate-batch-prompts", desc: "AI prompt generation for batch rendering. Creates unique wrap design prompts.", critical: false, troubleshoot: "Gemini Flash — check API quota if prompts aren't generating." },
      { name: "batch-auto-tag", desc: "Gemini analysis on untagged design DNA records. Backfill job.", critical: false, troubleshoot: "Rate-limited — if stuck, check Gemini quota." },
    ],
  },
  {
    id: "billing",
    title: "Stripe & Billing",
    icon: CreditCard,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    functions: [
      { name: "create-checkout", desc: "Creates Stripe checkout session for subscriptions.", critical: true, troubleshoot: "Check STRIPE_SECRET_KEY in Supabase → Edge Function Secrets. Verify Stripe dashboard for failed payments." },
      { name: "stripe-webhook", desc: "Handles Stripe webhook events — syncs subscription state to DB.", critical: true, troubleshoot: "Supabase → Table Editor → user_subscriptions. If a user paid but shows 'free', check stripe-webhook logs for the event. Verify webhook secret matches Stripe dashboard." },
      { name: "create-billing-portal", desc: "Stripe billing portal for subscription management.", critical: false, troubleshoot: "If portal link fails, check Stripe customer_id in user_subscriptions table." },
      { name: "affiliate-stripe-connect", desc: "Sets up Stripe Connect for affiliate payouts.", critical: false, troubleshoot: "Check affiliate_partners table for stripe_account_id." },
      { name: "affiliate-process-payouts", desc: "Bi-weekly payout calculations. $10 minimum.", critical: false, troubleshoot: "Check affiliate_commissions table. Verify Stripe Connect account is onboarded." },
    ],
  },
  {
    id: "email",
    title: "Email & Comms",
    icon: Mail,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30",
    functions: [
      { name: "send-templated-email", desc: "Generic templated email sender via Resend.", critical: false, troubleshoot: "Check RESEND_API_KEY in Edge Function Secrets. Check Resend dashboard for bounces/failures." },
      { name: "send-magic-link", desc: "Passwordless login magic link.", critical: true, troubleshoot: "If users aren't getting links, check Supabase Auth → Email Templates and Resend domain verification." },
      { name: "send-design-pack-email", desc: "Design pack download email with signed URL.", critical: false, troubleshoot: "Check that the signed URL hasn't expired (default 1hr)." },
    ],
  },
  {
    id: "admin",
    title: "Admin & Utility",
    icon: Shield,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    functions: [
      { name: "cleanup-renders", desc: "Deletes old/expired render files from storage.", critical: false, troubleshoot: "Check storage bucket quotas in Supabase → Storage." },
      { name: "chat-with-ai", desc: "QC Assistant — Gemini-powered recommendations in QC admin.", critical: false, troubleshoot: "Gemini API — check quota." },
      { name: "grant-admin-access", desc: "Grants admin role to user by email.", critical: false, troubleshoot: "Check user_roles table for the granted role." },
      { name: "trigger-deploy", desc: "Triggers GitHub Actions deployment for edge functions.", critical: false, troubleshoot: "Check GitHub Actions tab for deployment status." },
    ],
  },
  {
    id: "ai",
    title: "AI & Analysis",
    icon: Bot,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    functions: [
      { name: "analyze-panel-design", desc: "Gemini analysis of panel design quality.", critical: false, troubleshoot: "Gemini API — check for content safety blocks." },
      { name: "analyze-vehicle-image", desc: "Extracts vehicle specs from uploaded photo.", critical: false, troubleshoot: "Check uploaded image quality — blurry photos fail analysis." },
      { name: "ai-prompt-auto-fix", desc: "Analyzes render flags and auto-regenerates with improved prompts.", critical: false, troubleshoot: "Check render flags in color_visualizations table." },
      { name: "classify-vehicle-views", desc: "Classifies vehicle photos by camera angle.", critical: false, troubleshoot: "Gemini vision — check image format (must be JPEG/PNG)." },
      { name: "neuralnetwork-embed", desc: "Generates 768-dim embeddings for design similarity search.", critical: false, troubleshoot: "Runs async after renders. If search is broken, check pgvector extension is enabled." },
    ],
  },
];

// ── Supabase Troubleshooting Guide ────────────────────────────────

const SUPA_TABLES = [
  { table: "color_visualizations", desc: "All renders. Check generation_status, render_urls, customer_email.", when: "Render missing, blank gallery, wrong user sees wrong renders." },
  { table: "user_subscriptions", desc: "Subscription tier, Stripe IDs, render counts.", when: "User can't render, wrong tier, 'limit reached' errors." },
  { table: "user_roles", desc: "Admin/tester roles.", when: "User can't access admin pages." },
  { table: "production_jobs", desc: "ProductionFlow job status, current step.", when: "Production stuck, panels not generating." },
  { table: "production_panels", desc: "Per-panel status in production jobs.", when: "Individual panel failed, needs re-extract." },
  { table: "affiliate_partners", desc: "Affiliate accounts, referral codes, Stripe Connect.", when: "Affiliate not getting paid, code not working." },
  { table: "affiliate_commissions", desc: "Commission records, amounts, status.", when: "Missing commission, wrong amount." },
  { table: "batch_jobs", desc: "Batch render job status.", when: "Batch renders stuck or failed." },
  { table: "team_members", desc: "Organization/team membership for render sharing.", when: "User can't see team renders." },
  { table: "moderation_log", desc: "Blocked content attempts.", when: "User says render was 'blocked' or 'refused'." },
];

// ── Claude Code Templates ─────────────────────────────────────────

const CLAUDE_TEMPLATES = [
  {
    title: "Render failing for a user",
    prompt: `A user with email [EMAIL] is getting an error when trying to render in [TOOL: ColorPro/DesignPro/FadeWraps]. The error message is: "[ERROR MESSAGE]". Check the generate-color-render edge function logs and the color_visualizations table for this user's recent renders. Diagnose the root cause.`,
  },
  {
    title: "Production pipeline stuck",
    prompt: `Production job [JOB_ID] is stuck at step "[STEP]". Check the production_jobs and production_panels tables. Run diagnose-panelizer-job to see which panel failed. Fix the issue without modifying locked render pipeline files.`,
  },
  {
    title: "User can't log in / session expired",
    prompt: `User [EMAIL] reports they can't log in or keep getting logged out. Check: 1) Do they exist in Supabase Auth → Users? 2) Is their user_subscriptions record valid? 3) Check the SessionGuard component for any issues with the onAuthStateChange listener.`,
  },
  {
    title: "Subscription not working after payment",
    prompt: `User [EMAIL] paid via Stripe but their account still shows "free" tier. Check: 1) user_subscriptions table for their email 2) stripe-webhook edge function logs for their Stripe customer ID 3) Stripe dashboard for the payment event. Sync the subscription status.`,
  },
  {
    title: "Affiliate commission missing",
    prompt: `Affiliate [NAME/EMAIL] says they didn't get commission for referral [CUSTOMER_EMAIL]. Check: 1) affiliate_partners table for referral_code 2) affiliate_commissions table for the transaction 3) affiliate-track-referral edge function logs. Trace the referral attribution.`,
  },
  {
    title: "Edge function deployment",
    prompt: `Deploy the [FUNCTION_NAME] edge function. Run: npx supabase functions deploy [FUNCTION_NAME] --project-ref kfapjdyythzyvnpdeghu`,
  },
  {
    title: "Team renders not showing",
    prompt: `User [EMAIL] toggled "Team" in RevisionStudioIQ but doesn't see shared renders. Check: 1) team_members table — do they have a row? 2) color_visualizations — do their renders have organization_id set? 3) Run: UPDATE color_visualizations SET organization_id = 'a1b2c3d4-0001-4000-8000-000000000001' WHERE customer_email = '[EMAIL]';`,
  },
];

const AdminOperatorGuide = () => {
  const [search, setSearch] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const filteredCategories = CATEGORIES.map((cat) => ({
    ...cat,
    functions: cat.functions.filter(
      (fn) =>
        fn.name.toLowerCase().includes(search.toLowerCase()) ||
        fn.desc.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.functions.length > 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/admin" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-3xl font-bold">
            <span className="text-white">Operator</span>
            <span className="text-cyan-400">Guide</span>
          </h1>
          <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">
            Jackson — 2nd in Command
          </Badge>
        </div>
        <p className="text-muted-foreground mb-8 ml-8">
          Edge functions, Supabase troubleshooting, and Claude Code templates
        </p>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search edge functions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-zinc-900 border-zinc-700"
          />
        </div>

        {/* ═══ SECTION 1: EDGE FUNCTIONS ═══ */}
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-cyan-400" />
          Edge Functions by Category
        </h2>

        <div className="space-y-4 mb-12">
          {filteredCategories.map((cat) => {
            const Icon = cat.icon;
            const isExpanded = expandedCategory === cat.id;
            return (
              <Card key={cat.id} className={`border ${cat.bg} cursor-pointer`}>
                <CardHeader
                  className="pb-2"
                  onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                >
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${cat.color}`} />
                      <span className="text-lg">{cat.title}</span>
                      <Badge variant="outline" className="text-xs">
                        {cat.functions.length} functions
                      </Badge>
                    </div>
                    <span className="text-muted-foreground text-sm">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                  </CardTitle>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {cat.functions.map((fn) => (
                        <div
                          key={fn.name}
                          className="p-3 rounded-lg bg-background/50 border border-border"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono text-foreground font-bold">
                              {fn.name}
                            </code>
                            {fn.critical && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
                                CRITICAL
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{fn.desc}</p>
                          <div className="p-2 rounded bg-amber-500/5 border border-amber-500/20">
                            <p className="text-xs text-amber-300">
                              <AlertTriangle className="h-3 w-3 inline mr-1" />
                              <strong>Troubleshoot:</strong> {fn.troubleshoot}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        {/* ═══ SECTION 2: SUPABASE TABLES ═══ */}
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Database className="h-5 w-5 text-green-400" />
          Supabase Tables — Where to Look
        </h2>

        <Card className="mb-12 border-green-500/20">
          <CardContent className="pt-6">
            <div className="space-y-3">
              {SUPA_TABLES.map((t) => (
                <div
                  key={t.table}
                  className="flex items-start gap-4 p-3 rounded-lg bg-background/50 border border-border"
                >
                  <code className="text-sm font-mono text-green-400 font-bold whitespace-nowrap min-w-[200px]">
                    {t.table}
                  </code>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.desc}</p>
                    <p className="text-xs text-amber-300 mt-1">
                      <strong>Check when:</strong> {t.when}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ SECTION 3: CLAUDE CODE TEMPLATES ═══ */}
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Terminal className="h-5 w-5 text-purple-400" />
          Claude Code Templates — Copy & Paste
        </h2>
        <p className="text-muted-foreground text-sm mb-4">
          Replace the [BRACKETS] with actual values and paste into Claude Code.
        </p>

        <div className="space-y-4 mb-12">
          {CLAUDE_TEMPLATES.map((t, i) => (
            <Card key={i} className="border-purple-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-purple-300">
                  {t.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-muted-foreground bg-zinc-900 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap border border-zinc-700 font-mono">
                  {t.prompt}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ═══ SECTION 4: QUICK REFERENCE ═══ */}
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          Emergency Quick Reference
        </h2>

        <Card className="border-red-500/20 mb-8">
          <CardContent className="pt-6 space-y-4">
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-sm font-bold text-red-300 mb-1">Renders returning blurry / low quality</p>
              <p className="text-xs text-muted-foreground">Check prompt length in design-panel-ai-generate. Must stay under 6K chars. DO NOT add enforcement blocks. Check CLAUDE.md for locked file rules.</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-sm font-bold text-red-300 mb-1">Flat panels showing 3D body lines</p>
              <p className="text-xs text-muted-foreground">Panels are cut from the artboard by geometry (panel-artboard-generator gridslice). Check the artboard the slice is reading — a faithful crop of a wrong artboard is the usual cause. panelizer-step-fill is retired and no longer wired to any button.</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-sm font-bold text-red-300 mb-1">User locked out / session expired loop</p>
              <p className="text-xs text-muted-foreground">SessionGuard handles this now. If it persists, check Supabase Auth → Users for the account status. Clear sb-*-auth-token from localStorage as last resort.</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-sm font-bold text-red-300 mb-1">Stripe payment succeeded but user still on free tier</p>
              <p className="text-xs text-muted-foreground">Check stripe-webhook logs → find the event by customer email. Then check user_subscriptions table. If row is missing, manually insert with the Stripe IDs from the webhook event.</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-sm font-bold text-amber-300 mb-1">Deploy an edge function</p>
              <p className="text-xs text-muted-foreground font-mono">npx supabase functions deploy [FUNCTION_NAME] --project-ref kfapjdyythzyvnpdeghu</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminOperatorGuide;
