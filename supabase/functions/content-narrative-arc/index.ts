/**
 * content-narrative-arc — turn one topic into an ordered story, on the spine
 * that already exists.
 *
 * Owner, 2026-08-07: "I want to use our OpenAI API to run fresh hooks, and
 * create narrative based on two things" — FOOTAGE and BRAND PILLARS — where
 * narrative means a multi-piece arc, "extend the existing spine so one idea
 * becomes a sequence, not a one-off."
 *
 * ── IT DOES NOT BUILD A SECOND SPINE ───────────────────────────────────────
 * `content_narratives` + `content_artifacts` already exist and `idea_approve`
 * already writes them. This function writes NOTHING ELSE: a beat is a
 * `content_artifacts` row whose `kind` carries its order (`arc_beat_1`…), whose
 * `target_id` points at the `content_moments` row it came from, and whose
 * `links_to` points back at the beat before it. No arc table. No new producer.
 *
 * It does not even create the narrative — the caller passes `narrative_id`,
 * minted by `src/lib/narrativeService.ts`'s `findOrCreateNarrative`, which is
 * the one place that knows how to open a narrative properly (topic, objective,
 * and the thirteen-kind checklist). Re-implementing that here is exactly the
 * drift this codebase keeps paying for.
 *
 * ── THE CALLER CHOOSES THE FOOTAGE; THIS VERIFIES IT ───────────────────────
 * `src/lib/narrativeArc.ts` does the selection in the browser: it joins the
 * speech and vision moments, ranks them through the EXISTING
 * `hookEngine.rankFacts` against the brand's declared audience interests, and
 * assigns each role the best eligible moment or an honest gap. This function
 * does not trust a word of that. It RE-READS every moment id out of the
 * database and builds each beat's evidence from those rows, so the only truth
 * the model is ever shown is truth this function read for itself.
 *
 * ── COST ───────────────────────────────────────────────────────────────────
 * One OpenAI call per run, capped at five beats, and never a sweep — a run
 * needs an explicit narrative and an explicit beat list. The PRE-SPEND FENCE is
 * `arcFingerprint(brand, topic, momentIds)`, checked BEFORE the call and stored
 * on the `arc_plan` artifact. It has no clock in it, so a retry, a double click
 * or a re-run after a timeout finds the answer already bought instead of buying
 * a second one — the same shape as `already_scored` in marketing-agent and
 * `already_designed` in the video renderer.
 *
 * ── GROUNDING IS ENFORCED HERE, NOT REQUESTED ──────────────────────────────
 * The prompt states the rule ("the footage is the only truth a beat may
 * claim"), and then `beatViolations` checks the model's words back against the
 * corpus this function read. A beat that invents a number, invents a quote,
 * reads an emotion off a still frame, or barely intersects its own clip is NOT
 * SAVED AS A BEAT. It is saved as a gap that names what went wrong. A
 * fabricated beat that looks finished is worse than a missing one, because the
 * missing one tells the crew what to film.
 *
 * Copy model: OpenAI gpt-4o, the same brain as contentdirectoriq-generate.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ARC_ROLES, ARC_ROLE_KEYS, ARC_PLAN_KIND, ARC_PRODUCER, FINGERPRINT_PREFIX,
  MAX_ARC_BEATS, arcFingerprint, arcRole, beatKind, beatViolations,
  fingerprintOf, gapKind,
  type ArcRole,
} from "./arc-roles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** MUST match `formatBeatTitle` in src/lib/narrativeArc.ts — parity-tested. */
function formatBeatTitle(index: number, role: ArcRole, headline: string): string {
  return `${index + 1}. ${role.key} — ${headline}`.slice(0, 300);
}

interface RequestedBeat {
  roleKey: string;
  momentId: string;
  visionMomentId?: string | null;
}

/** A beat after this function has re-read its evidence from the database. */
interface VerifiedBeat {
  index: number;
  role: ArcRole;
  momentId: string;
  clipTitle: string;
  startTime: number;
  endTime: number;
  verbatim: string | null;
  visual: string | null;
  signals: "speech" | "vision" | "both";
  /** Everything this beat is allowed to claim, as one string. */
  corpus: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = sb();

