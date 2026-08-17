// ─────────────────────────────────────────────────────────────────────
// wpw-workforce-sweep — Business Event Bus producer
//
// First half of the WPW AI Workforce (docs/WPW_AI_WORKFORCE_AUDIT.md):
//
//   THIS FUNCTION (detectors, deterministic)
//        → workforce_events (the BUSINESS EVENT BUS)
//        → wpw-workforce-orchestrator (AI department agents draft the
//          actual work product)
//        → Marketing Hub review queue → human approve → publish
//
// Detectors scan orders / quotes / proofs / customers on a cron and emit
// normalized events onto the bus. Deduped by dedupe_key, so re-running a
// sweep never double-emits. Any other function can produce events with
// the same one-row insert (see docs/WPW_AI_WORKFORCE_ARCHITECTURE.md).
//
// The sweep also owns the two DETERMINISTIC execution paths that need no
// AI drafting (both idempotent, both using pre-approved templates only,
// both gated behind WORKFORCE_SENDS_ENABLED — default off):
//   • quote retarget drip enrollment  (retarget-3/5/7day templates)
//   • post-purchase series enrollment (pf-* templates)
// and the weekday-morning per-person digest cards (mode: "digest").
//
// Every run is logged to public.workforce_runs.
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { createExternalClient } from "../_shared/external-db.ts";
import { channelSpecPromptBlock } from "../_shared/channel-specs.ts";
import { INSTALL_SQL } from "./install-sql.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRAND = "weprintwraps";
const CREATED_BY = "wpw-workforce";
const LOOKBACK_DAYS = 14;           // never touch anything older than this
const EVENT_CAP = 25;               // max new events per detector per run
const ENROLL_CAP = 50;              // max drip enrollments per run
const HOT_QUOTE_MIN = 1000;         // dollars — per-quote event threshold

// ProductionFlow upsell series (mirrors src/lib/mightymail-series.ts —
// keep in sync with the spec there).
const PF_SERIES = [
  { slug: "pf-01-7day-photos", delayDays: 7 },
  { slug: "pf-02-30day-review", delayDays: 30 },
  { slug: "pf-03-tint-addon", delayDays: 60 },
  { slug: "pf-05-referral", delayDays: 90 },
  { slug: "pf-04-annual-refresh", delayDays: 365 },
];

const RETARGET_DAYS = [3, 5, 7];

