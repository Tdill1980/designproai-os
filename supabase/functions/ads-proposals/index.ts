// ads-proposals — the approve-gated action board for paid Meta ads.
//
// WHAT THIS IS. AdsPro could already SEE every ad and score it REMOVE /
// REPLACE / KEEP, but acting on that meant reading a table, deciding, and
// then going and doing it somewhere else. This turns each verdict into a
// PROPOSAL the owner approves or rejects in one click — the same shape as
// Lead Replies, where an AI drafts and NOTHING happens until a human clicks.
//
// THE GATE IS THE POINT. `decide` records the decision and queues targets; it
// touches nothing. `dispatch` is the only action that executes, and it reads
// ONLY proposals a human already approved — it never re-derives a verdict, so
// there is no path where a threshold reaches Meta unattended. Auto-pausing on
// a bad-data day is exactly the failure this shape prevents, and a 16x-ROAS
// campaign is precisely the thing you do not want a threshold pausing.
//
// An approved SWITCH never pauses anything. The challenger has not proven out
// yet, and stopping a profitable campaign to make room for an unproven one is
// the mistake the card itself warns against.
//
// TWO SIGNALS, NOT ONE. A verdict from ad metrics alone can be wrong in the
// direction that costs money: Meta attributes generously, so a campaign can
// look healthy on Meta's own numbers while booked revenue is flat. So a scan
// also reads REAL orders out of `wpw_orders` and raises a DIP proposal off
// booked revenue, independent of anything Meta says. Meta answers "which ad",
// the order table answers "did we actually sell".
//
// IDEMPOTENT BY KEY, NOT BY CLOCK. Every proposal carries a `proposal_key`
// (brand | subject | kind) with no timestamp in it, so re-scanning hourly
// updates the numbers on the open card instead of stacking duplicates of the
// same decision. A decided proposal is never silently reopened by a rescan —
// it is left alone, so an owner's "no" stays no.
//
// Storage is `slack_agent_tasks` (task_type = 'ads_proposal'), the same
// marketing card store Lead Replies and ads_audit already use. It is
// deliberately NOT the shared workflow kernel: that kernel is frozen to its
// implementation owner until the DesignPro workflow passes its
// failure-injection tests (docs/ECOSYSTEM_ORCHESTRATION_NORTH_STAR.md), and
// marketing is an unrelated product area.
//
// POST { action: "scan" | "pace" | "list" | "decide" | "dispatch" | "preview_content", ... }
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TASK_TYPE = "ads_proposal";

// Mirror of the AdsPro panel + marketing-agent ads_audit thresholds. All three
// must agree on what a row's verdict is or the page, the audit and this board
// tell the owner three different stories about the same campaign.
const MIN_SPEND = 50;
const TARGET_ROAS = 2;
const KILL_ROAS = 1;
const FATIGUE_FREQUENCY = 3.5;
const WEAK_CTR = 0.8;

// A day is a DIP when booked revenue falls this far under its baseline.
// Median, not mean: one $11k day would drag a mean up and hide a real slide.
const DIP_RATIO = 0.5;
const DIP_LOOKBACK_DAYS = 28;

// The baseline is SAME-WEEKDAY, not a flat trailing median. Owner, on the live
// numbers: "a Monday at $1900 total is excusable." This business has a real
// weekly shape — Aug 10 (Mon) booked $1,998 and Aug 8 (Sat) $1,050 against
// midweek days of $7k–$11k. A flat median flags both every single week, and a
// board that cries dip every Monday is a board nobody reads. Comparing Monday
// to Mondays only fires when a day is soft FOR THAT DAY.
const MIN_WEEKDAY_SAMPLES = 3;

type Verdict = "REMOVE" | "REPLACE" | "KEEP" | "LEARNING";

interface AdRow {
  campaign: string;
  campaign_id?: string;
  spend: number;
  ctr: number | null;
  frequency: number | null;
  roas: number | null;
  purchases: number;
  purchase_value: number;
  cpa: number | null;
  impressions?: number;
  clicks?: number;
  reach?: number;
}

function db(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

function verdictFor(r: AdRow): { verdict: Verdict; reason: string } {
  if (r.spend < MIN_SPEND) {
    return { verdict: "LEARNING", reason: `Under $${MIN_SPEND} spend — not enough data yet.` };
  }
  if (r.purchases === 0 && r.spend >= MIN_SPEND * 2) {
    return { verdict: "REMOVE", reason: `$${r.spend} spent, zero purchases — pure burn.` };
  }
  if (r.roas !== null && r.roas < KILL_ROAS) {
    return { verdict: "REMOVE", reason: `ROAS ${r.roas} below ${KILL_ROAS} — returns less than it costs.` };
  }
  if (r.frequency !== null && r.frequency >= FATIGUE_FREQUENCY) {
    return {
      verdict: "REPLACE",
      reason: `Frequency ${r.frequency} — the same people have seen this ${Math.round(r.frequency)} times. ` +
        `Creative fatigue, not a message problem.`,
    };
  }
  if (r.ctr !== null && r.ctr < WEAK_CTR) {
    return { verdict: "REPLACE", reason: `CTR ${r.ctr}% — the creative isn't stopping the scroll.` };
  }
  if (r.roas !== null && r.roas < TARGET_ROAS) {
    return { verdict: "REPLACE", reason: `ROAS ${r.roas} below the ${TARGET_ROAS} target — run a challenger.` };
  }
  return { verdict: "KEEP", reason: `Healthy${r.roas !== null ? ` (ROAS ${r.roas})` : ""} — scale before touching.` };
}

// A REPLACE on a PROFITABLE campaign must never read as "switch this off".
// Live case: a 16.68x ROAS retargeting campaign at frequency 11.4 is fatigued
// AND is the best performer in the account. The action there is a challenger
// running alongside — pausing it would be the single most expensive thing the
// board could talk someone into.
function proposalKind(v: Verdict, r: AdRow): "close" | "switch" | null {
  if (v === "REMOVE") return "close";
  if (v === "REPLACE") return "switch";
  return null;
}

function money(n: number) {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function fetchAdsReport(datePreset: string): Promise<
  { brand: string; campaigns: AdRow[] }[]
> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/functions/v1/meta-ads-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key ?? "" },
    body: JSON.stringify({ all_brands: true, date_preset: datePreset, level: "campaign" }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`meta-ads-report: ${data.error || res.status}`);
  return (data.brands ?? [])
    .filter((b: { ok: boolean }) => b.ok)
    .map((b: { brand: string; campaigns: AdRow[] }) => ({ brand: b.brand, campaigns: b.campaigns ?? [] }));
}

