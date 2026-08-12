import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PanelSelection } from "@/lib/panelizer-config";
import { toUuidOrNull } from "@/lib/utils";
import { showPaywall } from "@/lib/paywall";
import { useOrganization } from "@/contexts/OrganizationContext";
import { submitProductionPack } from "@/lib/designpro-file-output";

const PACK_LIMITS: Record<string, number> = {
  advanced: 3,
  complete: 10,
  agency: Infinity,
};
const BYPASS_ROLES = ["admin", "tester"];
// sessionStorage key carrying the order intent across the Stripe pack checkout.
export const PACK_RESUME_KEY = "rp_pack_resume";

interface RenderLike {
  id: string;
  render_urls?: Record<string, string> | null;
  vehicle_year?: number | string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_type?: string;
  vehicleType?: string;
  design_file_name?: string;
  color_name?: string;
  finish_type?: string;
  custom_design_url?: string;
  quote_id?: string | null;
  tool_source?: string;
}

interface PackLimitInfo {
  allowed: boolean;
  used: number;
  limit: number;
  tier: string;
  viaComp?: boolean;
}

export interface UpscaleProgress {
  completed: number;
  total: number;
  percent: number;
  status: "pending" | "processing" | "complete" | "failed";
}

async function stableWorkflowUuid(material: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalizeIntent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeIntent);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeIntent(item)]),
    );
  }
  return value;
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify(canonicalizeIntent(value)),
      ),
    ),
  );
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function useQuickProductionPack() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { currentShopProfileId } = useOrganization();

  const checkPackLimit = async (): Promise<PackLimitInfo> => {
    const check = async (): Promise<PackLimitInfo> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { allowed: false, used: 0, limit: 0, tier: "none" };

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", BYPASS_ROLES)
        .limit(1)
        .maybeSingle();
      if (roleData)
        return {
          allowed: true,
          used: 0,
          limit: Infinity,
          tier: "admin",
        };

      const { data: subData } = await supabase
        .from("user_subscriptions")
        .select("tier,status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      const tier = subData?.tier || "free";
      const limit = PACK_LIMITS[tier] ?? 0;

      const { data: credits } = await supabase
        .from("production_pack_credits" as any)
        .select("total_credits,used_credits")
        .eq("user_id", user.id);
      const compRemaining = ((credits || []) as any[]).reduce(
        (sum, row) =>
          sum +
          Math.max(
            0,
            Number(row.total_credits || 0) - Number(row.used_credits || 0),
          ),
        0,
      );
      if (limit === 0) {
        return compRemaining > 0
          ? { allowed: true, used: 0, limit, tier, viaComp: true }
          : { allowed: false, used: 0, limit, tier };
      }
      if (!currentShopProfileId || limit === Infinity) {
        return { allowed: true, used: 0, limit, tier };
      }

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { count } = await (supabase as any)
        .from("production_packs")
        .select("*", { count: "exact", head: true })
        .eq("shop_id", currentShopProfileId)
        .gte("created_at", monthStart.toISOString());
      const used = Number(count || 0);
      if (used < limit) return { allowed: true, used, limit, tier };
      return compRemaining > 0
        ? { allowed: true, used, limit, tier, viaComp: true }
        : { allowed: false, used, limit, tier };
    };

    try {
      return await Promise.race([
        check(),
        new Promise<PackLimitInfo>((resolve) =>
          setTimeout(
            () =>
              resolve({
                allowed: true,
                used: 0,
                limit: Infinity,
                tier: "server_verifies",
              }),
            5_000,
          ),
        ),
      ]);
    } catch {
      // This check is only for immediate paywall UX. The server performs the
      // authoritative fail-closed entitlement check before queuing any stage.
      return {
        allowed: true,
        used: 0,
        limit: Infinity,
        tier: "server_verifies",
      };
    }
  };

  const handleGenerate = useCallback(
    async (
      render: RenderLike,
      selection: PanelSelection,
    ): Promise<string | null> => {
      const urls = render.render_urls as Record<string, string> | null;
      if (!urls || Object.keys(urls).length === 0) {
        toast.error(
          "No render views are available for Production Pack generation.",
          { duration: 10_000 },
        );
        return null;
      }
      const generationId = toUuidOrNull(render.id);
      if (!generationId) {
        toast.error("This design has no valid generation ID.", {
          duration: 10_000,
        });
        return null;
      }

      const limitInfo = await checkPackLimit();
      if (!limitInfo.allowed) {
        let paid = false;
        try {
          const { data } = await supabase
            .from("production_packs")
            .select("id")
            .eq("generation_id", generationId)
            .in("payment_status", ["paid", "included", "comp", "free"])
            .limit(1)
            .maybeSingle();
          paid = !!data?.id;
        } catch {
          // The server remains authoritative.
        }
        if (!paid) {
          // Stash the EXACT order intent before the Stripe redirect so the pack
          // can rebuild itself on return. Without this the customer pays, lands
          // back on `?pack=success`, and nothing happens (no handler read it) —
          // "charged and stuck". sessionStorage survives the same-tab round-trip
          // to Stripe and back; PackPaymentResume reads it. Best-effort.
          try {
            sessionStorage.setItem(
              PACK_RESUME_KEY,
              JSON.stringify({ render, selection, generationId, at: Date.now() }),
            );
          } catch { /* private mode / quota — resume just won't be available */ }
          showPaywall({
            code: "pack_required",
            generation_id: generationId,
            paywall: { production_pack: { price: 299 } },
          });
          return null;
        }
      }

      setIsGenerating(true);
      setJobId(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        let orderNumber: string | null = null;
        if (render.quote_id) {
          try {
            const { data: orderId, error } = await supabase.rpc(
              "convert_quote_to_order" as any,
              {
                p_quote_id: render.quote_id,
                p_source: "pack_purchase",
              } as any,
            );
            if (error) throw error;
            if (orderId) {
              const { data: order } = await (supabase as any)
                .from("orders")
                .select("order_number")
                .eq("id", orderId)
                .maybeSingle();
              orderNumber = order?.order_number || null;
            }
          } catch (error) {
            console.warn("[ProductionPack] quote conversion failed:", error);
          }
        }

        const declaredVehicleType = String(
          render.vehicle_type || render.vehicleType || "",
        )
          .trim()
          .toLowerCase();
        const isTrailer =
          declaredVehicleType === "trailer" ||
          (!declaredVehicleType &&
            /\btrailers?\b/i.test(
              [render.vehicle_make, render.vehicle_model]
                .filter(Boolean)
                .join(" "),
            ));
        const expectedPanelSides = isTrailer
          ? ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"]
          : [
              "DRIVER SIDE",
              "PASSENGER SIDE",
              ...(selection.addHood ? ["HOOD"] : []),
              ...(selection.roofSize !== "none" ? ["ROOF"] : []),
              ...(selection.addFrontBumper ? ["FRONT"] : []),
              ...(selection.addRearBumper ? ["REAR"] : []),
            ];
        const normalizedUrls = Object.fromEntries(
          Object.entries(urls).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        );
        const intentHash = await sha256Hex({
          definitionVersion: "designpro.production_pack.v1",
          userId: user.id,
          generationId,
          proofUrl: urls.production_proof || urls.proof_2d || null,
          views: normalizedUrls,
          vehicle: {
            year: render.vehicle_year || null,
            make: render.vehicle_make || null,
            model: render.vehicle_model || null,
            type: isTrailer
              ? "trailer"
              : declaredVehicleType || "standard",
            finish: render.finish_type || "gloss",
          },
          selection: {
            sideSize: selection.sideSize,
            roofSize: selection.roofSize,
            addHood: selection.addHood,
            addFrontBumper: selection.addFrontBumper,
            addRearBumper: selection.addRearBumper,
            expectedPanelSides,
          },
        });
        const panelizerJobId = await stableWorkflowUuid(
          `designpro.production_pack:${user.id}:${generationId}:${intentHash}`,
        );
        const primaryRenderUrl =
          urls.side || urls["driver-side"] || Object.values(urls)[0];
        const { error: jobError } = await supabase
          .from("panelizer_jobs" as any)
          .upsert(
            {
              id: panelizerJobId,
              user_id: user.id,
              generation_id: generationId,
              approved_render_url: primaryRenderUrl,
              all_view_urls: urls,
              vehicle_year: render.vehicle_year
                ? Number(render.vehicle_year)
                : null,
              vehicle_make: render.vehicle_make || null,
              vehicle_model: render.vehicle_model || null,
              ...(orderNumber ? { order_number: orderNumber } : {}),
              ...(render.quote_id ? { quote_id: render.quote_id } : {}),
              job_type: "production_pack",
              concept_json: {
                sideSize: selection.sideSize,
                roofSize: selection.roofSize,
                addHood: selection.addHood,
                addFrontBumper: selection.addFrontBumper,
                addRearBumper: selection.addRearBumper,
                render_urls: urls,
                design_name:
                  render.design_file_name || render.color_name || null,
                finish: render.finish_type || "gloss",
                production_intent_hash: intentHash,
                surface_manifest_version: 1,
                vehicle_type: isTrailer
                  ? "trailer"
                  : declaredVehicleType || "standard",
                expected_panel_sides: expectedPanelSides,
                flat_proof_url: urls.production_proof || urls.proof_2d || null,
              },
              status: "queued",
              started_at: new Date().toISOString(),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
        if (jobError && jobError.code !== "23505") throw jobError;

        try {
          await submitProductionPack({
            jobId: panelizerJobId,
            generationId,
            idempotencyKey: `production-pack:${panelizerJobId}`,
          });
        } catch (error: any) {
          if (error?.code === "pack_required") {
            showPaywall(error);
            return null;
          }
          throw error;
        }

        setJobId(panelizerJobId);
        toast.success(
          "Production Pack accepted. GENIE is building it on the server.",
          { duration: 8_000 },
        );
        return panelizerJobId;
      } catch (error: any) {
        console.error("[ProductionPack] submit failed:", error);
        toast.error(
          error?.message ||
            "Could not submit the Production Pack. Please try again.",
          { duration: 15_000 },
        );
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [currentShopProfileId],
  );

  // Resume the build after a successful pack payment. Reads the intent stashed
  // right before the Stripe redirect and re-runs the SAME order (exact render +
  // selection — never a reconstructed guess). handleGenerate re-checks the paid
  // row, which now exists, and proceeds to the durable build. Returns the job id
  // or null when there is nothing to resume (e.g. a different tab, or expired).
  const resumePendingPack = useCallback(async (): Promise<string | null> => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(PACK_RESUME_KEY); } catch { raw = null; }
    if (!raw) return null;
    try { sessionStorage.removeItem(PACK_RESUME_KEY); } catch { /* ignore */ }
    let stash: { render?: RenderLike; selection?: PanelSelection; at?: number } | null = null;
    try { stash = JSON.parse(raw); } catch { return null; }
    // Only resume a recent intent (<30 min) so a stale tab can't rebuild an old
    // order behind the customer's back.
    if (!stash?.render || !stash?.selection || (stash.at && Date.now() - stash.at > 30 * 60_000)) {
      return null;
    }
    return handleGenerate(stash.render, stash.selection);
  }, [handleGenerate]);

  return {
    isGenerating,
    jobId,
    handleGenerate,
    checkPackLimit,
    resumePendingPack,
  };
}
