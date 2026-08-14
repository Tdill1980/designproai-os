/**
 * AlternateElementsCard — "Design Elements" alternates (Step B of the engine).
 *
 * When a design generates, the overlay precedence (upload > lift > regenerated
 * text-layer) picks ONE element as primary; the displaced version is kept as an
 * ALTERNATE in design_generation_assets.alternate_overlays (Step A). This card
 * surfaces those 2nd-choice Design Elements so the user can swap one in with a
 * tap — deterministic control + options, no AI re-roll.
 *
 * Element-count agnostic: shows however many alternates exist (1 or 21).
 * Isolated + additive: renders nothing when there are no alternates.
 */
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AltOverlay {
  id?: string;
  url: string;
  role?: string;
  text?: string;
  kind?: string;
}

interface AlternateElementsCardProps {
  /** designiq_generations.id (the key for design_generation_assets). */
  generationId: string | null;
  /** Tap an alternate → add it as an editable layer on the current view. */
  onPick: (url: string, name: string) => void;
}

export function AlternateElementsCard({ generationId, onPick }: AlternateElementsCardProps) {
  const [alts, setAlts] = useState<AltOverlay[]>([]);

  useEffect(() => {
    if (!generationId) {
      setAlts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("design_generation_assets")
          .select("alternate_overlays")
          .eq("generation_id", generationId)
          .eq("is_current", true)
          .order("iteration_index", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        const raw = Array.isArray((data as any)?.alternate_overlays)
          ? ((data as any).alternate_overlays as AltOverlay[])
          : [];
        setAlts(raw.filter((o) => o?.url));
      } catch {
        if (!cancelled) setAlts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generationId]);

  if (!alts.length) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-1.5">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-amber-400" />
        <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Design Elements — Alternates ({alts.length})
        </span>
      </div>
      <p className="text-[10px] text-amber-400/90 font-medium">
        2nd-choice styles the design also generated. Tap one to add it as an editable layer.
      </p>
      <div className="flex flex-wrap gap-2">
        {alts.map((o, i) => (
          <button
            key={o.id || `alt-${i}`}
            type="button"
            onClick={() => onPick(o.url, o.role || o.text || `Alternate ${i + 1}`)}
            className="relative w-20 h-16 rounded-md border-2 border-amber-500/40 bg-zinc-900 hover:border-amber-400 transition-all flex items-center justify-center bg-[conic-gradient(at_50%_50%,_#27272a_25%,_#1f1f24_25%_50%,_#27272a_50%_75%,_#1f1f24_75%)] bg-[length:8px_8px]"
            title={`Use alternate: ${o.role || o.text || "element"}`}
          >
            <img
              src={o.url}
              alt={o.role || "alternate"}
              className="max-w-full max-h-full object-contain"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
