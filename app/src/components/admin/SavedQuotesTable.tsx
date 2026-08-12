/**
 * SavedQuotesTable — Admin view of every quote saved from QuickQuote,
 * matching the reference layout: Quote # / Date / Customer / Request /
 * Est. Price / Actions (email, note, check, call, callback, open).
 *
 * Data source: public.quotes joined with customers + email_log (latest).
 * RLS scopes results to the current shop automatically.
 */

import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Mail, MessageSquare, CheckCircle2, Phone, PhoneCall, FileText, Loader2, Eye, X, Download, Package, BookOpen, ExternalLink, Pencil, FileImage } from "lucide-react";
import {
  QUICK_QUOTE_PREFILL_KEY,
  type QuickQuoteCardInitial,
} from "@/components/dashboard/QuickQuoteCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEmailDeliveryStatus, summarizeDeliveryStatus } from "@/hooks/useEmailDeliveryStatus";
import { generateQuotePDF, type QuotePDFData } from "@/lib/quote-pdf-generator";
import { buildPayUrl } from "@/lib/pay-link";
import { generateWrapCarePDF, type WrapCarePDFData } from "@/lib/wrap-care-pdf-generator";

const db = supabase as any;

interface SavedQuoteRow {
  id: string;
  quote_number: string;
  created_at: string;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  manufacturer: string | null;
  color_name: string | null;
  finish: string | null;
  category: string | null;
  sq_ft: number | null;
  yards_needed: number | null;
  customer_total: number | null;
  shop_cost: number | null;
  margin_percent: number | null;
  status: string | null;
  line_items: Array<{ label: string; detail?: string; amount: number }> | null;
  last_email_at: string | null;
  last_email_type: string | null;
  render_url: string | null;
  tool_source: string | null;
  // Phase 6a: estimator render persistence
  base_render_url: string | null;
  precision_mod_renders:
    | Array<{ key: string; label: string; renderUrl: string; lineItemId?: string }>
    | null;
  customers: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  // Saved-by attribution. `created_by` is the auth.users uuid, populated for
  // every quote saved through QuickQuote / product tools after this commit.
  // The display label (`saved_by_label`) is resolved client-side either from
  // the row's metadata snapshot or from a shop_members lookup so we can
  // render "Saved by Jackson" without joining auth.users.
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  // Origin lane: "internal" = staff-entered via QuickQuote / tools,
  // "public-tool" = the embeddable quote tool on the shop's public page
  // (writes to customer_quotes), so WPW homepage submissions surface here.
  source: "internal" | "public-tool";
  saved_by_label: string;
  /** Public share token for /q/:token customer-facing preview. Only set on internal quotes. */
  share_token: string | null;
}

/** Safely parse the precision_mod_renders jsonb — array, string, or null */
function safePrecisionMods(
  raw: unknown,
): Array<{ key: string; label: string; renderUrl: string; lineItemId?: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<{ key: string; label: string; renderUrl: string; lineItemId?: string }>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Safely parse line_items — may be an array, a JSON string, or null */
function safeLineItems(raw: unknown): Array<{ label: string; detail?: string; amount: number }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

// WPW pre-designed-fade-wraps pricing (mirrors WpwFadeWrapConfigurator).
// Used to break a single saved FadeWrap line back into one row per
// component (size + addons + roof) on the view dialog so the user can
// see exactly what makes up the total.
const FADEWRAP_COMPONENT_PRICES: Array<{ match: RegExp; label: string; price: number }> = [
  { match: /^small sides$/i,  label: "Small sides (144×59.5)",  price: 600 },
  { match: /^medium sides$/i, label: "Medium sides (172×59.5)", price: 710 },
  { match: /^large sides$/i,  label: "Large sides (200×59.5)",  price: 825 },
  { match: /^xl sides$/i,     label: "XL sides (240×59.5)",     price: 990 },
  { match: /^hood$/i,         label: "Hood (72×59.5)",          price: 160 },
  { match: /^front bumper$/i, label: "Front Bumper (38×120.5)", price: 200 },
  { match: /^rear\+bumper$/i, label: "Rear, including bumper",  price: 395 },
  { match: /^roof small$/i,   label: "Roof — Small (72×59.5)",  price: 160 },
  { match: /^roof medium$/i,  label: "Roof — Medium (110×59.5)", price: 225 },
  { match: /^roof large$/i,   label: "Roof — Large (160×59.5)", price: 330 },
];

const FADEWRAP_LABELS = new Set(["WPW FadeWrap", "RestyleLibrary FadeWrap"]);

/**
 * Expand a saved line item into a list of display rows. Most items pass
 * through untouched; FadeWrap rows split into one row per component
 * (size, addons, roof) using the configurator's known WPW pricing. The
 * trailing finish ("Beige Gloss") rides along on the size row as a
 * cosmetic note. Anything we can't parse falls back to the original row
 * so totals always reconcile.
 */
function expandLineItem(
  item: { label: string; detail?: string; amount: number },
): Array<{ label: string; detail?: string; amount: number }> {
  if (!FADEWRAP_LABELS.has(item.label) || !item.detail) return [item];

  const segments = item.detail
    .split("·")
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+\s*(each|sqft|yards?|hr)/i.test(s));

  const rows: Array<{ label: string; detail?: string; amount: number }> = [];
  let finishNote: string | undefined;
  let matched = 0;

  for (const seg of segments) {
    const hit = FADEWRAP_COMPONENT_PRICES.find((c) => c.match.test(seg));
    if (hit) {
      rows.push({ label: hit.label, amount: hit.price });
      matched += 1;
    } else if (/gloss|matte|satin/i.test(seg)) {
      finishNote = seg;
    }
  }

  if (matched === 0) return [item];

  if (finishNote && rows.length > 0) {
    rows[0] = { ...rows[0], detail: finishNote };
  }

  // Reconcile rounding gaps so the breakdown sums to the saved amount.
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((item.amount - sum) * 100) / 100;
  if (Math.abs(diff) >= 0.01) {
    rows.push({ label: "Adjustment", amount: diff });
  }

  return rows;
}

