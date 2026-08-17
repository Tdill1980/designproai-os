/**
 * klaviyo-build-email — turns a Brand Board email CARD into a real Klaviyo DRAFT.
 *
 * Before this function, a WOTW/EDGE card was a sentence ("Campaign built from
 * Klaviyo master template S4HD3g…") that nothing read. The master templates
 * existed in Klaviyo, the footage existed in agent_media_assets, and neither
 * was wired to anything. This is the wire.
 *
 * The chain (nothing here invents a template or a design):
 *   1. Read the card (slack_agent_tasks) — title + description are the brief.
 *   2. Pick the MASTER by cadence (Wrap of the Week / The Edge monthly) and
 *      resolve it LIVE — by id if that still exists, else by name. Masters are
 *      authored in Klaviyo by the team; we never generate a layout, and we
 *      never trust a hard-coded id to outlive a folder reorganisation.
 *   3. CLONE the master in Klaviyo (keeps lineage — the draft is provably
 *      "built from" the master, not a lookalike).
 *   4. Fill the master's placeholder tokens with copy written from the card's
 *      brief in the brand voice, and with a hero image the model PICKS from
 *      our internal library (agent_media_assets — the Drive-synced photo/video
 *      library). Media is chosen by id from a candidate list, then resolved
 *      server-side, so the model can never invent an image URL.
 *   5. PATCH the filled HTML onto the clone.
 *   6. Create a DRAFT campaign against a real Klaviyo list + assign the clone.
 *   7. Stamp the card so it stops being prose and starts being state.
 *
 * IT NEVER SENDS. Same invariant as marketing-agent: we do not call Klaviyo's
 * send-job endpoint, ever. A human opens the draft in Klaviyo and sends it.
 *
 * Actions:
 *   audiences                       — list real Klaviyo lists (id, name, size)
 *   build { task_id, list_id?,      — the chain above. dry_run returns the
 *           dry_run?, master? }       resolved copy + media WITHOUT touching
 *                                     Klaviyo, so the board can preview.
 *   build_library { template_id |   — the OTHER direction: one of the 206
 *           slug, list_id?,            internal library templates
 *           shop_id?, merge_data?,     (email_templates) becomes a Klaviyo
 *           dry_run? }                 draft campaign. Person tags become
 *                                      Klaviyo variables; shop tags are baked
 *                                      in; per-transaction tags are refused.
 *
 * Env: KLAVIYO_API_KEY, OPENAI_API_KEY (both already set — same keys
 * marketing-agent uses), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadBrandBlock } from "../_shared/brand-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";
const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

const BRAND_OS_NAME: Record<string, string> = {
  weprintwraps: "WePrintWraps",
  restylepro: "RestyleProAI",
  designproai: "DesignProAI",
  wraptv: "WrapTV",
  wraptvworld: "WrapTV",
  inkandedge: "InkAndEdge",
  thewrap: "TheWrap",
};
const DEFAULT_FROM: Record<string, { email: string; label: string }> = {
  weprintwraps: { email: "hello@weprintwraps.com", label: "WePrintWraps" },
  restylepro: { email: "hello@restyleproai.com", label: "RestyleProAI" },
};

// UTM tagging on every draft this function builds. Without it a click that
// lands anywhere off the main site — a Lovable-hosted product page, a landing
// page, WordPress — arrives untagged, so the campaign reads as "people
// clicked, nobody bought" even when it sold. Klaviyo appends these to every
// link at send time; the dynamic values are resolved by Klaviyo per campaign,
// so a draft cannot ship a stale campaign name.
const TRACKING_OPTIONS = {
  add_tracking_params: true,
  is_tracking_clicks: true,
  is_tracking_opens: true,
  custom_tracking_params: [
    { type: "static", name: "utm_source", value: "klaviyo" },
    { type: "static", name: "utm_medium", value: "email" },
    { type: "dynamic", name: "utm_campaign", value: "campaign_name" },
    { type: "dynamic", name: "utm_id", value: "campaign_id" },
    { type: "dynamic", name: "utm_content", value: "campaign_name_send_day" },
  ],
} as const;

// ── The masters. Authored in Klaviyo by the team — this function fills them,
//    it never authors a layout. Token classes matter:
//      url  — the token sits INSIDE an attribute (src="…" / href="…"), so it
//             must be replaced EXACTLY or we'd eat the rest of the tag.
//      text — the token sits in a text node and carries a trailing writing
//             brief ("WINNER_BIO — one or two sentences about…"). Replacing
//             through to the next "<" removes the brief along with the token,
//             otherwise the instructions ship to the customer.
// ────────────────────────────────────────────────────────────────────────────
//
// The master is resolved by NAME at run time, not by a hard-coded id. The
// team reorganises templates into folders and re-creates them, and ids do not
// survive that: the original Edge master (Te8tV8) was deleted during a
// 2026-07-29 folder reorg, which would have 404'd every Edge build. `id` below
// is a hint tried first; if it is gone we look the master up by name, and if
// nothing matches we say so plainly instead of failing deep in the chain.
type MasterKey = "wotw" | "edge" | "designpro" | "club" | "inkandedge";
interface Master {
  /** Last-known id — a hint. Name lookup wins if this 404s. */
  id: string;
  /** Substring that identifies this master in Klaviyo, case-insensitive. */
  nameMatch: string;
  label: string;
  urlTokens: string[];
  textTokens: string[];
  /** Which token takes the hero image from the internal library. */
  heroToken: string;
}
const MASTERS: Record<MasterKey, Master> = {
  wotw: {
    id: "S4HD3g",
    nameMatch: "Wrap of the Week",
    label: "WPW — Wrap of the Week",
    urlTokens: ["HERO_IMAGE_URL", "WINNER_LINK", "EPISODE_LINK", "PRODUCT_IMAGE_URL", "PRODUCT_LINK"],
    textTokens: [
      "WINNER_HANDLE", "WINNER_BIO", "PRO_TIP_TEXT", "EPISODE_TEASER",
      "FEATURED_PRODUCT_NAME", "PRODUCT_LINE",
    ],
    heroToken: "HERO_IMAGE_URL",
  },
  edge: {
    // Te8tV8 was deleted in the folder reorganisation; TwJHSg is the re-created
    // master. The name fallback rescued the old id, but only after a wasted 404
    // on every single build.
    id: "TwJHSg",
    nameMatch: "THE EDGE Monthly",
    label: "WPW — THE EDGE Monthly",
    urlTokens: ["FEATURE_IMAGE_URL", "FEATURE_LINK"],
    textTokens: [
      "ISSUE_NO", "MONTH_YEAR", "FOUNDERS_NOTE", "FEATURE_HEADLINE",
      "FEATURE_TEASER", "WTW_RECAP", "GIVEAWAY_TEXT", "PRODUCT_NEWS",
    ],
    heroToken: "FEATURE_IMAGE_URL",
  },
  // White UI (the customer-facing standard): white surface, dark text, the
  // blue→magenta gradient as an ACCENT only. The wordmark is TEXT, not an
  // image — which is what permanently keeps a RestylePro mark from being
  // baked into a DesignPro header the way it was in the old templates.
  designpro: {
    id: "YhezNx",
    nameMatch: "DESIGNPRO — Master",
    label: "DesignPro — White UI",
    urlTokens: ["HERO_IMAGE_URL", "PROOF_IMAGE_URL", "CTA_LINK"],
    textTokens: [
      "PREVIEW_TEXT", "HEADLINE", "SUBHEAD", "INTRO_COPY", "FEATURE_LABEL",
      "FEATURE_HEADLINE", "FEATURE_COPY", "CTA_LABEL", "CLOSING_LINE",
    ],
    heroToken: "HERO_IMAGE_URL",
  },
  // The wildcard — freebies and member rewards. Magenta, loud, short.
  club: {
    id: "XAbwSS",
    nameMatch: "CLUB WPW — Master",
    label: "Club WPW — Rewards",
    urlTokens: ["HERO_IMAGE_URL", "CTA_LINK"],
    textTokens: [
      "PREVIEW_TEXT", "DROP_HEADLINE", "DROP_COPY", "REWARD_LABEL",
      "REWARD_DETAIL", "REWARD_TERMS", "CTA_LABEL",
    ],
    heroToken: "HERO_IMAGE_URL",
  },
  // The magazine + I&E Source newsletter. Distressed gray, serif, editorial —
  // it is allowed a point of view in a way the product emails are not.
  inkandedge: {
    id: "RvQPrL",
    nameMatch: "INK & EDGE — Master",
    label: "Ink & Edge — Distressed Gray",
    urlTokens: ["HERO_IMAGE_URL", "CTA_LINK"],
    textTokens: [
      "PREVIEW_TEXT", "ISSUE_LINE", "SECTION_LABEL", "FEATURE_HEADLINE",
      "STANDFIRST", "FEATURE_BODY", "FROM_THE_SHOP", "SHOP_NOTE", "CTA_LABEL",
    ],
    heroToken: "HERO_IMAGE_URL",
  },
};

