import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";

type SocialProvider = "linkedin" | "x";

type CanvaStatus = {
  connected: boolean;
  display_name?: string | null;
  autofill_ready?: boolean;
  missing_autofill_scopes?: string[];
  error?: string;
};

type SocialStatus = {
  ok: boolean;
  configured: boolean;
  connected: boolean;
  connection?: {
    display_name?: string | null;
    site_url?: string | null;
    metadata?: Record<string, unknown> | null;
    last_error?: string | null;
  } | null;
  error?: string;
};

const PROVIDER_DIRECTORY = [
  { id: "meta", label: "Meta + Ads Manager", className: "bg-[#1877F2] text-white", state: "Connect / manage above" },
  { id: "youtube", label: "YouTube", className: "bg-[#FF0000] text-white", state: "Connect / manage above" },
  { id: "canva", label: "Canva", className: "bg-gradient-to-r from-[#00C4CC] to-[#7D2AE8] text-white", state: "OAuth" },
  { id: "klaviyo", label: "Klaviyo", className: "bg-[#B8FF5A] text-black", state: "Server credential" },
  { id: "linkedin", label: "LinkedIn", className: "bg-[#0A66C2] text-white", state: "OAuth" },
  { id: "x", label: "X", className: "bg-black text-white", state: "OAuth" },
  { id: "pinterest", label: "Pinterest", className: "bg-[#E60023] text-white", state: "Connector required" },
] as const;

function StateBadge({ connected, label }: { connected: boolean; label?: string }) {
  return connected
    ? <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">{label || "Connected"}</Badge>
    : <Badge variant="secondary" className="text-[10px]">Not connected</Badge>;
}

