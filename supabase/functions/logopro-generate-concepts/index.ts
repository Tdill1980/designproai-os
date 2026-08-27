// ============================================================================
// logopro-generate-concepts
// ============================================================================
// Creates a new logopro_projects row, then generates 4 logo concepts via
// Gemini Nano Banana Pro (gemini-3-pro-image-preview) in parallel — the
// professional-asset model with high-fidelity text rendering for logos.
// Concepts are uploaded to the logopro-concepts storage bucket and recorded
// in the logopro_concepts table.
//
// Auth: JWT required. Caller must be a member of the resolved shop.
// Tier: requires "complete" tier or higher (DesignPro).
//
// Request:
//   {
//     companyName: string                 (required, ≤100 chars)
//     industry?: string
//     mascotDescription?: string          (≤500 chars)
//     brandColors?: string[]              (≤3 hex strings)
//     keywords?: string[]                 (≤5)
//     phone?: string
//     website?: string
//     sourceDesignProProjectId?: string   (UUID)
//   }
//
// Response:
//   200 OK
//   {
//     projectId: uuid,
//     concepts: [{ conceptNumber, imageUrl }],
//     partialFailure?: boolean
//   }
//
//   401 Unauthenticated, 403 Tier denied, 400 Bad input,
//   404 Shop not found, 500 Internal, 502 Gemini all-failed
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createExternalAnonClient,
  createExternalClient,
  getExternalSupabaseUrl,
  getExternalAnonKey,
} from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const ALLOWED_TIERS = ["complete", "agency"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GenerateRequest {
  companyName?: string;
  industry?: string;
  mascotDescription?: string;
  brandColors?: string[];
  keywords?: string[];
  phone?: string;
  website?: string;
  sourceDesignProProjectId?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VARIATIONS = [
  "Icon stacked above the company name. Icon takes ~60% visual weight, type takes ~40%.",
  "Icon to the LEFT of the company name, horizontally aligned. Equal visual weight.",
  "Name-led design — the company name is the dominant element with a small supporting icon or graphic flourish.",
  "Badge/emblem style — icon and type combined inside a circular or shield-shaped containing form.",
];

function buildPrompt(req: GenerateRequest, variation: string): string {
  const lines: string[] = [];
  lines.push(
    `You are a senior brand identity designer with 20 years of experience creating memorable logos for service businesses including ${
      req.industry || "trade and service"
    } companies. Your logos read clearly at small sizes, work in single color, and feel both professional and distinctive.`,
  );
  lines.push("");
  lines.push("TASK: Design a logo for the company below.");
  lines.push("");
  lines.push(`COMPANY: ${req.companyName}`);
  lines.push(`INDUSTRY: ${req.industry || "general trade/service"}`);
  if (req.mascotDescription) lines.push(`MASCOT/ICON: ${req.mascotDescription}`);
  if (req.brandColors && req.brandColors.length) {
    lines.push(`BRAND COLORS: ${req.brandColors.join(", ")}`);
  }
  if (req.keywords && req.keywords.length) {
    lines.push(`BRAND PERSONALITY: ${req.keywords.join(", ")}`);
  }
  lines.push("");
  lines.push("DESIGN REQUIREMENTS:");
  lines.push("- Clean, modern logo on a pure white background");
  lines.push(
    "- Logo composition includes BOTH an icon/mark AND the company name as legible typography",
  );
  lines.push("- Typography is sharp, balanced, and reads clearly even when small");
  if (req.mascotDescription) {
    lines.push(`- Mascot/icon should match the description: ${req.mascotDescription}`);
  }
  if (req.brandColors && req.brandColors.length) {
    lines.push("- Use only the specified brand colors plus white/black for contrast");
  }
  const kwLower = (req.keywords || []).map((k) => k.toLowerCase());
  if (kwLower.includes("minimalist") || kwLower.includes("modern")) {
    lines.push("- Keep it minimal, no decorative flourishes");
  }
  if (kwLower.includes("bold") || kwLower.includes("rugged")) {
    lines.push("- Use thicker strokes and stronger contrast");
  }
  lines.push("- Centered composition, ample white space around the mark");
  lines.push("- No background patterns, no scenes, no environments — pure logo on white");
  lines.push("- No mockups, no shadows, no 3D effects — flat 2D logo design");
  lines.push("");
  lines.push(`VARIATION: ${variation}`);
  lines.push("");
  lines.push(
    "OUTPUT: Single high-resolution logo, square format, suitable for use across business cards, signage, and vehicle wraps.",
  );

  const out = lines.join("\n");
  return out.length > 3500 ? out.slice(0, 3500) : out;
}

async function callGemini(prompt: string): Promise<{ pngBytes: Uint8Array } | { error: string }> {
  if (!hasGeminiKey()) return { error: "no_gemini_key" };
  const key = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err: any) {
    return { error: `network: ${err?.message || String(err)}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `gemini_${resp.status}: ${text.slice(0, 200)}` };
  }

  const result = await resp.json();
  const parts = result?.candidates?.[0]?.content?.parts;
  let imageBase64: string | null = null;
  if (parts) {
    for (const part of parts) {
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }
  }
  if (!imageBase64) return { error: "no_image_returned" };

  const binaryString = atob(imageBase64);
  const pngBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pngBytes[i] = binaryString.charCodeAt(i);
  }
  return { pngBytes };
}

function validate(req: GenerateRequest): string | null {
  if (!req.companyName || typeof req.companyName !== "string") return "companyName is required";
  if (req.companyName.length > 100) return "companyName ≤ 100 chars";
  if (req.industry && req.industry.length > 100) return "industry ≤ 100 chars";
  if (req.mascotDescription && req.mascotDescription.length > 500) {
    return "mascotDescription ≤ 500 chars";
  }
  if (req.brandColors) {
    if (!Array.isArray(req.brandColors) || req.brandColors.length > 3) {
      return "brandColors must be array ≤ 3";
    }
    for (const c of req.brandColors) {
      if (!HEX_RE.test(c)) return `brandColor "${c}" must be hex like #RRGGBB`;
    }
  }
  if (req.keywords) {
    if (!Array.isArray(req.keywords) || req.keywords.length > 5) {
      return "keywords must be array ≤ 5";
    }
  }
  if (req.sourceDesignProProjectId && !UUID_RE.test(req.sourceDesignProProjectId)) {
    return "sourceDesignProProjectId must be UUID";
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const anonClient = createExternalAnonClient();
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid token" }, 401);
    const user = userData.user;

    // 2. Parse + validate
    const body: GenerateRequest = await req.json();
    const validationError = validate(body);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    // 3. Service-role client for DB ops (function has already verified user identity)
    const sb = createExternalClient();

    // 4. Resolve user's shop. v1 assumes one membership; pick the first.
    const { data: memberRows, error: memberErr } = await sb
      .from("shop_members")
      .select("shop_id")
      .eq("user_id", user.id)
      .limit(1);
    if (memberErr) {
      console.error("[logopro-generate-concepts] shop_members query failed", memberErr);
      return jsonResponse({ error: "shop_lookup_failed" }, 500);
    }
    if (!memberRows || memberRows.length === 0) {
      return jsonResponse({ error: "User is not a member of any shop" }, 404);
    }
    const shopId = memberRows[0].shop_id;

    // 5. Tier gate
    const { data: roleRows } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    const isPrivileged = roles.includes("admin") || roles.includes("tester") || roles.includes("designer");

    if (!isPrivileged) {
      const { data: subRow } = await sb
        .from("user_subscriptions")
        .select("tier, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      const tier = subRow?.tier || "free";
      if (!ALLOWED_TIERS.includes(tier)) {
        return jsonResponse(
          {
            error: "LogoPro requires DesignPro tier or higher",
            currentTier: tier,
            upgradeUrl: "/pricing",
          },
          403,
        );
      }
    }

    // 6. Insert project row (status: generating_concepts)
    const { data: projectRow, error: insertErr } = await sb
      .from("logopro_projects")
      .insert({
        shop_id: shopId,
        user_id: user.id,
        company_name: body.companyName,
        industry: body.industry || null,
        mascot_description: body.mascotDescription || null,
        brand_colors: body.brandColors || [],
        keywords: body.keywords || [],
        phone: body.phone || null,
        website: body.website || null,
        status: "generating_concepts",
        source_designpro_project_id: body.sourceDesignProProjectId || null,
      })
      .select("id")
      .single();
    if (insertErr || !projectRow) {
      console.error("[logopro-generate-concepts] insert failed", insertErr);
      return jsonResponse({ error: "project_insert_failed" }, 500);
    }
    const projectId = projectRow.id;

    // 7. Generate 4 concepts in parallel.
    // Retry each concept once on failure — a single transient Gemini hiccup
    // (timeout, no_image_returned, 5xx) was permanently dropping a concept,
    // surfacing as "showing 3 of 4".
    const prompts = VARIATIONS.map((v) => buildPrompt(body, v));
    const callWithRetry = async (p: string) => {
      let res = await callGemini(p);
      if ("error" in res) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await callGemini(p);
      }
      return res;
    };
    const results = await Promise.allSettled(prompts.map(callWithRetry));

    // 8. Upload + record successful concepts
    const concepts: { conceptNumber: number; imageUrl: string }[] = [];
    const supabaseUrl = getExternalSupabaseUrl();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const conceptNumber = i + 1;
      if (r.status !== "fulfilled" || "error" in r.value) {
        const reason = r.status === "rejected" ? r.reason : (r.value as any).error;
        console.warn(`[logopro-generate-concepts] concept ${conceptNumber} failed:`, reason);
        continue;
      }
      const path = `${shopId}/${projectId}/concept-${conceptNumber}.png`;
      const { error: uploadErr } = await sb.storage
        .from("logopro-concepts")
        .upload(path, r.value.pngBytes, {
          contentType: "image/png",
          upsert: true,
        });
      if (uploadErr) {
        console.error(`[logopro-generate-concepts] upload ${conceptNumber} failed`, uploadErr);
        continue;
      }
      const imageUrl = `${supabaseUrl}/storage/v1/object/public/logopro-concepts/${path}`;
      const { error: conceptInsertErr } = await sb.from("logopro_concepts").insert({
        project_id: projectId,
        shop_id: shopId,
        concept_number: conceptNumber,
        image_url: imageUrl,
        prompt_used: prompts[i],
        generation_metadata: { model: GEMINI_MODEL, variation_index: i },
      });
      if (conceptInsertErr) {
        console.error("[logopro-generate-concepts] concept insert failed", conceptInsertErr);
        continue;
      }
      concepts.push({ conceptNumber, imageUrl });
    }

    // 9. Update project status
    if (concepts.length === 0) {
      await sb.from("logopro_projects").update({ status: "failed" }).eq("id", projectId);
      return jsonResponse({ error: "all_concepts_failed", projectId }, 502);
    }

    await sb
      .from("logopro_projects")
      .update({ status: "concepts_ready" })
      .eq("id", projectId);

    return jsonResponse({
      projectId,
      concepts,
      partialFailure: concepts.length < 4,
    });
  } catch (err: any) {
    console.error("[logopro-generate-concepts] unhandled", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
