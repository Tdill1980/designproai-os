/**
 * ProofSourceOfTruth
 *
 * Displays WooCommerce order data and proof metadata in a structured panel.
 * Reads from proof_approvals.metadata (woo_* fields when populated)
 * plus denormalized vehicle/customer/design fields on the proof itself.
 *
 * Light themed panel for the ApprovePro detail view.
 */

import { Badge } from "@/components/ui/badge";
import {
  Database, User, Car as CarIcon, Palette, Package, Hash,
  Calendar, DollarSign, Tag, ShoppingBag,
} from "lucide-react";

interface ProofSourceOfTruthProps {
  customerName: string | null;
  customerEmail: string;
  customerPhone: string | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  designName: string | null;
  finishType: string | null;
  mode: string;
  metadata: Record<string, any> | null;
  createdAt: string;
}

interface FieldRowProps {
  icon: typeof Database;
  label: string;
  value: string | number | null | undefined;
  badge?: boolean;
}

const FieldRow = ({ icon: Icon, label, value, badge }: FieldRowProps) => {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className="w-3.5 h-3.5 text-gray-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-700 block">{label}</span>
        {badge ? (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 mt-0.5 border-gray-200 text-gray-600">
            {String(value)}
          </Badge>
        ) : (
          <span className="text-xs text-gray-700 break-words">{String(value)}</span>
        )}
      </div>
    </div>
  );
};

export const ProofSourceOfTruth = (props: ProofSourceOfTruthProps) => {
  const {
    customerName, customerEmail, customerPhone,
    vehicleYear, vehicleMake, vehicleModel,
    designName, finishType, mode, metadata, createdAt,
  } = props;

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
  const meta = metadata || {};

  const wooOrderId = meta.woo_order_id || meta.order_id;
  const wooOrderNumber = meta.woo_order_number || meta.order_number;
  const wooTotal = meta.woo_total || meta.total;
  const wooStatus = meta.woo_status || meta.order_status;
  const wooProducts = meta.woo_products || meta.products;
  const tierAtCreation = meta.tier_at_creation;
  const lineItemCount = meta.line_item_count;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-[#ec4899]" />
        <h3 className="text-sm font-semibold text-gray-900">Source of Truth</h3>
      </div>

      {/* Customer info */}
      <div className="space-y-0.5 border-b border-gray-100 pb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-700 font-semibold">Customer</span>
        <FieldRow icon={User} label="Name" value={customerName} />
        <FieldRow icon={User} label="Email" value={customerEmail} />
        {customerPhone && <FieldRow icon={User} label="Phone" value={customerPhone} />}
      </div>

      {/* Vehicle + Design */}
      <div className="space-y-0.5 border-b border-gray-100 pb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-700 font-semibold">Vehicle & Design</span>
        <FieldRow icon={CarIcon} label="Vehicle" value={vehicle || null} />
        <FieldRow icon={Palette} label="Design" value={designName} />
        <FieldRow icon={Tag} label="Finish" value={finishType} badge />
        <FieldRow icon={Package} label="Mode" value={mode === "sign_only" ? "Sign Only" : "Revision Loop"} badge />
      </div>

      {/* WooCommerce / Order data */}
      {(wooOrderId || wooOrderNumber || wooTotal || wooStatus) && (
        <div className="space-y-0.5 border-b border-gray-100 pb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-700 font-semibold">
            WooCommerce Order
          </span>
          <FieldRow icon={Hash} label="Order #" value={wooOrderNumber || wooOrderId} />
          {wooStatus && <FieldRow icon={ShoppingBag} label="Order Status" value={wooStatus} badge />}
          {wooTotal && <FieldRow icon={DollarSign} label="Total" value={`$${Number(wooTotal).toFixed(2)}`} />}
          {Array.isArray(wooProducts) && wooProducts.length > 0 && (
            <div className="py-1.5">
              <div className="flex items-start gap-2">
                <Package className="w-3.5 h-3.5 text-gray-700 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="text-[10px] uppercase tracking-wider text-gray-700 block">Products</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {wooProducts.map((p: any, i: number) => (
                      <li key={i} className="text-xs text-gray-600">
                        {p.name || p.product_name || `Item ${i + 1}`}
                        {p.quantity && p.quantity > 1 ? ` x${p.quantity}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-0.5">
        <span className="text-[10px] uppercase tracking-wider text-gray-700 font-semibold">Proof Metadata</span>
        <FieldRow icon={Calendar} label="Created" value={new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} />
        {tierAtCreation && <FieldRow icon={Tag} label="Tier at creation" value={tierAtCreation} badge />}
        {lineItemCount && <FieldRow icon={Hash} label="Line items" value={lineItemCount} />}
      </div>
    </div>
  );
};
