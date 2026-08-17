/**
 * panelizer-os/storage.ts — Storage helpers for the step-chain pipeline
 *
 * Every step reads its input from storage and writes its output back.
 * This file provides the shared upload/download/signedUrl logic.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encode as stdEncodeBase64,
  decode as stdDecodeBase64,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { BUCKET } from "./constants.ts";

export function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getFunctionsBaseUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")!}/functions/v1`;
}

/** Download a file from storage as Uint8Array */
export async function downloadFromStorage(path: string): Promise<Uint8Array> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Storage download failed [${path}]: ${error.message}`);
  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}

/** Upload bytes to storage, returns the storage path */
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

/** Get a 1-hour signed URL for a storage path */
export async function getSignedUrl(path: string): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(`Signed URL failed [${path}]: ${error.message}`);
  return data.signedUrl;
}

/** Get public URL for a storage path */
export function getPublicUrl(path: string): string {
  const supabase = getServiceClient();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Delete temp files for a job */
export async function cleanupTemp(userId: string, jobId: string): Promise<void> {
  const supabase = getServiceClient();
  const prefix = `production-packs/${userId}/temp/${jobId}`;
  const { data: files } = await supabase.storage.from(BUCKET).list(prefix);
  if (files && files.length > 0) {
    const paths = files.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
    console.log(`[CLEANUP] Removed ${paths.length} temp files for job ${jobId}`);
  }
}

/** Fetch an image from any URL and return as Uint8Array */
export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) {
    const matches = url.match(/^data:[^;]+;base64,(.+)$/);
    if (!matches) throw new Error("Invalid data: URI");
    return base64ToUint8Array(matches[1]);
  }
  const resp = await fetch(url, { headers: { "User-Agent": "Deno/PanelizerOS" } });
  if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${url}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ── Base64 helpers ───────────────────────────────────────────────
// MEMORY (546 guard): std encode/decode go buffer↔base64 in one pass. The old
// chunked fromCharCode/charCodeAt loops built huge intermediate strings —
// multi-MB images transiently ate hundreds of MB and OOM-killed the 256MB
// worker (panelizer-step-fill's persistent HTTP 546s).

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return stdEncodeBase64(bytes);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return stdDecodeBase64(base64);
}
