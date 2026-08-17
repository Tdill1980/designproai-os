// cs-followup-drafts — turn quotes that went quiet into drafted follow-up
// emails waiting for one click of approval.
//
// WHY THIS EXISTS. The Platform Director's CS agent writes tasks like "follow
// up on Eric Edwards' Ram 1500 quote" into `slack_agent_tasks`. On 2026-08-12
// that queue held 1,236 pending items going back to April with EIGHT ever
// completed — real customers with real quotes, in a list nobody works, because
// every item required a human to go compose the email by hand. Meanwhile the
// Lead Replies dashboard has a workflow the owner uses daily: read a drafted
// reply, click Approve & Send. This bridges the two.
//
// IT NEVER SENDS. It stages drafts through lead-inbox-agent's `ingest_draft`,
// which files them as `pending_review` exactly like an inbound reply. A human
// still approves every one.
//
// IT DRAFTS FROM THE QUOTE, NOT FROM THE TASK TEXT. The CS tasks are AI-written
// prose; parsing a name out of them invites confusing two customers. The quote
// row is the fact: real customer, real quote number, real vehicle, real total.
// The task is only used to mark work as picked up.
//
// POST { action: "scan", minAgeDays?, maxAgeDays?, limit?, dryRun? }
// POST { action: "preview" }   — same selection, no drafting, no writes
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The Lead Replies queue lives on the WrapCommand project. Public anon key +
// shared token, the same trust model quickquote-intake uses in reverse.
const LEAD_AGENT_URL = "https://qxllysilzonrlyoaomce.supabase.co/functions/v1/lead-inbox-agent";
const LEAD_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4bGx5c2lsem9ucmx5b2FvbWNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMzQxMjIsImV4cCI6MjA4MzgxMDEyMn0.s1IyOY7QAVyrTtG_XLhugJUvxi2X_nHCvqvchYCvwtM";
const INGEST_TOKEN = "wpwfollowup_ai_5c71e0ab";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VOICE = `You are the ASSISTANT TO THE FOUNDER (Trish) at We Print Wraps, writing a SHORT follow-up on a quote the customer has not responded to.

- Open on their first name, then get to the point in the first sentence. No "I hope this finds you well."
- 3 short paragraphs maximum. Write like a person talks, contractions fine.
- Reference the ACTUAL quote — the vehicle and the number — so it reads like a human who remembers them, not a drip campaign.
- NEVER invent anything: no delivery dates, no order numbers, no discounts beyond what you are given, no claims about what they said. If you don't have a detail, leave it out.
- NEVER state how long a wrap, film or laminate LASTS. No "7-10 years", no "5-7 years", no "fades in 12-24 months", no lifespan range in any form, however hedged. Owner instruction, 2026-08-12: a lifespan we type into a sales email is a performance warranty we never issued, and it is read as one by exactly the buyers who matter most. Say what laminate DOES (protects the print from abrasion and UV) and point the customer at the film manufacturer's own published warranty for durability. Durability numbers are theirs to publish, not ours to promise.
- Do not be pushy or guilt-trippy ("just circling back", "checking in again"). Offer something useful: answer a question, confirm the price still stands, ask what would help them decide.
- End with EXACTLY ONE bare sign-off word line — "Thanks!" or "Best," — and nothing after it. The system appends the branded signature.
- Simple HTML: <p> paragraphs only. No links (the system appends the order button), no images, no placeholders like [Name].

Return ONLY JSON: {"subject": "...", "body_html": "..."}`;

