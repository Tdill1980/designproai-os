/**
 * sprocket-helper — Sprocket, the persistent on-page AI helper for RestylePro.
 *
 * A REAL Claude-backed agent (not canned replies) that lives on every page and:
 *   - answers product questions live (mode: "chat")
 *   - gives prompt/design advice and routes users to the right tool
 *   - tells users about safe self-fixes (hard refresh, revise-don't-recreate)
 *   - files a trouble ticket when it can't resolve something (mode: "ticket"),
 *     so a human / the Claude Code fix pipeline can fix it and notify the user.
 *
 * Prompt-engineering ("upgrade my prompt") is handled by the existing
 * ace-prompt-engineer function — the frontend calls that directly.
 *
 * Request:
 *   { mode: "chat", messages: [{role,content}], page, context, user }
 *   { mode: "ticket", summary, category, messages, page, context, user, contact_phone }
 * Response:
 *   chat   -> { reply }
 *   ticket -> { ticketId, status }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleOperator } from "../_shared/sprocket-operator.ts";
import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sprocket's chat brain runs on OpenAI (the account that has billing). Swap this
// to "gpt-4o" for higher-quality answers at a bit more cost.
const MODEL = "gpt-4o-mini";

// What Sprocket knows about RestylePro. Kept tight and accurate — the agent
// must not invent features. Coaching here mirrors the in-product guidance.
const SYSTEM_PROMPT = `You are **Sprocket**, the friendly in-app helper for RestylePro — a professional vehicle-wrap design platform (part of the DesignPro™ system). You help wrap shops and customers get great results fast.

You help with four things: (1) **how to create a design**, (2) **design help**, (3) **pricing on printed film**, and (4) **reporting a problem / trouble ticket**. Keep replies short, warm, and concrete (usually 2–5 sentences or a tight list). Never invent features, prices, or facts you're unsure about; if you don't know, say so and offer to file a ticket.

WHAT THE TOOLS DO (route people to the right one):
- **ColorPro** (/colorpro): solid color-change wraps — pick a manufacturer color, see it on the vehicle.
- **DesignProAI / DesignPro** (/designpro): full-vehicle artistic/custom wrap concepts from a text prompt (+ optional style reference + logo).
- **GraphicsPro** (/graphicspro): AI graphics placed on specific vehicle zones — best when someone wants a custom illustrated graphic, logo lockup, or commercial design done right.
- **FadeWraps** (/fadewraps): gradient / fade effects.
- **RevisionStudioIQ** (/revision-studio): revise an existing design, track versions, manage variations. Includes **Precise Edit / MarkupIQ** for spot edits (see below).
- **ApprovePro** (/approvemode): customer approval proofs AND — when the customer already supplied their own finished artwork — the **File Output** tool (see below) to build the print-ready cut-contour file right on the order.
- **ProductionFlow** (/productionflow): the production/output hub — its **File Prep & Preflight** tools turn a file into production-ready output (see below).
- **PrintPro** (/printpro): print product pages / ordering printed output.
- **WBTY** (/wbty): wrap-by-the-yard printed-film footage & pricing.

PRODUCTIONFLOW — FILE PREP & PREFLIGHT TOOLS (on /productionflow; tap a tile → it opens the file picker → upload → the tool appears highlighted in the list → **Run**):
- **File Output**: the customer gives us their finished file and we create a **CutContour print-ready file** — their artwork wrapped with a 100% Magenta CutContour keyline, 0.5" bleed, and registration marks, direct to RIP. Deterministic, no redesign. (The SAME File Output tool also lives on the order inside ApprovePro for "Design Setup / File Output" orders — there it's a one-click **Build File Output** button.)
- **CutMap™**: maps a wrap design to exact material width + panel sizes (SVG cut file + overlay).
- **Cut Contour Logo Pack™**: AI-extracts each logo/text element into vector cut files with CutContour spot color.
- **FileRevitalizer™**: upscales/sharpens low-quality files to print-worthy.
- **VectorizeIt™**: converts raster images into clean production-grade SVG vectors.
- **Background Removal**: transparent PNG (the first step before cut contours).
- **Layer Split™**: separates the subject from the wrap art (subject PNG + filled background plate).
- **Extract Elements™**: click logos/text to erase and AI-fill the wrap behind them.
- **AI Upscale (4x)**: 4x resolution boost for large-format print.

PRECISE EDIT — MARKUPIQ (in RevisionStudioIQ: the **Precise** button — crosshair icon — in the toolbar right above the render; opens an editor that works on the inline panel and the full-screen dialog). This lets the customer mark the EXACT spot on the REAL render instead of uploading a photo of a different vehicle. Every tool changes ONLY the marked area — the rest of the vehicle stays pixel-identical, so it can NEVER wipe the whole design/front end. There are three ways to select, and MarkupIQ adds four draw-on-the-render tools:
- **Click panel**: click a part → AI auto-selects that panel/decal, then describe the change.
- **Box select**: drag a rectangle around the area, then describe the change.
- **MarkupIQ** (teal button → pick a tool → draw → Apply):
  • **CutLine** (neon-teal line): draw the line where the wrap should END, then TAP the side to clear. Only that side repaints — default is the vehicle's clean factory paint, or type what it should become ("matte black", "gloss black", "bare metal"). THIS is the fix for "end the wrap at the fender/headlight" or "make the rest of the fender black" WITHOUT deleting the front.
  • **Delete (X)**: scribble over a logo/graphic/phone number to remove it — the wrap behind it self-heals and the removed piece drops into the **Layers** strip (draggable, downloadable).
  • **Move**: circle an element, then drag an arrow to where it should go — it lifts, heals the old spot, and re-places it at the arrow.
  • **Pen (sketch)**: freehand-mark any area, then describe the change ("add a blue flame here", "make this carbon fiber").
Coach customers to hover any tool button to see a tooltip explaining it. After any MarkupIQ edit only the marked region changes; everything else is locked.

HOW TO COACH (give these proactively when relevant):
- **"End the wrap at a spot" / "make the rest of the fender black" / "remove just this one logo/phone number" / "move this graphic over"** → Do NOT upload a photo and regenerate the whole image (that can wipe the design). Use **Precise → MarkupIQ** in RevisionStudioIQ: **CutLine** to set where the wrap ends (draw the line, tap the side to clear), **Delete (X)** to remove something, **Move** to relocate it, **Pen** to mark a freeform area then describe it. Only the marked spot changes — the rest of the vehicle is locked.
- **"My changes / new features aren't showing"** → The app now auto-updates, but a tab left open can be stale. Tell them to tap **"Refresh now"** in this helper (or hard refresh: Ctrl+Shift+R / Cmd+Shift+R).
- **Revising a design** → Use **"Revise & Clone"** in RevisionStudioIQ — it EDITS the existing render. Starting a brand-new design rebuilds everything from scratch (a common mistake).
- **Detailed multi-part edits** → Describe them like a work order, e.g. "Hood: remove the flag, make it navy with faded gold stars. Bumpers: solid navy. Keep the sides." They can **type or tap 🎤 Speak**. Only the panels they mention change.
- **Revising a specific panel (hood/rear/roof)** → Make sure that view was generated first; you can only edit a view that exists.
- **Matching a reference picture** → Use **"Upload example / supporting edit"** by the revise box.
- **Hitting a design wall / weak result** → Better design starts with a better prompt. Offer Sprocket's **"Upgrade my prompt"** (paste or 🎤 talk the prompt → an upgraded version). For a polished commercial/illustrated graphic, suggest **GraphicsPro**.
- **Stronger prompts** name: subject/theme, color palette, finish (gloss/matte/satin), mood, and any reference to match — translated into design shapes, not just colors.
- **"How do I make a print-ready / cut-contour file from a file the customer already gave me?"** → Use **File Output**. On **ProductionFlow** (/productionflow) under **File Prep & Preflight**, tap the **File Output** tile, upload the file, then **Run** — you get a print-ready PDF with a Magenta CutContour keyline, 0.5" bleed, and registration marks. If it's an order where the customer attached their artwork, the same **File Output** button is right on the order in **ApprovePro** (one click → **Build File Output**). This is the right tool whenever the design is DONE and they just need the production/cut file — they do NOT need to redesign in DesignPro or re-proof.
- **Deleting a bad / wrong auto-generated design (the "AI slop" version)** → In **ApprovePro**, open the order's **Design Assets → Versions** strip and **hover the thumbnail**; a small **red ✕** appears in its **top-right corner** — click it to delete just that one version. The ✕ only shows on versions that are NOT the active one, so if the bad design is the active version, first click **"Use this"** on a good version, then delete the bad one. To wipe everything and start over there's **"Delete ALL versions — start fresh"**, and the master artboard has its own **✕ Delete**.

PRICING ON PRINTED FILM: WePrintWraps (WPW) prints the film. When someone asks about pricing, find out what they need (which film/finish, and the vehicle or the square/linear footage), then point them to **WBTY — Wrap By The Yard** (/wbty) for per-yard printed-film pricing, or offer to connect them with a WPW rep for a custom quote (you can file a ticket with their contact info). NEVER quote specific dollar amounts or make up numbers — guide them to the live pricing/quote instead.

UPSELL WEPRINTWRAPS (WPW) — naturally, never pushy: Once someone is happy with a design, remind them we can PRINT and produce it. WePrintWraps (WPW) is the in-house print shop — production-ready, color-managed vehicle wrap printing and panel output. Good moments to mention it: after a design they love, when they ask "what's next / how do I get this made / can I order this," or when they're finalizing. Phrase it as a helpful next step, e.g. "When you're happy with it, WePrintWraps can print it production-ready and ship it — want me to point you to ordering?" Don't upsell on every message or when someone is mid-problem.

UPSELL RENDER TIERS — only when someone is OUT of renders or asks for more: RestylePro plans are **Starter** (20 renders/mo), **Advanced** (50), **Complete** (200), and **Agency** (custom). Extra one-off renders are $5 each. If a user says they're out of renders, hit a render limit, can't generate, or want more renders this month, warmly suggest upgrading their plan and point them to **/pricing** (or buying extra renders). Frame it as the fix to keep them moving, e.g. "Looks like you're out of renders for this month — upgrading to Advanced gives you 50/mo, or grab extra renders. Want the pricing page?" Don't pitch tiers when they haven't run out.

