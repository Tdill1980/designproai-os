import { useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as tus from "tus-js-client";
import {
  ArrowLeft,
  Upload,
  Trash2,
  ImageIcon,
  Video,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  WPW_FOUNDER_SLOTS,
  isVideoUrl,
  getEmbedUrl,
  type WpwFounderSlot,
} from "@/lib/wpw-founder-slots";
import { Input } from "@/components/ui/input";
import {
  useWpwFounderAssets,
  wpwFounderAssetsKey,
} from "@/hooks/useWpwFounderAssets";

/**
 * /admin/wpw-founder-assets
 *
 * Drop-zone uploader for every asset slot used on /from/weprintwraps.
 * Files go to wrap-files/wpw-founder/, the public URL is upserted into
 * homepage_showcase keyed by slot.rowName, and the founder page picks
 * up the new URL on next load via useWpwFounderAssets.
 */

const STORAGE_BUCKET = "wrap-files";
const STORAGE_PREFIX = "wpw-founder";

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_");

const db = supabase as never as { from: (t: string) => any };

export default function AdminWpwFounderAssets() {
  const { data: assets = {}, isLoading } = useWpwFounderAssets();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>WPW Founder Assets — Admin</title>
      </Helmet>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link to="/admin">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Admin
            </Link>
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">WPW Founder Page Assets</h1>
          <p className="text-muted-foreground">
            Upload the founder video and one explainer image per tool. These
            appear on{" "}
            <Link
              to="/from/weprintwraps"
              className="underline inline-flex items-center gap-1"
            >
              /from/weprintwraps
              <ExternalLink className="w-3 h-3" />
            </Link>
            . Files are stored in <code>wrap-files/wpw-founder/</code> and
            served from Supabase's public CDN.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/help/wpw-rep-guide"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25"
            >
              👁 Preview Rep Guide (team cards)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href="/from/weprintwraps"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-fuchsia-500/15 px-3 py-2 text-sm font-semibold text-fuchsia-300 hover:bg-fuchsia-500/25"
            >
              👁 Preview Founder Landing
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {WPW_FOUNDER_SLOTS.map((s) => (
              <Card key={s.key} className="p-5 animate-pulse">
                <div className="h-5 bg-muted rounded w-2/3 mb-3" />
                <div className="h-40 bg-muted rounded mb-3" />
                <div className="h-9 bg-muted rounded" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {WPW_FOUNDER_SLOTS.map((slot) => (
              <SlotCard
                key={slot.key}
                slot={slot}
                currentUrl={assets[slot.key] || ""}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Single slot card ────────────────────────────────────────────────────────

function SlotCard({
  slot,
  currentUrl,
}: {
  slot: WpwFounderSlot;
  currentUrl: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress("Uploading…");

      const ext = file.name.split(".").pop() || "bin";
      const filePath = `${STORAGE_PREFIX}/${slot.key}-${Date.now()}-${sanitizeFileName(
        file.name.replace(/\.[^.]+$/, "")
      )}.${ext}`;

      // 1. Upload to storage.
      // For files > 6MB (typical iPhone .mov reels) the standard PostgREST
      // upload path returns 400. Switch to Supabase's TUS resumable
      // endpoint for anything above 5MB so big videos go up cleanly with
      // 6MB chunks and automatic retry.
      const RESUMABLE_THRESHOLD = 5 * 1024 * 1024; // 5MB
      if (file.size > RESUMABLE_THRESHOLD) {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Not signed in. Refresh the page and try again.");

        const projectUrl = (supabase as any).supabaseUrl as string;
        const anonKey = (supabase as any).supabaseKey as string;

        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: `${projectUrl}/storage/v1/upload/resumable`,
            retryDelays: [0, 1500, 3000, 6000, 12000],
            headers: {
              authorization: `Bearer ${accessToken}`,
              "x-upsert": "true",
              apikey: anonKey,
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
              bucketName: STORAGE_BUCKET,
              objectName: filePath,
              contentType: file.type || "application/octet-stream",
              cacheControl: "31536000",
            },
            chunkSize: 6 * 1024 * 1024, // 6MB chunks (Supabase requirement)
            onError: (err) => reject(err),
            onProgress: (sent, total) => {
              const pct = Math.round((sent / total) * 100);
              setProgress(`Uploading ${pct}%`);
            },
            onSuccess: () => resolve(),
          });
          upload.start();
        });
      } else {
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, file, {
            upsert: true,
            contentType: file.type || undefined,
            cacheControl: "31536000",
          });
        if (uploadError) throw uploadError;
      }

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      // 2. Upsert homepage_showcase row keyed by slot.rowName
      setProgress("Saving…");

      const { data: existing } = await db
        .from("homepage_showcase")
        .select("id")
        .eq("name", slot.rowName)
        .maybeSingle();

      const payload = {
        name: slot.rowName,
        title: slot.label,
        alt_text: slot.label,
        image_url: publicUrl,
        is_active: true,
        sort_order: 0,
      };

      if (existing?.id) {
        const { error } = await db
          .from("homepage_showcase")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("homepage_showcase")
          .insert(payload);
        if (error) throw error;
      }

      return publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wpwFounderAssetsKey });
      toast({
        title: "Uploaded",
        description: `${slot.label} updated.`,
      });
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: any) => {
      toast({
        title: "Upload failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
      setProgress(null);
    },
  });

  // Direct URL save (used for YouTube/Vimeo embeds — no storage upload).
  const urlSaveMutation = useMutation({
    mutationFn: async (url: string) => {
      const { data: existing } = await db
        .from("homepage_showcase")
        .select("id")
        .eq("name", slot.rowName)
        .maybeSingle();
      const payload = {
        name: slot.rowName,
        title: slot.label,
        alt_text: slot.label,
        image_url: url,
        is_active: true,
        sort_order: 0,
      };
      if (existing?.id) {
        const { error } = await db
          .from("homepage_showcase")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("homepage_showcase").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wpwFounderAssetsKey });
      toast({ title: "Saved", description: `${slot.label} updated.` });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      // Soft-remove by clearing image_url; row stays so the slot stays
      // visible in the admin list. Hard delete is fine too but keeping
      // the row makes the next upload a single update instead of insert.
      const { error } = await db
        .from("homepage_showcase")
        .update({ image_url: "", is_active: false })
        .eq("name", slot.rowName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wpwFounderAssetsKey });
      toast({ title: "Removed", description: `${slot.label} cleared.` });
    },
    onError: (err: any) => {
      toast({
        title: "Remove failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const embedUrl = getEmbedUrl(currentUrl);
  // For tool slots, the file may be either image or video, so we sniff the
  // saved URL. The dedicated founder-video slot is always rendered as video.
  const renderAsVideo = currentUrl
    ? slot.kind === "video" || isVideoUrl(currentUrl) || !!embedUrl
    : slot.kind === "video";
  const Icon = renderAsVideo ? Video : ImageIcon;
  // Founder-video slot also accepts a YouTube/Vimeo URL (gateway 50MB cap).
  const supportsEmbedUrl = slot.kind === "video";
  const [pendingUrl, setPendingUrl] = useState("");

  return (
    <Card className="p-5 border border-border bg-card">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
            {slot.label}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            {slot.helper}
          </p>
        </div>
        {currentUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive shrink-0"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
            title="Clear this slot"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div
        className={`relative w-full ${slot.ratio} rounded-md overflow-hidden border border-border bg-muted/30 mb-3`}
      >
        {currentUrl ? (
          embedUrl ? (
            <iframe
              src={embedUrl}
              title={slot.label}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : renderAsVideo ? (
            <video
              src={currentUrl}
              className="w-full h-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={currentUrl}
              alt={slot.label}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 border-2 border-dashed border-border rounded-md">
            <Icon className="w-7 h-7 text-muted-foreground/60 mb-2" />
            <div className="text-xs text-muted-foreground/80 font-medium">
              No {renderAsVideo ? "video" : "image"} uploaded
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
              {slot.recommendedSize}
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={slot.accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
        }}
      />

      <Button
        type="button"
        variant={currentUrl ? "outline" : "default"}
        className="w-full"
        disabled={uploadMutation.isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploadMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {progress || "Uploading…"}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            {currentUrl ? "Replace" : "Upload"} {renderAsVideo ? "video" : "image"}
          </>
        )}
      </Button>

      {/* Founder video also accepts a YouTube/Vimeo URL — useful when the
          original .mov is too big for Supabase's 50MB upload gateway. */}
      {supportsEmbedUrl && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Or paste a YouTube / Vimeo URL
          </div>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://youtu.be/…"
              value={pendingUrl}
              onChange={(e) => setPendingUrl(e.target.value)}
              className="text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pendingUrl.trim() || urlSaveMutation.isPending}
              onClick={() => {
                const u = pendingUrl.trim();
                if (!getEmbedUrl(u)) {
                  toast({
                    title: "Not a YouTube or Vimeo link",
                    description: "Paste a youtube.com / youtu.be / vimeo.com URL.",
                    variant: "destructive",
                  });
                  return;
                }
                urlSaveMutation.mutate(u);
                setPendingUrl("");
              }}
            >
              {urlSaveMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-snug">
            Tip: upload your reel to YouTube as Unlisted, then paste the
            share link here. No file size limits.
          </p>
        </div>
      )}

      {currentUrl && (
        <p className="text-[10px] text-muted-foreground/70 mt-2 truncate">
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {currentUrl}
          </a>
        </p>
      )}
    </Card>
  );
}