async function draftFollowUp(q: Record<string, unknown>) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ");
  const prompt = `${VOICE}

THE QUOTE (these are facts — use them, do not embellish):
Customer: ${q.customer_name}
Quote number: ${q.quote_number}
${vehicle ? `Vehicle: ${vehicle}` : ""}
Material: ${q.material || "printed wrap film"}
Square footage: ${q.sq_ft}
Total quoted: $${Number(q.customer_total).toLocaleString("en-US")}
Quoted on: ${String(q.created_at).slice(0, 10)} (${q.age_days} days ago)

Write the follow-up.`;
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`openai: ${JSON.stringify(data).slice(0, 160)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "preview";
    const minAgeDays = Number(body.minAgeDays ?? 3);
    // Don't chase quotes so old the customer has forgotten asking — that reads
    // as spam, not service.
    const maxAgeDays = Number(body.maxAgeDays ?? 45);
    const limit = Math.min(Number(body.limit) || 10, 25);
    const dryRun = action === "preview" || body.dryRun === true;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const nowMs = Date.now();
    const { data: rows, error } = await db
      .from("quotes")
      .select("id, quote_number, customer_id, vehicle_year, vehicle_make, vehicle_model, sq_ft, customer_total, status, created_at, order_id, is_test, metadata, customers(name, email)")
      .is("order_id", null)
      .not("customer_id", "is", null)
      .gte("created_at", new Date(nowMs - maxAgeDays * 864e5).toISOString())
      .lte("created_at", new Date(nowMs - minAgeDays * 864e5).toISOString())
      .order("customer_total", { ascending: false })
      .limit(200);
    if (error) throw error;

    // TEST/DEMO EXCLUSION — the first live preview returned SIX candidates and
    // every one was a seeded demo: quote numbers DEMO-2607xx, all to
    // demo@restylepro.ai, all the same 2024 BMW M4 at $2,373. `is_test` was
    // false on all of them, so the obvious flag caught nothing. Without this
    // filter the first real run would have drafted six follow-ups to our own
    // demo address and filed them in the owner's approval queue as if they
    // were customers. (It also explains a Platform Director CS task about a
    // "high-value 2024 BMW M4 quote" — that task is about demo data too.)
    const INTERNAL = /@(restylepro\.ai|restyleproai\.com|weprintwraps\.com|loopmighty\.com)$/i;
    const FAKE_EMAIL = /^(demo|test|example|sample|noreply|no-reply)[@+._-]/i;
    const candidates = (rows || [])
      .filter((r: any) => !r.is_test)
      .filter((r: any) => !/^(DEMO|TEST|SAMPLE)[-_]/i.test(String(r.quote_number || "")))
      .filter((r: any) => {
        const e = String(r.customers?.email || "").toLowerCase();
        return !INTERNAL.test(e) && !FAKE_EMAIL.test(e);
      })
      .filter((r: any) => Number(r.customer_total) > 0 && Number(r.sq_ft) > 0)
      .filter((r: any) => String(r.customers?.email || "").includes("@"))
      // A won/cancelled quote is finished business.
      .filter((r: any) => !["won", "converted", "cancelled", "rejected"].includes(String(r.status || "").toLowerCase()))
      .map((r: any) => ({
        quote_id: r.id,
        quote_number: r.quote_number,
        customer_name: r.customers?.name || r.customers?.email,
        customer_email: String(r.customers.email).toLowerCase(),
        vehicle_year: r.vehicle_year, vehicle_make: r.vehicle_make, vehicle_model: r.vehicle_model,
        sq_ft: r.sq_ft, customer_total: r.customer_total, created_at: r.created_at,
        material: (r.metadata as any)?.material || null,
        age_days: Math.floor((nowMs - new Date(r.created_at).getTime()) / 864e5),
      }))
      .slice(0, limit);

    if (dryRun) {
      return json({ success: true, dry_run: true, considered: rows?.length || 0, candidates });
    }

    const results: unknown[] = [];
    for (const c of candidates) {
      try {
        const draft = await draftFollowUp(c as any);
        if (!draft?.body_html) throw new Error("model returned no body");
        const res = await fetch(LEAD_AGENT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${LEAD_ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ingest_draft",
            token: INGEST_TOKEN,
            to_email: c.customer_email,
            to_name: c.customer_name,
            subject: draft.subject || `Following up on quote ${c.quote_number}`,
            body_html: draft.body_html,
            source: "cs-followup-drafts",
            // Keyed to the QUOTE, so the same quote can never be staged twice.
            source_ref: c.quote_id,
            summary: `Follow-up on quote ${c.quote_number} — ${c.sq_ft} sq ft, $${Number(c.customer_total).toLocaleString("en-US")}, quoted ${c.age_days} days ago and no reply.`,
          }),
        });
        const out = await res.json();
        results.push({ quote: c.quote_number, customer: c.customer_email, ...out });
      } catch (e) {
        results.push({ quote: c.quote_number, customer: c.customer_email, success: false, error: String(e).slice(0, 160) });
      }
    }

    const staged = results.filter((r: any) => r.success && !r.skipped).length;
    const skipped = results.filter((r: any) => r.skipped).length;
    return json({ success: true, considered: rows?.length || 0, staged, skipped, results });
  } catch (error) {
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
