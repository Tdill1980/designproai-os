/**
 * AdminShopPricing — Phase 8a.
 *
 * Per-shop pricing admin for the QuickQuote estimator's upsell strip
 * and precision-mod buttons. Each shop opts in to a service by clicking
 * "Use catalog default" then editing the price + unit. Empty rows are
 * shown for catalog services the shop hasn't blessed yet so the shop
 * owner can see exactly what's pending vs priced.
 *
 * Phase 8a (this PR) ships the schema + admin UI only. Phase 8b will
 * wire the estimator + precision-mod buttons to read the per-shop
 * overrides.
 *
 * Layout: three sections matching ServiceCategory — Color change vinyl,
 * Window tint, Upsells/shop services. Each section is a table of rows,
 * one per service key in the catalog.
 */

import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import {
  SERVICE_DEFAULTS,
  SERVICE_CATEGORY_LABELS,
  SERVICE_CATEGORY_DESCRIPTIONS,
  SERVICE_UNIT_LABELS,
  type ServiceCategory,
  type ServiceDefault,
  type ServiceUnit,
} from "@/lib/shop-service-defaults";
import {
  useShopServicePrices,
  type ShopServicePriceRow,
} from "@/hooks/useShopServicePrices";
import { useOrganization } from "@/contexts/OrganizationContext";

const UNIT_OPTIONS: ServiceUnit[] = [
  "each",
  "yard",
  "sqft",
  "linear_foot",
  "hour",
  "window",
];

const CATEGORY_ORDER: ServiceCategory[] = ["color_change", "tint", "upsell"];