const STUCK_STATUSES: Record<string, { label: string; graceDays: number }> = {
  "waiting-on-email": { label: "Waiting on customer email", graceDays: 3 },
  "waiting-on-email-response": { label: "Waiting on customer email", graceDays: 3 },
  "failed": { label: "Payment/order failed", graceDays: 0 },
  "file-error": { label: "Print file error", graceDays: 0 },
  "missing-file": { label: "Missing customer file", graceDays: 0 },
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function money(n: unknown): string {
  const v = Number(n || 0);
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function isoWeek(): string {
  const now = new Date();
  const week = Math.ceil((((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / MS_PER_DAY) + 1) / 7);
  return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createExternalClient>;

// Emit an event onto the bus unless dedupe_key already exists (any
// status — a processed event must not re-emit on the next sweep).
async function emitEvent(
  db: Db,
  dryRun: boolean,
  eventType: string,
  dedupeKey: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { count } = await db
    .from("workforce_events")
    .select("id", { count: "exact", head: true })
    .eq("dedupe_key", dedupeKey);
  if ((count ?? 0) > 0) return false;
  if (dryRun) return true;
  const { error } = await db.from("workforce_events").insert({
    event_type: eventType,
    dedupe_key: dedupeKey,
    payload,
    status: "pending",
    source: CREATED_BY,
  });
  if (error) {
    // Unique-violation race with a parallel run is fine; anything else is not.
    if (!String(error.message).includes("duplicate")) {
      throw new Error(`event emit (${dedupeKey}): ${error.message}`);
    }
    return false;
  }
  return true;
}

// Direct Hub card — used only by digest mode (per-person morning cards
// are deterministic; no AI drafting needed). Same idempotency doctrine
// as marketing_standing_tasks: completed rows still block re-creation.
interface TaskInput {
  key: string;
  assigned_to: string;
  category: string;
  task_type: string;
  title: string;
  description: string;
  priority?: string;
}

async function ensureTask(db: Db, dryRun: boolean, t: TaskInput): Promise<boolean> {
  const { count } = await db
    .from("slack_agent_tasks")
    .select("id", { count: "exact", head: true })
    .eq("metadata->>workforce_key", t.key);
  if ((count ?? 0) > 0) return false;
  if (dryRun) return true;
  const { error } = await db.from("slack_agent_tasks").insert({
    brand: BRAND,
    category: t.category,
    task_type: t.task_type,
    title: t.title,
    description: t.description,
    priority: t.priority ?? "high",
    status: "pending",
    assigned_to: t.assigned_to,
    due_date: new Date(Date.now() + MS_PER_DAY).toISOString(),
    created_by: CREATED_BY,
    metadata: { workforce: true, workforce_key: t.key },
  });
  if (error) throw new Error(`task insert (${t.key}): ${error.message}`);
  return true;
}

// Enqueue a template series into scheduled_emails unless the sourceRef
// already has rows (identical idempotency contract to
// mightymail-enqueue-series).
async function enqueueSeries(
  db: Db,
  dryRun: boolean,
  args: {
    sourceRef: string;
    source: string;
    recipient: string;
    emails: { slug: string; delayDays: number }[];
    mergeData: Record<string, unknown>;
    shopId: string | null;
  },
): Promise<boolean> {
  const { count } = await db
    .from("scheduled_emails")
    .select("id", { count: "exact", head: true })
    .eq("source_ref", args.sourceRef);
  if ((count ?? 0) > 0) return false;
  if (dryRun) return true;
  const now = Date.now();
  const rows = args.emails.map((e) => ({
    send_at: new Date(now + e.delayDays * MS_PER_DAY).toISOString(),
    template_slug: e.slug,
    recipient_email: args.recipient,
    merge_data: args.mergeData,
    shop_id: args.shopId,
    source: args.source,
    source_ref: args.sourceRef,
    status: "pending",
  }));
  const { error } = await db.from("scheduled_emails").insert(rows);
  if (error) throw new Error(`enqueue (${args.sourceRef}): ${error.message}`);
  return true;
}

// ── Detector A: stuck orders → order.stuck events ────────────────────
async function sweepStuckOrders(db: Db, dryRun: boolean) {
  const { data: orders, error } = await db
    .from("wpw_orders")
    .select("id, order_number, status, customer_email, customer_name, total, date_modified")
    .in("status", Object.keys(STUCK_STATUSES))
    .order("date_modified", { ascending: true })
    .limit(200);
  if (error) throw new Error(`stuck orders query: ${error.message}`);

  let emitted = 0;
  for (const o of orders ?? []) {
    if (emitted >= EVENT_CAP) break;
    const cfg = STUCK_STATUSES[o.status];
    if (!cfg) continue;
    const modified = o.date_modified ? new Date(o.date_modified).getTime() : 0;
    const ageDays = Math.floor((Date.now() - modified) / MS_PER_DAY);
    if (ageDays < cfg.graceDays) continue;
    const made = await emitEvent(db, dryRun, "order.stuck", `stuck_${o.id}_${o.status}`, {
      order_id: o.id,
      order_number: o.order_number,
      status: o.status,
      status_label: cfg.label,
      customer_name: o.customer_name,
      customer_email: o.customer_email,
      total: o.total,
      age_days: ageDays,
    });
    if (made) emitted++;
  }
  return { scanned: orders?.length ?? 0, events_emitted: emitted };
}

// ── Detector B: shipped orders → pf drip (deterministic) + event ─────
async function sweepPostPurchase(db: Db, dryRun: boolean, sendsEnabled: boolean, shopId: string | null) {
  const { data: orders, error } = await db
    .from("wpw_orders")
    .select("id, order_number, customer_email, customer_name, date_modified, tracking_number")
    .not("tracking_number", "is", null)
    .not("customer_email", "is", null)
    .gte("date_modified", daysAgoIso(LOOKBACK_DAYS))
    .order("date_modified", { ascending: false })
    .limit(200);
  if (error) throw new Error(`post-purchase query: ${error.message}`);

  let enrolled = 0;
  let eligible = 0;
  for (const o of orders ?? []) {
    if (enrolled >= ENROLL_CAP) break;
    eligible++;
    if (!sendsEnabled) continue;
    const made = await enqueueSeries(db, dryRun, {
      sourceRef: `pf_order_${o.id}`,
      source: "mightymail:productionflow-upsell",
      recipient: o.customer_email,
      emails: PF_SERIES,
      mergeData: {
        customer_name: o.customer_name || "there",
        order_number: String(o.order_number || o.id),
      },
      shopId,
    });
    if (made) enrolled++;
  }

  // While sends are off, put the waiting pool on the bus once a day so
  // the marketing agent preps the QC that unblocks it.
  if (!sendsEnabled && eligible > 0) {
    const day = new Date().toISOString().slice(0, 10);
    await emitEvent(db, dryRun, "postpurchase.pending", `pf_pending_${day}`, {
      eligible_orders: eligible,
      series: PF_SERIES.map((e) => e.slug),
      gate: "WORKFORCE_SENDS_ENABLED",
    });
  }
  return { eligible, enrolled, sends_enabled: sendsEnabled };
}

// ── Detector C: quotes → retarget drip (deterministic) + events ──────
async function sweepQuotes(db: Db, dryRun: boolean, sendsEnabled: boolean, shopId: string | null, appOrigin: string) {
  const { data: quotes, error } = await db
    .from("quotes")
    .select(
      "id, quote_number, status, customer_total, vehicle_year, vehicle_make, vehicle_model, " +
      "color_name, finish, render_url, share_token, metadata, created_at, customer_id, " +
      "customers ( email, name )",
    )
    .in("status", ["pending", "quoted", "sent"])
    .gte("created_at", daysAgoIso(LOOKBACK_DAYS))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`quotes query: ${error.message}`);

  let enrolled = 0;
  let hotEvents = 0;
  let awaiting = 0;
  let openValue = 0;

  for (const q of quotes ?? []) {
    const meta = (q.metadata ?? {}) as Record<string, unknown>;
    // deno-lint-ignore no-explicit-any
    const cust: any = Array.isArray(q.customers) ? q.customers[0] : q.customers;
    const email = (meta.email as string) || cust?.email || null;
    const total = Number(q.customer_total || 0);
    openValue += total;
    const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ");
    const quoteUrl = q.share_token ? `${appOrigin}/q/${q.share_token}` : "";

    // High-value quotes go on the bus for a personally-drafted follow-up.
    if (total >= HOT_QUOTE_MIN && hotEvents < EVENT_CAP) {
      const made = await emitEvent(db, dryRun, "quote.hot", `hot_quote_${q.id}`, {
        quote_id: q.id,
        quote_number: q.quote_number,
        status: q.status,
        total,
        customer_name: cust?.name || null,
        customer_email: email,
        vehicle,
        color_name: q.color_name,
        finish: q.finish,
        quote_url: quoteUrl,
        created_at: q.created_at,
      });
      if (made) hotEvents++;
    }

    if (meta.retarget_scheduled || !email) continue;
    awaiting++;
    if (!sendsEnabled || enrolled >= ENROLL_CAP) continue;

    const renderUrl = q.render_url || "";
    const heroRenderBlock = renderUrl
      ? `<tr><td style="padding:0 32px 24px 32px;"><img src="${renderUrl}" alt="Your ${vehicle || "wrap"} render" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;border:1px solid #e2e8f0;" /></td></tr>`
      : "";
    const made = await enqueueSeries(db, dryRun, {
      sourceRef: `retarget_quote_${q.id}`,
      source: "quote_retarget",
      recipient: email,
      emails: RETARGET_DAYS.map((d) => ({ slug: `retarget-${d}day-formal`, delayDays: d })),
      mergeData: {
        customer_name: cust?.name || "there",
        customer_email: email,
        quote_number: q.quote_number || "",
        quote_total: total ? `$${total.toFixed(2)}` : "",
        vehicle,
        vehicle_name: vehicle,
        vehicle_year: q.vehicle_year || "",
        vehicle_make: q.vehicle_make || "",
        vehicle_model: q.vehicle_model || "",
        color_name: q.color_name || "",
        finish: q.finish || "",
        render_url: renderUrl,
        hero_render_block: heroRenderBlock,
        quote_url: quoteUrl,
      },
      shopId,
    });
    if (made) {
      enrolled++;
      if (!dryRun) {
        await db
          .from("quotes")
          .update({
            metadata: {
              ...meta,
              retarget_scheduled: true,
              retarget_send_at: new Date(Date.now() + RETARGET_DAYS[0] * MS_PER_DAY).toISOString(),
              retarget_days: RETARGET_DAYS[0],
              retarget_template_slug: "retarget-3day-formal",
              retarget_source: CREATED_BY,
            },
          })
          .eq("id", q.id);
      }
    }
  }

  // Public (anon) homepage QuickQuotes: auto-enroll the SAME 3/5/7-day
  // retarget drip (gated by WORKFORCE_SENDS_ENABLED). Idempotent via the
  // scheduled_emails source_ref check — customer_quotes has no metadata
  // column to stamp, so source_ref IS the enrollment record.
  const { data: pubQuotes, error: pubErr } = await db
    .from("customer_quotes")
    .select("id, quote_total, customer_name, customer_email, vehicle_year, vehicle_make, vehicle_model, film_manufacturer, film_finish, film_name, render_url, created_at")
    .eq("status", "new")
    .gte("created_at", daysAgoIso(LOOKBACK_DAYS))
    .order("quote_total", { ascending: false })
    .limit(500);
  if (pubErr) throw new Error(`public quotes query: ${pubErr.message}`);
  const pubCount = pubQuotes?.length ?? 0;
  const pubValue = (pubQuotes ?? []).reduce((s, r) => s + Number(r.quote_total || 0), 0);

  let pubEnrolled = 0;
  for (const cq of pubQuotes ?? []) {
    if (!sendsEnabled || pubEnrolled >= ENROLL_CAP) break;
    const em = String(cq.customer_email || "").trim();
    if (!em || !em.includes("@")) continue;
    const vehicle = [cq.vehicle_year, cq.vehicle_make, cq.vehicle_model].filter(Boolean).join(" ");
    const renderUrl = cq.render_url || "";
    const total = Number(cq.quote_total || 0);
    const heroRenderBlock = renderUrl
      ? `<tr><td style="padding:0 32px 24px 32px;"><img src="${renderUrl}" alt="Your ${vehicle || "wrap"} render" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;border:1px solid #e2e8f0;" /></td></tr>`
      : "";
    const made = await enqueueSeries(db, dryRun, {
      sourceRef: `retarget_pubquote_${cq.id}`,
      source: "quote_retarget",
      recipient: em,
      emails: RETARGET_DAYS.map((d) => ({ slug: `retarget-${d}day-formal`, delayDays: d })),
      mergeData: {
        customer_name: cq.customer_name || "there",
        customer_email: em,
        quote_number: "",
        quote_total: total ? `$${total.toFixed(2)}` : "",
        vehicle,
        vehicle_name: vehicle,
        vehicle_year: cq.vehicle_year || "",
        vehicle_make: cq.vehicle_make || "",
        vehicle_model: cq.vehicle_model || "",
        manufacturer: cq.film_manufacturer || "",
        color_name: cq.film_name || "",
        finish: cq.film_finish || "",
        render_url: renderUrl,
        hero_render_block: heroRenderBlock,
        quote_url: "",
      },
      shopId,
    });
    if (made) pubEnrolled++;
  }
  if (pubCount > 0) {
    const day = new Date().toISOString().slice(0, 10);
    await emitEvent(db, dryRun, "quote.public_batch", `public_quotes_${day}`, {
      count: pubCount,
      open_value: Math.round(pubValue),
      lookback_days: LOOKBACK_DAYS,
      top_quotes: (pubQuotes ?? []).slice(0, 15).map((r) => ({
        total: r.quote_total,
        vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" "),
        created_at: r.created_at,
      })),
      work_in: "Admin → QuickQuote (retarget buttons queue the 3/5/7-day MightyMail drip)",
    });
  }

  return {
    scanned: quotes?.length ?? 0,
    open_value: Math.round(openValue),
    hot_events: hotEvents,
    drips_enrolled: enrolled,
    public_drips_enrolled: pubEnrolled,
    awaiting_followup: awaiting,
    public_new: pubCount,
    sends_enabled: sendsEnabled,
  };
}

// ── Detector D: dormant customers → weekly win-back build event ──────
// Engine Room board → agents EXECUTE. Human-created marketing/content
// tasks sitting in To Do become task.execute events: the content agent
// drafts the deliverable the card describes (per brand, per channel
// spec), the draft lands in the Director/Content Review queue wired to
// the calendar, and the card's metadata links the draft. Workforce-
// created cards are excluded (they ARE outputs, not work orders).
async function sweepBoardTasks(db: Db, dryRun: boolean) {
  const { data: tasks } = await db
    .from("slack_agent_tasks")
    .select("id, brand, title, description, category, task_type, assigned_to, created_by")
    .eq("status", "pending")
    .in("category", ["marketing", "content", "social", "email"])
    .not("created_by", "ilike", "workforce-%")
    .not("created_by", "ilike", "wpw-workforce%")
    .order("created_at", { ascending: true })
    .limit(60);
  let emitted = 0;
  for (const t of tasks ?? []) {
    const ok = await emitEvent(db, dryRun, "task.execute", `task_exec2_${t.id}`, {
      task_id: t.id,
      brand: t.brand || "weprintwraps",
      title: t.title,
      description: t.description,
      category: t.category,
      task_type: t.task_type,
      assigned_to: t.assigned_to,
    });
    if (ok) emitted++;
  }
  return { pending_seen: (tasks ?? []).length, emitted };
}

// Two-way team↔agent channel: the dashboard's "reply to the agent" box
// stores revision_request on the card's metadata; this detector turns
// each note into a task.revise event (then marks it handled so it fires
// once). The agent redrafts honoring the human's note.
async function sweepRevisionRequests(db: Db, dryRun: boolean) {
  const { data: cards } = await db
    .from("slack_agent_tasks")
    .select("id, title, description, category, task_type, assigned_to, created_by, metadata")
    .eq("status", "pending")
    .not("metadata->>revision_request", "is", null)
    .is("metadata->>revision_handled", null)
    .limit(10);
  let emitted = 0;
  for (const c of cards ?? []) {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const stamp = String(meta.revision_requested_at ?? "").replace(/[^0-9]/g, "").slice(0, 12);
    const ok = await emitEvent(db, dryRun, "task.revise", `revise_${c.id}_${stamp}`, {
      card_id: c.id,
      title: c.title,
      original_draft: String(c.description ?? "").slice(0, 4000),
      feedback: String(meta.revision_request ?? ""),
      category: c.category,
      task_type: c.task_type,
      assigned_to: c.assigned_to,
      original_agent: c.created_by,
    });
    if (ok && !dryRun) {
      await db.from("slack_agent_tasks").update({
        metadata: { ...meta, revision_handled: true },
      }).eq("id", c.id);
    }
    if (ok) emitted++;
  }
  return { notes_seen: (cards ?? []).length, emitted };
}

async function sweepDormant(db: Db, dryRun: boolean) {
  const { data, error } = await db
    .from("workforce_dormant_customers")
    .select("customer_email, customer_name, last_order_at, orders_count, lifetime_total")
    .order("lifetime_total", { ascending: false })
    .limit(500);
  if (error) throw new Error(`dormant view query: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { dormant: 0 };

  const pool = rows.reduce((s, r) => s + Number(r.lifetime_total || 0), 0);
  await emitEvent(db, dryRun, "customer.dormant_batch", `winback_${isoWeek()}`, {
    dormant_count: rows.length,
    lifetime_pool: Math.round(pool),
    top_customers: rows.slice(0, 10).map((r) => ({
      name: r.customer_name,
      orders: r.orders_count,
      lifetime: Math.round(Number(r.lifetime_total || 0)),
      last_order: String(r.last_order_at).slice(0, 10),
    })),
  });

  // PERSONALIZED win-back: top dormant customers get an individually
  // written email built from their ACTUAL purchase history (not the
  // batch blast). 5 per sweep, once per customer per quarter.
  const quarter = `${new Date().getUTCFullYear()}q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;
  let personal = 0;
  for (const r of rows.slice(0, 25)) {
    if (personal >= 5) break;
    const em = String(r.customer_email || "").trim().toLowerCase();
    if (!em) continue;
    const { data: lastOrder } = await db
      .from("wpw_orders")
      .select("id, order_number, date_created, total")
      .eq("customer_email", r.customer_email)
      .order("date_created", { ascending: false })
      .limit(1);
    const lo = lastOrder?.[0];
    let items: { name: string; quantity: number }[] = [];
    if (lo) {
      const { data: its } = await db
        .from("wpw_order_items")
        .select("name, quantity")
        .eq("order_id", lo.id)
        .limit(8);
      items = (its ?? []).map((i) => ({ name: i.name, quantity: i.quantity }));
    }
    const made = await emitEvent(db, dryRun, "customer.winback_personal", `winback_p_${quarter}_${em}`, {
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      orders_count: r.orders_count,
      lifetime_total: Math.round(Number(r.lifetime_total || 0)),
      last_order_date: String(r.last_order_at).slice(0, 10),
      last_order_number: lo?.order_number ?? null,
      last_order_total: lo?.total ?? null,
      last_order_items: items,
      months_since_order: Math.round((Date.now() - new Date(r.last_order_at as string).getTime()) / (30 * MS_PER_DAY)),
    });
    if (made) personal++;
  }

  return { dormant: rows.length, pool: Math.round(pool), personal_events: personal };
}

// ── Detector E: freshly approved designs → social content events ─────
// A signed/approved proof is the best organic content the shop has. Emit
// one event per approval carrying the REAL render URLs; the Content
// agent drafts the caption and stages an agent_social_posts draft.
// Customer name/email deliberately excluded — captions must not name
// customers without explicit permission.
async function sweepApprovedDesigns(db: Db, dryRun: boolean) {
  const { data: proofs, error } = await db
    .from("proof_approvals")
    .select("id, vehicle_year, vehicle_make, vehicle_model, design_name, finish_type, signed_at")
    .eq("status", "approved")
    .gte("signed_at", daysAgoIso(7))
    .order("signed_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`approved designs query: ${error.message}`);

  let emitted = 0;
  for (const p of proofs ?? []) {
    const { data: ver } = await db
      .from("proof_versions")
      .select("render_urls")
      .eq("proof_id", p.id)
      .order("version_number", { ascending: false })
      .limit(1);
    const urlsObj = (ver?.[0]?.render_urls ?? {}) as Record<string, unknown>;
    const renderUrls = Object.values(urlsObj)
      .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
      .slice(0, 4);
    const vehicle = [p.vehicle_year, p.vehicle_make, p.vehicle_model].filter(Boolean).join(" ");
    const made = await emitEvent(db, dryRun, "content.social_from_job", `social_job_${p.id}`, {
      proof_id: p.id,
      vehicle,
      design_name: p.design_name,
      finish: p.finish_type,
      approved_at: p.signed_at,
      render_urls: renderUrls,
    });
    if (made) emitted++;
  }
  return { scanned: proofs?.length ?? 0, events_emitted: emitted };
}

// ── Digest mode: per-person cards + weekly exec/growth events ────────
async function runDigest(db: Db, dryRun: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const stuck = await count(
    db.from("wpw_orders").select("id", { count: "exact", head: true }).in("status", Object.keys(STUCK_STATUSES)),
  );
  const freshQuotes = await count(
    db.from("quotes").select("id", { count: "exact", head: true })
      .in("status", ["pending", "quoted", "sent"]).gte("created_at", daysAgoIso(LOOKBACK_DAYS)),
  );
  const pubNew = await count(
    db.from("customer_quotes").select("id", { count: "exact", head: true })
      .eq("status", "new").gte("created_at", daysAgoIso(LOOKBACK_DAYS)),
  );
  const draftProofs = await count(
    db.from("proof_approvals").select("id", { count: "exact", head: true }).in("status", ["draft", "revising"]),
  );
  const inPrint = await count(
    db.from("wpw_orders").select("id", { count: "exact", head: true }).eq("status", "print-production"),
  );
  const fileErrors = await count(
    db.from("wpw_orders").select("id", { count: "exact", head: true }).in("status", ["file-error", "missing-file"]),
  );
  const campaignsToReview = await count(
    db.from("agent_email_campaigns").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
  );
  const ordersToday = await count(
    db.from("wpw_orders").select("id", { count: "exact", head: true }).gte("date_created", daysAgoIso(1)),
  );

  const cards: TaskInput[] = [
    {
      key: `digest_troy_${day}`,
      assigned_to: "troy",
      category: "operations",
      task_type: "daily_digest",
      title: `☀️ Troy — today: ${stuck} stuck order(s), ${freshQuotes + pubNew} quote(s) to work`,
      description:
        `Prepared by the AI workforce overnight:\n` +
        `• ${stuck} order(s) stuck (waiting-on-email / failed / file issues) — see your order_issue tasks\n` +
        `• ${freshQuotes} internal quote(s) <${LOOKBACK_DAYS}d old awaiting follow-up\n` +
        `• ${pubNew} public quote(s) at status "new"\n` +
        `Start with the 🔥 high-value quote tasks (each has a drafted email attached), then the 🧯 stuck orders.`,
    },
    {
      key: `digest_lance_${day}`,
      assigned_to: "lance",
      category: "design",
      task_type: "daily_digest",
      title: `☀️ Lance — today: ${draftProofs} proof(s) in draft/revising`,
      description:
        `• ${draftProofs} proof(s) need design work or revision handling (ApprovePro)\n` +
        `Work the oldest first; revision requests carry the customer's notes on the proof record.`,
    },
    {
      key: `digest_seth_${day}`,
      assigned_to: "seth",
      category: "production",
      task_type: "daily_digest",
      title: `☀️ Seth — today: ${inPrint} in print-production, ${fileErrors} file issue(s)`,
      description:
        `• ${inPrint} order(s) currently in print-production\n` +
        `• ${fileErrors} order(s) blocked on file errors / missing files — see order_issue tasks (each has a drafted fix checklist)`,
    },
    {
      key: `digest_jackson_${day}`,
      assigned_to: "jackson",
      category: "marketing",
      task_type: "daily_digest",
      title: `☀️ Jackson — today: ${campaignsToReview} campaign(s) awaiting QC`,
      description:
        `• ${campaignsToReview} agent-drafted campaign(s) at needs_review in Marketing Hub\n` +
        `• Check the weekly 🪃 win-back campaign draft if present.`,
    },
  ];

  let created = 0;
  const newCards: { assignee: string; title: string }[] = [];
  for (const c of cards) {
    if (await ensureTask(db, dryRun, c)) {
      created++;
      newCards.push({ assignee: c.assigned_to, title: c.title });
    }
  }
  // Morning digests go straight to each person's inbox too.
  const notify = dryRun ? { notified: 0 } : await notifyTeam(newCards);

  // Mondays: put the weekly exec + growth reviews on the bus so those
  // agents draft them from the same KPI snapshot (enriched with the
  // Phase 1 scoreboard — approval rates, edit counts, event outcomes).
  let weekly = 0;
  if (new Date().getUTCDay() === 1) {
    let scoreboard: Record<string, unknown> = {};
    try {
      const { data: sb } = await db.from("workforce_scoreboard").select("*").limit(1);
      scoreboard = sb?.[0] ?? {};
    } catch (_) { /* view may not exist yet */ }
    const kpis = {
      scoreboard,
      week: isoWeek(),
      orders_last_24h: ordersToday,
      stuck_orders: stuck,
      fresh_quotes: freshQuotes,
      public_new_quotes: pubNew,
      proofs_in_design: draftProofs,
      in_print_production: inPrint,
      file_error_orders: fileErrors,
      campaigns_awaiting_qc: campaignsToReview,
    };
    if (await emitEvent(db, dryRun, "exec.weekly", `exec_${isoWeek()}`, kpis)) weekly++;
    if (await emitEvent(db, dryRun, "growth.weekly", `growth_${isoWeek()}`, kpis)) weekly++;

    // First Monday of the month: assemble THE WRAP UP! draft from the
    // month's real material (docs/INK_AND_EDGE_EDITORIAL.md).
    if (new Date().getUTCDate() <= 7) {
      const monthKey = new Date().toISOString().slice(0, 7);
      const { data: monthJobs } = await db
        .from("proof_approvals")
        .select("vehicle_year, vehicle_make, vehicle_model, design_name, finish_type, signed_at")
        .eq("status", "approved")
        .gte("signed_at", daysAgoIso(35))
        .order("signed_at", { ascending: false })
        .limit(8);
      const { data: monthOrders } = await db
        .from("wpw_orders")
        .select("total")
        .gte("date_created", daysAgoIso(35))
        .not("status", "in", '("cancelled","refunded","failed","checkout-draft")')
        .limit(1000);
      const jobsPrinted = monthOrders?.length ?? 0;
      const biggest = Math.max(0, ...(monthOrders ?? []).map((o) => Number(o.total || 0)));
      if (await emitEvent(db, dryRun, "newsletter.wrapup", `wrapup_${monthKey}`, {
        month: monthKey,
        jobs_printed: jobsPrinted,
        biggest_order_total: Math.round(biggest),
        approved_designs: (monthJobs ?? []).map((j) => ({
          vehicle: [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" "),
          design_name: j.design_name,
          finish: j.finish_type,
        })),
        kpis,
      })) weekly++;
    }
  }

  return { cards_created: created, notified: notify.notified, weekly_events: weekly, stuck, freshQuotes, pubNew, draftProofs, inPrint, fileErrors, campaignsToReview };
}

// ═════════════════════════════════════════════════════════════════════
// ORCHESTRATOR (mode: "orchestrate") — the AI department agents.
// Folded into this function because the project sits at Supabase's
// 500-function cap (updates deploy fine; new functions 402).
//
// Claims pending workforce_events, routes each to a department agent
// (Claude), and the agent BUILDS the deliverable — full campaigns into
// agent_email_campaigns (needs_review), staged social posts with real
// renders into agent_social_posts (draft), ready-to-send customer
// emails / briefs / plans onto Hub cards. Model failure ⇒ plain task
// from the payload — work never drops.
// ═════════════════════════════════════════════════════════════════════

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";
const ORCH_BATCH_SIZE = 10;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

interface AgentProfile {
  id: string;
  defaultAssignee: string;
  emailCampaign?: boolean;
  socialPost?: boolean;
  persona: string;
}

const AGENTS: Record<string, AgentProfile> = {
  marketing: {
    id: "workforce-marketing-agent",
    defaultAssignee: "jackson",
    emailCampaign: true,
    persona:
      `You are the Marketing department agent for WePrintWraps (weprintwraps.com), a premium ` +
      `wide-format vehicle-wrap print shop. Voice: confident, practical, shop-owner-to-shop-owner, ` +
      `never corporate fluff. You draft complete, send-ready email campaigns and marketing plans. ` +
      `80% value / 20% sell. Real numbers from the event data only — never invent statistics, ` +
      `discounts, or customer names not present in the input.`,
  },
  customer_success: {
    id: "workforce-cs-agent",
    defaultAssignee: "troy",
    persona:
      `You are the Customer Success agent for WePrintWraps. You draft warm, direct, personal ` +
      `customer emails and call plans for Troy (customer service). Tone: helpful human at a real ` +
      `print shop, short sentences, one clear ask per email. Use only facts present in the event ` +
      `data — never invent order details, prices, or promises about timelines.`,
  },
  design: {
    id: "workforce-design-agent",
    defaultAssignee: "lance",
    persona:
      `You are the Design department agent for WePrintWraps. You turn customer requests and ` +
      `revision notes into crisp, actionable design briefs for Lance (lead graphics manager): ` +
      `vehicle, panels affected, exact changes requested, files/assets referenced, open questions ` +
      `to ask the customer. Never guess at ambiguous instructions — list them as questions.`,
  },
  production: {
    id: "workforce-production-agent",
    defaultAssignee: "brice",
    persona:
      `You are the Production department agent for WePrintWraps. You draft resolution checklists ` +
      `for print-file problems (DPI, color mode, bleed, missing files) and the matching customer ` +
      `email requesting corrected files, for Brice (PrintPro / WPW production). Be specific about ` +
      `print requirements; use only facts from the event data.`,
  },
  content: {
    id: "workforce-content-agent",
    defaultAssignee: "jackson",
    socialPost: true,
    persona:
      `You are the Content department agent for WePrintWraps and WrapTVWorld. You write ` +
      `scroll-stopping Instagram/Facebook captions for real wraps and prints the shop just ` +
      `produced. Voice: proud craftsman showing real work — hook first line, one detail about ` +
      `the design/finish, CTA to get a quote. POSITIONING (Prompt-to-Print™ category — do not ` +
      `dilute): every real job is proof the category works. Where it fits naturally (never forced, ` +
      `max one line), land the leap: "Photoshop creates graphics. DesignProAI creates graphics—and ` +
      `the production-ready files to print them." Tagline when it fits: "Describe it. Refine it. ` +
      `Print it." Never say AI art / AI image generator. ` +
      `NEVER name the customer. NEVER invent details not present in the event data. Hashtags: ` +
      `mix of wrap-industry and local-business tags, max 12.`,
  },
  growth: {
    id: "workforce-growth-agent",
    defaultAssignee: "jackson",
    persona:
      `You are the Growth department agent for WePrintWraps. You review performance signals ` +
      `(campaigns awaiting QC, content cadence, ad angles) and draft prioritized growth actions ` +
      `for Jackson (director of growth). Concrete next actions with expected impact — no vague ` +
      `"consider optimizing" advice.`,
  },
  executive: {
    id: "workforce-executive-agent",
    defaultAssignee: "trish",
    persona:
      `You are the Executive agent for WePrintWraps, reporting to Trish (founder). You write ` +
      `tight weekly executive summaries: what moved, what's stuck, the 3 decisions only Trish ` +
      `can make. Numbers first, adjectives last. Use only the data provided.`,
  },
};

interface Route {
  agent: keyof typeof AGENTS;
  taskType: string;
  category: string;
  instructions: string;
  // When true, the agent also composes a complete per-customer email
  // (from that customer's actual data) that is queued for sending —
  // gated by WORKFORCE_SENDS_ENABLED, 30-min delay, visible on the card.
  personalEmail?: boolean;
}

function routeFor(eventType: string, payload: Json): Route | null {
  switch (eventType) {
    case "order.stuck": {
      const fileIssue = ["file-error", "missing-file"].includes(String(payload.status || ""));
      return {
        agent: fileIssue ? "production" : "customer_success",
        taskType: "order_issue",
        category: fileIssue ? "production" : "operations",
        instructions:
          `An order is stuck (status "${payload.status}"). Draft: (1) a short resolution checklist, ` +
          `(2) the complete ready-to-send customer email that unsticks it (subject + body). ` +
          `The human will review, personalize if needed, and send.`,
      };
    }
    case "quote.hot":
      return {
        agent: "customer_success",
        taskType: "quote_followup",
        category: "sales",
        instructions:
          `A high-value quote needs a personal follow-up today. Draft: (1) a 30-second call opener, ` +
          `(2) a complete follow-up email (subject + body) referencing their exact vehicle and quote, ` +
          `(3) one alternate-pricing or phased-install option to offer if price is the blocker.`,
      };
    case "quote.public_batch":
      return {
        agent: "customer_success",
        taskType: "quote_followup",
        category: "sales",
        instructions:
          `A batch of public QuickQuote submissions is sitting unworked. Draft today's work plan: ` +
          `triage order (highest value first), a reusable first-touch email template for the batch, ` +
          `and which ones warrant a phone call.`,
      };
    case "postpurchase.pending":
      return {
        agent: "marketing",
        taskType: "email_campaign",
        category: "marketing",
        instructions:
          `Shipped orders are eligible for the post-purchase series but sends are gated off pending ` +
          `template QC. Draft the QC checklist for the pf-* series (photo request, review-for-$50, ` +
          `add-on, referral) and recommend go/no-go criteria so the human can flip sends on.`,
      };
    case "customer.dormant_batch":
      return {
        agent: "marketing",
        taskType: "email_campaign",
        category: "marketing",
        instructions:
          `These past customers are dormant 120+ days. BUILD the complete win-back email campaign ` +
          `now (this is your campaign output, not just a plan): compelling subject, preview text, ` +
          `full body_text and simple body_html. Angle: we printed for you before, here's what's new, ` +
          `clear reorder CTA. No fake discounts — if you propose an incentive, flag it as ` +
          `NEEDS-APPROVAL in the task summary.`,
      };
    case "content.social_from_job":
      return {
        agent: "content",
        taskType: "social_post",
        category: "marketing",
        instructions:
          `A wrap design was just approved by its customer (renders attached to the event). ` +
          `BUILD the complete multi-format content package for this one real job. ` +
          `In "social": the Instagram feed caption + hashtags (renders in render_urls are the media). ` +
          `In "draft", the rest of the package, clearly sectioned:\n` +
          `REEL SCRIPT — 15-30s: hook line (first 2s), 3-4 beats over the renders, CTA, ` +
          `on-screen text per beat, music vibe.\n` +
          `CAROUSEL — 5 slides: slide-by-slide copy (slide 1 = scroll-stopper, last = CTA).\n` +
          `X POST — one post ≤280 chars, no hashtags spam, link-ready.\n` +
          `YOUTUBE SHORT — title (≤70 chars) + the same script adapted vertical + description ` +
          `with keywords.\n` +
          `Celebrate the work; do not name the customer; use only event data.`,
      };
    case "media.analyze":
      return {
        agent: "content",
        taskType: "media_analysis",
        category: "marketing",
        instructions:
          `A ${payload.kind === "music" ? "music track" : "video"} was transcribed with timestamped ` +
          `segments. Build its content-intelligence record. In "draft", output ONLY a JSON object ` +
          `(no prose) shaped: {"source": {"emotional_tone": str, "energy": str, "brands": [str], ` +
          `"vehicles": [str], "people": [str], "recommended_formats": [str], "script_ideas": ` +
          `[{"format": str, "concept": str}]}, "moments": [{"start": num, "end": num, ` +
          `"verbatim_quote": str, "speaker": str|null, "hook_score": 0-10, "soundbite_score": 0-10, ` +
          `"content_uses": [str]}]} — moments: ONLY the segments worth reusing (top quotes/hooks), ` +
          `merged into natural sound bites (combine adjacent segments; keep exact start of first + ` +
          `end of last; quote verbatim from the transcript). For music: hook_score = how strong the ` +
          `line is as an on-screen lyric drop. Use only the transcript — never invent quotes.`,
      };
    case "content.atomize":
      return {
        agent: "marketing",
        taskType: "email_campaign",
        category: "marketing",
        instructions:
          `ATOMIZE this analyzed source into the full channel stack (YouTube sits at the top of the ` +
          `ecosystem — everything derives downward). Using ONLY the source metadata and the scored, ` +
          `timestamped moments provided, produce in "draft", clearly sectioned:\n` +
          `1. HOOK + STORYLINE — the single strongest hook and the best storyline the footage supports.\n` +
          `2. AUTO-CUT LIST — 2-3 reel concepts: for each, the exact moments to use (timestamps), ` +
          `the house track + where the drop hits, on-screen text, and platform.\n` +
          `3. EMAIL (education-intent, for the ~10k WPW list) — this is your "campaign" output: ` +
          `teach-first subject + body built around the best quote/lesson in the footage.\n` +
          `4. ADS — one organic post + one paid Meta ad (hook-first, per the hook discipline).\n` +
          `5. SHOP/PROJECT HIGHLIGHT — the social spotlight post.\n` +
          `6. BLOG — a high-stack SEO outline (H2s, target query, which moments embed).\n` +
          `7. INK & EDGE — a magazine-article treatment (angle, pull quotes from the moments, ` +
          `art direction) usable in THE WRAP UP! and the quarterly.\n` +
          `8. BEHIND THE INSTALL — the music-video cut concept if the footage supports it.\n` +
          `9. CHANNEL SEPARATES — the same story tailored per channel, three versions: ` +
          `WEPRINTWRAPS (education-intent, shop-owner audience, print/wholesale CTA), ` +
          `WRAPTVWORLD (entertainment + community, the wrap-family voice, subscribe CTA), ` +
          `DESIGNPROAI (proof-of-work, Prompt-to-Print category, try-it CTA). For each: the hook, ` +
          `the caption, and which moments/cuts to use.\n` +
          `80% teach / 20% sell. Prompt-to-Print positioning where DesignPro/RecreatePro is named. ` +
          `Quote ONLY verbatim from the provided moments.`,
      };
    case "newsletter.wrapup":
      return {
        agent: "marketing",
        taskType: "email_campaign",
        category: "marketing",
        instructions:
          `Assemble this month's issue of THE WRAP UP! — WePrintWraps' monthly feature newsletter ` +
          `(spec: docs/INK_AND_EDGE_EDITORIAL.md). Build the complete campaign using ONLY the real ` +
          `data provided. Sections in order: [FOUNDER'S NOTE — leave as a clearly marked ` +
          `"TRISH WRITES THIS" placeholder, do not ghostwrite it] · WRAP OF THE MONTH (pick the best ` +
          `approved design from the list; tell it prompt-to-print) · THIS MONTH ON WRAPS THAT WORK ` +
          `(episode recap block — leave links as placeholders) · PLATFORM UPDATE (placeholder for ` +
          `Trish's segment notes) · SHOP FLOOR NUMBERS (jobs printed, biggest wrap — real numbers ` +
          `from the data) · PROMPT IT. WIN IT. (winner placeholder + entry call) · THE OFFER (one, ` +
          `20% sell max). Voice: 80% teach / 20% sell. Subject line should feel like a magazine ` +
          `cover, not a promo blast.`,
      };
    case "growth.weekly":
      return {
        agent: "growth",
        taskType: "analysis",
        category: "marketing",
        instructions:
          `Weekly growth review from the KPI snapshot provided. Draft the prioritized action list ` +
          `for this week (max 5 actions, each with the metric it moves).`,
      };
    case "exec.weekly":
      return {
        agent: "executive",
        taskType: "analysis",
        category: "operations",
        instructions:
          `Weekly executive summary from the KPI snapshot provided: what moved, what's stuck, ` +
          `top 3 decisions for Trish this week.`,
      };
    case "proof.revision":
      return {
        agent: "design",
        taskType: "design_brief",
        category: "design",
        instructions:
          `A customer sent revision notes on a proof. Turn them into a design brief: exact changes, ` +
          `panels affected, referenced assets, and open questions for the customer.`,
      };
    case "lead.captured":
      return {
        agent: "customer_success",
        taskType: "lead_followup",
        category: "sales",
        personalEmail: true,
        instructions:
          `A new lead just came in from the WPW wrap calculator / live chat (intent "${payload.intent}"). ` +
          `They told us their exact project — vehicle, material, square footage, estimated cost. ` +
          `Compose the complete PERSONAL first-touch email using those exact numbers: one useful ` +
          `education point about THEIR material/vehicle choice (install tip, durability fact, finish ` +
          `advice), their price, and one clear next step. For "filecheck" intent, focus on getting the ` +
          `file. Also give the follow-up plan (when to call/email next if no reply). Never invent specs ` +
          `or discounts.`,
      };
    case "task.revise":
      return {
        agent: "content",
        taskType: "email_campaign",
        category: String(payload.category ?? "marketing"),
        instructions:
          `A HUMAN reviewed your earlier draft and requested changes — this is direct feedback ` +
          `from the team; honoring it exactly is the top priority. Their note: "${payload.feedback}". ` +
          `Original work: "${payload.title}". Original draft follows in the event data. Produce the ` +
          `REVISED deliverable in full (not a diff), applying their note while keeping everything ` +
          `they didn't ask to change. Use the same output type as the original (campaign / social / ` +
          `blog_post / sms as appropriate). Open your summary with one line confirming what you changed.`,
      };
    case "task.execute":
      return {
        agent: "content",
        taskType: "email_campaign",
        category: "marketing",
        instructions:
          `EXECUTE this Engine Room board task — you are doing the work, not planning it. ` +
          `Task: "${payload.title}". Details: ${String(payload.description ?? "").slice(0, 800)}. ` +
          `Brand: ${payload.brand}. Produce the ACTUAL deliverable the card asks for, separated ` +
          `per brand and drafted to the target channel's native spec (Meta ads/organic, X, ` +
          `LinkedIn, YouTube, Substack, email, blog — see CHANNEL SPECS). Use "campaign" for ` +
          `email deliverables, "social" for a post (set platform+format), "blog_post" for ` +
          `articles, "sms" for texts. MANDATORY: populate at least one structured field (campaign, ` +
          `social, blog_post, or sms) with the COMPLETE finished piece — draft-text-only is a ` +
          `FAILED task; for social always set platform + format + full caption + hashtags. ` +
          `Everything you draft goes to the Content Director queue ` +
          `for human approval and a calendar slot — never claim it is published.`,
      };
    case "email.inbound": {
      // Design-question CSR lane (Design@WePrintWraps.com): file/proof/
      // artwork questions route to the design agent, whose draft must
      // check the customer's actual files. ALL inbound replies are
      // draft-only — the real team QCs before anything is emailed.
      const txt = `${payload.subject ?? ""} ${payload.body_preview ?? payload.body ?? ""} ${payload.to ?? ""}`.toLowerCase();
      const isDesign = /design@|proof|artwork|art file|print file|resolution|bleed|panel|vector|\.ai\b|\.eps\b|template|revision/.test(txt);
      if (isDesign) {
        return {
          agent: "design",
          assignee: "troy",
          taskType: "email_response",
          category: "operations",
          instructions:
            `A DESIGN QUESTION arrived at the design CSR inbox` +
            (payload.matched ? ` (matched to an existing order/proof).` : ` (no existing order matched).`) +
            ` Produce, in this order: (1) INTENT — one line. (2) FILE CHECK — from the event data ` +
            `(order/proof/job references), list which of the customer's files/proofs must be opened ` +
            `and what to verify on each (dimensions, bleed, resolution, color profile, panel match). ` +
            `Never claim you inspected a file — write the checklist for the human QC. ` +
            `(3) DRAFT REPLY — the complete response, technically precise but plain-spoken, ready for ` +
            `the design team to QC and send from Design@WePrintWraps.com. State clearly in the summary ` +
            `that a human must verify the file check before sending. Never invent file states or promise dates.`,
        };
      }
      return {
        agent: "customer_success",
        taskType: "email_response",
        category: "operations",
        instructions:
          `A customer email arrived at the shop inbox` +
          (payload.matched ? ` (matched to an existing order/proof).` : ` (NEW inquiry — no existing order matched).`) +
          ` Produce, in this order: (1) INTENT — one line: revision request / question / new quote ` +
          `request / complaint / other. (2) SUMMARY — what they want, in two sentences. ` +
          `(3) PROPOSED QUOTE — only if the email contains enough data (vehicle or dimensions): ` +
          `printed wrap film is $5.27/sq ft (3M or Avery, laminate included), ships in 48 hours; ` +
          `show the math. If data is missing, list the exact questions to ask instead. ` +
          `(4) DRAFT REPLY — the complete response for Troy to review and send from the shop inbox ` +
          `(warm, direct, one clear next step). If it is a design revision request, also itemize the ` +
          `changes as a brief for Lance. Never invent order details or promise dates.`,
      };
    }
    case "customer.winback_personal":
      return {
        agent: "marketing",
        taskType: "personal_email",
        category: "marketing",
        personalEmail: true,
        instructions:
          `Win back THIS specific past customer using their actual purchase history in the event data ` +
          `(what they ordered, when, how much, how many orders). Compose a personal email: reference ` +
          `what they printed with us (by product, warmly, not creepily), one genuinely useful education ` +
          `point relevant to what they bought (wrap care, refresh timing, new material options), and a ` +
          `clear invitation to reorder or start a new project. No fake discounts — if an incentive would ` +
          `help, say NEEDS-APPROVAL in the summary instead of promising one.`,
      };
    default:
      return null;
  }
}

interface ModelKeys {
  openai?: string;
  anthropic?: string;
}

// OpenAI is the PRIMARY drafting provider (the project's funded key —
// marketing-agent runs on it daily); Anthropic is the fallback.
async function callModel(system: string, user: string, keys: ModelKeys): Promise<string> {
  if (keys.openai) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${keys.openai}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (text) return text;
    } else {
      console.error("openai draft error:", res.status, (await res.text()).slice(0, 200));
    }
    if (!keys.anthropic) throw new Error("openai draft failed and no fallback key");
  }
  if (!keys.anthropic) throw new Error("no model key configured");
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": keys.anthropic,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

// Load the canonical brand voice (brands.brand_brain — the same source
// content-engine-claude uses) once per orchestrate run, so marketing/
// content/growth drafts speak WPW's actual voice instead of a condensed
// persona. Missing brain = agents still work on persona alone.
async function loadBrandBrain(db: Db): Promise<string> {
  try {
    const { data } = await db.from("brands")
      .select("brand_brain").eq("slug", "weprintwraps").maybeSingle();
    if (data?.brand_brain) {
      return JSON.stringify(data.brand_brain).slice(0, 8000);
    }
  } catch (e) {
    console.error("brand brain load failed (non-fatal):", e);
  }
  return "";
}

// Hook discipline for customer-facing copy (mirrors the pain-aware recipe
// in _shared/content-hook-recipes.ts — ContentStudio's source of truth).
const HOOK_DISCIPLINE =
  `HOOK DISCIPLINE: lead with the reader's pain or a teaching moment in their own words — ` +
  `never feature-first. ARC: PAIN → REVEAL → CREDIBILITY → PAYOFF. Hook = the pain. ` +
  `Headline = the mechanism that fixes it. Body = proof. CTA = a verb.`;

const BRAND_VOICE_AGENTS = new Set(["marketing", "content", "growth", "customer_success"]);

async function draftWithAgent(
  agent: AgentProfile,
  route: Route,
  eventType: string,
  payload: Json,
  keys: ModelKeys,
  brandBrain: string,
): Promise<Json> {
  const wantCampaign = agent.emailCampaign && route.taskType === "email_campaign";
  const wantSocial = agent.socialPost && route.taskType === "social_post";
  const wantPersonal = route.personalEmail === true;
  const schema = wantCampaign
    ? `{"title": string, "summary": string, "draft": string, "campaign": {"campaign_name": string, "campaign_type": string, "subject_line": string, "preview_text": string, "body_text": string, "body_html": string, "list_segment": string} | null, "blog_post": {"brand": "weprintwraps" | "inkandedge" | "restylepro", "title": string, "excerpt": string, "body_html": string, "keywords": string[]} | null, "sms": {"name": string, "message": string, "audience": string} | null}`
    : wantPersonal
    ? `{"title": string, "summary": string, "draft": string, "personal_email": {"subject": string, "body_html": string} | null}`
    : wantSocial
    ? `{"title": string, "summary": string, "draft": string, "social": {"caption": string, "hashtags": string[], "platform": "instagram" | "instagram_reels" | "facebook" | "x" | "linkedin" | "pinterest" | "youtube" | "youtube_shorts" | "substack" | "founder", "format": string} | null}`
    : `{"title": string, "summary": string, "draft": string}`;

  const useBrain = !!brandBrain && BRAND_VOICE_AGENTS.has(String(route.agent));
  const brandBlock = useBrain
    ? `\n\nBRAND BRAIN (WePrintWraps voice + facts — this overrides generic style; never contradict it):\n${brandBrain}\n\n${HOOK_DISCIPLINE}`
    : "";
  const specBlock = (wantSocial || wantCampaign) ? `\n\n${channelSpecPromptBlock()}` : "";
  const system =
    `${agent.persona}${brandBlock}${specBlock}\n\nYou receive a business event and produce the finished work product ` +
    `a human will review before anything is sent or published. Respond with ONLY valid JSON ` +
    `matching: ${schema}\n` +
    `"title" = short Hub card title (may include one emoji). "summary" = 1-3 sentence context ` +
    `for the reviewer. "draft" = the complete work product (email with Subject: line, checklist, ` +
    `brief, or plan) in plain text, ready to use.` +
    (wantCampaign
      ? ` Include "campaign" ONLY when a full email campaign is the deliverable.` +
        ` Include "blog_post" ONLY when the material carries a full education/SEO article ` +
        `(700+ words of clean HTML, h2/h3 sections, NO h1). Include "sms" ONLY when a short ` +
        `text blast fits (under 300 chars, one clear CTA).`
      : "") +
    (wantSocial ? ` Include "social" ONLY when a social post is the deliverable.` : "") +
    (wantPersonal
      ? ` "personal_email" is the ready-to-send individual email for THIS customer: subject + ` +
        `body_html (simple inline-styled HTML paragraphs, warm and specific, built ONLY from the ` +
        `event data — their name, their product, their numbers). No placeholder brackets.`
      : "");
  const user =
    `Event type: ${eventType}\n\nTask: ${route.instructions}\n\n` +
    `Event data (the only facts you may use):\n${JSON.stringify(payload, null, 2)}`;

  const text = await callModel(system, user, keys);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON in model reply");
  return JSON.parse(jsonMatch[0]);
}

async function writeAgentTask(db: Db, args: {
  eventId: string; agent: AgentProfile; route: Route;
  title: string; description: string; priority?: string; extraMeta?: Json;
}): Promise<string | null> {
  const { data, error } = await db.from("slack_agent_tasks").insert({
    brand: BRAND,
    category: args.route.category,
    task_type: args.route.taskType,
    title: args.title,
    description: args.description,
    priority: args.priority ?? "high",
    status: "pending",
    assigned_to: (args.route as { assignee?: string }).assignee ?? args.agent.defaultAssignee,
    due_date: new Date(Date.now() + MS_PER_DAY).toISOString(),
    created_by: args.agent.id,
    metadata: { workforce: true, workforce_event_id: args.eventId, ...(args.extraMeta ?? {}) },
  }).select("id").single();
  if (error) throw new Error(`task insert: ${error.message}`);
  return data?.id ?? null;
}

async function writeCampaign(db: Db, agent: AgentProfile, c: Json): Promise<string | null> {
  const { data, error } = await db.from("agent_email_campaigns").insert({
    brand: BRAND,
    campaign_name: c.campaign_name,
    campaign_type: c.campaign_type || "winback",
    subject_line: c.subject_line,
    preview_text: c.preview_text,
    body_text: c.body_text,
    body_html: c.body_html,
    list_segment: c.list_segment || "dormant 120+ day customers",
    status: "needs_review",
    created_by: agent.id,
  }).select("id").single();
  if (error) throw new Error(`campaign insert: ${error.message}`);
  return data?.id ?? null;
}

// Stage an agent-drafted blog article into the existing SEO authoring
// system (seo_blog_posts, status draft) — the SEO review flow +
// seo-wp-publish take it from there. Shop resolved from the WPW
// WordPress connection; returns null (non-fatal) when none exists.
async function writeBlogDraft(db: Db, agent: AgentProfile, b: Json): Promise<string | null> {
  if (!b?.title || !b?.body_html) return null;
  // Blog is PER BRAND: pick the WordPress connection matching the draft's
  // brand domain (weprintwraps.com / inkandedge.com / restyleproai.com);
  // fall back to WPW, then to any connection.
  const BRAND_DOMAINS: Record<string, string> = {
    weprintwraps: "weprintwraps", inkandedge: "inkandedge",
    restylepro: "restylepro", designproai: "restylepro",
  };
  const wantDomain = BRAND_DOMAINS[String(b.brand ?? "").toLowerCase()] ?? "weprintwraps";
  const { data: conn } = await db.from("seo_wp_connections")
    .select("shop_id, site_url").ilike("site_url", `%${wantDomain}%`).limit(1).maybeSingle();
  const shopId = conn?.shop_id
    ?? (await db.from("seo_wp_connections").select("shop_id, site_url").ilike("site_url", "%weprintwraps%").limit(1).maybeSingle()).data?.shop_id
    ?? (await db.from("seo_wp_connections").select("shop_id").limit(1).maybeSingle()).data?.shop_id;
  if (!shopId) return null;
  const slug = String(b.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const { data, error } = await db.from("seo_blog_posts").insert({
    shop_id: shopId,
    title: String(b.title).slice(0, 200),
    slug,
    excerpt: String(b.excerpt ?? "").slice(0, 500),
    body_html: String(b.body_html),
    meta_title: String(b.title).slice(0, 200),
    meta_description: String(b.excerpt ?? "").slice(0, 160),
    keywords: Array.isArray(b.keywords) ? b.keywords.slice(0, 10) : [],
    status: "draft",
    author_name: "WPW AI Workforce",
  }).select("id").single();
  if (error) { console.error("blog draft insert failed (non-fatal):", error.message); return null; }
  return data?.id ?? null;
}

// Stage an agent-drafted SMS blast for human review — send-sms-campaign
// (Twilio) is only ever invoked manually from an approved draft; the
// workforce never texts customers on its own.
async function writeSmsDraft(db: Db, agent: AgentProfile, s: Json): Promise<string | null> {
  if (!s?.message) return null;
  const { data, error } = await db.from("agent_sms_campaigns").insert({
    brand: BRAND,
    name: String(s.name ?? "Workforce SMS draft").slice(0, 120),
    message_template: String(s.message).slice(0, 320),
    audience: String(s.audience ?? "").slice(0, 200),
    status: "needs_review",
    created_by: agent.id,
  }).select("id").single();
  if (error) { console.error("sms draft insert failed (non-fatal):", error.message); return null; }
  return data?.id ?? null;
}

// Stage a finished social post as a DRAFT — content-deploy only publishes
// status "scheduled", so a human schedules it in Content Review.
async function writeSocialPost(db: Db, agent: AgentProfile, s: Json, mediaUrls: string[]): Promise<string | null> {
  // Platform allowlist comes from _shared/channel-specs.ts. instagram/
  // facebook auto-publish via content-deploy once scheduled; the rest
  // stay drafts a human posts natively (no API publisher yet).
  const KNOWN = new Set(["instagram", "instagram_reels", "facebook", "x", "linkedin", "pinterest", "youtube", "youtube_shorts", "substack", "founder"]);
  const platform = KNOWN.has(String(s.platform)) ? String(s.platform) : "instagram";
  const { data, error } = await db.from("agent_social_posts").insert({
    brand: BRAND,
    platform,
    post_type: typeof s.format === "string" && s.format ? s.format.slice(0, 30) : "feed",
    caption: s.caption || "",
    hashtags: Array.isArray(s.hashtags) ? s.hashtags : [],
    media_urls: mediaUrls,
    scheduled_date: null,
    status: "draft",
    created_by: agent.id,
  }).select("id").single();
  if (error) throw new Error(`social insert: ${error.message}`);
  return data?.id ?? null;
}

// Queue an agent-written personal email through the existing pipeline
// (scheduled_emails → send-templated-email → Resend; opens/clicks mirror
// to Klaviyo via resend-webhook). 30-minute delay so the card is visible
// on the dashboard before it goes out. One per event, ever (source_ref).
async function queuePersonalEmail(
  db: Db,
  ev: { id: string; dedupe_key: string },
  recipient: string,
  personal: { subject: string; body_html: string },
  shopId: string | null,
): Promise<boolean> {
  const sourceRef = `personal_${ev.dedupe_key}`;
  const { count } = await db
    .from("scheduled_emails")
    .select("id", { count: "exact", head: true })
    .eq("source_ref", sourceRef);
  if ((count ?? 0) > 0) return false;
  const { error } = await db.from("scheduled_emails").insert({
    send_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    template_slug: "workforce-personal-v1",
    recipient_email: recipient,
    subject_override: personal.subject,
    merge_data: { body_html: personal.body_html },
    shop_id: shopId,
    source: "workforce_personal",
    source_ref: sourceRef,
    status: "pending",
  });
  if (error) throw new Error(`personal email queue: ${error.message}`);
  return true;
}

// deno-lint-ignore no-explicit-any
async function processEvent(db: Db, ev: any, keys: ModelKeys, brandBrain: string): Promise<Json> {
  const payload: Json = ev.payload ?? {};
  const route = routeFor(ev.event_type, payload);
  if (!route) return { skipped: true, reason: `no route for ${ev.event_type}` };
  const agent = AGENTS[route.agent];

  let out: Json | null = null;
  let draftError: string | null = null;
  if (keys.openai || keys.anthropic) {
    try {
      out = await draftWithAgent(agent, route, ev.event_type, payload, keys, brandBrain);
    } catch (err) {
      draftError = (err as Error).message;
      console.error(`draft failed for ${ev.id} (${ev.event_type}):`, draftError);
    }
  } else {
    draftError = "no model key configured (OPENAI_API_KEY / ANTHROPIC_API_KEY)";
  }

  let campaignId: string | null = null;
  if (out?.campaign && agent.emailCampaign) {
    campaignId = await writeCampaign(db, agent, out.campaign);
  }
  let blogId: string | null = null;
  if (out?.blog_post && agent.emailCampaign) {
    blogId = await writeBlogDraft(db, agent, out.blog_post);
  }
  let smsId: string | null = null;
  if (out?.sms && agent.emailCampaign) {
    smsId = await writeSmsDraft(db, agent, out.sms);
  }
  let socialId: string | null = null;
  if (out?.social && agent.socialPost) {
    const mediaUrls = Array.isArray(payload.render_urls)
      ? payload.render_urls.filter((u: unknown) => typeof u === "string")
      : [];
    socialId = await writeSocialPost(db, agent, out.social, mediaUrls);
  }

  // Personal per-customer email: queued for real send ONLY when sends are
  // enabled; otherwise it stays a draft on the card.
  let personalQueued = false;
  const sendsEnabled = (Deno.env.get("WORKFORCE_SENDS_ENABLED") || "").toLowerCase() === "on";
  const recipient = String(payload.customer_email || payload.email || "").trim();
  if (out?.personal_email?.subject && out?.personal_email?.body_html && route.personalEmail && recipient.includes("@")) {
    if (sendsEnabled) {
      personalQueued = await queuePersonalEmail(
        db, ev, recipient, out.personal_email, Deno.env.get("WPW_SHOP_ID") || null,
      );
    }
  }

  // media.analyze write-back: parse the agent's JSON and update the
  // catalog (source enrichment + scored moments). Best-effort.
  let momentsWritten = 0;
  if (ev.event_type === "media.analyze" && out && payload.source_id) {
    try {
      // The model may nest the analysis in "draft" (as a string or object)
      // or emit it at the top level — accept all three shapes.
      let analysis: Json | null = null;
      if (out.source || out.moments) analysis = out;
      else if (out.draft && typeof out.draft === "object") analysis = out.draft as Json;
      else if (out.draft) {
        const jm = String(out.draft).match(/\{[\s\S]*\}/);
        if (jm) analysis = JSON.parse(jm[0]);
      }
      if (analysis) {
        if (analysis.source) {
          const s = analysis.source;
          await db.from("media_sources").update({
            emotional_tone: s.emotional_tone ?? null,
            energy: s.energy ?? null,
            brands: Array.isArray(s.brands) ? s.brands : [],
            vehicles: Array.isArray(s.vehicles) ? s.vehicles : [],
            people: Array.isArray(s.people) ? s.people : [],
            recommended_formats: Array.isArray(s.recommended_formats) ? s.recommended_formats : [],
            script_ideas: Array.isArray(s.script_ideas) ? s.script_ideas : [],
            review_status: "analyzed",
          }).eq("id", payload.source_id);
        }
        if (Array.isArray(analysis.moments) && analysis.moments.length > 0) {
          // Replace raw segments with the agent's curated, scored moments.
          await db.from("content_moments").delete().eq("source_id", payload.source_id);
          const rows = analysis.moments.slice(0, 60).map((m: Json) => ({
            source_id: payload.source_id,
            start_time: m.start ?? null,
            end_time: m.end ?? null,
            speaker: m.speaker ?? null,
            verbatim_quote: String(m.verbatim_quote ?? "").slice(0, 1000),
            hook_score: Number.isFinite(m.hook_score) ? m.hook_score : null,
            soundbite_score: Number.isFinite(m.soundbite_score) ? m.soundbite_score : null,
            content_uses: Array.isArray(m.content_uses) ? m.content_uses : [],
            review_status: "analyzed",
          }));
          const { error: mErr } = await db.from("content_moments").insert(rows);
          if (!mErr) momentsWritten = rows.length;
        }
        // Analysis landed → fire the ATOMIZATION stage: one source, the
        // full channel stack (reels, email, ads, blog, magazine, video).
        if (momentsWritten > 0 || analysis.source) {
          await db.from("workforce_events").insert({
            event_type: "content.atomize",
            dedupe_key: `atomize_${payload.source_id}`,
            source: "media.analyze",
            payload: {
              source_id: payload.source_id,
              filename: payload.filename,
              kind: payload.kind,
              source_meta: analysis.source ?? {},
              top_moments: (Array.isArray(analysis.moments) ? analysis.moments : []).slice(0, 15),
            },
          }).select("id");
        }
      }
    } catch (wbErr) {
      console.error("media.analyze write-back failed (non-fatal):", wbErr);
    }
  }

  const title = out?.title || `[${route.agent}] ${ev.event_type} — needs attention`;
  const description = out
    ? `${out.summary ?? ""}\n\n--- DRAFT (review before use) ---\n${out.draft ?? ""}` +
      (campaignId
        ? `\n\n📧 Full campaign saved to Marketing Hub review queue (id ${campaignId}). ` +
          `Approve it and the daily marketing-agent run pushes it to Klaviyo as a draft.`
        : "") +
      (socialId
        ? `\n\n📱 Post staged as a DRAFT with the real renders attached (id ${socialId}). ` +
          `Schedule it in Content Review and content-deploy publishes it when due.`
        : "") +
      (blogId
        ? `\n\n📝 Blog article drafted into the SEO system (seo_blog_posts id ${blogId}). ` +
          `Review in Admin → SEO and publish to WordPress from there.`
        : "") +
      (smsId
        ? `\n\n📲 SMS blast drafted for review (id ${smsId}). Texts are NEVER sent ` +
          `automatically — send manually via the SMS campaign tool after approval.`
        : "") +
      (out?.personal_email
        ? (personalQueued
          ? `\n\n✉️ PERSONAL EMAIL QUEUED — sends to ${recipient} in ~30 minutes via MightyMail. ` +
            `Cancel in Admin → MightyMail if it misses the mark.\nSubject: ${out.personal_email.subject}`
          : `\n\n✉️ Personal email drafted for ${recipient} (NOT queued — WORKFORCE_SENDS_ENABLED is off).\n` +
            `Subject: ${out.personal_email.subject}`)
        : "")
    : `Automated draft unavailable (${draftError}). Raw event data:\n${JSON.stringify(payload, null, 2)}`;

  const taskId = await writeAgentTask(db, {
    eventId: ev.id, agent, route, title, description,
    extraMeta: {
      ...(campaignId ? { campaign_id: campaignId } : {}),
      ...(socialId ? { social_post_id: socialId } : {}),
      ...(blogId ? { blog_post_id: blogId } : {}),
      ...(smsId ? { sms_campaign_id: smsId } : {}),
    },
  });

  return {
    agent: route.agent, assignee: agent.defaultAssignee, title, task_id: taskId,
    campaign_id: campaignId, social_post_id: socialId, blog_post_id: blogId,
    sms_campaign_id: smsId, moments_written: momentsWritten,
    drafted: !!out, draft_error: draftError,
  };
}

// ── Team notification — agents reach the humans where they live ──────
// One Resend email per person per run listing their new prepared work.
// Recipient mapping comes from the WORKFORCE_TEAM_EMAILS secret
// (JSON: {"troy":"troy@...","lance":"lance@..."}); anyone unmapped
// falls back to trish@weprintwraps.com so nothing is ever silent.
async function notifyTeam(items: { assignee: string; title: string }[]) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey || items.length === 0) return { notified: 0 };
  let map: Record<string, string> = {};
  try { map = JSON.parse(Deno.env.get("WORKFORCE_TEAM_EMAILS") || "{}"); } catch { /* bad JSON */ }
  const fallback = "trish@weprintwraps.com";

  const byPerson = new Map<string, string[]>();
  for (const it of items) {
    const who = (it.assignee || "team").toLowerCase();
    if (!byPerson.has(who)) byPerson.set(who, []);
    byPerson.get(who)!.push(it.title);
  }

  let notified = 0;
  for (const [who, titles] of byPerson) {
    const to = map[who] || fallback;
    const list = titles.map((t) => `<li style="margin:6px 0;">${t.replace(/</g, "&lt;")}</li>`).join("");
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "WPW AI Workforce <noreply@restyleproai.com>",
          to: [to],
          subject: `🤖 ${titles.length} prepared work item(s) for ${who}`,
          html:
            `<div style="font-family:-apple-system,sans-serif;color:#0d1220;max-width:560px;">` +
            `<h3 style="margin:0 0 8px;">New prepared work on your board</h3>` +
            `<p style="color:#64748b;font-size:14px;margin:0 0 12px;">The AI workforce prepared these — each card has the draft attached. Review, edit if needed, approve.</p>` +
            `<ul style="font-size:14px;padding-left:18px;">${list}</ul>` +
            `<a href="https://www.restyleproai.com/admin/workforce" style="display:inline-block;margin-top:10px;padding:10px 18px;border-radius:8px;background:#0b0d14;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open the Workforce Dashboard →</a>` +
            `</div>`,
        }),
      });
      if (res.ok) notified++;
      else console.error("notify email failed:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.error("notify email error (non-fatal):", e);
    }
  }
  return { notified };
}

