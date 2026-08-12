/**
 * AdminSystemHealth — Live system health dashboard
 *
 * Tests every critical edge function + external integration with a
 * lightweight canary request. Shows pass/fail per component with
 * response time, last-checked timestamp, and error details.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Activity, CheckCircle2, XCircle, Loader2, RefreshCw, Zap,
  Mail, MessageSquare, CreditCard, ShoppingCart, Paintbrush,
  Camera, Image as ImageIcon, Shield, Clock, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ================================================================ */
/* Health Check Definitions                                         */
/* ================================================================ */

interface HealthCheck {
  id: string;
  name: string;
  category: string;
  icon: typeof Activity;
  description: string;
  run: () => Promise<CheckResult>;
}

interface CheckResult {
  status: "pass" | "fail" | "warn";
  ms: number;
  detail?: string;
}

interface CheckState extends CheckResult {
  id: string;
  checkedAt: Date;
}

// Helper: test an edge function with OPTIONS (no auth needed, just checks it's deployed)
async function pingEdgeFunction(name: string): Promise<CheckResult> {
  const url = `https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/${name}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "OPTIONS" });
    const ms = Date.now() - t0;
    if (res.ok) return { status: "pass", ms, detail: `OPTIONS ${res.status}` };
    return { status: "fail", ms, detail: `OPTIONS ${res.status}` };
  } catch (err: any) {
    return { status: "fail", ms: Date.now() - t0, detail: err.message || "Network error" };
  }
}

// Helper: test a Supabase table is readable
async function pingTable(table: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const { error } = await (supabase as any).from(table).select("id").limit(1);
    const ms = Date.now() - t0;
    if (error) return { status: "fail", ms, detail: error.message };
    return { status: "pass", ms, detail: `Table readable` };
  } catch (err: any) {
    return { status: "fail", ms: Date.now() - t0, detail: err.message };
  }
}

const CHECKS: HealthCheck[] = [
  // ── RENDER PIPELINE ──
  { id: "design-panel-ai-generate", name: "DesignPro Render", category: "Render Pipeline", icon: Paintbrush, description: "DesignIQ restyle + commercial mode", run: () => pingEdgeFunction("design-panel-ai-generate") },
  { id: "generate-color-render", name: "ColorPro Render", category: "Render Pipeline", icon: Paintbrush, description: "Color wrap rendering", run: () => pingEdgeFunction("generate-color-render") },
  { id: "generate-pattern-render", name: "PatternPro Render", category: "Render Pipeline", icon: Paintbrush, description: "Pattern deterministic rendering", run: () => pingEdgeFunction("generate-pattern-render") },
  { id: "edit-vehicle-photo", name: "MyVehiclePro", category: "Render Pipeline", icon: Camera, description: "Customer photo editing", run: () => pingEdgeFunction("edit-vehicle-photo") },
  { id: "generate-wall-design", name: "WallPro Render", category: "Render Pipeline", icon: ImageIcon, description: "Wall wrap generation", run: () => pingEdgeFunction("generate-wall-design") },
  { id: "generate-graphics-pro", name: "GraphicsPro", category: "Render Pipeline", icon: Paintbrush, description: "AI graphic elements", run: () => pingEdgeFunction("generate-graphics-pro") },
  { id: "render-motorcycle", name: "Motorcycle Render", category: "Render Pipeline", icon: Paintbrush, description: "Motorcycle-specific rendering", run: () => pingEdgeFunction("render-motorcycle") },
  { id: "render-boat", name: "Boat Render", category: "Render Pipeline", icon: Paintbrush, description: "Boat-specific rendering", run: () => pingEdgeFunction("render-boat") },

  // ── PROOF & APPROVAL ──
  { id: "proof-create", name: "Proof Create", category: "ApprovePro", icon: Shield, description: "Create proof for client", run: () => pingEdgeFunction("proof-create") },
  { id: "proof-send", name: "Proof Send", category: "ApprovePro", icon: Mail, description: "Send proof email to client", run: () => pingEdgeFunction("proof-send") },
  { id: "proof-sign", name: "Proof Sign", category: "ApprovePro", icon: Shield, description: "E-signature processing", run: () => pingEdgeFunction("proof-sign") },
  { id: "proof-request-revision", name: "Proof Revision", category: "ApprovePro", icon: Shield, description: "Client revision request", run: () => pingEdgeFunction("proof-request-revision") },
  { id: "send-client-proof-email", name: "Proof Email", category: "ApprovePro", icon: Mail, description: "Proof notification email (Resend)", run: () => pingEdgeFunction("send-client-proof-email") },
  { id: "generate-approvepro-pdf", name: "Proof PDF", category: "ApprovePro", icon: Shield, description: "PDF generation for approvals", run: () => pingEdgeFunction("generate-approvepro-pdf") },

  // ── EMAIL & SMS (MightyMail) ──
  { id: "send-email-campaign", name: "Email Campaign", category: "MightyMail", icon: Mail, description: "Bulk email campaigns (Resend)", run: () => pingEdgeFunction("send-email-campaign") },
  { id: "send-templated-email", name: "Templated Email", category: "MightyMail", icon: Mail, description: "Single email with merge vars", run: () => pingEdgeFunction("send-templated-email") },
  { id: "send-sms-campaign", name: "SMS Campaign", category: "MightyMail", icon: MessageSquare, description: "SMS delivery (Twilio)", run: () => pingEdgeFunction("send-sms-campaign") },
  { id: "process-scheduled-emails", name: "Scheduled Emails", category: "MightyMail", icon: Clock, description: "Cron: delayed email processing", run: () => pingEdgeFunction("process-scheduled-emails") },
  { id: "process-scheduled-campaigns", name: "Scheduled Campaigns", category: "MightyMail", icon: Clock, description: "Cron: campaign processing", run: () => pingEdgeFunction("process-scheduled-campaigns") },

  // ── QUOTE TOOL ──
  { id: "calculate-film-yards", name: "Film Calculator", category: "Quote Tool", icon: Zap, description: "Film yardage calculation", run: () => pingEdgeFunction("calculate-film-yards") },
  { id: "track-quote-event", name: "Quote Events", category: "Quote Tool", icon: Zap, description: "Quote event tracking", run: () => pingEdgeFunction("track-quote-event") },
  { id: "quote-events-table", name: "Quote Events DB", category: "Quote Tool", icon: Zap, description: "quote_events table readable", run: () => pingTable("quote_events") },
  { id: "quotes-table", name: "Quotes DB", category: "Quote Tool", icon: Zap, description: "quotes table readable", run: () => pingTable("quotes") },

  // ── WEPRINTWRAPS ──
  { id: "wpw-orders-read", name: "WPW Orders Read", category: "WePrintWraps", icon: ShoppingCart, description: "Read WPW order data", run: () => pingEdgeFunction("wpw-orders-read") },
  { id: "wpw-oauth-link", name: "WPW OAuth", category: "WePrintWraps", icon: ShoppingCart, description: "WPW OAuth connection", run: () => pingEdgeFunction("wpw-oauth-link") },
  { id: "wpw-sync-orders", name: "WPW Order Sync", category: "WePrintWraps", icon: ShoppingCart, description: "Order synchronization", run: () => pingEdgeFunction("wpw-sync-orders") },
  { id: "wpw-orders-table", name: "WPW Orders DB", category: "WePrintWraps", icon: ShoppingCart, description: "wpw_orders table readable", run: () => pingTable("wpw_orders") },
  { id: "sync-shop-products-from-woo", name: "Product Sync", category: "WePrintWraps", icon: ShoppingCart, description: "WooCommerce product sync", run: () => pingEdgeFunction("sync-shop-products-from-woo") },

  // ── STRIPE ──
  { id: "create-checkout", name: "Stripe Checkout", category: "Stripe", icon: CreditCard, description: "Subscription checkout", run: () => pingEdgeFunction("create-checkout") },
  { id: "stripe-webhook", name: "Stripe Webhook", category: "Stripe", icon: CreditCard, description: "Payment event handler", run: () => pingEdgeFunction("stripe-webhook") },
  { id: "create-billing-portal", name: "Billing Portal", category: "Stripe", icon: CreditCard, description: "Customer billing management", run: () => pingEdgeFunction("create-billing-portal") },

  // ── ARTBOARD & PRODUCTION ──
  { id: "auto-generate-artboard", name: "Artboard Generator", category: "Production", icon: ImageIcon, description: "Automated artboard creation", run: () => pingEdgeFunction("auto-generate-artboard") },
  { id: "generate-2d-proof", name: "2D Proof Sheet", category: "Production", icon: ImageIcon, description: "2D proof generation", run: () => pingEdgeFunction("generate-2d-proof") },
  { id: "generate-artboard-flat", name: "Flat Artboard", category: "Production", icon: ImageIcon, description: "Flat artboard variant", run: () => pingEdgeFunction("generate-artboard-flat") },
  { id: "panelizer-step-validate", name: "Panelizer Validate", category: "Production", icon: ImageIcon, description: "Panelizer validation step", run: () => pingEdgeFunction("panelizer-step-validate") },

  // ── DATABASE TABLES ──
  { id: "color-viz-table", name: "Renders DB", category: "Database", icon: Activity, description: "color_visualizations table", run: () => pingTable("color_visualizations") },
  { id: "proof-approvals-table", name: "Proofs DB", category: "Database", icon: Activity, description: "proof_approvals table", run: () => pingTable("proof_approvals") },
  { id: "customers-table", name: "Customers DB", category: "Database", icon: Activity, description: "customers table", run: () => pingTable("customers") },
  { id: "wallpro-designs-table", name: "WallPro DB", category: "Database", icon: Activity, description: "wallpro_designs table", run: () => pingTable("wallpro_designs") },

  // ── VEHICLE INTELLIGENCE ──
  { id: "analyze-vehicle-image", name: "Vehicle Analysis", category: "Intelligence", icon: Camera, description: "Gemini vehicle image analysis", run: () => pingEdgeFunction("analyze-vehicle-image") },
  { id: "classify-vehicle-views", name: "View Classifier", category: "Intelligence", icon: Camera, description: "View angle classification", run: () => pingEdgeFunction("classify-vehicle-views") },

  // ── SOCIAL & CANVA ──
  { id: "push-to-instagram", name: "Instagram Push", category: "Social", icon: Activity, description: "Instagram publishing", run: () => pingEdgeFunction("push-to-instagram") },
  { id: "canva-status", name: "Canva Status", category: "Social", icon: Activity, description: "Canva integration check", run: () => pingEdgeFunction("canva-status") },
];

const CATEGORIES = [...new Set(CHECKS.map(c => c.category))];

/* ================================================================ */
/* Main Component                                                   */
/* ================================================================ */

export default function AdminSystemHealth() {
  const [results, setResults] = useState<Record<string, CheckState>>({});
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Send failures to Slack
  const alertSlack = useCallback(async (failedChecks: Array<{ name: string; category: string; detail: string }>) => {
    if (failedChecks.length === 0) return;
    try {
      await supabase.functions.invoke("proof-escalate-support", {
        body: {
          _systemHealthAlert: true,
          text: `🚨 System Health: ${failedChecks.length} component${failedChecks.length > 1 ? "s" : ""} failing`,
          failures: failedChecks.map(f => `• ${f.category} → ${f.name}: ${f.detail}`).join("\n"),
        },
      });
      toast.success("Slack alert sent");
    } catch {
      toast.error("Slack alert failed — check webhook config");
    }
  }, []);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults({});
    let passed = 0;
    let failed = 0;
    const failedChecks: Array<{ name: string; category: string; detail: string }> = [];

    for (const check of CHECKS) {
      setRunningId(check.id);
      try {
        const result = await check.run();
        setResults(prev => ({ ...prev, [check.id]: { ...result, id: check.id, checkedAt: new Date() } }));
        if (result.status === "pass") passed++;
        else {
          failed++;
          failedChecks.push({ name: check.name, category: check.category, detail: result.detail || "Unknown error" });
        }
      } catch (err: any) {
        setResults(prev => ({ ...prev, [check.id]: { status: "fail", ms: 0, detail: err.message, id: check.id, checkedAt: new Date() } }));
        failed++;
        failedChecks.push({ name: check.name, category: check.category, detail: err.message || "Unknown error" });
      }
    }

    setRunningId(null);
    setRunning(false);

    // Auto-alert Slack on any failures
    if (failedChecks.length > 0) {
      await alertSlack(failedChecks);
    }

    toast[failed > 0 ? "error" : "success"](`Health check complete: ${passed} passed, ${failed} failed`);
  }, [alertSlack]);

  const runOne = useCallback(async (check: HealthCheck) => {
    setRunningId(check.id);
    try {
      const result = await check.run();
      setResults(prev => ({ ...prev, [check.id]: { ...result, id: check.id, checkedAt: new Date() } }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, [check.id]: { status: "fail", ms: 0, detail: err.message, id: check.id, checkedAt: new Date() } }));
    }
    setRunningId(null);
  }, []);

  const totalChecked = Object.keys(results).length;
  const totalPassed = Object.values(results).filter(r => r.status === "pass").length;
  const totalFailed = Object.values(results).filter(r => r.status === "fail").length;
  const totalWarn = Object.values(results).filter(r => r.status === "warn").length;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-cyan-400" />
            System Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {CHECKS.length} components across {CATEGORIES.length} categories
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalChecked > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-400 font-semibold">{totalPassed} pass</span>
              {totalFailed > 0 && <span className="text-red-400 font-semibold">{totalFailed} fail</span>}
              {totalWarn > 0 && <span className="text-yellow-400 font-semibold">{totalWarn} warn</span>}
            </div>
          )}
          <Button
            onClick={runAll}
            disabled={running}
            className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {running ? `Checking... (${totalChecked}/${CHECKS.length})` : "Run All Checks"}
          </Button>
        </div>
      </div>

      {/* Category Sections */}
      {CATEGORIES.map(category => {
        const checks = CHECKS.filter(c => c.category === category);
        const catPassed = checks.filter(c => results[c.id]?.status === "pass").length;
        const catFailed = checks.filter(c => results[c.id]?.status === "fail").length;
        const catChecked = checks.filter(c => results[c.id]).length;

        return (
          <Card key={category}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{category}</CardTitle>
                  <CardDescription className="text-xs">{checks.length} components</CardDescription>
                </div>
                {catChecked > 0 && (
                  <div className="flex items-center gap-2">
                    {catFailed > 0 && (
                      <Badge className="bg-red-600 text-[10px]">
                        <XCircle className="h-3 w-3 mr-0.5" /> {catFailed} failed
                      </Badge>
                    )}
                    {catPassed > 0 && catFailed === 0 && (
                      <Badge className="bg-green-600 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-0.5" /> All pass
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {checks.map(check => {
                  const result = results[check.id];
                  const isRunning = runningId === check.id;
                  const Icon = check.icon;

                  return (
                    <div
                      key={check.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer hover:bg-secondary/50",
                        result?.status === "pass" && "border-green-500/30 bg-green-500/5",
                        result?.status === "fail" && "border-red-500/30 bg-red-500/5",
                        result?.status === "warn" && "border-yellow-500/30 bg-yellow-500/5",
                        !result && "border-border",
                        isRunning && "animate-pulse border-cyan-500/50",
                      )}
                      onClick={() => !running && runOne(check)}
                      title={result?.detail || check.description}
                    >
                      {/* Status icon */}
                      <div className="shrink-0">
                        {isRunning ? (
                          <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
                        ) : result?.status === "pass" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400" />
                        ) : result?.status === "fail" ? (
                          <XCircle className="h-4 w-4 text-red-400" />
                        ) : result?.status === "warn" ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        ) : (
                          <Icon className="h-4 w-4 text-muted-foreground/50" />
                        )}
                      </div>

                      {/* Name + detail */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{check.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {result ? (result.status === "fail" ? result.detail : `${result.ms}ms`) : check.description}
                        </p>
                      </div>

                      {/* Response time */}
                      {result && result.status === "pass" && (
                        <span className={cn(
                          "text-[10px] font-mono shrink-0",
                          result.ms < 500 ? "text-green-400" : result.ms < 1000 ? "text-yellow-400" : "text-red-400"
                        )}>
                          {result.ms}ms
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
