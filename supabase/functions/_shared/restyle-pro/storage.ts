/**
 * restyle-pro/storage.ts — self-contained storage helpers for the
 * restyle-pro-* trio. Intentionally has NO dependency on panelizer-os/constants
 * (and therefore none on the 194 KB vehicle-database) so the trio deploys as a
 * tiny, self-contained bundle.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encode as stdEncodeBase64,
  decode as stdDecodeBase64,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";

export const BUCKET = "wrap-files";

export function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getFunctionsBaseUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")!}/functions/v1`;
}

export async function downloadFromStorage(path: string): Promise<Uint8Array> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Storage download failed [${path}]: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadToStorage(
  path: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<string> {
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed [${path}]: ${error.message}`);
  return path;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw new Error(`Signed URL failed [${path}]: ${error.message}`);
  return data.signedUrl;
}

export function getPublicUrl(path: string): string {
  const supabase = getServiceClient();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) {
    const matches = url.match(/^data:[^;]+;base64,(.+)$/);
    if (!matches) throw new Error("Invalid data: URI");
    return base64ToUint8Array(matches[1]);
  }
  const resp = await fetch(url, { headers: { "User-Agent": "Deno/RestylePro" } });
  if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${url}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// MEMORY (546 guard): std encode/decode go buffer↔base64 in one pass — the old
// chunked loops transiently ate hundreds of MB on multi-MB images.
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return stdEncodeBase64(bytes);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return stdDecodeBase64(base64);
}
