import { useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Upload,
  Trash2,
  ImageIcon,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import {
  MIGHTYMAIL_LANDING_SLOTS,
  type MightyMailLandingSlot,
} from "@/lib/mightymail-landing-slots";
import {
  useMightyMailLandingAssets,
  mightymailLandingAssetsKey,
} from "@/hooks/useMightyMailLandingAssets";

/**
 * /admin/mightymail-landing
 *
 * Drop-zone uploader for every image slot used on /mightymail-info.
 * Files go to wrap-files/mightymail-landing/, the public URL is upserted
 * into homepage_showcase keyed by slot.rowName, and the landing page
 * picks up the new URL on next load via useMightyMailLandingAssets.
 *
 * Mirrors AdminWpwFounderAssets but images-only (no video / TUS upload).
 */

const STORAGE_BUCKET = "wrap-files";
const STORAGE_PREFIX = "mightymail-landing";

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_");

const db = supabase as never as { from: (t: string) => any };

export default function AdminMightyMailLanding({ embedded = false }: { embedded?: boolean }) {
  const { data: assets = {}, isLoading } = useMightyMailLandingAssets();

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {!embedded && (
        <Helmet>
          <title>MightyMail Landing Assets — Admin</title>
        </Helmet>
      )}

      <main className={embedded ? "" : "container mx-auto px-4 py-8 max-w-5xl"}>
        {!embedded && (
          <div className="mb-6">
            <Button variant="ghost" asChild>
              <Link to="/admin">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Admin
              </Link>
            </Button>
          </div>
        )}

        <div className="mb-8">
          {!embedded && <h1 className="text-3xl font-bold mb-2">MightyMail Landing Assets</h1>}
          <p className="text-muted-foreground">
            Manage the images shown on the public landing page at{" "}
            <Link
              to="/mightymail-info"
              className="underline inline-flex items-center gap-1"
            >
              /mightymail-info
              <ExternalLink className="w-3 h-3" />
            </Link>
            . Files are stored in <code>wrap-files/mightymail-landing/</code>{" "}
            and served from Supabase's public CDN. Every slot is optional —
            empty slots fall back to the icon defaults.
          </p>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {MIGHTYMAIL_LANDING_SLOTS.map((s) => (
              <Card key={s.key} className="p-5 animate-pulse">
                <div className="h-5 bg-muted rounded w-2/3 mb-3" />
                <div className="h-40 bg-muted rounded mb-3" />
                <div className="h-9 bg-muted rounded" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {MIGHTYMAIL_LANDING_SLOTS.map((slot) => (
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
  slot: MightyMailLandingSlot;
  currentUrl: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress("Uploading…");

      const ext = file.name.split(".").pop() || "bin";
      const filePath = `${STORAGE_PREFIX}/${slot.key}-${Date.now()}-${sanitizeFileName(
        file.name.replace(/\.[^.]+$/, ""),
      )}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || undefined,
          cacheControl: "31536000",
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

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
        const { error } = await db.from("homepage_showcase").insert(payload);
        if (error) throw error;
      }

      return publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mightymailLandingAssetsKey });
      toast({ title: "Uploaded", description: `${slot.label} updated.` });
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

  // Direct URL save — for hosted images (CDN, S3, etc.) without re-upload.
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
      queryClient.invalidateQueries({ queryKey: mightymailLandingAssetsKey });
      toast({ title: "Saved", description: `${slot.label} updated.` });
      setPendingUrl("");
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
      const { error } = await db
        .from("homepage_showcase")
        .update({ image_url: "", is_active: false })
        .eq("name", slot.rowName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mightymailLandingAssetsKey });
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

  return (
    <Card className="p-5 border border-border bg-card">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
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
          <img
            src={currentUrl}
            alt={slot.label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 border-2 border-dashed border-border rounded-md">
            <ImageIcon className="w-7 h-7 text-muted-foreground/60 mb-2" />
            <div className="text-xs text-muted-foreground/80 font-medium">
              No image uploaded
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
        accept="image/png,image/jpeg,image/webp,image/gif"
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
            {currentUrl ? "Replace" : "Upload"} image
          </>
        )}
      </Button>

      <div className="mt-3 pt-3 border-t border-border">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
          Or paste an image URL
        </div>
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://…"
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
              if (!/^https?:\/\//i.test(u)) {
                toast({
                  title: "Invalid URL",
                  description: "Paste a full http(s) image URL.",
                  variant: "destructive",
                });
                return;
              }
              urlSaveMutation.mutate(u);
            }}
          >
            {urlSaveMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>

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
