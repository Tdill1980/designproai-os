/**
 * ProofUploadVersion
 *
 * Upload a 2D proof file (image/PDF) with version notes.
 * Flow:
 *   1. proof-create-upload-url returns a signed Storage upload URL.
 *   2. Browser PUTs the file directly to Supabase Storage (no edge
 *      function body limit, supports large production files).
 *   3. proof-save-version creates a new active version pointing at
 *      the uploaded paths.
 * Light themed, blue→magenta gradient accent.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Upload, Loader2, X, FileImage, FileText, Check,
} from "lucide-react";

const ACCEPTED = ".png,.jpg,.jpeg,.webp,.heic,.heif,.tif,.tiff,.pdf";
// Hard cap to keep customers from uploading absurd files. Direct-to-storage
// upload means we're no longer constrained by edge function body limits.
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

interface ProofUploadVersionProps {
  proofId: string;
  onVersionSaved: () => void;
}

function inferContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return map[ext] || "application/octet-stream";
}

/** Thumbnail for an attached file. Shows a real image preview for image
 *  files (so the user can SEE what they attached), or an icon for PDFs. */
function FileThumb({ file }: { file: File }) {
  const isImage = file.type.startsWith("image/") &&
    file.type !== "image/heic" && file.type !== "image/heif" &&
    file.type !== "image/tiff";
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  if (isImage && url) {
    return (
      <img
        src={url}
        alt={file.name}
        className="w-12 h-12 rounded object-cover border border-gray-200 shrink-0"
      />
    );
  }
  const Icon = file.type === "application/pdf" ? FileText : FileImage;
  return (
    <div className="w-12 h-12 rounded border border-gray-200 bg-gray-100 flex items-center justify-center shrink-0">
      <Icon className="w-5 h-5 text-gray-400" />
    </div>
  );
}

export const ProofUploadVersion = ({ proofId, onVersionSaved }: ProofUploadVersionProps) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => f.size <= MAX_SIZE);
    if (arr.length < (incoming?.length || 0)) {
      toast({
        title: "Some files exceed 100 MB",
        description: "Skipped files that are larger than 100 MB. Compress and retry.",
        variant: "destructive",
      });
    }
    setFiles((prev) => [...prev, ...arr].slice(0, 6));
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadOne = async (file: File): Promise<string> => {
    const contentType = inferContentType(file);
    const { data: signed, error: signErr } = await supabase.functions.invoke(
      "proof-create-upload-url",
      { body: { filename: file.name, content_type: contentType } },
    );
    if (signErr || !signed?.success) {
      throw new Error(
        (signed as any)?.error || signErr?.message || "Failed to get upload URL",
      );
    }
    const { error: uploadErr } = await supabase.storage
      // Use the bucket the signed URL was actually minted for. The edge fn
      // signs into wrap-files and returns it as `bucket`; hardcoding
      // "proof-uploads" made the token/bucket mismatch so every upload
      // silently failed and the design never saved to the proof.
      .from(signed.bucket || "wrap-files")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType,
        upsert: false,
      });
    if (uploadErr) {
      throw new Error(`${file.name}: ${uploadErr.message}`);
    }
    return signed.path as string;
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setProgressLabel("");
    try {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const sizeMb = (f.size / 1024 / 1024).toFixed(1);
        setProgressLabel(`Uploading ${i + 1}/${files.length} — ${f.name} (${sizeMb} MB)`);
        const path = await uploadOne(f);
        paths.push(path);
      }

      setProgressLabel("Saving new version…");
      const { data: saveResult, error: saveErr } = await supabase.functions.invoke(
        "proof-save-version",
        {
          body: {
            proof_id: proofId,
            uploaded_file_paths: paths,
            shop_message: notes.trim() || undefined,
          },
          headers: {
            "Idempotency-Key": `upload-${proofId}-${Date.now()}`,
          },
        },
      );

      if (saveErr || !saveResult?.success) {
        throw new Error(saveResult?.error || saveErr?.message || "Save version failed");
      }

      toast({
        title: "Version uploaded",
        description: `v${saveResult.version_number} saved with ${paths.length} file(s)`,
      });

      setFiles([]);
      setNotes("");
      onVersionSaved();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setProgressLabel("");
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Upload className="w-4 h-4 text-[#3b82f6]" />
        <h3 className="text-sm font-semibold text-gray-900">Upload 2D Proof / New Version</h3>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-[#3b82f6] bg-blue-50"
            : "border-gray-300 hover:border-[#3b82f6]/50 bg-gray-50",
        )}
      >
        <Upload className="w-6 h-6 mx-auto text-gray-400 mb-2" />
        <p className="text-xs text-gray-500">
          Drop files here or click to browse
        </p>
        <p className="text-[10px] text-gray-400 mt-1">
          PNG, JPG, WebP, HEIC, TIFF, PDF — max 100 MB each, up to 6 files
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2.5 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
              <FileThumb file={f} />
              <span className="flex-1 truncate text-xs text-gray-700">{f.name}</span>
              <span className="text-[10px] text-gray-400 shrink-0">
                {f.size > 1024 * 1024
                  ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                  : `${(f.size / 1024).toFixed(0)} KB`}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="text-gray-400 hover:text-red-500 transition-colors"
                disabled={uploading}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Version notes */}
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Version notes (optional) — visible to customer in revision email..."
        className="min-h-[60px] text-sm bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400"
      />

      {/* Progress indicator while uploading large files */}
      {uploading && progressLabel && (
        <p className="text-[11px] text-blue-700 font-medium flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {progressLabel}
        </p>
      )}

      {/* Upload button */}
      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="w-full gap-2 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110 border-0"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Check className="w-4 h-4" />
            Upload &amp; Save Version
          </>
        )}
      </Button>
    </div>
  );
};
