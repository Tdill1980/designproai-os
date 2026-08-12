/**
 * PackPaymentResume — closes the "charged and stuck" gap on the Production Pack.
 *
 * create-print-pack-checkout returns the customer to their page with
 * `?pack=success`, and the stripe webhook has already recorded the paid
 * entitlement — but nothing on the frontend read that return, so the build never
 * started and the customer saw an unchanged screen after paying $299.
 *
 * Mounted once at the App root (inside the Router). On `?pack=success` it:
 *   1. resumes the EXACT order the customer placed (render + selection stashed in
 *      sessionStorage before the Stripe redirect — not a reconstructed guess), and
 *   2. strips the pack/session_id params so a refresh can't double-fire.
 * If there is no stash to resume (e.g. they returned in a different tab) it still
 * confirms payment and tells them the one click that finishes the job, so the
 * flow is never silent.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQuickProductionPack } from "@/hooks/useQuickProductionPack";

export function PackPaymentResume() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resumePendingPack } = useQuickProductionPack();
  const handled = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("pack") !== "success" || handled.current) return;
    handled.current = true;

    (async () => {
      let jobId: string | null = null;
      try {
        jobId = await resumePendingPack();
      } catch {
        jobId = null;
      }
      // Clean the URL either way so a refresh doesn't re-trigger.
      params.delete("pack");
      params.delete("session_id");
      const clean = location.pathname + (params.toString() ? `?${params.toString()}` : "");
      navigate(clean, { replace: true });

      if (jobId) {
        toast.success("Payment received — building your production pack now.", { duration: 8000 });
      } else {
        toast.success(
          "Payment received — your production pack is unlocked. Click Order Production Pack to build it.",
          { duration: 12000 },
        );
      }
    })();
  }, [location.search, location.pathname, resumePendingPack, navigate]);

  return null;
}

export default PackPaymentResume;
