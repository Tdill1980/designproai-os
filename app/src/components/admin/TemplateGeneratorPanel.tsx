/**
 * TemplateGeneratorPanel — build brand templates with AI, into the real library.
 *
 * The template library used to be upload-only, so brands nobody had got to had
 * nothing, and no brand had a carousel set at all. This generates them:
 * pick a brand and a layout (grid, us-vs-them, carousel, editorial, …) and it
 * files the result in `canva-templates/{brand}/{type}` — the same folders
 * Content Studio and Autonomous mode already read. A generated template is
 * indistinguishable from an imported one downstream.
 *
 * What comes out is a BLANK, not a finished post: realistic placeholder copy
 * in clean text zones, so the rewrite pass can swap the words and keep the
 * design. That's what lets one template serve a hundred posts.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Wand2, RefreshCw, AlertTriangle, Layers } from "lucide-react";
import { readEdgeError } from "@/lib/edgeError";

interface StyleOption {
  key: string; label: string; purpose: string;
  folder: string; aspect: string; slides: number;
}
interface MadeTemplate { url: string; path: string; slide: number }

export default function TemplateGeneratorPanel({
  onCreated,
}: {
  /** Fired after a successful build so the library list can refresh. */
  onCreated?: (urls: string[]) => void;
}) {
  const [brands, setBrands] = useState<string[]>([]);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [brand, setBrand] = useState("DesignProAI");
  const [styleKey, setStyleKey] = useState("grid");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<MadeTemplate[]>([]);
  const [failed, setFailed] = useState<{ slide: number; reason: string }[]>([]);

  // Ask the function what it can build rather than hardcoding a list that drifts.
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("generate-brand-template", {
          body: { action: "styles" },
        });
        if (error) throw error;
        setBrands(data?.brands || []);
        setStyles(data?.styles || []);
      } catch (e: unknown) {
        const info = await readEdgeError(e);
        toast.error("Couldn't load template styles: " + info.reason);
      }
    })();
  }, []);

  const style = styles.find((s) => s.key === styleKey);

  const build = useCallback(async () => {
    setBusy(true); setMade([]); setFailed([]);
    try {
      const { data, error } = await supabase.functions.invoke("generate-brand-template", {
        body: { brand, style: styleKey },
      });
      if (error) throw error;
      if (data?.error && !data?.created) throw new Error(data.error);
      setMade(data?.templates || []);
      setFailed(data?.failed || []);
      const n = data?.created ?? 0;
      if (n > 0) {
        toast.success(
          `${n} template${n === 1 ? "" : "s"} added to ${brand} → ${data.folder}` +
          (data?.failed?.length ? ` (${data.failed.length} slide(s) failed)` : ""),
        );
        onCreated?.((data.templates || []).map((t: MadeTemplate) => t.url));
      } else {
        toast.error("Nothing was generated — see the reason below.");
      }
    } catch (e: unknown) {
      const info = await readEdgeError(e);
      setFailed([{ slide: 0, reason: info.reason }]);
      toast.error("Template build failed: " + info.reason);
    } finally {
      setBusy(false);
    }
  }, [brand, styleKey, onCreated]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Wand2 className="h-5 w-5 text-purple-600" />
        <span className="text-sm font-bold text-gray-900">Build a template with AI</span>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-snug text-gray-600">
        Generates a reusable template in the brand's own colours and type, straight into the
        library — the same folders Content Studio and Autonomous mode read from. It comes out as a
        blank with placeholder copy, so the words get rewritten per post and the design stays.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50/70 p-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Brand</span>
          <select
            value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
          >
            {(brands.length ? brands : [brand]).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Style</span>
          <select
            value={styleKey} onChange={(e) => setStyleKey(e.target.value)} disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
          >
            {styles.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}{s.slides > 1 ? ` (${s.slides} slides)` : ""}
              </option>
            ))}
          </select>
        </label>

        <Button
          size="sm" onClick={build} disabled={busy || !styles.length}
          className="bg-gradient-to-r from-purple-600 to-fuchsia-600 font-bold text-white hover:opacity-90"
        >
          {busy
            ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Building…</>
            : <><Layers className="mr-1.5 h-3.5 w-3.5" /> Build{style && style.slides > 1 ? ` ${style.slides} slides` : ""}</>}
        </Button>
      </div>

      {style && (
        <p className="mt-2 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">{style.label}</span> — {style.purpose}{" "}
          Files into <span className="font-mono">{brand}/{style.folder}</span> at {style.aspect}.
          {style.slides > 1 && " Each slide is generated separately, so a set can partly succeed."}
        </p>
      )}

      {busy && style && style.slides > 1 && (
        <p className="mt-2 text-[11px] text-gray-500">
          Generating {style.slides} slides one at a time — this takes a minute.
        </p>
      )}

      {made.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Added to the library
          </p>
          <div className="flex flex-wrap gap-2">
            {made.map((t) => (
              <a key={t.path} href={t.url} target="_blank" rel="noreferrer" className="group relative">
                <img src={t.url} alt="" className="h-24 w-20 rounded border border-gray-200 object-cover" />
                {t.slide > 0 && made.length > 1 && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
                    {t.slide}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {failed.length} didn't generate
          </p>
          <ul className="mt-1 space-y-0.5">
            {failed.map((f, i) => (
              <li key={i} className="text-[11px] leading-snug text-amber-800">
                {f.slide ? `Slide ${f.slide}: ` : ""}{f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
