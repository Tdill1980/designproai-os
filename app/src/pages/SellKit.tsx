/**
 * /sell-kit — One-stop sales kit for team members.
 *
 * Auto-personalized by the logged-in user's email. Gives WPW reps
 * (and any other team account) everything they need to drop the
 * $25 single-design link into a customer reply in 5 seconds:
 *
 *   - Their personal ?ref link with a giant Copy button
 *   - QR code (screenshot for print, business cards, walk-ins)
 *   - 3 pre-written email reply templates, one-click copy
 *   - Email signature HTML snippet (paste into Gmail signature settings)
 *   - Live sales stats: count + dollars from their ?ref to date
 *
 * Pairs with /try-design and the create-guest-design-checkout edge
 * function. The token grant in stripe-webhook stamps the ref into
 * token_transactions.reason as `guest_single_design_purchase:<session>:<ref>`,
 * which this page queries for the stats panel.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, QrCode, DollarSign, Send, Mail, Link2 } from "lucide-react";
import { toast } from "sonner";

const SITE_ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "https://designproai.com";

// Known team roster — used to pretty-print the rep name + show "team" badge.
const TEAM_NAMES: Record<string, string> = {
  "troy@weprintwraps.com": "Troy",
  "lance@weprintwraps.com": "Lance",
  "brice@weprintwraps.com": "Brice",
};

// Slug derived from email local-part: troy@... → "troy"
const slugFromEmail = (email: string) =>
  email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);

// 5-second copy-to-clipboard with toast
const useCopy = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast.error("Couldn't copy — try selecting + copying manually");
    }
  };
  return { copiedKey, copy };
};

const SellKit = () => {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email?.toLowerCase() || null);
      setLoading(false);
    })();
  }, []);

  const slug = email ? slugFromEmail(email) : "";
  const repName = email
    ? TEAM_NAMES[email] || email.split("@")[0].replace(/^\w/, (c) => c.toUpperCase())
    : "";
  const isWpwTeam = email ? email in TEAM_NAMES : false;

  const personalLink = useMemo(
    () => `${SITE_ORIGIN}/try-design?ref=${slug}`,
    [slug],
  );

  // QR code via free public service — no extra deps.
  const qrUrl = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&data=${encodeURIComponent(
        personalLink,
      )}`,
    [personalLink],
  );

  // Sales + commission: query affiliate_transactions joined on partner.
  // The partner is matched via referral_code that contains the rep's slug
  // (case-insensitive — handles both "TROY" and "WPW-TROY" patterns).
  const { data: stats } = useQuery({
    queryKey: ["sell-kit-stats", slug, email],
    enabled: !!slug && !!email,
    queryFn: async () => {
      // 1. Find the partner by email (most reliable for the team).
      const { data: partner } = await (supabase as any)
        .from("affiliate_partners")
        .select("id, referral_code, commission_rate")
        .eq("email", email)
        .maybeSingle();

      if (!partner) {
        return {
          salesCount: 0,
          grossDollars: 0,
          commissionDollars: 0,
          pendingDollars: 0,
          paidDollars: 0,
          recent: [] as any[],
        };
      }

      // 2. Pull all their transactions.
      const { data: txs, error } = await (supabase as any)
        .from("affiliate_transactions")
        .select(
          "id, customer_email, invoice_amount_cents, commission_amount_cents, payout_status, is_initial_payment, created_at",
        )
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[sell-kit stats] query failed:", error);
        return {
          salesCount: 0,
          grossDollars: 0,
          commissionDollars: 0,
          pendingDollars: 0,
          paidDollars: 0,
          recent: [] as any[],
        };
      }

      const rows = txs || [];
      const salesCount = rows.length;
      const grossDollars =
        rows.reduce((acc: number, r: any) => acc + (r.invoice_amount_cents || 0), 0) / 100;
      const commissionDollars =
        rows.reduce((acc: number, r: any) => acc + (r.commission_amount_cents || 0), 0) / 100;
      const pendingDollars =
        rows
          .filter((r: any) => r.payout_status === "pending")
          .reduce((acc: number, r: any) => acc + (r.commission_amount_cents || 0), 0) /
        100;
      const paidDollars =
        rows
          .filter((r: any) => r.payout_status === "paid")
          .reduce((acc: number, r: any) => acc + (r.commission_amount_cents || 0), 0) /
        100;

      return {
        salesCount,
        grossDollars,
        commissionDollars,
        pendingDollars,
        paidDollars,
        recent: rows.slice(0, 5),
      };
    },
  });

  const { copiedKey, copy } = useCopy();

  const TEMPLATES = useMemo(
    () => [
      {
        key: "quote-request",
        label: "Reply: customer asked for a quote",
        body: `Hey — happy to price that out. I use DesignProAI's quote tool to keep it fast and accurate, and you can try it yourself if you want a head start:

Get one custom wrap design + 2 revisions + 6-view 3D proof for $25 (no signup):
${personalLink}

Drop in your vehicle + the look you want, I'll see the design on my end and we'll line up the install.

— ${repName}
WePrintWraps`,
      },
      {
        key: "design-request",
        label: "Reply: customer wants to see a design first",
        body: `Hey — totally, before we lock in a quote let's see the design on your vehicle. Easiest way:

$25 gets you 1 AI-rendered design + 2 free revisions + a 6-view 3D proof, delivered to your inbox in minutes. No signup, no subscription:
${personalLink}

Once you've got the proof, send it back and I'll quote the install.

— ${repName}
WePrintWraps`,
      },
      {
        key: "warm-followup",
        label: "Warm follow-up to an old lead",
        body: `Quick one — we just rolled out a tool that lets you see your wrap design on your actual vehicle before you commit. $25 for a full 6-view 3D proof, no signup:

${personalLink}

Worth a look if you're still thinking about the project. Holler if any questions.

— ${repName}
WePrintWraps`,
      },
    ],
    [personalLink, repName],
  );

  const signatureHtml = useMemo(
    () => `<table cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#222;">
  <tr><td style="padding-bottom:4px;"><strong>${repName}</strong> · WePrintWraps</td></tr>
  <tr><td style="padding-bottom:4px;color:#555;">Want to see your wrap before you buy? <a href="${personalLink}" style="color:#0099cc;">Get a $25 AI design proof</a> — no signup.</td></tr>
</table>`,
    [personalLink, repName],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        Loading…
      </div>
    );
  }

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <Card className="max-w-md">
          <CardContent className="p-6">
            <p className="mb-4">You need to be signed in to view your Sell Kit.</p>
            <Button asChild>
              <a href="/login?next=/sell-kit">Sign in</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Sell Kit — DesignProAI</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                {repName}'s Sell Kit
              </h1>
              {isWpwTeam && (
                <Badge className="bg-[#00C7FF] text-black hover:bg-[#00C7FF]">
                  WPW Team
                </Badge>
              )}
            </div>
            <p className="text-sm text-white/60">
              Everything you need to turn an email reply into a $25 sale.
            </p>
          </div>

          {/* Top row: link + QR + stats */}
          <div className="grid lg:grid-cols-3 gap-4 mb-8">
            {/* Personal link */}
            <Card className="lg:col-span-2 bg-white/[0.03] border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="w-4 h-4 text-[#00C7FF]" />
                  Your personal link
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={personalLink}
                    className="h-12 font-mono text-sm bg-black/40 border-white/15"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    onClick={() => copy(personalLink, "link", "Link")}
                    className="h-12 bg-[#00C7FF] hover:bg-[#00b3e6] text-black font-semibold px-5"
                  >
                    {copiedKey === "link" ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-white/55">
                  Paste this into any email, text, or DM. Every sale through this link
                  is credited to you.
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/15 text-white hover:bg-white/5"
                    asChild
                  >
                    <a
                      href={`sms:?&body=${encodeURIComponent(
                        `Get a $25 wrap design proof, no signup: ${personalLink}`,
                      )}`}
                    >
                      Text it
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/15 text-white hover:bg-white/5"
                    asChild
                  >
                    <a
                      href={`mailto:?subject=${encodeURIComponent(
                        "Custom wrap design for your vehicle",
                      )}&body=${encodeURIComponent(
                        `Hey — get a $25 AI-rendered wrap design on your vehicle, no signup:\n\n${personalLink}\n\n— ${repName}`,
                      )}`}
                    >
                      Email it
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/15 text-white hover:bg-white/5"
                    onClick={() => window.open(personalLink, "_blank")}
                  >
                    Preview
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card className="bg-white/[0.03] border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Your commission
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-white/55">Sales</p>
                    <p className="text-3xl font-bold">{stats?.salesCount ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/55">Earned</p>
                    <p className="text-3xl font-bold text-emerald-400">
                      ${stats?.commissionDollars?.toFixed(2) ?? "0.00"}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded bg-amber-500/10 px-2 py-1.5">
                    <p className="text-amber-300/70 text-[10px] uppercase tracking-wider">
                      Pending
                    </p>
                    <p className="text-amber-200 font-semibold">
                      ${stats?.pendingDollars?.toFixed(2) ?? "0.00"}
                    </p>
                  </div>
                  <div className="rounded bg-emerald-500/10 px-2 py-1.5">
                    <p className="text-emerald-300/70 text-[10px] uppercase tracking-wider">
                      Paid
                    </p>
                    <p className="text-emerald-200 font-semibold">
                      ${stats?.paidDollars?.toFixed(2) ?? "0.00"}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-white/40 mt-3 leading-relaxed">
                  20% on every $25 design + first month of any subscription sold
                  through your link. Single-payout — no MRR commission.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* QR + Email templates */}
          <div className="grid lg:grid-cols-3 gap-4 mb-8">
            <Card className="bg-white/[0.03] border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode className="w-4 h-4 text-[#00C7FF]" />
                  QR code
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="bg-white p-2 rounded-lg">
                  <img
                    src={qrUrl}
                    alt={`QR code for ${personalLink}`}
                    width={240}
                    height={240}
                    loading="lazy"
                  />
                </div>
                <p className="text-xs text-white/55 text-center">
                  Screenshot for business cards, signs, or walk-up customers.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 bg-white/[0.03] border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="w-4 h-4 text-[#00C7FF]" />
                  Email reply templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={TEMPLATES[0].key}>
                  <TabsList className="bg-black/40 mb-3">
                    {TEMPLATES.map((t) => (
                      <TabsTrigger key={t.key} value={t.key} className="text-xs">
                        {t.label.replace("Reply: ", "").replace(/^./, (c) => c.toUpperCase())}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {TEMPLATES.map((t) => (
                    <TabsContent key={t.key} value={t.key} className="space-y-2">
                      <Textarea
                        readOnly
                        value={t.body}
                        rows={10}
                        className="font-mono text-xs bg-black/40 border-white/15 resize-none"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        onClick={() => copy(t.body, t.key, "Reply")}
                        className="bg-[#00C7FF] hover:bg-[#00b3e6] text-black font-semibold"
                      >
                        {copiedKey === t.key ? (
                          <>
                            <Check className="w-4 h-4 mr-2" /> Copied — paste into your reply
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-2" /> Copy this reply
                          </>
                        )}
                      </Button>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Email signature */}
          <Card className="bg-white/[0.03] border-white/10 mb-8">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="w-4 h-4 text-[#00C7FF]" />
                Email signature snippet
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-white/60">
                Paste this into Gmail Settings → General → Signature. Every email you
                send promotes your link automatically.
              </p>
              <div
                className="rounded-md border border-white/15 bg-white text-black p-4"
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
              <Button
                onClick={() => copy(signatureHtml, "sig", "Signature HTML")}
                variant="outline"
                className="border-white/15 text-white hover:bg-white/5"
              >
                {copiedKey === "sig" ? (
                  <>
                    <Check className="w-4 h-4 mr-2" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" /> Copy signature HTML
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* How it works recap */}
          <Card className="bg-[#00C7FF]/5 border-[#00C7FF]/20">
            <CardContent className="p-5">
              <p className="text-xs font-bold tracking-wider uppercase text-[#00C7FF] mb-2">
                How it works
              </p>
              <ol className="text-sm text-white/80 space-y-1.5 list-decimal pl-5">
                <li>You paste your link in an email/text reply.</li>
                <li>Customer pays $25 on your branded landing page.</li>
                <li>They get a magic-link email — opens the AI designer with 1 credit.</li>
                <li>You see the sale in the "Your sales" card above and on the admin Team Usage page.</li>
              </ol>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  );
};

export default SellKit;
