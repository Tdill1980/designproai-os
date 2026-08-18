/**
 * The standalone Production Layers source, for whichever surface mounts the card.
 *
 * ProductionFlowLayersCard renders the same thing wherever it appears -- six
 * branded panels beside their own approved views, the clean set, the separated
 * logos, and the two purchase actions. What differs between deployments is
 * where the rows come from, so that resolution lives here rather than being
 * written twice.
 *
 * Returns null whenever this design is not a standalone run: an id the gateway
 * does not know, a pack that has not finished preparing, a request that fails.
 * Null is the signal the card falls back to its own resolution, so a legacy
 * caller keeps working untouched and nothing has to know which world it is in.
 */
import { useEffect, useMemo, useState } from "react";
import { dpApi } from "@/lib/designpro-api";
import {
  loadProductionLayers,
  type ProductionLayers,
  type ProductionLayersSource,
} from "@/lib/designpro-production-layers";

export function useStandaloneProductionLayers(
  generationId: string | null | undefined,
  options?: { returnPath?: string },
): ProductionLayersSource | null {
  const [layers, setLayers] = useState<ProductionLayers | null>(null);
  const id = String(generationId || "");

  useEffect(() => {
    let live = true;
    if (!id) {
      setLayers(null);
      return () => { live = false; };
    }
    // A design that is not a standalone run answers 404 here, which is the
    // honest "not mine" rather than an error worth showing anyone.
    loadProductionLayers(id)
      .then((result) => { if (live) setLayers(result); })
      .catch(() => { if (live) setLayers(null); });
    return () => { live = false; };
  }, [id]);

  const returnPath = options?.returnPath;
  return useMemo(() => {
    if (!layers || !id) return null;
    const back = returnPath || `/designpro/jobs/${id}`;
    const checkout = (product: "print_pack_entitlement" | "logo_pack") => async () => {
      const session = await dpApi.createCheckoutSession({ generationId: id, product, returnPath: back });
      window.location.href = session.url;
    };
    return {
      canonicalId: id,
      rows: layers.rows,
      designViews: layers.designViews,
      activePack: layers.activePack,
      // Two products, two checkouts. Neither authorizes the other.
      onOrderProductionPack: checkout("print_pack_entitlement"),
      onOrderLogoPack: checkout("logo_pack"),
    };
  }, [layers, id, returnPath]);
}
