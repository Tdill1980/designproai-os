/**
 * GENIE PREP — the early lifecycle, browser side (owner ruling 2026-09-02).
 *
 * Vehicle complete / Enter → the page posts the GenerationID it minted plus the
 * typed vehicle → the server acknowledges and starts GENIE dimension
 * resolution → this helper follows the receipt until it settles, so the
 * "Design Prep ready" copy is true when it is shown. Nothing here gates
 * Generate: every failure resolves to a receipt that says so, and the worker
 * falls back to its inline resolver.
 */
import { dpApi, type GeniePrepReceipt } from "@/lib/designpro-api";

export const GENIE_PREP_POLL_MS = 2_000;
export const GENIE_PREP_TIMEOUT_MS = 120_000;

const SETTLED = new Set<GeniePrepReceipt["status"]>(["ready", "failed", "superseded", "unavailable"]);

export function geniePrepSettled(receipt: GeniePrepReceipt | null | undefined): boolean {
  return Boolean(receipt && SETTLED.has(receipt.status));
}

/**
 * Request the prep and follow it to a settled state. `isCurrent` lets the
 * caller abandon the poll when the vehicle changed underneath it (a changed
 * vehicle is a new GenerationID and a new prep).
 */
export async function runGeniePrep({
  generationId,
  vehicle,
  clientEnteredAt,
  isCurrent = () => true,
  onUpdate,
  pollMs = GENIE_PREP_POLL_MS,
  timeoutMs = GENIE_PREP_TIMEOUT_MS,
}: {
  generationId: string;
  vehicle: { year: string; make: string; model: string; type: string };
  clientEnteredAt: string;
  isCurrent?: () => boolean;
  onUpdate?: (receipt: GeniePrepReceipt) => void;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<GeniePrepReceipt> {
  let receipt: GeniePrepReceipt;
  try {
    receipt = await dpApi.requestGeniePrep({ generationId, vehicle, clientEnteredAt });
  } catch {
    receipt = { status: "unavailable", generationId, reason: "request_failed" };
  }
  onUpdate?.(receipt);
  const deadline = Date.now() + timeoutMs;
  while (!geniePrepSettled(receipt) && isCurrent() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    if (!isCurrent()) break;
    try {
      const next = await dpApi.getGeniePrep(generationId);
      if (next && next.status !== "absent") receipt = next;
    } catch {
      // A status read failing is not a prep failure; keep the last receipt.
    }
    onUpdate?.(receipt);
  }
  return receipt;
}

export function geniePrepCopy(receipt: GeniePrepReceipt | null | undefined): string | null {
  if (!receipt) return null;
  switch (receipt.status) {
    case "queued":
    case "resolving":
      return "Design Prep — GENIE is resolving this vehicle's dimensions while you write…";
    case "ready":
      return `Design Prep ready — GENIE geometry ${receipt.geometryState || "prepared"} and saved to this design${
        typeof receipt.durationMs === "number" ? ` (${(receipt.durationMs / 1000).toFixed(1)}s)` : ""
      }. Continue the creative prompt.`;
    case "failed":
      return "Design Prep could not finish on the server — Generate still works; dimensions resolve at Generate.";
    case "superseded":
      return "Vehicle changed — Design Prep restarted for the new vehicle.";
    case "unavailable":
      return "Design Prep unavailable — Generate still works; dimensions resolve at Generate.";
    default:
      return null;
  }
}
