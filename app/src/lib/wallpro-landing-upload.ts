import { Upload } from 'tus-js-client';
import { supabase } from '@/integrations/supabase/client';
import { LANDING_BUCKET, type LandingSlotKey } from './wallpro-landing-content';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

export async function uploadLandingMedia(file: File, slot: LandingSlotKey, kind: 'image' | 'video', onProgress: (percent: number) => void, signal: AbortSignal) {
  const extension = TYPES[file.type];
  if (!extension || !file.type.startsWith(`${kind}/`)) throw new Error(kind === 'image' ? 'Choose a JPG, PNG, or WebP image.' : 'Choose an MP4, WebM, or MOV video.');
  const maxMb = kind === 'image' ? 20 : 500;
  if (!file.size || file.size > maxMb * 1024 * 1024) throw new Error(`Choose a file between 1 byte and ${maxMb} MB.`);
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in again before uploading.');
  if (signal.aborted) throw new Error('Upload cancelled.');
  const path = `${slot}/${crypto.randomUUID()}.${extension}`;
  const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
  await new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => { signal.removeEventListener('abort', cancel); if (err) reject(err); else resolve(); };
    const upload = new Upload(file, {
      endpoint: `https://${project}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: LANDING_BUCKET, objectName: path, contentType: file.type, cacheControl: '31536000' },
      chunkSize: 6 * 1024 * 1024,
      onError: e => finish(new Error(`Upload failed: ${e.message}`)),
      onProgress: (bytes, total) => onProgress(Math.round(bytes / total * 100)),
      onSuccess: () => finish(),
    });
    const cancel = () => { void upload.abort().catch(() => undefined); finish(new Error('Upload cancelled.')); };
    signal.addEventListener('abort', cancel, { once: true });
    upload.start();
  });
  return supabase.storage.from(LANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}
