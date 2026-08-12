/**
 * Canva -> BrandBoard boundary.
 *
 * A Canva request never creates an approval side channel. The canonical
 * agent_social_posts draft is written first, its id is sent to the edge
 * function, and the edge function may only attach Canva output to that same
 * draft. BrandBoard remains the only approval/publish boundary.
 */

import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export const CANVA_BRANDBOARD_BRANDS = ["designproai", "weprintwraps"] as const;
export type CanvaBrandBoardBrand = (typeof CANVA_BRANDBOARD_BRANDS)[number];
export type CanvaBrandBoardKind = "image" | "reel";
export type CanvaBrandBoardState = "exported_static" | "editable_reel" | "editable_design";

export interface CanvaBrandBoardResult {
  postId: string;
  brand: CanvaBrandBoardBrand;
  templateId: string | null;
  designId: string;
  editUrl: string | null;
  viewUrl: string | null;
  thumbnailUrl: string | null;
  url: string | null;
  state: CanvaBrandBoardState;
  publishable: boolean;
}

export interface CreateCanvaBrandBoardDraftInput {
  brand: string;
  kind: CanvaBrandBoardKind;
  caption: string;
  hashtags?: string[];
  createdBy?: string;
  source?: { table: "video_render_jobs" | "agent_media_assets"; id: string; brand: string } | null;
  fanoutPiece?: string;
  narrativeId?: string;
}

export function canonicalCanvaBrandBoardBrand(value: unknown): CanvaBrandBoardBrand | null {
  const brand = String(value || "").trim().toLowerCase();
  return (CANVA_BRANDBOARD_BRANDS as readonly string[]).includes(brand)
    ? brand as CanvaBrandBoardBrand
    : null;
}

function stringOrNull(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

/**
 * Normalize connector-era camelCase, edge-function snake_case, and the older
 * nested `design` envelope exactly once, at the client boundary.
 */
export function normalizeCanvaBrandBoardResult(payload: unknown): CanvaBrandBoardResult {
  const outer = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = outer.design && typeof outer.design === "object"
    ? outer.design as Record<string, unknown>
    : {};
  const value = { ...outer, ...nested };

  const brand = canonicalCanvaBrandBoardBrand(
    value.canonical_brand ?? value.canonicalBrand ?? value.brand,
  );
  const postId = stringOrNull(value.post_id ?? value.postId ?? value.social_post_id);
  const designId = stringOrNull(value.design_id ?? value.designId);
  const state = stringOrNull(value.state) as CanvaBrandBoardState | null;
  if (!brand || !postId || !designId || !state) {
    throw new Error("Canva returned an incomplete BrandBoard result.");
  }
  if (!["exported_static", "editable_reel", "editable_design"].includes(state)) {
    throw new Error(`Canva returned an unsupported design state: ${state}`);
  }

  const url = stringOrNull(value.url);
  const publishable = value.publishable === true;
  if (state === "editable_reel" && (url !== null || publishable)) {
    throw new Error("An editable Canva Reel cannot be treated as publishable media.");
  }

  return {
    postId,
    brand,
    templateId: stringOrNull(value.template_id ?? value.templateId),
    designId,
    editUrl: stringOrNull(value.edit_url ?? value.editUrl),
    viewUrl: stringOrNull(value.view_url ?? value.viewUrl),
    thumbnailUrl: stringOrNull(value.thumbnail_url ?? value.thumbnailUrl),
    url,
    state,
    publishable,
  };
}

export async function createCanvaBrandBoardDraft(
  input: CreateCanvaBrandBoardDraftInput,
): Promise<{ id: string; brand: CanvaBrandBoardBrand }> {
  const brand = canonicalCanvaBrandBoardBrand(input.brand);
  if (!brand) throw new Error("Canva BrandBoard supports only DesignProAI and WePrintWraps.");

  const sourceBrand = input.source ? canonicalCanvaBrandBoardBrand(input.source.brand) : brand;
  if (input.source && sourceBrand !== brand) {
    throw new Error("The Canva source and BrandBoard draft must belong to the same brand.");
  }

  const { data, error } = await db.from("agent_social_posts").insert({
    brand,
    platform: "instagram",
    post_type: input.kind === "reel" ? "reel" : "feed",
    caption: String(input.caption || "").trim(),
    hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
    media_urls: [],
    status: "draft",
    scheduled_date: null,
    posted_date: null,
    created_by: input.createdBy || "canva-brandboard",
    generation_meta: {
      approval_boundary: "brandboard",
      source: input.source || null,
      ...(input.source?.table === "video_render_jobs" ? { source_render_job: input.source.id } : {}),
      ...(input.fanoutPiece ? { fanout_piece: input.fanoutPiece } : {}),
      ...(input.narrativeId ? { narrative_id: input.narrativeId } : {}),
      canva: {
        state: "requested",
        publishable: false,
        requires_brandboard_approval: true,
      },
    },
  }).select("id, brand").single();
  if (error || !data?.id) throw new Error(error?.message || "Could not create the BrandBoard draft.");
  return { id: String(data.id), brand };
}

export async function requestCanvaBrandBoardDesign(input: {
  postId: string;
  brand: string;
  kind: CanvaBrandBoardKind;
  headline: string;
  subhead?: string;
  cta?: string;
}): Promise<CanvaBrandBoardResult> {
  const brand = canonicalCanvaBrandBoardBrand(input.brand);
  if (!brand) throw new Error("Canva BrandBoard supports only DesignProAI and WePrintWraps.");
  const { data, error } = await supabase.functions.invoke("canva-brandboard", {
    body: {
      action: "design",
      post_id: input.postId,
      brand,
      kind: input.kind,
      headline: input.headline,
      subhead: input.subhead,
      cta: input.cta,
    },
  });
  if (error || data?.ok !== true) {
    throw new Error(error?.message || data?.error || "Canva could not prepare this BrandBoard draft.");
  }
  const result = normalizeCanvaBrandBoardResult(data);
  if (result.postId !== input.postId || result.brand !== brand) {
    throw new Error("Canva returned a result for a different BrandBoard draft or brand.");
  }
  return result;
}

export async function getCanvaBrandBoardLink(input: {
  postId: string;
  brand: string;
  designId: string;
}): Promise<CanvaBrandBoardResult> {
  const brand = canonicalCanvaBrandBoardBrand(input.brand);
  if (!brand) throw new Error("This card is not in a Canva-enabled brand lane.");
  const { data, error } = await supabase.functions.invoke("canva-brandboard", {
    body: {
      action: "link",
      post_id: input.postId,
      brand,
      design_id: input.designId,
    },
  });
  if (error || data?.ok !== true) {
    throw new Error(error?.message || data?.error || "Could not refresh this Canva link.");
  }
  const result = normalizeCanvaBrandBoardResult(data);
  if (result.postId !== input.postId || result.brand !== brand || result.designId !== input.designId) {
    throw new Error("Canva returned a link for a different BrandBoard card.");
  }
  return result;
}