    const narrativeId = String(body.narrative_id || "").trim();
    const refresh = body.refresh === true;
    const dryRun = body.dry_run === true;

    if (!narrativeId) {
      return json({
        error: "narrative_id required",
        note: "This function extends an existing narrative; it never opens one. Mint the narrative with narrativeService.findOrCreateNarrative first — that is the one place that knows the spine's shape.",
      }, 400);
    }

    // ── the narrative is the topic and the brand. Never the caller's word for it.
    const { data: narrative, error: nErr } = await supabase
      .from("content_narratives")
      .select("id, brand, topic, objective, pillar_key")
      .eq("id", narrativeId)
      .maybeSingle();
    if (nErr) return json({ error: nErr.message }, 500);
    if (!narrative) return json({ error: "narrative not found" }, 404);

    const brand = String(narrative.brand || "").trim();
    const topic = String(narrative.topic || "").trim();

    // ── OPT-IN ONLY. No beats, no run. This can never sweep the library.
    const requested: RequestedBeat[] = Array.isArray(body.beats) ? body.beats : [];
    if (!requested.length) {
      return json({
        error: "beats required",
        note: "Pass the beats the planner chose ({roleKey, momentId}). This function never picks footage on its own and never sweeps — a run is always something a person asked for.",
      }, 400);
    }
    if (requested.length > MAX_ARC_BEATS) {
      return json({ error: `at most ${MAX_ARC_BEATS} beats per run` }, 400);
    }

    const seenRoles = new Set<string>();
    for (const b of requested) {
      const role = arcRole(String(b.roleKey || ""));
      if (!role) return json({ error: `unknown role "${b.roleKey}" — roles are: ${ARC_ROLE_KEYS.join(", ")}` }, 400);
      if (seenRoles.has(role.key)) return json({ error: `role "${role.key}" appears twice; each role carries one beat` }, 400);
      seenRoles.add(role.key);
      if (!String(b.momentId || "").trim()) return json({ error: `beat "${role.key}" has no momentId` }, 400);
    }

    // ── PRE-SPEND FENCE ───────────────────────────────────────────────────
    // Computed from the material the model would be asked to write from, with
    // no clock in it, so the same request always lands on the same key.
    const momentIds = requested.map((b) => String(b.momentId));
    const fingerprint = arcFingerprint(brand, topic, momentIds, requested.map((b) => String(b.roleKey)));

    const { data: existingPlan } = await supabase
      .from("content_artifacts")
      .select("id, body, title")
      .eq("narrative_id", narrativeId)
      .eq("kind", ARC_PLAN_KIND)
      .maybeSingle();

    if (existingPlan && fingerprintOf(existingPlan.body) === fingerprint && !refresh) {
      const { data: rows } = await supabase
        .from("content_artifacts")
        .select("id, kind, title, body, target_id, links_to")
        .eq("narrative_id", narrativeId)
        .eq("produced_by", ARC_PRODUCER)
        .order("kind");
      return json({
        action: "narrative_arc",
        narrative_id: narrativeId,
        skipped: "already_arced",
        fingerprint,
        note: "This exact arc — same topic, same footage, same roles — has already been written. Not re-buying the model call. Send { refresh: true } to rewrite it deliberately.",
        beats: (rows || []).filter((r: any) => r.kind.startsWith("arc_beat_")).length,
        gaps: (rows || []).filter((r: any) => r.kind.startsWith("arc_gap_")).length,
        artifacts: rows || [],
      });
    }

    // ── RE-READ THE FOOTAGE. The caller's copy of it is not evidence. ──────
    const allIds = [
      ...momentIds,
      ...requested.map((b) => String(b.visionMomentId || "")).filter(Boolean),
    ];
    const { data: moments, error: mErr } = await supabase
      .from("content_moments")
      .select("id, source_id, start_time, end_time, verbatim_quote, visual_description, install_stage")
      .in("id", allIds);
    if (mErr) return json({ error: mErr.message }, 500);