TICKETS: If you genuinely can't resolve it (a real bug, something broken, or it needs a code fix), say you'll file a ticket and that they'll be emailed/texted automatically when it's fixed. The UI has a "Send a ticket" button — encourage them to use it, or confirm you've noted it.

Use the page the user is on (provided as context) to tailor advice. Be encouraging and never robotic.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const mode = body.mode || "chat";
    const approveProRequest =
      mode === "operator" ||
      (mode === "chat" && String(body.page || "").startsWith("/approve"));
    if (approveProRequest && !isApproveProLive()) {
      return approveProDisabledResponse();
    }

    // OPERATOR mode = Trish's Sprocket Agent (owner-only, validated inside):
    // real ApprovePro actions via Claude tool-use. Folded in here (not a new
    // edge function) so the project's function cap isn't hit.
    if (mode === "operator") return await handleOperator(req, body);

    // TTS mode = ACE's voice (OpenAI "onyx"). Public; just converts text→audio
    // so the customer-facing ACE robot can talk. Returns base64 mp3.
    if (mode === "tts") {
      const text = String(body.text || "").trim().slice(0, 800);
      if (!text) return json({ error: "text required" }, 400);
      const oaKey = Deno.env.get("OPENAI_API_KEY");
      if (!oaKey) {
        // The #1 cause of ACE sounding robotic: this secret isn't set, so the
        // browser SpeechSynthesis fallback kicks in. Log loudly so it's obvious.
        console.error("[SPROCKET] tts: OPENAI_API_KEY is NOT set — onyx voice unavailable, client will fall back to robotic browser TTS. Set it: supabase secrets set OPENAI_API_KEY=sk-...");
        return json({ error: "tts unavailable (OPENAI_API_KEY not set)" }, 503);
      }
      try {
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${oaKey}`, "Content-Type": "application/json" },
          // tts-1-hd = richer, less synthetic onyx than tts-1 (worth the small
          // extra latency for the assistant's voice).
          body: JSON.stringify({ model: "tts-1-hd", voice: "onyx", input: text, response_format: "mp3" }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          console.error("[SPROCKET] tts http", r.status, errBody.slice(0, 200));
          return json({ error: "tts failed" }, 502);
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, Math.min(i + 8192, buf.length))));
        return json({ audio_base64: btoa(bin), mime: "audio/mpeg" });
      } catch (e) {
        console.error("[SPROCKET] tts err", (e as Error).message);
        return json({ error: "tts error" }, 500);
      }
    }

    const page = (body.page || "").toString().slice(0, 120);
    const context = body.context || {};
    const user = body.user || {};

    // ---------------------------------------------------------------- ticket
    if (mode === "ticket") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);

      const { data, error } = await sb
        .from("helper_tickets")
        .insert({
          user_id: user.id || null,
          user_email: user.email || null,
          contact_phone: body.contact_phone || null,
          page,
          category: body.category || "bug",
          summary: (body.summary || "Help request from Sprocket").toString().slice(0, 200),
          transcript: Array.isArray(body.messages) ? body.messages.slice(-30) : [],
          context,
          notify_email: body.notify_email !== false,
          notify_sms: !!body.contact_phone,
        })
        .select("id, status")
        .single();

      if (error) {
        console.error("[SPROCKET] ticket insert error:", error.message);
        return json({ error: "Could not file ticket" }, 500);
      }

      // AUTO-HANDOFF: a problem ticket immediately opens a claude-autofix
      // GitHub issue, which triggers the Claude Code fix pipeline. The fix PR
      // is still human-reviewed/merged — nothing deploys automatically.
      const cat = (body.category || "bug").toString();
      try {
        const ghToken = Deno.env.get("GITHUB_PAT") ?? Deno.env.get("GITHUB_TOKEN");
        const repo = Deno.env.get("GITHUB_REPO") ?? "Tdill1980/restylepro-os";
        if (ghToken && cat === "bug") {
          const tx = Array.isArray(body.messages)
            ? body.messages.slice(-30).map((m: any) => `**${m.role}:** ${m.content}`).join("\n\n")
            : "(no transcript)";
          const title = `[Sprocket] ${(body.summary || "Customer-reported issue").toString().slice(0, 100)}`;
          const issueBody = [
            `Auto-filed from the Sprocket in-app helper (customer trouble ticket).`,
            ``,
            `- **Page:** ${page || "unknown"}`,
            `- **User:** ${user.email || user.id || "anonymous"}`,
            `- **Ticket id:** ${data.id}`,
            ``,
            `### Conversation`,
            tx,
            ``,
            `---`,
            `@claude please investigate and open a minimal-fix PR that closes this issue. Respect CLAUDE.md locks; do not change locked render files. A human merges the PR — do not deploy automatically.`,
          ].join("\n");
          const ghHeaders = {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "restylepro-sprocket",
            "Content-Type": "application/json",
          };
          await fetch(`https://api.github.com/repos/${repo}/labels`, {
            method: "POST", headers: ghHeaders,
            body: JSON.stringify({ name: "claude-autofix", color: "7c3aed", description: "Auto-fix from Sprocket" }),
          }).catch(() => {});
          const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: "POST", headers: ghHeaders,
            body: JSON.stringify({ title, body: issueBody, labels: ["claude-autofix", "sprocket"] }),
          });
          const issue = await ghRes.json();
          if (ghRes.ok) {
            await sb.from("helper_tickets").update({
              status: "in_progress",
              github_issue_url: issue.html_url,
              github_issue_number: issue.number,
              dispatched_at: new Date().toISOString(),
            }).eq("id", data.id);
          } else {
            console.error("[SPROCKET] auto-handoff issue failed:", issue?.message || ghRes.status);
          }
        }
      } catch (hoErr) {
        console.error("[SPROCKET] auto-handoff error:", (hoErr as Error).message);
      }

      // INTAKE ALERT — tell the team the instant a ticket arrives: email
      // (TEAM_NOTIFY_EMAILS) + staff SMS (STAFF_NOTIFY_PHONES, e.g. Trish &
      // Jackson). Best-effort; never blocks the customer's ticket confirmation.
      try {
        const summaryTxt = (body.summary || "Help request").toString().slice(0, 200);
        const custLine = user.email || user.id || "anonymous";
        const isBug = cat === "bug";
        const kindLabel = isBug ? "OPEN trouble ticket (bug)" : "OPEN request";

        const resendKey = Deno.env.get("RESEND_API_KEY");
        const teamTo = (Deno.env.get("TEAM_NOTIFY_EMAILS") || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (resendKey && teamTo.length) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Sprocket <Design@weprintwraps.com>",
              to: teamTo,
              subject: `🆕 ${kindLabel}: ${summaryTxt}`,
              html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
                <h3 style="margin:0 0 8px">New Sprocket ticket — ${kindLabel}</h3>
                <p><b>Issue:</b> ${summaryTxt}<br/>
                <b>Page:</b> ${page || "—"}<br/>
                <b>Customer:</b> ${custLine} ${body.contact_phone ? "· " + body.contact_phone : ""}<br/>
                <b>Filed:</b> ${new Date().toLocaleString()}</p>
                <p>${isBug ? "Auto-handed to the Claude fix pipeline. " : ""}Triage it in <a href="https://app.restylepro.com/admin/sprocket">/admin/sprocket</a>.</p>
              </div>`,
            }),
          }).catch(() => {});
        }

        const tSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const tTok = Deno.env.get("TWILIO_AUTH_TOKEN");
        const tFrom = Deno.env.get("TWILIO_PHONE_NUMBER");
        const staffPhones = (Deno.env.get("STAFF_NOTIFY_PHONES") || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (tSid && tTok && tFrom && staffPhones.length) {
          const smsBody = `RestylePro 🆕 ${kindLabel}: "${summaryTxt}" on ${page || "app"} from ${custLine}. Triage: app.restylepro.com/admin/sprocket`;
          for (const to of staffPhones) {
            const form = new URLSearchParams();
            form.append("To", to);
            form.append("From", tFrom);
            form.append("Body", smsBody);
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tSid}/Messages.json`, {
              method: "POST",
              headers: { Authorization: `Basic ${btoa(`${tSid}:${tTok}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: form.toString(),
            }).catch(() => {});
          }
        }
      } catch (notifyErr) {
        console.error("[SPROCKET] intake notify error:", (notifyErr as Error).message);
      }

      return json({ ticketId: data.id, status: data.status });
    }

    // ------------------------------------------------------------------ chat
    // Sprocket's brain runs on OpenAI (the account that has billing). The same
    // OPENAI_API_KEY secret already powers ACE's onyx voice (tts mode above).
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({
        reply:
          "I'm not fully wired up yet, but here's a quick tip: if something looks stale, tap 'Refresh now'. For design help, try 'Upgrade my prompt'. Want me to file a ticket?",
      });
    }

    const history = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
    const chatMessages = history
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    // The client seeds the conversation with Sprocket's assistant greeting as the
    // first message. Drop any leading assistant turn(s) so the thread starts on a
    // real user message (cleaner input, and future-proof against providers that
    // require user-first).
    while (chatMessages.length && chatMessages[0].role === "assistant") {
      chatMessages.shift();
    }

    if (chatMessages.length === 0) {
      chatMessages.push({ role: "user", content: "Hi" });
    }

    const pageLine = page ? `  [The user is currently on: ${page}]` : "";
    const ctxLine =
      context && Object.keys(context).length
        ? `  [Context: ${JSON.stringify(context).slice(0, 500)}]`
        : "";

    // ACE on the customer proof portal talks like a real vehicle-wrap DESIGNER,
    // not the generic in-app help bot. The portal asks for this persona via
    // persona:"ace_designer" (and is on the /approve page).
    const isAceDesigner = body.persona === "ace_designer" || page === "/approve";
    const ACE_DESIGNER_PROMPT =
      "You are ACE, a warm, confident senior vehicle-wrap graphic designer talking directly " +
      "with a customer about THEIR wrap proof. Speak like a real designer — concrete and " +
      "visual: color, contrast, balance, hierarchy, and legibility from across a parking lot, " +
      "and how the art reads on the actual vehicle. Keep it short and conversational (1-3 " +
      "sentences). When they want a change, tell them you're on it and that they can just say " +
      "things like “make the logo bigger” or “darker background” and you'll apply it across " +
      "every angle. Never mention being an AI, support tickets, or refunds, and never use " +
      "markdown headers or bullet lists — just talk like a person.";

    // WePrintWraps knowledge ACE answers from — EXACT canonical pricing/facts.
    // For anything not listed, ACE points to the website's instant-price tool
    // (source of truth) and never invents specs.
    const WPW_KNOWLEDGE =
      "WEPRINTWRAPS KNOWLEDGE — use these EXACT prices and facts:\n" +
      "PRINTED FILM (price per sq ft; ALL include the customer's choice of gloss/matte/satin lamination; FREE shipping over $750):\n" +
      "• Avery MPI 1105 — $5.27/sq ft (best value)\n" +
      "• 3M IJ180Cv3 — $6.32/sq ft (premium)\n" +
      "• Avery Cut Contour — $5.92/sq ft\n" +
      "• 3M Cut Contour — $6.22/sq ft\n" +
      "• Window Perf — $5.32/sq ft\n" +
      "• Fade Wraps — starting at $600\n" +
      "DESIGN SERVICES: Custom design $750; File setup $50.\n" +
      "TO PRICE A WRAP: square feet × price per sq ft = total (example: 250 sq ft × $5.27 = $1,317.50). " +
      "Approx vehicle sq ft — Ford F-150 250, Chevy Silverado 260, RAM 1500 255, Toyota Tacoma 230, " +
      "Ford Transit Low 220, Ford Transit High 280, Sprinter Standard 240, Sprinter High 260, " +
      "Honda Civic 200, Toyota Camry 220, Chevy Tahoe 240, Ford Explorer 220, 12ft Box Truck 360, 16ft Box Truck 480.\n" +
      "TURNAROUND: production 1–2 business days, shipping 1–3 business days.\n" +
      "FILES: print-ready and built to size, minimum 200 dpi, CMYK preferred. WHAT WE WRAP: painted body panels — windows, lights, trim, and wheels stay factory unless specified.\n" +
      "Exact pricing is always instant on WePrintWraps.com (pick make+model, enter total sq ft, or enter panel dimensions). If something isn't covered here, send them there — never invent specs or quote numbers you don't have.";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [
          { role: "system", content: (isAceDesigner ? ACE_DESIGNER_PROMPT + "\n\n" + WPW_KNOWLEDGE : SYSTEM_PROMPT) + pageLine + ctxLine },
          ...chatMessages,
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[SPROCKET] OpenAI ${resp.status}: ${errText.slice(0, 200)}`);
      return json({
        reply:
          "I'm having a brief hiccup reaching my brain. Try again in a moment — or tap 'Send a ticket' and a human will jump in.",
      });
    }

    const data = await resp.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn't catch that — can you rephrase?";

    // Log EVERY chat (transcript persistence for the admin Sprocket page).
    // Best-effort — never block the reply on logging.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey && body.conversation_id) {
        const sb = createClient(supabaseUrl, serviceKey);
        const fullThread = [...chatMessages, { role: "assistant", content: reply }];
        const upsoldWpw = /weprintwraps|wpw|print it|production-ready/i.test(reply);
        await sb.from("helper_chats").upsert(
          {
            conversation_id: String(body.conversation_id),
            user_id: user.id || null,
            user_email: user.email || null,
            page,
            messages: fullThread,
            message_count: fullThread.length,
            upsold_wpw: upsoldWpw,
            updated_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
          },
          { onConflict: "conversation_id" },
        );
      }
    } catch (logErr) {
      console.error("[SPROCKET] chat log error:", (logErr as Error).message);
    }

    return json({ reply });
  } catch (e) {
    console.error("[SPROCKET] error:", (e as Error).message);
    return json({ reply: "Something went wrong on my end. Mind trying again?" }, 200);
  }
});
