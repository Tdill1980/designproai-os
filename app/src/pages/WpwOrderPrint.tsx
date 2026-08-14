/**
 * WpwOrderPrint — printable Work Order page for the WPW production team.
 *
 * Why this exists: weprintwraps.com's order print views are slow to
 * load and don't show customer-uploaded artwork. This page renders a
 * single-column letter-paper layout straight from the wpw_orders +
 * wpw_order_items mirror, so the team prints (or "Save as PDF") in
 * under a second from any DesignProAI tab.
 *
 * Data path: tries sessionStorage first (when opened by
 * WpwOrderDetailModal — the modal stores the row before opening this
 * tab so customers can print without a re-fetch). Falls back to
 * `useWpwOrder` direct query for staff arriving via deep link.
 *
 * Auto-prints on load via `window.print()` after the data renders.
 */
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { useWpwOrder } from "@/hooks/useWpwOrders";
import { WorkOrderSheet } from "@/components/wpw/WorkOrderSheet";
import { readStashedOrder } from "@/lib/wpw-print-stash";

export default function WpwOrderPrint() {
  const { id } = useParams<{ id: string }>();
  const orderId = id ? Number(id) : null;
  const stashed = useMemo(() => readStashedOrder(orderId), [orderId]);
  const { data: fetched, isLoading } = useWpwOrder(stashed ? null : orderId);
  const order = stashed ?? fetched;

  // Auto-print once the data renders and every image has loaded.
  // Skip when ?noprint=1 — useful when the team wants to inspect the
  // layout without the dialog. We wait on images because firing
  // window.print() before they decode produces a blank page (the
  // printer's "no content" handling shows up as a firmware/test page).
  useEffect(() => {
    if (!order) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("noprint") === "1") return;

    let cancelled = false;
    let fallbackTimer: number | null = null;

    const fire = () => {
      if (cancelled) return;
      // window.print() can throw in embedded/popup-blocked contexts. Never
      // let it bubble into an error screen — the manual Print button (and
      // the on-screen layout) still work.
      try {
        window.print();
      } catch {
        /* ignore — user can still use the Print button */
      }
    };

    // Wait for every <img> on the page to either load or error, then
    // fire print. Hard fallback at 4 s so a single slow CDN can't
    // block the whole job.
    const imgs = Array.from(document.images || []);
    const pending = imgs.filter((img) => !img.complete);

    if (pending.length === 0) {
      fallbackTimer = window.setTimeout(fire, 400);
    } else {
      let resolved = 0;
      const onResolve = () => {
        resolved += 1;
        if (resolved >= pending.length && !cancelled) {
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          window.setTimeout(fire, 200);
        }
      };
      pending.forEach((img) => {
        img.addEventListener("load", onResolve, { once: true });
        img.addEventListener("error", onResolve, { once: true });
      });
      fallbackTimer = window.setTimeout(fire, 4000);
    }

    return () => {
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, [order]);

  if (isLoading && !stashed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading work order…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black">
        Order not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Screen-only toolbar (hidden in print) */}
      <div className="print:hidden border-b border-neutral-300 bg-neutral-50">
        <div className="max-w-[8.5in] mx-auto px-6 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-700 hover:text-black"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            type="button"
            onClick={() => { try { window.print(); } catch { /* popup/embedded block */ } }}
            className="inline-flex items-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-sm font-bold hover:bg-neutral-800"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="max-w-[8.5in] mx-auto px-6 py-6 print:px-0 print:py-0 print:max-w-none">
        <WorkOrderSheet order={order} />

        {/* Footer */}
        <footer className="border-t border-neutral-300 mt-6 pt-2 text-[10px] text-neutral-600 flex justify-between">
          <span>Generated from DesignProAI · {new Date().toLocaleString("en-US")}</span>
          <span className="font-mono">Order #{order.order_number || order.id}</span>
        </footer>
      </div>

      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
