/**
 * WorkOrderSheet — the clean, readable Work Order document body.
 *
 * Extracted from WpwOrderPrint so the exact same layout renders in two
 * places: the printable /wpw-orders/:id/print page AND inside ApprovePro's
 * "Order / Work Order" tab. Pure presentation — give it a WpwOrder and it
 * lays out customer, ship/bill addresses, an items table (SKU / Qty /
 * Total), totals, tracking, customer note, and uploaded artwork + files.
 */
import type { WpwOrder } from "@/hooks/useWpwOrders";
import {
  extractBriefAndUploads,
  fileNameFromUrl,
  segmentNoteText,
} from "@/lib/wpw-order-extract";

const currency = (n: number | null | undefined, code?: string | null) => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const addressLines = (addr: Record<string, unknown> | null | undefined): string[] => {
  if (!addr) return [];
  const get = (k: string) => (typeof addr[k] === "string" ? (addr[k] as string) : "");
  const name = [get("first_name"), get("last_name")].filter(Boolean).join(" ");
  const company = get("company");
  const street = [get("address_1"), get("address_2")].filter(Boolean).join(", ");
  const cityLine = [get("city"), get("state"), get("postcode")].filter(Boolean).join(", ");
  const country = get("country");
  return [name, company, street, cityLine, country].filter(Boolean);
};

interface WorkOrderSheetProps {
  order: WpwOrder;
  /** Hide the "Work Order" title header (caller already shows the order #). */
  hideHeader?: boolean;
}

