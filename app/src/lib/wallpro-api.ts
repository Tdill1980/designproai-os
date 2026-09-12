import { supabase } from '@/integrations/supabase/client';
import type { WallCatalogRow, designUpsertRow } from './wallpro-catalog';
import type { WallStudioDesign } from './wallpro-studio';
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

async function readWallGeneration(requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId) return null;
  const { data, error } = await db.from('wallpro_generations')
    .select('id,design_name,artwork_path,state,error')
    .eq('id', requestId)
    .maybeSingle();
  return error ? null : data;
}
async function recoverWallGeneration(requestId: unknown) {
  const data = await readWallGeneration(requestId);
  if (!data || data.state !== 'completed' || !data.artwork_path) return null;
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
    const row = await readWallGeneration(input.requestId).catch(() => null);
    if (row?.state === 'completed' && row.artwork_path) { const recovered = await recoverWallGeneration(input.requestId).catch(() => null); if (recovered) return recovered; }
    // The ledger recorded WHY it failed (a provider refusal, a size limit).
    // That reason is the message; "interrupted, check My wall designs" is only
    // for a request the ledger never settled.
    if (row?.state === 'failed' && typeof row.error === 'string' && row.error) throw new Error(row.error.replace(/ Your render credit will be returned\.?/g, ' Your render credit was returned.'));

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

/** Detect my wall: proposes the wall corners and the openings to protect from
 * the uploaded wall photo. Preview-only; costs no token. */
export async function detectWall(wallPath: string): Promise<{ wall: { x: number; y: number }[] | null; openings: { label: string; points: { x: number; y: number }[] }[]; masks: { label: string; box: { x0: number; y0: number; x1: number; y1: number }; png: string }[]; notes: string | null; model: string }> {
  const { data, error } = await supabase.functions.invoke('detect-wall-openings', { body: { wallPath } });
  if (error) {
    const response = (error as any).context;
    const body = await response?.clone?.().json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : 'The wall could not be analysed. Mark the corners and openings by hand.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.openings)) throw new Error(data?.error || 'The wall could not be analysed. Mark the corners and openings by hand.');
  return { ...data, masks: Array.isArray(data.masks) ? data.masks : [] };
}

/** AI view on the wall: the image model paints the flat master onto the wall
 * in the room photo and leaves everything else as photographed. Presentation
 * only; the flat master stays the print truth. No token charged. */
export async function renderWallView(input: { wallPath: string; artworkPath: string; placement: 'cover' | 'contain' | 'repeat'; repeatWidthIn?: number | null; wallWidthIn?: number; wallHeightIn?: number }): Promise<{ view_path: string; view_url: string; model: string }> {
  const { data, error } = await supabase.functions.invoke('render-wall-view', { body: input });
  if (error) {
    const response = (error as any).context;
    const body = await response?.clone?.().json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : 'The wall view could not be rendered.');
  }
  if (!data?.view_path) throw new Error(data?.error || 'No wall view was returned.');
  return { ...data, view_url: data.view_url || await openWallAsset(data.view_path) };
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
/** Signed URLs for display, or with `download` for links that save the file in
 * place: a cross-origin signed URL ignores the anchor's download attribute and
 * would navigate the page to the image, losing the customer's work. */
export async function openWallAssets(paths: string[], options: { download?: boolean } = {}): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(WALLPRO_BUCKET).createSignedUrls(paths, 3600, options.download ? { download: true } : undefined);
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

/* ── Production panels: 150 PPI print files built on the server (Topaz) ─── */

export type WallProductionPanel = {
  number: number; file: string; path: string; xIn: number; yIn: number; widthIn: number; heightIn: number; overlapLeftIn: number;
  widthPx: number; heightPx: number; ppi: number; sha256: string; byteSize: number;
  upscale: { engine: string; model?: string; nativePpi?: number; reason?: string };
};
/** The whole wall (with bleed) as one file at the panel PPI, stitched from the
 * panels' own pixels; or the reason it could not be built (too large). */
export type WallWholeFile = { file: string; path: string; widthIn: number; heightIn: number; widthPx: number; heightPx: number; ppi: number; sha256: string; byteSize: number };
export type WallProductionJob = {
  id: string; owner_id: string; project_id: string; version_id: string; request: Record<string, unknown>; request_hash: string;
  status: 'queued' | 'running' | 'ready' | 'failed'; attempts: number; progress: { stage?: string; panelsTotal?: number; panelsDone?: number; nativePpi?: number; topaz?: string; wholeWall?: WallWholeFile | { error: string } | null };
  panels: WallProductionPanel[]; manifest_path: string | null; error: string | null; created_at: string; updated_at: string; finished_at: string | null;
};
export const wholeWallFile = (job: Pick<WallProductionJob, 'progress'> | null | undefined): WallWholeFile | null => {
  const w = job?.progress?.wholeWall;
  return w && 'path' in w && w.path ? w : null;
};
export type WallProductionRequest = { wallWidthIn: number; wallHeightIn: number; placement: 'cover' | 'contain' | 'repeat'; repeatWidthIn?: number; mirror?: boolean; bleedIn: number; overlapIn: number; panelWidthIn: number; targetPpi: number; wholeWall?: boolean };

/** Requests the 150 PPI panel build for an APPROVED version. The same version and
 * geometry returns the existing live job; the runtime worker claims it and
 * reports progress per panel. */
export async function requestWallProduction(versionId: string, request: WallProductionRequest): Promise<WallProductionJob> {
  const { data, error } = await db.rpc('request_wallpro_production', { p_version_id: versionId, p_request: request });
  if (error) {
    const code = String(error.message || '');
    throw new Error(code.includes('not_approved') ? 'Approve this version first; production panels are built from the approved version only.'
      : code.includes('not_found') ? 'The approved version could not be found.' : 'Production panels could not be requested: ' + code);
  }
  return data as WallProductionJob;
}
export async function getWallProductionJob(id: string): Promise<WallProductionJob> {
  const { data, error } = await db.from('wallpro_production_jobs').select('*').eq('id', id).single();
  if (error || !data) throw new Error('The production job could not be read: ' + (error?.message || 'missing'));
  return data as WallProductionJob;
}
export async function latestWallProductionJob(versionId: string): Promise<WallProductionJob | null> {
  const { data, error } = await db.from('wallpro_production_jobs').select('*').eq('version_id', versionId).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error('The production job could not be read: ' + error.message);
  return (data?.[0] as WallProductionJob) || null;
}

/* ── Design-team production board (admins and testers, read-only) ───────── */

/** The DesignID the team files a wall design under: the approved version's
 * identity, in the same DID-XXXXXXXX form the vehicle studio uses. */
export const wallDesignId = (versionId: string) => 'DID-' + versionId.replace(/-/g, '').slice(0, 8).toUpperCase();

export type WallTeamJob = WallProductionJob & { project_name: string; version_no: number | null; artwork_path: string | null };
/** Every customer's production jobs, newest first, with the project name and
 * version number joined in. Readable by admins and testers only (RLS). */
export async function listWallProductionJobsForTeam(limit = 100): Promise<WallTeamJob[]> {
  const { data, error } = await db.from('wallpro_production_jobs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Production jobs could not be listed: ' + error.message);
  const jobs = (data || []) as WallProductionJob[];
  const projectIds = [...new Set(jobs.map(j => j.project_id))], versionIds = [...new Set(jobs.map(j => j.version_id))];
  const [projects, versions] = await Promise.all([
    projectIds.length ? db.from('wallpro_projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [], error: null }),
    versionIds.length ? db.from('wallpro_design_versions').select('id,version_no,artwork_path').in('id', versionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const names = new Map<string, string>((projects.data || []).map((p: any) => [p.id, p.name]));
  const vers = new Map<string, { version_no: number; artwork_path: string }>((versions.data || []).map((v: any) => [v.id, v]));
  return jobs.map(j => ({ ...j, project_name: names.get(j.project_id) || 'Wall design', version_no: vers.get(j.version_id)?.version_no ?? null, artwork_path: vers.get(j.version_id)?.artwork_path ?? null }));
}

/* ── RevisionStudioIQ feed: every wall design the caller can read ─────────── */

/** One row per project: the approved version when there is one (production
 * reads only it), else the latest draft; with the latest production build and
 * signed links for the master and each 150 PPI panel. Owners see their own
 * projects; admins and testers see every customer's (RLS). Signed links last
 * an hour, which outlives the grid's own refetch. */
export async function listWallDesignsForStudio(limit = 60): Promise<WallStudioDesign[]> {
  const { data, error } = await db.from('wallpro_design_versions').select('*').order('created_at', { ascending: false }).limit(limit * 6);
  if (error) throw new Error('Wall designs could not be listed: ' + error.message);
  const byProject = new Map<string, WallVersion>();
  for (const v of (data || []) as WallVersion[]) {
    const held = byProject.get(v.project_id);
    if (!held || (v.status === 'approved' && held.status !== 'approved')) byProject.set(v.project_id, v);
  }
  const chosen = [...byProject.values()].slice(0, limit);
  if (!chosen.length) return [];
  const projectIds = chosen.map(v => v.project_id), versionIds = chosen.map(v => v.id);
  const [projects, jobs] = await Promise.all([
    db.from('wallpro_projects').select('id,name,created_at').in('id', projectIds),
    db.from('wallpro_production_jobs').select('*').in('version_id', versionIds).order('created_at', { ascending: false }),
  ]);
  const names = new Map<string, string>((projects.data || []).map((p: any) => [p.id, p.name]));
  const jobFor = new Map<string, WallProductionJob>();
  for (const j of (jobs.data || []) as WallProductionJob[]) if (!jobFor.has(j.version_id)) jobFor.set(j.version_id, j);
  const filePaths: string[] = [];
  for (const j of jobFor.values()) { for (const p of j.panels || []) filePaths.push(p.path); if (j.manifest_path) filePaths.push(j.manifest_path); const w = wholeWallFile(j); if (w) filePaths.push(w.path); }
  // Every version of every chosen project: the history strip RevisionStudio shows.
  const allVersions = ((data || []) as WallVersion[]).filter(v => byProject.has(v.project_id));
  const [views, downloads] = await Promise.all([
    openWallAssets([...new Set(allVersions.map(v => v.artwork_path))]).catch(() => ({} as Record<string, string>)),
    openWallAssets(filePaths, { download: true }).catch(() => ({} as Record<string, string>)),
  ]);
  return chosen.map(v => {
    const j = jobFor.get(v.id) || null;
    const whole = wholeWallFile(j);
    return {
      projectId: v.project_id, projectName: names.get(v.project_id) || 'Wall design', versionId: v.id, versionNo: v.version_no,
      approved: v.status === 'approved', designId: wallDesignId(v.id), artworkPath: v.artwork_path, artworkUrl: views[v.artwork_path] || null,
      placement: v.placement, repeatWidthIn: v.repeat_width_in ? Number(v.repeat_width_in) : null, createdAt: v.created_at, approvedAt: v.approved_at,
      versions: allVersions.filter(x => x.project_id === v.project_id).sort((a, b) => a.version_no - b.version_no)
        .map(x => ({ id: x.id, versionNo: x.version_no, kind: x.kind, approved: x.status === 'approved', prompt: x.prompt, createdAt: x.created_at, url: views[x.artwork_path] || null })),
      job: j ? {
        id: j.id, status: j.status, error: j.error, manifestUrl: j.manifest_path ? downloads[j.manifest_path] || null : null,
        panels: (j.panels || []).map(p => ({ number: p.number, file: p.file, widthIn: p.widthIn, heightIn: p.heightIn, widthPx: p.widthPx, heightPx: p.heightPx, ppi: p.ppi, byteSize: p.byteSize, url: downloads[p.path] || null })),
        wholeWall: whole ? { file: whole.file, widthIn: whole.widthIn, heightIn: whole.heightIn, widthPx: whole.widthPx, heightPx: whole.heightPx, ppi: whole.ppi, byteSize: whole.byteSize, url: downloads[whole.path] || null } : null,
      } : null,
    };
  });
}
