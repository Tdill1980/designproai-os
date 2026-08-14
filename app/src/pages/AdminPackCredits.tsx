import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Gift, RefreshCw, Ticket, Copy } from "lucide-react";
import { format } from "date-fns";

interface CreditGrant {
  id: string;
  user_id: string;
  total_credits: number;
  used_credits: number;
  reason: string | null;
  created_at: string | null;
}

interface RedeemCode {
  id: string;
  code: string;
  credits_per_redemption: number;
  max_redemptions: number;
  redemption_count: number;
  reason: string | null;
  active: boolean;
  expires_at: string | null;
  created_at: string | null;
}

const AdminPackCredits = () => {
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("1");
  const [reason, setReason] = useState("");
  const [granting, setGranting] = useState(false);
  const [grants, setGrants] = useState<CreditGrant[]>([]);
  const [loading, setLoading] = useState(true);

  // Redeemable codes
  const [codeCredits, setCodeCredits] = useState("1");
  const [codeMaxRedemptions, setCodeMaxRedemptions] = useState("1");
  const [codeCustom, setCodeCustom] = useState("");
  const [codeReason, setCodeReason] = useState("");
  const [creatingCode, setCreatingCode] = useState(false);
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);

  const loadGrants = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("production_pack_credits" as any)
      .select("id, user_id, total_credits, used_credits, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(`Failed to load grants: ${error.message}`);
    } else {
      setGrants((data as any[]) || []);
    }
    setLoading(false);
  };

  const loadCodes = async () => {
    setLoadingCodes(true);
    const { data, error } = await supabase
      .from("production_pack_redeem_codes" as any)
      .select("id, code, credits_per_redemption, max_redemptions, redemption_count, reason, active, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(`Failed to load codes: ${error.message}`);
    } else {
      setCodes((data as any[]) || []);
    }
    setLoadingCodes(false);
  };

  useEffect(() => {
    loadGrants();
    loadCodes();
  }, []);

  const handleCreateCode = async () => {
    const credits = parseInt(codeCredits, 10);
    const maxR = parseInt(codeMaxRedemptions, 10);
    if (!Number.isFinite(credits) || credits <= 0) {
      toast.error("Packs per redemption must be a positive number.");
      return;
    }
    if (!Number.isFinite(maxR) || maxR <= 0) {
      toast.error("Max redemptions must be a positive number.");
      return;
    }
    setCreatingCode(true);
    const { data, error } = await supabase.rpc("create_pack_redeem_code" as any, {
      p_credits: credits,
      p_max_redemptions: maxR,
      p_code: codeCustom.trim() || null,
      p_reason: codeReason.trim() || null,
    } as any);
    setCreatingCode(false);
    if (error) {
      toast.error(error.message || "Could not create code.");
      return;
    }
    const created = (data as string) || codeCustom.trim().toUpperCase();
    toast.success(`Code created: ${created}`);
    try {
      await navigator.clipboard.writeText(created);
      toast.success("Copied to clipboard.");
    } catch { /* clipboard may be blocked — code is still shown in the list */ }
    setCodeCredits("1");
    setCodeMaxRedemptions("1");
    setCodeCustom("");
    setCodeReason("");
    loadCodes();
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Copy failed — select the code manually.");
    }
  };

  const handleGrant = async () => {
    const count = parseInt(credits, 10);
    if (!email.trim()) {
      toast.error("Enter the user's email.");
      return;
    }
    if (!Number.isFinite(count) || count <= 0) {
      toast.error("Enter a positive number of packs.");
      return;
    }
    setGranting(true);
    const { error } = await supabase.rpc("grant_production_pack_credits" as any, {
      p_email: email.trim(),
      p_credits: count,
      p_reason: reason.trim() || null,
    } as any);
    setGranting(false);
    if (error) {
      toast.error(error.message || "Grant failed.");
      return;
    }
    toast.success(`Granted ${count} comp pack${count === 1 ? "" : "s"} to ${email.trim()}.`);
    setEmail("");
    setCredits("1");
    setReason("");
    loadGrants();
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500">
          <Gift className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Comp Production Packs</h1>
          <p className="text-muted-foreground text-sm">
            Grant a user free DesignPanelPro production packs that bypass their subscription tier.
          </p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Grant comp packs</CardTitle>
          <CardDescription>
            Each comp pack lets the user generate one production pack regardless of tier.
            Credits are consumed one at a time and never expire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="email">User email</Label>
            <Input
              id="email"
              type="email"
              placeholder="xavier@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex gap-4">
            <div className="w-32">
              <Label htmlFor="credits">Packs</Label>
              <Input
                id="credits"
                type="number"
                min={1}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                placeholder="Onboarding comp"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={handleGrant} disabled={granting} className="w-full">
            {granting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
            Grant comp packs
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Ticket className="h-5 w-5 text-cyan-500" />
            Redeemable codes
          </CardTitle>
          <CardDescription>
            Mint a shareable code (e.g. <span className="font-mono">XAVIER-PACK</span>) instead of granting
            by email. Hand the code to anyone — they paste it into the production-pack screen to unlock
            free packs. Each person can redeem a given code once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="w-32">
              <Label htmlFor="codeCredits">Packs each</Label>
              <Input
                id="codeCredits"
                type="number"
                min={1}
                value={codeCredits}
                onChange={(e) => setCodeCredits(e.target.value)}
              />
            </div>
            <div className="w-32">
              <Label htmlFor="codeMax">Max uses</Label>
              <Input
                id="codeMax"
                type="number"
                min={1}
                value={codeMaxRedemptions}
                onChange={(e) => setCodeMaxRedemptions(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="codeCustom">Custom code (optional)</Label>
              <Input
                id="codeCustom"
                placeholder="leave blank to auto-generate"
                value={codeCustom}
                onChange={(e) => setCodeCustom(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="codeReason">Reason (optional)</Label>
            <Input
              id="codeReason"
              placeholder="Xavier onboarding"
              value={codeReason}
              onChange={(e) => setCodeReason(e.target.value)}
            />
          </div>
          <Button onClick={handleCreateCode} disabled={creatingCode} className="w-full">
            {creatingCode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ticket className="mr-2 h-4 w-4" />}
            Create redeem code
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Active codes</h2>
        <Button variant="ghost" size="sm" onClick={loadCodes} disabled={loadingCodes}>
          <RefreshCw className={`h-4 w-4 ${loadingCodes ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card className="mb-8">
        <CardContent className="p-0">
          {loadingCodes ? (
            <div className="p-6 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : codes.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No redeem codes yet.</div>
          ) : (
            <div className="divide-y">
              {codes.map((c) => {
                const expired = c.expires_at && new Date(c.expires_at) < new Date();
                const exhausted = c.redemption_count >= c.max_redemptions;
                const usable = c.active && !expired && !exhausted;
                return (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <button
                        onClick={() => copyCode(c.code)}
                        className="font-mono font-semibold inline-flex items-center gap-1.5 hover:text-cyan-500"
                        title="Copy code"
                      >
                        {c.code}
                        <Copy className="h-3.5 w-3.5 opacity-60" />
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {c.credits_per_redemption} pack{c.credits_per_redemption === 1 ? "" : "s"} per redemption
                        {c.reason ? ` · ${c.reason}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${usable ? "" : "text-muted-foreground"}`}>
                        {usable ? "Active" : exhausted ? "Used up" : expired ? "Expired" : "Inactive"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.redemption_count}/{c.max_redemptions} redeemed
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent grants</h2>
        <Button variant="ghost" size="sm" onClick={loadGrants} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : grants.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No comp packs granted yet.</div>
          ) : (
            <div className="divide-y">
              {grants.map((g) => {
                const remaining = Math.max(0, g.total_credits - g.used_credits);
                return (
                  <div key={g.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{g.user_id}</div>
                      {g.reason && <div className="text-muted-foreground">{g.reason}</div>}
                      <div className="text-xs text-muted-foreground">
                        {g.created_at ? format(new Date(g.created_at), "MMM d, yyyy") : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{remaining} left</div>
                      <div className="text-xs text-muted-foreground">
                        {g.used_credits}/{g.total_credits} used
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminPackCredits;
