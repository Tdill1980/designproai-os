/**
 * generate-brand-template — AI-build a REUSABLE template into a brand's library.
 *
 * The template library was upload-only: someone had to make a design in Canva
 * and import it. So brands nobody had got to (WrapTV, Ink & Edge) had NO
 * templates, and NO brand had a carousel folder at all — which is why
 * Autonomous mode falls back to a square static, or honestly skips.
 *
 * This closes that: pick a brand and a layout style, and it generates the
 * template and files it in `wrap-files/canva-templates/{brand}/{type}/`, the
 * exact place Content Studio and Autonomous mode already read from. Nothing
 * downstream needs to change — a generated template is indistinguishable from
 * an imported one.
 *
 * The two halves it composes already existed and had no consumer:
 *   _shared/brand-visuals.ts  — what the brand LOOKS like
 *   _shared/template-styles.ts — what the LAYOUT is (grid, us-vs-them, …)
 *
 * It generates BLANKS, not finished posts: every text zone carries realistic
 * placeholder copy, so `content-studio-ai-copy` in rewrite_template_image mode
 * can swap the words and keep the design. That is what makes one template
 * serve a hundred posts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";
import { getBrandVisual } from "../_shared/brand-visuals.ts";
import {
  TEMPLATE_STYLES, getTemplateStyle, buildTemplatePrompt,
} from "../_shared/template-styles.ts";

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const BUCKET = "wrap-files";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Brands that have a visual identity — the only ones we can generate for. */
const BRANDS = ["WePrintWraps", "RestyleProAI", "DesignProAI", "WrapTV", "InkAndEdge", "TheWrap"];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

/** One Gemini image generation. Returns raw bytes, or throws with the reason. */
async function generateImage(prompt: string, aspect: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${getGeminiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          // TEXT+IMAGE, not IMAGE alone — image-only suppresses output and
          // returns NO_IMAGE (the same trap documented in the render pipeline).
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: aspect, imageSize: "2K" },
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
  if (!img) {
    const finish = body?.candidates?.[0]?.finishReason || "no image part";
    throw new Error(`the model returned no image (${finish})`);
  }
  const b64 = img.inlineData.data as string;
  return {
    bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    mime: img.inlineData.mimeType || "image/png",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));

    // Discovery: the UI asks what it can generate rather than hardcoding a list.
    if (body?.action === "styles") {
      return json({
        brands: BRANDS,
        styles: TEMPLATE_STYLES.map((s) => ({
          key: s.key, label: s.label, purpose: s.purpose,
          folder: s.folder, aspect: s.aspect, slides: s.slides,
        })),
      });
    }

    const brand = String(body?.brand || "");
    const styleKey = String(body?.style || "");
    if (!BRANDS.includes(brand)) {
      return json({ error: `brand must be one of: ${BRANDS.join(", ")}` }, 400);
    }
    const style = getTemplateStyle(styleKey);
    if (!style) {
      return json({ error: `unknown style "${styleKey}" — call {action:"styles"} for the list` }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "storage is not configured on the server" }, 500);
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });

    const visual = getBrandVisual(brand);
    const folder = `canva-templates/${brand}/${style.folder}`;
    const stamp = Date.now();

    // A carousel is a SET — generate every slide, sequentially so one failure
    // doesn't leave a half-uploaded set racing the others.
    const total = style.slides;
    const made: { url: string; path: string; slide: number }[] = [];
    const failed: { slide: number; reason: string }[] = [];

    for (let i = 1; i <= total; i++) {
      const prompt = buildTemplatePrompt({
        brandName: visual.name,
        palette: visual.palette,
        typography: visual.typography,
        logoLockup: visual.logoLockup,
        aesthetic: visual.aesthetic,
        avoid: visual.avoid,
        style,
        slideIndex: total > 1 ? i : undefined,
      });

      try {
        const { bytes, mime } = await generateImage(prompt, style.aspect);
        const ext = (mime.split("/")[1] || "png").replace("jpeg", "jpg");
        const name = total > 1
          ? `${stamp}-${slugify(style.label)}-slide-${i}.${ext}`
          : `${stamp}-${slugify(style.label)}.${ext}`;
        const path = `${folder}/${name}`;
        const { error: upErr } = await db.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: mime, upsert: false });
        if (upErr) throw new Error(`upload failed: ${upErr.message}`);
        const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
        made.push({ url: pub.publicUrl, path, slide: i });
      } catch (e) {
        failed.push({ slide: i, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    // Honest partial result: say what landed AND what didn't, rather than
    // reporting success because something worked.
    return json({
      brand,
      style: style.key,
      folder: style.folder,
      requested: total,
      created: made.length,
      templates: made,
      failed,
      ok: made.length > 0,
      ...(made.length === 0
        ? { error: failed[0]?.reason || "nothing was generated" }
        : {}),
    }, made.length > 0 ? 200 : 502);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
