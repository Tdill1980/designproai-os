/**
 * approvepro-autogen-design — Phase 2: auto-generate a wrap design for a WPW
 * Custom Vehicle Wrap Design order.
 *
 * THIS FUNCTION DOES NOT OWN A DESIGN PIPELINE. It is the ApprovePro ADAPTER
 * onto the shared server-side OS:
 *
 *   _shared/approvepro-inbox.ts  → the design mailbox (Outlook via the Azure
 *                                  Graph app) — read the customer's follow-up
 *                                  email + attachments BEFORE designing.
 *   _shared/designpro-os.ts      → the sanctioned DesignPro / RecreatePro design
 *                                  pipeline (native A.C.E. hero → cloned views →
 *                                  generate-2d-proof, which emits the artboards).
 *
 * Pipeline:
 *   0) INBOX — pull the order's email from design@weprintwraps.com so promised
 *      mockups / logos / instructions are on the order before anything renders.
 *   1) ROUTE — uploads present ⇒ RecreatePro (reproduce THEIR artwork);
 *      text brief only ⇒ DesignPro (design from the brief).
 *   2) DESIGN — designpro-os runs the native hero pass, then clones it to every
 *      canonical angle. There is NO pre-design artboard and NO artboard
 *      projection here — DesignPro deleted that on 2026-07-24 and ApprovePro's
 *      private copy of it was why these orders came out soft/re-interpreted (and
 *      why recreate orders shipped a REDRAWN version of the customer's art).
 *   3) 2D PRODUCTION PROOF — generate-2d-proof with GENIE dims, for every order.
 *      It is also the only producer of the branded + clean artboards, which it
 *      persists on the CANONICAL DesignIQ row (hence the back-link below).
 *   4) CANONICAL LINKAGE — the color_visualizations row carries
 *      admin_notes.designiq_generation_id, so Build Assets / PanelPro / the DID
 *      resolve an ApprovePro design exactly like a DesignPro one.
 *
 * SAFETY: the proof STAYS draft. Nothing is auto-sent. Failures are non-fatal.
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyIntake, briefIsMeaningful, briefExpectsAttachment, isCutContourFileOutputOrder } from "../_shared/approvepro-brief.ts";
import { runProofRevision } from "../_shared/proof-ai-revise.ts";
import { pullDesignInboxContext } from "../_shared/approvepro-inbox.ts";
import {
  linkCanonicalDesign,
  resolveGenieDims,
  routeDesignJob,
  runDesignJob,
  runTwoDProof,
} from "../_shared/designpro-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AutogenRequest {
  proof_id: string;
  /** EXPLICIT start-over. Only when true may we rebuild a brand-new design from
   *  the brief on a proof that already has an approved design. Default false =
   *  an existing design is NEVER replaced from scratch (revisions are surgical). */
  force?: boolean;
}

