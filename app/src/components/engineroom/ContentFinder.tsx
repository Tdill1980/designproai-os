// ContentFinder — search everything the parser indexed, build from any of it.
//
// The system the whole pipeline feeds: once footage is parsed, every spoken
// line (content_moments.verbatim_quote), every scored visual beat
// (visual_description / install_stage / money shots), and every library asset
// (agent_media_assets tags) is searchable here. Find "squeegee pull",
// "reveal", a quote, a shop name — select what you want — and Build Reel or
// Build Static turns the selection into a render job. Parse → index → find →
// build, in your product, no terminal.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Film, Image as ImageIcon, Star } from "lucide-react";
import { toast } from "sonner";

interface Hit {
  kind: "moment" | "asset";
  id: string;
  clipUrl: string;
  start: number;
  end: number;
  label: string;
  sub: string;
  money?: boolean;
  stage?: string;
}

const STAGE_FILTERS = ["", "squeegee", "reveal", "heat", "trim", "peel", "drive-by", "detail", "interview", "prep"];

export default function ContentFinder() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [picked, setPicked] = useState<Record<string, Hit>>({});
  // Behind the Install / long-form = horizontal; shorts/reels = vertical.
  const [orient, setOrient] = useState<"9:16" | "16:9">("9:16");

  const search = useQuery({
    queryKey: ["content-finder", q, stage, moneyOnly],
    queryFn: async () => {
      const hits: Hit[] = [];
      // 1. Scored moments joined to their source video.
      let mq = (supabase as any)
        .from("content_moments")
        .select("id, source_id, start_time, end_time, speaker, verbatim_quote, visual_description, install_stage, broll_score, hook_score, media_sources!inner(filename, storage_url)")
        .not("media_sources.storage_url", "is", null)
        .order("hook_score", { ascending: false, nullsFirst: false })
        .limit(80);
      if (stage) mq = mq.ilike("install_stage", `%${stage}%`);
      if (moneyOnly) mq = mq.or("hook_score.gte.7,broll_score.gte.8");
      if (q.trim()) mq = mq.or(`verbatim_quote.ilike.%${q}%,visual_description.ilike.%${q}%,install_stage.ilike.%${q}%`);
      const { data: moments } = await mq;
      for (const m of moments || []) {
        const src = m.media_sources;
        hits.push({
          kind: "moment", id: `m_${m.id}`, clipUrl: src.storage_url,
          start: Number(m.start_time || 0), end: Number(m.end_time || Number(m.start_time || 0) + 5),
          label: m.verbatim_quote ? `"${String(m.verbatim_quote).slice(0, 90)}"` : (m.visual_description || m.install_stage || "moment"),
          sub: `${src.filename} @${Math.round(Number(m.start_time || 0))}s · ${m.install_stage || "—"}`,
          money: Number(m.hook_score) >= 7 || Number(m.broll_score) >= 8, stage: m.install_stage,
        });
      }
      // 2. Library clips by tag/title (only when there's a text query).
      if (q.trim() && !moneyOnly && !stage) {
        const { data: assets } = await (supabase as any)
          .from("agent_media_assets")
          .select("id, title, original_filename, storage_url, tags")
          .eq("asset_type", "video").not("storage_url", "is", null)
          .or(`title.ilike.%${q}%,original_filename.ilike.%${q}%`)
          .limit(30);
        for (const a of assets || []) {
          hits.push({
            kind: "asset", id: `a_${a.id}`, clipUrl: a.storage_url, start: 0, end: 6,
            label: a.title || a.original_filename, sub: (a.tags || []).slice(0, 4).join(" · "),
          });
        }
      }
      return hits;
    },
  });

  const toggle = (h: Hit) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[h.id]) delete n[h.id]; else n[h.id] = h;
      return n;
    });

  const build = useMutation({
    mutationFn: async (mode: "reel" | "static") => {
      const sel = Object.values(picked);
      if (!sel.length) throw new Error("Pick at least one clip");
      const scenes = sel.map((h, i) => ({
        sceneId: `f${i}`, clipId: h.id, clipUrl: h.clipUrl,
        start: h.start, end: h.end, purpose: i === 0 ? "hook" : "b_roll",
      }));
      const blueprint = mode === "static"
        ? { id: `finder_static_${Date.now()}`, kind: "static_post", layout: "grid", platform: "instagram",
            aspectRatio: "9:16", format: "static", source: "content_finder", brand: "wraptvworld",
            title: q || "Found", headline: q || "WRAP TV WORLD", siteUrl: "wraptvworld.com", scenes: scenes.slice(0, 6) }
        : { id: `finder_reel_${Date.now()}`,
            platform: orient === "16:9" ? "youtube" : "instagram",
            format: orient === "16:9" ? "youtube" : "reel", aspectRatio: orient,
            source: "content_finder", brand: "wraptvworld", title: q || "Behind the Install",
            stylePack: "wpw_dark_clean", scenes,
            totalDuration: scenes.reduce((t, s) => t + Math.max(0.5, s.end - s.start), 0),
            endCard: { duration: 2, text: "WRAP TV WORLD", cta: "WrapTVWorld.com" } };
      const { data, error } = await supabase.functions.invoke("video-render", {
        body: { blueprint, brand: "wraptvworld", source_ref: "content_finder" },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error || "build failed");
    },
    onSuccess: () => { toast.success("Queued — watch it in Renders."); setPicked({}); },
    onError: (e: any) => toast.error(e?.message || "Build failed"),
  });

  const hits = search.data || [];
  const nPicked = Object.keys(picked).length;

  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-gray-900">
          🔎 Content Finder{" "}
          <span className="text-xs font-normal text-gray-500">
            search everything parsed — quotes, squeegee pulls, reveals, tags — pick clips, build a reel or static
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search: "squeegee", "reveal", a quote, a shop name…'
              className="bg-white pl-8 text-gray-900 border-gray-300 placeholder:text-gray-400" />
          </div>
          <select value={stage} onChange={(e) => setStage(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900">
            {STAGE_FILTERS.map((s) => <option key={s} value={s}>{s ? s : "Any stage"}</option>)}
          </select>
          <Button variant={moneyOnly ? "default" : "outline"} onClick={() => setMoneyOnly((m) => !m)}
            className={moneyOnly ? "bg-amber-500 text-white hover:bg-amber-600" : ""}>
            <Star className="mr-1 h-4 w-4" /> Money shots
          </Button>
        </div>

        {search.isFetching && <p className="text-sm text-gray-500"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Searching the index…</p>}
        {!search.isFetching && hits.length === 0 && (
          <p className="text-sm text-gray-500">Nothing indexed for that yet — parse footage (above) and it becomes searchable here.</p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {hits.map((h) => (
            <button key={h.id} onClick={() => toggle(h)}
              className={`overflow-hidden rounded-lg border text-left transition ${picked[h.id] ? "border-[#3b82f6] ring-2 ring-[#3b82f6]/30" : "border-gray-200 hover:border-gray-300"}`}>
              <div className="relative">
                {/* Audio-only sources (archived .mp3 masters) painted a dead
                    black <video> tile — show the quote as the card instead. */}
                {/\.(mp3|wav|m4a|aac)(\?.*)?$/i.test(h.clipUrl || "") ? (
                  <div className="flex h-24 w-full items-center bg-gradient-to-br from-[#3b82f6] to-[#ec4899] p-2">
                    <p className="line-clamp-4 text-[11px] font-medium leading-snug text-white">“{h.label}”</p>
                  </div>
                ) : (
                  <video playsInline src={`${h.clipUrl}#t=${h.start}`} preload="metadata" muted className="h-24 w-full bg-black object-cover" />
                )}
                {h.money && <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 text-[10px] font-bold text-white">★</span>}
                {picked[h.id] && <span className="absolute left-1 top-1 rounded-full bg-[#3b82f6] px-1.5 text-[10px] font-bold text-white">✓</span>}
              </div>
              <div className="p-1.5">
                <div className="truncate text-xs font-medium text-gray-900">{h.label}</div>
                <div className="truncate text-[10px] text-gray-500">{h.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {nPicked > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
            <span className="text-sm font-medium text-gray-700">{nPicked} clip{nPicked > 1 ? "s" : ""} selected</span>
            <div className="flex gap-2">
              <div className="flex overflow-hidden rounded-md border border-gray-300">
                <button onClick={() => setOrient("9:16")} className={`px-2 py-1 text-xs font-semibold ${orient === "9:16" ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}>9:16 ↕</button>
                <button onClick={() => setOrient("16:9")} className={`px-2 py-1 text-xs font-semibold ${orient === "16:9" ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}>16:9 ↔</button>
              </div>
              <Button size="sm" variant="outline" onClick={() => build.mutate("static")} disabled={build.isPending}>
                <ImageIcon className="mr-1 h-4 w-4" /> Build Static
              </Button>
              <Button size="sm" onClick={() => build.mutate("reel")} disabled={build.isPending}
                className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:opacity-90">
                {build.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Film className="mr-1 h-4 w-4" />} Build {orient === "16:9" ? "Horizontal" : "Reel"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
