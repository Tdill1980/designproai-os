// CreatorBuildPanel — one-click "Build from library" on the Creator page.
//
// Wires the parsed footage library → a finished cut, per FORMAT, so the team
// doesn't have to leave /admin/creator. The Format picker maps each choice to
// the right assembly + overlay pattern:
//   • Reel      — 9:16 hook-first fast cut
//   • Listicle  — 9:16 UGC: a numbered caption per clip (#1, #2, #3 → payoff)
//   • Long-form — 16:9 hook-scored content_moments
//   • Carousel  — 4:5 swipeable slides
//   • Grid      — static grid post (library photos + copy)
// Brand + an optional saved hook (Hooks Manager → content_hooks) steer the
// angle. The result enqueues a render job that shows in "Render jobs" below,
// where the ✂️ Edit button fine-tunes music/overlays/scenes before publishing.
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoBuildVideo, BuildFormat, StaticLayout } from "@/hooks/useAutoBuildVideo";

const BRANDS: { slug: string; label: string }[] = [
  { slug: "weprintwraps", label: "WePrintWraps" },
  { slug: "restylepro", label: "RestyleProAI" },
  { slug: "wraptvworld", label: "WrapTVWorld" },
  { slug: "designproai", label: "DesignProAI" },
  { slug: "inkandedge", label: "Ink & Edge" },
];

// UI format choices → real autoBuild params. `listicle`/`grid` are patterns,
// not raw BuildFormats, so they map onto reel/static with a shaped prompt.
const FORMATS: { value: string; label: string; note: string }[] = [
  { value: "reel", label: "Reel", note: "9:16 hook-first fast-cut" },
  { value: "listicle", label: "Listicle", note: "9:16 UGC — a numbered caption per clip (#1, #2, #3 → payoff)" },
  { value: "youtube", label: "Long-form", note: "16:9 hook-scored moments" },
  { value: "carousel", label: "Carousel", note: "4:5 swipeable slides" },
  { value: "grid", label: "Grid", note: "static grid post — library photos + copy" },
];

function buildOpts(pick: string, base: string): { format: BuildFormat; topic: string; layout?: StaticLayout } {
  switch (pick) {
    case "listicle":
      return {
        format: "reel",
        topic: `${base}. FORMAT = LISTICLE (UGC): give each clip a short punchy NUMBERED caption — "#1 …", "#2 …", "#3 …" — building to a payoff; the last scene is the CTA.`,
      };
    case "youtube":
      return { format: "youtube", topic: base };
    case "carousel":
      return { format: "carousel", topic: base, layout: "grid" };
    case "grid":
      return { format: "static", topic: base, layout: "grid" };
    default:
      return { format: "reel", topic: base };
  }
}

export default function CreatorBuildPanel() {
  const qc = useQueryClient();
  const { autoBuild, building, progress } = useAutoBuildVideo();
  const [pick, setPick] = useState<string>("reel");
  const [brand, setBrand] = useState("weprintwraps");
  const [topic, setTopic] = useState("");
  const [savedHook, setSavedHook] = useState("");
  const [hooks, setHooks] = useState<{ id: string; text: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("content_hooks")
        .select("id, text")
        .eq("brand", brand)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) { setHooks((data || []) as { id: string; text: string }[]); setSavedHook(""); }
    })();
    return () => { cancelled = true; };
  }, [brand]);

  const build = async () => {
    const base = [topic.trim(), savedHook].filter(Boolean).join(" — ");
    if (!base) { toast.error("Add a topic or pick a saved hook so the AI knows the angle."); return; }
    try {
      await autoBuild({ ...buildOpts(pick, base), brand });
      qc.invalidateQueries({ queryKey: ["render-jobs"] });
    } catch {
      /* autoBuild surfaces the reason via progress.error below */
    }
  };

  const current = FORMATS.find((f) => f.value === pick);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-1">⚡ Build from library</h2>
      <p className="text-xs text-gray-500 mb-3">
        Pick a format → AI assembles a finished cut from your parsed footage. It lands in Render jobs below — click ✂️ Edit to fine-tune, or publish as-is.
      </p>

      {/* Format picker */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Format</div>
      <div className="mb-2 flex flex-wrap gap-2">
        {FORMATS.map((f) => (
          <button key={f.value} onClick={() => setPick(f.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${pick === f.value
              ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
            {f.label}
          </button>
        ))}
      </div>
      {current && <p className="mb-3 text-[11px] text-gray-400">{current.note}</p>}

      {/* Brand */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Brand</div>
      <div className="mb-3 flex flex-wrap gap-2">
        {BRANDS.map((b) => (
          <button key={b.slug} onClick={() => setBrand(b.slug)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${brand === b.slug
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Topic + saved hook */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="Angle / topic — e.g. 'top regrets buying a cheap wrap'"
          className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
        {hooks.length > 0 && (
          <select value={savedHook} onChange={(e) => setSavedHook(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:max-w-[16rem]">
            <option value="">— saved hook (optional) —</option>
            {hooks.map((h) => (
              <option key={h.id} value={h.text}>{h.text.length > 48 ? h.text.slice(0, 48) + "…" : h.text}</option>
            ))}
          </select>
        )}
      </div>

      <Button onClick={build} disabled={building}
        className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-semibold hover:opacity-90 sm:w-auto">
        {building ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{progress.detail || "Building…"}</> : `⚡ Build ${current?.label || ""}`}
      </Button>

      {progress.step === "error" && progress.error && (
        <p className="mt-2 text-xs text-red-600">{progress.error}</p>
      )}
      {progress.step === "queued" && (
        <p className="mt-2 text-xs text-emerald-600">{progress.detail || "Queued — watch it in Render jobs below."}</p>
      )}
    </section>
  );
}
