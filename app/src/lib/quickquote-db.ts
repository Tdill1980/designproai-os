/**
 * QuickQuote DB helpers — upsert customer, save quote, log emails, attach assets.
 *
 * Two write paths:
 *   1. Authenticated admin: writes to public.quotes via the user's shop_id
 *      (RLS enforced, normal supabase-js client).
 *   2. Anonymous prospect (homepage / sub-account quote page): no auth
 *      session, no shop_profile — falls back to the submit-public-quote
 *      edge function which writes to public.customer_quotes via service
 *      role. The dashboard merges both tables for analytics.
 *
 * The shopSlug option lets a sub-account branded page route submissions
 * to its own shop. Defaults to "wpw" for the mothership /quick-quote.
 */

import { supabase } from "@/integrations/supabase/client";

// Cast once — new tables not yet in generated types (types file too large to round-trip).
// Project is strict:false so `any` is accepted across the codebase.
const db = supabase as any;

export interface SaveQuoteInput {
  quoteNumber: string;
  vehicle: { year?: string; make?: string; model?: string };
  manufacturer?: string;
  finish?: string;
  colorName?: string;
  category?: string;
  toolSource?: string;
  sqFt?: number;
  yardsNeeded?: number;
  shopCost: number;
  customerTotal: number;
  marginPercent?: number;
  lineItems?: Array<{
    label: string;
    detail?: string;
    amount: number;
    wooProductId?: number;
    quantity?: number;
  }>;
  renderUrl?: string | null;
  visualizationId?: string | null;
  /**
   * Phase 6a: the unmodified hero render the estimate was built on
   * top of, BEFORE any precision mods were stacked. Persisted on
   * `quotes.base_render_url` so the admin viewer can show the before.
   */
  baseRenderUrl?: string | null;
  /**
   * Phase 6a: the ordered list of precision modifications stacked on
   * the render (chrome delete -> carbon roof -> racing stripe). Each
   * entry's renderUrl is the image AFTER that mod was applied.
   * Persisted on `quotes.precision_mod_renders` JSONB column.
   */
  precisionMods?: Array<{
    key: string;
    label: string;
    renderUrl: string;
    lineItemId?: string;
  }>;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  /**
   * Free-form order notes captured on the quote builder. Persisted on
   * `quotes.metadata.notes` so the customer-facing email and the
   * /quotes detail view can surface it without a schema migration.
   */
  notes?: string;
  /** Sub-account shop slug for public submissions. Defaults to "wpw". */
  shopSlug?: string;
}

export type SaveQuoteResult =
  | { quoteId: string; customerId: string | null; shareToken: string | null; pipeline: "internal" }
  | { quoteId: string; customerId: null; shareToken: null; pipeline: "public" };

