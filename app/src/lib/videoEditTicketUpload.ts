import { Upload } from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import {
  VIDEO_EDIT_SOURCE_BUCKET,
  validateVideoEditFile,
  videoContentType,
  videoEditObjectPath,
} from "@/lib/videoEditTicket";

export interface VideoEditUploadResult {
  bucket: typeof VIDEO_EDIT_SOURCE_BUCKET;
  path: string;
  publicUrl: string;
}

function resumableEndpoint(projectUrl: string): string {
  const parsed = new URL(projectUrl);
  const projectRef = parsed.hostname.split(".")[0];
  if (!projectRef) throw new Error("Supabase project URL is not configured.");
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

/**
 * Resumable browser upload for real camera files. It uses the signed-in
 * user's access token only; the service-role key never enters the browser.
 */
export async function uploadVideoEditSource(input: {
  file: File;
  brand: string;
  postId: string;
  onProgress?: (percent: number) => void;
}): Promise<VideoEditUploadResult> {
  const fileError = validateVideoEditFile(input.file);
  if (fileError) throw new Error(fileError);

  const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  if (userError || !userData.user) throw new Error("Sign in again before uploading footage.");
  if (sessionError || !sessionData.session?.access_token) throw new Error("Your upload session expired. Sign in again.");

  const path = videoEditObjectPath({
    ownerId: userData.user.id,
    brand: input.brand,
    postId: input.postId,
    file: input.file,
  });
  const projectUrl = String(import.meta.env.VITE_SUPABASE_URL || "");
  if (!projectUrl) throw new Error("Supabase project URL is not configured.");

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint: resumableEndpoint(projectUrl),
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${sessionData.session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: VIDEO_EDIT_SOURCE_BUCKET,
        objectName: path,
        contentType: videoContentType(input.file),
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => reject(new Error(`Video upload failed: ${error.message}`)),
      onProgress: (uploaded, total) => {
        input.onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0);
      },
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });

  const { data } = supabase.storage.from(VIDEO_EDIT_SOURCE_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("The upload finished but no source URL was returned.");
  return { bucket: VIDEO_EDIT_SOURCE_BUCKET, path, publicUrl: data.publicUrl };
}