export function WorkOrderSheet({ order, hideHeader }: WorkOrderSheetProps) {
  const { customerNote, uploads, documents } = extractBriefAndUploads(
    order,
    order.wpw_order_items || [],
  );
  // Only real, named line items render in the table. Synthetic orders
  // (built from an ApprovePro proof for printing) carry a nameless,
  // zero-priced "carrier" row that exists solely to ferry reference-file
  // URLs to extractBriefAndUploads — it must never show as a blank row.
  const displayItems = (order.wpw_order_items || []).filter(
    (it) => (it.name && it.name.trim()) || (it.total != null && it.total > 0),
  );
  const itemCount = displayItems.length;
  // Hide the totals block entirely when there's no pricing at all (a proof
  // work order isn't an invoice — showing "$0.00" would be misleading).
  const hasPricing =
    (order.total != null && order.total > 0) ||
    (order.subtotal != null && order.subtotal > 0);

  return (
    <div className="text-black">
      {/* Header */}
      {!hideHeader && (
        <header className="flex items-start justify-between border-b-2 border-black pb-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Work Order</h1>
            <p className="text-sm text-neutral-700 mt-0.5">WePrintWraps — production</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-neutral-700">Order</div>
            <div className="text-2xl font-bold font-mono">#{order.order_number || order.id}</div>
            <div className="text-xs text-neutral-600 uppercase tracking-wide mt-0.5">
              {order.status?.replace(/-/g, " ") || "—"}
            </div>
          </div>
        </header>
      )}

      {/* Customer + dates */}
      <section className="grid grid-cols-2 gap-6 mb-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Customer</div>
          <div className="font-bold">{order.customer_name || "—"}</div>
          {order.customer_email && <div className="text-neutral-700">{order.customer_email}</div>}
          {(order.billing as Record<string, unknown> | null)?.phone ? (
            <div className="text-neutral-700">
              {(order.billing as Record<string, unknown>).phone as string}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Dates</div>
          <div>Placed: {formatDate(order.date_created)}</div>
          {order.date_completed && <div>Completed: {formatDate(order.date_completed)}</div>}
          {order.payment_method && (
            <div className="text-neutral-700 mt-1 text-xs">Paid via {order.payment_method}</div>
          )}
        </div>
      </section>

      {/* Customer note */}
      {customerNote && (
        <section className="border border-neutral-300 bg-neutral-50 rounded p-3 mb-4">
          <div className="text-[10px] uppercase tracking-wide text-neutral-700 font-bold mb-1">
            Customer Note
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed break-words">
            {segmentNoteText(customerNote).map((seg, i) =>
              seg.kind === "url" ? (
                <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer" className="underline break-all">
                  {seg.value}
                </a>
              ) : (
                <span key={i}>{seg.value}</span>
              ),
            )}
          </p>
        </section>
      )}

      {/* Customer-uploaded artwork — shown high on the sheet so production
          sees the design before the line-item detail. */}
      {uploads.length > 0 && (
        <section className="mb-4 break-inside-avoid">
          <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1 font-bold">
            Customer-Uploaded Artwork ({uploads.length})
          </div>
          <div className="grid grid-cols-3 gap-2">
            {uploads.map((url) => (
              <div key={url} className="border border-neutral-300 rounded overflow-hidden">
                <img
                  src={url}
                  alt={fileNameFromUrl(url)}
                  className="w-full aspect-square object-contain bg-neutral-100"
                  loading="lazy"
                />
                <div className="p-1 text-[9px] font-mono break-all">
                  <div className="font-bold truncate">{fileNameFromUrl(url)}</div>
                  <div className="text-neutral-600 truncate">{url}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Line items */}
      {itemCount > 0 && (
        <section className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1 font-bold">
            Items ({itemCount})
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-1 pr-2 font-bold">Item</th>
                <th className="text-left py-1 pr-2 font-bold w-32">SKU</th>
                <th className="text-right py-1 pr-2 font-bold w-12">Qty</th>
                <th className="text-right py-1 font-bold w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((it) => (
                <tr key={it.id} className="border-b border-neutral-300">
                  <td className="py-1 pr-2">{it.name || "—"}</td>
                  <td className="py-1 pr-2 text-neutral-700 font-mono text-xs">{it.sku || "—"}</td>
                  <td className="py-1 pr-2 text-right font-mono">{it.quantity ?? 1}</td>
                  <td className="py-1 text-right font-mono">{currency(it.total, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* Tracking */}
      {(order.tracking_number || order.tracking_url) && (
        <section className="border border-neutral-300 bg-neutral-50 rounded p-3 mb-4 text-sm">
          <div className="text-[10px] uppercase tracking-wide text-neutral-700 font-bold mb-1">Tracking</div>
          <div>
            {order.tracking_carrier && <span className="font-bold mr-2">{order.tracking_carrier}:</span>}
            <span className="font-mono">{order.tracking_number || "—"}</span>
            {order.tracking_url && <span className="ml-2 break-all underline">{order.tracking_url}</span>}
          </div>
        </section>
      )}

      {/* Customer files */}
      {documents.length > 0 && (
        <section className="mb-4 break-inside-avoid">
          <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1 font-bold">
            Customer Files ({documents.length})
          </div>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            {documents.map((url) => (
              <li key={url}>
                <span className="font-mono">{fileNameFromUrl(url)}</span>
                <div className="text-[10px] text-neutral-700 font-mono break-all">{url}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Addresses + price — pinned to the bottom of the work order.
          Shipping/billing on the left, order total alongside on the right. */}
      {((order.shipping || order.billing) || hasPricing) && (
        <section className="grid grid-cols-2 gap-6 mt-6 pt-4 border-t-2 border-black text-sm break-inside-avoid">
          {/* Ship To / Bill To */}
          <div className="space-y-3">
            {order.shipping && addressLines(order.shipping).length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Ship To</div>
                {addressLines(order.shipping).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            {order.billing && addressLines(order.billing).length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Bill To</div>
                {addressLines(order.billing).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* Price — sits next to the addresses */}
          {hasPricing && (
            <div className="flex justify-end">
              <table className="text-sm h-fit">
                <tbody>
                  {order.subtotal != null && (
                    <tr>
                      <td className="text-neutral-700 pr-4 py-0.5">Subtotal</td>
                      <td className="text-right font-mono py-0.5">{currency(order.subtotal, order.currency)}</td>
                    </tr>
                  )}
                  {order.shipping_total != null && order.shipping_total > 0 && (
                    <tr>
                      <td className="text-neutral-700 pr-4 py-0.5">Shipping</td>
                      <td className="text-right font-mono py-0.5">{currency(order.shipping_total, order.currency)}</td>
                    </tr>
                  )}
                  {order.tax_total != null && order.tax_total > 0 && (
                    <tr>
                      <td className="text-neutral-700 pr-4 py-0.5">Tax</td>
                      <td className="text-right font-mono py-0.5">{currency(order.tax_total, order.currency)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-black">
                    <td className="font-bold pr-4 py-0.5 pt-1">Total</td>
                    <td className="text-right font-mono font-bold py-0.5 pt-1">{currency(order.total, order.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