async function runOrchestrate(db: Db) {
  const keys: ModelKeys = {
    openai: Deno.env.get("OPENAI_API_KEY") || undefined,
    anthropic: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
  };

  // Reclaim events stuck in 'processing' >30 min (crashed run).
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await db.from("workforce_events")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("claimed_at", cutoff);

  const { data: events, error } = await db.from("workforce_events")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(ORCH_BATCH_SIZE);
  if (error) throw new Error(`events query: ${error.message}`);

  const brandBrain = (events ?? []).length > 0 ? await loadBrandBrain(db) : "";

  const results: Json[] = [];
  for (const ev of events ?? []) {
    const { error: claimErr } = await db.from("workforce_events")
      .update({ status: "processing", claimed_at: new Date().toISOString() })
      .eq("id", ev.id).eq("status", "pending");
    if (claimErr) continue;

    try {
      const out = await processEvent(db, ev, keys, brandBrain);
      await db.from("workforce_events").update({
        status: out.skipped ? "skipped" : "done",
        output: out,
        processed_at: new Date().toISOString(),
      }).eq("id", ev.id);
      results.push({ id: ev.id, type: ev.event_type, ...out });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      await db.from("workforce_events").update({
        status: "failed", error: msg, processed_at: new Date().toISOString(),
      }).eq("id", ev.id);
      results.push({ id: ev.id, type: ev.event_type, error: msg });
    }
  }

  // Tell the humans their prepared work exists (email, non-fatal).
  const created = results
    .filter((r) => r.task_id && r.title)
    .map((r) => ({ assignee: String(r.assignee || "team"), title: String(r.title) }));
  const notify = await notifyTeam(created);

  return { processed: results.length, notified: notify.notified, results };
}

