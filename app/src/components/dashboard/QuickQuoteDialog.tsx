/**
 * QuickQuoteDialog — dashboard modal that mounts the new
 * QuickQuoteEstimator + wizard intro (the same combo `/quick-quote`
 * uses) inside a Dialog.
 *
 * Replaces the legacy 1,000-line form-driven modal that pre-dated the
 * Phase 2-8 estimator rebuild. Preserves the public prop API
 * (`open` / `onClose` / `initial`) so QuickQuoteCard's voice-mic
 * pre-fill keeps working — voice fills the estimator's vehicle +
 * customer context on open instead of the old form fields.
 *
 * Save / Send / Preview WPW cart wire identical to /quick-quote — same
 * `saveQuote` helper, same `send-estimate-email` edge function, same
 * Phase 7 WPW handoff. The dashboard modal and the standalone page
 * now produce identical quote rows.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useEstimator } from "@/hooks/useEstimator";

import { QuickQuoteEstimator } from "@/components/quote/QuickQuoteEstimator";
import {
  ServiceTilePicker,
  type QuoteServiceId,
} from "@/components/quote/ServiceTilePicker";
import {
  JobDescriptionInput,
  type ParsedJobSpec,
} from "@/components/quote/JobDescriptionInput";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";
import {
  TintQuoteForm,
  type TintQuoteFormValue,
} from "@/components/quote/TintQuoteForm";
import { QuickQuoteProductPicker } from "./QuickQuoteProductPicker";

import { saveQuote } from "@/lib/quickquote-db";
import { nextOrderNumber } from "@/lib/bulk-prompt-generator";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_PRODUCT_BY_CATEGORY,
  findProductById,
  type QuoteCategory,
  type QuoteProduct,
} from "@/lib/quote-product-catalog";
import {
  lineItemFromProduct,
  type EstimatorLineItem,
  type EstimatorState,
} from "@/lib/quote-estimator";

// ── Public prop API (kept for backwards-compat with QuickQuoteCard) ─

export interface QuickQuoteDialogInitialState {
  year?: string;
  make?: string;
  model?: string;
  finish?: string;
  colorName?: string;
  service?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerCompany?: string;
  /** No longer drives layout — kept so callers don't break. */
  startTab?: "customer" | "price";
  /**
   * Pre-built estimator line items from a parent that already collected
   * products / qty / rate (e.g. the dashboard QuickQuoteCard). When set,
   * the dialog seeds the estimator with these instead of opening empty,
   * so the user's typed-in total survives the Save / Send action.
   */
  lineItems?: EstimatorLineItem[];
  /**
   * Margin/markup applied as the estimator's tax rate (decimal, e.g.
   * 0.65 = 65%). Lets the dashboard card's "shop cost × 1.65 = customer
   * total" display carry through to the persisted quote.
   */
  marginRate?: number;
}

interface QuickQuoteDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: QuickQuoteDialogInitialState;
  /**
   * Fires after a successful save (draft or send). Lets parents that
   * opened the dialog inline — e.g. the Design Approval Proof sheet —
   * auto-link the freshly-created quote without forcing the rep to
   * retype the quote number into a typeahead.
   */
  onSaved?: (result: {
    quoteId: string;
    quoteNumber: string;
    intent: "draft" | "send";
    vehicle: { year?: string; make?: string; model?: string };
    customer: { name?: string; email?: string; phone?: string };
  }) => void;
}