/** Sensible fallbacks so a missing AI value never ships a raw token. */
const TOKEN_FALLBACKS: Record<string, string> = {
  WINNER_LINK: "https://weprintwraps.com/wrap-tv-world",
  EPISODE_LINK: "https://weprintwraps.com/wrap-tv-world",
  PRODUCT_LINK: "https://weprintwraps.com",
  FEATURE_LINK: "https://weprintwraps.com/the-edge",
  PRODUCT_IMAGE_URL: "https://weprintwraps.com/logo.png",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

function klaviyoHeaders(key: string) {
  return {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision: KLAVIYO_REVISION,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

async function klaviyo(key: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    method, headers: klaviyoHeaders(key), body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Klaviyo ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fill a master's tokens. Text tokens consume their trailing writing brief
 * (everything up to the next tag) so the instructions never reach a customer;
 * URL tokens are swapped exactly because they live inside an attribute.
 */
function fillMaster(html: string, master: Master, values: Record<string, string>) {
  let out = html;
  const missing: string[] = [];

  // LONGEST TOKEN FIRST. One token can contain another — HEADLINE is a
  // substring of FEATURE_HEADLINE — and replacing the short one first eats the
  // tail of the long one, leaving the orphaned prefix ("FEATURE_") as literal
  // text in a customer email with the wrong copy beside it. The 422 guard below
  // cannot catch that: once the short token has consumed it, the long token no
  // longer appears intact, so nothing looks unfilled. Order is the whole fix.
  const byLongest = (a: string, b: string) => b.length - a.length;

  for (const token of [...master.urlTokens].sort(byLongest)) {
    const value = (values[token] || TOKEN_FALLBACKS[token] || "").trim();
    if (!value) { missing.push(token); continue; }
    out = out.replaceAll(token, escapeHtml(value));
  }
  for (const token of [...master.textTokens].sort(byLongest)) {
    const value = (values[token] || "").trim();
    if (!value) { missing.push(token); continue; }
    // token + any trailing brief, stopping before the next tag.
    out = out.replace(new RegExp(`${escapeRe(token)}[^<]*`, "g"), escapeHtml(value));
  }

  // Klaviyo rejects a campaign template with no unsubscribe link. The masters
  // carry one; this only guards a hand-edited master.
  if (!out.includes("{% unsubscribe %}")) {
    out = out.replace(
      /<\/body>/i,
      `<p style="font-family:Arial,sans-serif;font-size:11px;color:#555;text-align:center">{% unsubscribe %}</p></body>`,
    );
  }
  return { html: out, missing };
}

/** Any token left unfilled would ship literally — catch it before Klaviyo does. */
function leftoverTokens(html: string, master: Master) {
  return [...master.urlTokens, ...master.textTokens].filter((t) => html.includes(t));
}

/**
 * Find the live master. Tries the known id, then falls back to a name search
 * so the build survives the template being re-created (a new id) — which is
 * exactly what a folder reorganisation does. Returns null when the master
 * genuinely no longer exists, so the caller can say which one is missing
 * rather than surfacing a raw 404.
 */
async function resolveMaster(
  key: string, master: Master,
): Promise<{ id: string; html: string; name: string } | null> {
  const fetchById = async (id: string) => {
    try {
      const tpl = await klaviyo(key, "GET", `/templates/${id}/`);
      const html = String(tpl?.data?.attributes?.html || "");
      return html ? { id, html, name: String(tpl?.data?.attributes?.name || "") } : null;
    } catch {
      return null; // deleted or renamed away — fall through to the name search
    }
  };

  const direct = await fetchById(master.id);
  if (direct) return direct;

  const q = encodeURIComponent(`contains(name,"${master.nameMatch}")`);
  let found: any[] = [];
  try {
    const res = await klaviyo(key, "GET", `/templates/?filter=${q}&page[size]=10`);
    found = res?.data ?? [];
  } catch {
    return null;
  }
  // Prefer one explicitly marked as the master; otherwise the newest match.
  const marked = found.find((t) => /master/i.test(t?.attributes?.name || ""));
  const pick = marked || found[0];
  return pick ? await fetchById(pick.id) : null;
}

// ── audiences ────────────────────────────────────────────────────────────────
async function fetchLists(key: string) {
  const out: Array<{ id: string; name: string; size: number | null }> = [];
  // Klaviyo caps /lists/ at page[size]=10 when profile_count is requested.
  let path: string | null = "/lists/?additional-fields[list]=profile_count&page[size]=10";
  while (path && out.length < 100) {
    let data: any;
    try {
      data = await klaviyo(key, "GET", path);
    } catch {
      data = await klaviyo(key, "GET", path.replace("additional-fields[list]=profile_count&", ""));
    }
    for (const l of data?.data ?? []) {
      out.push({ id: l.id, name: l.attributes?.name ?? "(unnamed)", size: l.attributes?.profile_count ?? null });
    }
    const next = data?.links?.next;
    path = next ? next.replace(KLAVIYO_BASE, "") : null;
  }
  return out;
}

async function actionAudiences() {
  const key = Deno.env.get("KLAVIYO_API_KEY");
  if (!key) return json({ error: "KLAVIYO_API_KEY missing" }, 500);
  const lists = await fetchLists(key);
  lists.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return json({ action: "audiences", lists });
}

// ── the internal library (agent_media_assets) ────────────────────────────────
/**
 * Candidate hero images from OUR library — the Drive-synced photo/video shelf
 * the Engine Room already uses. We hand the model titles/tags only; it returns
 * an id, and we resolve the URL here. The model cannot invent an image.
 */
interface MediaCandidate {
  id: string;
  title: string;
  tags: string[];
  url: string;
  kind: string;
}
async function libraryCandidates(sb: ReturnType<typeof db>, brand: string): Promise<MediaCandidate[]> {
  const pick = (rows: any[]): MediaCandidate[] =>
    (rows || [])
      .map((a) => {
        // A video contributes its poster frame; a photo contributes itself.
        const isVideo = /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(a.storage_url || "");
        const url = isVideo ? a.thumbnail_url : (a.thumbnail_url || a.storage_url);
        if (!url) return null;
        if (/\.(mp3|wav|m4a|aac)(\?.*)?$/i.test(url)) return null;
        return {
          id: a.id as string,
          title: (a.title || a.original_filename || "untitled") as string,
          tags: (Array.isArray(a.tags) ? a.tags : []).slice(0, 8),
          url: url as string,
          kind: isVideo ? "video still" : "photo",
        };
      })
      .filter(Boolean) as MediaCandidate[];

  const cols = "id, title, original_filename, storage_url, thumbnail_url, tags, brand, created_at";
  const { data: onBrand } = await sb.from("agent_media_assets")
    .select(cols).eq("brand", brand).order("created_at", { ascending: false }).limit(40);
  let out = pick(onBrand as any[]);
  if (out.length < 12) {
    // Thin on-brand shelf — widen rather than ship a placeholder.
    const { data: any_ } = await sb.from("agent_media_assets")
      .select(cols).order("created_at", { ascending: false }).limit(60);
    const seen = new Set(out.map((c) => c.id));
    out = [...out, ...pick(any_ as any[]).filter((c) => !seen.has(c.id))];
  }
  return out.slice(0, 40);
}

// ── copy fill ────────────────────────────────────────────────────────────────
async function writeFill(opts: {
  openaiKey: string;
  master: Master;
  masterKey: MasterKey;
  brand: string;
  card: { title: string; description: string; date: string | null };
  candidates: MediaCandidate[];
}): Promise<{ values: Record<string, string>; heroAssetId: string | null; subject: string; preview: string }> {
  const { openaiKey, master, masterKey, brand, card, candidates } = opts;
  const brandBlock = await loadBrandBlock(BRAND_OS_NAME[brand] || "WePrintWraps");

  const tokenSpec = [
    ...master.textTokens.map((t) => `- ${t} (text)`),
    ...master.urlTokens.filter((t) => t !== master.heroToken).map((t) => `- ${t} (absolute https URL)`),
  ].join("\n");

  const mediaSpec = candidates.length
    ? candidates.map((c, i) => `${i + 1}. id=${c.id} · ${c.kind} · "${c.title}"${c.tags.length ? ` · tags: ${c.tags.join(", ")}` : ""}`).join("\n")
    : "(library empty — leave hero_asset_id null)";

  const system =
    `You are the email copywriter for this brand. You are filling a LOCKED Klaviyo master ` +
    `template — you do not design anything, you only supply the copy that drops into its ` +
    `existing slots.\n\n${brandBlock}\n\n` +
    `Write in the brand voice: plain-spoken, specific, no marketing mush, no em-dash-heavy ` +
    `filler, no invented statistics, no fake urgency. Every slot must read like a person ` +
    `wrote it about THIS week's brief.\n\n` +
    `Return JSON with:\n` +
    `  "values": an object with EXACTLY these keys, each a finished string:\n${tokenSpec}\n` +
    `  "hero_asset_id": the id of the ONE library asset that best fits this email's story, ` +
    `chosen from the list below, or null if none fit. Never invent an id or a URL.\n` +
    `  "subject": the email subject line (under 60 chars, no emoji spam)\n` +
    `  "preview": the inbox preview text (under 90 chars)\n\n` +
    `Keep each text value to the length its slot implies — headline slots get a headline, ` +
    `teaser slots get one or two sentences. Do not include the slot name in your value. ` +
    `Do not use placeholder text like "TBD" or "lorem".\n\n` +
    `AVAILABLE LIBRARY ASSETS (our own footage/photos — pick by id):\n${mediaSpec}`;

  const user =
    `Master: ${master.label} (${masterKey === "wotw" ? "weekly Wrap of the Week" : "monthly The Edge newsletter"})\n` +
    `Planned send date: ${card.date || "not set"}\n\n` +
    `CARD TITLE: ${card.title}\n\n` +
    `CARD BRIEF:\n${card.description || "(no brief beyond the title — write from the title)"}\n\n` +
    `Fill every slot from this brief. Where the brief is silent, write something true to the ` +
    `brand rather than inventing a specific claim, customer name, or number.`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const parsed = JSON.parse(out.choices?.[0]?.message?.content || "{}");

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.values || {})) {
    if (typeof v === "string" && v.trim()) values[k] = v.trim();
  }
  return {
    values,
    heroAssetId: typeof parsed.hero_asset_id === "string" ? parsed.hero_asset_id : null,
    subject: String(parsed.subject || card.title).slice(0, 150),
    preview: String(parsed.preview || "").slice(0, 200),
  };
}

// ── build ────────────────────────────────────────────────────────────────────
/**
 * Route a card to its master. BRAND decides first — a DesignPro card must not
 * fall through to a WePrintWraps master, which is what happened while WOTW was
 * the only option. Cadence (Edge vs Wrap of the Week) only breaks the tie
 * inside the WePrintWraps family.
 */
function pickMaster(
  card: { title: string; description: string; brand: string },
  override?: string,
): MasterKey {
  if (override && override in MASTERS) return override as MasterKey;

  const brand = (card.brand || "").toLowerCase().replace(/[^a-z]/g, "");
  if (brand.includes("designpro")) return "designpro";
  if (brand.includes("inkandedge") || brand.includes("inkedge")) return "inkandedge";

  const hay = `${card.title} ${card.description}`.toLowerCase();
  // Club WPW is a WePrintWraps property, so it is named rather than branded.
  if (/\bclub wpw\b|\bclubwpw\b/.test(hay)) return "club";
  if (/\bthe edge\b|\bedge #|monthly newsletter/.test(hay)) return "edge";
  return "wotw";
}

async function actionBuild(body: Record<string, unknown>) {
  const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!klaviyoKey) return json({ error: "KLAVIYO_API_KEY missing" }, 500);
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

  // TWO SHAPES OF BRIEF, ONE BUILDER.
  //
  // `task_id` is a Brand Board card (slack_agent_tasks). `campaign_id` is a row
  // in agent_email_campaigns — the Content Director's own email queue, which
  // had no way in here at all. Measured 2026-08-10: 184 of 194 campaigns
  // carrying body_html held a bare copy fragment rather than a design, because
  // nothing ever built them into a master.
  //
  // A campaign is READ INTO THE SAME `card` SHAPE below, so `pickMaster`,
  // `writeFill`, `fillMaster`, the clone and the draft all run UNCHANGED. This
  // adds an input, not a second producer — the per-brand master routing that
  // already exists is exactly what a campaign needs, and duplicating any of it
  // for email would be the drift this file's header warns about.
  const taskId = String(body.task_id || "");
  const briefCampaignId = String(body.campaign_id || "");
  if (!taskId && !briefCampaignId) {
    return json({ error: "task_id (a Brand Board card) or campaign_id (an email campaign) is required" }, 400);
  }
  if (taskId && briefCampaignId) {
    // Ambiguous input would silently build one and ignore the other, then stamp
    // the wrong row — a draft nobody can trace back to its brief.
    return json({ error: "pass task_id OR campaign_id, not both" }, 400);
  }
  const dryRun = body.dry_run === true;

  const sb = db();
  const source = taskId ? "slack_agent_tasks" : "agent_email_campaigns";
  const rowId = taskId || briefCampaignId;

  let task: Record<string, unknown> | null = null;
  if (taskId) {
    const { data, error } = await sb.from("slack_agent_tasks")
      .select("id, title, description, brand, due_date, created_at, metadata, status")
      .eq("id", taskId).single();
    if (error || !data) return json({ error: `card ${taskId} not found` }, 404);
    task = data as Record<string, unknown>;
  } else {
    const { data, error } = await sb.from("agent_email_campaigns")
      .select("id, campaign_name, subject_line, preview_text, body_html, brand, scheduled_date, created_at, status, klaviyo_campaign_id")
      .eq("id", briefCampaignId).single();
    if (error || !data) return json({ error: `campaign ${briefCampaignId} not found` }, 404);
    const c = data as Record<string, unknown>;
    // The BRIEF is the copy that already exists. Tags are stripped because the
    // brief is read by a model as prose, and markup in it becomes instructions
    // it tries to honour.
    const bodyText = String(c.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    task = {
      id: c.id,
      title: String(c.campaign_name || c.subject_line || "Email campaign"),
      description: [String(c.preview_text || ""), bodyText].filter(Boolean).join("\n\n"),
      brand: c.brand,
      due_date: c.scheduled_date,
      created_at: c.created_at,
      status: c.status,
      // Campaigns carry the built id in a column, not in metadata. Mapped here
      // so the already-built guard below reads one shape.
      metadata: c.klaviyo_campaign_id ? { klaviyo_campaign_id: c.klaviyo_campaign_id } : {},
    };
  }

  const meta = (task.metadata || {}) as Record<string, unknown>;
  if (meta.klaviyo_campaign_id && body.force !== true) {
    return json({
      error: `already built in Klaviyo as ${meta.klaviyo_campaign_id} — pass force:true to rebuild`,
      klaviyo_campaign_id: meta.klaviyo_campaign_id,
    }, 409);
  }

  const brand = String(task.brand || "weprintwraps").toLowerCase();
  const card = {
    title: String(task.title || ""),
    description: String(task.description || ""),
    date: (task.due_date as string) || null,
    brand,
  };
  const masterKey = pickMaster(card, body.master as string | undefined);

  // A CAMPAIGN MAY NOT FALL BACK INTO A WINNER FORMAT.
  //
  // `pickMaster` ends with `return "wotw"` — correct for a Brand Board card,
  // where Wrap of the Week is the house default and the brief is written for
  // it. It is DANGEROUS for a campaign, because WOTW's slots demand
  // winner-shaped content (WINNER_HANDLE, WINNER_BIO, EPISODE_TEASER) and a
  // model handed a generic marketing brief has no way to fill them except by
  // INVENTING A WINNER.
  //
  // Measured on live dry runs the day the campaign input shipped, all three
  // brands without a master of their own resolved to wotw and fabricated one:
  //   weprintwraps → "Ghost Industries", plus URLs that do not exist
  //   restylepro   → "@MightyWraps — Pioneers in transforming wraps…"
  //   thewrap      → "@RoyaltyWraps … Amanda shares her studio sponsorship
  //                   journey" — an invented person's story
  // Two of the three returned no error, so they would have built real Klaviyo
  // drafts carrying that copy.
  //
  // So a campaign builds ONLY against a master chosen on purpose: an explicit
  // `master`, or a brand that owns one. Anything else is refused by name. The
  // CARD path is untouched — its fallback is still correct for it.
  if (source === "agent_email_campaigns" && !body.master) {
    const brandKey = String(card.brand || "").toLowerCase().replace(/[^a-z]/g, "");
    const ownsMaster = brandKey.includes("designpro")
      || brandKey.includes("inkandedge")
      || brandKey.includes("inkedge");
    if (!ownsMaster) {
      return json({
        error:
          `${card.brand || "this brand"} has no master of its own, and a campaign must not fall back to ` +
          `Wrap of the Week — its slots require a winner, so the copy would be invented. ` +
          `Pass an explicit master, or author one for this brand in Klaviyo.`,
        brand: card.brand,
        available_masters: Object.entries(MASTERS).map(([key, m]) => ({ key, label: m.label })),
      }, 409);
    }
  }

  const master = MASTERS[masterKey];

  // 1) copy + a hero picked from OUR library
  const candidates = await libraryCandidates(sb, brand);
  const fill = await writeFill({ openaiKey, master, masterKey, brand, card, candidates });

  const hero = fill.heroAssetId ? candidates.find((c) => c.id === fill.heroAssetId) : null;
  if (hero) fill.values[master.heroToken] = hero.url;

  // 2) the master's own HTML — we fill it, we never author a layout
  const live = await resolveMaster(klaviyoKey, master);
  if (!live) {
    return json({
      error:
        `no live "${master.label}" master template in Klaviyo — looked for id ${master.id} ` +
        `and for a template named like "${master.nameMatch}". It was probably deleted or ` +
        `renamed. Re-create the master (keep "MASTER TEMPLATE" in its name) and rebuild.`,
      master: { key: masterKey, expected_id: master.id, name_match: master.nameMatch },
    }, 424);
  }
  const masterHtml = live.html;

  const { html, missing } = fillMaster(masterHtml, master, fill.values);
  const leftover = leftoverTokens(html, master);

  const preview = {
    master: { key: masterKey, id: live.id, label: master.label, name: live.name },
    subject: fill.subject,
    preview_text: fill.preview,
    values: fill.values,
    hero: hero ? { asset_id: hero.id, title: hero.title, url: hero.url, kind: hero.kind } : null,
    library_candidates: candidates.length,
    unfilled_slots: missing,
  };

  if (leftover.length) {
    // A literal token in a customer-facing email is worse than no email.
    return json({
      error: `refusing to build — ${leftover.length} slot(s) came back empty and would ship as literal text: ${leftover.join(", ")}`,
      ...preview,
    }, 422);
  }
  if (dryRun) return json({ action: "build", dry_run: true, ...preview, html });

  // 3) list
  let listId = String(body.list_id || "");
  let listName = "";
  const lists = await fetchLists(klaviyoKey);
  if (listId) {
    listName = lists.find((l) => l.id === listId)?.name || "";
  } else {
    const biggest = [...lists].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
    if (!biggest) return json({ error: "no Klaviyo lists found — pass list_id" }, 400);
    listId = biggest.id;
    listName = biggest.name;
  }

  // 4) CLONE the master, then PATCH the filled HTML onto the clone. Cloning
  //    (rather than creating a fresh template) keeps the draft provably
  //    descended from the master the team authored.
  const stamp = (card.date || new Date().toISOString()).slice(0, 10);
  const cloneName = `[${masterKey.toUpperCase()}] ${card.title.slice(0, 80)} · ${stamp}`;
  let templateId: string;
  let lineage: "cloned" | "created";
  try {
    const clone = await klaviyo(klaviyoKey, "POST", "/template-clone/", {
      data: { type: "template", id: live.id, attributes: { name: cloneName } },
    });
    templateId = clone.data.id;
    lineage = "cloned";
    await klaviyo(klaviyoKey, "PATCH", `/templates/${templateId}/`, {
      data: { type: "template", id: templateId, attributes: { html } },
    });
  } catch (_cloneErr) {
    // Clone endpoint unavailable on this revision — fall back to a template
    // carrying the master's filled HTML (same pixels, weaker lineage).
    const tpl = await klaviyo(klaviyoKey, "POST", "/templates/", {
      data: { type: "template", attributes: { name: cloneName, editor_type: "CODE", html } },
    });
    templateId = tpl.data.id;
    lineage = "created";
  }

  // 5) DRAFT campaign. Klaviyo creates campaigns in Draft; we never call the
  //    send-job endpoint, so this cannot go out on its own.
  const sendAt = `${stamp}T14:00:00`;
  const from = DEFAULT_FROM[brand] || DEFAULT_FROM.weprintwraps;
  const fromEmail = String(body.from_email || from.email);
  const fromLabel = String(body.from_label || from.label);
  const campaignAttrs = (withStrategy: boolean, withTracking = true) => ({
    name: cloneName,
    audiences: { included: [listId], excluded: [] },
    ...(withTracking ? { tracking_options: TRACKING_OPTIONS } : {}),
    ...(withStrategy ? { send_strategy: { method: "static", options_static: { datetime: sendAt } } } : {}),
    "campaign-messages": {
      data: [{
        type: "campaign-message",
        attributes: {
          channel: "email", label: card.title.slice(0, 100),
          content: {
            subject: fill.subject, preview_text: fill.preview,
            from_email: fromEmail, from_label: fromLabel, reply_to_email: fromEmail,
          },
        },
      }],
    },
  });

  let camp: any;
  let tracked = true;
  try {
    camp = await klaviyo(klaviyoKey, "POST", "/campaigns/", {
      data: { type: "campaign", attributes: campaignAttrs(true) },
    });
  } catch (_strategyErr) {
    // Some revisions reject the static-strategy shape; the draft matters more
    // than the pencilled-in date, which the human sets on send anyway.
    try {
      camp = await klaviyo(klaviyoKey, "POST", "/campaigns/", {
        data: { type: "campaign", attributes: campaignAttrs(false) },
      });
    } catch (_trackingErr) {
      // Last resort: build the draft untagged rather than not at all. Logged
      // and stamped so an untracked campaign is visible, not silent.
      tracked = false;
      console.warn("[klaviyo-build-email] campaign rejected tracking_options — building untagged");
      camp = await klaviyo(klaviyoKey, "POST", "/campaigns/", {
        data: { type: "campaign", attributes: campaignAttrs(false, false) },
      });
    }
  }

  const campaignId = camp.data.id;
  const messageId = camp.data.relationships?.["campaign-messages"]?.data?.[0]?.id;
  if (messageId) {
    await klaviyo(klaviyoKey, "POST", "/campaign-message-assign-template/", {
      data: {
        type: "campaign-message", id: messageId,
        relationships: { template: { data: { type: "template", id: templateId } } },
      },
    });
  }

  // 6) stamp the card — the board now shows state, not prose
  const builtAt = new Date().toISOString();
  // Stamp the row this brief came FROM. A campaign has no metadata column, so
  // its built ids go on the columns it does have; the card keeps its metadata
  // blob. Same facts, two shapes.
  if (source === "agent_email_campaigns") {
    await sb.from("agent_email_campaigns").update({
      klaviyo_campaign_id: campaignId,
      status: task.status === "draft" ? "needs_review" : (task.status as string),
    }).eq("id", rowId);
  } else {
  await sb.from("slack_agent_tasks").update({
    status: task.status === "pending" ? "in_progress" : task.status,
    metadata: {
      ...meta,
      klaviyo_campaign_id: campaignId,
      klaviyo_template_id: templateId,
      klaviyo_master_id: live.id,
      klaviyo_master_key: masterKey,
      klaviyo_list_id: listId,
      klaviyo_list_name: listName,
      klaviyo_lineage: lineage,
      klaviyo_hero_asset_id: hero?.id ?? null,
      klaviyo_built_at: builtAt,
      klaviyo_utm_tagged: tracked,
      klaviyo_campaign_url: `https://www.klaviyo.com/campaign/${campaignId}/wizard`,
    },
  }).eq("id", rowId);
  }

  return json({
    action: "build",
    source,
    task_id: taskId || null,
    campaign_id: briefCampaignId || null,
    ...preview,
    klaviyo_campaign_id: campaignId,
    klaviyo_template_id: templateId,
    klaviyo_campaign_url: `https://www.klaviyo.com/campaign/${campaignId}/wizard`,
    lineage,
    utm_tagged: tracked,
    list: { id: listId, name: listName },
    built_at: builtAt,
    note: "DRAFT only — review and send in Klaviyo. This function never sends.",
  });
}

// ── build_library — an INTERNAL library template becomes a Klaviyo draft ─────
//
// The 206-template library (email_templates) is our own authored HTML with
// {{merge_tag}} placeholders, resolved per-recipient by send-templated-email
// (Resend, one customer at a time). Nothing could send one as a CAMPAIGN.
// This is that path: resolve the tags, hand the HTML to Klaviyo, leave a draft.
//
// Tag resolution has three buckets, and the distinction is the whole job:
//   person   -> becomes a Klaviyo variable, so Klaviyo personalises per
//               recipient at send time ({{ person.first_name }}).
//   shop      -> resolved HERE from shop_profiles, because it is the same
//               value for every recipient of this campaign.
//   unknown   -> a per-transaction tag (order_id, download_url) that has no
//               meaning in a blast. We refuse rather than ship "{{order_id}}"
//               or, worse, silently blank it the way send-templated-email
//               does for one-off sends.

/** Internal tag -> Klaviyo personalisation variable. */
const KLAVIYO_PERSON_TAGS: Record<string, string> = {
  customer_name: '{{ person.first_name|default:"there" }}',
  customer_email: "{{ person.email }}",
  customer_first_name: '{{ person.first_name|default:"there" }}',
};

/** Tags we can fill ourselves at build time. */
function staticTagValues(shop: Record<string, any> | null, appUrl: string) {
  return {
    current_year: String(new Date().getFullYear()),
    app_url: appUrl,
    shop_name: shop?.shop_name ?? "",
    shop_logo_url: shop?.shop_logo_url ?? "",
    shop_phone: shop?.phone ?? "",
    shop_email: shop?.email ?? "",
    shop_website: shop?.website ?? "",
  } as Record<string, string>;
}

function resolveLibraryTags(
  content: string,
  resolved: Record<string, string>,
): { out: string; unresolved: string[] } {
  let out = content;
  for (const [tag, value] of Object.entries(resolved)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRe(tag)}\\s*\\}\\}`, "g"), value);
  }
  const unresolved = [...new Set(
    [...out.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]),
  )];
  return { out, unresolved };
}

async function actionBuildLibrary(body: Record<string, unknown>) {
  const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
  if (!klaviyoKey) return json({ error: "KLAVIYO_API_KEY missing" }, 500);

  const templateId = String(body.template_id || "");
  const slug = String(body.slug || "");
  if (!templateId && !slug) return json({ error: "pass template_id or slug" }, 400);
  const dryRun = body.dry_run === true;

  const sb = db();
  const q = sb.from("email_templates").select("id, slug, name, subject, html_content, text_content, from_email, from_name, category");
  const { data: tpl, error } = templateId
    ? await q.eq("id", templateId).single()
    : await q.eq("slug", slug).single();
  if (error || !tpl) return json({ error: `library template ${templateId || slug} not found` }, 404);

  // Shop values are constant across a campaign, so we bake them in now.
  let shop: Record<string, any> | null = null;
  const shopId = String(body.shop_id || "");
  if (shopId) {
    const { data } = await sb.from("shop_profiles")
      .select("shop_name, shop_logo_url, phone, email, website").eq("id", shopId).maybeSingle();
    shop = data ?? null;
  }

  const appUrl = String(body.app_url || "https://www.restyleproai.com");
  const overrides = (body.merge_data && typeof body.merge_data === "object")
    ? body.merge_data as Record<string, string> : {};
  const resolved = {
    ...staticTagValues(shop, appUrl),
    ...KLAVIYO_PERSON_TAGS,
    ...overrides,
  };
  // An empty shop value is not a resolution — drop it so it surfaces as
  // unresolved instead of quietly blanking the shop's name in the email.
  for (const k of Object.keys(resolved)) if (!resolved[k]) delete resolved[k];

  const { out: html, unresolved } = resolveLibraryTags(tpl.html_content || "", resolved);
  const { out: subject, unresolved: subjUnresolved } = resolveLibraryTags(tpl.subject || tpl.name, resolved);
  const { out: text } = resolveLibraryTags(tpl.text_content || "", resolved);
  const allUnresolved = [...new Set([...unresolved, ...subjUnresolved])];

  const preview = {
    template: { id: tpl.id, slug: tpl.slug, name: tpl.name, category: tpl.category },
    subject,
    shop_applied: shop ? (shop.shop_name || "(unnamed shop)") : null,
    personalised_tags: Object.keys(KLAVIYO_PERSON_TAGS).filter((t) => (tpl.html_content || "").includes(t)),
    unresolved_tags: allUnresolved,
  };

  if (allUnresolved.length) {
    return json({
      error:
        `refusing to build — ${allUnresolved.length} merge tag(s) have no value for a campaign send ` +
        `and would ship literally: ${allUnresolved.join(", ")}. ` +
        `Pass shop_id for shop_* tags, or merge_data:{tag:"value"} for the rest.`,
      ...preview,
    }, 422);
  }

  let finalHtml = html;
  if (!finalHtml.includes("{% unsubscribe %}")) {
    const footer = `<p style="font-family:Arial,sans-serif;font-size:11px;color:#888;text-align:center;padding:16px">{% unsubscribe %}</p>`;
    finalHtml = /<\/body>/i.test(finalHtml)
      ? finalHtml.replace(/<\/body>/i, `${footer}</body>`)
      : finalHtml + footer;
  }

  if (dryRun) return json({ action: "build_library", dry_run: true, ...preview, html: finalHtml });

  let listId = String(body.list_id || "");
  let listName = "";
  const lists = await fetchLists(klaviyoKey);
  if (listId) {
    listName = lists.find((l) => l.id === listId)?.name || "";
  } else {
    const biggest = [...lists].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
    if (!biggest) return json({ error: "no Klaviyo lists found — pass list_id" }, 400);
    listId = biggest.id;
    listName = biggest.name;
  }

  const name = `[library] ${tpl.name}`.slice(0, 120);
  const created = await klaviyo(klaviyoKey, "POST", "/templates/", {
    data: { type: "template", attributes: { name, editor_type: "CODE", html: finalHtml, text } },
  });
  const klaviyoTemplateId = created.data.id;

  const from = DEFAULT_FROM.restylepro;
  const fromEmail = String(body.from_email || tpl.from_email || from.email);
  const fromLabel = String(body.from_label || tpl.from_name || from.label);
  const camp = await klaviyo(klaviyoKey, "POST", "/campaigns/", {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: { included: [listId], excluded: [] },
        tracking_options: TRACKING_OPTIONS,
        "campaign-messages": {
          data: [{
            type: "campaign-message",
            attributes: {
              channel: "email", label: tpl.name.slice(0, 100),
              content: {
                subject, preview_text: "",
                from_email: fromEmail, from_label: fromLabel, reply_to_email: fromEmail,
              },
            },
          }],
        },
      },
    },
  });
  const campaignId = camp.data.id;
  const messageId = camp.data.relationships?.["campaign-messages"]?.data?.[0]?.id;
  if (messageId) {
    await klaviyo(klaviyoKey, "POST", "/campaign-message-assign-template/", {
      data: {
        type: "campaign-message", id: messageId,
        relationships: { template: { data: { type: "template", id: klaviyoTemplateId } } },
      },
    });
  }

  return json({
    action: "build_library",
    ...preview,
    klaviyo_campaign_id: campaignId,
    klaviyo_template_id: klaviyoTemplateId,
    klaviyo_campaign_url: `https://www.klaviyo.com/campaign/${campaignId}/wizard`,
    list: { id: listId, name: listName },
    note: "DRAFT only — review and send in Klaviyo. This function never sends.",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || "build");
    if (action === "audiences") return await actionAudiences();
    if (action === "build") return await actionBuild(body);
    if (action === "build_library") return await actionBuildLibrary(body);
    return json({ error: `unknown action "${action}" — use build | build_library | audiences` }, 400);
  } catch (e) {
    console.error("[klaviyo-build-email]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
