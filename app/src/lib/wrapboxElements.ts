import { supabase } from "@/integrations/supabase/client";

/**
 * WrapBox element ledger
 *
 * A single `production_packs` row groups every file Carley needs for one job
 * (the QC design panel + each Canva-extracted element + the background, plus
 * a future Vector Pack tier). Files live in storage; the row's
 * `panels_selected` JSON holds the manifest:
 *
 *   {
 *     wrapbox_kind: "qc_elements",
 *     job_id, order_number,
 *     elements: WrapboxElement[]
 *   }
 *
 * `kind: "vector"` is reserved so a future upsell can append vectorized
 * versions of the same elements without changing the data model.
 */

export type WrapboxElementKind =
  | "design_panel"
  | "element"
  | "background"
  | "vector";

export interface WrapboxElement {
  id: string;
  kind: WrapboxElementKind;
  label: string;
  url: string;
  scale?: number;
  width?: number;
  height?: number;
  added_at: string;
  added_by?: string | null;
}

/** The Railway worker's finished print pack — referenced, never re-zipped client-side. */
export interface WrapboxProductionPack {
  zip_url: string;
  zip_path?: string | null;
  zip_size?: number | null;
  file_count?: number | null;
  files?: string[] | null;
  built_at?: string | null;
  panels?: Record<string, { tiffPath?: string; pngPath?: string; previewPath?: string; width_in?: number; height_in?: number; completed_at?: string }> | null;
}

export interface WrapboxManifest {
  wrapbox_kind: "qc_elements";
  job_id: string;
  order_number: string;
  elements: WrapboxElement[];
  production_pack?: WrapboxProductionPack | null;
}

interface JobContext {
  jobId: string;
  orderNumber: string;
  vehicleInfo?: { year?: string; make?: string; model?: string } | null;
  finishType?: string | null;
}

const BUCKET = "wrap-files";

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function wrapboxFolder(orderNumber: string): string {
  return `wrapbox/${orderNumber}`;
}

