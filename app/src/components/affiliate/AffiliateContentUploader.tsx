import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useUploadAffiliateContent } from "@/hooks/useAffiliateContent";
import { toast } from "sonner";
import { Upload, Film, ImageIcon } from "lucide-react";

interface AffiliateContentUploaderProps {
  partnerId: string;
  onSuccess?: () => void;
}

export function AffiliateContentUploader({ partnerId, onSuccess }: AffiliateContentUploaderProps) {
  const upload = useUploadAffiliateContent();
  const [file, setFile] = useState<File | null>(null);
  const [contentType, setContentType] = useState<"reel" | "static_ad">("reel");
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleSubmit = async () => {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    try {
      await upload.mutateAsync({
        partnerId,
        file,
        contentType,
        title: title || undefined,
      });
      toast.success("Content uploaded successfully");
      setFile(null);
      setTitle("");
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Content Type</Label>
          <Select value={contentType} onValueChange={(v) => setContentType(v as "reel" | "static_ad")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reel">
                <div className="flex items-center gap-2"><Film className="h-4 w-4" /> Reel (Video)</div>
              </SelectItem>
              <SelectItem value="static_ad">
                <div className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Static Ad (Image)</div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Title (optional)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Content title..." />
        </div>
      </div>

      <Card
        className={`border-2 border-dashed transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onClick={() => document.getElementById("affiliate-file-input")?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
          {file ? (
            <div className="text-center">
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <>
              <p className="font-medium">Drop file here or click to browse</p>
              <p className="text-sm text-muted-foreground">
                {contentType === "reel" ? "MP4, MOV up to 100MB" : "PNG, JPG, WebP up to 100MB"}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <input
        id="affiliate-file-input"
        type="file"
        className="hidden"
        accept={contentType === "reel" ? "video/*" : "image/*"}
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <Button onClick={handleSubmit} disabled={!file || upload.isPending} className="w-full">
        {upload.isPending ? "Uploading..." : "Upload Content"}
      </Button>
    </div>
  );
}
