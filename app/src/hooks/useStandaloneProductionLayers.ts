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
import { isOwner } from "@/lib/admin-allowlist";
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
  const [entitlements, setEntitlements] = useState({ productionPack: false, logoPack: false });
  const [owner, setOwner] = useState(false);
  const id = String(generationId || "");

  useEffect(() => {
    let live = true;
    if (!id) {
      setLayers(null);
      return () => { live = false; };
    }
    const refresh = () => Promise.all([
      loadProductionLayers(id),
      dpApi.getPurchaseEntitlements(id),
    ]).then(([result, purchased]) => {
      if (!live) return;
      setLayers(result);
      setEntitlements(purchased);
    }).catch(() => { if (live) setLayers(null); });
    void refresh();
    // Purchase return and server reconciliation are asynchronous. Polling here
    // turns the card into a repeatable OS view instead of requiring a refresh.
    const timer = window.setInterval(refresh, 5000);
    void dpApi.session().then((session) => {
      if (live) setOwner(isOwner(session.user.email));
    }).catch(() => { if (live) setOwner(false); });
    return () => { live = false; window.clearInterval(timer); };
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
      // Entice or production. The card asks for the sale on one and reports
      // production state on the other, and it cannot tell them apart from the
      // rows alone.
      stage: layers.stage,
      rows: layers.rows,
      designViews: layers.designViews,
      activePack: layers.activePack,
      entitlements,
      // Two products, two checkouts. Neither authorizes the other.
      onOrderProductionPack: checkout("print_pack_entitlement"),
      onOrderLogoPack: checkout("logo_pack"),
      ...(owner ? {
        onRunOwnerEndToEndTest: async () => {
          await dpApi.runOwnerEndToEndTest(id);
          setEntitlements((current) => ({ ...current, productionPack: true }));
        },
      } : {}),
    };
  }, [layers, entitlements, owner, id, returnPath]);
}
