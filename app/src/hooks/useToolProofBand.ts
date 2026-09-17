import { useEffect, useState } from "react";
import { listWallProofs, wallProofUrl, type ProofBandToolKey } from "@/lib/wallpro-api";
import type { WallProof } from "@/lib/wallpro-brand";

/**
 * The published before/after band for one tool, curator-managed.
 *
 * WallPro's `/admin/wallpro-proofs` page now serves VehiclePro and CutPro too
 * (Trish 2026-09-16: "do the admin page"), through the same table and the
 * same publish/order/delete behaviour -- only `tool_key` differs. This is the
 * read side for VehiclePro and CutPro, which (unlike WallPro) have no
 * bundled fallback list: neither tool has any real finished-design imagery
 * checked into the repo, so "shows nothing when it has nothing" is the
 * correct and only behaviour until a curator publishes a first pair.
 *
 * Brand is always 'designpro' here: only WallPro has a page under a
 * partner's own mark.
 */
export function useToolProofBand(toolKey: Exclude<ProofBandToolKey, "wallpro">): WallProof[] {
  const [proofs, setProofs] = useState<WallProof[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const rows = await listWallProofs(toolKey, "designpro");
      if (!live || !rows.length) return;
      setProofs(
        rows.map((r) => ({
          before: wallProofUrl(r.before_path),
          after: wallProofUrl(r.after_path),
          alt: r.alt,
          headline: r.headline,
          caption: r.caption,
        })),
      );
    })();
    return () => {
      live = false;
    };
  }, [toolKey]);
  return proofs;
}