// Booked revenue per day from the real order table — NOT Meta's attribution.
// Cancelled/refunded/failed are excluded because a refunded order is not a
// conversion and counting it hides the dip this function exists to find.
async function dailySales(sb: SupabaseClient, days: number) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await sb
    .from("wpw_orders")
    .select("date_created, total, status")
    .gte("date_created", since);
  if (error) throw new Error(`wpw_orders: ${error.message}`);
  const dead = new Set(["cancelled", "refunded", "failed", "trash"]);
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const row of data ?? []) {
    const r = row as { date_created: string; total: number | string | null; status: string | null };
    if (dead.has(String(r.status ?? "").toLowerCase())) continue;
    const day = String(r.date_created).slice(0, 10);
    const cur = byDay.get(day) ?? { orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += Number(r.total ?? 0);
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, orders: v.orders, revenue: +v.revenue.toFixed(2) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The most recent CLOSED day is the one judged. Today is excluded because a
// partial day always looks like a crash until it is over — flagging it would
// cry dip every morning and train the owner to ignore the board.
function weekdayOf(day: string) {
  // Parsed as UTC so the bucket cannot shift by one day depending on where
  // the runtime happens to be.
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function detectDip(daily: { day: string; orders: number; revenue: number }[]) {
  const today = new Date().toISOString().slice(0, 10);
  const closed = daily.filter((d) => d.day !== today);
  if (closed.length < 4) return null;
  const [latest, ...rest] = closed;

  const window = rest.slice(0, DIP_LOOKBACK_DAYS);
  const dow = weekdayOf(latest.day);
  const sameWeekday = window.filter((d) => weekdayOf(d.day) === dow).map((d) => d.revenue);

  // Same-weekday when there is enough history to mean anything; otherwise fall
  // back to the flat median and SAY SO on the card, so a wide baseline is
  // never mistaken for a like-for-like one.
  const useWeekday = sameWeekday.length >= MIN_WEEKDAY_SAMPLES;
  const base = useWeekday ? median(sameWeekday) : median(window.map((d) => d.revenue));
  if (base <= 0) return null;

  const ratio = latest.revenue / base;
  if (ratio >= DIP_RATIO) return null;
  return {
    day: latest.day,
    weekday: WEEKDAY_NAMES[dow],
    revenue: latest.revenue,
    orders: latest.orders,
    baseline: +base.toFixed(2),
    baseline_basis: useWeekday
      ? `median of the last ${sameWeekday.length} ${WEEKDAY_NAMES[dow]}s`
      : `flat ${window.length}-day median (not enough ${WEEKDAY_NAMES[dow]} history yet)`,
    ratio: +ratio.toFixed(2),
    shortfall: +(base - latest.revenue).toFixed(2),
  };
}

// ── INTRADAY PACE (the noon check) ──────────────────────────────────────────
// The end-of-day dip tells you yesterday was bad, which is too late to do
// anything about. Owner: "A 12:00 noon should trigger other AIs to post
// content, send messages to email campaign, SEO, ContentDirector to boost
// sales." So this measures the day WHILE IT CAN STILL BE SAVED.
//
// The comparison has to be same-weekday AND same-hour. Revenue-so-far at noon
// is meaningless against a full day, and meaningless against a different
// weekday — this business books $1.9k on a Monday and $11k midweek. Comparing
// noon-Monday to noon-Mondays is the only version that fires on a genuinely
// soft day instead of firing every single morning.
//
// Timezone is the shop's, not UTC. At noon Phoenix, UTC is already 19:00 and
// "today" in UTC is a different slice of the day — bucketing in UTC would
// compare the wrong hours and, near midnight, the wrong day entirely.
const SHOP_TZ = "America/Phoenix";
const PACE_RATIO = 0.6;

function shopParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// Revenue booked BEFORE `hour` on each day, bucketed in shop time.
async function revenueByDayBeforeHour(sb: SupabaseClient, days: number, hour: number) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await sb
    .from("wpw_orders")
    .select("date_created, total, status")
    .gte("date_created", since);
  if (error) throw new Error(`wpw_orders: ${error.message}`);
  const dead = new Set(["cancelled", "refunded", "failed", "trash"]);
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const row of data ?? []) {
    const r = row as { date_created: string; total: number | string | null; status: string | null };
    if (dead.has(String(r.status ?? "").toLowerCase())) continue;
    const { day, hour: h } = shopParts(new Date(r.date_created));
    if (h >= hour) continue;
    const cur = byDay.get(day) ?? { orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += Number(r.total ?? 0);
    byDay.set(day, cur);
  }
  return byDay;
}

// The systems a soft morning should wake. Each entry is a proposal line the
// owner approves; dispatch is a later step, so approving here does not post
// anything on its own.
const FANOUT = [
  { system: "content_director", label: "ContentDirector", action: "Publish today's highest-intent post to the warm audience" },
  { system: "mightymail", label: "MightyMail / Klaviyo", action: "Send the retarget offer to the warm list (openers, no purchase 30d)" },
  { system: "seo", label: "SEO", action: "Push the highest-converting landing page refresh live" },
  { system: "ads", label: "AdsPro", action: "Hold budget on any campaign already flagged for close" },
];

async function detectPace(sb: SupabaseClient) {
  const now = new Date();
  const { day: today, hour } = shopParts(now);
  // Before mid-morning there is not enough of the day to judge.
  if (hour < 11) return null;

  const buckets = await revenueByDayBeforeHour(sb, 35, hour);
  const todaySoFar = buckets.get(today) ?? { orders: 0, revenue: 0 };
  const dow = weekdayOf(today);

  const peers = [...buckets.entries()]
    .filter(([d]) => d !== today && weekdayOf(d) === dow)
    .map(([, v]) => v.revenue);
  if (peers.length < MIN_WEEKDAY_SAMPLES) return null;

  const base = median(peers);
  if (base <= 0) return null;
  const ratio = todaySoFar.revenue / base;
  if (ratio >= PACE_RATIO) return null;

  return {
    day: today,
    weekday: WEEKDAY_NAMES[dow],
    as_of_hour: hour,
    revenue_so_far: +todaySoFar.revenue.toFixed(2),
    orders_so_far: todaySoFar.orders,
    baseline: +base.toFixed(2),
    baseline_basis: `median of the last ${peers.length} ${WEEKDAY_NAMES[dow]}s at the same hour`,
    ratio: +ratio.toFixed(2),
    shortfall: +(base - todaySoFar.revenue).toFixed(2),
    fanout: FANOUT,
  };
}


// ─── CREATIVE INTELLIGENCE ───────────────────────────────────────────────────
// Which FORMAT is producing orders, read off this account's own ads.
//
// The owner asked for the proposed creative type to be justified by "whats
// really trending" and for the AI to never guess. A model's opinion about what
// is trending on Meta in general is exactly a guess — it cannot see this
// audience, this offer or these numbers. What is not a guess is which format
// in THIS account took money and returned orders, so that is what this ranks.
//
// Format comes from the ad NAME, which this account already encodes reliably
// ("Jess VoiceOver", "New Carousel", "MCC Talking Ad", "Unbox Ad"). A name
// that matches nothing is reported as "unclassified" rather than being forced
// into the nearest bucket — a mislabelled format would quietly recommend the
// wrong thing, and an honest gap is cheaper than a confident error.
const FORMAT_RULES: { format: string; label: string; test: RegExp }[] = [
  { format: "voiceover", label: "Voiceover", test: /voice\s*over|voiceover|11lab/i },
  { format: "talking_head", label: "Talking head", test: /talking|interview|client\s*ad|testimonial/i },
  { format: "carousel", label: "Carousel", test: /carousel/i },
  { format: "unboxing", label: "Unboxing", test: /unbox/i },
  { format: "demo_tool", label: "Tool / demo", test: /quote\s*tool|tool|demo|calculator/i },
  { format: "offer_price", label: "Offer / price", test: /\$|price|pricing|deal|offer|outsource/i },
  { format: "product_static", label: "Product still", test: /wrap$|wall\s*wrap|window|panel|advantage/i },
];

function formatOf(adName: string): { format: string; label: string } {
  for (const r of FORMAT_RULES) if (r.test.test(adName)) return { format: r.format, label: r.label };
  return { format: "unclassified", label: "Unclassified" };
}

interface FormatStat {
  format: string; label: string; ads: number; spend: number; purchases: number;
  revenue: number; roas: number | null; ctr: number | null; cpa: number | null;
}

function rankFormats(rows: (AdRow & { ad?: string })[]): FormatStat[] {
  const by = new Map<string, FormatStat & { impressions: number; clicks: number }>();
  for (const r of rows) {
    const name = String((r as { ad?: string }).ad || r.campaign || "");
    const { format, label } = formatOf(name);
    const cur = by.get(format) ?? {
      format, label, ads: 0, spend: 0, purchases: 0, revenue: 0,
      roas: null, ctr: null, cpa: null, impressions: 0, clicks: 0,
    };
    cur.ads += 1;
    cur.spend += r.spend || 0;
    cur.purchases += r.purchases || 0;
    cur.revenue += r.purchase_value || 0;
    cur.impressions += r.impressions || 0;
    cur.clicks += r.clicks || 0;
    by.set(format, cur);
  }
  return [...by.values()].map((f) => ({
    format: f.format, label: f.label, ads: f.ads,
    spend: +f.spend.toFixed(2), purchases: f.purchases, revenue: +f.revenue.toFixed(2),
    roas: f.spend > 0 ? +(f.revenue / f.spend).toFixed(2) : null,
    ctr: f.impressions > 0 ? +((f.clicks / f.impressions) * 100).toFixed(2) : null,
    cpa: f.purchases > 0 ? +(f.spend / f.purchases).toFixed(2) : null,
  })).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
}

// The recommendation, stated with the evidence that produced it. A format with
// too little spend behind it is called out as thin rather than crowned: one
// $96 ad at 17x is a promising signal, not a proven winner, and presenting it
// as proven is how a good number turns into a bad decision.
const FORMAT_MIN_SPEND = 200;

// Frequency is a WINDOWED metric, so the window has to be on the card. The
// same campaign read 4.78 over 7 days and 11.43 over 30 — a card that omits
// which one it used looks like it contradicts the table above it.
const WINDOW_LABEL: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  last_7d: "the last 7 days",
  last_14d: "the last 14 days",
  last_30d: "the last 30 days",
  last_90d: "the last 90 days",
};

function recommendFormat(stats: FormatStat[]): {
  format: string; label: string; confidence: "proven" | "thin"; why: string;
  runner_up?: string; avoid?: string;
} | null {
  const scored = stats.filter((s) => s.roas !== null && s.purchases > 0);
  if (!scored.length) return null;
  const proven = scored.filter((s) => s.spend >= FORMAT_MIN_SPEND);
  const pool = proven.length ? proven : scored;
  const top = pool[0];
  const runner = pool[1];
  const worst = [...scored].sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0))[0];
  return {
    format: top.format,
    label: top.label,
    confidence: proven.length ? "proven" : "thin",
    why:
      `${top.label} returned ${top.roas}x on ${money(top.spend)} across ${top.ads} ad${top.ads === 1 ? "" : "s"}, ` +
      `${top.purchases} purchases at ${money(top.cpa ?? 0)} each` +
      (top.ctr !== null ? `, CTR ${top.ctr}%` : "") + ". " +
      (proven.length
        ? `Ranked only against formats with at least ${money(FORMAT_MIN_SPEND)} behind them.`
        : `No format has ${money(FORMAT_MIN_SPEND)} behind it yet, so this is a signal, not a proven winner.`),
    runner_up: runner ? `${runner.label} (${runner.roas}x on ${money(runner.spend)})` : undefined,
    avoid: worst && worst.format !== top.format
      ? `${worst.label} is the weakest at ${worst.roas}x${worst.ctr !== null ? ` and CTR ${worst.ctr}%` : ""}`
      : undefined,
  };
}