export const QuickQuoteDialog = ({
  open,
  onClose,
  initial,
  onSaved,
}: QuickQuoteDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: isWpwShop = false } = useIsWpwTenant();

  // After every successful save (draft or send), refresh every list that
  // displays quotes so /quotes, the dashboard LatestQuotesCard, the Recent
  // Activity feed and the per-rep analytics all pick up the new row
  // without a hard reload.
  const invalidateQuoteCaches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-business-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-reg-quote-reps"] });
    queryClient.invalidateQueries({ queryKey: ["pillar-recent-activity"] });
  }, [queryClient]);

  // ─── Estimator state (seeded from voice/initial) ───────────────
  const estimator = useEstimator({
    initial: {
      vehicle: {
        year: initial?.year || undefined,
        make: initial?.make || undefined,
        model: initial?.model || undefined,
      },
      customer: {
        name: initial?.customerName,
        email: initial?.customerEmail,
        phone: initial?.customerPhone,
        company: initial?.customerCompany,
      },
      items: initial?.lineItems ?? [],
      taxRate: initial?.marginRate ?? 0,
    },
  });
  const {
    setVehicle: setEstimatorVehicle,
    setCustomer: setEstimatorCustomer,
    setState: setEstimatorState,
    add: addEstimatorItem,
  } = estimator;

  // If the dialog is opened with new initial values (e.g. voice fired
  // again), update the estimator. Skip the initial mount because
  // useEstimator already seeded from the same `initial`.
  useEffect(() => {
    if (!open) return;
    if (initial?.year || initial?.make || initial?.model) {
      setEstimatorVehicle({
        year: initial.year || undefined,
        make: initial.make || undefined,
        model: initial.model || undefined,
      });
    }
    if (
      initial?.customerName ||
      initial?.customerEmail ||
      initial?.customerPhone ||
      initial?.customerCompany
    ) {
      setEstimatorCustomer({
        name: initial.customerName,
        email: initial.customerEmail,
        phone: initial.customerPhone,
        company: initial.customerCompany,
      });
    }
    // Re-seed line items + margin when re-opened with new card data so
    // the persisted total matches what the QuickQuoteCard displayed.
    if (initial?.lineItems && initial.lineItems.length > 0) {
      (setEstimatorState as unknown as (
        u: (s: EstimatorState) => EstimatorState,
      ) => void)((s) => ({
        ...s,
        items: initial.lineItems!,
        taxRate: initial.marginRate ?? s.taxRate,
      }));
    }
    // Intentionally only fires when dialog OPENS or initial changes,
    // not on every estimator state mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // ─── Wizard state ──────────────────────────────────────────────
  const [wizardService, setWizardService] = useState<QuoteServiceId | null>(
    null,
  );
  const [wizardJobText, setWizardJobText] = useState("");
  const [tintForm, setTintForm] = useState<TintQuoteFormValue>({
    windshield: "70%",
    front: "35%",
    rear: "20%",
    fullSet: true,
    windowCount: 7,
  });

  const [quoteCategory, setQuoteCategory] = useState<QuoteCategory>(
    "color_change",
  );
  const [quoteProductId, setQuoteProductId] = useState<string>(
    DEFAULT_PRODUCT_BY_CATEGORY.color_change,
  );

  // Step 1 — picking a product seeds the estimator with a base line.
  // variantKey "qq-base" makes this idempotent: re-picking replaces.
  const handleQuoteProductChange = (next: {
    category: QuoteCategory;
    product: QuoteProduct;
  }) => {
    setQuoteCategory(next.category);
    setQuoteProductId(next.product.id);
    addEstimatorItem(
      lineItemFromProduct(next.product, {
        source: "catalog",
        variantKey: "qq-base",
      }),
    );
  };

  // Step 3 AI parse → pre-fill estimator vehicle context.
  const handleWizardParsed = useCallback(
    (res: { spec: ParsedJobSpec }) => {
      const s = res.spec;
      setWizardService(s.service_type);
      setEstimatorVehicle({
        year: s.vehicle.year ?? undefined,
        make: s.vehicle.make ?? undefined,
        model: s.vehicle.model ?? undefined,
      });
    },
    [setEstimatorVehicle],
  );

  // ─── Save / Send / WPW cart handlers ───────────────────────────
  const persistEstimate = useCallback(
    async (state: EstimatorState, intent: "draft" | "send") => {
      const vehicleMake = state.vehicle.make;
      const vehicleModel = state.vehicle.model;
      if (!vehicleMake || !vehicleModel) {
        toast({
          title: "Vehicle required",
          description: "Enter year, make, and model before saving the estimate.",
          variant: "destructive",
        });
        return null;
      }
      if (state.items.length === 0) {
        toast({
          title: "Add at least one line",
          description: "An empty estimate can't be saved.",
          variant: "destructive",
        });
        return null;
      }

      const subtotal = state.items.reduce(
        (s, i) => s + i.qty * i.unitPrice,
        0,
      );
      const total = subtotal * (1 + state.taxRate);
      const quoteNumber = nextOrderNumber();

      const result = await saveQuote({
        quoteNumber,
        vehicle: {
          year: state.vehicle.year,
          make: vehicleMake,
          model: vehicleModel,
        },
        toolSource: "dashboard-quickquote",
        sqFt: state.vehicle.sqFt,
        shopCost: subtotal,
        customerTotal: total,
        lineItems: state.items.map((i) => {
          const cat = i.productId ? findProductById(i.productId) : undefined;
          return {
            label: i.label,
            detail: i.description ?? `${i.qty} ${i.unit} × $${i.unitPrice}`,
            amount: i.qty * i.unitPrice,
            quantity: i.qty,
            wooProductId: cat?.wooProductId,
          };
        }),
        renderUrl: state.baseRenderUrl ?? null,
        baseRenderUrl: state.baseRenderUrl,
        precisionMods: state.precisionMods,
        customer: {
          name: state.customer.name,
          email: state.customer.email,
          phone: state.customer.phone,
          company: state.customer.company,
        },
      });

      if (!result) {
        toast({
          title: "Couldn't save the estimate",
          description: "Please try again.",
          variant: "destructive",
        });
        return null;
      }

      invalidateQuoteCaches();
      onSaved?.({
        quoteId: result.quoteId,
        quoteNumber,
        intent,
        vehicle: {
          year: state.vehicle.year,
          make: vehicleMake,
          model: vehicleModel,
        },
        customer: {
          name: state.customer.name,
          email: state.customer.email,
          phone: state.customer.phone,
        },
      });

      if (intent === "draft") {
        toast({
          title: `Saved draft ${quoteNumber}`,
          description: "Quote held in /quotes.",
          action: (
            <ToastAction
              altText="Open in Quotes"
              onClick={() => navigate(`/quotes?id=${result.quoteId}`)}
            >
              Open in Quotes
            </ToastAction>
          ),
        });
        return result.quoteId;
      }

      const customerEmail = state.customer.email?.trim();
      if (!customerEmail) {
        toast({
          title: `Saved ${quoteNumber} — but no customer email`,
          description: "Add the customer's email and click Send again.",
          variant: "destructive",
        });
        return result.quoteId;
      }

      const { error: sendErr } = await supabase.functions.invoke(
        "send-estimate-email",
        { body: { quoteId: result.quoteId } },
      );
      if (sendErr) {
        toast({
          title: `Saved ${quoteNumber}, but email send failed`,
          description: sendErr.message ?? "Resend rejected the message.",
          variant: "destructive",
        });
        return result.quoteId;
      }

      toast({
        title: `Sent ${quoteNumber} to ${customerEmail}`,
        description: "Customer also gets a link to the live estimate.",
        action: (
          <ToastAction
            altText="Open in Quotes"
            onClick={() => navigate(`/quotes?id=${result.quoteId}`)}
          >
            Open in Quotes
          </ToastAction>
        ),
      });
      return result.quoteId;
    },
    [toast, invalidateQuoteCaches, navigate, onSaved],
  );

  const handleSaveDraft = useCallback(
    (state: EstimatorState) => {
      void persistEstimate(state, "draft");
    },
    [persistEstimate],
  );
  const handleSend = useCallback(
    (state: EstimatorState) => {
      void persistEstimate(state, "send");
    },
    [persistEstimate],
  );
  const handleCheckoutOnWpw = useCallback(
    (_state: EstimatorState, cartUrl: string) => {
      window.open(cartUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "WPW cart opened",
        description: "Pre-loaded with the WPW print products from this estimate.",
      });
    },
    [toast],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 bg-rp-elevated border-[#48484a]">
        <div className="p-5 sm:p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-white/15 border border-white/30 flex items-center justify-center shrink-0">
              <Calculator className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">QuickQuote</h2>
              <p className="text-xs text-white/60">
                Pick a product, describe the job, edit the estimate, send to the customer.
              </p>
            </div>
          </div>

          {/* Wizard intro — same as /quick-quote */}
          <section className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-[#60A5FA]">Step 1</div>
              <h3 className="text-base font-semibold text-white mt-1">Pick a product</h3>
            </div>
            <QuickQuoteProductPicker
              category={quoteCategory}
              productId={quoteProductId}
              onChange={handleQuoteProductChange}
              isWpwTenant={isWpwShop}
            />

            <div>
              <div className="text-xs uppercase tracking-wide text-[#60A5FA]">Step 2</div>
              <h3 className="text-base font-semibold text-white mt-1">What kind of job?</h3>
            </div>
            <ServiceTilePicker value={wizardService} onSelect={setWizardService} />

            {wizardService && wizardService !== "tint" && (
              <div className="space-y-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[#60A5FA]">Step 3</div>
                  <h3 className="text-base font-semibold text-white mt-1">
                    Describe the job
                  </h3>
                </div>
                <JobDescriptionInput
                  value={wizardJobText}
                  onChange={setWizardJobText}
                  onParsed={handleWizardParsed}
                />
              </div>
            )}

            {wizardService === "tint" && (
              <div className="space-y-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[#60A5FA]">Step 3</div>
                  <h3 className="text-base font-semibold text-white mt-1">Tint specs</h3>
                </div>
                <TintQuoteForm
                  value={tintForm}
                  onChange={setTintForm}
                  pricePerWindow={45}
                  fullSetPrice={250}
                />
              </div>
            )}

            {(wizardService === "design_only" ||
              wizardService === "color_change" ||
              wizardService === "print_wrap") && (
              <DesignProductsCompareCard />
            )}
          </section>

          {/* Inline estimator */}
          <QuickQuoteEstimator
            value={estimator.state}
            onChange={estimator.setState}
            onSaveDraft={handleSaveDraft}
            onSend={handleSend}
            onCheckoutOnWpw={isWpwShop ? handleCheckoutOnWpw : undefined}
            title="Build the estimate"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
