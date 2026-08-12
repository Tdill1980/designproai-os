import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Loader2, ExternalLink } from "lucide-react";

interface KeywordRow {
  id: string;
  keyword: string;
  target_url: string | null;
  current_position: number | null;
  current_clicks: number | null;
  current_impressions: number | null;
  ctr: number | null;
  last_seen_at: string | null;
}

export default function AdminSeoKeywords() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const keywords = useQuery({
    queryKey: ["seo-keywords", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<KeywordRow[]> => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("seo_keywords")
        .select(
          "id, keyword, target_url, current_position, current_clicks, current_impressions, ctr, last_seen_at",
        )
        .eq("shop_id", currentShop.id)
        .order("current_position", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as KeywordRow[];
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke("seo-google-search-console", {
        body: { action: "sync_keywords", shop_id: currentShop.id, days: 28 },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { synced: number; total_returned: number };
    },
    onSuccess: (d) => {
      toast({ title: `Synced ${d.synced} keywords from Search Console` });
      qc.invalidateQueries({ queryKey: ["seo-keywords", currentShop?.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to view keywords.</p>
      </div>
    );
  }

  const rows = keywords.data ?? [];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Keyword rankings</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Pulled from Google Search Console — top 100 queries for this shop's site over the
                last 28 days.
              </p>
            </div>
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Sync now
          </Button>
        </div>

        <Card className="bg-zinc-950 border-zinc-800">
          {keywords.isLoading ? (
            <div className="p-12 text-center text-zinc-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              No keywords yet. Connect Search Console in{" "}
              <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
                /admin/seo/connections
              </Link>
              , then click <strong>Sync now</strong>.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Keyword</TableHead>
                  <TableHead className="text-zinc-400 w-24 text-right">Position</TableHead>
                  <TableHead className="text-zinc-400 w-20 text-right">Clicks</TableHead>
                  <TableHead className="text-zinc-400 w-24 text-right">Impr.</TableHead>
                  <TableHead className="text-zinc-400 w-16 text-right">CTR</TableHead>
                  <TableHead className="text-zinc-400">Top page</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="border-zinc-800">
                    <TableCell className="font-medium">{r.keyword}</TableCell>
                    <TableCell className="text-right">
                      <span className={positionColor(r.current_position)}>
                        {r.current_position !== null ? r.current_position.toFixed(1) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.current_clicks ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-400">
                      {r.current_impressions ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-400">
                      {r.ctr !== null ? `${(r.ctr * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      {r.target_url ? (
                        <a
                          href={r.target_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-zinc-400 hover:text-cyan-400 inline-flex items-center gap-1 truncate"
                        >
                          <span className="truncate">{shortPath(r.target_url)}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function positionColor(pos: number | null): string {
  if (pos === null) return "text-zinc-500";
  if (pos <= 3) return "text-emerald-400 font-semibold";
  if (pos <= 10) return "text-cyan-400";
  if (pos <= 20) return "text-amber-400";
  return "text-zinc-400";
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