// ─── WHAT IS WORKING OUTSIDE THIS ACCOUNT ────────────────────────────────────
// Owner: "It must use google grounding ... get latest info on what creatives
// are working for meta and google."
//
// Two DIFFERENT questions, and the board keeps them apart on purpose:
//   - `rankFormats` answers "what worked HERE", from this account's orders.
//     That is evidence.
//   - this answers "what is working generally, right now", from Google Search
//     grounding. That is context, and it is only worth showing WITH ITS
//     SOURCES — an unsourced trend claim is the model's memory of the internet,
//     which is exactly the guess the owner ruled out.
//
// So a result with no citations is DISCARDED rather than shown. A confident
// paragraph about Meta creative trends with nothing behind it is worse than an
// empty panel, because it looks like research.
async function marketCreativeTrends(): Promise<
  { summary: string; formats: string[]; sources: { title: string; uri: string }[]; model: string } | null
> {
  const key = Deno.env.get("GOOGLE_AI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY_2");
  if (!key) return null;
  const prompt =
    "Using Google Search, report what AD CREATIVE FORMATS are performing best RIGHT NOW on Meta " +
    "(Facebook/Instagram) and Google for small-business ecommerce and B2B suppliers. " +
    "Name specific formats (for example: UGC talking-head, carousel, us-vs-them comparison, " +
    "grid/collage, short-form reel opening on a question, static offer). " +
    "Be concrete and current. 120 words maximum. Do not speculate — only state what your sources support.";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cand = data?.candidates?.[0];
    const summary = (cand?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "").join(" ").trim();
    // Citations are the whole point. No grounding metadata means the model
    // answered from memory, and that is not what was asked for.
    const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c: { web?: { title?: string; uri?: string } }) => ({
        title: String(c?.web?.title ?? "").slice(0, 120),
        uri: String(c?.web?.uri ?? ""),
      }))
      .filter((x: { uri: string }) => x.uri)
      .slice(0, 6);
    if (!summary || !sources.length) return null;
    const formats = FORMAT_RULES.filter((r) => r.test.test(summary)).map((r) => r.label);
    return { summary, formats, sources, model: "gemini-2.5-flash + google_search" };
  } catch {
    return null;
  }
}

