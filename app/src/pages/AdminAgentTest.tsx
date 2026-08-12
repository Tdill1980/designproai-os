/**
 * AdminAgentTest — review page for the Agent UI Test System's output.
 *
 * The harness (scripts/agent-ui-test/agent-ui-test.mjs) generates real designs
 * through the front UI as the founder test account. This page lists every
 * design that account has produced — hero render, master artboards, 2D proof,
 * and per-side production panels — with one-click links into Design Assets.
 *
 * Internal admin tooling (dark theme). Route: /admin/agent-test
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FlaskConical } from "lucide-react";

// The generic founder test account the harness runs as (see
// scripts/agent-ui-test/README.md).
const TEST_ACCOUNT_ID = "2e728f19-e872-4060-a441-eee03d34799f";
const TEST_ACCOUNT_EMAIL = "founder.test@restyleproai.com";

interface GenRow {
  id: string;
  created_at: string | null;
  mode: string;
  raw_prompt: string | null;
  company_name: string | null;
  vehicle_year: string | number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  hero_render_url: string | null;
  master_artboard_url: string | null;
  master_artboard_clean_url: string | null;
  flat_proof_url: string | null;
  render_urls: Record<string, string> | null;
}

interface PanelRow {
  job_id: string;
  side: string;
  background_url: string | null;
  dimensions_inches: { w?: number; h?: number; dpi?: number } | null;
}

const AdminAgentTest = () => {
  const { data: gens = [], isLoading } = useQuery({
    queryKey: ["agent-test-generations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("designiq_generations")
        .select(
          "id, created_at, mode, raw_prompt, company_name, vehicle_year, vehicle_make, vehicle_model, hero_render_url, master_artboard_url, master_artboard_clean_url, flat_proof_url, render_urls"
        )
        .eq("user_id", TEST_ACCOUNT_ID)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data || []) as GenRow[];
    },
  });

  const { data: panels = [] } = useQuery({
    queryKey: ["agent-test-panels", gens.map((g) => g.id).join(",")],
    enabled: gens.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_flow_assets")
        .select("job_id, side, background_url, dimensions_inches")
        .in("job_id", gens.map((g) => g.id));
      if (error) throw error;
      return (data || []) as PanelRow[];
    },
  });

  const panelsFor = (gid: string) => panels.filter((p) => p.job_id === gid);
  const heroFor = (g: GenRow) =>
    g.hero_render_url || g.render_urls?.side || g.master_artboard_url || null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Agent Test System — Design Review</h1>
            <p className="text-sm text-muted-foreground">
              Designs generated through the front UI by the autonomous harness
              (test account: {TEST_ACCOUNT_EMAIL}). Run it with{" "}
              <code className="text-xs">node scripts/agent-ui-test/agent-ui-test.mjs</code>.
            </p>
          </div>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading test designs…</p>}
        {!isLoading && gens.length === 0 && (
          <Card>
            <CardContent className="py-8 text-muted-foreground">
              No test-account designs visible. If RLS hides other users' rows for
              your role, log in as {TEST_ACCOUNT_EMAIL} to review, or open a
              design directly via /design-assets/&lt;generationId&gt;.
            </CardContent>
          </Card>
        )}

        {gens.map((g) => {
          const gPanels = panelsFor(g.id);
          const hero = heroFor(g);
          return (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span>
                    {g.company_name ||
                      `${g.vehicle_year ?? ""} ${g.vehicle_make ?? ""} ${g.vehicle_model ?? ""}`.trim() ||
                      g.id.slice(0, 8)}
                  </span>
                  <Badge variant="outline">{g.mode}</Badge>
                  {gPanels.length > 0 && (
                    <Badge>{gPanels.length} print panel{gPanels.length === 1 ? "" : "s"}</Badge>
                  )}
                  <span className="text-xs text-muted-foreground font-normal ml-auto">
                    {g.created_at ? new Date(g.created_at).toLocaleString() : ""}
                  </span>
                  <Link
                    to={`/design-assets/${g.id}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Design Assets <ExternalLink className="h-3 w-3" />
                  </Link>
                </CardTitle>
                {g.raw_prompt && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{g.raw_prompt}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {hero && (
                    <a href={hero} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={hero} alt="hero" className="h-36 rounded-md border" loading="lazy" />
                      <p className="text-[10px] text-muted-foreground mt-1">Hero render</p>
                    </a>
                  )}
                  {g.flat_proof_url && (
                    <a href={g.flat_proof_url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={g.flat_proof_url} alt="2D proof" className="h-36 rounded-md border" loading="lazy" />
                      <p className="text-[10px] text-muted-foreground mt-1">2D proof</p>
                    </a>
                  )}
                  {g.master_artboard_url && (
                    <a href={g.master_artboard_url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={g.master_artboard_url} alt="master artboard" className="h-36 rounded-md border" loading="lazy" />
                      <p className="text-[10px] text-muted-foreground mt-1">Master artboard (branded)</p>
                    </a>
                  )}
                  {g.master_artboard_clean_url && (
                    <a href={g.master_artboard_clean_url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={g.master_artboard_clean_url} alt="clean artboard" className="h-36 rounded-md border" loading="lazy" />
                      <p className="text-[10px] text-muted-foreground mt-1">Clean artboard</p>
                    </a>
                  )}
                  {gPanels.map((p) => (
                    <a key={p.side} href={p.background_url || "#"} target="_blank" rel="noreferrer" className="shrink-0">
                      {p.background_url && (
                        <img src={p.background_url} alt={p.side} className="h-36 rounded-md border" loading="lazy" />
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {p.side}
                        {p.dimensions_inches?.w ? ` — ${p.dimensions_inches.w}″×${p.dimensions_inches.h}″` : ""}
                      </p>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdminAgentTest;
