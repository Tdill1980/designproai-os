import { prepareRecreateReference } from './recreatepro-files';
import { RECREATE_MAX_BYTES, RECREATE_MAX_FILES } from './recreatepro-intake';
import type { RecreateReference } from './recreatepro-draft';
import type { GenerationVehicle } from './designpro-api';

export const RECREATE_HANDOFF_KEY = 'recreatepro_handoff';
const STORAGE_HOSTS = new Set(['wozyamlnygaddievzuwn.supabase.co', 'kfapjdyythzyvnpdeghu.supabase.co']);
export function permittedHandoffUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && STORAGE_HOSTS.has(url.hostname)
    && !url.username && !url.password && (!url.port || url.port === '443') && url.pathname.startsWith('/storage/v1/'); }
  catch { return false; }
}

/** Import the existing VehiclePro handoff as ordinary reference files. Every
 * file is verified and uploaded under the NEW generation before submission.
 * Never forward a foreign storage path as a production input identity. */
export async function importRecreateHandoff(raw: string): Promise<{ references: RecreateReference[]; vehicle: GenerationVehicle }> {
  const value = JSON.parse(raw);
  if (!Number.isFinite(value?.savedAt) || Math.abs(Date.now() - value.savedAt) > 30 * 60_000
    || !Array.isArray(value.refs) || !value.refs.length || value.refs.length > RECREATE_MAX_FILES
    || value.refs.some((url: unknown) => typeof url !== 'string' || !permittedHandoffUrl(url))) {
    throw new Error('That reference handoff has expired or cannot be imported. Upload your design here to continue.');
  }
  const references: RecreateReference[] = [];
  for (const [index, url] of value.refs.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
      if (!response.ok || !permittedHandoffUrl(response.url)) throw new Error('The carried reference could not be opened. Upload it here instead.');
      if (Number(response.headers.get('content-length')) > RECREATE_MAX_BYTES) throw new Error('A carried reference exceeds 25 MB.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('The carried reference has no readable content.');
      const parts: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > RECREATE_MAX_BYTES) { await reader.cancel(); throw new Error('A carried reference exceeds 25 MB.'); }
          parts.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const type = (response.headers.get('content-type') || '').split(';')[0];
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as Record<string, string>)[type];
      if (!ext) throw new Error('Export the carried reference as JPG, PNG, WebP or PDF.');
      references.push(await prepareRecreateReference(new File(parts, `reference-${index + 1}.${ext}`, { type })));
    } finally { clearTimeout(timer); }
  }
  const text = (item: unknown) => typeof item === 'string' || typeof item === 'number' ? String(item).slice(0, 120) : '';
  return { references, vehicle: { year: text(value.year), make: text(value.make), model: text(value.model), type: 'van' } };
}
