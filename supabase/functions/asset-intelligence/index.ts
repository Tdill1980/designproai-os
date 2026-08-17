/**
 * asset-intelligence — THE TRUTH LAYER for the content system.
 *
 * "Content Director supplies the marketing intent. The asset supplies the
 * truth." (Trish, 2026-08). This function is the second half of that sentence.
 * It reads a real photo or a real video and returns GROUNDED, REUSABLE facts
 * about what is actually in it — nothing else. It is the input a hook engine
 * writes FROM; it is not the hook engine.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────
 *
 * 1. IT DOES NOT WRITE A HOOK, AND IT NEVER STORES ONE ON THE ASSET.
 *    A source asset is used by many content variants. Bake one "AI generated
 *    hook" onto it and every variant inherits the same opening line, the same
 *    angle, and the same mistake — and the asset stops being a source of truth
 *    and becomes a stale piece of copy. So the asset stores FACTS
 *    (`hookableFacts` = raw material, each with its evidence) and each variant
 *    derives its own hook later, downstream, from the intent it was given.
 *    `stripHookFields()` enforces this on anything the model hands back: any
 *    key that reads like a hook is deleted before the object is persisted.
 *
 * 2. IT DOES NOT INVENT. Every fact carries `evidence` — a verbatim quote, a
 *    timecode, or a described frame from THIS asset. A fact without evidence is
 *    an assertion, and an assertion is dropped on the floor by `grounded()`,
 *    in BOTH the assembled-from-storage path and the model path. An empty list
 *    is a correct answer. A confidently fabricated fact is worse than no fact,
 *    because every downstream hook inherits it and no human reading the hook
 *    can tell it was invented.
 *
 *    Same rule for `claimsSupported`: it holds only claims THIS asset genuinely
 *    backs. An install photo showing no defect does not support "Bad print
 *    ruined this install." That claim has to fail here, because nothing
 *    downstream is in a position to check it.
 *
 * 3. IT DOES NOT SPEND MONEY BY DEFAULT. Measured on production 2026-08-06:
 *    `content_moments` already holds 11,675 rows (8,017 with a
 *    `visual_description`, 3,653 with a `verbatim_quote`) across 481
 *    `media_sources`, 281 of which carry a transcript, and 445 library assets
 *    join a media_sources row on `storage_url`. For most of the library the
 *    truth has ALREADY been paid for. So the order is: stored `visual_tags` →
 *    stored moments + transcript → and only then, only behind an explicit
 *    `{ analyze: true }`, a model call. `source` in the response says which
 *    happened, every time.
 *
 * ── REQUEST ──────────────────────────────────────────────────────────────────
 *   POST {
 *     asset_id?:    string   // agent_media_assets.id
 *     storage_url?: string   // …or address the asset by URL (unique index)
 *     analyze?:     boolean  // default FALSE — the only thing that permits spend
 *     refresh?:     boolean  // default FALSE — the only thing that overwrites
 *     persist?:     boolean  // default TRUE
 *     frames?:      [{ time: number, image_base64: string }]  // video, caller-sampled
 *     image_url?:   string   // override the image analysed (defaults to storage_url)
 *   }
 *
 * ── RESPONSE ─────────────────────────────────────────────────────────────────
 *   { ok, asset:{id,title,kind,storage_url}, source:"existing"|"analyzed"|"none",
 *     cached, intelligence:{…}, persisted, notes[], missing?[], remedy? }
 *
 *   `cached: true` means a previous call already assembled it and it came
 *   straight off the row — the same `source: "existing"`, zero work.
 *
 *   The intelligence is returned in the body as well as persisted, so a caller
 *   never needs a second read to use it.
 *
 * ── STORAGE ──────────────────────────────────────────────────────────────────
 * Persisted to `agent_media_assets.visual_tags` (jsonb) keyed on `storage_url`
 * — verified 2026-08-06: the column exists and
 * `uq_agent_media_assets_storage_url` is a real unique partial index, so the
 * key identifies exactly one row. The write is MERGED under the single
 * namespaced key `asset_intelligence`; other keys on `visual_tags` belong to
 * other writers and are left untouched.
 *
 * NOTE FOR WHOEVER TOUCHES THIS NEXT — a real interaction, not a hypothetical:
 * `worker/video-renderer/tagLibrary.js` treats a NON-EMPTY `visual_tags` as its
 * "already paid for the vision call on this row" marker (`hasMachineTags`). So
 * once this function persists, that pass will skip buying its own tags for the
 * row (it still writes the poster). That is the right trade when this function
 * assembled real visual evidence; it is a genuine loss for a row where the only
 * evidence was a transcript. It is called out here rather than worked around,
 * because the workaround would live in a file this function does not own.
 *
 * Auth: service-role key OR a valid authenticated user. CORS enabled.
 * verify_jwt = false in config.toml (the gateway would otherwise 401 stale JWTs
 * before this code runs).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

// Same model + call shape as marketing-agent's `vision_score` — that is the
// existing visual pass in this codebase and there is no reason for a second
// vendor path. Temperature 0, though, not 0.3: vision_score is SCORING
// (editorial judgement), this is TRANSCRIBING REALITY, and creativity here is
// indistinguishable from fabrication.
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";
const PRODUCER = "asset-intelligence.v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** 45 → "0:45", 128 → "2:08". Timecodes are evidence, so they must be readable. */
function tc(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── THE GROUNDING GATE ──────────────────────────────────────────────────────

type FactKind =
  | "statement"
  | "visual"
  | "result"
  | "transformation"
  | "tension"
  | "demonstration"
  | "proof"
  | "detail"
  | "emotion";

const FACT_KINDS: FactKind[] = [
  "statement", "visual", "result", "transformation",
  "tension", "demonstration", "proof", "detail", "emotion",
];

interface Fact {
  text: string;
  kind: FactKind;
  /** A verbatim quote, a timecode, or a described frame FROM THIS ASSET. */
  evidence: string;
  confidence: number;
}

interface Claim {
  claim: string;
  evidence: string[];
  confidence: number;
}

/**
 * The single chokepoint every fact passes through, from either path.
 *
 * No evidence → not a fact → dropped. This is deliberately not a warning or a
 * lower confidence score: a fact with `confidence: 0.2` still gets read by a
 * hook writer and turned into a confident sentence. The only safe handling of
 * an ungrounded claim is that it does not exist.
 */
function grounded(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) return [];
  const out: Fact[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    const evidence = String(o.evidence ?? "").trim();
    if (!text || !evidence) continue;                 // ← the whole point
    const kind = FACT_KINDS.includes(o.kind as FactKind) ? (o.kind as FactKind) : "visual";
    const key = `${kind}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let confidence = Number(o.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.6;
    out.push({
      text: text.slice(0, 400),
      kind,
      evidence: evidence.slice(0, 400),
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }
  return out;
}

/** Same gate for claims: a claim with nothing behind it is an opinion. */
function groundedClaims(raw: unknown): Claim[] {
  if (!Array.isArray(raw)) return [];
  const out: Claim[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const claim = String(o.claim ?? "").trim();
    const evidence = (Array.isArray(o.evidence) ? o.evidence : [o.evidence])
      .map((e) => String(e ?? "").trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!claim || !evidence.length) continue;
    let confidence = Number(o.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.6;
    out.push({ claim: claim.slice(0, 300), evidence, confidence: Math.min(1, Math.max(0, confidence)) });
  }
  return out;
}

/**
 * Delete anything that reads like a hook, at any depth, before persisting.
 *
 * `hookableFacts` is the one allowed exception — it is raw material with
 * evidence attached, not a written line. Everything else (a `hook`,
 * `hook_text`, `hookLine`, `suggested_hook`, a score called `hook_score`) is
 * removed: the asset carries facts, the variant carries the hook.
 */
const HOOK_FIELD_ALLOWLIST = new Set(["hookableFacts"]);
function stripHookFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripHookFields(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/hook/i.test(k) && !HOOK_FIELD_ALLOWLIST.has(k)) continue;
      out[k] = stripHookFields(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ── THE NEVER-INVENT INSTRUCTION (shared by every model prompt) ─────────────

const NEVER_INVENT = `
GROUNDING RULES — these outrank every other instruction:
- Describe ONLY what is actually present in the material you were given. If you
  are not certain something is there, leave it out.
- Every fact MUST carry "evidence": a verbatim quote from the transcript, a
  timecode of the frame you saw it in, or a plain description of that frame. A
  fact you cannot evidence is an assertion — omit it.
- NEVER invent. Do not name a brand, person, product, company, city, price,
  measurement, date or outcome that is not visibly present or actually spoken.
  Do not fill a field to be helpful.
- Returning an EMPTY list is a correct, valued answer. A confidently fabricated
  fact is worse than no fact, because every downstream use inherits it and a
  human reading the result cannot tell it was invented.
- "claimsSupported" holds ONLY claims this asset genuinely backs.
  Example: an install photo showing no defect does NOT support the claim
  "Bad print ruined this install" — no defect is visible, so that claim is
  unsupported and must be left out.
- Do NOT write hooks, captions, taglines, headlines or marketing copy of any
  kind. You are recording what is true about this asset. Someone else decides
  what to say about it.
- "confidence" is 0-1 and describes how clearly the EVIDENCE shows the fact,
  never how interesting the fact is.
`.trim();

// ── ASSEMBLE FROM WHAT IS ALREADY STORED (the free path) ────────────────────

interface MomentRow {
  start_time: number | null;
  end_time: number | null;
  speaker: string | null;
  verbatim_quote: string | null;
  visual_description: string | null;
  hook_score: number | null;
  soundbite_score: number | null;
  broll_score: number | null;
  install_stage: string | null;
  vehicles: string[] | null;
  people: string[] | null;
  content_uses: string[] | null;
}

/** An install stage is a real observation; map it to the fact vocabulary. */
function kindForStage(stage: string): FactKind {
  switch (stage) {
    case "prep": case "squeegee": case "trim": case "heat":
      return "demonstration";
    case "peel":
      return "transformation";
    case "reveal": case "drive-by":
      return "result";
    case "detail":
      return "detail";
    case "interview":
      return "statement";
    default:
      return "visual";
  }
}

/**
 * Build the intelligence out of `content_moments` + `media_sources.transcript`.
 *
 * Every field here is derived from a stored row that a real pass produced from
 * the real asset, and every fact's evidence is that row's own quote or
 * timecode. Nothing is inferred beyond what the row says. Duplicate moments are
 * collapsed — the library holds repeat inserts of identical (time, description)
 * pairs, and six copies of one observation would read as six pieces of evidence.
 */
function assembleFromStored(
  moments: MomentRow[],
  transcript: string,
  src: Record<string, unknown> | null,
) {
  const seen = new Set<string>();
  const rows: MomentRow[] = [];
  for (const m of moments) {
    const key = `${Math.round(Number(m.start_time) || 0)}|${(m.visual_description || m.verbatim_quote || "").toLowerCase().trim()}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    rows.push(m);
  }
  rows.sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));

  const facts: Fact[] = [];
  const scenes: Array<Record<string, unknown>> = [];
  const visualEvents: Array<Record<string, unknown>> = [];
  const strongestMoments: Array<Record<string, unknown>> = [];
  const demonstrations: Array<Record<string, unknown>> = [];
  const emotionalMoments: Array<Record<string, unknown>> = [];
  const sourceTimecodes: Array<Record<string, unknown>> = [];
  const speakers = new Set<string>();
  const objects = new Set<string>();
  const stageCounts = new Map<string, string[]>();

  for (const m of rows) {
    const start = Number(m.start_time) || 0;
    const end = Number(m.end_time) || start;
    const at = tc(start);
    const stage = String(m.install_stage || "").toLowerCase();
    const quote = (m.verbatim_quote || "").trim();
    const visual = (m.visual_description || "").trim();
    const broll = Number(m.broll_score) || 0;
    const sound = Number(m.soundbite_score) || 0;

    if (m.speaker) speakers.add(String(m.speaker));
    (m.vehicles || []).forEach((v) => v && objects.add(String(v)));
    (m.people || []).forEach((p) => p && objects.add(String(p)));

    sourceTimecodes.push({ start, end, at, stage: stage || null, has_quote: !!quote, has_visual: !!visual });

    if (visual) {
      visualEvents.push({ at, start, end, description: visual, stage: stage || null, broll_score: broll || null });
      scenes.push({ at, start, end, summary: visual, stage: stage || null });
      if (stage) {
        const list = stageCounts.get(stage) || [];
        list.push(`${at} — "${visual}"`);
        stageCounts.set(stage, list);
      }
      // Only observations a pass rated as genuinely usable become facts; a
      // low-scored frame is a real observation of an empty room, not raw
      // material for anything.
      if (broll >= 5) {
        facts.push({
          text: visual,
          kind: kindForStage(stage),
          evidence: `frame at ${at} — "${visual}" (content_moments, b-roll ${broll}/10)`,
          confidence: Math.min(0.9, 0.5 + broll / 20),
        });
      }
      if (stage === "prep" || stage === "squeegee" || stage === "trim" || stage === "heat" || stage === "peel") {
        demonstrations.push({ at, stage, description: visual });
      }
      if (broll >= 8 || (Number(m.hook_score) || 0) >= 7) {
        strongestMoments.push({ at, start, end, description: visual, stage: stage || null, broll_score: broll || null });
      }
    }

    if (quote) {
      const isStrong = sound >= 6 || quote.length >= 40;
      if (isStrong) {
        facts.push({
          text: quote,
          kind: "statement",
          evidence: `spoken at ${at}${m.speaker ? ` by ${m.speaker}` : ""}: "${quote}"`,
          confidence: sound ? Math.min(0.95, 0.6 + sound / 25) : 0.85,
        });
      }
      if (sound >= 7) {
        emotionalMoments.push({ at, quote, speaker: m.speaker || null, soundbite_score: sound });
        strongestMoments.push({ at, start, end, description: quote, stage: "interview", soundbite_score: sound });
      }
    }
  }

  // Topics are counted, not guessed: "squeegee appears in 12 rated moments" is
  // a measurement of this asset, and it carries the moments as its evidence.
  const semanticTopics = [...stageCounts.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([topic, ev]) => ({ topic, moment_count: ev.length, evidence: ev.slice(0, 3) }));

  // A claim needs repeat evidence. One frame labelled "reveal" is a frame; four
  // of them is something this asset can actually back.
  const claimsSupported: Claim[] = [];
  for (const [stage, ev] of stageCounts) {
    if (ev.length < 2) continue;
    const label: Record<string, string> = {
      squeegee: "This asset shows hands-on squeegee work being performed",
      trim: "This asset shows the vinyl being trimmed by hand",
      heat: "This asset shows heat/torch work on the material",
      peel: "This asset shows material being peeled back on camera",
      prep: "This asset shows the surface being prepped before install",
      reveal: "This asset shows a finished wrap revealed on the vehicle",
      "drive-by": "This asset shows the finished wrapped vehicle in motion",
      detail: "This asset shows close-up detail of the finished work",
      interview: "This asset contains someone speaking on camera",
    };
    const claim = label[stage];
    if (!claim) continue;
    claimsSupported.push({
      claim,
      evidence: ev.slice(0, 4),
      confidence: Math.min(0.95, 0.6 + ev.length / 20),
    });
  }

  (Array.isArray(src?.vehicles) ? src!.vehicles as string[] : []).forEach((v) => v && objects.add(String(v)));
  (Array.isArray(src?.people) ? src!.people as string[] : []).forEach((p) => p && objects.add(String(p)));

  return {
    kind: "video" as const,
    transcript: transcript || "",
    speakers: [...speakers],
    scenes,
    semanticTopics,
    visualEvents,
    strongestMoments: strongestMoments.slice(0, 25),
    demonstrations,
    emotionalMoments,
    objects: [...objects],
    sourceTimecodes,
    hookableFacts: grounded(facts),
    claimsSupported,
  };
}