// ── Install (mode: "install") — one-shot schema + cron bootstrap ─────
// Applies the two workforce migrations over the edge runtime's direct
// DB connection. Fully idempotent (IF NOT EXISTS / unschedule-then-
// schedule), so re-invocation is harmless. Exists because migrations
// could not be applied through the session tooling (read-only).
async function runInstall(): Promise<Record<string, unknown>> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) throw new Error("SUPABASE_DB_URL not available in this runtime");
  const sql = postgres(dbUrl, { prepare: false });
  try {
    await sql.unsafe(INSTALL_SQL);
    const jobs = await sql`
      SELECT jobname, schedule FROM cron.job
      WHERE jobname IN (
        'wpw-workforce-sweep-hourly','wpw-workforce-digest','wpw-workforce-orchestrator',
        'proof-intake-sweep-hourly','seo-auto-blog-daily')
      ORDER BY jobname`;
    return { installed: true, cron_jobs: jobs };
  } finally {
    await sql.end();
  }
}

// ── Transcribe (mode: "transcribe") — give the workforce ears ────────
// Accepts {mode:"transcribe", filename, audio_base64}: archives the
// master to wrap-files/wraptv-music/ and transcribes via OpenAI Whisper.
// Used to parse WrapTVWorld original music + video audio for lyrics,
// sound bites, and hooks. Max ~20MB audio (Whisper API limit is 25MB).
async function runTranscribe(db: Db, body: { filename?: string; audio_base64?: string; media_url?: string }) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  let bytes: Uint8Array;
  let path: string;
  const safe = String(body.filename || "track.mp3").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const isVideo = /\.(mp4|mov|webm)$/i.test(safe);
  if (body.media_url) {
    // Transcribe media already in OUR storage (e.g. an ingested clip) —
    // Whisper accepts video directly for files ≤20MB.
    const res0 = await fetch(body.media_url);
    if (!res0.ok) throw new Error(`media fetch ${res0.status}`);
    bytes = new Uint8Array(await res0.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new Error("media too large for Whisper (20MB max)");
    const m = body.media_url.match(/wrap-files\/(.+)$/);
    path = m ? decodeURIComponent(m[1]) : `wraptv-media/${safe}`;
  } else {
    if (!body.audio_base64) throw new Error("audio_base64 or media_url required");
    bytes = Uint8Array.from(atob(body.audio_base64), (c) => c.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) throw new Error("audio too large (20MB max)");
    path = `${isVideo ? "wraptv-media" : "wraptv-music"}/${safe}`;
    const { error: upErr } = await db.storage.from("wrap-files").upload(path, bytes, {
      contentType: isVideo ? "video/mp4" : "audio/mpeg",
      upsert: true,
    });
    if (upErr) console.error("media archive upload failed (non-fatal):", upErr.message);
  }

  // WORD-LEVEL TIMING. This is the ONLY transcription path in the system —
  // worker/media-parser POSTs its chunks here — so this one parameter decides
  // whether anything downstream can cut inside a sentence.
  //
  // Without it Whisper returns SEGMENT bounds only, and a segment is a whole
  // utterance. That makes "edit the bad parts out" impossible to do safely: an
  // "um" or a false start sits INSIDE a segment, and with no word boundaries
  // the only options are to leave it or to guess where the word ends. Guessing
  // clips a word, which is the exact failure the speech-craft lock exists to
  // prevent (CLAUDE.md: never trim inside speech) — so `badTakes` correctly
  // refuses to cut at all, and the feature silently does nothing.
  //
  // It is additive: `segments` still comes back unchanged, so every existing
  // reader is untouched, and it costs nothing extra on the same call.
  const buildForm = (withWords: boolean) => {
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: isVideo ? "video/mp4" : "audio/mpeg" }), safe);
    fd.append("model", "whisper-1");
    fd.append("response_format", "verbose_json");
    // Whisper drops `segments` unless it is asked for alongside `word`.
    if (withWords) {
      fd.append("timestamp_granularities[]", "segment");
      fd.append("timestamp_granularities[]", "word");
    }
    return fd;
  };

  const callWhisper = (withWords: boolean) =>
    fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: buildForm(withWords),
    });

  let res = await callWhisper(true);
  // FALL BACK RATHER THAN LOSE THE TRANSCRIPT. This is the only transcriber in
  // the system; if the parameter is ever rejected — an API change, a model
  // swap, a proxy that mangles the repeated key — a hard failure here would
  // stop ALL ingestion, and word timing is an enhancement, not the job. So a
  // 4xx retries once without it and we keep segment-level timing, which is
  // exactly what this function returned before.
  let wordTimings = true;
  if (!res.ok && res.status >= 400 && res.status < 500) {
    const why = (await res.text()).slice(0, 200);
    console.warn(`whisper word-timestamps rejected (${res.status}: ${why}) — retrying segment-only`);
    wordTimings = false;
    res = await callWhisper(false);
  }
  if (!res.ok) throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);
  const transcript: string = data.text ?? "";
  // deno-lint-ignore no-explicit-any
  const segments: any[] = Array.isArray(data.segments) ? data.segments : [];

  // Content Intelligence Library: one media_sources row + timestamped
  // content_moments per Whisper segment, then an analyze event so an
  // agent scores/tags the moments. Best-effort — cataloging failure
  // must not fail the transcription.
  let sourceId: string | null = null;
  try {
    const kind = path.includes("music") ? "music" : "video";
    const { data: existing } = await db.from("media_sources")
      .select("id").eq("dedupe_key", path).maybeSingle();
    if (existing?.id) {
      sourceId = existing.id;
      await db.from("media_sources").update({
        transcript, duration_seconds: data.duration ?? null,
      }).eq("id", sourceId);
    } else {
      const { data: src } = await db.from("media_sources").insert({
        kind, title: safe, filename: safe, storage_url: pub?.publicUrl ?? null,
        transcript, duration_seconds: data.duration ?? null, dedupe_key: path,
      }).select("id").single();
      sourceId = src?.id ?? null;
    }
    if (sourceId && segments.length > 0) {
      await db.from("content_moments").delete().eq("source_id", sourceId);
      // Whisper returns `words` as ONE flat array for the whole file, not
      // nested inside each segment, so they are sliced back onto the segment
      // whose span contains them. A word is assigned by its START only — using
      // both bounds would drop any word that straddles a segment boundary, and
      // a dropped word is a hole in the timing exactly where a cut is most
      // likely to be attempted.
      // deno-lint-ignore no-explicit-any
      const allWords: any[] = Array.isArray(data.words) ? data.words : [];
      const rows = segments.slice(0, 300).map((s) => {
        const words = allWords
          .filter((w) => Number(w?.start) >= Number(s.start) && Number(w?.start) < Number(s.end))
          .map((w) => ({ w: String(w.word ?? "").trim(), s: Number(w.start), e: Number(w.end) }))
          .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e));
        return {
          source_id: sourceId,
          start_time: s.start ?? null,
          end_time: s.end ?? null,
          verbatim_quote: String(s.text ?? "").trim().slice(0, 1000),
          // NULL, never `[]`, when there is no word timing. The distinction is
          // load-bearing downstream: `[]` reads as "this segment has no words",
          // which would let an editor conclude it may cut anywhere inside it.
          // NULL reads as "we do not know where the words are", and everything
          // that cuts inside speech is required to refuse on that.
          words: words.length ? words : null,
        };
      });
      // ORDERING HAZARD, CLOSED HERE. `words` is a new column and this function
      // deploys via GitHub Actions while the migration applies on merge — two
      // different clocks. If the deploy wins the race, PostgREST rejects the
      // whole insert for an unknown column and NO moments are written at all:
      // a transcript would parse fine and land nowhere, for every clip, until
      // someone noticed. CLAUDE.md has the general form of this ("the runner
      // must ship first"); this is the same hazard with the halves reversed.
      //
      // So the enhancement degrades instead of destroying the write.
      const { error: insErr } = await db.from("content_moments").insert(rows);
      if (insErr) {
        console.warn(`content_moments insert with words failed (${insErr.message}) — retrying without word timing`);
        await db.from("content_moments").insert(rows.map(({ words: _w, ...rest }) => rest));
      }
    }
    if (sourceId) {
      await db.from("workforce_events").insert({
        event_type: "media.analyze",
        dedupe_key: `analyze_${path}`,
        source: "transcribe",
        payload: {
          source_id: sourceId, filename: safe, kind: path.includes("music") ? "music" : "video",
          transcript: transcript.slice(0, 6000),
          segments: segments.slice(0, 80).map((s) => ({
            start: s.start, end: s.end, text: String(s.text ?? "").trim().slice(0, 200),
          })),
        },
      }).select("id");
    }
  } catch (catErr) {
    console.error("catalog write failed (non-fatal):", catErr);
  }

  return {
    transcript, storage_path: path, public_url: pub?.publicUrl ?? null,
    source_id: sourceId, moments: segments.length,
    // REPORTED, not assumed. media-parser aggregates these per chunk, so a
    // silent fall back to segment-only timing would otherwise look identical
    // to a good run — and the first symptom would be the bad-take editor
    // quietly refusing every cut with nobody able to say when it started.
    word_timings: wordTimings,
    words: Array.isArray(data.words) ? data.words.length : 0,
  };
}

