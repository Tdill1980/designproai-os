import { supabase } from '@/integrations/supabase/client';
import type { WallCatalogRow, designUpsertRow } from './wallpro-catalog';
export const WALLPRO_BUCKET = 'wallpro-files';
export type WallAsset = { url: string; path?: string; file?: File; aspect: number; width?: number; height?: number };
const db = supabase as any;

export async function wallUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sign in to generate or save a wall design. You can preview uploaded artwork before signing in.');
  return data.user;
}
export async function uploadWallAsset(asset: WallAsset, owner: string): Promise<string> {
  if (asset.path) return asset.path;
  if (!asset.file) throw new Error('Choose the image again before saving.');
  const ext = asset.file.type === 'image/jpeg' ? 'jpg' : asset.file.type === 'image/webp' ? 'webp' : 'png';
  const path = owner + '/uploads/' + crypto.randomUUID() + '.' + ext;
  const { error } = await supabase.storage.from(WALLPRO_BUCKET).upload(path, asset.file, { contentType: asset.file.type, upsert: false });
  if (error) throw new Error('Image upload failed: ' + error.message);
  return path;
}
export async function openWallAsset(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(WALLPRO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error('The saved image could not be opened. ' + (error?.message || ''));
  return data.signedUrl;
}

async function recoverWallGeneration(requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId) return null;
  const { data, error } = await db.from('wallpro_generations')
    .select('id,design_name,artwork_path,state,error')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !data || data.state !== 'completed' || !data.artwork_path) return null;
  const imageUrl = await openWallAsset(data.artwork_path);
  return {
    storage_path: data.artwork_path as string,
    image_url: imageUrl,
    design_name: (data.design_name || 'Wall design') as string,
    request_id: data.id as string,
  };
}