function factCount(intel: Record<string, unknown> | null): number {
  if (!intel) return 0;
  const f = Array.isArray(intel.hookableFacts) ? intel.hookableFacts.length : 0;
  const c = Array.isArray(intel.claimsSupported) ? intel.claimsSupported.length : 0;
  return f + c;
}

// ── THE MODEL PATH (only behind `analyze: true`) ────────────────────────────

const VIDEO_SCHEMA = `Return ONLY JSON:
{"transcript":"<the transcript you were given, verbatim, or \\"\\" if none>",
 "speakers":["who actually speaks, only if identifiable from the material"],
 "scenes":[{"at":"m:ss","summary":"what this stretch shows"}],
 "semanticTopics":[{"topic":"","evidence":["m:ss or quote"]}],
 "visualEvents":[{"at":"m:ss","description":"what is on screen"}],
 "strongestMoments":[{"at":"m:ss","description":"","why":"what makes it visually or verbally strong"}],
 "demonstrations":[{"at":"m:ss","description":"a process being performed on camera"}],
 "emotionalMoments":[{"at":"m:ss","description":"","evidence":"quote or frame"}],
 "objects":["things clearly visible"],
 "sourceTimecodes":[{"at":"m:ss","note":""}],
 "hookableFacts":[{"text":"","kind":"statement|visual|result|transformation|tension|demonstration|proof|detail|emotion","evidence":"quote, timecode, or described frame","confidence":0-1}],
 "claimsSupported":[{"claim":"","evidence":["quote/timecode"],"confidence":0-1}]}`;

