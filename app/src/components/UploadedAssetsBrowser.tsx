/**
 * UploadedAssetsBrowser — Browse previously uploaded images from email-assets/ in Supabase Storage
 * For logos, banners, custom graphics, Sproket mascot, etc.
 */
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, FolderOpen, Check, Upload, Trash2, Copy, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AssetFile {
  name: string;
  url: string;
  createdAt: string;
}

interface UploadedAssetsBrowserProps {
  onSelect: (url: string) => void;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline" | "default" | "secondary";
  triggerSize?: "sm" | "default" | "icon";
  triggerClassName?: string;
}

export function UploadedAssetsBrowser({
  onSelect,
  triggerLabel = "From Uploads",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}: UploadedAssetsBrowserProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: assets, isLoading } = useQuery({
    queryKey: ["uploaded-email-assets"],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("wrap-files")
        .list("email-assets", {
          limit: 200,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (error) throw error;

      const items: AssetFile[] = [];
      for (const file of data || []) {
        if (!file.name || file.name.startsWith(".")) continue;
        const { data: { publicUrl } } = supabase.storage
          .from("wrap-files")
          .getPublicUrl(`email-assets/${file.name}`);

        items.push({
          name: file.name,
          url: publicUrl,
          createdAt: file.created_at || "",
        });
      }
      return items;
    },
    enabled: open,
    staleTime: 30_000,
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is over 5MB — skipped`);
        continue;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fileName = `email-assets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage
        .from("wrap-files")
        .upload(fileName, file, { upsert: true, contentType: file.type });

      if (error) {
        toast.error(`Failed to upload ${file.name}`);
      } else {
        uploaded++;
      }
    }

    if (uploaded > 0) {
      toast.success(`Uploaded ${uploaded} image${uploaded > 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["uploaded-email-assets"] });
    }

    setUploading(false);
    e.target.value = "";
  };

  const handleDelete = async (name: string) => {
    const { error } = await supabase.storage
      .from("wrap-files")
      .remove([`email-assets/${name}`]);

    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["uploaded-email-assets"] });
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => toast.success("URL copied"));
  };

  const handlePick = (url: string) => {
    onSelect(url);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={cn("gap-1.5", triggerClassName)}>
          <FolderOpen className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-purple-400" />
              Uploaded Assets
              {assets && <span className="text-xs text-muted-foreground font-normal">({assets.length} images)</span>}
            </span>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading..." : "Upload Images"}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "calc(85vh - 140px)" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !assets || assets.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No uploaded assets yet</p>
              <p className="text-xs mt-1">Upload logos, banners, and custom graphics</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 pr-2">
              {assets.map(asset => (
                <div
                  key={asset.name}
                  className="group relative rounded-lg overflow-hidden border border-border hover:border-purple-500 transition-colors bg-card/50"
                >
                  <button
                    onClick={() => handlePick(asset.url)}
                    className="w-full aspect-square"
                  >
                    <img
                      src={asset.url}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <Check className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                  {/* Hover actions */}
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopyUrl(asset.url); }}
                      className="p-1 rounded bg-black/70 hover:bg-black/90 text-white"
                      title="Copy URL"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(asset.name); }}
                      className="p-1 rounded bg-black/70 hover:bg-red-600 text-white"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[9px] text-muted-foreground truncate px-1.5 py-1">{asset.name}</p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