function formatDateParts(iso: string) {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { short: `${month} ${day}`, time };
}

function IconBtn({
  icon: Icon,
  label,
  onClick,
  color = "text-gray-500",
  active,
}: {
  icon: any;
  label: string;
  onClick?: () => void;
  color?: string;
  active?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "w-8 h-8 rounded-md flex items-center justify-center transition-all border",
              active
                ? "bg-[#0891b2] border-[#0891b2] text-white"
                : "border-[#e5e7eb] hover:border-[#0891b2] hover:bg-[#f0f9ff]",
              !active && color
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const SavedQuotesTable = () => {
  const [search, setSearch] = useState("");
  const [viewingQuote, setViewingQuote] = useState<SavedQuoteRow | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightId = searchParams.get("id");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch shop profile for PDF generation + retarget scheduling
  const { data: shopProfile } = useQuery({
    queryKey: ["shop-profile-for-pdf"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await db
        .from("shop_profiles")
        .select("id, shop_name, shop_logo_url, phone, website, email, shop_voice")
        .eq("user_id", user.id)
        .maybeSingle();
      return data as {
        id: string;
        shop_name: string;
        shop_logo_url: string | null;
        phone: string | null;
        website: string | null;
        email: string | null;
        shop_voice: "formal" | "witty" | null;
      } | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleOpenQuotePDF = async (row: SavedQuoteRow) => {
    const items = safeLineItems(row.line_items);
    const pdfData: QuotePDFData = {
      quoteNumber: row.quote_number,
      createdAt: row.created_at,
      shopName: shopProfile?.shop_name || "RestylePro",
      shopLogoUrl: shopProfile?.shop_logo_url ?? null,
      shopWebsite: shopProfile?.website ?? null,
      payUrl: buildPayUrl(shopProfile?.website, items),
      customer: row.customers ? {
        name: row.customers.name,
        email: row.customers.email,
        phone: row.customers.phone,
      } : undefined,
      vehicle: {
        year: row.vehicle_year,
        make: row.vehicle_make,
        model: row.vehicle_model,
      },
      manufacturer: row.manufacturer,
      colorName: row.color_name,
      finish: row.finish,
      category: row.category,
      sqFt: row.sq_ft,
      yardsNeeded: row.yards_needed,
      shopCost: row.shop_cost,
      customerTotal: Number(row.customer_total) || 0,
      marginPercent: row.margin_percent,
      lineItems: items,
      renderUrl: row.render_url,
      status: row.status,
    };
    await generateQuotePDF(pdfData);
  };

  const handleWrapCarePDF = async (row: SavedQuoteRow) => {
    const careData: WrapCarePDFData = {
      shopName: shopProfile?.shop_name || "RestylePro",
      shopLogoUrl: shopProfile?.shop_logo_url ?? null,
      shopPhone: shopProfile?.phone,
      shopEmail: shopProfile?.email,
      shopWebsite: shopProfile?.website,
      customerName: row.customers?.name,
      vehicle: {
        year: row.vehicle_year,
        make: row.vehicle_make,
        model: row.vehicle_model,
      },
      manufacturer: row.manufacturer,
      colorName: row.color_name,
      finish: row.finish,
      installDate: row.status === "converted" ? row.created_at : undefined,
    };
    await generateWrapCarePDF(careData);
    toast({
      title: "Wrap care sheet downloaded",
      description: `Branded care guide for ${row.customers?.name || "customer"} is ready.`,
    });
  };

  const handleConvertToOrder = async (row: SavedQuoteRow) => {
    // Reverting an order back to a quote: status flip only. We intentionally
    // leave the orders row in place (cancelled state belongs to a future UI).
    if (row.status === "converted") {
      const { error } = await db.from("quotes").update({ status: "quoted" }).eq("id", row.id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Reverted to quote", description: `Quote #${row.quote_number} reverted to quote` });
      queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] });
      return;
    }

    // Forward conversion: call the RPC which inserts into orders, allocates
    // an RP-XXXXXX number from panelizer_order_seq, copies quote snapshot
    // fields, and flips the quote status to "converted". Idempotent — if an
    // order already exists for this quote, the RPC returns its id.
    const { data: orderId, error } = await db.rpc("convert_quote_to_order", {
      p_quote_id: row.id,
      p_source: "manual_convert",
    });
    if (error) {
      toast({ title: "Convert failed", description: error.message, variant: "destructive" });
      return;
    }

    // Read the freshly-allocated order_number so the toast shows the real
    // job number that will flow into ProductionFlow.
    const { data: orderRow } = await db
      .from("orders")
      .select("order_number")
      .eq("id", orderId)
      .maybeSingle();
    const orderNumber = orderRow?.order_number || "";

    toast({
      title: "Converted to order",
      description: orderNumber
        ? `Quote #${row.quote_number} → Order ${orderNumber}`
        : `Quote #${row.quote_number} is now an order`,
    });
    queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] });
  };

  const handleScheduleRetarget = async (row: SavedQuoteRow, days: number) => {
    const recipient = row.customers?.email;
    if (!recipient) {
      toast({
        title: "No email on file",
        description: "Add a customer email before scheduling a follow-up.",
        variant: "destructive",
      });
      return;
    }

    const sendAt = new Date();
    sendAt.setDate(sendAt.getDate() + days);

    // Resolve the MightyMail slug against the shop's voice (defaults to formal)
    const voice = shopProfile?.shop_voice || "formal";
    const templateSlug = `retarget-${days}day-${voice}`;

    const vehicleLabel = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
      .filter(Boolean)
      .join(" ");

    // Embed the actual design the customer was quoted. Falls back to the
    // estimator base render if the hero render was not persisted. The
    // hero block is pre-rendered as HTML so the email row collapses when
    // no render exists instead of leaving a broken <img>.
    const renderUrl = row.render_url || row.base_render_url || "";
    const quoteUrl = row.share_token
      ? `${window.location.origin}/q/${row.share_token}`
      : "";
    const heroRenderBlock = renderUrl
      ? `<tr><td style="padding:0 32px 24px 32px;"><img src="${renderUrl}" alt="Your ${vehicleLabel || "wrap"} render" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;border:1px solid #e2e8f0;" /></td></tr>`
      : "";

    const mergeData: Record<string, string> = {
      customer_name: row.customers?.name || "there",
      customer_email: recipient,
      quote_number: row.quote_number || "",
      quote_total:
        row.customer_total != null
          ? `$${Number(row.customer_total).toFixed(2)}`
          : "",
      // Templates use {{vehicle_name}}; pass both keys so either matches.
      vehicle: vehicleLabel,
      vehicle_name: vehicleLabel,
      vehicle_year: row.vehicle_year || "",
      vehicle_make: row.vehicle_make || "",
      vehicle_model: row.vehicle_model || "",
      manufacturer: row.manufacturer || "",
      color_name: row.color_name || "",
      finish: row.finish || "",
      days_since_quote: String(days),
      // The "relevant design" — embedded as an HTML <img> block in the
      // retarget templates via {{hero_render_block}}. Empty string when
      // no render exists so the row collapses cleanly.
      render_url: renderUrl,
      hero_render_block: heroRenderBlock,
      quote_url: quoteUrl,
    };

    const { data: { user } } = await supabase.auth.getUser();

    // 1) Queue the actual send in scheduled_emails — this is what the
    //    process-scheduled-emails cron worker reads to fire off the email.
    const { error: insertError } = await db.from("scheduled_emails").insert({
      send_at: sendAt.toISOString(),
      template_slug: templateSlug,
      recipient_email: recipient,
      merge_data: mergeData,
      shop_id: shopProfile?.id || null,
      source: "quote_retarget",
      source_ref: row.id,
      status: "pending",
      created_by: user?.id || null,
    });

    if (insertError) {
      toast({
        title: "Schedule failed",
        description: insertError.message,
        variant: "destructive",
      });
      return;
    }

    // 2) Mirror the flag onto the quote so the UI can show "retarget queued".
    const { error: metaError } = await db
      .from("quotes")
      .update({
        metadata: {
          retarget_scheduled: true,
          retarget_send_at: sendAt.toISOString(),
          retarget_days: days,
          retarget_template_slug: templateSlug,
        },
      })
      .eq("id", row.id);

    if (metaError) {
      // Not fatal — the queue row is already in place.
      console.warn("Quote metadata update failed:", metaError.message);
    }

    toast({
      title: `Retarget queued for ${days}d`,
      description: `${recipient} will get "${templateSlug}" on ${sendAt.toLocaleDateString()}.`,
    });
    queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
  };

  const handlePreviewAsCustomer = (row: SavedQuoteRow) => {
    if (!row.share_token) {
      toast({
        title: "No customer link yet",
        description:
          row.source === "public-tool"
            ? "Quotes from the public web tool don't have a share link."
            : "Send the quote once to generate the customer-facing link.",
        variant: "destructive",
      });
      return;
    }
    window.open(`/q/${row.share_token}`, "_blank", "noopener,noreferrer");
  };

  const handleEditQuote = (row: SavedQuoteRow) => {
    if (row.source === "public-tool") {
      toast({
        title: "Public-tool quotes can't be edited here",
        description: "Open it in the WPW admin to edit.",
        variant: "destructive",
      });
      return;
    }
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const lines = safeLineItems(row.line_items);
    const prefill: QuickQuoteCardInitial = {
      quoteNumber: row.quote_number,
      year: row.vehicle_year || undefined,
      make: row.vehicle_make || undefined,
      model: row.vehicle_model || undefined,
      finish: row.finish || undefined,
      customerName: row.customers?.name || undefined,
      customerEmail: row.customers?.email || undefined,
      customerPhone: row.customers?.phone || undefined,
      notes: (meta.notes as string | undefined) ?? undefined,
      // Round-trip the saved line items as free-form custom lines so
      // totals stay identical. The user can adjust labels/prices and
      // re-save; saveQuote upserts on (shop_id, quote_number).
      extraCustomLines: lines.map((l) => ({
        label: [l.label, l.detail].filter(Boolean).join(" — "),
        price: Number(l.amount) || 0,
      })),
    };
    try {
      window.sessionStorage.setItem(QUICK_QUOTE_PREFILL_KEY, JSON.stringify(prefill));
    } catch {
      /* sessionStorage disabled — non-fatal, user just gets a blank dashboard */
    }
    setViewingQuote(null);
    navigate("/dashboard");
    toast({
      title: `Editing ${row.quote_number}`,
      description: "Make changes and click Save Quote to overwrite the saved row.",
    });
  };

  const handleSendNow = async (row: SavedQuoteRow) => {
    if (!row.customers?.email) {
      toast({ title: "No email on file", description: "Add an email to this customer first.", variant: "destructive" });
      return;
    }
    // Was: window.open(mailto:…) — that just opened the operator's mail
    // client and dropped the entire branded HTML + Pay button + render.
    // Now we invoke send-estimate-email directly so the customer gets
    // the same green Pay Now CTA + share link they get from the
    // Dashboard QuickQuote Send button.
    toast({ title: `Sending ${row.quote_number}…`, description: row.customers.email });
    let sendErr: { message?: string } | null = null;
    try {
      const { error } = await supabase.functions.invoke("send-estimate-email", {
        body: { quoteId: row.id },
      });
      sendErr = error as { message?: string } | null;
    } catch (e) {
      sendErr = { message: (e as Error)?.message ?? "Network error" };
    }
    if (sendErr) {
      toast({
        title: `Send FAILED for ${row.quote_number}`,
        description: sendErr.message ?? "Try again in a moment.",
        variant: "destructive",
        duration: 12000,
      });
      return;
    }
    toast({
      title: `Sent ${row.quote_number} to ${row.customers.email}`,
      description: "Customer also gets a link to the live estimate.",
    });
    queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
  };

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const { data: quotes, isLoading } = useQuery<SavedQuoteRow[]>({
    queryKey: ["admin-saved-quotes"],
    queryFn: async () => {
      // Pull both lanes in parallel: staff-entered quotes (`quotes`) and
      // public-tool submissions from the shop's homepage embed
      // (`customer_quotes`). RLS scopes both to the current shop.
      const [internalRes, publicRes, shopsRes, teamOwnersRes] = await Promise.all([
        db
          .from("quotes")
          .select(
            `id, quote_number, created_at, vehicle_year, vehicle_make, vehicle_model,
             manufacturer, color_name, finish, category, sq_ft, yards_needed,
             customer_total, shop_cost, margin_percent, status, line_items,
             last_email_at, last_email_type, render_url, tool_source,
             base_render_url, precision_mod_renders, created_by, metadata,
             share_token, shop_id,
             customers ( id, name, email, phone )`,
          )
          .not("quote_number", "like", "DEMO-%")
          .order("created_at", { ascending: false })
          .limit(2000),
        db
          .from("customer_quotes")
          .select(
            `id, created_at, vehicle_year, vehicle_make, vehicle_model,
             film_manufacturer, film_finish, film_name, total_sqft,
             quote_total, status, render_url,
             customer_name, customer_email, customer_phone`,
          )
          .order("created_at", { ascending: false })
          .limit(2000),
        // Pull shop owner identities so legacy quotes saved before the
        // metadata.created_by_email path existed (created_by IS NULL)
        // can still attribute to a person — the shop owner — instead of
        // a generic "Untagged staff" bucket the rep can't make sense of.
        db
          .from("shop_profiles")
          .select("id, shop_name, email"),
        // RPC backed by SECURITY DEFINER joins auth.users so we get
        // the real teammate email even when shop_profiles.email is
        // NULL (it almost always is). Returns rows for every shop
        // owned by a teammate sharing the current user's email
        // domain — the same set the team_email_domain_select RLS
        // policy unlocks for the quotes query above.
        (db as any).rpc("team_shop_owners"),
      ]);

      const shopOwnerById = new Map<string, { name: string | null; email: string | null }>();
      ((shopsRes?.data as any[]) || []).forEach((s) => {
        shopOwnerById.set(s.id as string, {
          name: (s.shop_name as string | null) ?? null,
          email: (s.email as string | null) ?? null,
        });
      });
      // Overlay RPC-backed owner emails (auth.users) on top so we
      // always get the live teammate email, not the often-NULL
      // shop_profiles.email column.
      ((teamOwnersRes?.data as any[]) || []).forEach((s) => {
        const existing = shopOwnerById.get(s.shop_id as string) || { name: null, email: null };
        shopOwnerById.set(s.shop_id as string, {
          name: (s.shop_name as string | null) ?? existing.name,
          email: (s.owner_email as string | null) ?? existing.email,
        });
      });

      if (internalRes?.error) throw internalRes.error;
      if (publicRes?.error) console.warn("customer_quotes fetch failed:", publicRes.error.message);

      const isDemo = (name: string | null | undefined, email: string | null | undefined) => {
        const n = name?.toLowerCase() || "";
        const e = email?.toLowerCase() || "";
        if (n.includes("demo") || n.includes("(sample)")) return true;
        if (e.startsWith("demo@") || e.includes("@example.")) return true;
        return false;
      };

      const internal: SavedQuoteRow[] = ((internalRes?.data as any[]) || [])
        .filter((q) => !isDemo(q.customers?.name, q.customers?.email))
        .map((q) => {
          const meta = (q.metadata || {}) as Record<string, unknown>;
          const metaLabel =
            (meta.created_by_name as string | undefined) ||
            (meta.created_by_email as string | undefined) ||
            null;
          // Fallback chain: metadata → shop owner → "Team" (created_by
          // exists but no profile match) → "Unknown" (no auth + no shop).
          // Legacy quotes saved before the metadata path existed were
          // landing in "Untagged staff"; the shop-owner fallback keeps
          // them attributed to a real person on the team.
          const owner = q.shop_id ? shopOwnerById.get(q.shop_id) : undefined;
          const ownerLabel = owner?.email || owner?.name || null;
          return {
            ...q,
            source: "internal" as const,
            saved_by_label:
              metaLabel ||
              ownerLabel ||
              (q.created_by ? "Team" : "Unknown"),
          };
        });

      const pub: SavedQuoteRow[] = ((publicRes?.data as any[]) || [])
        .filter((q) => !isDemo(q.customer_name, q.customer_email))
        .map((q) => ({
          id: q.id,
          quote_number: `RP-${String(q.id).slice(0, 6).toUpperCase()}`,
          created_at: q.created_at,
          vehicle_year: q.vehicle_year,
          vehicle_make: q.vehicle_make,
          vehicle_model: q.vehicle_model,
          manufacturer: q.film_manufacturer,
          color_name: q.film_name,
          finish: q.film_finish,
          category: null,
          sq_ft: q.total_sqft,
          yards_needed: null,
          customer_total: q.quote_total,
          shop_cost: null,
          margin_percent: null,
          status: q.status,
          line_items: null,
          last_email_at: null,
          last_email_type: null,
          render_url: q.render_url,
          tool_source: "public-tool",
          base_render_url: null,
          precision_mod_renders: null,
          customers: q.customer_name || q.customer_email || q.customer_phone
            ? { id: q.id, name: q.customer_name, email: q.customer_email, phone: q.customer_phone }
            : null,
          created_by: null,
          metadata: null,
          source: "public-tool" as const,
          saved_by_label: "Public tool",
          share_token: null,
        }));

      return [...internal, ...pub].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
  });

  // Auto-open view modal when ?id= is in URL (from LatestQuotesCard click)
  useEffect(() => {
    if (!highlightId || !quotes) return;
    const target = quotes.find((q) => q.id === highlightId);
    if (target && !viewingQuote) {
      setViewingQuote(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, quotes]);

  const quoteIds = useMemo(
    () => (quotes ?? []).map((q) => q.id).filter(Boolean),
    [quotes],
  );
  const { data: deliveryStatuses } = useEmailDeliveryStatus(quoteIds);

  // Design-proof assets per quote. The Design Approval Proof flow writes
  // these via attachAsset() with asset_type='photoreal_proof' (or
  // 'studio_proof' / 'panel_pdf' for related artifacts). We surface a
  // FileImage icon on rows that have at least one so the rep can open
  // the proof PDF straight from the quote list.
  const { data: proofAssetsByQuote } = useQuery<Map<string, Array<{ id: string; url: string; label: string | null; asset_type: string; created_at: string | null }>>>({
    queryKey: ["admin-saved-quotes-proof-assets", quoteIds],
    enabled: quoteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("quote_assets")
        .select("id, quote_id, url, label, asset_type, created_at")
        .in("quote_id", quoteIds)
        .in("asset_type", ["photoreal_proof", "studio_proof", "panel_pdf"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, Array<{ id: string; url: string; label: string | null; asset_type: string; created_at: string | null }>>();
      ((data as any[]) || []).forEach((row) => {
        const arr = map.get(row.quote_id) || [];
        arr.push({
          id: row.id,
          url: row.url,
          label: row.label,
          asset_type: row.asset_type,
          created_at: row.created_at,
        });
        map.set(row.quote_id, arr);
      });
      return map;
    },
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!quotes) return [];
    let result = quotes;

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((r) => r.status === statusFilter);
    }

    // Date filter
    if (dateFilter !== "all") {
      const days = parseInt(dateFilter);
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      result = result.filter((r) => new Date(r.created_at).getTime() >= since);
    }

    // Source filter — "public-tool" = the homepage embed (customer_quotes
    // lane). "internal" = staff-entered. The legacy "WPW" tool_source is a
    // subset of internal QuickQuote saves.
    if (sourceFilter !== "all") {
      if (sourceFilter === "public-tool") {
        result = result.filter((r) => r.source === "public-tool");
      } else if (sourceFilter === "internal") {
        // Truly-unknown bucket: internal-source quotes whose label
        // resolution couldn't pin them to a person at all.
        result = result.filter(
          (r) => r.source === "internal" && r.saved_by_label === "Unknown",
        );
      } else if (sourceFilter.startsWith("rep:")) {
        const repId = sourceFilter.slice(4);
        result = result.filter((r) => r.created_by === repId);
      } else if (sourceFilter.startsWith("label:")) {
        const label = sourceFilter.slice(6);
        result = result.filter(
          (r) => r.source === "internal" && r.saved_by_label === label,
        );
      }
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) => {
        const c = row.customers;
        return (
          (row.quote_number || "").toLowerCase().includes(q) ||
          (c?.name || "").toLowerCase().includes(q) ||
          (c?.email || "").toLowerCase().includes(q) ||
          (c?.phone || "").includes(q) ||
          `${row.vehicle_year || ""} ${row.vehicle_make || ""} ${row.vehicle_model || ""}`
            .toLowerCase()
            .includes(q)
        );
      });
    }

    return result;
  }, [quotes, search, statusFilter, dateFilter, sourceFilter]);

  // Per-rep counters — group by created_by so the shop can see at a glance
  // how many quotes Jackson / Lance / Trish each saved, plus a public-tool
  // bucket for homepage-embed submissions. Counts respect the active date
  // filter so the strip lines up with what's in the table below.
  const repCounters = useMemo(() => {
    if (!quotes) return [] as { key: string; label: string; count: number }[];
    const dateCutoff =
      dateFilter !== "all"
        ? Date.now() - parseInt(dateFilter) * 24 * 60 * 60 * 1000
        : null;
    const inWindow = (r: SavedQuoteRow) =>
      !dateCutoff || new Date(r.created_at).getTime() >= dateCutoff;

    // Group by saved_by_label (which already incorporates the shop-owner
    // fallback) so legacy quotes attribute to the shop owner alongside
    // their explicitly-tagged ones, rather than falling into a generic
    // "Untagged staff" bucket the rep can't filter by.
    const reps = new Map<string, { label: string; count: number }>();
    let publicCount = 0;
    let trulyUnknownCount = 0;
    for (const r of quotes) {
      if (!inWindow(r)) continue;
      if (r.source === "public-tool") {
        publicCount++;
        continue;
      }
      if (r.saved_by_label === "Unknown") {
        trulyUnknownCount++;
        continue;
      }
      const key = r.created_by || `label:${r.saved_by_label}`;
      const existing = reps.get(key);
      if (existing) {
        existing.count++;
      } else {
        reps.set(key, { label: r.saved_by_label, count: 1 });
      }
    }

    const list: { key: string; label: string; count: number }[] = [];
    for (const [id, { label, count }] of reps.entries()) {
      list.push({ key: id.startsWith("label:") ? id : `rep:${id}`, label, count });
    }
    list.sort((a, b) => b.count - a.count);
    if (publicCount > 0) list.push({ key: "public-tool", label: "Public tool", count: publicCount });
    if (trulyUnknownCount > 0) list.push({ key: "internal", label: "Unknown", count: trulyUnknownCount });
    return list;
  }, [quotes, dateFilter]);

  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-[#e5e7eb] space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#111]">
            Saved Quotes
            <span className="ml-2 text-[10px] font-normal text-[#6b7280]">
              {filtered.length} of {quotes?.length || 0}
            </span>
          </h3>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, vehicle, quote #"
            className="max-w-xs h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="quoted">Quoted</option>
            <option value="sent">Sent</option>
            <option value="converted">Converted</option>
            <option value="pending">Pending</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
          >
            <option value="all">All time</option>
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
          >
            <option value="all">All sources</option>
            <option value="internal">Staff-entered</option>
            <option value="public-tool">Public quote tool</option>
            {repCounters
              .filter((r) => r.key.startsWith("rep:"))
              .map((r) => (
                <option key={r.key} value={r.key}>
                  Saved by {r.label}
                </option>
              ))}
          </select>
          {(statusFilter !== "all" || dateFilter !== "all" || sourceFilter !== "all") && (
            <button
              onClick={() => { setStatusFilter("all"); setDateFilter("all"); setSourceFilter("all"); }}
              className="h-7 text-[11px] font-semibold text-[#ef4444] hover:text-[#dc2626] px-2"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Per-rep counter strip — click a chip to filter the table to that
            rep (or to the public quote tool). Empty when nobody has saved a
            quote yet, so it doesn't add visual noise on a fresh shop. */}
        {repCounters.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">
              Saved by
            </span>
            {repCounters.map((r) => {
              const active = sourceFilter === r.key;
              return (
                <button
                  key={r.key}
                  onClick={() => setSourceFilter(active ? "all" : r.key)}
                  className={cn(
                    "h-6 rounded-full px-2.5 text-[11px] font-semibold border transition-colors",
                    active
                      ? "bg-[#0891b2] text-white border-[#0891b2]"
                      : "bg-white text-[#374151] border-[#d1d5db] hover:bg-[#f3f4f6]",
                  )}
                  title={
                    r.key === "public-tool"
                      ? "Submissions from your homepage quote tool"
                      : r.key === "internal"
                        ? "Staff-entered quotes that pre-date the new attribution"
                        : `Quotes saved by ${r.label}`
                  }
                >
                  {r.label} <span className="opacity-60">· {r.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[120px_90px_1fr_1.2fr_110px_240px] items-center gap-3 px-4 py-2 bg-[#f3f4f6] text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
        <div>Quote #</div>
        <div>Date</div>
        <div>Customer</div>
        <div>Request</div>
        <div className="text-right">Est. Price</div>
        <div className="text-right">Actions</div>
      </div>

      {/* Rows */}
      {isLoading && (
        <div className="py-10 flex items-center justify-center text-[#6b7280]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading quotes…
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="py-10 text-center text-[#6b7280] text-sm">
          No saved quotes yet. Build a quote in QuickQuote and click <span className="font-semibold">Save Quote</span>.
        </div>
      )}
      {filtered.map((row) => {
        const { short, time } = formatDateParts(row.created_at);
        const c = row.customers;
        const hasPrice = row.customer_total != null && row.customer_total > 0;
        const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(" ");
        const hasEmailed = !!row.last_email_at;
        const delivery = summarizeDeliveryStatus(deliveryStatuses?.get(row.id));
        const dotClass = delivery
          ? delivery.tone === "success"
            ? "bg-emerald-500"
            : delivery.tone === "danger"
              ? "bg-red-500"
              : delivery.tone === "info"
                ? "bg-cyan-500"
                : "bg-gray-400"
          : null;
        const proofAssets = proofAssetsByQuote?.get(row.id) || [];
        const hasProof = proofAssets.length > 0;
        const buttonTitle = delivery
          ? `${delivery.label} — ${new Date(delivery.at!).toLocaleString()}`
          : hasEmailed
            ? `Last emailed ${new Date(row.last_email_at!).toLocaleString()}`
            : "Email options";
        return (
          <div
            key={row.id}
            role="button"
            tabIndex={0}
            onClick={() => setViewingQuote(row)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setViewingQuote(row);
              }
            }}
            className="grid grid-cols-[120px_90px_1fr_1.2fr_110px_240px] items-start gap-3 px-4 py-4 border-t border-[#e5e7eb] hover:bg-[#fafafa] transition-colors cursor-pointer focus:outline-none focus-visible:bg-[#f0f9ff]"
          >
            {/* Quote # */}
            <div>
              <p className="text-[13px] font-semibold text-[#111] leading-tight break-all">{row.quote_number}</p>
            </div>
            {/* Date */}
            <div className="text-[12px] text-[#6b7280] leading-tight">
              <p>{short},</p>
              <p>{time}</p>
            </div>
            {/* Customer */}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#111] truncate">{c?.name || "—"}</p>
              {c?.email && <p className="text-[12px] text-[#0891b2] truncate">{c.email}</p>}
              {c?.phone && (
                <p className="text-[12px] text-[#0891b2] flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" /> {c.phone}
                </p>
              )}
              <p className="text-[10px] text-[#9ca3af] truncate mt-1">
                {row.source === "public-tool" ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#ecfeff] text-[#0891b2] font-semibold">
                    Public tool
                  </span>
                ) : (
                  <>Saved by <span className="text-[#374151] font-semibold">{row.saved_by_label}</span></>
                )}
              </p>
            </div>
            {/* Request */}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#111] truncate">{vehicle || "—"}</p>
              <p className="text-[12px] text-[#6b7280]">
                {row.manufacturer || "—"} · {row.sq_ft ? `${row.sq_ft} sqft` : "0 sqft"}
              </p>
            </div>
            {/* Est. Price */}
            <div className="text-right">
              {hasPrice ? (
                <p className="text-[14px] font-bold text-[#111]">${Number(row.customer_total).toFixed(2)}</p>
              ) : (
                <p className="text-[13px] font-bold text-[#dc2626] leading-tight">
                  Needs<br />Quote
                </p>
              )}
            </div>
            {/* Actions */}
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {/* Email with retarget dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "relative w-8 h-8 rounded-md flex items-center justify-center transition-all border",
                      hasEmailed
                        ? "border-[#0891b2] bg-[#f0f9ff] text-[#0891b2]"
                        : "border-[#e5e7eb] hover:border-[#0891b2] hover:bg-[#f0f9ff] text-gray-500"
                    )}
                    title={buttonTitle}
                  >
                    <Mail className="w-4 h-4" />
                    {dotClass && (
                      <span
                        className={cn(
                          "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white",
                          dotClass,
                        )}
                        aria-label={delivery?.label}
                      />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[11px]">Email options</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleSendNow(row)} className="text-xs">
                    <Mail className="w-3 h-3 mr-2" />
                    Send immediately
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] text-[#6b7280]">MightyMail retarget</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleScheduleRetarget(row, 3)} className="text-xs">
                    Schedule 3-day follow-up
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleScheduleRetarget(row, 5)} className="text-xs">
                    Schedule 5-day follow-up
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleScheduleRetarget(row, 7)} className="text-xs">
                    Schedule 7-day follow-up
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Design proof — only renders when the quote has at least one
                  proof asset attached (written by the proof sheet's Save &
                  Share / Email Quote & Proof flows). Dropdown lists each
                  asset so the rep can open the right PDF/image. */}
              {hasProof && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="relative w-8 h-8 rounded-md flex items-center justify-center transition-all border border-[#d946ef] bg-[#fdf4ff] text-[#a21caf] hover:bg-[#fae8ff]"
                      title={`${proofAssets.length} design proof${proofAssets.length === 1 ? "" : "s"} attached`}
                    >
                      <FileImage className="w-4 h-4" />
                      {proofAssets.length > 1 && (
                        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-[#a21caf] text-white text-[9px] font-bold flex items-center justify-center px-1 ring-2 ring-white">
                          {proofAssets.length > 9 ? "9+" : proofAssets.length}
                        </span>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-[11px]">Design proofs</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {proofAssets.map((a) => {
                      const stamp = a.created_at
                        ? new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : "";
                      const kindLabel = a.asset_type === "photoreal_proof"
                        ? "Approval proof"
                        : a.asset_type === "studio_proof"
                          ? "Studio proof"
                          : "Panel PDF";
                      return (
                        <DropdownMenuItem
                          key={a.id}
                          onClick={() => window.open(a.url, "_blank", "noopener,noreferrer")}
                          className="text-xs flex flex-col items-start gap-0.5"
                        >
                          <span className="font-semibold text-[#a21caf]">{kindLabel}</span>
                          <span className="text-[10px] text-[#6b7280] truncate w-full">
                            {a.label || a.url.split("/").pop() || "Open"} · {stamp}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <IconBtn icon={MessageSquare} label="Add note" />

              {/* Convert to Order */}
              <IconBtn
                icon={row.status === "converted" ? Package : CheckCircle2}
                label={row.status === "converted" ? "Order (click to revert)" : "Convert to Order"}
                color={row.status === "converted" ? "text-[#16a34a]" : "text-gray-500"}
                active={row.status === "converted"}
                onClick={() => handleConvertToOrder(row)}
              />

              {c?.phone && (
                <a
                  href={`tel:${c.phone}`}
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-all border border-[#e5e7eb] hover:border-[#16a34a] hover:bg-[#f0fdf4] text-[#16a34a]"
                  title={`Call ${c.phone}`}
                >
                  <Phone className="w-4 h-4" />
                </a>
              )}

              {/* View Quote modal */}
              <IconBtn
                icon={Eye}
                label="View quote"
                color="text-[#0891b2]"
                onClick={() => setViewingQuote(row)}
              />

              {/* Download PDF */}
              <IconBtn
                icon={Download}
                label="Download PDF"
                color="text-white"
                active
                onClick={() => handleOpenQuotePDF(row)}
              />
            </div>
          </div>
        );
      })}

      {/* View Quote Modal — only mount when viewing to avoid Radix TDZ crash */}
      {viewingQuote && (
      <Dialog open onOpenChange={(open) => !open && setViewingQuote(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
          {viewingQuote && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span className="text-[#111]">Quote #{viewingQuote.quote_number}</span>
                  {viewingQuote.status && (
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border",
                      viewingQuote.status === "converted" ? "bg-emerald-50 text-emerald-700 border-emerald-300" :
                      viewingQuote.status === "sent" ? "bg-blue-50 text-blue-700 border-blue-300" :
                      "bg-gray-50 text-gray-700 border-gray-300"
                    )}>
                      {viewingQuote.status === "converted" ? "Order" : viewingQuote.status}
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-[#111]">
                {/* Shop + date */}
                <div className="flex items-center justify-between text-xs text-[#6b7280]">
                  <span>{shopProfile?.shop_name || "RestylePro"}</span>
                  <span>{new Date(viewingQuote.created_at).toLocaleString()}</span>
                </div>

                <div className="border-t border-[#e5e7eb]" />

                {/* Customer & Vehicle */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-1">Customer</h4>
                    {viewingQuote.customers?.name && <p className="text-sm font-semibold">{viewingQuote.customers.name}</p>}
                    {viewingQuote.customers?.email && <p className="text-xs text-[#0891b2]">{viewingQuote.customers.email}</p>}
                    {viewingQuote.customers?.phone && <p className="text-xs text-[#0891b2]">{viewingQuote.customers.phone}</p>}
                    {!viewingQuote.customers?.name && <p className="text-xs text-[#6b7280]">No customer info</p>}
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-1">Vehicle</h4>
                    <p className="text-sm font-semibold">
                      {[viewingQuote.vehicle_year, viewingQuote.vehicle_make, viewingQuote.vehicle_model].filter(Boolean).join(" ") || "—"}
                    </p>
                  </div>
                </div>

                <div className="border-t border-[#e5e7eb]" />

                {/* Product details */}
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-2">Product Details</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {viewingQuote.category && <div><span className="text-[#6b7280]">Category:</span> <span className="font-semibold">{viewingQuote.category}</span></div>}
                    {viewingQuote.manufacturer && <div><span className="text-[#6b7280]">Manufacturer:</span> <span className="font-semibold">{viewingQuote.manufacturer}</span></div>}
                    {viewingQuote.color_name && <div><span className="text-[#6b7280]">Color:</span> <span className="font-semibold">{viewingQuote.color_name}</span></div>}
                    {viewingQuote.finish && <div><span className="text-[#6b7280]">Finish:</span> <span className="font-semibold">{viewingQuote.finish}</span></div>}
                    {viewingQuote.sq_ft && <div><span className="text-[#6b7280]">Sq Ft:</span> <span className="font-semibold">{viewingQuote.sq_ft}</span></div>}
                    {viewingQuote.yards_needed && <div><span className="text-[#6b7280]">Yards:</span> <span className="font-semibold">{viewingQuote.yards_needed}</span></div>}
                  </div>
                </div>

                {/* Render image — Phase 6a shows the full design story:
                    final stacked render at the top, then a visual chain
                    of how precision mods built up to it. */}
                {viewingQuote.render_url && (
                  <>
                    <div className="border-t border-[#e5e7eb]" />
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-1.5">
                          Hero render (final)
                        </div>
                        <img
                          src={viewingQuote.render_url}
                          alt="Hero render"
                          className="w-full rounded-lg border border-[#e5e7eb]"
                        />
                      </div>
                      {(() => {
                        const mods = safePrecisionMods(viewingQuote.precision_mod_renders);
                        if (!viewingQuote.base_render_url && mods.length === 0) return null;
                        return (
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-1.5">
                              Design story · base → {mods.length} precision mod{mods.length === 1 ? "" : "s"}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {viewingQuote.base_render_url && (
                                <figure className="space-y-1">
                                  <img
                                    src={viewingQuote.base_render_url}
                                    alt="Base render"
                                    className="w-full aspect-video rounded-md border border-[#e5e7eb] object-cover"
                                  />
                                  <figcaption className="text-[10px] text-[#6b7280] text-center">
                                    Base
                                  </figcaption>
                                </figure>
                              )}
                              {mods.map((mod, i) => (
                                <figure key={`${mod.key}_${i}`} className="space-y-1">
                                  <img
                                    src={mod.renderUrl}
                                    alt={mod.label}
                                    className="w-full aspect-video rounded-md border border-[#e5e7eb] object-cover"
                                  />
                                  <figcaption className="text-[10px] text-[#6b7280] text-center">
                                    + {mod.label}
                                  </figcaption>
                                </figure>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}

                {/* Attached design proofs — same data the row icon
                    surfaces. Click → opens in a new tab. */}
                {(() => {
                  const assets = proofAssetsByQuote?.get(viewingQuote.id) || [];
                  if (assets.length === 0) return null;
                  return (
                    <>
                      <div className="border-t border-[#e5e7eb]" />
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#a21caf] mb-2">
                          Design Proofs · {assets.length}
                        </h4>
                        <div className="space-y-1">
                          {assets.map((a) => {
                            const stamp = a.created_at
                              ? new Date(a.created_at).toLocaleString()
                              : "";
                            const kindLabel = a.asset_type === "photoreal_proof"
                              ? "Approval proof"
                              : a.asset_type === "studio_proof"
                                ? "Studio proof"
                                : "Panel PDF";
                            return (
                              <a
                                key={a.id}
                                href={a.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-[#fae8ff] bg-[#fdf4ff] hover:bg-[#fae8ff] text-xs"
                              >
                                <FileImage className="w-4 h-4 text-[#a21caf] flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-[#a21caf]">{kindLabel}</p>
                                  <p className="text-[10px] text-[#6b7280] truncate">
                                    {a.label || a.url.split("/").pop()} · {stamp}
                                  </p>
                                </div>
                                <ExternalLink className="w-3 h-3 text-[#a21caf] flex-shrink-0" />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Line Items */}
                {safeLineItems(viewingQuote.line_items).length > 0 && (
                  <>
                    <div className="border-t border-[#e5e7eb]" />
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#0891b2] mb-2">Pricing</h4>
                      <div className="space-y-1">
                        {safeLineItems(viewingQuote.line_items).flatMap((item, idx) => {
                          const rows = expandLineItem(item);
                          return rows.map((row, subIdx) => (
                            <div
                              key={`${idx}-${subIdx}`}
                              className="flex items-center justify-between text-xs py-1 border-b border-[#f1f5f9]"
                            >
                              <div>
                                <span className="font-semibold">{row.label}</span>
                                {row.detail && (
                                  <span className="text-[#6b7280] ml-2">{row.detail}</span>
                                )}
                              </div>
                              <span className="font-mono font-semibold">
                                ${Number(row.amount).toFixed(2)}
                              </span>
                            </div>
                          ));
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* Total */}
                <div className="flex items-center justify-between bg-[#3b82f6] text-white px-4 py-3 rounded-lg">
                  <span className="text-sm font-bold uppercase tracking-wider">Total</span>
                  <span className="text-lg font-bold">${Number(viewingQuote.customer_total || 0).toFixed(2)}</span>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    onClick={() => handlePreviewAsCustomer(viewingQuote)}
                    variant="outline"
                    className="border-[#0891b2] text-[#0891b2] hover:bg-[#ecfeff]"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Preview as customer
                  </Button>
                  <Button
                    onClick={() => handleEditQuote(viewingQuote)}
                    variant="outline"
                    className="border-[#7c3aed] text-[#7c3aed] hover:bg-[#f5f3ff]"
                  >
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit quote
                  </Button>
                  <Button
                    onClick={() => handleOpenQuotePDF(viewingQuote)}
                    className="bg-[#3b82f6] hover:bg-[#2563eb] text-white"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Quote PDF
                  </Button>
                  <Button
                    onClick={() => handleWrapCarePDF(viewingQuote)}
                    variant="outline"
                    className="border-[#ec4899] text-[#ec4899] hover:bg-[#fdf2f8]"
                  >
                    <BookOpen className="w-4 h-4 mr-2" />
                    Wrap Care Sheet
                  </Button>
                  <Button
                    onClick={() => handleSendNow(viewingQuote)}
                    variant="outline"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Email now
                  </Button>
                  <Button
                    onClick={() => {
                      handleConvertToOrder(viewingQuote);
                      setViewingQuote(null);
                    }}
                    variant="outline"
                    className={cn(
                      viewingQuote.status === "converted" ? "border-emerald-500 text-emerald-700 bg-emerald-50" : ""
                    )}
                  >
                    <Package className="w-4 h-4 mr-2" />
                    {viewingQuote.status === "converted" ? "Revert" : "Convert to Order"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
};
