import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { readEdgeError } from "@/lib/edgeError";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import ConnectionsExternalApps from "@/components/admin/ConnectionsExternalApps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Trash2,
  Plug,
  Settings2,
} from "lucide-react";

interface ConnectionRow {
  shop_id: string;
  platform: string;
  display_name: string | null;
  site_url: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

export default function AdminSeoConnections() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    seo_plugin?: string;
    has_woocommerce?: boolean;
  } | null>(null);

  const connections = useQuery({
    queryKey: ["seo-connections", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<ConnectionRow[]> => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("tenant_site_connections")
        .select("shop_id, platform, display_name, site_url, metadata, is_active, last_synced_at, last_error, updated_at")
        .eq("shop_id", currentShop.id)
        .order("platform");
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const wpConnection = (connections.data ?? []).find((c) => c.platform === "wordpress" && c.is_active);

  async function callWpConnect(action: string, body: Record<string, unknown> = {}) {
    if (!currentShop) throw new Error("No shop selected");
    const { data, error } = await supabase.functions.invoke("seo-wp-connect", {
      body: { action, shop_id: currentShop.id, ...body },
    });
    if (error) throw error;
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as Record<string, unknown>;
  }

  const testMutation = useMutation({
    mutationFn: async () => {
      const r = (await callWpConnect("test", {
        site_url: siteUrl,
        username,
        app_password: appPassword,
      })) as { seo_plugin?: string; has_woocommerce?: boolean; site_name?: string };
      return r;
    },
    onSuccess: (r) => {
      setTestResult({
        ok: true,
        message: `Connected to ${r.site_name ?? "site"}`,
        seo_plugin: r.seo_plugin,
        has_woocommerce: r.has_woocommerce,
      });
      toast({ title: "Connection verified" });
    },
    onError: (e: Error) => {
      setTestResult({ ok: false, message: e.message });
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      callWpConnect("save", { site_url: siteUrl, username, app_password: appPassword }),
    onSuccess: () => {
      toast({ title: "WordPress connected", description: "You can now publish to this site." });
      setSiteUrl("");
      setUsername("");
      setAppPassword("");
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ["seo-connections", currentShop?.id] });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => callWpConnect("disconnect"),
    onSuccess: () => {
      toast({ title: "Disconnected" });
      qc.invalidateQueries({ queryKey: ["seo-connections", currentShop?.id] });
    },
    onError: (e: Error) => {
      toast({ title: "Disconnect failed", description: e.message, variant: "destructive" });
    },
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-white text-gray-900 p-8">
        <p>Select a shop to manage connections.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/seo">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Connections</h1>
        </div>
        <p className="text-gray-600 text-sm">
          One control panel for the accounts DesignProAI operates for this shop: website publishing,
          Google services, YouTube, Meta publishing and Ads Manager reporting, Canva, Klaviyo, LinkedIn and X.
          Provider credentials remain server-side and use their existing canonical authority.
        </p>

        {/* WordPress section */}
        <Card className="bg-white border-gray-200 p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Plug className="h-5 w-5 text-cyan-400" /> WordPress
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Required for publishing blog posts. Auth via Application Password
                (Users → Profile → Application Passwords in WP admin).
              </p>
            </div>
            {wpConnection ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Connected</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>

          {wpConnection ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-2">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{wpConnection.display_name ?? wpConnection.site_url}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <a
                      href={wpConnection.site_url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-gray-900 inline-flex items-center gap-1"
                    >
                      {wpConnection.site_url}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Disconnect
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 pt-2 border-t border-gray-200">
                <div>
                  <span className="text-gray-500">SEO plugin: </span>
                  <span className="text-gray-900 capitalize">
                    {String((wpConnection.metadata as Record<string, unknown>)?.seo_plugin ?? "—")}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">WooCommerce: </span>
                  <span className="text-gray-900">
                    {(wpConnection.metadata as Record<string, unknown>)?.has_woocommerce ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="site_url">Site URL</Label>
                  <Input
                    id="site_url"
                    placeholder="https://weprintwraps.com"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="username">WP username</Label>
                  <Input
                    id="username"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="app_password">Application Password</Label>
                <Input
                  id="app_password"
                  type="password"
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  WP shows the password with spaces — paste exactly as shown, we strip spaces server-side.
                </p>
              </div>

              {testResult && (
                <div
                  className={`rounded-md p-3 text-sm flex items-start gap-2 ${
                    testResult.ok
                      ? "bg-emerald-950/50 border border-emerald-900 text-emerald-200"
                      : "bg-red-950/50 border border-red-900 text-red-200"
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div>{testResult.message}</div>
                    {testResult.ok && (
                      <div className="text-xs opacity-80 mt-1">
                        SEO plugin: <strong>{testResult.seo_plugin ?? "none"}</strong> · WooCommerce:{" "}
                        <strong>{testResult.has_woocommerce ? "yes" : "no"}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !siteUrl || !username || !appPassword}
                >
                  {testMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Test connection
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || !siteUrl || !username || !appPassword}
                >
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Connect
                </Button>
              </div>
            </form>
          )}
        </Card>

        <OAuthIntegrationsCard />
        <ConnectionsExternalApps />
      </div>
    </div>
  );
}

// ─── OAuth integrations (Google + YouTube + Meta) ─────────────────────────
type OAuthService =
  | "google_search_console"
  | "google_analytics"
  | "google_business_profile"
  | "google_merchant_center"
  | "youtube"
  | "meta_facebook";

interface OAuthDef {
  service: OAuthService;
  label: string;
  note: string;
  oauthFn: "seo-google-oauth" | "seo-meta-oauth";
}

const OAUTH_INTEGRATIONS: OAuthDef[] = [
  {
    service: "google_search_console",
    label: "Google Search Console",
    note: "Rank tracking + indexing",
    oauthFn: "seo-google-oauth",
  },
  {
    service: "google_analytics",
    label: "Google Analytics 4",
    note: "Traffic + revenue attribution",
    oauthFn: "seo-google-oauth",
  },
  {
    service: "google_business_profile",
    label: "Google Business Profile",
    note: "Reviews, GBP Posts and local insights",
    oauthFn: "seo-google-oauth",
  },
  {
    service: "google_merchant_center",
    label: "Google Merchant Center",
    note: "Shopping listings for ecommerce tenants",
    oauthFn: "seo-google-oauth",
  },
  {
    service: "youtube",
    label: "YouTube",
    note: "Long-form + Shorts publishing, channel management, comments and SocialIQ analytics",
    oauthFn: "seo-google-oauth",
  },
  {
    service: "meta_facebook",
    label: "Meta (Facebook + Instagram + Ads Manager)",
    note: "Facebook + Instagram publishing, ad-account selection and AdsPro performance reporting",
    oauthFn: "seo-meta-oauth",
  },
];

interface MetaConnectionState {
  page_id: string | null;
  page_name: string | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
}

type ConnectionManagerResponse = Partial<MetaConnectionState> & { ok?: boolean };

async function callConnectionManager(
  shopId: string,
  action: "disconnect" | "connection_state",
  service: OAuthService,
): Promise<ConnectionManagerResponse> {
  const { data, error } = await supabase.functions.invoke("seo-google-oauth", {
    body: { action, shop_id: shopId, service },
  });
  if (error) throw error;
  const response = data as ConnectionManagerResponse & { error?: string };
  if (response?.error) throw new Error(response.error);
  return response ?? {};
}

function OAuthIntegrationsCard() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Surface OAuth result toasts on redirect-back.
  useEffect(() => {
    const gc = params.get("google_connected");
    const ge = params.get("google_error");
    const mc = params.get("meta_connected");
    const me = params.get("meta_error");
    if (gc) {
      toast({ title: `Connected: ${gc.replace(/_/g, " ")}` });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", currentShop?.id] });
      qc.invalidateQueries({ queryKey: ["brandboard-youtube-connection", currentShop?.id] });
    }
    if (ge) toast({ title: "Google connect failed", description: ge, variant: "destructive" });
    if (mc) {
      toast({ title: "Meta connected" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", currentShop?.id] });
    }
    if (me) toast({ title: "Meta connect failed", description: me, variant: "destructive" });
    if (gc || ge || mc || me) {
      const next = new URLSearchParams(params);
      ["google_connected", "google_error", "meta_connected", "meta_error"].forEach((k) =>
        next.delete(k),
      );
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const conns = useQuery({
    queryKey: ["seo-oauth-conns", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async () => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("tenant_site_connections")
        .select("platform, display_name, is_active, metadata, last_synced_at")
        .eq("shop_id", currentShop.id)
        .in("platform", OAUTH_INTEGRATIONS.map((i) => i.service));
      if (error) throw error;
      return data ?? [];
    },
  });

  const connect = useMutation({
    mutationFn: async (def: OAuthDef) => {
      if (!currentShop) throw new Error("No shop");
      const body =
        def.oauthFn === "seo-google-oauth"
          ? {
              action: "init",
              shop_id: currentShop.id,
              service: def.service,
              return_to: "/admin/seo/connections",
            }
          : { action: "init", shop_id: currentShop.id, return_to: "/admin/seo/connections" };
      const { data, error } = await supabase.functions.invoke(def.oauthFn, { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const authUrl = (data as { auth_url?: string })?.auth_url;
      if (!authUrl) throw new Error(`${def.label} OAuth did not return a login URL.`);
      return authUrl;
    },
    onSuccess: (auth_url) => {
      window.location.href = auth_url;
    },
    onError: (e: Error) =>
      toast({ title: "Could not start OAuth", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async (service: OAuthService) => {
      if (!currentShop) throw new Error("No shop");
      await callConnectionManager(currentShop.id, "disconnect", service);
    },
    onSuccess: () => {
      toast({ title: "Disconnected" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", currentShop?.id] });
      qc.invalidateQueries({ queryKey: ["brandboard-youtube-connection", currentShop?.id] });
    },
  });

  return (
    <Card className="bg-white border-gray-200 p-6">
      <h2 className="text-lg font-semibold mb-1">Connected Apps</h2>
      <p className="text-sm text-gray-500 mb-4">
        Connect each provider here once for the selected shop. Google services share the Google OAuth client,
        while Meta uses Meta OAuth; every resulting credential stays in the same per-shop connection store.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {OAUTH_INTEGRATIONS.map((def) => {
          const conn = (conns.data ?? []).find(
            (c: { platform: string; is_active: boolean }) =>
              c.platform === def.service && c.is_active,
          ) as
            | {
                platform: string;
                display_name: string | null;
                is_active: boolean;
                metadata: Record<string, unknown>;
              }
            | undefined;
          return (
            <div
              id={def.service === "youtube" ? "youtube" : def.service === "meta_facebook" ? "meta" : undefined}
              key={def.service}
              className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 scroll-mt-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {def.label}
                    {conn && <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">Connected</Badge>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{def.note}</div>
                  {conn?.display_name && (
                    <div className="text-xs text-gray-600 mt-1 truncate">
                      {conn.display_name}
                    </div>
                  )}
                </div>
                {conn ? (
                  <div className="flex items-center gap-1">
                    {(def.service === "youtube" || def.service === "meta_facebook") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => connect.mutate(def)}
                        disabled={connect.isPending}
                      >
                        Reconnect
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => disconnect.mutate(def.service)}
                      disabled={disconnect.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => connect.mutate(def)}
                    disabled={connect.isPending}
                  >
                    {connect.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Connect
                  </Button>
                )}
              </div>
              {conn && currentShop && (
                <ServicePicker
                  service={def.service}
                  shopId={currentShop.id}
                  metadata={conn.metadata ?? {}}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Per-service property / location / page pickers ───────────────────────
function ServicePicker({
  service,
  shopId,
  metadata,
}: {
  service: OAuthService;
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  if (service === "google_search_console") {
    return <SearchConsolePicker shopId={shopId} metadata={metadata} />;
  }
  if (service === "google_analytics") {
    return <AnalyticsPicker shopId={shopId} metadata={metadata} />;
  }
  if (service === "google_business_profile") {
    return <BusinessProfilePicker shopId={shopId} metadata={metadata} />;
  }
  if (service === "youtube") {
    return <YouTubeConnectionSummary metadata={metadata} />;
  }
  if (service === "meta_facebook") {
    return (
      <>
        <MetaPagePicker shopId={shopId} metadata={metadata} />
        <MetaAdAccountPicker shopId={shopId} metadata={metadata} />
      </>
    );
  }
  return null;
}

function PickerShell({
  label,
  current,
  children,
  loading,
  error,
}: {
  label: string;
  current: string | null;
  children: React.ReactNode;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className="border-t border-gray-200 pt-2 mt-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
        <Settings2 className="h-3 w-3" />
        {label}
      </div>
      {error ? (
        <div className="text-xs text-red-400">{error}</div>
      ) : loading ? (
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-600 mb-1.5 truncate">
            Selected: <span className="text-gray-900">{current ?? "(none — pick one)"}</span>
          </div>
          {children}
        </>
      )}
    </div>
  );
}

function YouTubeConnectionSummary({ metadata }: { metadata: Record<string, unknown> }) {
  const channel = String(metadata?.youtube_channel_title || metadata?.youtube_channel_handle || "").trim() || null;
  const management = metadata?.youtube_management_enabled === true;
  const analytics = metadata?.youtube_analytics_enabled === true;
  return (
    <PickerShell label="YouTube channel" current={channel}>
      <div className="text-xs text-gray-500 space-y-1">
        <div>Publishing + channel management: <strong className="text-gray-800">{management ? "enabled" : "reconnect required"}</strong></div>
        <div>SocialIQ YouTube analytics: <strong className="text-gray-800">{analytics ? "enabled" : "reconnect required"}</strong></div>
      </div>
    </PickerShell>
  );
}

function SearchConsolePicker({
  shopId,
  metadata,
}: {
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const selected = (metadata?.selected_site as string) ?? null;
  const sites = useQuery({
    queryKey: ["seo-gsc-sites", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-google-search-console", {
        body: { action: "list_sites", shop_id: shopId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return ((data as { sites?: Array<{ siteUrl: string; permissionLevel?: string }> }).sites ?? []);
    },
  });
  const save = useMutation({
    mutationFn: async (siteUrl: string) => {
      const { data, error } = await supabase.functions.invoke("seo-google-search-console", {
        body: { action: "set_site", shop_id: shopId, site_url: siteUrl },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Search Console site saved" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  return (
    <PickerShell
      label="Search Console site"
      current={selected}
      loading={sites.isLoading}
      error={sites.error instanceof Error ? sites.error.message : null}
    >
      <Select value={selected ?? ""} onValueChange={(v) => save.mutate(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick a site…" />
        </SelectTrigger>
        <SelectContent>
          {(sites.data ?? []).map((s) => (
            <SelectItem key={s.siteUrl} value={s.siteUrl} className="text-xs">
              {s.siteUrl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PickerShell>
  );
}

function AnalyticsPicker({
  shopId,
  metadata,
}: {
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const selected = (metadata?.ga4_property_id as string) ?? null;
  const props = useQuery({
    queryKey: ["seo-ga4-properties", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-google-analytics", {
        body: { action: "list_properties", shop_id: shopId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return ((data as {
        properties?: Array<{ property_id: string; property_name: string; account_name: string }>;
      }).properties ?? []);
    },
  });
  const save = useMutation({
    mutationFn: async (propertyId: string) => {
      const { data, error } = await supabase.functions.invoke("seo-google-analytics", {
        body: { action: "set_property", shop_id: shopId, property_id: propertyId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "GA4 property saved" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const currentLabel = selected
    ? (props.data ?? []).find((p) => p.property_id === selected)?.property_name ?? selected
    : null;
  return (
    <PickerShell
      label="GA4 property"
      current={currentLabel}
      loading={props.isLoading}
      error={props.error instanceof Error ? props.error.message : null}
    >
      <Select value={selected ?? ""} onValueChange={(v) => save.mutate(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick a property…" />
        </SelectTrigger>
        <SelectContent>
          {(props.data ?? []).map((p) => (
            <SelectItem key={p.property_id} value={p.property_id} className="text-xs">
              {p.account_name} → {p.property_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PickerShell>
  );
}

/**
 * Call seo-google-business and fail with the FUNCTION'S reason, not
 * supabase-js's generic "Edge Function returned a non-2xx status code". The
 * function reports Google's real refusal (e.g. "GBP locations 403: …") in a
 * 502 JSON body, which only `readEdgeError` can reach — without this the
 * location picker showed the useless transport string for every failure.
 */
async function invokeGbp<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("seo-google-business", { body });
  if (error) throw new Error((await readEdgeError(error)).reason);
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

interface GbpAccount {
  name: string;
  accountName?: string;
}
interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string };
}

function BusinessProfilePicker({
  shopId,
  metadata,
}: {
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const selectedAccount = (metadata?.gbp_account as string) ?? null;
  const selectedLocation = (metadata?.gbp_location as string) ?? null;
  const selectedDisplay = (metadata?.gbp_display_name as string) ?? null;
  const [accountName, setAccountName] = useState<string | null>(selectedAccount);

  const accounts = useQuery({
    queryKey: ["seo-gbp-accounts", shopId],
    queryFn: async () => {
      const data = await invokeGbp<{ accounts?: GbpAccount[] }>({ action: "list_accounts", shop_id: shopId });
      return data.accounts ?? [];
    },
  });
  const locations = useQuery({
    queryKey: ["seo-gbp-locations", shopId, accountName],
    enabled: !!accountName,
    queryFn: async () => {
      const data = await invokeGbp<{ locations?: GbpLocation[] }>({
        action: "list_locations", shop_id: shopId, account_name: accountName,
      });
      return data.locations ?? [];
    },
  });
  const save = useMutation({
    mutationFn: async (loc: GbpLocation) => {
      if (!accountName) throw new Error("No account selected");
      await invokeGbp({
        action: "set_location",
        shop_id: shopId,
        account_name: accountName,
        location_name: loc.name,
        display_name: loc.title ?? null,
      });
    },
    onSuccess: () => {
      toast({ title: "GBP location saved" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const currentLabel = selectedDisplay
    ?? (selectedLocation && selectedLocation.split("/").pop())
    ?? null;

  const acctErr = accounts.error instanceof Error ? accounts.error.message : null;
  const locErr = locations.error instanceof Error ? locations.error.message : null;

  return (
    <PickerShell
      label="GBP location"
      current={currentLabel}
      loading={accounts.isLoading}
      error={acctErr}
    >
      <div className="space-y-1.5">
        <Select value={accountName ?? ""} onValueChange={(v) => setAccountName(v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick an account…" />
          </SelectTrigger>
          <SelectContent>
            {(accounts.data ?? []).map((a) => (
              <SelectItem key={a.name} value={a.name} className="text-xs">
                {a.accountName ?? a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {accountName && (
          locErr ? (
            <div className="text-xs text-red-400">{locErr}</div>
          ) : (
            <Select
              value={selectedLocation ?? ""}
              onValueChange={(v) => {
                const loc = (locations.data ?? []).find((l) => l.name === v);
                if (loc) save.mutate(loc);
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={locations.isLoading ? "Loading locations…" : "Pick a location…"}
                />
              </SelectTrigger>
              <SelectContent>
                {(locations.data ?? []).map((l) => (
                  <SelectItem key={l.name} value={l.name} className="text-xs">
                    {l.title ?? l.name}
                    {l.storefrontAddress?.locality && ` — ${l.storefrontAddress.locality}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        )}
      </div>
    </PickerShell>
  );
}

interface MetaPage {
  id: string;
  name: string;
  ig_business_id?: string | null;
  ig_username?: string | null;
}

function MetaPagePicker({
  shopId,
  metadata,
}: {
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pages = (metadata?.pages as MetaPage[] | undefined) ?? [];

  // Selection labels come from a shop-admin Edge action. Browser roles never
  // receive the connection's OAuth config or token fields.
  const cfgQuery = useQuery({
    queryKey: ["seo-meta-cfg", shopId],
    queryFn: async () =>
      callConnectionManager(shopId, "connection_state", "meta_facebook"),
  });
  const selectedId = cfgQuery.data?.page_id ?? null;
  const selectedLabel =
    cfgQuery.data?.page_name
      ?? pages.find((p) => p.id === selectedId)?.name
      ?? null;

  const save = useMutation({
    mutationFn: async (pageId: string) => {
      const { data, error } = await supabase.functions.invoke("seo-meta-oauth", {
        body: { action: "choose_page", shop_id: shopId, page_id: pageId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Meta page saved" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", shopId] });
      qc.invalidateQueries({ queryKey: ["seo-meta-cfg", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <PickerShell label="Facebook page" current={selectedLabel} loading={cfgQuery.isLoading}>
      <Select value={selectedId ?? ""} onValueChange={(v) => save.mutate(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick a Page…" />
        </SelectTrigger>
        <SelectContent>
          {pages.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-xs">
              {p.name}
              {p.ig_username && ` (@${p.ig_username})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PickerShell>
  );
}

interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status?: number | null;
  currency?: string | null;
  business_name?: string | null;
}

function MetaAdAccountPicker({
  shopId,
  metadata,
}: {
  shopId: string;
  metadata: Record<string, unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const adAccounts = (metadata?.ad_accounts as MetaAdAccount[] | undefined) ?? [];

  const cfgQuery = useQuery({
    queryKey: ["seo-meta-adaccount-cfg", shopId],
    queryFn: async () =>
      callConnectionManager(shopId, "connection_state", "meta_facebook"),
  });
  const selectedId = cfgQuery.data?.ad_account_id ?? null;
  const selectedLabel =
    cfgQuery.data?.ad_account_name
      ?? adAccounts.find((a) => a.account_id === selectedId)?.name
      ?? selectedId;

  const save = useMutation({
    mutationFn: async (adAccountId: string) => {
      const { data, error } = await supabase.functions.invoke("seo-meta-oauth", {
        body: { action: "choose_adaccount", shop_id: shopId, ad_account_id: adAccountId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Meta Ads Manager account saved" });
      qc.invalidateQueries({ queryKey: ["seo-oauth-conns", shopId] });
      qc.invalidateQueries({ queryKey: ["seo-meta-adaccount-cfg", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <PickerShell label="Ads Manager ad account" current={selectedLabel} loading={cfgQuery.isLoading}>
      {adAccounts.length === 0 ? (
        <div className="text-xs text-gray-500">
          No ad accounts found on this Meta login. Reconnect Meta to grant ads_read access.
        </div>
      ) : (
        <>
          <Select value={selectedId ?? ""} onValueChange={(v) => save.mutate(v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Pick an Ads Manager account…" />
            </SelectTrigger>
            <SelectContent>
              {adAccounts.map((a) => (
                <SelectItem key={a.id} value={a.account_id} className="text-xs">
                  {a.name}
                  {a.business_name && ` — ${a.business_name}`}
                  {a.currency && ` (${a.currency})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-1 text-[10px] text-gray-500">
            This connection powers AdsPro reporting and analysis. Current Meta permission is ads_read; live campaign creation/editing is not enabled by this grant.
          </div>
        </>
      )}
    </PickerShell>
  );
}
