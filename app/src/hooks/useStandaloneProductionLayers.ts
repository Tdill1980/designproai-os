/**
 * The standalone Production Layers source, for whichever surface mounts the card.
 *
 * ProductionFlowLayersCard renders the same thing wherever it appears -- six
 * branded panels beside their own approved views, the clean set, the separated
 * logos, and the two purchase actions. What differs between deployments is
 * where the rows come from, so that resolution lives here rather than being
 * written twice.
 *
 * Returns null until this selected job and revision have published a pack.
 * The browser never falls back to a legacy producer or another revision.
 * Polls keep one last successful snapshot through temporary read failures.
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
  options?: { returnPath?: string; revisionId?: string | null },
): ProductionLayersSource | null {
  const [layers, setLayers] = useState<ProductionLayers | null>(null);
  const [entitlements, setEntitlements] = useState({ productionPack: false, logoPack: false });
  const [owner, setOwner] = useState(false);
  const id = String(generationId || "");
  const revisionId = options?.revisionId || null;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A different design/version never inherits the previous pair while reads
    // are in flight. Retain one version's last good read on transient errors.
    setLayers(null);
    setEntitlements({ productionPack: false, logoPack: false });
    setOwner(false);
    if (!id) return () => { live = false; };
    const refresh = async () => {
      const results = await Promise.allSettled([
        loadProductionLayers(id, revisionId),
        dpApi.getPurchaseEntitlements(id),
      ]);
      if (!live) return;
      if (results[0].status === "fulfilled") setLayers(results[0].value);
      if (results[1].status === "fulfilled") setEntitlements(results[1].value);
      timer = setTimeout(refresh, 5000);
    };
    void refresh();
    void dpApi.session().then((session) => {
      if (live) setOwner(isOwner(session.user.email));
    }).catch(() => { if (live) setOwner(false); });
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [id, revisionId]);

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
      proofUrl: layers.proofUrl,
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