async function getShopId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await db
    .from("shop_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

export async function upsertCustomer(
  shopId: string,
  c: SaveQuoteInput["customer"],
  lastVehicle?: string
): Promise<string | null> {
  if (!c || (!c.email && !c.phone && !c.name)) return null;

  // Try to find an existing customer by email (preferred) or phone.
  let existing: { id: string } | null = null;
  if (c.email) {
    const { data } = await db
      .from("customers")
      .select("id")
      .eq("shop_id", shopId)
      .eq("email", c.email)
      .maybeSingle();
    existing = data;
  }
  if (!existing && c.phone) {
    const { data } = await db
      .from("customers")
      .select("id")
      .eq("shop_id", shopId)
      .eq("phone", c.phone)
      .maybeSingle();
    existing = data;
  }

  if (existing?.id) {
    await db
      .from("customers")
      .update({
        name: c.name || undefined,
        email: c.email || undefined,
        phone: c.phone || undefined,
        last_vehicle: lastVehicle || undefined,
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data, error } = await db
    .from("customers")
    .insert({
      shop_id: shopId,
      name: c.name || null,
      email: c.email || null,
      phone: c.phone || null,
      last_vehicle: lastVehicle || null,
      last_contact_at: new Date().toISOString(),
      total_inquiries: 1,
      source: "quickquote",
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[quickquote-db] upsertCustomer failed", error);
    return null;
  }
  return data?.id || null;
}

/**
 * Upsert the QuoteTool customer into `email_subscribers` with
 * source='quotetool' so the WPW Drip Enrollment admin can target the
 * QuoteTool list. Best-effort — silently swallows errors so a failure
 * here never blocks the actual quote save.
 *
 * Metadata keys mirror what wpw-customers-import writes for the 9k+
 * WPW past-customer list (first_name, last_name, phone, company), so
 * the AdminWpwEnroll subscriber→customer mapping reads them uniformly.
 */
async function captureQuoteToolLead(
  customer: SaveQuoteInput["customer"] | undefined,
): Promise<void> {
  if (!customer?.email) return;
  const trimmedEmail = customer.email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(trimmedEmail)) return;
  try {
    const fullName = (customer.name || "").trim();
    const [first_name, ...rest] = fullName.split(/\s+/);
    const last_name = rest.join(" ") || null;
    await db.from("email_subscribers").upsert(
      {
        email: trimmedEmail,
        source: "quotetool",
        unsubscribed: false,
        metadata: {
          first_name: first_name || null,
          last_name,
          phone: customer.phone || null,
          company: customer.company || null,
          captured_at: new Date().toISOString(),
        },
      },
      { onConflict: "email", ignoreDuplicates: false },
    );
  } catch (err) {
    console.warn("[quickquote-db] captureQuoteToolLead failed (non-fatal)", err);
  }
}

async function savePublicQuote(input: SaveQuoteInput): Promise<SaveQuoteResult | null> {
  // Sq-ft-derived per-unit costs so customer_quotes NOT NULL columns are satisfied.
  const sqft = input.sqFt && input.sqFt > 0 ? input.sqFt : 0;
  const filmTotal = sqft > 0 ? Math.max(input.shopCost - 0, 0) : input.shopCost;
  const filmCostPerSqft = sqft > 0 ? filmTotal / sqft : 0;
  const laborTotal = Math.max(input.customerTotal - input.shopCost, 0);
  const laborRatePerSqft = sqft > 0 ? laborTotal / sqft : 0;

  const { data, error } = await supabase.functions.invoke("submit-public-quote", {
    body: {
      shopSlug: input.shopSlug || "wpw",
      quoteNumber: input.quoteNumber,
      customer: input.customer || null,
      vehicle: input.vehicle,
      finish: input.finish,
      colorName: input.colorName,
      manufacturer: input.manufacturer,
      renderUrl: input.renderUrl,
      visualizationId: input.visualizationId,
      toolSource: input.toolSource,
      pricing: {
        quoteTotal: input.customerTotal,
        filmTotal,
        laborTotal,
        totalSqft: sqft,
        filmCostPerSqft,
        laborRatePerSqft,
      },
      lineItems: input.lineItems || [],
    },
  });

  if (error || !data?.ok) {
    console.warn("[quickquote-db] savePublicQuote failed", error || data);
    return null;
  }

  return {
    quoteId: data.quoteId as string,
    customerId: null,
    shareToken: null,
    pipeline: "public",
  };
}

export async function saveQuote(input: SaveQuoteInput): Promise<SaveQuoteResult | null> {
  // Best-effort lead capture into email_subscribers (source='quotetool')
  // so the WPW Drip enrollment admin can target QuoteTool customers.
  // Runs in parallel with the actual save; errors are swallowed inside.
  void captureQuoteToolLead(input.customer);

  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const shopId = await getShopId();
  if (!shopId) {
    // Anonymous prospect on /quick-quote or /quote/:slug — route through the
    // public edge function so the submission actually persists.
    return savePublicQuote(input);
  }

  const lastVehicle = [input.vehicle.year, input.vehicle.make, input.vehicle.model]
    .filter(Boolean)
    .join(" ");
  const customerId = await upsertCustomer(shopId, input.customer, lastVehicle);

  // QuickQuoteCard generates a single quote_number per mount (useState init),
  // so clicking "Save" then "Send by Email" — or hitting Save twice — re-runs
  // saveQuote with the same number. The unique index on (shop_id, quote_number)
  // would reject the second insert with 23505. Treat that as "already saved,
  // update in place" so the same logical quote can be re-saved or upgraded
  // from draft to send without surfacing an error to the user.
  const insertRow = {
    shop_id: shopId,
    customer_id: customerId,
    // Tag the staff member who saved this quote so /quotes can show
    // "Saved by Jackson / Lance / Trish" and per-rep analytics.
    created_by: currentUser?.id ?? null,
    quote_number: input.quoteNumber,
    vehicle_year: input.vehicle.year || null,
    vehicle_make: input.vehicle.make || null,
    vehicle_model: input.vehicle.model || null,
    manufacturer: input.manufacturer || null,
    finish: input.finish || null,
    color_name: input.colorName || null,
    category: input.category || null,
    tool_source: input.toolSource || null,
    sq_ft: input.sqFt ?? null,
    yards_needed: input.yardsNeeded ?? null,
    shop_cost: input.shopCost,
    customer_total: input.customerTotal,
    margin_percent: input.marginPercent ?? null,
    status: "quoted",
    line_items: input.lineItems || [],
    render_url: input.renderUrl || null,
    visualization_id: input.visualizationId || null,
    base_render_url: input.baseRenderUrl ?? null,
    precision_mod_renders: input.precisionMods ?? [],
    // Stash the rep's email/name in metadata so the table can render a
    // human-readable "Saved by" without joining auth.users. Order notes
    // ride on the same blob (no schema migration needed).
    metadata: {
      created_by_id: currentUser?.id ?? null,
      created_by_email: currentUser?.email ?? null,
      created_by_name:
        (currentUser?.user_metadata as Record<string, unknown> | undefined)
          ?.full_name as string | undefined ?? null,
      notes: input.notes ?? null,
    },
  };

  let { data, error } = await db
    .from("quotes")
    .insert(insertRow)
    .select("id, share_token")
    .single();

  if (error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
    // Same shop already has a row with this quote_number — update it.
    const { shop_id: _omitShop, quote_number: _omitNum, ...updatable } = insertRow;
    const updateRes = await db
      .from("quotes")
      .update(updatable)
      .eq("shop_id", shopId)
      .eq("quote_number", input.quoteNumber)
      .select("id, share_token")
      .maybeSingle();
    data = updateRes.data;
    error = updateRes.error;
  }

  if (error || !data) {
    console.warn("[quickquote-db] saveQuote upsert failed", error);
    return null;
  }

  const quoteId = data?.id as string;
  const shareToken = (data?.share_token as string | null) ?? null;

  // Attach the hero render as an asset so it travels with the quote.
  if (input.renderUrl && quoteId) {
    await db.from("quote_assets").insert({
      quote_id: quoteId,
      shop_id: shopId,
      asset_type: "render",
      url: input.renderUrl,
      label: "Hero render",
    });
  }

  // Bump customer rollups
  if (customerId) {
    await db.rpc("increment_customer_quotes", { p_customer_id: customerId }).catch(() => {});
  }

  // Monitor: mirror the quote onto the customer's Klaviyo profile. This branch
  // writes `quotes` directly from the browser, so it cannot call Klaviyo itself
  // (private key); it routes through submit-public-quote's trackOnly mode.
  // Without this, only the anonymous fallback was instrumented — which is why
  // the "Quote Requested" metric had never fired despite live quote volume.
  // Fire-and-forget: tracking must never fail a save.
  if (input.customer?.email) {
    void supabase.functions
      .invoke("submit-public-quote", {
        body: {
          trackOnly: true,
          quoteId,
          quoteNumber: input.quoteNumber,
          customer: input.customer,
          vehicle: input.vehicle,
          finish: input.finish,
          colorName: input.colorName,
          toolSource: input.toolSource,
          // Value rides as `trackValue`, NOT `pricing.quoteTotal`. Vercel and
          // Supabase deploy independently, so this call can reach a build of
          // submit-public-quote that predates trackOnly. Without `pricing`
          // that older build rejects the request outright rather than
          // inserting a second copy of a quote we just saved.
          trackValue: input.customerTotal,
        },
      })
      .catch((e) => console.warn("[quickquote-db] Klaviyo track failed (non-fatal)", e));
  }

  return { quoteId, customerId, shareToken, pipeline: "internal" };
}

export async function logEmailSent(params: {
  quoteId?: string | null;
  customerId?: string | null;
  emailType: string;
  subject: string;
  body: string;
  recipient: string;
}): Promise<void> {
  const shopId = await getShopId();
  if (!shopId) return;

  await db.from("email_log").insert({
    quote_id: params.quoteId || null,
    customer_id: params.customerId || null,
    shop_id: shopId,
    email_type: params.emailType,
    subject: params.subject,
    body: params.body,
    recipient: params.recipient,
    sent_at: new Date().toISOString(),
    status: "sent",
  });

  if (params.quoteId) {
    await db
      .from("quotes")
      .update({
        last_email_at: new Date().toISOString(),
        last_email_type: params.emailType,
        status: "sent",
      })
      .eq("id", params.quoteId);
  }
}

export async function attachAsset(params: {
  quoteId: string;
  assetType: "render" | "photoreal_proof" | "studio_proof" | "cut_file" | "panel_pdf";
  url: string;
  label?: string;
}): Promise<void> {
  const shopId = await getShopId();
  if (!shopId) return;
  await db.from("quote_assets").insert({
    quote_id: params.quoteId,
    shop_id: shopId,
    asset_type: params.assetType,
    url: params.url,
    label: params.label || null,
  });
}
