import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Zap,
  Upload,
  FileText,
} from "lucide-react";

interface BatchRow {
  topic: string;
  focusKeyword: string;
  intent: string;
  status: "pending" | "generating" | "done" | "error";
  postId?: string;
  score?: number;
  wordCount?: number;
  error?: string;
}

const SAMPLE = `How much does a vehicle wrap cost in 2026 | vehicle wrap cost | buyer_intent
Matte vs gloss vs satin wrap finishes | matte wrap finish | comparison
Best colors for a Sprinter van wrap | sprinter van wrap colors | informational
Chrome delete guide — what it costs and why shops love it | chrome delete cost | buyer_intent
How long does a vinyl wrap last? | vinyl wrap durability | informational
PPF vs vinyl wrap — which one do you need? | ppf vs vinyl wrap | comparison
Top 10 wrap colors for Tesla Model 3 | tesla wrap colors | informational
Fleet wrap ROI — why businesses wrap their vehicles | fleet wrap roi | buyer_intent
How to care for your vehicle wrap | wrap care guide | how_to
What to expect at your wrap appointment | wrap appointment guide | informational`;

export default function AdminSeoBlogBatch() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const abortRef = useRef(false);

  const parseInput = useCallback((text: string): BatchRow[] => {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((line) => {
        const parts = line.split("|").map((p) => p.trim());
        return {
          topic: parts[0] || line,
          focusKeyword: parts[1] || parts[0]?.toLowerCase().slice(0, 40) || "",
          intent: parts[2] || "informational",
          status: "pending" as const,
        };
      });
  }, []);

  const generateBatch = async () => {
    if (!currentShop?.id) {
      toast({ title: "No shop selected", variant: "destructive" });
      return;
    }
    const parsed = parseInput(input);
    if (!parsed.length) {
      toast({ title: "Paste at least one topic", variant: "destructive" });
      return;
    }

    setRows(parsed);
    setRunning(true);
    abortRef.current = false;

    for (let i = 0; i < parsed.length; i++) {
      if (abortRef.current) break;

      setRows((prev) =>
        prev.map((r, j) => (j === i ? { ...r, status: "generating" } : r))
      );

      try {
        const { data, error } = await supabase.functions.invoke(
          "seo-blog-generate",
          {
            body: {
              shop_id: currentShop.id,
              topic: parsed[i].topic,
              focus_keyword: parsed[i].focusKeyword,
              intent: parsed[i].intent,
              tone: "expert, no-fluff, practical",
              target_word_count: 1200,
            },
          }
        );

        if (error) throw error;
        if (!data?.post?.id) throw new Error(data?.error || "No post returned");

        setRows((prev) =>
          prev.map((r, j) =>
            j === i
              ? {
                  ...r,
                  status: "done",
                  postId: data.post.id,
                  score: data.score?.score ?? data.post.seo_score ?? 0,
                  wordCount: data.post.body_html
                    ? data.post.body_html.replace(/<[^>]*>/g, "").split(/\s+/).length
                    : 0,
                }
              : r
          )
        );
      } catch (err: any) {
        setRows((prev) =>
          prev.map((r, j) =>
            j === i ? { ...r, status: "error", error: err.message } : r
          )
        );
      }

      // Small delay to avoid hammering Claude API
      if (i < parsed.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setRunning(false);
    toast({ title: "Batch complete", description: `${parsed.filter((_, i) => rows[i]?.status !== "error").length} posts generated` });
  };

  const publishAllDrafts = async () => {
    const donePosts = rows.filter((r) => r.status === "done" && r.postId);
    if (!donePosts.length) return;

    setPublishing(true);
    let published = 0;

    for (const row of donePosts) {
      try {
        const { error } = await supabase.functions.invoke("seo-wp-publish", {
          body: { post_id: row.postId, status: "draft" },
        });
        if (!error) published++;
      } catch {
        // continue
      }
    }

    setPublishing(false);
    toast({
      title: "WordPress drafts created",
      description: `${published}/${donePosts.length} posts pushed as drafts`,
    });
  };

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const avgScore = doneCount
    ? Math.round(
        rows.filter((r) => r.status === "done").reduce((a, r) => a + (r.score || 0), 0) / doneCount
      )
    : 0;

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin/seo" className="text-white/40 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Blog Content Sprint</h1>
          <p className="text-sm text-white/50">
            Paste topics, generate SEO blog posts with AI, publish to WordPress in bulk
          </p>
        </div>
      </div>

      {/* Input */}
      <Card className="bg-white/[0.03] border-white/10 p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-white/70">
            Topics — one per line: <code className="text-cyan-400">topic | focus_keyword | intent</code>
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-cyan-400 hover:text-cyan-300"
            onClick={() => setInput(SAMPLE)}
          >
            Load 10 sample topics
          </Button>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`How much does a vehicle wrap cost in 2026 | vehicle wrap cost | buyer_intent\nMatte vs gloss wrap finishes | matte wrap finish | comparison`}
          rows={8}
          className="bg-black/50 border-white/20 text-sm font-mono"
          disabled={running}
        />
        <div className="flex items-center gap-3 mt-3">
          <Button
            onClick={generateBatch}
            disabled={running || !input.trim()}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 font-bold"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating {doneCount + errorCount}/{rows.length}...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Generate Batch ({parseInput(input).length} posts)
              </>
            )}
          </Button>
          {running && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                abortRef.current = true;
              }}
              className="border-red-500/30 text-red-400"
            >
              Stop
            </Button>
          )}
          {doneCount > 0 && !running && (
            <Button
              onClick={publishAllDrafts}
              disabled={publishing}
              variant="outline"
              className="border-green-500/30 text-green-400 hover:bg-green-500/10"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Push {doneCount} to WordPress as drafts
            </Button>
          )}
        </div>
      </Card>

      {/* Stats bar */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-sm">
          <span className="text-white/40">
            {doneCount}/{rows.length} done
          </span>
          {errorCount > 0 && (
            <span className="text-red-400">{errorCount} errors</span>
          )}
          {doneCount > 0 && (
            <span className="text-cyan-400">Avg SEO score: {avgScore}/100</span>
          )}
        </div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              row.status === "generating"
                ? "border-cyan-500/30 bg-cyan-500/5"
                : row.status === "done"
                ? "border-green-500/20 bg-green-500/5"
                : row.status === "error"
                ? "border-red-500/20 bg-red-500/5"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            {/* Status icon */}
            <div className="shrink-0">
              {row.status === "pending" && (
                <FileText className="w-4 h-4 text-white/30" />
              )}
              {row.status === "generating" && (
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              )}
              {row.status === "done" && (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              )}
              {row.status === "error" && (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
            </div>

            {/* Topic */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{row.topic}</div>
              <div className="text-xs text-white/40">
                {row.focusKeyword} · {row.intent}
              </div>
              {row.error && (
                <div className="text-xs text-red-400 mt-0.5">{row.error}</div>
              )}
            </div>

            {/* Metrics */}
            {row.status === "done" && (
              <div className="flex items-center gap-3 shrink-0">
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    (row.score || 0) >= 80
                      ? "border-green-500/30 text-green-400"
                      : (row.score || 0) >= 60
                      ? "border-yellow-500/30 text-yellow-400"
                      : "border-red-500/30 text-red-400"
                  }`}
                >
                  SEO {row.score}
                </Badge>
                <span className="text-xs text-white/40">
                  {row.wordCount?.toLocaleString()} words
                </span>
                {row.postId && (
                  <Link
                    to={`/admin/seo/blog/${row.postId}`}
                    className="text-cyan-400 hover:text-cyan-300"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
