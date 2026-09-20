import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

interface TextPiece {
  id: string;
  kind: "logo" | "text";
  text: string;
  role?: string;
}

interface GenerateRequest {
  companyName?: string;
  pieces?: TextPiece[];
  brandColors?: string[];
  industry?: string;
  stylePrompt?: string;
  // The overall design brief (same text the background render gets). Used ONLY
  // to THEME the logo/mascot to the actual business — never copied as literal
  // on-vehicle text. Lets a sparse brief still yield a cohesive, on-industry
  // mark (e.g. "Bob's Courier Service … 24/7 fast delivery" → motion / speed /
  // delivery iconography) instead of a generic lockup.
  brief?: string;
  // Free-text color direction ("blue, red, green") for when the caller has no
  // strict #RRGGBB hex. The color intent otherwise never reaches Layer 2.
  colorBrief?: string;
}

export function buildPrompt(req: GenerateRequest, piece: TextPiece): string {
  const lines: string[] = [];
  lines.push(
    "You are a senior vehicle-wrap typographer. You design bold, legible, " +
      "professional lettering and logo lockups that read instantly from across a parking lot.",
  );
  lines.push("");
  if (piece.kind === "logo") {
    // A cohesive, PROFESSIONALLY DESIGNED brand logo (per product direction:
    // "a logo-style font, cohesive design branding" — NOT a generic font, NOT a
    // plain label, NOT a random cartoon mascot). Think real brand identity: custom
    // logo-style lettering with deliberate character, optionally paired with a
    // tasteful complementary mark that fits the brand (like the Summit Realty
    // chevron). Avoid the word "wordmark" in the instruction — it makes the model
    // fall back to a plain system font.
    lines.push(`TASK: Design a cohesive, professional brand LOGO for "${piece.text}".`);
    lines.push(
      "Draw the name in CUSTOM, distinctive LOGO-STYLE lettering — purposeful " +
        "letterforms, weight, spacing and balance that read as a deliberately " +
        "designed brand identity. NEVER use a generic, default or system font, and " +
        "NEVER render it as a plain text label.",
    );
    lines.push(
      "Add a clean, complementary mark or emblem when it strengthens the logo and " +
        "fits the brand — keep it tasteful and cohesive with the lettering (one " +
        "designed brand, not two parts). Do NOT add a cartoon mascot unless the " +
        "style direction below explicitly asks for one.",
    );
    // Theme the logo's design to what the business does so a sparse brief still
    // yields an on-brand identity — never render the brief as text.
    const businessCtx = [req.industry, req.brief].filter(Boolean).join(". ");
    if (businessCtx) {
      lines.push(
        `Theme the logo's style to this business (shape the lettering and any mark, ` +
          `do NOT render this as text): ${businessCtx}.`,
      );
    }
  } else {
    lines.push(`TASK: Set the following text as polished wrap lettering: "${piece.text}".`);
  }
  if (piece.role) lines.push(`This element is the ${piece.role}.`);
  if (req.companyName && req.companyName !== piece.text) {
    lines.push(`Company: ${req.companyName} (for context — only render the TASK text).`);
  }
  if (req.industry) lines.push(`Industry: ${req.industry}.`);
  // Brand colors: prefer strict hex, fall back to the free-text color brief so
  // a customer who typed "blue, red, green" still gets those colors in the mark.
  const colorLine = (req.brandColors && req.brandColors.length)
    ? req.brandColors.join(", ")
    : (req.colorBrief || "").trim();
  if (colorLine) lines.push(`Use these brand colors: ${colorLine}.`);
  if (req.stylePrompt) lines.push(`Style direction: ${req.stylePrompt}.`);
  lines.push("");
  lines.push("REQUIREMENTS:");
  // Gemini cannot emit a real alpha channel — if asked for "transparent" it bakes
  // a white/checkerboard backdrop. So we demand a FLAT magenta chroma key here and
  // remove it to true transparency after generation (chromaKeyToAlpha).
  lines.push("- BACKGROUND: one SOLID, FLAT, UNIFORM pure magenta fill (#FF00FF, RGB 255/0/255) covering the ENTIRE frame edge to edge. It is a chroma-key backdrop that will be removed — so it MUST be a single flat magenta, NOT a checkerboard, white, gradient, shadow, or any texture.");
  lines.push("- Do NOT use magenta or hot pink ANYWHERE in the artwork itself (it would be keyed out). Use the brand colors for the design.");
  lines.push("- Render ONLY the requested text/logo — nothing else, no extra words.");
  lines.push("- Sharp, balanced, high-contrast type that stays legible when small.");
  lines.push("- Flat 2D design. No mockups, no vehicle, no scene, no drop shadow.");
  lines.push("- Fill most of the frame with the artwork — minimal even magenta margin.");
  lines.push("- Spelling must be EXACT — do not alter the supplied text.");
  lines.push("");
  lines.push("OUTPUT: the single element centered on a flat pure-magenta background.");
  const out = lines.join("\n");
  return out.length > 3000 ? out.slice(0, 3000) : out;
}

// ── Chroma key → TRUE transparency ──────────────────────────────────────────
// Gemini bakes a background instead of emitting alpha, so we render the art on a
// flat magenta backdrop (see buildPrompt) and remove it here: every magenta-ish
// pixel becomes fully transparent, then we tight-crop to the remaining artwork.
// Pure Deno (imagescript) — no sharp, no extra service. The result is a real
// alpha PNG the canvas + GENIE panelizer can composite, not an opaque block.
export async function chromaKeyToAlpha(pngBytes: Uint8Array, strict = false): Promise<Uint8Array> {
  let img: any;
  try {
    img = await Image.decode(pngBytes);
  } catch {
    if (strict) throw new Error("proof_logo_image_unreadable");
    return pngBytes; // undecodable — keep original rather than lose the art
  }
  const W = img.width as number;
  const H = img.height as number;
  const bmp = img.bitmap as Uint8ClampedArray; // RGBA, length W*H*4
  let minX = W, minY = H, maxX = -1, maxY = -1;
  let transparent = 0;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const r = bmp[i], g = bmp[i + 1], b = bmp[i + 2];
    // magenta backdrop: strong red + strong blue, weak green
    if (r > 140 && b > 140 && g < 120) {
      bmp[i + 3] = 0; // → fully transparent
      transparent++;
    } else {
      const x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Nothing survived (all magenta?) — return the keyed full frame as-is.
  if (strict && (!transparent || maxX < minX || maxY < minY)) throw new Error("proof_logo_alpha_invalid");
  if (maxX < minX || maxY < minY) return await img.encode();
  // Tight crop to the artwork with a small even margin.
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  try {
    img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
  } catch { /* keep uncropped if crop fails */ }
  return await img.encode();
}
