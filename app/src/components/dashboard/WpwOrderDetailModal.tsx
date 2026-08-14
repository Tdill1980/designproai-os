/**
 * WpwOrderDetailModal — in-app order viewer.
 *
 * Replaces the previous "open weprintwraps.com/my-account/view-order/<id>/"
 * deep-link, which 404'd ("Invalid order") because:
 *   - The Woo URL takes the internal order ID, not the visible order_number
 *   - The user must be logged into weprintwraps.com to see anything
 *
 * Pulls everything from the wpw_orders + wpw_order_items mirror that's
 * already kept in sync by wpw-sync-orders. No external auth required.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Package,
  Truck,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  FileImage,
  FileText,
  Download,
  StickyNote,
  Repeat2,
  Clock,
  ArrowRight,
  Printer,
} from "lucide-react";
import {
  useWpwOrder,
  useReorderWpw,
  useCustomerPastWpwOrders,
  useCanUpdateWpwStatus,
  useUpdateWpwStatus,
  WPW_NEXT_STATUS,
  wpwStatusClass,
  wpwStatusLabel,
  type WpwOrder,
} from "@/hooks/useWpwOrders";
import { cn } from "@/lib/utils";
import { extractBriefAndUploads, extractItemOptions, fileNameFromUrl, segmentNoteText, downloadProxyUrl } from "@/lib/wpw-order-extract";
import { downloadWorkOrderPdf } from "@/lib/wpw-work-order-pdf";

interface WpwOrderDetailModalProps {
  orderId: number | null;
  onClose: () => void;
  /**
   * Pre-fetched order to render without hitting `useWpwOrder`. Required
   * for paying customers viewing their own jobs in MyWpwOrders — direct
   * `wpw_orders` queries are blocked by RLS for non-admin users (the
   * `users read own wpw orders` policy keys on `wpw_orders.user_id`,
   * which is null on every row), so the customer's order list comes
   * from the `wpw-orders-read` edge function and the row is handed
   * straight to the modal here. WPW staff (admin role) keep using the
   * direct-query path from the dashboard pillars.
   */
  initialOrder?: WpwOrder | null;
  /**
   * Optional extra content rendered near the top of the modal body.
   * ApprovePro uses this to inject the design-assignment control (claim /
   * assign / open in workbench). Dashboard callers leave it undefined.
   */
  actionsExtra?: ReactNode;
  /**
   * The full set of orders for this customer, already loaded by the
   * caller (e.g. MyWpwOrders has them from `wpw-orders-read`). When
   * provided, the "Past artwork from this customer" section reads from
   * here instead of firing a `wpw_orders` direct query — necessary for
   * customers, since their RLS scope returns 0 rows on direct queries.
   */
  customerOrders?: WpwOrder[] | null;
  /**
   * Staff/team context (ApprovePro rail, /orders). Enables team-only actions
   * like "Request instructions & artwork from customer". Leave false on
   * customer-facing surfaces (MyWpwOrders).
   */
  staffActions?: boolean;
}