    const byId = new Map<string, any>((moments || []).map((m: any) => [m.id, m]));
    const missing = allIds.filter((id) => !byId.has(id));
    if (missing.length) {
      return json({ error: `these moment ids are not in content_moments: ${missing.join(", ")}` }, 400);
    }

    const sourceIds = [...new Set((moments || []).map((m: any) => m.source_id))];
    const { data: sources } = await supabase
      .from("media_sources")
      .select("id, title, filename, kind")
      .in("id", sourceIds);
    const sourceById = new Map<string, any>((sources || []).map((s: any) => [s.id, s]));

    // MUSIC IS NOT FOOTAGE. Measured 2026-08-07: 106 media_sources rows are
    // kind='music' and they carry 738 transcribed "quotes" — which are SONG
    // LYRICS from the house track library. They score highest of anything in
    // content_moments (hook_score 10 on "We don't just wrap vehicles, we wrap
    // dreams"), so a naive top-scoring pull builds an entire arc out of lyrics
    // and presents them as things people said. Refused here, at the point the
    // evidence is read, so no caller can route around it.
    const lyric = (moments || []).filter((m: any) => sourceById.get(m.source_id)?.kind === "music");
    if (lyric.length) {
      return json({
        error: "some of these moments are song lyrics, not footage",
        note: "media_sources.kind='music' rows are transcribed house tracks. They cannot ground a claim — nobody said them.",
        moment_ids: lyric.map((m: any) => m.id),
      }, 400);
    }

    const verified: VerifiedBeat[] = requested.map((b, i) => {
      const role = arcRole(String(b.roleKey))!;
      const speech = byId.get(String(b.momentId));
      const vision = b.visionMomentId ? byId.get(String(b.visionMomentId)) : null;
      const src = sourceById.get(speech.source_id);
      const verbatim = String(speech.verbatim_quote || "").trim() || null;
      const visual =
        String(vision?.visual_description || speech.visual_description || "").trim() || null;
      const signals: VerifiedBeat["signals"] = verbatim && visual ? "both" : verbatim ? "speech" : "vision";
      return {
        index: i,
        role,
        momentId: speech.id,
        clipTitle: String(src?.title || src?.filename || "untitled clip"),
        startTime: Number(speech.start_time) || 0,
        endTime: Number(speech.end_time) || 0,
        verbatim,
        visual,
        signals,
        corpus: [verbatim, visual].filter(Boolean).join("\n"),
      };
    });

    const unusable = verified.filter((v) => !v.corpus.trim());
    if (unusable.length) {
      return json({
        error: "some beats have no evidence at all",
        note: "A moment with neither a verbatim quote nor a visual description cannot ground anything.",
        roles: unusable.map((v) => v.role.key),
      }, 400);
    }

    // Signal check, stated rather than silently tolerated: a role that needs a
    // picture must have one. The planner enforces this too; this is the copy
    // that runs on the write path.
    const wrongSignal = verified.filter((v) =>
      (v.role.needs === "vision" && v.signals === "speech") ||
      (v.role.needs === "speech" && v.signals === "vision"));
    if (wrongSignal.length) {
      return json({
        error: "some beats were given footage of the wrong kind",
        detail: wrongSignal.map((v) => `${v.role.key} needs ${v.role.needs}, its moment is ${v.signals}-only`),
      }, 400);
    }

    // ── BRAND PILLARS — the second input, read from the database ───────────
    const { data: pillars } = await supabase
      .from("brand_pillars")
      .select("key, title, name, description, summary, evidence_guidance, sort_order")
      .eq("brand", brand)
      .eq("active", true)
      .order("sort_order");

    const pillarLines = (pillars || []).map((p: any) =>
      `  · ${p.title || p.name || p.key}${p.description || p.summary ? ` — ${String(p.description || p.summary).slice(0, 220)}` : ""}`);

    const gapsRequested: Array<{ roleKey: string; why: string }> = Array.isArray(body.gaps) ? body.gaps : [];
    const gapRoles = gapsRequested
      .map((g) => ({ role: arcRole(String(g.roleKey || "")), why: String(g.why || "").trim() }))
      .filter((g): g is { role: ArcRole; why: string } => !!g.role && !seenRoles.has(g.role.key));

