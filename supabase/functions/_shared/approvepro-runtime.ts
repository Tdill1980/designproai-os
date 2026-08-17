/**
 * DesignProAI-owned ApprovePro runtime gate.
 *
 * Fail closed: customer access, proof mutations, automation, outbound proof
 * communications, signing, and delivery stay unavailable unless the owner
 * explicitly enables the completed DesignProAI integration.
 */
export const isApproveProLive = (): boolean =>
  Deno.env.get("APPROVEPRO_LIVE") === "true";

export const approveProDisabledPayload = () => ({
  error: "ApprovePro is not live",
  code: "APPROVEPRO_DISABLED",
  disabled: true,
});

export const approveProDisabledResponse = (): Response =>
  new Response(JSON.stringify(approveProDisabledPayload()), {
    status: 503,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
