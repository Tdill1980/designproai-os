/**
 * captionRefine — AI help for the HOOK and the POST CAPTION, on demand.
 *
 * Used by the Brand Board's back-catalog upload door and by the card detail
 * dialog. Two jobs:
 *   - `writeCaption`  — nothing usable exists yet (an old reel with no copy,
 *     or copy that was never written down). Writes a hook + caption from
 *     scratch, grounded in the actual image when there is one to read.
 *   - `refineCaption` — copy exists but is weak. The reviewer types a plain
 *     instruction ("punchier", "cut the emoji", "add a CTA") and it rewrites.
 *
 * ── PROPOSALS ONLY ─────────────────────────────────────────────────────────
 * Neither function writes to the database. They return text; the human reads
 * it, edits it, and saves it. That is the whole point of routing this through
 * a review board — an AI rewrite that saved itself would be an AI edit of
 * published brand copy with nobody in the loop. Locked by
 * `tests/brand-board-upload.test.ts`, which fails if this module gains a
 * Supabase table write.
 */

import { supabase } from "@/integrations/supabase/client";

/** Board brand slug → the brand name the copy brains expect. */
const COPY_BRAND: Record<string, string> = {
  weprintwraps: "WePrintWraps",
  restylepro: "RestyleProAI",
  designproai: "DesignProAI",
  wraptvworld: "WrapTV",
  wraptv: "WrapTV",
  inkandedge: "InkAndEdge",
  thewrap: "TheWrap",
  creatormarket: "CreatorMarket",
};

export function copyBrandName(slug?: string | null): string {
  return COPY_BRAND[(slug || "").toLowerCase()] || "RestyleProAI";
}

/** The hook registers the copy brain knows (see _shared/content-hook-recipes.ts). */
export const HOOK_TYPES = [
  { key: "pain_aware", label: "Pain-aware" },
  { key: "education_first", label: "Education-first" },
  { key: "us_vs_them", label: "Old way / new way" },
  { key: "feature_callout", label: "Feature callout" },
] as const;

export type HookTypeKey = (typeof HOOK_TYPES)[number]["key"];

export interface CaptionDraft {
  hook: string;
  headline: string;
  body: string;
  cta: string;
  /** hook + body + cta, assembled — what actually goes in the caption box. */
  caption: string;
}

export interface WriteCaptionInput {
  brand: string;
  /** A still the model can read. Null for video-only — see below. */
  imageUrl?: string | null;
  /** "Reel" | "Post" | "Carousel" | "YouTube Thumbnail". */
  format?: string;
  hookType?: HookTypeKey;
  /** What the piece actually shows — the operator's own words. */
  context?: string;
  /** The brand's tested hooks (content_hooks), so new copy matches them. */
  hooksLibrary?: string[];
}

function assembleCaption(parts: { hook?: string; body?: string; cta?: string }): string {
  return [parts.hook, parts.body, parts.cta].map((s) => (s || "").trim()).filter(Boolean).join("\n\n");
}

/**
 * Write a hook + caption for a piece that has none.
 *
 * When `imageUrl` is a real still the copy is grounded in what the image
 * actually shows. A video upload has no frame to send, so this degrades to
 * text-only rather than pretending the model watched the footage — which is
 * why the caller should pass a `context` line for video.
 */
export async function writeCaption(input: WriteCaptionInput): Promise<CaptionDraft> {
  const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
    body: {
      brand: copyBrandName(input.brand),
      format: input.format || "Post",
      tone: "punchy",
      hookType: input.hookType || "pain_aware",
      imageUrl: input.imageUrl || undefined,
      context: input.context || undefined,
      hooksLibrary: input.hooksLibrary?.length ? input.hooksLibrary : undefined,
    },
  });
  if (error) throw new Error(error.message || "Copy generation failed");
  if (data?.error) throw new Error(String(data.error));

  const draft: CaptionDraft = {
    hook: String(data?.hook || ""),
    headline: String(data?.headline || ""),
    body: String(data?.body || ""),
    cta: String(data?.cta || ""),
    caption: "",
  };
  draft.caption = assembleCaption(draft);
  if (!draft.caption) throw new Error("the AI returned no copy — add a line of context and try again");
  return draft;
}

export interface RefineCaptionInput {
  brand: string;
  caption: string;
  /** Plain English: "punchier", "shorter, drop the emoji", "add a CTA". */
  instruction: string;
}

export interface RefinedCaption {
  caption: string;
  hashtags: string[];
}

/**
 * Rewrite existing copy to an instruction, in the brand voice.
 *
 * Goes through `marketing-agent revise_copy`, whose system prompt forbids
 * inventing facts, names, numbers, or prices — important here, because the
 * source material is old content whose real details the model does not know.
 */
export async function refineCaption(input: RefineCaptionInput): Promise<RefinedCaption> {
  const instruction = (input.instruction || "").trim();
  if (!instruction) throw new Error("tell it what to change first");

  const { data, error } = await supabase.functions.invoke("marketing-agent", {
    body: {
      action: "revise_copy",
      brand: (input.brand || "restylepro").toLowerCase(),
      caption: input.caption || "",
      instruction,
    },
  });
  if (error) throw new Error(error.message || "Refine failed");
  if (data?.error) throw new Error(String(data.error));

  const caption = String(data?.caption || "");
  if (!caption) throw new Error("the AI returned no revision — try a more specific instruction");
  return {
    caption,
    hashtags: Array.isArray(data?.hashtags) ? data.hashtags.map(String) : [],
  };
}

/**
 * The brand's own tested hooks, to model new copy on. Read-only; returns []
 * rather than throwing, since missing hooks degrade the copy but must never
 * block an upload.
 */
export async function loadHooksLibrary(brand: string, limit = 40): Promise<string[]> {
  try {
    const { data } = await (supabase as any)
      .from("content_hooks")
      .select("hook_text, text, brand, active")
      .eq("active", true)
      .limit(200);
    return (data || [])
      .filter((h: { brand?: string }) => !h.brand || h.brand.toLowerCase() === (brand || "").toLowerCase())
      .map((h: { hook_text?: string; text?: string }) => h.hook_text || h.text || "")
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}