async function mintAgentSession(supabaseUrl: string, serviceRoleKey: string, anonKey: string): Promise<string | null> {
  try {
    const agentEmail = Deno.env.get("ACE_AGENT_EMAIL") || "ace-agent@weprintwraps.com";
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    try { await admin.auth.admin.createUser({ email: agentEmail, email_confirm: true }); } catch (_) { /* exists */ }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: agentEmail });
    if (linkErr) { console.warn("mintAgentSession: generateLink", linkErr.message); return null; }
    const otp = (link as any)?.properties?.email_otp;
    if (!otp) { console.warn("mintAgentSession: no email_otp"); return null; }
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let { data: sess, error: vErr } = await anon.auth.verifyOtp({ email: agentEmail, token: otp, type: "email" as any });
    if (vErr || !sess?.session) {
      const retry = await anon.auth.verifyOtp({ email: agentEmail, token: otp, type: "magiclink" as any });
      sess = retry.data; vErr = retry.error;
    }
    if (vErr) { console.warn("mintAgentSession: verifyOtp", vErr.message); return null; }
    return sess?.session?.access_token || null;
  } catch (e) {
    console.warn("mintAgentSession: error", (e as any)?.message || e);
    return null;
  }
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization");

  let body: AutogenRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.proof_id) {
    return jsonResponse({ error: "proof_id required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: proof, error: fetchErr } = await db
    .from("proof_approvals")
    .select("*")
    .eq("id", body.proof_id)
    .single();
  if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

  const meta = (proof.metadata as any) || {};

  // CUT-CONTOUR / FILE-OUTPUT GATE — runs BEFORE the running/done short-circuit so
  // even an order A.C.E already slopped gets reclassified and NEVER regenerates.
  // The customer supplied their own finished artwork (preview + vector source);
  // this is a production cut-contour file-output job, not a creative design.
  // A.C.E must not invent a wrap here (order #35165 became a fake blue-wave van).
  // We mark the route so the workbench surfaces the customer's files + the Cut
  // Contour tool instead of the generated artboard.
  if (isCutContourFileOutputOrder(meta)) {
    await db
      .from("proof_approvals")
      .update({
        metadata: {
          ...meta,
          autogen_status: "cut_contour_file_output",
          design_route: "cut_contour",
        },
      })
      .eq("id", proof.id);
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "agent_go",
      actor_role: "system",
      payload: {
        decision: "cut_contour_file_output_skip_ace",
        reason: "customer provided finished artwork; cut-contour print output only — no creative generation",
      },
    });
    return jsonResponse({ ok: true, route: "cut_contour_file_output", skipped: "ace_creative_generation" });
  }

  if (meta.autogen_status === "running") {
    return jsonResponse({ ok: true, already: "running" });
  }

  // ════════════════════════════════════════════════════════════════════════
  // SAFETY GUARD (architecture) — A revision NEVER rebuilds a random new design.
  //
  // Once this proof has a real design, a "revision" is a SURGICAL image-to-image
  // edit (the SAME engine DesignPro / RecreatePro use: runProofRevision keeps the
  // approved wrap, the vehicle, the camera, and every unmentioned element — it
  // only applies what was asked). A full from-scratch rebuild off the order brief
  // happens ONLY for the FIRST design, or when the caller EXPLICITLY starts over
  // (force:true). This is the permanent fix for "a small edit swapped my trailer
  // for a random car": the from-scratch path can no longer touch an existing
  // design, no matter what cleared the status flag.
  // ════════════════════════════════════════════════════════════════════════
  if (!body.force) {
    const { data: activeVer } = await db
      .from("proof_versions")
      .select("id, version_number, render_urls")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    const ru = (activeVer?.render_urls as Record<string, string>) || {};
    const firstImg = ru.hero || ru.side || ru.roof || Object.values(ru).find((v) => typeof v === "string" && /^https?:/.test(v)) || null;

    if (activeVer && firstImg) {
      const changeReq =
        (proof.change_request && String(proof.change_request).trim()) ||
        ((meta as any).manual_prompt && String((meta as any).manual_prompt).trim()) ||
        "";

      if (!changeReq) {
        // A design already exists and nothing was asked to change → preserve it.
        // The old behavior here rebuilt from scratch and destroyed the design.
        return jsonResponse({
          ok: true,
          skipped: "design_exists_preserved",
          note: "Existing design kept. Use the editor for changes, or pass force:true to start over.",
        });
      }

      // SURGICAL REVISION — edit every on-vehicle view of the EXISTING design
      // with the requested change (artboard/proof/dimension assets are carried
      // forward untouched). Background job; saves a new active version.
      const runEdit = async () => {
        try {
          const NON_VIEW = new Set([
            "master_artboard", "production_artboard", "artboard", "flat_artboard",
            "production_proof", "proof_2d", "panel_dimensions",
          ]);
          const viewEntries = Object.entries(ru).filter(
            ([k, v]) => !NON_VIEW.has(k) && typeof v === "string" && /^https?:/.test(v),
          );
          const uniqueUrls = Array.from(new Set(viewEntries.map(([, v]) => v)));
          const vehicleSummary = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ");

          // USE THE CUSTOMER'S UPLOADED LOGOS — when the change asks to add /
          // use logos / graphics / sponsors (and files are actually on the
          // order), feed those uploads to the editor so it places the REAL
          // artwork instead of inventing a look-alike. Skipped for removals.
          const uploads: string[] = Array.isArray((meta as any).customer_uploads) ? (meta as any).customer_uploads : [];
          const asksForGraphics = /\b(logos?|sponsors?|decals?|graphics?|badges?|emblems?|wordmarks?|uploaded|attached)\b/i.test(changeReq);
          const isRemoval = /\b(remove|delete|take off|get rid|without|no logo)\b/i.test(changeReq);
          const placeGraphics = asksForGraphics && !isRemoval && uploads.length > 0;
          if (placeGraphics) console.log(`autogen guard: placing ${uploads.length} uploaded graphic(s) per request`);

          const editedMap = new Map<string, string>();
          await Promise.all(uniqueUrls.map(async (origUrl) => {
            const result = await runProofRevision({
              originalImageUrl: origUrl,
              customerPrompt: changeReq,
              vehicleSummary,
              finishType: (proof as any).finish_type || undefined,
              referenceImageUrls: placeGraphics ? uploads : undefined,
              placeAttachedGraphics: placeGraphics || undefined,
            });
            if (!result.ok) { console.warn(`autogen guard: revise view failed (${result.reason})`); return; }
            const newPath = `renders/proof-ai/${proof.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
            const { error: upErr } = await db.storage.from("wrap-files").upload(newPath, result.pngBytes, { contentType: result.mimeType, upsert: false });
            if (upErr) { console.warn("autogen guard: upload failed:", upErr.message); return; }
            const { data: pub } = db.storage.from("wrap-files").getPublicUrl(newPath);
            if (pub?.publicUrl) editedMap.set(origUrl, pub.publicUrl);
          }));

          if (editedMap.size === 0) {
            // Nothing edited (Gemini hiccup) → keep the approved design as-is.
            console.warn("autogen guard: surgical revision produced no images — design preserved");
            return;
          }

          const mergedUrls: Record<string, string> = { ...ru };
          for (const [k, v] of viewEntries) if (editedMap.has(v)) mergedUrls[k] = editedMap.get(v)!;

          const { data: maxRow } = await db.from("proof_versions")
            .select("version_number").eq("proof_id", proof.id)
            .order("version_number", { ascending: false }).limit(1).maybeSingle();
          const nextVer = (maxRow?.version_number ?? 0) + 1;
          await db.from("proof_versions").update({ is_active: false }).eq("proof_id", proof.id).eq("is_active", true);
          const { data: newVer } = await db.from("proof_versions").insert({
            proof_id: proof.id, version_number: nextVer, created_by_role: "system_upload", created_by_user_id: null,
            render_urls: mergedUrls, uploaded_file_paths: [], prompt_text: changeReq.slice(0, 1500), is_active: true,
          }).select("id").maybeSingle();
          if (newVer) {
            await db.from("proof_events").insert({
              proof_id: proof.id, event_type: "version_saved", actor_role: "system",
              payload: { source: "autogen_surgical_revision", engine: "edit_existing", version_number: nextVer, views_edited: editedMap.size, change_request: changeReq.slice(0, 300) },
            });
          }
          console.log(`autogen guard: surgical revision saved v${nextVer} (${editedMap.size} views edited, design preserved)`);

          // Regenerate the 2D PRODUCTION PROOF from the freshly edited views so
          // the version carries an up-to-date dimensioned proof — parity with the
          // from-scratch path (the shop expects "all sides + 2D proof", not just
          // edited angle renders). Non-fatal: a proof hiccup never loses the edit.
          try {
            await fetch(`${supabaseUrl}/functions/v1/approvepro-version-proof`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
              body: JSON.stringify({ proof_id: proof.id, revisionNote: changeReq.slice(0, 300) }),
            });
            console.log("autogen guard: 2D production proof regenerated after surgical edit");
          } catch (e) {
            console.warn("autogen guard: 2D proof regen (non-fatal):", (e as any)?.message || e);
          }
        } catch (e) {
          console.warn("autogen guard: surgical revision threw (design preserved):", (e as any)?.message || e);
        } finally {
          // ALWAYS resolve the progress flag + consume the one-shot instruction so
          // the workbench progress wizard clears and a later GO with no new ask is
          // a clean no-op (not a re-run of the same edit).
          try {
            const { data: paNow } = await db.from("proof_approvals").select("metadata").eq("id", proof.id).maybeSingle();
            const mdNow: any = (paNow?.metadata as any) || meta;
            const cleared: any = { ...mdNow, autogen_status: "done" };
            delete cleared.autogen_started_at;
            delete cleared.manual_prompt;
            await db.from("proof_approvals").update({ metadata: cleared }).eq("id", proof.id);
          } catch (e) {
            console.warn("autogen guard: status cleanup (non-fatal):", (e as any)?.message || e);
          }
        }
      };
      // Flip the order to "running" BEFORE the background edit kicks off so the
      // workbench progress wizard appears immediately and the poller keeps it up
      // until the new version lands.
      await db.from("proof_approvals").update({
        metadata: { ...meta, autogen_status: "running", autogen_started_at: new Date().toISOString() },
      }).eq("id", proof.id);
      (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(runEdit()) : runEdit();
      return jsonResponse({ ok: true, mode: "surgical_revision", status: "running" }, 202);
    }
  }
  // No existing design (FIRST design) OR force:true (explicit start-over) →
  // full from-scratch generation below (DesignPro through ApprovePro).

  await db
    .from("proof_approvals")
    .update({ metadata: { ...meta, autogen_status: "running" } })
    .eq("id", proof.id);

  const run = async () => {
    try {
      let intake = classifyIntake(meta);

      // ── 0) THE DESIGN MAILBOX (Outlook via the Azure Graph app) ───────────
      // Customers order first and EMAIL the real material second ("I will send a
      // follow up email with some basic mockup images and their current Logo").
      // Read design@weprintwraps.com BEFORE designing whenever the order is
      // missing a brief OR missing artwork — not only when the brief is empty.
      // Without this the promised mockups/logo never reach A.C.E. and the order
      // gets an invented wrap (#35635). intake-graph-poll dedupes by Graph
      // message id, so a re-run on an already-read order costs two queries and
      // changes nothing.
      let uploads: string[] = Array.isArray(meta.customer_uploads) ? meta.customer_uploads : [];
      const briefPromisesFiles = briefExpectsAttachment(
        [meta.line_item_brief, meta.customer_note, meta.order_customer_note].filter(Boolean).join("\n"),
      );
      if (!intake.hasBrief || uploads.length === 0 || briefPromisesFiles) {
        const pull = await pullDesignInboxContext({
          db, supabaseUrl, serviceRoleKey, proofId: proof.id, meta,
          log: (m) => console.log(`autogen: ${m}`),
        });
        if (pull.pulled) {
          Object.assign(meta, pull.meta);
          uploads = pull.uploads;
          intake = classifyIntake(meta);
          if (pull.folded > 0 || pull.gained > 0) {
            await db.from("proof_events").insert({
              proof_id: proof.id, event_type: "agent_go", actor_role: "system",
              payload: {
                decision: "design_inbox_pulled",
                mailbox: "design@weprintwraps.com",
                messages_folded: pull.folded,
                attachments_gained: pull.gained,
              },
            });
          }
        }
      }

      // ADMIN MANUAL INPUT never blocks generation: if the team typed a prompt or
      // adjustment in the panel (change_request / manual_prompt), treat it as a
      // valid brief so we proceed — and (below) those words feed the Artboard Pass
      // as design rules instead of getting dropped.
      const adminInput = (proof.change_request && String(proof.change_request).trim())
        || ((meta as any).manual_prompt && String((meta as any).manual_prompt).trim())
        || "";
      if (!intake.hasBrief && adminInput) intake = { ...intake, hasBrief: true };

      if (!intake.hasBrief) {
        try {
          const woo = meta.wpw_woo_order_id || meta.wpw_order_number || meta.woo_order_id || meta.woo_order_number;
          await fetch(`${supabaseUrl}/functions/v1/request-order-instructions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
            body: JSON.stringify({
              to: proof.customer_email,
              customerName: proof.customer_name || undefined,
              orderNumber: meta.wpw_order_number || meta.wpw_woo_order_id || undefined,
              vehicle: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ") || undefined,
              isWpw: meta.auto_ingested === "wpw",
              kind: "request",
              wooOrderId: woo,
            }),
          });
        } catch (e) {
          console.warn("autogen: request-info failed (non-fatal):", e);
        }
        await db.from("proof_approvals").update({
          metadata: { ...meta, autogen_status: "needs_brief" },
        }).eq("id", proof.id);
        await db.from("proof_events").insert({
          proof_id: proof.id, event_type: "agent_go", actor_role: "system",
          payload: { decision: "requested_info_no_brief", to: proof.customer_email },
        });
        return;
      }

      const parts: string[] = [];
      for (const t of [meta.order_customer_note, meta.line_item_brief, meta.customer_note]) {
        if (briefIsMeaningful(t)) {
          const s = String(t).trim();
          if (!parts.some((p) => p.includes(s) || s.includes(p))) parts.push(s);
        }
      }
      const briefText = parts.join("\n\n").slice(0, 1500);
      const brief = briefText ||
        "Recreate the attached reference design on the vehicle, faithful to the artwork — same colors, layout, and graphics.";
      // AUTO-ASK FOR THE MISSING REFERENCE — the customer described a reference
      // image / attachment they meant to provide ("copy the exact reference
      // image", "design I found online", "I'll email the logo") but uploaded
      // NOTHING and step 0 found nothing in the design mailbox either. Fire the
      // portal/info-request email so they can add it, instead of silently
      // designing off a reference that was never sent.
      // Non-blocking: stamp it once and still design a best-effort draft below —
      // flagged `design_pending_promised_files` so the workbench can show that
      // this draft was built WITHOUT material the customer said was coming.
      if (uploads.length === 0 && briefExpectsAttachment(brief) && !meta.ref_request_sent && !meta.instructions_requested_at) {
        try {
          const woo = meta.wpw_woo_order_id || meta.wpw_order_number || meta.woo_order_id || meta.woo_order_number;
          await fetch(`${supabaseUrl}/functions/v1/request-order-instructions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
            body: JSON.stringify({
              to: proof.customer_email,
              customerName: proof.customer_name || undefined,
              orderNumber: meta.wpw_order_number || meta.wpw_woo_order_id || undefined,
              vehicle: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ") || undefined,
              isWpw: meta.auto_ingested === "wpw",
              kind: "request",
              wooOrderId: woo,
              force: true,
            }),
          });
          (meta as any).ref_request_sent = true;
          (meta as any).design_pending_promised_files = true;
          await db.from("proof_approvals").update({
            metadata: { ...meta, ref_request_sent: true, design_pending_promised_files: true },
          }).eq("id", proof.id);
          await db.from("proof_events").insert({
            proof_id: proof.id, event_type: "agent_go", actor_role: "system",
            payload: {
              decision: "auto_requested_missing_reference",
              to: proof.customer_email,
              note: "design mailbox searched first — no matching email/attachment found",
            },
          });
          console.log("autogen: auto-requested missing reference image (brief referenced one, none uploaded, none in the design mailbox)");
        } catch (e) {
          console.warn("autogen: auto ref-request (non-fatal):", (e as any)?.message || e);
        }
      }

      // INTAKE BRAIN — read the WHOLE order (prose + uploaded screenshots /
      // annotated photos) and let it decide DesignPro-vs-RecreatePro routing and
      // the concrete edit list, instead of the crude "uploads present? clone it"
      // heuristic. Best-effort: on ANY failure we keep the prior behavior, so
      // this can't regress a render.
      let routeIntent: "exact_reference" | "style_inspiration" | undefined = uploads.length ? "exact_reference" : undefined;
      let effectiveBrief = brief;
      let routeKind: string | null = null;
      let editInstructions = "";
      try {
        const ur = await fetch(`${supabaseUrl}/functions/v1/approvepro-intake-understand`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          body: JSON.stringify({ proof_id: proof.id }),
        });
        const uj = await ur.json().catch(() => ({}));
        const u = uj?.understanding;
        if (ur.ok && u && typeof u === "object") {
          // Routing only matters when references were uploaded; from-scratch
          // orders stay undefined (creative DesignPro), as before.
          if (uploads.length && (u.visionboard_intent === "exact_reference" || u.visionboard_intent === "style_inspiration")) {
            routeIntent = u.visionboard_intent;
          }
          // Reinforce the customer's own words with the parsed coverage + the
          // discrete edit list so changes (3/4 wrap, colors, "no light blue",
          // added wording) actually reach the generator instead of being dropped.
          const editLines = Array.isArray(u.edit_list)
            ? u.edit_list.map((e: any) => `- ${String(e?.change || "").trim()}`).filter((s: string) => s.length > 3).join("\n")
            : "";
          const cov = u.coverage && u.coverage.type && u.coverage.type !== "unspecified"
            ? `Coverage: ${u.coverage.type}${Array.isArray(u.coverage.excluded_panels) && u.coverage.excluded_panels.length ? ` (leave factory: ${u.coverage.excluded_panels.join(", ")})` : ""}.`
            : "";
          routeKind = typeof u.route === "string" ? u.route : null;
          editInstructions = [cov, editLines].filter(Boolean).join("\n").trim();
          const composed = [brief, cov, editLines ? `REQUIRED CHANGES (apply these to the design):\n${editLines}` : ""]
            .filter(Boolean).join("\n\n").trim();
          if (composed) effectiveBrief = composed.slice(0, 1800);
          console.log(`autogen: intake route=${u.route} intent=${routeIntent} edits=${Array.isArray(u.edit_list) ? u.edit_list.length : 0}`);
        }
      } catch (e) {
        console.warn("autogen: intake-understand failed (non-fatal, using raw brief):", (e as any)?.message || e);
      }

      // ADMIN DESIGN RULES — fold the team's manual prompt/adjustment into the
      // brief so it flows straight into the Artboard Pass (and every projected
      // view), not just the 2D proof. Augments generation; never blocks it.
      if (adminInput) {
        effectiveBrief = `${effectiveBrief}\n\nADMIN DESIGN RULES (apply exactly): ${adminInput}`.slice(0, 1900);
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      const agentToken = await mintAgentSession(supabaseUrl, serviceRoleKey, anonKey);
      const renderAuth = agentToken ? `Bearer ${agentToken}` : (authHeader || "");
      if (!renderAuth) {
        console.error("autogen: no render auth (agent mint failed + no forwarded session)");
        await db.from("proof_approvals").update({
          metadata: { ...meta, autogen_status: "failed", autogen_error: "no render session (agent mint failed)" },
        }).eq("id", proof.id);
        return;
      }

      // ══════════════════════════════════════════════════════════════════════
      // 1) DESIGN — through the shared DesignPro / RecreatePro OS.
      //
      // ROUTE: uploads present ⇒ RecreatePro (reproduce the customer's OWN
      // artwork); text brief only ⇒ DesignPro (design it from the brief).
      //
      // NO ARTBOARD-FIRST HERE. ApprovePro used to paint a flat master artboard
      // and then PROJECT it onto every view (`mode:"artboard"` +
      // `visionboard_intent:"artboard_projection"`). DesignPro deleted that path
      // on 2026-07-24 (`hasArtboardInput = false`): the projection consumed the
      // customer's placement/persona/logo direction making the sheet and then
      // softened + drifted the design — and on RECREATE orders the AI artboard
      // REDREW the uploaded artwork before it ever reached the vehicle, so every
      // downstream view/proof/panel showed the wrong design. The artboards now
      // come from the 2D proof, exactly like DesignPro. Do NOT reintroduce a
      // pre-design artboard in ApprovePro.
      // ══════════════════════════════════════════════════════════════════════
      const osAuth = { supabaseUrl, anonKey, serviceRoleKey, renderAuth };
      const vehicle = {
        year: proof.vehicle_year,
        make: proof.vehicle_make,
        model: proof.vehicle_model,
      };

      // BODY-TYPE AWARE — a trailer / flat-sided body has no hood and no roof to
      // wrap, so those views are never rendered. Detected from the brief / model
      // / design name because vehicle_type is usually unset on WPW orders.
      const isTrailer = /\btrailers?\b|\benclosed\b|\bgooseneck\b|\bflatbed\b|\bcargo\s+trailer\b/i
        .test(`${effectiveBrief || ""} ${proof.vehicle_model || ""} ${proof.design_name || ""}`);

      // DIMENSION SOURCE — resolve TRUE per-panel inches ONCE, at gen #1, from
      // the GENIE universal panelizer. The SAME numbers are stamped on the 2D
      // proof and carried on the version, so proof dims == panel dims by
      // construction. Never throws; undefined just means the proof step falls
      // back to vehicle-lookup.
      const validatedDims = await resolveGenieDims(osAuth, vehicle, (m) => console.log(`autogen: ${m}`));

      // HERO-FIRST PERSISTENCE — the driver side is saved as an active version
      // the moment it exists, BEFORE the clone stage, so the order always has a
      // usable proof even if the angles stall. The full set is merged in below.
      const saved: { viz: { id: string } | null; ver: { id: string } | null } = { viz: null, ver: null };
      let nextVersion = 0;
      let designName = String(proof.design_name || "Auto Design");
      let renderUrl = "";

      const persistHero = async (hero: { url: string; designName: string | null; generationId: string | null }) => {
        renderUrl = hero.url;
        designName = hero.designName || designName;
        const firstUrls: Record<string, unknown> = {
          hero: hero.url,
          side: hero.url,
          ...(validatedDims ? { panel_dimensions: validatedDims } : {}),
        };

        // color_visualizations NOT-NULL columns (no defaults): customer_email,
        // vehicle_make/model/year, color_hex, color_name, finish_type — fill them
        // all or the insert 23502-fails and the design is orphaned.
        const vizYear = (() => { const y = parseInt(String(proof.vehicle_year || "")); return Number.isFinite(y) ? y : 0; })();
        const { data: vizRow, error: vizErr } = await db
          .from("color_visualizations")
          .insert({
            customer_email: proof.customer_email || "unknown@weprintwraps.com",
            vehicle_year: vizYear,
            vehicle_make: (proof.vehicle_make || "unknown").toLowerCase(),
            vehicle_model: (proof.vehicle_model || "unknown").toLowerCase(),
            mode_type: "designpanelpro",
            color_name: designName.slice(0, 120),
            color_hex: "#000000",
            finish_type: "gloss",
            tool_source: "approvepro",
            render_urls: firstUrls,
            generation_status: "completed",
            is_saved: true,
          })
          .select("id")
          .maybeSingle();
        if (vizErr) console.error("autogen: color_visualizations insert failed:", vizErr.message);
        saved.viz = (vizRow as any) || null;

        // CANONICAL IDENTITY — without this block the row is an ORPHAN: every
        // designiq_generations.update().eq("id", <CV id>) silently no-ops, both
        // artboard columns stay NULL, and Build Assets / PanelPro / the DID
        // can't find an ApprovePro design. Same shape DesignPro writes
        // (designiq_generation_id + original_prompt + designiq_mode).
        if (saved.viz?.id) {
          await linkCanonicalDesign(db, saved.viz.id, {
            designiqGenerationId: hero.generationId,
            originalPrompt: String(effectiveBrief || brief || "").slice(0, 4000),
            designiqMode: "restyle",
            toolSource: "approvepro",
            extra: { proof_id: proof.id, design_route: routeDesignJob(uploads) },
          }, (m) => console.log(`autogen: ${m}`));
        }

        const { data: maxRow } = await db
          .from("proof_versions")
          .select("version_number")
          .eq("proof_id", proof.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        nextVersion = (maxRow?.version_number ?? 0) + 1;

        const { data: ver, error: verErr } = await db.from("proof_versions").insert({
          proof_id: proof.id,
          version_number: nextVersion,
          created_by_role: "system_upload",
          created_by_user_id: null,
          render_urls: firstUrls,
          uploaded_file_paths: [],
          prompt_text: String(brief).slice(0, 1500),
          is_active: false,
        }).select("id").maybeSingle();
        if (verErr || !ver) {
          console.error("autogen: proof_versions insert failed", verErr?.message);
          return;
        }
        saved.ver = ver as any;
        await db.from("proof_versions").update({ is_active: false })
          .eq("proof_id", proof.id).eq("is_active", true);
        await db.from("proof_versions").update({ is_active: true }).eq("id", ver.id);

        const fresh = (await db.from("proof_approvals").select("metadata").eq("id", proof.id).maybeSingle()).data?.metadata as any || meta;
        await db.from("proof_approvals").update({
          source_visualization_id: saved.viz?.id || null,
          design_name: designName,
          ai_revisions_allowed: Math.max(Number(proof.ai_revisions_allowed ?? 0), 3),
          metadata: {
            ...fresh,
            autogen_status: "done",
            autogen_visualization_id: saved.viz?.id || null,
            designiq_generation_id: hero.generationId || null,
            design_route: routeDesignJob(uploads),
            ...(validatedDims ? { panel_dimensions: validatedDims } : {}),
          },
        }).eq("id", proof.id);

        await db.from("proof_events").insert({
          proof_id: proof.id, event_type: "version_saved", actor_role: "system",
          payload: {
            source: "autogen_design",
            route: routeDesignJob(uploads),
            version_number: nextVersion,
            render_url: hero.url,
            designiq_generation_id: hero.generationId || null,
          },
        });
      };

      const design = await runDesignJob({
        ...osAuth,
        brief: effectiveBrief,
        uploads,
        vehicle,
        finish: "Gloss",
        routeIntent,
        // RECREATE + EDITS: the discrete change list runs as a SECOND pass on the
        // faithful clone (an exact_reference render ignores edits sent in the
        // same prompt) — the RecreatePro mechanism.
        editInstructions: routeKind === "recreate_edits" ? editInstructions : undefined,
        isTrailer,
        onHero: persistHero,
        log: (m) => console.log(`autogen: ${m}`),
      });

      if (!design.heroUrl) {
        await db.from("proof_approvals").update({
          metadata: {
            ...meta,
            autogen_status: "failed",
            autogen_error: (design.error || "hero view failed to render").slice(0, 300),
          },
        }).eq("id", proof.id);
        return;
      }
      if (!saved.ver) {
        await db.from("proof_approvals").update({
          metadata: { ...meta, autogen_status: "failed", autogen_error: "version insert failed" },
        }).eq("id", proof.id);
        return;
      }

      // MERGE THE FULL SET — the hero version now gets every cloned angle.
      const renderUrls: Record<string, string> = { ...design.renderUrls };
      // PERSIST DIMS: every later render_urls write spreads THIS object, so the
      // dims must ride on it or they get clobbered on the next update (which is
      // why panel_dimensions was NULL on every order).
      if (validatedDims) (renderUrls as any).panel_dimensions = validatedDims;
      await db.from("proof_versions").update({ render_urls: renderUrls }).eq("id", saved.ver.id);
      if (saved.viz?.id) await db.from("color_visualizations").update({ render_urls: renderUrls }).eq("id", saved.viz.id);
      await db.from("proof_events").insert({
        proof_id: proof.id, event_type: "version_saved", actor_role: "system",
        payload: {
          source: "autogen_design_views",
          route: design.route,
          version_number: nextVersion,
          views: Object.keys(design.renderUrls).length,
          failed_views: design.failedViews,
        },
      });
      console.log(
        `autogen: design ready via ${design.route} — ${Object.keys(design.renderUrls).length} view(s)` +
        `${design.failedViews.length ? `, failed: ${design.failedViews.join(",")}` : ""}`,
      );

      const finalRenderUrls: Record<string, string> = renderUrls;

      // 2) THE 2D PRODUCTION PROOF — generated for EVERY order (all tenants), the
      // dimensioned multi-view technical sheet WPW customers are used to. Only the
      // TEMPLATE branding differs: WPW orders carry the WePrintWraps template,
      // everything else keeps the DesignProAI / RestyleProAI branding. This sheet
      // is the source for print files later (generate-artboard-from-proof).
      // Any revision re-runs this against the LATEST version + the change request.
      try {
        // WPW orders get the WePrintWraps template; generate-2d-proof keys its
        // branding off shopName (regex /weprint\s*wraps|wpw/i).
        const isWpwOrder = meta.auto_ingested === "wpw" ||
          !!(meta.wpw_order_number || meta.wpw_woo_order_id);
        const shopName = isWpwOrder ? "WePrintWraps" : (meta.shop_name || (proof as any).shop_name || "");

        // Dimensions: prefer the genie panelizer dims already resolved at gen #1
        // (panelizer-step-validate, never zero); only fall back to vehicle-lookup
        // if that didn't resolve. Mapped to the camelCase generate-2d-proof wants.
        let dimensions: Record<string, number> | undefined = validatedDims;
        if (!dimensions && proof.vehicle_make && proof.vehicle_model) {
          try {
            const vr = await fetch(`${supabaseUrl}/functions/v1/vehicle-lookup`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: anonKey },
              body: JSON.stringify({ make: proof.vehicle_make, model: proof.vehicle_model, year: proof.vehicle_year || "" }),
            });
            const vj = await vr.json().catch(() => ({}));
            const v = vj?.vehicle;
            if (v && (v.side_w || v.sideW)) {
              dimensions = {
                sideW: v.side_w ?? v.sideW, sideH: v.side_h ?? v.sideH,
                hoodW: v.hood_w ?? v.hoodW, hoodL: v.hood_l ?? v.hoodL,
                roofW: v.roof_w ?? v.roofW, roofL: v.roof_l ?? v.roofL,
                backW: v.back_w ?? v.backW, backH: v.back_h ?? v.backH,
                totalSqFt: v.total_sq_ft ?? v.totalSqFt,
                corrSqFt: v.corr_sq_ft ?? v.corrSqFt,
              };
            }
          } catch (e) {
            console.warn("autogen: vehicle-lookup dims (non-fatal):", (e as any)?.message || e);
          }
        }

        // Revision context: if the customer requested a change, base the new 2D
        // proof on the LATEST proof and pass the change request so Gemini fixes it.
        const revisionNote = (proof.change_request && String(proof.change_request).trim()) || undefined;
        let previousProofUrl: string | undefined;
        if (revisionNote) {
          const { data: prevVer } = await db
            .from("proof_versions")
            .select("render_urls")
            .eq("proof_id", proof.id)
            .neq("id", saved.ver.id)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          const prevUrls = (prevVer?.render_urls as any) || {};
          previousProofUrl = prevUrls.production_proof || prevUrls.proof_2d || undefined;
        }

        // THE FLAT PAINTER IS THE PRODUCER (locked). generate-2d-proof paints
        // the TRUE 2D Production Proof — flat orthographic silhouettes with
        // dimension lines and the stamped GENIE size band — AND emits the
        // branded + clean artboards, persisting them on the canonical DesignIQ
        // row. `api/compose-2d-proof` only STACKS the 3D photo renders; it is
        // strictly the never-fail fallback so an order is never left with no
        // proof at all, never the producer.
        const proof2d = await runTwoDProof({
          supabaseUrl, anonKey, serviceRoleKey,
          viewUrls: finalRenderUrls,
          heroUrl: renderUrl,
          vehicle,
          designName,
          finish: "Gloss",
          shopName,
          dimensions,
          revisionNote,
          previousProofUrl,
          // The CV id — generate-2d-proof resolves the canonical DesignIQ id
          // through the admin_notes back-link written right after the design.
          visualizationId: saved.viz?.id || undefined,
          log: (m) => console.log(`autogen: ${m}`),
        });
        let proofUrl2d: string | null = proof2d.proofUrl;
        const artboardClean2d: string | null = proof2d.artboardCleanUrl;
        const artboardBranded2d: string | null = proof2d.artboardBrandedUrl;
        const proofViewUrls: Record<string, string> = Object.fromEntries(
          Object.entries(finalRenderUrls).filter(
            ([k, v]) => !["master_artboard", "production_artboard", "artboard", "flat_artboard"].includes(k)
              && typeof v === "string" && /^https?:/.test(v as string),
          ),
        ) as Record<string, string>;

        // FALLBACK — deterministic Sharp composer (labeled 3D-photo sheet). Not a
        // real flat proof, but guarantees the order never ends up with NO proof.
        if (!proofUrl2d) {
          try {
            const composeUrl = Deno.env.get("COMPOSE_2D_PROOF_URL") || "https://www.restyleproai.com/api/compose-2d-proof";
            const vehicleName = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ");
            // GENIE dims ride along so even the fallback sheet stamps the size
            // band + total sq ft.
            const cr = await fetch(composeUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                generation_id: saved.viz?.id || undefined,
                view_urls: proofViewUrls,
                shopName, vehicleName, designName, finish: "Gloss", dimensions,
              }),
            });
            const cj = await cr.json().catch(() => ({}));
            if (cr.ok && cj?.proofUrl) proofUrl2d = cj.proofUrl;
            else console.warn("autogen: composer fallback failed too (non-fatal):", cr.status, JSON.stringify(cj).slice(0, 160));
          } catch (e) {
            console.warn("autogen: composer fallback threw (non-fatal):", (e as any)?.message || e);
          }
        }

        if (proofUrl2d) {
          // The BRANDED artboard the proof emitted is the flat master for this
          // design — surface it on the version + order metadata where the
          // workbench already looks (it used to come from the deleted
          // pre-design artboard pass).
          const withProof: Record<string, string> = { ...finalRenderUrls, production_proof: proofUrl2d };
          if (artboardBranded2d) withProof.master_artboard = artboardBranded2d;
          await db.from("proof_versions").update({ render_urls: withProof }).eq("id", saved.ver.id);
          if (saved.viz?.id) await db.from("color_visualizations").update({ render_urls: withProof }).eq("id", saved.viz.id);
          if (artboardBranded2d) {
            const { data: paNow } = await db.from("proof_approvals").select("metadata").eq("id", proof.id).maybeSingle();
            await db.from("proof_approvals").update({
              metadata: { ...((paNow?.metadata as any) || meta), master_artboard_url: artboardBranded2d },
            }).eq("id", proof.id);
          }
          await db.from("proof_events").insert({
            proof_id: proof.id, event_type: "version_saved", actor_role: "system",
            payload: {
              source: "autogen_2d_production_proof", version_number: nextVersion, proof_url: proofUrl2d,
              wpw: isWpwOrder, revision: !!revisionNote,
              artboard_branded: !!artboardBranded2d, artboard_clean: !!artboardClean2d,
            },
          });

          // 8TH-CALL PARITY: the 8th call must leave TWO persisted assets — the
          // proof AND the continuous, text-free artboardClean the 9th-call
          // gridslice crops. The painter path already returned artboardClean2d;
          // when the composer FALLBACK won (no clean layer), mint it via
          // generate-2d-proof {stripBranding:true} (self-persists admin_notes.
          // artboard_clean_url). Also mirror flat_proof_url to the places the
          // Design Assets page reads. Best-effort.
          if (saved.viz?.id) {
            try {
              const { data: notesRow } = await db.from("color_visualizations").select("admin_notes").eq("id", saved.viz.id).maybeSingle();
              let notes: Record<string, unknown> = {};
              try { notes = typeof notesRow?.admin_notes === "string" ? JSON.parse(notesRow.admin_notes) : ((notesRow?.admin_notes as any) || {}); } catch { notes = {}; }
              notes.flat_proof_url = proofUrl2d;
              if (artboardClean2d) notes.artboard_clean_url = artboardClean2d;
              // Keep the canonical back-link — this row is read as the design's
              // identity by Build Assets, PanelPro and the DID helper.
              if (design.designiqGenerationId) notes.designiq_generation_id = design.designiqGenerationId;
              await db.from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", saved.viz.id);
              if (design.designiqGenerationId) {
                await db.from("designiq_generations").update({ flat_proof_url: proofUrl2d }).eq("id", design.designiqGenerationId);
              }
            } catch (e) {
              console.warn("autogen: proof mirror persist (non-fatal):", (e as any)?.message || e);
            }
            if (!artboardClean2d) {
              try {
                const cp = await fetch(`${supabaseUrl}/functions/v1/generate-2d-proof`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: anonKey },
                  body: JSON.stringify({
                    allViewUrls: proofViewUrls,
                    stripBranding: true,
                    vehicleYear: proof.vehicle_year || undefined,
                    vehicleMake: proof.vehicle_make || undefined,
                    vehicleModel: proof.vehicle_model || undefined,
                    designName,
                    finish: "Gloss",
                    shopName,
                    dimensions,
                    designiqGenerationId: saved.viz.id,
                  }),
                });
                const cj = await cp.json().catch(() => ({}));
                if (cp.ok && cj?.artboardCleanUrl) console.log("autogen: artboardClean minted + persisted");
                else console.warn("autogen: artboardClean pass failed (non-fatal):", cp.status, JSON.stringify(cj).slice(0, 160));
              } catch (e) {
                console.warn("autogen: artboardClean pass threw (non-fatal):", (e as any)?.message || e);
              }
            }
          }
        }
      } catch (e) {
        console.warn("autogen: 2D production proof (non-fatal):", (e as any)?.message || e);
      }
    } catch (err: any) {
      console.error("autogen: unexpected", err?.message || err);
      await db.from("proof_approvals").update({
        metadata: { ...meta, autogen_status: "failed", autogen_error: (err?.message || "error").toString().slice(0, 300) },
      }).eq("id", proof.id);
    }
  };

  (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(run()) : run();
  return jsonResponse({ ok: true, status: "running" }, 202);
});