export default function AdminShopPricing() {
  const { currentShop, isLoading: orgLoading } = useOrganization();
  const { byKey, isLoading, upsert, remove } = useShopServicePrices();
  const { toast } = useToast();

  if (orgLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white/60 p-8">
        Sign in to a shop to manage pricing.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>Shop pricing — {currentShop.name}</title>
      </Helmet>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Shop pricing</h1>
          <p className="text-sm text-white/60">
            Set what {currentShop.name} charges for color change vinyl, window
            tint, and upsell services. The QuickQuote estimator uses these
            prices instead of catalog defaults — empty rows fall back to the
            catalog default until you set your own.
          </p>
        </header>

        {CATEGORY_ORDER.map((category) => {
          const items = SERVICE_DEFAULTS.filter((s) => s.category === category);
          return (
            <section key={category} className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">
                  {SERVICE_CATEGORY_LABELS[category]}
                </h2>
                <p className="text-xs text-white/50 mt-0.5">
                  {SERVICE_CATEGORY_DESCRIPTIONS[category]}
                </p>
              </div>

              <Card className="bg-rp-surface border-[#48484a] overflow-hidden">
                <div className="divide-y divide-[#2a2a2a]">
                  {items.map((service) => (
                    <PricingRow
                      key={service.service_key}
                      service={service}
                      row={byKey[service.service_key]}
                      isLoading={isLoading}
                      onUseDefault={async () => {
                        await upsert({
                          service_key: service.service_key,
                          label: service.label,
                          unit_price: service.default_price,
                          unit: service.default_unit,
                          is_active: true,
                        });
                        toast({
                          title: "Default applied",
                          description: `${service.label} now priced at $${service.default_price.toLocaleString()} / ${SERVICE_UNIT_LABELS[service.default_unit]}.`,
                        });
                      }}
                      onSave={async (next) => {
                        await upsert(next);
                        toast({
                          title: "Saved",
                          description: `${next.label} updated.`,
                        });
                      }}
                      onRemove={async () => {
                        await remove(service.service_key);
                        toast({
                          title: "Reset",
                          description: `${service.label} cleared. Falls back to catalog default until you re-add it.`,
                        });
                      }}
                    />
                  ))}
                </div>
              </Card>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────

interface PricingRowProps {
  service: ServiceDefault;
  row: ShopServicePriceRow | undefined;
  isLoading: boolean;
  onUseDefault: () => Promise<void>;
  onSave: (input: {
    service_key: string;
    label: string;
    unit_price: number;
    unit: ServiceUnit;
    is_active: boolean;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
}

function PricingRow({
  service,
  row,
  isLoading,
  onUseDefault,
  onSave,
  onRemove,
}: PricingRowProps) {
  const [label, setLabel] = useState<string | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [unit, setUnit] = useState<ServiceUnit | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const hasOverride = !!row;

  const effectiveLabel = label ?? row?.label ?? service.label;
  const effectivePrice =
    price ?? (row ? String(row.unit_price) : "");
  const effectiveUnit = unit ?? row?.unit ?? service.default_unit;
  const effectiveActive = active ?? row?.is_active ?? true;

  const dirty =
    hasOverride &&
    (label !== null ||
      price !== null ||
      unit !== null ||
      active !== null) &&
    (effectiveLabel !== row.label ||
      Number(effectivePrice) !== Number(row.unit_price) ||
      effectiveUnit !== row.unit ||
      effectiveActive !== row.is_active);

  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-3">
      {/* Label + service-key + description */}
      <div className="min-w-0 flex-1">
        {hasOverride ? (
          <Input
            value={effectiveLabel}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            className="bg-black border-[#48484a] text-white h-9 text-sm font-medium"
          />
        ) : (
          <p className="text-sm font-medium text-white">{service.label}</p>
        )}
        {service.description && (
          <p className="text-[11px] text-white/45 mt-0.5">
            {service.description}
          </p>
        )}
      </div>

      {/* Empty state — opt-in button */}
      {!hasOverride ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40 tabular-nums">
            Default ${service.default_price.toLocaleString()} /{" "}
            {SERVICE_UNIT_LABELS[service.default_unit]}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isLoading || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onUseDefault();
              } finally {
                setBusy(false);
              }
            }}
            className="border-[#48484a] bg-black/40 text-white hover:bg-white/5"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Use catalog default
          </Button>
        </div>
      ) : (
        <>
          {/* Price */}
          <div className="flex items-center gap-1">
            <span className="text-white/50 text-sm">$</span>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={effectivePrice}
              onChange={(e) => setPrice(e.target.value)}
              disabled={busy}
              className="bg-black border-[#48484a] text-white h-9 w-24 text-sm tabular-nums text-right"
            />
          </div>

          {/* Unit */}
          <Select
            value={effectiveUnit}
            onValueChange={(v) => setUnit(v as ServiceUnit)}
            disabled={busy}
          >
            <SelectTrigger className="bg-black border-[#48484a] text-white h-9 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((u) => (
                <SelectItem key={u} value={u}>
                  per {SERVICE_UNIT_LABELS[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Active toggle */}
          <div className="flex items-center gap-1.5">
            <Switch
              checked={effectiveActive}
              onCheckedChange={(c) => setActive(c)}
              disabled={busy}
            />
            <span className="text-[11px] text-white/55">
              {effectiveActive ? "On" : "Off"}
            </span>
          </div>

          {/* Save / Reset to default / Remove */}
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  service_key: service.service_key,
                  label: effectiveLabel,
                  unit_price: Number(effectivePrice) || 0,
                  unit: effectiveUnit,
                  is_active: effectiveActive,
                });
                setLabel(null);
                setPrice(null);
                setUnit(null);
                setActive(null);
              } finally {
                setBusy(false);
              }
            }}
            className="bg-[#60A5FA] text-black hover:bg-[#7ab6ff] h-9"
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  service_key: service.service_key,
                  label: service.label,
                  unit_price: service.default_price,
                  unit: service.default_unit,
                  is_active: true,
                });
                setLabel(null);
                setPrice(null);
                setUnit(null);
                setActive(null);
              } finally {
                setBusy(false);
              }
            }}
            title="Reset this row to the catalog default"
            className="text-white/50 hover:text-white h-9 px-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRemove();
              } finally {
                setBusy(false);
              }
            }}
            title="Remove the override (falls back to catalog default)"
            className="text-white/40 hover:text-red-300 h-9 px-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
