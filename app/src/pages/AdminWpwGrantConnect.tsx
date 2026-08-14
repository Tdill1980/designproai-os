/**
 * /admin/wpw-grant-connect — Manual WPW Connect Portal enrollment.
 *
 * Used when a customer's DesignProAI email ≠ their WPW WooCommerce
 * email so auto-link (useAutoLinkWpw) can't find them. Admin pastes
 * the DesignProAI email + WPW customer ID, hits Grant, and the
 * admin-grant-wpw-connect edge function sets woo_customer_id and
 * runs the 3-token grant idempotently.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type Result =
  | {
      kind: "success";
      user_id: string;
      user_email: string;
      woo_customer_id: number;
      token_grant: "applied" | "already_granted_prior";
      new_balance: number;
    }
  | { kind: "error"; message: string };

export default function AdminWpwGrantConnect() {
  const [email, setEmail] = useState("");
  const [wooId, setWooId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setResult(null);

    const normalizedEmail = email.trim().toLowerCase();
    const wooCustomerId = Number(wooId);

    if (!normalizedEmail || !Number.isFinite(wooCustomerId) || wooCustomerId <= 0) {
      setResult({
        kind: "error",
        message: "Provide a valid email and a numeric WPW customer ID.",
      });
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-grant-wpw-connect",
        {
          body: {
            user_email: normalizedEmail,
            woo_customer_id: wooCustomerId,
            note: note.trim(),
          },
        },
      );
      if (error) throw new Error(error.message || "invocation_failed");
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const payload = data as Extract<Result, { kind: "success" }>;
      setResult({ ...payload, kind: "success" });
      // Clear form on success so the rep can immediately do the next grant.
      setEmail("");
      setWooId("");
      setNote("");
    } catch (e) {
      setResult({
        kind: "error",
        message: (e as Error).message || "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0d] text-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs text-white/55 hover:text-white mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to admin
        </Link>

        <div className="rounded-2xl border border-white/10 bg-[#101018] p-6 sm:p-8 mb-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300 mb-2">
            WPW Connect Portal
          </div>
          <h1 className="font-montserrat text-2xl sm:text-3xl font-bold mb-2">
            Manual grant
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            Use this when a customer signed up at DesignProAI with a different
            email than their WPW order email — auto-link can&apos;t catch them.
            Paste the DesignProAI email and the WooCommerce customer ID and
            we&apos;ll set <code className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[11px]">woo_customer_id</code>
            {" "}on their subscription and credit the 3 free tokens ($75 retail
            value). Idempotent — re-running on the same user does not
            double-grant.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-[#101018] p-6 sm:p-8 space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-white/70">
              DesignProAI email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              placeholder="shop@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-[#1a1a22] border-white/15 focus-visible:border-cyan-500/50"
            />
            <p className="text-[11px] text-white/45">
              The email they used to sign up at restyleproai.com.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wooId" className="text-xs font-semibold uppercase tracking-wide text-white/70">
              WPW WooCommerce customer ID
            </Label>
            <Input
              id="wooId"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="12345"
              value={wooId}
              onChange={(e) => setWooId(e.target.value)}
              required
              className="bg-[#1a1a22] border-white/15 focus-visible:border-cyan-500/50"
            />
            <p className="text-[11px] text-white/45">
              From the WordPress admin → WooCommerce → Customers list. The
              numeric ID, not their order number.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-xs font-semibold uppercase tracking-wide text-white/70">
              Note (optional)
            </Label>
            <Textarea
              id="note"
              rows={2}
              maxLength={280}
              placeholder="e.g. customer called in, gave us new email"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-[#1a1a22] border-white/15 focus-visible:border-cyan-500/50 resize-none"
            />
            <p className="text-[11px] text-white/45">
              Stored on the token_transactions row for audit. 280 chars max.
            </p>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:brightness-110 text-white font-semibold"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Granting Connect…
              </>
            ) : (
              "Grant WPW Connect + 3 tokens"
            )}
          </Button>
        </form>

        {result?.kind === "success" && (
          <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed">
                <div className="font-semibold text-white mb-1">
                  Connect granted to {result.user_email}
                </div>
                <ul className="space-y-1 text-white/75 text-[13px]">
                  <li>woo_customer_id linked: <strong className="text-white">{result.woo_customer_id}</strong></li>
                  <li>Tokens: <strong className="text-white">{result.token_grant === "applied" ? "+3 granted" : "already granted previously — no change"}</strong></li>
                  <li>Current balance: <strong className="text-white">{result.new_balance}</strong></li>
                </ul>
                <p className="mt-3 text-[12px] text-white/55">
                  Customer should hard-refresh their dashboard to see the new balance.
                </p>
              </div>
            </div>
          </div>
        )}

        {result?.kind === "error" && (
          <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed">
                <div className="font-semibold text-white mb-1">Grant failed</div>
                <code className="text-[12px] text-white/75 break-words">
                  {result.message}
                </code>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
