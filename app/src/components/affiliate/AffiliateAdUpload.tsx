import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload,
  Video,
  Image,
  Loader2,
  CheckCircle,
  Clock,
  Megaphone,
  X,
} from "lucide-react";

interface AffiliateAdUploadProps {
  affiliateId: string;
  affiliateName: string;
}

interface UploadedAd {
  id: string;
  file_name: string;
  file_url: string;
  ad_type: string;
  caption: string;
  status: string;
  created_at: string;
  admin_notes?: string;
}

const AD_TYPES = [
  { value: "reel", label: "Video Reel", icon: Video },
  { value: "static", label: "Static Ad", icon: Image },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Under Review" },
  approved: { bg: "bg-green-500/20", text: "text-green-400", label: "Approved" },
  promoted: { bg: "bg-primary/20", text: "text-primary", label: "Paid Partner Ad" },
  rejected: { bg: "bg-red-500/20", text: "text-red-400", label: "Not Selected" },
};

export function AffiliateAdUpload({ affiliateId, affiliateName }: AffiliateAdUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState("reel");
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submissions, setSubmissions] = useState<UploadedAd[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load previous submissions
  useState(() => {
    loadSubmissions();
  });

  async function loadSubmissions() {
    try {
      const { data, error } = await supabase
        .from("affiliate_ad_submissions")
        .select("*")
        .eq("affiliate_id", affiliateId)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setSubmissions(data as UploadedAd[]);
      }
    } catch {
      // Table may not exist yet - that's fine
    } finally {
      setLoadingSubmissions(false);
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = selectedType === "reel"
      ? ["video/mp4", "video/quicktime", "video/webm"]
      : ["image/jpeg", "image/png", "image/webp"];

    if (!validTypes.includes(file.type)) {
      toast.error(
        selectedType === "reel"
          ? "Please upload a video file (MP4, MOV, or WebM)"
          : "Please upload an image file (JPEG, PNG, or WebP)"
      );
      return;
    }

    // Max 100MB for videos, 10MB for images
    const maxSize = selectedType === "reel" ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(
        selectedType === "reel"
          ? "Video must be under 100MB"
          : "Image must be under 10MB"
      );
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setUploading(true);
    try {
      // Upload file to storage
      const fileExt = selectedFile.name.split(".").pop();
      const filePath = `affiliate-ads/${affiliateId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("affiliate-assets")
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("affiliate-assets")
        .getPublicUrl(filePath);

      // Insert submission record
      const { error: insertError } = await supabase
        .from("affiliate_ad_submissions")
        .insert({
          affiliate_id: affiliateId,
          affiliate_name: affiliateName,
          file_name: selectedFile.name,
          file_url: urlData.publicUrl,
          ad_type: selectedType,
          caption: caption.trim() || null,
          status: "pending",
        });

      if (insertError) throw insertError;

      toast.success("Ad submitted! We'll review it and let you know.");
      setSelectedFile(null);
      setCaption("");
      setShowForm(false);
      if (fileRef.current) fileRef.current.value = "";
      loadSubmissions();
    } catch (error: any) {
      toast.error(error.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Megaphone className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Submit Your Ads</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Upload finished ads featuring DesignProAI. If we choose your ad, we pay for a{" "}
                <span className="text-primary font-medium">paid partner ad campaign</span> and share your
                code to a much larger audience - at our cost.
              </p>
            </div>
          </div>
          {!showForm && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setShowForm(true)}
            >
              <Upload className="h-4 w-4" /> Upload Ad
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Upload Form */}
        {showForm && (
          <div className="mb-6 p-4 rounded-xl border border-border bg-muted/30 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">
                New Submission
              </h4>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setShowForm(false);
                  setSelectedFile(null);
                  setCaption("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Ad Type Selector */}
            <div>
              <Label className="text-xs text-muted-foreground">Ad Type</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {AD_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.value}
                      onClick={() => {
                        setSelectedType(type.value);
                        setSelectedFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                        selectedType === type.value
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* File Upload */}
            <div>
              <Label className="text-xs text-muted-foreground">
                {selectedType === "reel"
                  ? "Video File (MP4, MOV, WebM - max 100MB)"
                  : "Image File (JPEG, PNG, WebP - max 10MB)"}
              </Label>
              <Input
                ref={fileRef}
                type="file"
                accept={
                  selectedType === "reel"
                    ? "video/mp4,video/quicktime,video/webm"
                    : "image/jpeg,image/png,image/webp"
                }
                onChange={handleFileSelect}
                className="mt-1"
              />
              {selectedFile && (
                <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {selectedFile.name} (
                  {(selectedFile.size / 1024 / 1024).toFixed(1)}MB)
                </p>
              )}
            </div>

            {/* Requirements Notice */}
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300 space-y-1">
              <p className="font-medium text-yellow-400">Requirements:</p>
              <p>Videos must be a <strong>finished ad</strong> featuring DesignProAI - not raw footage or screen recordings.</p>
              <p>Static ads should be polished, branded creative ready for social media.</p>
            </div>

            {/* Caption */}
            <div>
              <Label className="text-xs text-muted-foreground">
                Caption / Description (optional)
              </Label>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe your ad - target audience, platform, messaging..."
                rows={3}
                className="mt-1"
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
              className="w-full gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Submit for Review
                </>
              )}
            </Button>
          </div>
        )}

        {/* Previous Submissions */}
        {!loadingSubmissions && submissions.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              Your Submissions
            </h4>
            {submissions.map((ad) => {
              const statusStyle = STATUS_STYLES[ad.status] || STATUS_STYLES.pending;
              return (
                <div
                  key={ad.id}
                  className="flex items-center gap-4 p-3 rounded-lg border border-border bg-muted/20"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {ad.ad_type === "reel" ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="h-6 w-6 text-muted-foreground" />
                      </div>
                    ) : (
                      <img
                        src={ad.file_url}
                        alt={ad.file_name}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">
                      {ad.file_name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        className={`${statusStyle.bg} ${statusStyle.text} text-xs border-0`}
                      >
                        {statusStyle.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground capitalize">
                        {ad.ad_type}
                      </span>
                    </div>
                    {ad.admin_notes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        {ad.admin_notes}
                      </p>
                    )}
                  </div>
                  {/* Date */}
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(ad.created_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        ) : !loadingSubmissions ? (
          <div className="text-center py-6 text-muted-foreground">
            <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              No submissions yet. Upload a finished ad featuring DesignProAI and
              we may run it as a paid partner ad with your code!
            </p>
          </div>
        ) : (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