function AppCard({
  id,
  title,
  note,
  connected,
  connectedLabel,
  detail,
  accentClass,
  mark,
  children,
}: {
  id: string;
  title: string;
  note: string;
  connected: boolean;
  connectedLabel?: string;
  detail?: React.ReactNode;
  accentClass: string;
  mark: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className={`h-1.5 w-full ${accentClass}`} />
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black ${accentClass}`}>
                {mark}
              </div>
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  {title}
                  <StateBadge connected={connected} label={connectedLabel} />
                </div>
                <div className="mt-0.5 text-xs text-gray-500">{note}</div>
              </div>
            </div>
            {detail && <div className="mt-2 pl-10 text-xs text-gray-600">{detail}</div>}
          </div>
          <div className="shrink-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

function useSocialStatus(provider: SocialProvider) {
  const { currentShop, isShopAdmin } = useOrganization();
  return useQuery({
    queryKey: ["connections-social", currentShop?.id, provider],
    enabled: !!currentShop?.id && !!isShopAdmin,
    queryFn: async (): Promise<SocialStatus> => {
      if (!currentShop) return { ok: false, configured: false, connected: false };
      const { data, error } = await supabase.functions.invoke("social-oauth", {
        body: { action: "status", provider, shop_id: currentShop.id },
      });
      if (error) return { ok: false, configured: false, connected: false, error: error.message };
      return data as SocialStatus;
    },
  });
}

export default function ConnectionsExternalApps() {
  const { currentShop, isShopAdmin } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const linkedin = useSocialStatus("linkedin");
  const x = useSocialStatus("x");
  /** Canva rejected the full scope set on the last attempt — see the effect below. */
  const [canvaScopeRejected, setCanvaScopeRejected] = useState(false);

  useEffect(() => {
    const connected = params.get("social_connected");
    const error = params.get("social_error");
    if (connected) {
      toast({ title: `${connected === "x" ? "X" : "LinkedIn"} connected` });
      qc.invalidateQueries({ queryKey: ["connections-social", currentShop?.id, connected] });
    }
    if (error) toast({ title: "Social connection failed", description: error, variant: "destructive" });

    // CANVA COMES BACK THE SAME WAY. The callback used to render its own HTML
    // page, but the Supabase gateway refuses to serve function-generated HTML
    // from *.supabase.co — it rewrites the response to text/plain, so the
    // owner got a wall of raw markup on a supabase.co URL with no way back.
    // It now 302s here with the outcome on the query string, and this is where
    // that outcome becomes something a person can read.
    const canvaOk = params.get("canva_connected");
    const canvaErr = params.get("canva_error");
    if (canvaOk) {
      toast({ title: "Canva connected" });
      qc.invalidateQueries({ queryKey: ["connections-canva-status"] });
    }
    if (canvaErr) {
      toast({ title: "Canva connection failed", description: canvaErr, variant: "destructive" });
      // A TOAST IS NOT A NEXT MOVE. `invalid_scope` was hit on 2026-07-28,
      // 2026-08-07 and 2026-08-11 — five orphaned OAuth states, zero
      // integrations ever stored — and each time the page said only that it
      // failed, so the same button was the only thing left to press. Remember
      // the rejection so the card can offer the narrower ask, which is the one
      // action that can actually succeed while the portal checkboxes are
      // unticked. Held in state, not persisted: this is set on the mount the
      // bounce-back causes, which is exactly when it is needed.
      if (/invalid_scope/i.test(canvaErr)) setCanvaScopeRejected(true);
    }

    if (connected || error || canvaOk || canvaErr) {
      const next = new URLSearchParams(params);
      next.delete("social_connected");
      next.delete("social_error");
      next.delete("canva_connected");
      next.delete("canva_error");
      setParams(next, { replace: true });
    }
  }, [currentShop?.id, params, qc, setParams, toast]);

  const canva = useQuery({
    queryKey: ["connections-canva-status"],
    queryFn: async (): Promise<CanvaStatus> => {
      const { data, error } = await supabase.functions.invoke("canva-status", { body: {} });
      if (error) return { connected: false, error: error.message };
      return (data || { connected: false }) as CanvaStatus;
    },
  });

  /**
   * `minimal` drops the three AUTOFILL scopes and asks for the core three only.
   *
   * Offered as a FALLBACK, never as the default — see `_shared/canva-scopes.ts`
   * for why that distinction is load-bearing. `invalid_scope` at the authorize
   * step means a scope is not ticked on in the Canva Developer Portal, which is
   * an owner-side checkbox; a previous session read it as an Enterprise plan
   * ceiling and permanently deleted the scopes from the request, which is
   * "why the design engine could never work". Narrowing the ask is a way to get
   * a usable connection TONIGHT, not a diagnosis and not a fix.
   *
   * What a minimal connect buys: listing designs, reading folders, exporting to
   * PNG/MP4. What it does not: brand-template autofill, which needs all three
   * of brandtemplate:meta:read, brandtemplate:content:read and
   * design:content:write. `canva-status` already reports `autofill_ready:false`
   * for such a token, and the card above already renders "needs expanded
   * scopes" — so a partial connection announces itself rather than looking
   * complete and failing on the first design call.
   */
  const connectCanva = useMutation({
    mutationFn: async (minimal: boolean = false) => {
      const { data, error } = await supabase.functions.invoke("canva-oauth-init", {
        body: { redirect_to: "/admin/seo/connections#canva", minimal },
      });
      if (error) throw error;
      const payload = data as { authorize_url?: string; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.authorize_url) throw new Error("Canva OAuth did not return a login URL.");
      return payload.authorize_url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (e: Error) => toast({ title: "Could not connect Canva", description: e.message, variant: "destructive" }),
  });

  const disconnectCanva = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("canva-disconnect", { body: {} });
      if (error) throw error;
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Canva disconnected" });
      qc.invalidateQueries({ queryKey: ["connections-canva-status"] });
    },
  });

  const klaviyo = useQuery({
    queryKey: ["connections-klaviyo-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("klaviyo-build-email", {
        body: { action: "audiences" },
      });
      if (error) return { connected: false, error: error.message };
      const payload = data as { error?: string; lists?: unknown[] } | null;
      return {
        connected: !payload?.error,
        error: payload?.error || null,
        audienceCount: Array.isArray(payload?.lists) ? payload!.lists!.length : null,
      };
    },
    staleTime: 5 * 60_000,
  });

  const connectSocial = useMutation({
    mutationFn: async (provider: SocialProvider) => {
      if (!currentShop) throw new Error("Select a shop first.");
      if (!isShopAdmin) throw new Error("Shop admin access is required.");
      const { data, error } = await supabase.functions.invoke("social-oauth", {
        body: { action: "init", provider, shop_id: currentShop.id, return_to: `/admin/seo/connections#${provider}` },
      });
      if (error) throw error;
      const payload = data as { auth_url?: string; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.auth_url) throw new Error(`${provider === "x" ? "X" : "LinkedIn"} OAuth did not return a login URL.`);
      return payload.auth_url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (e: Error) => toast({ title: "Could not start social OAuth", description: e.message, variant: "destructive" }),
  });

  const disconnectSocial = useMutation({
    mutationFn: async (provider: SocialProvider) => {
      if (!currentShop) throw new Error("Select a shop first.");
      const { data, error } = await supabase.functions.invoke("social-oauth", {
        body: { action: "disconnect", provider, shop_id: currentShop.id },
      });
      if (error) throw error;
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      return provider;
    },
    onSuccess: (provider) => {
      toast({ title: `${provider === "x" ? "X" : "LinkedIn"} disconnected` });
      qc.invalidateQueries({ queryKey: ["connections-social", currentShop?.id, provider] });
    },
  });

  const socialCard = (provider: SocialProvider, query: typeof linkedin) => {
    const isX = provider === "x";
    const label = isX ? "X" : "LinkedIn";
    const status = query.data;
    const connected = status?.connected === true;
    const configured = status?.configured === true;
    const metadata = status?.connection?.metadata || {};
    const readyScope = isX
      ? metadata.member_publish_scope === true
      : metadata.organization_publish_scope === true || metadata.member_publish_scope === true;
    return (
      <AppCard
        id={provider}
        title={label}
        mark={isX ? "X" : "in"}
        accentClass={isX ? "bg-black text-white" : "bg-[#0A66C2] text-white"}
        connected={connected}
        note={isX
          ? "Authorize the X account DesignProAI should operate for this shop."
          : "Authorize the LinkedIn identity/Page DesignProAI should operate for this shop."}
        detail={query.isLoading
          ? "Checking provider setup…"
          : connected
            ? <>{status?.connection?.display_name || label} · publishing permission {readyScope ? "granted" : "not yet granted"}</>
            : configured
              ? "Developer app configured — ready to connect."
              : `${label} developer app credentials still need to be added to the server.`}
      >
        {connected ? (
          <div className="flex items-center gap-1">
            {status?.connection?.site_url && (
              <Button asChild size="sm" variant="outline">
                <a href={status.connection.site_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => connectSocial.mutate(provider)} disabled={!configured || connectSocial.isPending}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => disconnectSocial.mutate(provider)} disabled={disconnectSocial.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => connectSocial.mutate(provider)} disabled={!configured || connectSocial.isPending || query.isLoading}>
            {connectSocial.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {configured ? "Connect" : "App setup required"}
          </Button>
        )}
      </AppCard>
    );
  };

  return (
    <Card className="bg-white border-gray-200 p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">All Connections</h2>
        <p className="mt-1 text-sm text-gray-500">
          One place for every account DesignProAI can operate. Provider color identifies the authority; the status badge tells you whether this shop is actually connected.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {PROVIDER_DIRECTORY.map((provider) => (
          <a
            key={provider.id}
            href={`#${provider.id}`}
            className="rounded-lg border border-gray-200 bg-white p-2.5 transition hover:-translate-y-0.5 hover:shadow-sm"
          >
            <div className={`mb-2 flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-bold ${provider.className}`}>
              {provider.label}
            </div>
            <div className="text-[10px] font-medium text-gray-500">{provider.state}</div>
          </a>
        ))}
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <strong>Meta + Ads Manager and YouTube are in the Connected Apps section directly above.</strong> Canva, Klaviyo, LinkedIn and X are managed below. Pinterest is shown explicitly because it is part of the required channel set, but its OAuth/publisher connector has not been built yet.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AppCard
          id="canva"
          title="Canva"
          mark="C"
          accentClass="bg-gradient-to-r from-[#00C4CC] to-[#7D2AE8] text-white"
          connected={canva.data?.connected === true}
          connectedLabel={canva.data?.connected && canva.data?.autofill_ready === false ? "Reconnect required" : undefined}
          note="Brand templates, editable designs and Brand Board creative generation."
          detail={canva.isLoading
            ? "Checking Canva…"
            : canva.data?.connected
              ? <>{canva.data.display_name || "Canva account"} · autofill {canva.data.autofill_ready ? "ready" : "needs expanded scopes"}</>
              : canvaScopeRejected
                // NAME THE FIX, NOT JUST THE FAULT. `invalid_scope` is an
                // unticked checkbox on the app in the Canva Developer Portal —
                // NOT a plan ceiling, and not something to fix by deleting
                // scopes from the request (that was done once already, and it
                // silently disabled autofill for good; see
                // `_shared/canva-scopes.ts`). The redirect URI is already
                // right, which this very error proves: it came back to us.
                ? (
                  <>
                    Canva rejected the scope set (<code>invalid_scope</code>). Tick all six scopes on this
                    app in the Canva Developer Portal — <code>design:meta:read</code>,{" "}
                    <code>design:content:read</code>, <code>folder:read</code>,{" "}
                    <code>brandtemplate:meta:read</code>, <code>brandtemplate:content:read</code>,{" "}
                    <code>design:content:write</code> — then press Connect again. Or connect without
                    autofill now: designs, folders and PNG/MP4 export work, brand-template autofill
                    does not.
                  </>
                )
                : canva.data?.error || "Not connected"}
        >
          {canva.data?.connected ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => connectCanva.mutate(false)} disabled={connectCanva.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => disconnectCanva.mutate()} disabled={disconnectCanva.isPending}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => connectCanva.mutate(false)} disabled={connectCanva.isPending || canva.isLoading}>
                {connectCanva.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Connect Canva
              </Button>
              {/* ONLY AFTER CANVA HAS ACTUALLY SAID NO. Shown on the bounce-back
                  from an `invalid_scope` rejection, never by default: offering a
                  narrower connect up front would make the degraded one the easy
                  path, and a token without the autofill scopes fails every
                  design call while the card still reads "Connected". */}
              {canvaScopeRejected && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto py-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900"
                  onClick={() => connectCanva.mutate(true)}
                  disabled={connectCanva.isPending}
                >
                  Connect without autofill →
                </Button>
              )}
            </div>
          )}
        </AppCard>

        <AppCard
          id="klaviyo"
          title="Klaviyo"
          mark="K"
          accentClass="bg-[#B8FF5A] text-black"
          connected={klaviyo.data?.connected === true}
          connectedLabel={klaviyo.data?.connected ? "Server connected" : undefined}
          note="Email audiences, templates and draft campaigns."
          detail={klaviyo.isLoading
            ? "Checking Klaviyo…"
            : klaviyo.data?.connected
              ? `${klaviyo.data.audienceCount ?? ""} audience${klaviyo.data.audienceCount === 1 ? "" : "s"} available`.trim()
              : klaviyo.data?.error || "Klaviyo server credential is not available."}
        >
          <Button size="sm" variant="outline" onClick={() => klaviyo.refetch()} disabled={klaviyo.isFetching}>
            {klaviyo.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Verify
          </Button>
        </AppCard>

        {socialCard("linkedin", linkedin)}
        {socialCard("x", x)}

        <AppCard
          id="pinterest"
          title="Pinterest"
          mark="P"
          accentClass="bg-[#E60023] text-white"
          connected={false}
          connectedLabel="Connector required"
          note="Pinterest account authorization and publishing are not wired yet."
          detail="Visible by design so required channels never disappear from the operating system. No fake Connect button is shown until a real OAuth/publisher adapter exists."
        >
          <Button size="sm" variant="outline" disabled>Not configured</Button>
        </AppCard>
      </div>
    </Card>
  );
}