async function fetchAsBlob(url: string): Promise<{ blob: Blob; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch source image (${res.status})`);
  const blob = await res.blob();
  return { blob, contentType: blob.type || "image/png" };
}

async function uploadToWrapbox(
  orderNumber: string,
  fileName: string,
  blob: Blob,
  contentType: string,
): Promise<string> {
  const path = `${wrapboxFolder(orderNumber)}/${fileName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`WrapBox upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function findWrapboxPack(
  shopId: string,
  jobId: string,
): Promise<{ id: string; manifest: WrapboxManifest } | null> {
  const { data, error } = await (supabase as any)
    .from("production_packs")
    .select("id, panels_selected")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`WrapBox lookup failed: ${error.message}`);
  for (const row of (data || []) as { id: string; panels_selected: any }[]) {
    const m = row.panels_selected;
    if (m && m.wrapbox_kind === "qc_elements" && m.job_id === jobId) {
      return { id: row.id, manifest: m as WrapboxManifest };
    }
  }
  return null;
}

interface AddInput {
  job: JobContext;
  shopId: string;
  userId: string;
  userEmail?: string | null;
  element: Omit<WrapboxElement, "id" | "added_at" | "added_by">;
  thumbnailUrl?: string | null;
  designName?: string | null;
}

async function upsertElement({
  job,
  shopId,
  userId,
  userEmail,
  element,
  thumbnailUrl,
  designName,
}: AddInput): Promise<{ packId: string; element: WrapboxElement }> {
  const stamped: WrapboxElement = {
    id: cryptoId(),
    added_at: new Date().toISOString(),
    added_by: userEmail ?? null,
    ...element,
  };

  const existing = await findWrapboxPack(shopId, job.jobId);

  if (existing) {
    const elements = [...existing.manifest.elements, stamped];
    const manifest: WrapboxManifest = { ...existing.manifest, elements };
    const update: Record<string, any> = {
      panels_selected: manifest,
      file_count: elements.length,
    };
    // First image becomes the thumbnail; don't overwrite later.
    if (stamped.kind === "design_panel" && thumbnailUrl) {
      update.thumbnail_url = thumbnailUrl;
    }
    const { error } = await (supabase as any)
      .from("production_packs")
      .update(update)
      .eq("id", existing.id);
    if (error) throw new Error(`WrapBox update failed: ${error.message}`);
    return { packId: existing.id, element: stamped };
  }

  const manifest: WrapboxManifest = {
    wrapbox_kind: "qc_elements",
    job_id: job.jobId,
    order_number: job.orderNumber,
    elements: [stamped],
  };

  const insert: Record<string, any> = {
    user_id: userId,
    shop_id: shopId,
    design_name: designName || `WrapBox Job ${job.orderNumber}`,
    panels_selected: manifest,
    thumbnail_url: thumbnailUrl ?? stamped.url,
    pack_url: stamped.url,
    file_count: 1,
    upscale_status: "ready",
    finish_type: job.finishType ?? null,
    vehicle_info: job.vehicleInfo ?? null,
  };

  const { data, error } = await (supabase as any)
    .from("production_packs")
    .insert(insert)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`WrapBox insert failed: ${error?.message || "unknown"}`);
  }
  return { packId: (data as { id: string }).id, element: stamped };
}

async function getActor(): Promise<{ userId: string; email: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { userId: user.id, email: user.email ?? null };
}

export async function sendDesignPanelToWrapBox(args: {
  job: JobContext;
  shopId: string;
  artboardUrl: string;
  designName?: string | null;
}): Promise<{ packId: string; element: WrapboxElement }> {
  const { userId, email } = await getActor();
  const { blob, contentType } = await fetchAsBlob(args.artboardUrl);
  const ext = (contentType.split("/")[1] || "png").split(";")[0];
  const publicUrl = await uploadToWrapbox(
    args.job.orderNumber,
    `design-panel.${ext}`,
    blob,
    contentType,
  );

  return upsertElement({
    job: args.job,
    shopId: args.shopId,
    userId,
    userEmail: email,
    designName: args.designName ?? null,
    thumbnailUrl: publicUrl,
    element: {
      kind: "design_panel",
      label: "Design Panel",
      url: publicUrl,
    },
  });
}

export async function addUpscaledElementToWrapBox(args: {
  job: JobContext;
  shopId: string;
  imageUrl: string;
  label: string;
  kind: Exclude<WrapboxElementKind, "design_panel">;
  scale?: number;
  width?: number;
  height?: number;
}): Promise<{ packId: string; element: WrapboxElement }> {
  const { userId, email } = await getActor();
  const { blob, contentType } = await fetchAsBlob(args.imageUrl);
  const ext = (contentType.split("/")[1] || "png").split(";")[0];
  const slug = args.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "element";
  const fileName = `elements/${slug}-${Date.now()}.${ext}`;
  const publicUrl = await uploadToWrapbox(args.job.orderNumber, fileName, blob, contentType);

  return upsertElement({
    job: args.job,
    shopId: args.shopId,
    userId,
    userEmail: email,
    element: {
      kind: args.kind,
      label: args.label,
      url: publicUrl,
      scale: args.scale,
      width: args.width,
      height: args.height,
    },
  });
}

/**
 * Append a file the user picked from disk to an existing WrapBox pack.
 * Skips the upscaler — bytes go straight to wrap-files/wrapbox/{order}/manual/.
 * The pack must already exist (this is what the WrapBox card grid is rendering),
 * so vehicleInfo/finishType are only consulted when upsertElement falls through
 * to inserting a brand-new pack.
 */
export async function addManualFileToWrapBox(args: {
  job: JobContext;
  shopId: string;
  file: File;
  label: string;
  kind?: Exclude<WrapboxElementKind, "design_panel">;
}): Promise<{ packId: string; element: WrapboxElement }> {
  const { userId, email } = await getActor();
  const ext = (args.file.name.split(".").pop() || "bin").toLowerCase();
  const slug =
    args.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "upload";
  const fileName = `manual/${slug}-${Date.now()}.${ext}`;
  const contentType = args.file.type || `application/octet-stream`;
  const publicUrl = await uploadToWrapbox(
    args.job.orderNumber,
    fileName,
    args.file,
    contentType,
  );
  return upsertElement({
    job: args.job,
    shopId: args.shopId,
    userId,
    userEmail: email,
    element: {
      kind: args.kind || "element",
      label: args.label,
      url: publicUrl,
    },
  });
}

export function isWrapboxManifest(value: unknown): value is WrapboxManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.wrapbox_kind === "qc_elements" &&
    typeof v.job_id === "string" &&
    typeof v.order_number === "string" &&
    Array.isArray(v.elements)
  );
}