// Upsert by proposal_key. A decided proposal is left untouched: a rescan must
// never resurrect something the owner already answered.
async function upsertProposal(
  sb: SupabaseClient,
  p: {
    brand: string;
    proposal_key: string;
    kind: "close" | "switch" | "contingency";
    title: string;
    description: string;
    priority: string;
    metadata: Record<string, unknown>;
  },
) {
  const { data: existing } = await sb
    .from("slack_agent_tasks")
    // metadata is REQUIRED here, not incidental: the executed-vs-queued
    // decision below reads execution.state off it. Selecting only id+status
    // made every decided proposal look un-executed, so none ever recurred and
    // the board stayed empty once everything on it had been actioned.
    .select("id, status, metadata")
    .eq("task_type", TASK_TYPE)
    .eq("metadata->>proposal_key", p.proposal_key)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Note: newest row wins. An executed proposal from a previous cycle is
  // therefore visible here and handled below, rather than hidden by an older
  // pending one.

  // A REJECTION stays rejected — the owner's "no" must not be re-asked every
  // sweep. But an APPROVED-and-EXECUTED proposal is different: the work ran,
  // and if the campaign is still fatigued days later that is a NEW decision,
  // not the old one reopening. Blocking both left the board empty the moment
  // everything on it had been actioned, which reads as "nothing to do" when
  // the underlying problem is unchanged.
  if (existing && existing.status === "rejected") {
    return { id: existing.id, state: "rejected_standing" as const };
  }
  // An executed proposal is SUPERSEDED, never edited back into a pending
  // state: the decided row is the record that the owner approved something
  // and it ran. The new cycle gets its own row pointing back at it.
  let supersedes: string | null = null;
  if (existing && existing.status !== "pending_review") {
    const ex = (existing.metadata as Record<string, unknown> | null)?.execution as
      | Record<string, unknown> | undefined;
    // Still queued means the previous decision has not been carried out yet —
    // raising a second card for the same work would double-dispatch it.
    if (!ex || ex.state === "queued") {
      return { id: existing.id, state: "already_decided" as const };
    }
    supersedes = existing.id;
  }
  if (existing && !supersedes) {
    // A REFRESH MUST NOT DESTROY WHAT IT DID NOT REGENERATE. Content is
    // budgeted (`max_content`), so most sweeps carry no pack — and a plain
    // metadata replace then nulled `proposed_content` on a card the owner was
    // about to approve. Observed live: a scan run to backfill the incumbent
    // thumbnails silently erased both challengers, hub card and all, and the
    // pack it deleted had cost a generation to make.
    const prev = (existing.metadata as Record<string, unknown> | null) ?? {};
    const keepIfAbsent = (key: string) =>
      (p.metadata as Record<string, unknown>)[key] == null && prev[key] != null
        ? { [key]: prev[key] }
        : {};
    await sb.from("slack_agent_tasks").update({
      title: p.title,
      description: p.description,
      priority: p.priority,
      metadata: {
        ...p.metadata,
        ...keepIfAbsent("proposed_content"),
        ...keepIfAbsent("creative_reasoning"),
        proposal_key: p.proposal_key,
        kind: p.kind,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return { id: existing.id, state: "refreshed" as const };
  }
  const { data, error } = await sb.from("slack_agent_tasks").insert({
    brand: p.brand,
    task_type: TASK_TYPE,
    category: "marketing",
    status: "pending_review",
    priority: p.priority,
    assigned_to: "trish",
    title: p.title,
    description: p.description,
    created_by: "ads-proposals",
    metadata: {
      ...p.metadata,
      proposal_key: p.proposal_key,
      kind: p.kind,
      ...(supersedes ? { supersedes } : {}),
    },
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, state: (supersedes ? "recurred" : "created") as "recurred" | "created" };
}

// The replacement copy the owner sees BEFORE approving. Generated by the
// existing ad_pack flow, which already grounds every line against declared
// brand facts and real customer quotes and drops invented figures. Capped and
// best-effort: a proposal with no content is still a useful proposal, and a
// content failure must not cost the owner the verdict.
// The owner reads the copy and looks at the creative BEFORE approving —
// approving a brief you cannot see is just approving a promise.
//
// Two things this has to get right that are not obvious:
//
//  1. ad_pack RETURNS the media url but NOT the copy. Headlines, primary
//     texts, descriptions and CTAs are written into the Hub card's
//     metadata.ad_copy and never make it into the response. Reading them back
//     off that card is the only way the proposal can show words; without it
//     the card renders a video thumbnail and nothing to read.
//  2. ad_pack fences spend on (brand, placement, goal) with NO clock, so two
//     campaigns of the same brand asking for "feed" get the SAME pack back —
//     both challengers would show identical copy. Passing a per-campaign goal
//     makes them distinct packs, which is the whole point of a per-campaign
//     challenger.
async function proposeContent(
  brand: string,
  campaign: string,
  chosen?: { label: string; why: string; market?: string },
): Promise<Record<string, unknown> | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const res = await fetch(`${url}/functions/v1/marketing-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key ?? "" },
      body: JSON.stringify({
        action: "ad_pack",
        brand,
        placement: "feed",
        // The FORMAT is decided from this account's own results before the
        // generator is asked for anything, so the pack is built as the type
        // the orders point at rather than whatever the model reaches for.
        goal: chosen
          ? `Challenger creative for "${campaign}" — build it as a ${chosen.label}. ` +
            `${chosen.why} Beat the incumbent on the same offer.`
          : `Challenger creative for "${campaign}" — beat the incumbent on the same offer`,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) return null;

    // Pull the written copy off the Hub card ad_pack just created (or the one
    // its spend fence pointed at, when a pack for this exact work already
    // existed).
    let copy: Record<string, unknown> | null = null;
    let mediaUrl = (data.creative as string) ?? null;
    const cardId = (data.hub_card_id as string) ?? null;
    if (cardId) {
      const sb = db();
      const { data: card } = await sb
        .from("slack_agent_tasks")
        .select("metadata")
        .eq("id", cardId)
        .maybeSingle();
      const md = (card?.metadata as Record<string, unknown>) ?? {};
      copy = (md.ad_copy as Record<string, unknown>) ?? null;
      mediaUrl = mediaUrl ?? ((md.media_url as string) ?? null);
    }

    return {
      hub_card_id: cardId,
      // Why this TYPE, carried onto the card so the human approving sees the
      // reasoning next to the thumbnail rather than having to trust it.
      chosen_format: chosen?.label ?? null,
      format_reason: chosen?.why ?? null,
      market_context: chosen?.market ?? null,
      creative: mediaUrl,
      headlines: (copy?.headlines as string[]) ?? [],
      primary_texts: (copy?.primary_texts as string[]) ?? [],
      descriptions: (copy?.descriptions as string[]) ?? [],
      ctas: (copy?.ctas as string[]) ?? [],
      hook: { channel: data.hook_channel ?? null, move: data.hook_move ?? null, edge: data.hook_edge ?? null },
      // Grounding drops any line that invented a figure or a guarantee.
      // Surfacing the count keeps a thin pack honest rather than looking
      // like the model simply had less to say.
      dropped_claims: data.dropped_claims ?? 0,
      gaps: data.gaps ?? [],
      reused_creative: data.creative_reused ?? false,
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const action = String(body.action || "list");

  try {
    const sb = db();

    // ── LIST ────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { data, error } = await sb
        .from("slack_agent_tasks")
        .select("id, brand, title, description, priority, status, metadata, created_at, updated_at")
        .eq("task_type", TASK_TYPE)
        .order("created_at", { ascending: false })
        .limit(Number(body.limit ?? 50));
      if (error) return json({ ok: false, error: error.message }, 500);
      const rows = data ?? [];
      // A decided row that links nowhere is unauditable: it says work was
      // approved without showing what the approval produced. Attach the work
      // orders each one filed so the board can link straight to them.
      const { data: children } = await sb
        .from("slack_agent_tasks")
        .select("id, title, status, metadata, created_at")
        .eq("task_type", "ads_contingency")
        .order("created_at", { ascending: false })
        .limit(100);
      const byParent = new Map<string, Record<string, unknown>[]>();
      for (const c of children ?? []) {
        const parent = String((c.metadata as Record<string, unknown>)?.parent_proposal ?? "");
        if (!parent) continue;
        const list = byParent.get(parent) ?? [];
        list.push({
          id: c.id,
          title: c.title,
          status: c.status,
          system: (c.metadata as Record<string, unknown>)?.system ?? null,
        });
        byParent.set(parent, list);
      }
      const withWork = (r: Record<string, unknown>) => ({
        ...r,
        work_orders: byParent.get(String(r.id)) ?? [],
      });
      return json({
        ok: true,
        pending: rows.filter((r) => r.status === "pending_review").map(withWork),
        decided: rows.filter((r) => r.status !== "pending_review").map(withWork),
      });
    }

    // ── SCAN ────────────────────────────────────────────────────────────────
    if (action === "scan") {
      const datePreset = String(body.date_preset || "last_30d");
      const withContent = body.with_content !== false;
      const maxContent = Number(body.max_content ?? 6);

      const [brands, daily] = await Promise.all([
        fetchAdsReport(datePreset),
        dailySales(sb, 30),
      ]);

      // DECIDE THE TYPE BEFORE GENERATING ANYTHING. Ad-level rows rank the
      // formats this account's orders actually came from; the grounded search
      // adds outside context. The generator is then told which type to build,
      // so "propose a creative" is a decision with evidence rather than a
      // model preference.
      const adRows = await (async () => {
        const u = Deno.env.get("SUPABASE_URL");
        const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        try {
          const r = await fetch(`${u}/functions/v1/meta-ads-report`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}`, apikey: k ?? "" },
            body: JSON.stringify({ all_brands: true, date_preset: datePreset, level: "ad" }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) return [] as (AdRow & { ad?: string })[];
          return (j.brands ?? []).filter((b: { ok: boolean }) => b.ok)
            .flatMap((b: { campaigns: (AdRow & { ad?: string })[] }) => b.campaigns ?? []);
        } catch { return [] as (AdRow & { ad?: string })[]; }
      })();
      const formatStats = rankFormats(adRows);
      const recommendation = recommendFormat(formatStats);
      const market = body.with_market === false ? null : await marketCreativeTrends();
      const chosen = recommendation
        ? {
            label: recommendation.label,
            why: recommendation.why,
            market: market?.summary,
          }
        : undefined;

      // WHAT IS RUNNING NOW, per campaign. A switch card that shows only the
      // challenger asks the owner to approve a replacement without seeing what
      // is being replaced. The ad-level rows are already fetched above and
      // carry the live creative thumbnail, so pairing them costs nothing.
      const liveByCampaign = new Map<string, Record<string, unknown>[]>();
      for (const r of adRows as (AdRow & { ad?: string; thumbnail?: string; image?: string; status?: string })[]) {
        const key = String(r.campaign ?? "");
        if (!key) continue;
        const list = liveByCampaign.get(key) ?? [];
        // Each ad carries its OWN verdict, by the same rules the campaign is
        // judged by. This is what makes the card segmentable — and it is the
        // check that stops a campaign being replaced for an aggregate none of
        // its ads has.
        const av = verdictFor(r);
        list.push({
          ad: r.ad ?? r.campaign,
          format: formatOf(String(r.ad ?? r.campaign)).label,
          thumbnail: r.thumbnail ?? r.image ?? null,
          spend: r.spend, roas: r.roas, ctr: r.ctr, frequency: r.frequency,
          purchases: r.purchases, cpa: r.cpa,
          status: r.status ?? null,
          verdict: av.verdict, verdict_reason: av.reason,
        });
        liveByCampaign.set(key, list);
      }
      const adsOf = (campaign: string) =>
        (liveByCampaign.get(campaign) ?? [])
          .slice()
          .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
      const currentCreativesFor = (campaign: string) => adsOf(campaign).slice(0, 6);

      const created: Record<string, unknown>[] = [];
      // Campaigns the aggregate flagged and the ads did not. Reported rather
      // than dropped — a silent suppression is indistinguishable from a scan
      // that never looked.
      const skipped: { brand: string; campaign: string; why: string }[] = [];
      let contentBudget = maxContent;

      for (const b of brands) {
        for (const c of b.campaigns) {
          const { verdict, reason: campaignReason } = verdictFor(c);
          const kind = proposalKind(verdict, c);
          if (!kind) continue;

          // THE CAMPAIGN AGGREGATE IS NOT A CREATIVE. Flagged by a partner
          // reading the board, and he was right: WINNERS ASC showed campaign
          // frequency 5.58 — over the 3.5 fatigue line — while its five ads
          // sat at 1.37, 2.46, 2.79, 3.09 and 4.13. An ASC serves several
          // creatives to one heavily-overlapping audience, so the campaign
          // number counts impressions no single creative delivered. Judging
          // it there proposes replacing five ads because of an artifact of
          // adding them up, and the same page contradicted itself: the ad
          // table showed KEEP on the very ads the board wanted switched.
          //
          // A switch is now backed by NAMED ADS or it is not raised.
          const campaignAds = adsOf(c.campaign);
          // A PAUSED AD IS ALREADY DEALT WITH. Its 30-day numbers still carry
          // the fatigue that got it turned off, so without this the board
          // asks the owner to replace an ad they retired an hour ago — and
          // keeps asking for as long as the window remembers it.
          const badAds = campaignAds.filter(
            (a) =>
              (a.verdict === "REPLACE" || a.verdict === "REMOVE") &&
              String(a.status ?? "ACTIVE").toUpperCase() === "ACTIVE",
          );
          if (kind === "switch" && campaignAds.length > 0 && badAds.length === 0) {
            skipped.push({
              brand: b.brand, campaign: c.campaign,
              why: `campaign frequency ${c.frequency} is over the line but no individual ad is — ` +
                `aggregate across ${campaignAds.length} creatives, not fatigue`,
            });
            continue;
          }

          // The reason now names WHICH ads, so the card is actionable instead
          // of pointing at a whole campaign.
          const reason = badAds.length
            ? `${badAds.length} of ${campaignAds.length} ads need replacing: ` +
              badAds.map((a) => `"${a.ad}" (${a.verdict_reason})`).join(" · ")
            : campaignReason;

          // Profitable-but-fatigued is the common case and the one most
          // likely to be misread. Say it on the card, not in a doc.
          const profitable = (c.roas ?? 0) >= TARGET_ROAS;
          const guard = kind === "switch" && profitable
            ? `\n\nDO NOT PAUSE THIS YET — it is returning ${c.roas}x. Run the challenger alongside it and ` +
              `only retire the original once the new creative proves out.`
            : "";

          // A SWITCH needs a forward action or approving it does nothing. It
          // must not pause the original, so its dispatch target is the
          // challenger build — not Meta. Without this the proposal approved
          // fine, dispatched to "meta", got skipped for being a switch, and
          // filed no work anywhere: an approval that looked done and wasn't.
          const fanout = kind === "switch"
            ? [{
                system: "content_director",
                label: "ContentDirector",
                action:
                  `Build the challenger for "${c.campaign}"` +
                  (recommendation ? ` as a ${recommendation.label}` : "") +
                  ` — new hook and new opening visual, same offer unless the numbers say the offer is the ` +
                  `problem. Run it alongside; retire the original only once the challenger proves out.` +
                  (recommendation ? ` WHY THIS TYPE: ${recommendation.why}` : ""),
              }]
            : undefined;

          let content: Record<string, unknown> | null = null;
          if (withContent && kind === "switch" && contentBudget > 0) {
            content = await proposeContent(b.brand, c.campaign, chosen);
            if (content) contentBudget -= 1;
          }

          const res = await upsertProposal(sb, {
            brand: b.brand,
            proposal_key: `${b.brand}|${c.campaign}|${kind}`,
            kind,
            priority: kind === "close" ? "high" : "medium",
            // The title names the AD when one ad is the problem. "Switch
            // creative: WINNERS ASC" reads as replace-the-campaign; it never
            // was.
            title: (kind === "close"
              ? `Close: ${c.campaign}`
              : badAds.length === 1
                ? `Switch "${badAds[0].ad}" — ${c.campaign}`
                : badAds.length > 1
                  ? `Switch ${badAds.length} ads in ${c.campaign}`
                  : `Switch creative: ${c.campaign}`).slice(0, 160),
            description:
              `${reason}\n\nCampaign over ${WINDOW_LABEL[datePreset] ?? datePreset}: ` +
              `${money(c.spend)} spend · ${c.purchases} purchases · ROAS ${c.roas ?? "n/a"} · ` +
              `CTR ${c.ctr ?? "n/a"}% · frequency ${c.frequency ?? "n/a"} · CPA ${c.cpa ?? "n/a"}` +
              `\n\nCampaign frequency counts every creative served to one audience — read the ` +
              `per-ad numbers below, not this one, when deciding what to replace.${guard}`,
            metadata: {
              source: "ads-proposals",
              verdict, reason, campaign: c.campaign, range: datePreset,
              // Which ads drove it, by name — the card's own evidence.
              flagged_ads: badAds.map((a) => a.ad),
              ad_count: campaignAds.length,
              profitable,
              // campaign_id is the handle the pause acts on. Captured at scan
              // time so dispatch never has to resolve a name back to an object.
              campaign_id: c.campaign_id ?? null,
              metrics: {
                campaign_id: c.campaign_id ?? null,
                spend: c.spend, purchases: c.purchases, purchase_value: c.purchase_value,
                roas: c.roas, ctr: c.ctr, frequency: c.frequency, cpa: c.cpa,
              },
              proposed_content: content,
              // The incumbent(s) this proposal would replace, with the live
              // creative image, so the card is a comparison and not an ask.
              current_creatives: currentCreativesFor(c.campaign),
              // The explainer the approval card renders.
              creative_reasoning: recommendation
                ? {
                    format: recommendation.label,
                    confidence: recommendation.confidence,
                    why: recommendation.why,
                    runner_up: recommendation.runner_up ?? null,
                    avoid: recommendation.avoid ?? null,
                    market: market ? { summary: market.summary, sources: market.sources } : null,
                  }
                : null,
              ...(fanout ? { fanout } : {}),
            },
          });
          created.push({ brand: b.brand, campaign: c.campaign, kind, ...res });
        }
      }

      // ── DIP CONTINGENCY (booked revenue, not Meta attribution) ────────────
      const dip = detectDip(daily);
      if (dip) {
        const res = await upsertProposal(sb, {
          brand: "weprintwraps",
          proposal_key: `sales|dip|${dip.day}`,
          kind: "contingency",
          priority: "high",
          title: `Sales dip ${dip.weekday} ${dip.day} — ${money(dip.revenue)} vs ${money(dip.baseline)} typical`,
          description:
            `Booked revenue on ${dip.weekday} ${dip.day} was ${money(dip.revenue)} across ${dip.orders} ` +
            `orders — ${Math.round((1 - dip.ratio) * 100)}% under ${money(dip.baseline)}, the ` +
            `${dip.baseline_basis}. Shortfall ${money(dip.shortfall)}.\n\n` +
            `Compared ${dip.weekday} against ${dip.weekday}s, not against the week as a whole — a quiet ` +
            `Monday or Saturday is normal here and does not raise a card.\n\n` +
            `This is REAL booked revenue from the order table, not Meta's attributed number, so it is ` +
            `independent of anything the ad platform reports.\n\n` +
            `CONTINGENCY: approve to file the retargeting counterpart — a Klaviyo/MightyMail send to the ` +
            `warm list, and a budget hold on any campaign already flagged for close so spend is not ` +
            `chasing a soft day.`,
          metadata: { source: "ads-proposals", dip, daily: daily.slice(0, DIP_LOOKBACK_DAYS) },
        });
        created.push({ kind: "contingency", day: dip.day, ...res });
      }

      return json({
        ok: true,
        scanned: brands.map((b) => b.brand),
        proposals: created,
        skipped,
        dip: dip ?? null,
        daily: daily.slice(0, DIP_LOOKBACK_DAYS),
      });
    }

    // ── DECIDE ──────────────────────────────────────────────────────────────
    // Records the owner's answer. Deliberately does NOT call Meta: the
    // write-back reads approved proposals in a later step, so an approval is
    // reversible right up until something is actually executed.
    if (action === "decide") {
      const id = String(body.id || "");
      const decision = String(body.decision || "");
      const allowed = ["approve_switch", "approve_close", "reject"];
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!allowed.includes(decision)) {
        return json({ ok: false, error: `decision must be one of ${allowed.join(", ")}` }, 400);
      }
      const { data: row, error: readErr } = await sb
        .from("slack_agent_tasks")
        .select("id, status, metadata")
        .eq("id", id).eq("task_type", TASK_TYPE).maybeSingle();
      if (readErr || !row) return json({ ok: false, error: "proposal not found" }, 404);
      if (row.status !== "pending_review") {
        return json({ ok: false, error: `already ${row.status}`, status: row.status }, 409);
      }

      const status = decision === "reject" ? "rejected" : decision;
      const { error } = await sb.from("slack_agent_tasks").update({
        status,
        metadata: {
          ...(row.metadata as Record<string, unknown> ?? {}),
          decision,
          decided_at: new Date().toISOString(),
          decided_by: String(body.decided_by || "owner"),
          // Read by the Meta write-back step. Approving records INTENT; the
          // execution is separate so nothing has hit Meta at this point.
          // One queued entry per target. A contingency fans out to several
          // systems, so a single "target" field would silently drop all but
          // one of them and the dispatcher would under-deliver the rescue.
          execution: decision === "reject" ? null : {
            state: "queued",
            executed_at: null,
            targets: (() => {
              const md = (row.metadata as Record<string, unknown>) ?? {};
              const fan = md.fanout as { system: string }[] | undefined;
              if (Array.isArray(fan) && fan.length) return fan.map((f) => f.system);
              return ["meta"];
            })(),
          },
        },
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, id, status, executed: false });
    }

    // ── PACE (the noon check) ───────────────────────────────────────────────
    // Run on a schedule around midday shop time. Raises ONE high-priority
    // proposal carrying the cross-system fan-out, so a soft morning is
    // answered the same day instead of showing up in tomorrow's dip card.
    if (action === "pace") {
      const pace = await detectPace(sb);
      if (!pace) {
        return json({ ok: true, on_pace: true, proposal: null });
      }
      const lines = pace.fanout.map((f) => `• ${f.label} — ${f.action}`).join("\n");
      const res = await upsertProposal(sb, {
        brand: "weprintwraps",
        // Keyed to the DAY, not the minute: running the check twice before
        // the owner answers updates the same card.
        proposal_key: `sales|pace|${pace.day}`,
        kind: "contingency",
        priority: "high",
        title:
          `Behind pace ${pace.weekday} — ${money(pace.revenue_so_far)} by ${pace.as_of_hour}:00 ` +
          `vs ${money(pace.baseline)} typical`,
        description:
          `${money(pace.revenue_so_far)} booked across ${pace.orders_so_far} orders by ` +
          `${pace.as_of_hour}:00 ${SHOP_TZ.split("/")[1].replace("_", " ")} — ` +
          `${Math.round((1 - pace.ratio) * 100)}% under ${money(pace.baseline)}, the ` +
          `${pace.baseline_basis}. Shortfall so far ${money(pace.shortfall)}.\n\n` +
          `Same weekday AND same hour, so a normally quiet ${pace.weekday} does not raise this.\n\n` +
          `APPROVE TO DISPATCH:\n${lines}\n\n` +
          `Nothing posts, sends or changes until you approve. Approving queues each system; ` +
          `rejecting closes the day's card.`,
        metadata: { source: "ads-proposals", pace, fanout: pace.fanout },
      });
      return json({ ok: true, on_pace: false, pace, proposal: res });
    }

    // ── OVERVIEW ────────────────────────────────────────────────────────────
    // One call behind the AdsPro command strip: the paid funnel, the REAL
    // sales it produced, today's pace, and which systems are actually wired.
    //
    // Ad spend and booked revenue come from different systems on purpose and
    // are shown side by side rather than reconciled. Meta's attributed revenue
    // and the order table disagree — Meta counts a sale if its ad was seen
    // inside the attribution window, so on retargeting it claims purchases
    // that were going to happen anyway. Averaging them or picking one would
    // hide the single most useful number on the page: the gap between what the
    // platform claims and what was actually banked.
    //
    // Every wiring light is derived from a real call or a real row. A status
    // dot that is green because a constant says so is worse than no dot.
    if (action === "overview") {
      const datePreset = String(body.date_preset || "last_30d");
      const [brands, daily] = await Promise.all([
        fetchAdsReport(datePreset).catch(() => [] as { brand: string; campaigns: AdRow[] }[]),
        dailySales(sb, 35).catch(() => [] as { day: string; orders: number; revenue: number }[]),
      ]);

      const campaigns = brands.flatMap((b) => b.campaigns.map((c) => ({ ...c, brand: b.brand })));
      const paid = campaigns.reduce(
        (t, c) => ({
          spend: t.spend + (c.spend || 0),
          impressions: t.impressions + (c.impressions || 0),
          clicks: t.clicks + (c.clicks || 0),
          purchases: t.purchases + (c.purchases || 0),
          attributed_revenue: t.attributed_revenue + (c.purchase_value || 0),
        }),
        { spend: 0, impressions: 0, clicks: 0, purchases: 0, attributed_revenue: 0 },
      );

      const today = shopParts(new Date()).day;
      const inWindow = (days: number) => {
        const cut = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
        return daily.filter((d) => d.day >= cut);
      };
      const sum = (rows: { orders: number; revenue: number }[]) =>
        rows.reduce((t, r) => ({ orders: t.orders + r.orders, revenue: +(t.revenue + r.revenue).toFixed(2) }),
          { orders: 0, revenue: 0 });

      const booked30 = sum(inWindow(30));
      // Short windows matter more than the month for a day-to-day operator:
      // a 30-day total hides a week that fell off a cliff.
      const booked7 = sum(inWindow(7));
      const booked5 = sum(inWindow(5));
      const bookedYesterday = (() => {
        const y = daily.filter((d) => d.day < today).slice(0, 1);
        return sum(y);
      })();
      const bookedToday = sum(daily.filter((d) => d.day === today));
      const verdicts = campaigns.map((c) => verdictFor(c).verdict);
      const count = (v: Verdict) => verdicts.filter((x) => x === v).length;

      const { data: openProposals } = await sb
        .from("slack_agent_tasks")
        .select("id, status")
        .eq("task_type", TASK_TYPE)
        .eq("status", "pending_review");
      const { data: workOrders } = await sb
        .from("slack_agent_tasks")
        .select("id, metadata")
        .eq("task_type", "ads_contingency")
        .eq("status", "pending");

      const pace = await detectPace(sb).catch(() => null);

      // Format intelligence needs AD-level rows; the funnel above is campaign
      // level, so this is a second, narrower read rather than a reuse.
      const adRows = await (async () => {
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        try {
          const r = await fetch(`${url}/functions/v1/meta-ads-report`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key ?? "" },
            body: JSON.stringify({ all_brands: true, date_preset: datePreset, level: "ad" }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) return [] as (AdRow & { ad?: string })[];
          return (j.brands ?? []).filter((b: { ok: boolean }) => b.ok)
            .flatMap((b: { campaigns: (AdRow & { ad?: string })[] }) => b.campaigns ?? []);
        } catch { return [] as (AdRow & { ad?: string })[]; }
      })();

      const formats = rankFormats(adRows);
      const market = body.with_market === false ? null : await marketCreativeTrends();

      return json({
        ok: true,
        range: datePreset,
        // ── THE PAID FUNNEL ──
        funnel: {
          spend: +paid.spend.toFixed(2),
          impressions: paid.impressions,
          clicks: paid.clicks,
          ctr: paid.impressions ? +((paid.clicks / paid.impressions) * 100).toFixed(2) : null,
          attributed_purchases: paid.purchases,
          attributed_revenue: +paid.attributed_revenue.toFixed(2),
          attributed_roas: paid.spend > 0 ? +(paid.attributed_revenue / paid.spend).toFixed(2) : null,
        },
        // ── WHAT WAS ACTUALLY BANKED ──
        booked: {
          today: bookedToday,
          yesterday: bookedYesterday,
          last_5d: booked5,
          last_7d: booked7,
          last_30d: booked30,
          // BLENDED, and named that way on purpose. This is TOTAL booked
          // revenue over ad spend — organic, repeat and phone orders included.
          // It is not what the ads produced and must never be labelled "true
          // ROAS": dividing the whole business by the ad bill credits paid
          // with revenue it never touched, and that is the first number a
          // sharp reader pulls apart.
          blended_roas_all_revenue: paid.spend > 0 ? +(booked30.revenue / paid.spend).toFixed(2) : null,
          // The useful comparison is not a dollar "gap" — booked revenue
          // exceeding Meta's claim is normal for any business with non-ad
          // sales, and reads as under-claiming when it is nothing of the kind.
          // What matters is how much of the business Meta takes credit for.
          attributed_share_of_booked: booked30.revenue > 0
            ? +((paid.attributed_revenue / booked30.revenue) * 100).toFixed(1)
            : null,
        },
        pace,
        daily: daily.slice(0, 14),
        // PAST creatives, so a proposed one can be judged against what ran.
        past_creatives: adRows
          .map((r) => ({
            ad: (r as { ad?: string }).ad ?? r.campaign,
            format: formatOf(String((r as { ad?: string }).ad ?? r.campaign)).label,
            spend: r.spend, purchases: r.purchases, roas: r.roas, ctr: r.ctr,
            frequency: r.frequency, cpa: r.cpa,
            thumbnail: (r as { thumbnail?: string }).thumbnail ?? null,
            status: (r as { status?: string }).status ?? null,
          }))
          .sort((a, b) => (b.spend || 0) - (a.spend || 0))
          .slice(0, 12),
        creative_intel: {
          formats,
          recommend: recommendFormat(formats),
          market,
        },
        verdicts: { keep: count("KEEP"), replace: count("REPLACE"), remove: count("REMOVE"), learning: count("LEARNING") },
        queue: {
          open_proposals: (openProposals ?? []).length,
          work_orders: (workOrders ?? []).length,
        },
        // ── WIRING, each proven by the call that just ran ──
        systems: [
          { key: "meta", label: "Meta Ads", live: brands.length > 0,
            detail: brands.length ? `${brands.length} brand${brands.length === 1 ? "" : "s"} reporting` : "no brand returned data" },
          { key: "orders", label: "Live Sales", live: daily.length > 0,
            detail: daily.length ? `${daily.length} days of booked orders` : "no orders read" },
          { key: "proposals", label: "AdsPro Proposals", live: true,
            detail: `${(openProposals ?? []).length} awaiting approval` },
          { key: "content_director", label: "ContentDirector", live: (workOrders ?? []).some((w) => (w.metadata as Record<string, unknown>)?.system === "content_director"),
            detail: "challenger builds + posts" },
          { key: "mightymail", label: "MightyMail / Klaviyo", live: (workOrders ?? []).some((w) => (w.metadata as Record<string, unknown>)?.system === "mightymail"),
            detail: "retarget sends" },
          { key: "seo", label: "SEO", live: (workOrders ?? []).some((w) => (w.metadata as Record<string, unknown>)?.system === "seo"),
            detail: "landing page pushes" },
        ],
      });
    }

    // ── PREVIEW CONTENT ─────────────────────────────────────────────────────
    // Generate (or fetch, via ad_pack's spend fence) the challenger pack for
    // one campaign and return it, without creating or touching a proposal.
    //
    // Exists because a decided proposal never reopens — correct, an owner's
    // answer should stay answered — but that leaves no way to look at the
    // creative for a campaign already approved. It also gives the board a
    // "show me again" that costs nothing when a pack already exists, since
    // ad_pack's fence returns the existing one rather than re-buying copy.
    //
    // Routed through here rather than called directly because marketing-agent
    // requires the service key or an admin JWT, and this function already
    // holds the service key.
    if (action === "preview_content") {
      const brand = String(body.brand || "weprintwraps");
      const campaign = String(body.campaign || "").trim();
      if (!campaign) return json({ ok: false, error: "campaign required" }, 400);
      const content = await proposeContent(brand, campaign);
      if (!content) {
        // proposeContent returns null on ANY failure, which is right for a
        // scan (a missing pack must not cost the verdict) and useless here.
        // Repeat the call raw so the caller sees what ad_pack actually said
        // instead of "returned nothing" — that message sent the last debug
        // session looking at logs it had no access to.
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        let upstream: unknown = null;
        let status = 0;
        try {
          const r = await fetch(`${url}/functions/v1/marketing-agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key ?? "" },
            body: JSON.stringify({
              action: "ad_pack", brand, placement: "feed",
              goal: `Challenger creative for "${campaign}" — beat the incumbent on the same offer`,
            }),
          });
          status = r.status;
          upstream = await r.json().catch(() => null);
        } catch (e) {
          upstream = { fetch_error: e instanceof Error ? e.message : String(e) };
        }
        return json({ ok: false, error: "ad_pack did not return a pack", upstream_status: status, upstream }, 502);
      }
      return json({ ok: true, brand, campaign, content });
    }

    // ── DISPATCH ────────────────────────────────────────────────────────────
    // Carries out approvals, and ONLY approvals. It reads proposals the owner
    // already answered with an approve_* decision whose execution is still
    // `queued`. It never re-derives a verdict, so there is no path where a
    // threshold reaches Meta without a human in between.
    //
    // Per-target results are recorded individually. A Klaviyo failure must not
    // roll back an already-executed Meta pause, and a partially executed
    // rescue must be visible as partial rather than reported as done.
    if (action === "dispatch") {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const only = body.id ? String(body.id) : null;

      let q = sb.from("slack_agent_tasks")
        .select("id, brand, title, status, metadata")
        .eq("task_type", TASK_TYPE)
        .in("status", ["approve_close", "approve_switch"])
        .eq("metadata->execution->>state", "queued");
      if (only) q = q.eq("id", only);
      const { data: queued, error } = await q.limit(25);
      if (error) return json({ ok: false, error: error.message }, 500);

      const done: Record<string, unknown>[] = [];
      for (const row of queued ?? []) {
        const md = (row.metadata as Record<string, unknown>) ?? {};
        const stored = ((md.execution as Record<string, unknown>)?.targets as string[]) ?? [];

        // A switch's target is the challenger build, never Meta. Proposals
        // approved before switches carried a fanout queued ["meta"], which
        // dispatch would skip and file nothing — an approval that reads done
        // and did nothing. Correct it here rather than making the owner
        // re-approve work they already approved.
        const fanSystems = ((md.fanout as { system: string }[] | undefined) ?? []).map((f) => f.system);
        const targets = row.status === "approve_switch"
          ? (fanSystems.length ? fanSystems : ["content_director"])
          : stored;
        const results: Record<string, unknown>[] = [];

        for (const target of targets) {
          try {
            if (target === "meta") {
              // Only a close pauses. An approved SWITCH keeps the original
              // running — the challenger has not proven out yet, and pausing
              // a profitable campaign to make room for an unproven one is the
              // exact mistake the card warns against.
              if (row.status !== "approve_close") {
                results.push({ target, skipped: "switch keeps the original running" });
                continue;
              }
              const campaignId = (md.metrics as Record<string, unknown>)?.campaign_id ?? md.campaign_id;
              if (!campaignId) {
                results.push({ target, ok: false, error: "no campaign_id on proposal — rescan to capture it" });
                continue;
              }
              const r = await fetch(`${url}/functions/v1/meta-ads-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key ?? "" },
                body: JSON.stringify({ action: "pause_campaign", brand: row.brand, campaign_id: campaignId }),
              });
              const j = await r.json();
              results.push({ target, ok: !!j.ok, ...(j.ok ? { status: j.status } : { error: j.error }) });
              continue;
            }

            // Every non-Meta target becomes a Hub task for the system that
            // owns it. Filing work the owning tool picks up beats reaching
            // into four codebases from here, and it leaves an audit line.
            const fan = (md.fanout as { system: string; label: string; action: string }[] | undefined) ?? [];
            // Fallback describes the work for a switch approved before
            // switches carried a fanout, so an older card still files a
            // legible brief instead of a card titled with a bare slug.
            const spec = fan.find((f) => f.system === target) ?? (
              row.status === "approve_switch" && target === "content_director"
                ? {
                    system: target,
                    label: "ContentDirector",
                    action:
                      `Build the challenger for "${md.campaign ?? row.title}" — new hook and new opening ` +
                      `visual, same offer. Run it alongside; retire the original only once it proves out.`,
                  }
                : undefined
            );
            const { data: card, error: insErr } = await sb.from("slack_agent_tasks").insert({
              brand: row.brand,
              task_type: "ads_contingency",
              category: "marketing",
              status: "pending",
              priority: "high",
              assigned_to: "trish",
              title: `${spec?.label ?? target}: ${spec?.action ?? "contingency action"}`.slice(0, 160),
              description:
                `Dispatched from the approved AdsPro proposal "${row.title}".\n\n` +
                `${spec?.action ?? ""}\n\nApproved by the owner; this card is the work order for ${spec?.label ?? target}.`,
              created_by: "ads-proposals-dispatch",
              metadata: { source: "ads-proposals-dispatch", parent_proposal: row.id, system: target },
            }).select("id").single();
            results.push(insErr ? { target, ok: false, error: insErr.message } : { target, ok: true, card_id: card.id });
          } catch (e) {
            results.push({ target, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }

        const allOk = results.every((r) => r.ok === true || "skipped" in r);
        await sb.from("slack_agent_tasks").update({
          metadata: {
            ...md,
            execution: {
              ...(md.execution as Record<string, unknown>),
              state: allOk ? "executed" : "partial",
              executed_at: new Date().toISOString(),
              results,
            },
          },
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);

        done.push({ id: row.id, title: row.title, state: allOk ? "executed" : "partial", results });
      }

      return json({ ok: true, dispatched: done.length, proposals: done });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