    const prompt = buildPrompt({ brand, topic, pillarLines, verified, gapRoles });

    if (dryRun) {
      return json({
        action: "narrative_arc", narrative_id: narrativeId, dry_run: true,
        fingerprint, beats: verified.length, gaps: gapRoles.length, prompt,
      });
    }

    // ── THE ONE SPEND ─────────────────────────────────────────────────────
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a documentary story editor for a vehicle-wrap media company. You write a SEQUENCE: each beat builds on the one before and the last closes what the first opened. " +
              "The footage is the only truth a beat may claim. You may phrase, compress and angle it. You may NOT introduce a fact, number, name, capability or customer outcome the footage did not contain. " +
              "If a beat's evidence is thin, write less — never fill the space with something you cannot point at. Return JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `OpenAI ${res.status}`, detail: detail.slice(0, 500) }, 502);
    }

    const payload = await res.json();
    let written: Array<{ roleKey: string; headline: string; body: string }> = [];
    try {
      const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
      written = Array.isArray(parsed?.beats) ? parsed.beats : [];
    } catch {
      return json({ error: "the model did not return usable JSON" }, 502);
    }
    const writtenByRole = new Map(written.map((w) => [String(w.roleKey || ""), w]));

    // ── GROUNDING GATE ────────────────────────────────────────────────────
    // Checked per beat against ITS OWN clip, not the whole topic's footage —
    // a beat grounded in a different clip's transcript is exactly the kind of
    // plausible drift this is here to catch.
    const beatRows: any[] = [];
    const gapRows: any[] = [];
    const rejected: Array<{ role: string; violations: string[] }> = [];

    for (const v of verified) {
      const w = writtenByRole.get(v.role.key);
      const headline = String(w?.headline || "").trim();
      const bodyText = String(w?.body || "").trim();

      if (!headline || !bodyText) {
        rejected.push({ role: v.role.key, violations: ["the model returned nothing for this beat"] });
        gapRows.push(gapRow(narrativeId, v.role, "The model returned no copy for this beat.", v));
        continue;
      }

      const violations = beatViolations(`${headline}\n${bodyText}`, v.corpus, {
        signals: v.signals,
        visual: v.visual,
      });
      if (violations.length) {
        rejected.push({ role: v.role.key, violations });
        gapRows.push(gapRow(
          narrativeId,
          v.role,
          `A beat was written for this role and REFUSED because it is not supported by its footage: ${violations.join(" ")}`,
          v,
        ));
        continue;
      }

      const evidence = `${v.clipTitle} @ ${timecode(v.startTime)}–${timecode(v.endTime)}`;
      beatRows.push({
        narrative_id: narrativeId,
        kind: beatKind(beatRows.length),
        title: formatBeatTitle(beatRows.length, v.role, headline),
        body: [
          bodyText,
          "",
          `Role: ${v.role.label} — ${v.role.job}`,
          `Channel: ${v.role.channel} · Day ${v.role.dayOffset} of the arc`,
          `Evidence (${v.signals}): ${evidence}`,
          v.verbatim ? `What was said: "${v.verbatim}"` : "",
          v.visual ? `What is on screen: ${v.visual}` : "",
          `Moment: ${v.momentId}`,
        ].filter(Boolean).join("\n"),
        status: "planned",
        target_table: "content_moments",
        target_id: v.momentId,
        links_to: [],
        produced_by: ARC_PRODUCER,
      });
    }

    for (const g of gapRoles) {
      gapRows.push(gapRow(narrativeId, g.role, g.why || "No footage in this topic can carry this beat.", null));
    }

    // ── WRITE, upserting on (narrative_id, kind) ──────────────────────────
    // The unique index makes a re-run replace the same five rows instead of
    // stacking a second arc under the same narrative.
    const saved: Array<{ kind: string; id: string }> = [];
    let previousId: string | null = null;

    for (const row of beatRows) {
      // The chain: each beat points back at the one before it, which is what
      // makes this a sequence rather than a pile of simultaneous drafts.
      row.links_to = previousId ? [previousId] : [];
      const { data, error } = await supabase
        .from("content_artifacts")
        .upsert(row, { onConflict: "narrative_id,kind" })
        .select("id, kind")
        .single();
      if (error) return json({ error: `saving ${row.kind}: ${error.message}` }, 500);
      previousId = data.id;
      saved.push({ kind: data.kind, id: data.id });
    }

    for (const row of gapRows) {
      const { data, error } = await supabase
        .from("content_artifacts")
        .upsert(row, { onConflict: "narrative_id,kind" })
        .select("id, kind")
        .single();
      if (error) return json({ error: `saving ${row.kind}: ${error.message}` }, 500);
      saved.push({ kind: data.kind, id: data.id });
    }

    const total = beatRows.length + gapRows.length;
    const shortfall = gapRows.length === 0
      ? `All ${total} beats are carried by real footage. Nothing in this arc was invented.`
      : `INCOMPLETE — ${beatRows.length} of ${total} beats are real; ${gapRows.length} could not be filled and were NOT invented.`;

    const signalCounts = { speech: 0, vision: 0, both: 0 } as Record<string, number>;
    for (const v of verified) signalCounts[v.signals]++;

    const planRow = {
      narrative_id: narrativeId,
      kind: ARC_PLAN_KIND,
      title: `Arc — ${topic}`.slice(0, 300),
      body: [
        shortfall,
        "",
        `Beats: ${beatRows.length} of ${total}`,
        `Evidence mix: ${signalCounts.both} beat(s) backed by BOTH a line and a shot, ${signalCounts.speech} by speech only, ${signalCounts.vision} by vision only.`,
        `Order: ${beatRows.map((r: any) => r.title).join(" → ") || "—"}`,
        gapRows.length ? `FILM: ${gapRows.map((r: any) => r.title.replace(/^gap — /, "")).join(" · ")}` : "",
        "",
        `${FINGERPRINT_PREFIX} ${fingerprint}`,
      ].filter(Boolean).join("\n"),
      status: "planned",
      target_table: null,
      target_id: null,
      links_to: previousId ? [previousId] : [],
      produced_by: ARC_PRODUCER,
    };
    const { error: pErr } = await supabase
      .from("content_artifacts")
      .upsert(planRow, { onConflict: "narrative_id,kind" });
    if (pErr) return json({ error: `saving the arc plan: ${pErr.message}` }, 500);

    // ── RECONCILE: a rewrite must not leave the old arc lying beside the new
    //
    // Upsert alone only ever ADDS. Live-caught on the third real run: the first
    // attempt refused the "open" beat and wrote `arc_gap_open`; the rerun
    // grounded it and wrote `arc_beat_1` — and the stale gap row survived, so
    // the same role appeared as BOTH a finished beat and a missing shot. A
    // board showing a role twice, once as done and once as a gap to film, is
    // worse than either state alone, because a reviewer cannot tell which is
    // current and the shot list asks for footage that already exists.
    //
    // Scoped hard to this narrative's own arc rows (`produced_by`), so it can
    // never touch the blog/email/social artifacts the spine cron owns.
    const keep = [planRow.kind, ...beatRows.map((r: any) => r.kind), ...gapRows.map((r: any) => r.kind)];
    const { data: stale } = await supabase
      .from("content_artifacts")
      .select("id, kind")
      .eq("narrative_id", narrativeId)
      .eq("produced_by", ARC_PRODUCER)
      .not("kind", "in", `(${keep.join(",")})`);
    if (stale?.length) {
      await supabase.from("content_artifacts").delete().in("id", stale.map((r: any) => r.id));
    }

    return json({
      action: "narrative_arc",
      narrative_id: narrativeId,
      brand, topic,
      fingerprint,
      beats: beatRows.length,
      gaps: gapRows.length,
      complete: gapRows.length === 0,
      shortfall,
      rejected,
      signal_mix: signalCounts,
      pillars_used: pillarLines.length,
      saved,
      removed_stale: (stale || []).map((r: any) => r.kind),
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function gapRow(narrativeId: string, role: ArcRole, why: string, v: VerifiedBeat | null) {
  return {
    narrative_id: narrativeId,
    kind: gapKind(role.key),
    title: `gap — ${role.label}`,
    body: [
      "THIS BEAT HAS NO USABLE FOOTAGE. It was left empty on purpose rather than written from nothing.",
      "",
      `Role: ${role.label} — ${role.job}`,
      `Why: ${why}`,
      v ? `The clip it was attempted from: ${v.clipTitle} @ ${timecode(v.startTime)}–${timecode(v.endTime)}` : "",
      `FILM THIS: ${role.missingShot}`,
    ].filter(Boolean).join("\n"),
    status: "planned",
    target_table: null,
    target_id: null,
    links_to: [],
    produced_by: ARC_PRODUCER,
  };
}

function buildPrompt(args: {
  brand: string;
  topic: string;
  pillarLines: string[];
  verified: VerifiedBeat[];
  gapRoles: Array<{ role: ArcRole; why: string }>;
}): string {
  const { brand, topic, pillarLines, verified, gapRoles } = args;
  const lines: string[] = [
    `TOPIC: ${topic}`,
    `BRAND: ${brand}`,
    "",
    pillarLines.length
      ? "BRAND PILLARS — the argument these beats advance. They shape the ANGLE. They are NOT facts and nothing in them may be stated as one:"
      : "BRAND PILLARS: none recorded for this brand. Write from the footage alone.",
    ...pillarLines,
    "",
    "THE ARC. Write ONE beat per role, in this order. Each beat builds on the one before it; the last closes what the first opened.",
    "",
  ];

  for (const v of verified) {
    lines.push(
      `BEAT ${v.index + 1} — ${v.role.key.toUpperCase()} (${v.role.label}), for ${v.role.channel}, day ${v.role.dayOffset}`,
      `  Its job: ${v.role.job}`,
      `  THE ONLY TRUTH THIS BEAT MAY CLAIM — ${v.clipTitle} @ ${timecode(v.startTime)}–${timecode(v.endTime)} [${v.signals}]:`,
      v.verbatim ? `    SAID: "${v.verbatim}"` : "    SAID: nothing — this moment is silent.",
      v.visual ? `    SHOWN: ${v.visual}` : "    SHOWN: no frame description for this moment.",
      "",
    );
  }

  if (gapRoles.length) {
    lines.push(
      "GAPS — these roles have NO footage. Do NOT write them. They are recorded as shots to film:",
      ...gapRoles.map((g) => `  · ${g.role.label}: ${g.why}`),
      "",
    );
  }

  lines.push(
    "RULES:",
    "1. The footage above is the only truth a beat may claim. Phrase it, compress it, angle it — never add a fact, number, name, capability or customer outcome the evidence does not contain.",
    "2. A beat whose evidence is SHOWN only may describe what is on screen. It may not assert what anyone felt, what anything cost, or how long it took — a picture cannot prove those.",
    "3. Do not put anything in quotation marks unless those exact words appear in SAID.",
    "4. Write only the beats listed. Never invent a beat to fill a gap.",
    // LENGTH FOLLOWS EVIDENCE. A flat "2-4 sentences" instruction is an order
    // to pad: live-caught on the first real run, a beat whose whole evidence
    // was the seven-word frame caption "Applying wrap with a squeegee on a car
    // panel" came back as four sentences, only 13% of whose words appeared in
    // the footage — correctly refused, but the prompt had asked for it. The
    // budget is now tied to what the moment actually contains.
    "5. Headline: at most 12 words. Body length follows the EVIDENCE, not a quota — one sentence when the evidence is a single short line, up to four only when the moment genuinely carries that much. Writing less is always allowed; padding is not.",
    `6. Return JSON: {"beats":[{"roleKey":"…","headline":"…","body":"…"}]} with exactly ${verified.length} entries. roleKey must be one of: ${verified.map((v) => v.role.key).join(", ")}.`,
  );

  return lines.join("\n");
}