// ── Ingest media (mode: "ingest_media") — Drive → media library ──────
// Pulls a video from a URL (Google Drive share links converted to
// direct-download), archives it to wrap-files/wraptv-media/, and
// registers it in agent_media_assets so video-auto-assemble can select
// clips from it for installer mashups. Edge memory caps this at ~80MB
// per file — clip exports, not multi-GB raws (those go via manual
// storage upload or the render worker later).
async function runIngestMedia(db: Db, body: { url?: string; filename?: string; tags?: string[]; category?: string }) {
  if (!body.url) throw new Error("url required");
  let url = body.url;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) url = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 80 * 1024 * 1024) throw new Error("file too large for edge ingest (80MB cap) — upload to storage manually");
  if (buf.length < 1024) throw new Error("downloaded file suspiciously small — Drive link may require 'anyone with link' sharing");

  const safe = String(body.filename || `clip_${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const isImage = /\.(jpe?g|png|webp)$/i.test(safe);
  const path = `wraptv-media/${safe}`;
  const { error: upErr } = await db.storage.from("wrap-files").upload(path, buf, {
    contentType: isImage ? (safe.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg") : "video/mp4",
    upsert: true,
  });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);
  const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);

  const { data: row, error: insErr } = await db.from("agent_media_assets").insert({
    storage_url: pub?.publicUrl,
    asset_type: isImage ? "image" : "video",
    original_filename: safe,
    tags: body.tags ?? ["install", "installer", "shop"],
    content_category: body.category ?? "install",
  }).select("id").single();
  if (insErr) throw new Error(`media asset insert: ${insErr.message}`);

  // Catalog layer (best-effort): every ingested video gets a
  // media_sources row so the intelligence library sees it even before
  // transcription/analysis runs.
  try {
    await db.from("media_sources").insert({
      kind: "video", title: safe, filename: safe,
      storage_url: pub?.publicUrl ?? null,
      drive_id: (body.url?.match(/id=([\w-]{20,})/) || [])[1] ?? null,
      shoot: (body.tags ?? []).find((t) => !["install", "installer", "shop", "behind-shop-doors"].includes(t)) ?? null,
      dedupe_key: path,
    });
  } catch (_) { /* duplicate or table missing — fine */ }

  return { asset_id: row?.id, storage_path: path, public_url: pub?.publicUrl, bytes: buf.length };
}

// ── Library (mode: "library") — read the content intelligence back ───
// Returns the best hooks/sound bites across ALL cataloged sources plus
// the music library, ready for text-overlay pairing. This is the query
// surface the marketing agent (and the dashboard) reads.
async function runLibrary(db: Db) {
  const { data: moments } = await db.from("content_moments")
    .select("verbatim_quote, start_time, end_time, hook_score, soundbite_score, content_uses, source_id, media_sources(title, shoot, kind)")
    .not("hook_score", "is", null)
    .order("hook_score", { ascending: false })
    .limit(40);
  const { data: sources } = await db.from("media_sources")
    .select("title, kind, shoot, emotional_tone, energy, recommended_formats, review_status")
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: music } = await db.from("music_analysis").select("*").limit(10);
  return {
    top_moments: moments ?? [],
    sources: sources ?? [],
    music: music ?? [],
  };
}

// ── Entry ────────────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createExternalClient();
  let body: { mode?: string; dryRun?: boolean; filename?: string; audio_base64?: string; media_url?: string; url?: string; tags?: string[]; category?: string } = {};
  try { body = await req.json(); } catch { /* empty body = defaults */ }
  const mode = ["digest", "orchestrate", "install", "transcribe", "ingest_media", "library"].includes(String(body.mode)) ? String(body.mode) : "sweep";
  const dryRun = body.dryRun === true;
  const sendsEnabled = (Deno.env.get("WORKFORCE_SENDS_ENABLED") || "").toLowerCase() === "on";
  const shopId = Deno.env.get("WPW_SHOP_ID") || null;
  const appOrigin = Deno.env.get("APP_ORIGIN") || "https://www.restyleproai.com";

  const startedAt = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const results: Record<string, any> = { mode, dryRun, sendsEnabled };
  let runError: string | null = null;

  try {
    if (mode === "install") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const authorization = req.headers.get("authorization") || "";
      if (!serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`) {
        return new Response(JSON.stringify({
          success: false,
          error: "Unauthorized",
          mode: "install",
          disabled: true,
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Runtime schema installation is permanently disabled. Migrations are
      // the sole schema authority. Keep an authenticated, logged no-op so a
      // stale trusted caller does not receive a 500 or mutate production.
      results.install = {
        disabled: true,
        executed: false,
        reason: "runtime_schema_install_disabled",
      };
    } else if (mode === "transcribe") {
      results.transcribe = await runTranscribe(db, body);
    } else if (mode === "ingest_media") {
      results.ingest = await runIngestMedia(db, body);
    } else if (mode === "library") {
      results.library = await runLibrary(db);
    } else if (mode === "digest") {
      results.digest = await runDigest(db, dryRun);
    } else if (mode === "orchestrate") {
      results.orchestrate = await runOrchestrate(db);
    } else {
      results.stuck_orders = await sweepStuckOrders(db, dryRun);
      results.post_purchase = await sweepPostPurchase(db, dryRun, sendsEnabled, shopId);
      results.quotes = await sweepQuotes(db, dryRun, sendsEnabled, shopId, appOrigin);
      results.dormant = await sweepDormant(db, dryRun);
      results.board_tasks = await sweepBoardTasks(db, dryRun);
      results.revisions = await sweepRevisionRequests(db, dryRun);
      results.approved_designs = await sweepApprovedDesigns(db, dryRun);
    }
  } catch (err) {
    runError = (err as Error).message ?? String(err);
    console.error("wpw-workforce-sweep error:", runError);
  }

  // Log the run (best-effort — a logging failure must not fail the sweep).
  try {
    await db.from("workforce_runs").insert({
      mode,
      dry_run: dryRun,
      sends_enabled: sendsEnabled,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results,
      error: runError,
    });
  } catch (logErr) {
    console.error("workforce_runs log failed:", logErr);
  }

  return new Response(JSON.stringify({ success: !runError, ...results, error: runError }), {
    status: runError ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