export async function generateWall(input: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('generate-wall-design', { body: input });
  if (error) {
    // The provider may finish and persist the artwork even if the browser loses
    // the final Edge response. Treat the generation ledger as authority before
    // showing a transport failure to the user.
    const recovered = await recoverWallGeneration(input.requestId).catch(() => null);
    if (recovered) return recovered;

    const response = (error as any).context;
    const body = await response?.clone?.().json().catch(() => null);
    const detail = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : '';
    const interrupted = response?.status >= 500 || /WORKER_LIMIT|timeout|fetch|non-2xx|edge function/i.test(detail || error.message);
    throw new Error(interrupted
      ? 'Generation was interrupted before a result reached this page. Check My wall designs for a saved result before starting again. Request: ' + String(input.requestId || 'unavailable')
      : detail || error.message || 'The wall design could not be generated.');
  }
  if (!data?.storage_path || !data?.image_url) {
    const recovered = await recoverWallGeneration(input.requestId).catch(() => null);
    if (recovered) return recovered;
    throw new Error(data?.error || 'No wall artwork was returned.');
  }
  return data as { storage_path: string; image_url: string; design_name: string; request_id: string };
}
export async function saveWallProject(id: string, owner: string, name: string, config: Record<string, unknown>) {
  const { error } = await db.from('wallpro_projects').upsert({ id, owner_id: owner, name: name.trim() || 'Wall design', config, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error('Project could not be saved: ' + error.message);
}
export async function wallHistory() {
  await wallUser();
  const [projects, generations] = await Promise.all([
    db.from('wallpro_projects').select('id,name,config,updated_at').order('updated_at', { ascending: false }).limit(30),
    db.from('wallpro_generations').select('id,design_name,artwork_path,input,state,error,created_at').order('created_at', { ascending: false }).limit(30),
  ]);
  if (projects.error || generations.error) throw new Error(projects.error?.message || generations.error?.message);
  return { projects: projects.data || [], generations: generations.data || [] };
}
export async function getWallProject(id: string) {
  await wallUser();
  const { data, error } = await db.from('wallpro_projects').select('id,name,config').eq('id',id).maybeSingle();
  if (error || !data) throw new Error('This project could not be found in your account.');
  return data;
}

/* ── Ready-to-sell catalog (wallpro_designs) ─────────────────────────────── */

/** Storefront read: approved, active designs. Anonymous browsing is allowed by policy. */
export async function listWallCatalog(): Promise<WallCatalogRow[]> {
  const { data, error } = await db.from('wallpro_designs').select('*').eq('is_active', true).eq('approval_status', 'approved')
    .order('sort_order', { ascending: true }).order('design_id', { ascending: true }).limit(1000);
  if (error) throw new Error('The design catalog could not be loaded: ' + error.message);
  return (data || []) as WallCatalogRow[];
}
/** Curator read: every catalog row, hidden ones included. */
export async function listWallCatalogAll(): Promise<WallCatalogRow[]> {
  await wallUser();
  const { data, error } = await db.from('wallpro_designs').select('*').order('design_id', { ascending: true }).limit(2000);
  if (error) throw new Error('The design catalog could not be loaded: ' + error.message);
  return (data || []) as WallCatalogRow[];
}
export async function getWallGeneration(requestId: string) {
  const { data, error } = await db.from('wallpro_generations').select('id,input_hash,state,artwork_path,design_name').eq('id', requestId).maybeSingle();
  if (error || !data) throw new Error('The generation record for this design could not be read.');
  return data as { id: string; input_hash: string; state: string; artwork_path: string | null; design_name: string | null };
}
/** Copies the curator's generated master into catalog/ so every customer can
 * open it, uploads the storefront thumbnail beside it, then upserts the design
 * row keyed by its permanent DesignID. */
export async function publishWallDesign(sourcePath: string, thumb: Blob | null, row: ReturnType<typeof designUpsertRow>): Promise<WallCatalogRow> {
  // Storage objects are immutable for users, so a failed publish leaves its
  // catalog copy behind; the row is the authority and it is only written last.
  const { error: copyError } = await supabase.storage.from(WALLPRO_BUCKET).copy(sourcePath, row.master_path);
  if (copyError) throw new Error('The master could not be copied into the catalog: ' + copyError.message);
  if (thumb && row.thumb_path) {
    const { error: thumbError } = await supabase.storage.from(WALLPRO_BUCKET).upload(row.thumb_path, thumb, { contentType: 'image/jpeg', upsert: false });
    if (thumbError) throw new Error('The thumbnail could not be saved: ' + thumbError.message);
  }
  const { data, error } = await db.from('wallpro_designs').upsert(row, { onConflict: 'design_id' }).select('*').single();
  if (error) throw new Error('The design could not be published: ' + error.message);
  return data as WallCatalogRow;
}
/** Signed URLs for many catalog files at once (thumbnails for a grid). */
export async function openWallAssets(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(WALLPRO_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error('The catalog images could not be opened. ' + error.message);
  const out: Record<string, string> = {};
  for (const item of data || []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
export async function updateWallDesign(id: string, patch: Partial<Pick<WallCatalogRow, 'is_active' | 'rating' | 'title' | 'sort_order' | 'tile_width_in' | 'approval_status' | 'collection_id'>>) {
  const { error } = await db.from('wallpro_designs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error('The design could not be updated: ' + error.message);
}
/** Removes the catalog row. The master copy under catalog/ is retained:
 * storage objects are immutable for users, and a sold design's bytes are
 * provenance for reprints even after it leaves the storefront. */
export async function deleteWallDesign(row: Pick<WallCatalogRow, 'id'>) {
  const { error } = await db.from('wallpro_designs').delete().eq('id', row.id);
  if (error) throw new Error('The design could not be removed: ' + error.message);
}
/* ── Design sessions: CREATE → REFINE* → APPROVE → PRODUCTION ───────────── */

export type WallVersionKind = 'create' | 'refine' | 'upload' | 'catalog' | 'composite';
export type WallVersion = {
  id: string; project_id: string; owner_id: string; version_no: number; parent_version_id: string | null; kind: WallVersionKind;
  intent: string | null; prompt: string | null; mask_path: string | null; reference_path: string | null; artwork_path: string;
  width_px: number | null; height_px: number | null; sha256: string | null; generation_id: string | null; design_id: string | null;
  placement: 'cover' | 'contain' | 'repeat'; repeat_width_in: number | null; status: 'draft' | 'approved'; note: string | null; created_at: string; approved_at: string | null;
};
export async function listWallVersions(projectId: string): Promise<WallVersion[]> {
  const { data, error } = await db.from('wallpro_design_versions').select('*').eq('project_id', projectId).order('version_no', { ascending: true });
  if (error) throw new Error('The design history could not be loaded: ' + error.message);
  return (data || []) as WallVersion[];
}
/** Appends the next immutable version of a project's design. */
export async function createWallVersion(input: { projectId: string; owner: string; parent: WallVersion | null; kind: WallVersionKind; intent?: string | null; prompt?: string | null; maskPath?: string | null; referencePath?: string | null; artworkPath: string; widthPx?: number | null; heightPx?: number | null; sha256?: string | null; generationId?: string | null; designId?: string | null; placement: 'cover' | 'contain' | 'repeat'; repeatWidthIn?: number | null; note?: string | null; versionNo: number }): Promise<WallVersion> {
  const row = { project_id: input.projectId, owner_id: input.owner, version_no: input.versionNo, parent_version_id: input.parent?.id ?? null, kind: input.kind, intent: input.intent ?? null, prompt: input.prompt ?? null,
    mask_path: input.maskPath ?? null, reference_path: input.referencePath ?? null, artwork_path: input.artworkPath, width_px: input.widthPx ?? null, height_px: input.heightPx ?? null, sha256: input.sha256 ?? null,
    generation_id: input.generationId ?? null, design_id: input.designId ?? null, placement: input.placement, repeat_width_in: input.placement === 'repeat' ? input.repeatWidthIn ?? null : null, note: input.note ?? null };
  const { data, error } = await db.from('wallpro_design_versions').insert(row).select('*').single();
  if (error) throw new Error('The design version could not be recorded: ' + error.message);
  return data as WallVersion;
}
/** Exactly one approved version per project: the previous approval is withdrawn first. */
export async function approveWallVersion(projectId: string, versionId: string): Promise<void> {
  const clear = await db.from('wallpro_design_versions').update({ status: 'draft', approved_at: null }).eq('project_id', projectId).eq('status', 'approved');
  if (clear.error) throw new Error('The previous approval could not be withdrawn: ' + clear.error.message);
  const { error } = await db.from('wallpro_design_versions').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', versionId);
  if (error) throw new Error('The version could not be approved: ' + error.message);
}
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