const IMAGE_SCHEMA = `Return ONLY JSON:
{"subjects":["who/what is in the frame"],
 "setting":"where this appears to be, only from what is visible",
 "visibleText":["text you can actually READ in the image, verbatim; omit anything illegible"],
 "actions":["what is being done, if anything"],
 "products":["identifiable products/materials/equipment visible"],
 "visualFacts":[{"text":"","evidence":"the part of the frame that shows it","confidence":0-1}],
 "compositionNotes":"framing, light, orientation — how it would cut",
 "hookableFacts":[{"text":"","kind":"statement|visual|result|transformation|tension|demonstration|proof|detail|emotion","evidence":"described frame region","confidence":0-1}],
 "claimsSupported":[{"claim":"","evidence":["what in the frame supports it"],"confidence":0-1}]}`;

async function callModel(messages: unknown[], key: string) {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { error: `vision ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
  }
  try {
    return { parsed: JSON.parse(data.choices?.[0]?.message?.content || "{}") as Record<string, unknown> };
  } catch {
    return { error: "model returned invalid JSON" };
  }
}

function normalizeVideo(p: Record<string, unknown>, transcript: string) {
  const arr = (k: string) => (Array.isArray(p[k]) ? p[k] as unknown[] : []);
  return {
    kind: "video" as const,
    transcript: transcript || String(p.transcript || ""),
    speakers: arr("speakers").map(String),
    scenes: arr("scenes"),
    semanticTopics: arr("semanticTopics"),
    visualEvents: arr("visualEvents"),
    strongestMoments: arr("strongestMoments"),
    demonstrations: arr("demonstrations"),
    emotionalMoments: arr("emotionalMoments"),
    objects: arr("objects").map(String),
    sourceTimecodes: arr("sourceTimecodes"),
    hookableFacts: grounded(p.hookableFacts),
    claimsSupported: groundedClaims(p.claimsSupported),
  };
}

function normalizeImage(p: Record<string, unknown>) {
  const arr = (k: string) => (Array.isArray(p[k]) ? p[k] as unknown[] : []);
  return {
    kind: "image" as const,
    subjects: arr("subjects").map(String),
    setting: String(p.setting || ""),
    visibleText: arr("visibleText").map(String),
    actions: arr("actions").map(String),
    products: arr("products").map(String),
    visualFacts: arr("visualFacts"),
    compositionNotes: String(p.compositionNotes || ""),
    hookableFacts: grounded(p.hookableFacts),
    claimsSupported: groundedClaims(p.claimsSupported),
  };
}

// ── HANDLER ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth: the service role, or a real signed-in user. verify_jwt is false at
    // the gateway (see config.toml) precisely so a 59-second-old JWT reaches
    // this code instead of being rejected upstream — which means the check has
    // to happen HERE.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "missing Authorization bearer token" }, 401);

    // ── SERVICE-ROLE CHECK BY CAPABILITY, NOT BY STRING EQUALITY ────────────
    //
    // This was `token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, and it
    // rejected the worker on EVERY call — 25 of 25 on the first live run, all
    // `HTTP 401: not authorized`, recorded on the rows. The worker was sending a
    // real service-role credential; string equality still said no.
    //
    // Two ways that happens, and the old check could not tell them apart:
    //   · the project has TWO valid representations of the service credential
    //     (the legacy `service_role` JWT and the newer secret key). The runner
    //     resolves one, the function's env holds the other, both authenticate to
    //     Postgres perfectly, and `!==` is true.
    //   · the env var is simply unset here, in which case `token !== undefined`
    //     is ALSO true and every caller is rejected for a reason the error never
    //     mentions.
    //
    // A secret with more than one valid form cannot be checked by identity. The
    // right question is not "is this the same string" but "can this token act as
    // service role" — so we ask Postgres, with the presented token, against a
    // table RLS closes to anon. That is the definition of the privilege, and it
    // stays correct through any future key rotation.
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let authorized = !!svcKey && token === svcKey;   // fast path, zero cost
    let why = "";

    if (!authorized) {
      // Does this token hold service-role privilege in practice?
      try {
        const asToken = createClient(Deno.env.get("SUPABASE_URL")!, token, {
          auth: { persistSession: false },
        });
        const { error: probeErr } = await asToken
          .from("agent_media_assets").select("id").limit(1);
        if (!probeErr) authorized = true;
      } catch { /* fall through to the user check */ }
    }

    if (!authorized) {
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: userData } = await anon.auth.getUser(token);
      if (userData?.user) authorized = true;
      else why = svcKey
        ? "the token is neither the service key, a credential with service-role privilege, nor a valid user session"
        : "SUPABASE_SERVICE_ROLE_KEY is NOT SET on this function, so no service credential can ever match — check the function's secrets";
    }

    // The reason is returned on purpose. "not authorized" with no cause is what
    // turned a missing env var and a rotated key into the same opaque 401.
    if (!authorized) return json({ ok: false, error: "not authorized", reason: why }, 401);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const assetId = body.asset_id ? String(body.asset_id) : "";
    let storageUrl = body.storage_url ? String(body.storage_url) : "";
    const analyze = body.analyze === true;
    const refresh = body.refresh === true;
    const persist = body.persist !== false;
    const frames = Array.isArray(body.frames) ? body.frames as { time: number; image_base64: string }[] : [];

    if (!assetId && !storageUrl) {
      return json({ ok: false, error: "pass asset_id or storage_url" }, 400);
    }

    const sb = db();
    const notes: string[] = [];

    // ── resolve the asset ────────────────────────────────────────────────────
    const q = sb
      .from("agent_media_assets")
      .select("id, title, asset_type, content_type, storage_url, original_filename, transcript, duration_seconds, visual_tags, tags")
      .limit(1);
    const { data: assetRows, error: assetErr } = assetId
      ? await q.eq("id", assetId)
      : await q.eq("storage_url", storageUrl);
    if (assetErr) return json({ ok: false, error: `asset lookup failed: ${assetErr.message}` }, 500);
    const asset = assetRows?.[0];
    if (!asset) {
      return json({
        ok: false, source: "none", error: "asset not found",
        missing: [assetId ? `agent_media_assets.id = ${assetId}` : `agent_media_assets.storage_url = ${storageUrl}`],
        remedy: "Ingest the file into the Asset Library first (Drive link → video_parse_jobs → media-parser), then call again.",
      }, 404);
    }
    storageUrl = asset.storage_url || storageUrl;

    const isImage = String(asset.asset_type || "").toLowerCase() === "image" ||
      /\.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(storageUrl);
    const kind: "image" | "video" = isImage ? "image" : "video";
    const assetInfo = { id: asset.id, title: asset.title, kind, storage_url: storageUrl || null };

    // ── 0. already computed? cheapest possible answer ────────────────────────
    const existingTags = (asset.visual_tags && typeof asset.visual_tags === "object" && !Array.isArray(asset.visual_tags))
      ? asset.visual_tags as Record<string, unknown>
      : {};
    const stored = existingTags.asset_intelligence as Record<string, unknown> | undefined;
    if (stored && factCount(stored) > 0 && !refresh) {
      return json({
        // Still "existing" — the vocabulary is about where the truth came
        // from, and `cached` says it was already assembled on a prior call.
        ok: true, asset: assetInfo, source: "existing", cached: true, persisted: false,
        intelligence: stored,
        notes: ["Returned the stored asset_intelligence. Pass { refresh: true } to recompute."],
      });
    }

    // ── 1. assemble from what already exists (no spend) ──────────────────────
    let intelligence: Record<string, unknown> | null = null;
    let source: "existing" | "analyzed" | "none" = "none";
    const missing: string[] = [];

    if (kind === "video") {
      // media_sources is joined on storage_url first (445 of 746 library rows
      // match that way), then on filename, then dedupe_key — the parser writes
      // whichever it had.
      let msRow: Record<string, unknown> | null = null;
      if (storageUrl) {
        const { data } = await sb.from("media_sources")
          .select("id, transcript, vehicles, people, brands, filename, storage_url")
          .eq("storage_url", storageUrl).limit(1);
        msRow = data?.[0] || null;
      }
      // Two plain .eq() queries rather than one .or() — a filename containing a
      // comma or parenthesis breaks PostgREST's or() filter syntax, and the
      // library is full of raw camera filenames.
      for (const col of ["filename", "dedupe_key"]) {
        if (msRow || !asset.original_filename) break;
        const { data } = await sb.from("media_sources")
          .select("id, transcript, vehicles, people, brands, filename, storage_url")
          .eq(col, asset.original_filename)
          .limit(1);
        msRow = data?.[0] || null;
      }

      let moments: MomentRow[] = [];
      if (msRow?.id) {
        const { data } = await sb.from("content_moments")
          .select("start_time, end_time, speaker, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, install_stage, vehicles, people, content_uses")
          .eq("source_id", msRow.id)
          .order("start_time", { ascending: true })
          .limit(1500);
        moments = (data || []) as MomentRow[];
      }
      const transcript = String(msRow?.transcript || asset.transcript || "");

      if (moments.length || transcript) {
        const assembled = assembleFromStored(moments, transcript, msRow);
        if (factCount(assembled as unknown as Record<string, unknown>) > 0) {
          intelligence = assembled as unknown as Record<string, unknown>;
          source = "existing";
          notes.push(`Assembled from ${moments.length} stored content_moments${transcript ? " + stored transcript" : ""} — zero AI spend.`);
        } else {
          missing.push("stored moments/transcript exist but yielded no evidenced fact");
        }
      } else {
        if (!msRow) missing.push("no media_sources row joins this asset (storage_url / filename)");
        else {
          if (!transcript) missing.push("media_sources.transcript is empty");
          missing.push("no content_moments rows for this source");
        }
      }
    } else {
      // Images have no moments/transcript infrastructure — there is nothing
      // stored to assemble from, so an image is honestly "none" until analysed.
      missing.push("images have no stored transcript/moments to assemble from");
    }

    // ── 2. only now, and only if explicitly permitted, spend ─────────────────
    if (!intelligence && analyze) {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) {
        return json({
          ok: false, asset: assetInfo, source: "none",
          error: "OPENAI_API_KEY missing", missing: ["OPENAI_API_KEY"],
          remedy: "Set OPENAI_API_KEY on the Supabase project, or call without analyze:true and use stored data.",
        }, 500);
      }

      if (kind === "image") {
        const imageUrl = String(body.image_url || storageUrl || "");
        if (!imageUrl) {
          return json({
            ok: true, asset: assetInfo, source: "none", persisted: false, intelligence: null,
            missing: ["no image URL on the asset"], notes,
            remedy: "Give the asset a storage_url, or pass image_url explicitly.",
          });
        }
        // detail:"high" for a single still — marketing-agent's vision_score uses
        // "low" because it sends dozens of frames per call. Here the whole point
        // is reading what is ACTUALLY in the frame (including legible text), and
        // a low-detail misread becomes a fabricated fact.
        const { parsed, error } = await callModel([
          {
            role: "system",
            content: `You are recording, for a wrap-industry content library, exactly what is in ONE photograph. ${NEVER_INVENT}\n\n${IMAGE_SCHEMA}`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Photograph "${asset.title || asset.original_filename || "image"}". Record only what is visibly present.` },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ], openaiKey);
        if (error) return json({ ok: false, asset: assetInfo, source: "none", error }, 502);
        intelligence = normalizeImage(parsed!) as unknown as Record<string, unknown>;
        source = "analyzed";
        notes.push("Analysed one image with gpt-4o (temperature 0).");
      } else {
        const transcript = String(asset.transcript || body.transcript || "");
        if (!frames.length && !transcript) {
          return json({
            ok: true, asset: assetInfo, source: "none", persisted: false, intelligence: null, notes,
            missing: [...missing, "no sampled frames passed and no transcript available"],
            remedy: "Run the media-parser on this clip (transcript + vision moments), or pass frames:[{time,image_base64}] to analyse directly.",
          });
        }
        const content: unknown[] = [{
          type: "text",
          text: `Video "${asset.title || asset.original_filename || "clip"}".` +
            (transcript ? `\n\nTRANSCRIPT (verbatim — quote from this, never paraphrase into a claim):\n${transcript.slice(0, 12000)}` : "\n\n(no transcript available)") +
            (frames.length ? `\n\n${frames.length} sampled frames follow, each labelled with its timecode.` : "\n\n(no frames available — do NOT describe visuals you were not shown)"),
        }];
        // Frames use detail:"low" — same as the existing vision_score pass; many
        // images per call, and per-frame gist is what a timecode needs.
        for (const f of frames) {
          content.push({ type: "text", text: `Frame at ${tc(f.time)} (${f.time}s):` });
          content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.image_base64}`, detail: "low" } });
        }
        const { parsed, error } = await callModel([
          {
            role: "system",
            content: `You are recording, for a wrap-industry content library, exactly what happens in one video. ${NEVER_INVENT}\n\n${VIDEO_SCHEMA}`,
          },
          { role: "user", content },
        ], openaiKey);
        if (error) return json({ ok: false, asset: assetInfo, source: "none", error }, 502);
        intelligence = normalizeVideo(parsed!, transcript) as unknown as Record<string, unknown>;
        source = "analyzed";
        notes.push(`Analysed with gpt-4o (temperature 0): ${frames.length} frames${transcript ? " + transcript" : ""}.`);
      }
    }

    // ── 3. nothing to say, said honestly ─────────────────────────────────────
    if (!intelligence || factCount(intelligence) === 0) {
      return json({
        ok: true, asset: assetInfo, source: "none", persisted: false, intelligence: null, notes,
        missing: missing.length ? missing : ["no evidenced fact could be established from this asset"],
        remedy: analyze
          ? "The model found nothing it could evidence. That is an honest empty answer — check the asset actually contains what you expect."
          : "Nothing is stored for this asset yet. Re-call with { analyze: true } to pay for a model pass (video also needs frames:[{time,image_base64}] unless a transcript exists).",
      });
    }

    // ── 4. persist — facts only, never a hook ────────────────────────────────
    const provenance = {
      producer: PRODUCER,
      source,
      generated_at: new Date().toISOString(),
      model: source === "analyzed" ? OPENAI_MODEL : null,
      evidence_counts: {
        // Deliberately NOT named "hookable_facts": stripHookFields deletes any
        // key that reads like a hook, including inside provenance, and a
        // silently-dropped counter is a worse lie than no counter.
        facts: Array.isArray(intelligence.hookableFacts) ? intelligence.hookableFacts.length : 0,
        claims: Array.isArray(intelligence.claimsSupported) ? intelligence.claimsSupported.length : 0,
      },
    };
    const payload = stripHookFields({ ...intelligence, provenance });

    let persisted = false;
    if (persist && storageUrl) {
      // Keyed on storage_url (uq_agent_media_assets_storage_url). MERGED, so
      // other writers' keys on visual_tags survive; only asset_intelligence is
      // ours, and it is only replaced when refresh was asked for (an existing
      // non-empty one returned at step 0 otherwise).
      const { error: upErr } = await sb
        .from("agent_media_assets")
        .update({ visual_tags: { ...existingTags, asset_intelligence: payload } })
        .eq("storage_url", storageUrl);
      if (upErr) notes.push(`persist failed: ${upErr.message}`);
      else { persisted = true; notes.push("Persisted to agent_media_assets.visual_tags.asset_intelligence (reusable across every variant)."); }
    } else if (persist && !storageUrl) {
      notes.push("Not persisted: the asset has no storage_url, which is the key visual_tags is written on.");
    }

    return json({
      ok: true,
      asset: assetInfo,
      source,
      cached: false,
      persisted,
      intelligence: payload,
      notes,
    });
  } catch (e) {
    // An unexpected fault is the only thing that lands here; every expected
    // outcome above returns a structured answer instead of throwing.
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
