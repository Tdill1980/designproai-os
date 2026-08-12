import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Send,
  Upload,
  Trash2,
  CheckCircle2,
  Download,
} from "lucide-react";

type IndexState =
  | "unchecked"
  | "checking"
  | "indexed"
  | "not_indexed"
  | "error"
  | "submitting"
  | "submitted"
  | "submit_error";

interface UrlRow {
  url: string;
  state: IndexState;
  coverage?: string;
  verdict?: string;
  lastCrawled?: string;
  error?: string;
  submittedAt?: string;
}

interface InspectionResult {
  indexStatusResult?: {
    coverageState?: string;
    verdict?: string;
    lastCrawlTime?: string;
  };
}

export default function AdminSeoIndexing() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<UrlRow[]>([]);

  const parsedFromPaste = useMemo(() => {
    return pasted
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [pasted]);

  const addUrls = (urls: string[]) => {
    const seen = new Set(rows.map((r) => r.url));
    const fresh = urls.filter((u) => !seen.has(u));
    if (fresh.length === 0) return;
    setRows((prev) => [
      ...prev,
      ...fresh.map((u) => ({ url: u, state: "unchecked" as IndexState })),
    ]);
  };

  const handleAdd = () => {
    addUrls(parsedFromPaste);
    setPasted("");
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const urls = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    addUrls(urls);
  };

  const removeRow = (url: string) =>
    setRows((prev) => prev.filter((r) => r.url !== url));

  const updateRow = (url: string, patch: Partial<UrlRow>) =>
    setRows((prev) => prev.map((r) => (r.url === url ? { ...r, ...patch } : r)));

  const inspectOne = async (url: string) => {
    if (!currentShop) return;
    updateRow(url, { state: "checking", error: undefined });
    try {
      const { data, error } = await supabase.functions.invoke(
        "seo-google-search-console",
        { body: { action: "inspect_url", shop_id: currentShop.id, url } },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const inspection = (data as { inspection?: InspectionResult }).inspection;
      const idx = inspection?.indexStatusResult;
      const verdict = idx?.verdict ?? "UNKNOWN";
      const coverage = idx?.coverageState ?? "—";
      const isIndexed = verdict === "PASS";
      updateRow(url, {
        state: isIndexed ? "indexed" : "not_indexed",
        verdict,
        coverage,
        lastCrawled: idx?.lastCrawlTime,
      });
    } catch (e) {
      updateRow(url, {
        state: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const submitOne = async (url: string) => {
    if (!currentShop) return;
    updateRow(url, { state: "submitting", error: undefined });
    try {
      const { data, error } = await supabase.functions.invoke(
        "seo-google-search-console",
        {
          body: {
            action: "submit_url",
            shop_id: currentShop.id,
            url,
            type: "URL_UPDATED",
          },
        },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      updateRow(url, {
        state: "submitted",
        submittedAt: new Date().toISOString(),
      });
    } catch (e) {
      updateRow(url, {
        state: "submit_error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const loadSitemap = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke(
        "seo-google-search-console",
        { body: { action: "load_sitemap", shop_id: currentShop.id, limit: 1000 } },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return ((data as { urls: string[] }).urls ?? []) as string[];
    },
    onSuccess: (urls) => {
      addUrls(urls);
      toast({
        title: `Loaded ${urls.length} URL${urls.length === 1 ? "" : "s"} from sitemap`,
        description: "Click Check all, then Request indexing.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Sitemap load failed", description: e.message, variant: "destructive" }),
  });

  const checkAll = useMutation({
    mutationFn: async () => {
      const targets = rows.filter((r) => r.state !== "checking").map((r) => r.url);
      // Sequential to avoid hammering the GSC quota
      for (const url of targets) {
        await inspectOne(url);
      }
    },
    onSuccess: () => toast({ title: "Index check complete" }),
    onError: (e: Error) =>
      toast({ title: "Check failed", description: e.message, variant: "destructive" }),
  });

  const requestAll = useMutation({
    mutationFn: async () => {
      const targets = rows
        .filter((r) => r.state !== "indexed" && r.state !== "submitting")
        .map((r) => r.url);
      for (const url of targets) {
        await submitOne(url);
      }
    },
    onSuccess: () => toast({ title: "Indexing requests sent" }),
    onError: (e: Error) =>
      toast({
        title: "Bulk submit failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to manage indexing.</p>
      </div>
    );
  }

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
              <h1 className="text-2xl font-semibold">Indexing</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Paste or upload URLs, check whether Google has them indexed, and
                request re-crawling via the Indexing API.
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadSitemap.mutate()}
              disabled={loadSitemap.isPending}
            >
              {loadSitemap.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Load WP sitemap
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkAll.mutate()}
              disabled={checkAll.isPending || rows.length === 0}
            >
              {checkAll.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Check all
            </Button>
            <Button
              size="sm"
              onClick={() => requestAll.mutate()}
              disabled={requestAll.isPending || rows.length === 0}
            >
              {requestAll.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Request indexing for all
            </Button>
          </div>
        </div>

        <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Add URLs
          </div>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"One URL per line:\nhttps://example.com/products/wrap-1\nhttps://example.com/products/wrap-2"}
            rows={4}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={parsedFromPaste.length === 0}
            >
              Add {parsedFromPaste.length > 0 ? `(${parsedFromPaste.length})` : ""}
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-zinc-700 hover:bg-zinc-900 cursor-pointer">
                <Upload className="h-3.5 w-3.5" /> Upload .txt / .csv
              </span>
            </label>
            <span className="text-xs text-zinc-500 ml-auto">
              {rows.length} URL{rows.length === 1 ? "" : "s"} loaded
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Indexing requires the connected Google account to be a verified owner
            in{" "}
            <Link
              to="/admin/seo/connections"
              className="text-cyan-400 hover:underline"
            >
              Search Console
            </Link>{" "}
            and the Indexing API enabled on the Cloud project. Requests are
            tracked in component state — close this tab and the table is gone.
          </p>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          {rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              No URLs yet. Paste or upload above to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">URL</TableHead>
                  <TableHead className="text-zinc-400 w-32">Status</TableHead>
                  <TableHead className="text-zinc-400 w-40">Coverage</TableHead>
                  <TableHead className="text-zinc-400 w-32">Last crawled</TableHead>
                  <TableHead className="text-zinc-400 w-[260px] text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.url} className="border-zinc-800 align-top">
                    <TableCell className="font-mono text-xs">
                      <div className="truncate max-w-[420px]">{r.url}</div>
                      {r.error && (
                        <div className="text-red-400 text-[11px] mt-1 whitespace-pre-wrap">
                          {r.error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge state={r.state} />
                    </TableCell>
                    <TableCell className="text-xs text-zinc-300">
                      {r.coverage ?? "—"}
                      {r.verdict && r.verdict !== "PASS" && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {r.verdict}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-zinc-400 tabular-nums">
                      {r.lastCrawled
                        ? new Date(r.lastCrawled).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => inspectOne(r.url)}
                          disabled={r.state === "checking"}
                        >
                          {r.state === "checking" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => submitOne(r.url)}
                          disabled={r.state === "submitting"}
                        >
                          {r.state === "submitting" ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : r.state === "submitted" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                          ) : (
                            <Send className="h-3.5 w-3.5 mr-1" />
                          )}
                          {r.state === "submitted" ? "Sent" : "Request"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRow(r.url)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-zinc-500" />
                        </Button>
                      </div>
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

function StatusBadge({ state }: { state: IndexState }) {
  switch (state) {
    case "indexed":
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
          Indexed
        </Badge>
      );
    case "not_indexed":
      return (
        <Badge className="bg-amber-600 hover:bg-amber-600 text-[10px]">
          Not indexed
        </Badge>
      );
    case "checking":
      return <span className="text-xs text-zinc-400">Checking…</span>;
    case "submitting":
      return <span className="text-xs text-zinc-400">Submitting…</span>;
    case "submitted":
      return (
        <Badge className="bg-cyan-600 hover:bg-cyan-600 text-[10px]">
          Submitted
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Inspect error
        </Badge>
      );
    case "submit_error":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Submit error
        </Badge>
      );
    default:
      return <span className="text-xs text-zinc-500">Unchecked</span>;
  }
}
