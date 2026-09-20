import { Buffer } from 'node:buffer';
import { providerSha256 } from './gemini-provider-cache.mjs';

export async function targetPanelPart({ body, surfaceKey, bucket }) {
  if (body.sourceAuthorityRole !== 'three-zone-production-proof') return null;
  if (body.targetPanelSurfaceKey !== surfaceKey) throw new Error('atlas_proof_target_surface_mismatch');
  if (!body.targetPanelStoragePath || !/^[0-9a-f]{64}$/.test(String(body.targetPanelHash || ''))) {
    throw new Error('atlas_proof_target_identity_missing');
  }
  const { data, error } = await bucket.download(body.targetPanelStoragePath);
  if (error || !data) throw new Error('atlas_proof_target_download_failed');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (await providerSha256(bytes) !== body.targetPanelHash) throw new Error('atlas_proof_target_hash_mismatch');
  return { inlineData: { mimeType: body.targetPanelContentType || 'image/png', data: Buffer.from(bytes).toString('base64') } };
}
