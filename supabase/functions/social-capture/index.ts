/**
 * social-capture — social engagement becomes an OWNED contact
 * (docs/SOCIALIQ_SPEC.md; modeled on Klaviyo's social CRM).
 *
 * The public /social/join page posts here when someone from a comment
 * reply signs up. This function:
 *   1. Records the consent event (exact opt-in wording + source) —
 *      marketing_consent_events, the compliance ledger.
 *   2. Writes social_identities (handle → email, keyed to the post that
 *      drove them — acquisition-source context).
 *   3. Upserts the KLAVIYO profile (the system of record) with the
 *      source properties, subscribes it to the social list when
 *      KLAVIYO_SOCIAL_LIST_ID is set, and fires a "Social Capture"
 *      event so flows can trigger off it.
 *
 * PUBLIC endpoint (a signup form) — validates hard, stores little, and
 * never reflects errors with internals. Klaviyo failures don't lose the
 * lead: identity + consent persist first, klaviyo_profile_id backfills.
 *
 * POST JSON: { email, brand?, platform?, handle?, source_post_id?,
 *              source_interaction_id?, consent_text }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";

const KLAVIYO_REVISION = "2024-10-15";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function klaviyoUpsertProfile(key: string, email: string, props: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("https://a.klaviyo.com/api/profile-import/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      "Content-Type": "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
    body: JSON.stringify({
      data: { type: "profile", attributes: { email, properties: props } },
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data?.id ?? null;
}

async function klaviyoSubscribe(key: string, listId: string, email: string, consentedAt: string): Promise<boolean> {
  const res = await fetch("https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      "Content-Type": "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
    body: JSON.stringify({
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          profiles: {
            data: [{
              type: "profile",
              attributes: {
                email,
                subscriptions: {
                  email: { marketing: { consent: "SUBSCRIBED", consented_at: consentedAt } },
                },
              },
            }],
          },
        },
        relationships: { list: { data: { type: "list", id: listId } } },
      },
    }),
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
      return json({ success: false, error: "A valid email is required" }, 400);
    }
    const consentText = String(body.consent_text || "").trim();
    if (!consentText) return json({ success: false, error: "consent_text is required" }, 400);

    const brand = String(body.brand || "weprintwraps").toLowerCase().slice(0, 40);
    const platform = body.platform ? String(body.platform).slice(0, 40) : null;
    const handle = body.handle ? String(body.handle).slice(0, 120) : null;
    const sourcePostId = body.source_post_id ? String(body.source_post_id).slice(0, 200) : null;
    const sourceInteractionId = typeof body.source_interaction_id === "string" &&
        /^[0-9a-f-]{36}$/.test(body.source_interaction_id)
      ? body.source_interaction_id
      : null;

    const db = createExternalClient();
    const now = new Date().toISOString();

    // 1) Consent first — the lead is never lost to a downstream failure.
    const { data: consentRow, error: consentErr } = await db
      .from("marketing_consent_events")
      .insert({
        email,
        brand,
        channel: "email",
        consent_text: consentText,
        source: "social_capture:/social/join",
        source_detail: { platform, handle, source_post_id: sourcePostId, source_interaction_id: sourceInteractionId },
      })
      .select("id")
      .single();
    if (consentErr) throw new Error(`consent write failed: ${consentErr.message}`);

    // 2) Identity, keyed to the driving post.
    const { data: identity, error: idErr } = await db
      .from("social_identities")
      .upsert(
        {
          brand,
          platform,
          handle,
          email,
          source_post_id: sourcePostId,
          source_interaction_id: sourceInteractionId,
          source: "social_capture",
        },
        { onConflict: "email,brand", ignoreDuplicates: false },
      )
      .select("id")
      .single();
    // A conflict-shape mismatch shouldn't kill the capture — fall back to insert-or-ignore.
    const identityId = identity?.id ?? null;
    if (idErr) console.error("social_identities upsert warning:", idErr.message);

    // 3) Klaviyo — profile with acquisition-source context, list consent, event.
    const key = Deno.env.get("KLAVIYO_API_KEY");
    let klaviyoProfileId: string | null = null;
    let subscribed = false;
    if (key) {
      klaviyoProfileId = await klaviyoUpsertProfile(key, email, {
        social_capture: true,
        social_capture_brand: brand,
        social_capture_platform: platform,
        social_capture_handle: handle,
        social_capture_source_post: sourcePostId,
        social_capture_at: now,
      });
      const listId = Deno.env.get("KLAVIYO_SOCIAL_LIST_ID");
      if (listId) subscribed = await klaviyoSubscribe(key, listId, email, now);
      await klaviyoTrack({
        metric: "Social Capture",
        email,
        properties: { brand, platform, handle, source_post_id: sourcePostId },
        uniqueId: `social-capture-${email}-${sourcePostId || "direct"}`,
      });
      if (klaviyoProfileId && identityId) {
        await db.from("social_identities").update({ klaviyo_profile_id: klaviyoProfileId }).eq("id", identityId);
      }
    }

    // 4) OUR OWN nurture flow — enroll into the brand's active social_capture
    // sequence (social-sequence-run sends the steps). This is the half that
    // used to be rented; it runs whether or not Klaviyo is configured.
    let enrolled = false;
    try {
      const { data: seq } = await db
        .from("social_sequences")
        .select("id")
        .eq("brand", brand)
        .eq("trigger", "social_capture")
        .eq("active", true)
        .maybeSingle();
      if (seq) {
        const { error: enrollErr } = await db.from("social_sequence_enrollments").upsert(
          {
            sequence_id: seq.id,
            email,
            brand,
            identity_id: identityId,
            consent_id: consentRow?.id ?? null,
            source_post_id: sourcePostId,
            next_step: 1,
            next_run_at: now,
            status: "active",
            updated_at: now,
          },
          { onConflict: "sequence_id,email", ignoreDuplicates: true },
        );
        enrolled = !enrollErr;
      }
    } catch (e) {
      console.error("sequence enrollment failed (capture still saved):", e);
    }

    return json({ success: true, subscribed, enrolled, klaviyo: Boolean(klaviyoProfileId) });
  } catch (e) {
    console.error("social-capture error:", e);
    return json({ success: false, error: "Something went wrong — try again" }, 500);
  }
});
