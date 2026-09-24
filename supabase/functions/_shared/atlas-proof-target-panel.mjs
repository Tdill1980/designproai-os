import { Buffer } from 'node:buffer';
import { providerSha256 } from './gemini-provider-cache.mjs';

const positive = value => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const readable = number => String(Number(number.toFixed(4)));

/**
 * Registration metadata for the current isolated-panel route. This changes
 * the photographer's scale instruction, never the image bytes or the design.
 * The entrypoint inserts this text before its existing hash-verified IMAGE 1.
 * Historical whole-sheet requests keep their existing target-image behavior.
 */
export function surfacePanelScalePart(body, surfaceKey) {
  if (body.sourceAuthorityRole !== 'surface-panel') return null;
  const width = positive(body.panelPrintWidthIn);
  const height = positive(body.panelPrintHeightIn);
  // No size on file (the runtime already fell back through GENIE): never
  // invent inches, but the full-surface rule below needs no numbers, so it
  // still applies. Skipping it is what let the artwork shrink into the doors.
  const lines = width && height
    ? [`SURFACE SCALE REGISTRATION: IMAGE 1 is the complete ${surfaceKey} wrap panel, ${readable(width)} inches wide by ${readable(height)} inches high. It is a full-surface texture, not a door-sized decal.`]
    : [`SURFACE SCALE REGISTRATION: IMAGE 1 is the complete ${surfaceKey} wrap panel, edge to edge. It is a full-surface texture, not a door-sized decal.`];
  const rawBleed = width && height ? body.panelBleedIn : undefined;
  const bleed = (typeof rawBleed === 'number' || (typeof rawBleed === 'string' && rawBleed.trim() !== ''))
    ? Number(rawBleed) : NaN;
  if (Number.isFinite(bleed) && bleed >= 0 && 2 * bleed < Math.min(width, height)) {
    const trimWidth = width - 2 * bleed;
    const trimHeight = height - 2 * bleed;
    const declaredWidth = positive(body.panelTrimWidthIn);
    const declaredHeight = positive(body.panelTrimHeightIn);
    // Emit exact registration only when the supplied trim agrees with its
    // supplied symmetric bleed. Missing trim can be computed from that bleed.
    if ((!declaredWidth || Math.abs(declaredWidth - trimWidth) < 0.05)
      && (!declaredHeight || Math.abs(declaredHeight - trimHeight) < 0.05)) {
      lines.push(`TRIM REGISTRATION: ${readable(bleed)} inches of bleed on each edge leaves a ${readable(trimWidth)} by ${readable(trimHeight)} inch trim rectangle. In IMAGE 1 that rectangle runs from x=${readable(100 * bleed / width)}% to x=${readable(100 * (width - bleed) / width)}%, and y=${readable(100 * bleed / height)}% to y=${readable(100 * (height - bleed) / height)}%. Register this inner rectangle to the corresponding full vehicle surface; the outer bleed extends beyond it and is trimmed away.`);
    }
  }
  if (surfaceKey === 'driver' || surfaceKey === 'passenger') {
    lines.push('The side artwork uses one continuous coordinate space across the full flank: front fender, doors, and rear quarter or outer bed side. The doors are only a subsection of that full placement.');
  }
  lines.push('Keep the image composition together as one texture: lettering, logos, photographs and background retain their existing relative positions and scale. Place it once across the matching surface, then clip it at the body outline, glass, wheels and other factory openings. Those openings may hide artwork; they must not cause lettering or imagery to shrink, move, repeat, or fit inside the doors. Perspective and body curvature affect the whole texture together. The camera may crop a close-up of that same installation without rescaling the artwork.');
  return { text: lines.join('\n\n') };
}

export async function targetPanelPart({ body, surfaceKey, bucket }) {
  if (body.sourceAuthorityRole === 'surface-panel') return surfacePanelScalePart(body, surfaceKey);
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