const currency = (amount: number | null | undefined, code?: string | null) => {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const addressLines = (addr: Record<string, unknown> | null): string[] => {
  if (!addr) return [];
  const get = (k: string) => (typeof addr[k] === "string" ? (addr[k] as string) : "");
  const name = [get("first_name"), get("last_name")].filter(Boolean).join(" ");
  const company = get("company");
  const street = [get("address_1"), get("address_2")].filter(Boolean).join(", ");
  const cityLine = [get("city"), get("state"), get("postcode")].filter(Boolean).join(", ");
  const country = get("country");
  return [name, company, street, cityLine, country].filter(Boolean);
};

interface PastArtworkItem {
  url: string;
  orderNumber: string | null;
  date: string | null;
}

export const WpwOrderDetailModal = ({
  orderId,
  onClose,
  initialOrder,
  actionsExtra,
  customerOrders,
  staffActions,
}: WpwOrderDetailModalProps) => {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const open = orderId != null;
  // Skip the direct query when the caller already has the row (customer
  // path via wpw-orders-read). Staff path leaves initialOrder undefined.
  const shouldFetch = open && !initialOrder;
  const { data: fetched, isLoading: isFetching } = useWpwOrder(shouldFetch ? orderId : null);
  const reorder = useReorderWpw();
  const { data: canUpdateStatus = false } = useCanUpdateWpwStatus();
  const updateStatus = useUpdateWpwStatus();

  const order = initialOrder ?? fetched;
  const isLoading = shouldFetch && isFetching;

  const { customerNote, uploads, documents } = order
    ? extractBriefAndUploads(order, order.wpw_order_items || [])
    : { customerNote: null, uploads: [] as string[], documents: [] as string[] };

  // When a staff member opens a WPW order that arrived with NO brief and NO
  // files, automatically email the customer for instructions + artwork and
  // log it as the first correspondence. Idempotent server-side (once per
  // order, keyed by wooOrderId), so re-opening never re-sends.
  const missingDetails = !customerNote && uploads.length === 0 && documents.length === 0;
  const autoFiredRef = useRef<number | null>(null);

  const requestInstructions = async (opts?: { silent?: boolean }) => {
    if (!order?.customer_email) {
      if (!opts?.silent) toast.error("This order has no customer email on file.");
      return;
    }
    setRequesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("request-order-instructions", {
        body: {
          to: order.customer_email,
          customerName: order.customer_name || undefined,
          orderNumber: order.order_number || String(order.id),
          shopName: "WePrintWraps",
          isWpw: true,
          wooOrderId: order.id,
        },
      });
      if (error) throw error;
      setRequested(true);
      if (!opts?.silent) {
        toast.success(
          (data as any)?.skipped
            ? "Already requested — the customer was emailed earlier."
            : `Emailed ${order.customer_email} requesting instructions & artwork.`,
        );
      }
    } catch (e: any) {
      if (!opts?.silent) toast.error(e?.message || "Couldn't send the request — try again.");
    } finally {
      setRequesting(false);
    }
  };

  // Auto-fire once per opened order when details are missing.
  useEffect(() => {
    if (!staffActions || !open || !order || !missingDetails || !order.customer_email) return;
    if (autoFiredRef.current === order.id) return;
    autoFiredRef.current = order.id;
    requestInstructions({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffActions, open, order?.id, missingDetails]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white border-gray-200 text-gray-900">
        {isLoading ? (
          <div className="py-16 flex items-center justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading order…
          </div>
        ) : !order ? (
          <div className="py-16 text-center text-gray-500 text-sm">
            Order not found.
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-3 pr-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shrink-0 shadow-sm">
                    <Package className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-bold text-gray-900">Order #{order.order_number || order.id}</span>
                      <Badge className={cn(wpwStatusClass(order.status), "text-[9px] font-bold uppercase tracking-wider")}>
                        {wpwStatusLabel(order.status)}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 font-normal">
                      Placed {formatDate(order.date_created)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                    {currency(order.total, order.currency)}
                  </div>
                  {order.payment_method && (
                    <p className="text-[10px] text-gray-400 font-normal flex items-center gap-1 justify-end mt-0.5">
                      <CreditCard className="w-3 h-3" />
                      {order.payment_method}
                    </p>
                  )}
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 mt-2">
              {/* Current Status — large prominent banner so the team
                  sees pipeline state at a glance, separate from the
                  small badge in the header. */}
              <section className="rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-1">Current Status</h4>
                  <Badge
                    className={cn(
                      wpwStatusClass(order.status),
                      "text-sm font-bold uppercase tracking-wider px-3 py-1",
                    )}
                  >
                    {wpwStatusLabel(order.status)}
                  </Badge>
                </div>
                {order.date_modified && (
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.15em] text-gray-500">Last update</p>
                    <p className="text-xs text-gray-700">{formatDate(order.date_modified)}</p>
                  </div>
                )}
              </section>

              {actionsExtra}

              {/* Missing details — auto-emails the customer for a brief + artwork */}
              {staffActions && missingDetails && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 flex items-center gap-1.5">
                      <Mail className="w-3 h-3" /> No instructions or artwork yet
                    </h4>
                    {!order?.customer_email ? (
                      <p className="text-xs text-amber-900 mt-1">No customer email on file — can't request automatically.</p>
                    ) : requesting ? (
                      <p className="text-xs text-amber-900 mt-1 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Emailing the customer for instructions &amp; artwork…</p>
                    ) : requested ? (
                      <p className="text-xs text-amber-900 mt-1">✓ We emailed the customer requesting instructions &amp; artwork (logged in the timeline).</p>
                    ) : (
                      <p className="text-xs text-amber-900 mt-1">The customer didn't include a brief or files.</p>
                    )}
                  </div>
                  {order?.customer_email && (
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={requesting}
                      onClick={() => requestInstructions()}
                      className="border-amber-300 text-amber-800 hover:bg-amber-100 rounded-xl shrink-0"
                    >
                      <Mail className="w-3.5 h-3.5 mr-1" />
                      {requested ? "Send again" : "Send now"}
                    </Button>
                  )}
                </section>
              )}

              {/* Customer */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2">Customer</h4>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-900">{order.customer_name || "—"}</p>
                  {order.customer_email && (
                    <a href={`mailto:${order.customer_email}`} className="text-xs text-[#3b82f6] hover:text-[#ec4899] transition flex items-center gap-1.5">
                      <Mail className="w-3 h-3" /> {order.customer_email}
                    </a>
                  )}
                  {(order.billing as Record<string, unknown> | null)?.phone ? (
                    <a
                      href={`tel:${(order.billing as Record<string, unknown>).phone}`}
                      className="text-xs text-[#3b82f6] hover:text-[#ec4899] transition flex items-center gap-1.5"
                    >
                      <Phone className="w-3 h-3" /> {(order.billing as Record<string, unknown>).phone as string}
                    </a>
                  ) : null}
                </div>
              </section>

              {/* Customer note (combined order-level + line-item brief) */}
              {customerNote && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-700 mb-2 flex items-center gap-1.5">
                    <StickyNote className="w-3 h-3" /> Customer Note
                  </h4>
                  <p className="text-xs text-amber-900 whitespace-pre-wrap leading-relaxed break-words">
                    {segmentNoteText(customerNote).map((seg, i) =>
                      seg.kind === "url" ? (
                        <a
                          key={i}
                          href={seg.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#3b82f6] underline decoration-dotted hover:text-[#ec4899] break-all"
                        >
                          {seg.value}
                        </a>
                      ) : (
                        <span key={i}>{seg.value}</span>
                      ),
                    )}
                  </p>
                </section>
              )}

              {/* Line items */}
              {order.wpw_order_items && order.wpw_order_items.length > 0 && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3">
                    Items ({order.wpw_order_items.length})
                  </h4>
                  <div className="space-y-2">
                    {order.wpw_order_items.map((it) => (
                      <div key={it.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
                        {it.image_url ? (
                          <img src={it.image_url} alt="" className="w-12 h-12 rounded-md object-cover border border-gray-200 shrink-0" loading="lazy" />
                        ) : (
                          <div className="w-12 h-12 rounded-md bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 border border-gray-200 flex items-center justify-center shrink-0">
                            <FileImage className="h-5 w-5 text-[#ec4899]" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{it.name || "Item"}</p>
                          {it.sku && <p className="text-[10px] text-gray-500">SKU {it.sku}</p>}
                          {(Number(it.quantity) || 1) > 1 && (
                            <p className="text-[10px] text-gray-500">Qty: {it.quantity}</p>
                          )}
                          {extractItemOptions(it.meta).map((opt, oi) => (
                            <p key={oi} className="text-[10px] text-gray-600 break-words">
                              <span className="font-semibold text-gray-700">{opt.label}:</span> {opt.value}
                            </p>
                          ))}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-gray-900">{currency(it.total, order.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Uploaded artwork — ONLY files uploaded to THIS order. */}
              {uploads.length === 0 ? (
                <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
                  <FileImage className="w-5 h-5 text-gray-400 mx-auto mb-1.5" />
                  <p className="text-sm font-semibold text-gray-700">No artwork uploaded to this order</p>
                  <p className="text-[11px] text-gray-500">The customer didn't attach any files to this order.</p>
                </section>
              ) : (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 flex items-center gap-1.5">
                    <FileImage className="w-3 h-3" /> Uploaded Artwork ({uploads.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {uploads.map((url) => (
                      <a
                        key={url}
                        href={downloadProxyUrl(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="group relative block rounded-lg overflow-hidden border border-gray-200 bg-[#1a1a1a] hover:border-[#3b82f6] transition"
                        title={fileNameFromUrl(url)}
                      >
                        <img
                          src={url}
                          alt={fileNameFromUrl(url)}
                          loading="lazy"
                          className="w-full aspect-square object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white">
                            <Download className="w-3 h-3" /> Download
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {/* Customer documents (PDF / AI / PSD / EPS / SVG / ZIP) */}
              {documents.length > 0 && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 flex items-center gap-1.5">
                    <FileText className="w-3 h-3" /> Customer Files ({documents.length})
                  </h4>
                  <div className="space-y-1.5">
                    {documents.map((url) => (
                      <a
                        key={url}
                        href={downloadProxyUrl(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-200 hover:border-[#3b82f6] transition group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-[#3b82f6] shrink-0" />
                          <span className="text-xs text-gray-900 truncate font-mono">
                            {fileNameFromUrl(url)}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 group-hover:text-[#3b82f6] shrink-0">
                          <Download className="w-3 h-3" /> Download
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {/* Totals */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2">Totals</h4>
                <div className="space-y-1.5 text-sm">
                  {order.subtotal != null && (
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span className="font-mono">{currency(order.subtotal, order.currency)}</span>
                    </div>
                  )}
                  {order.shipping_total != null && order.shipping_total > 0 && (
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Shipping</span>
                      <span className="font-mono">{currency(order.shipping_total, order.currency)}</span>
                    </div>
                  )}
                  {order.tax_total != null && order.tax_total > 0 && (
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Tax</span>
                      <span className="font-mono">{currency(order.tax_total, order.currency)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                    <span className="font-bold text-gray-900 text-base">Total</span>
                    <span className="font-mono font-bold text-gray-900 text-base">{currency(order.total, order.currency)}</span>
                  </div>
                </div>
              </section>

              {/* Tracking / shipping */}
              {(order.tracking_number || order.tracking_url) && (
                <section className="rounded-xl border border-blue-200 bg-gradient-to-r from-[#3b82f6]/5 to-[#ec4899]/5 p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#3b82f6] mb-2 flex items-center gap-1.5">
                    <Truck className="w-3 h-3" /> Tracking
                  </h4>
                  <div className="text-sm text-gray-900">
                    {order.tracking_carrier && <span className="font-semibold">{order.tracking_carrier}: </span>}
                    <span className="font-mono">{order.tracking_number || "—"}</span>
                    {order.tracking_url && (
                      <a
                        href={order.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-3 inline-flex items-center gap-1 text-[11px] text-[#3b82f6] hover:text-[#ec4899] font-bold"
                      >
                        Track <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </section>
              )}

              {/* Addresses */}
              {(order.shipping || order.billing) && (
                <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {order.shipping && addressLines(order.shipping).length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3" /> Ship to
                      </h4>
                      <div className="text-xs text-gray-700 space-y-0.5">
                        {addressLines(order.shipping).map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {order.billing && addressLines(order.billing).length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 flex items-center gap-1.5">
                        <CreditCard className="w-3 h-3" /> Bill to
                      </h4>
                      <div className="text-xs text-gray-700 space-y-0.5">
                        {addressLines(order.billing).map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Dates */}
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Timeline
                </h4>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900">{formatDate(order.date_created)}</span>
                  </div>
                  {order.date_modified && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Last update</span>
                      <span className="text-gray-900">{formatDate(order.date_modified)}</span>
                    </div>
                  )}
                  {order.date_completed && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Completed</span>
                      <span className="text-emerald-600 font-semibold">{formatDate(order.date_completed)}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {canUpdateStatus && WPW_NEXT_STATUS[order.status] && (
                  <Button
                    size="sm"
                    type="button"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      const next = WPW_NEXT_STATUS[order.status];
                      const fromLabel = wpwStatusLabel(order.status);
                      const toLabel = wpwStatusLabel(next);
                      const ok = window.confirm(
                        `Move order #${order.order_number || order.id} from "${fromLabel}" to "${toLabel}"?\n\nWhile preview mode is on, this only logs the change in DesignProAI and does NOT push to weprintwraps.com (no customer emails fire). Flip the WPW_STATUS_WRITE_PREVIEW env var to "false" when you're ready for real Woo writes.`,
                      );
                      if (!ok) return;
                      updateStatus.mutate({
                        orderId: order.id,
                        fromStatus: order.status,
                        toStatus: next,
                      });
                    }}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl"
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1" />
                    {updateStatus.isPending
                      ? "Updating…"
                      : `Move to ${wpwStatusLabel(WPW_NEXT_STATUS[order.status])}`}
                  </Button>
                )}
                <Button
                  size="sm"
                  type="button"
                  onClick={() => downloadWorkOrderPdf(order)}
                  variant="outline"
                  className="border-gray-300 text-gray-900 hover:bg-gray-50 font-bold rounded-xl"
                >
                  <Printer className="h-3.5 w-3.5 mr-1" />
                  Download Work Order PDF
                </Button>
                <Button
                  size="sm"
                  disabled={reorder.isPending}
                  onClick={() => reorder.mutate(order.id)}
                  className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110 text-white font-bold rounded-xl"
                >
                  <Repeat2 className="h-3.5 w-3.5 mr-1" />
                  {reorder.isPending ? "Reordering…" : "Reorder"}
                </Button>
                {order.status === "pending" && order.pay_url && (
                  <Button size="sm" asChild className="bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl">
                    <a href={order.pay_url} target="_blank" rel="noopener noreferrer">
                      <CreditCard className="h-3.5 w-3.5 mr-1" /> Pay Now
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
