import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, GripVertical } from "lucide-react";

const POPUP_SLIDE_PREFIX = "popup:slide";
const POPUP_CONFIG_NAME = "popup:config";

const AdminPopupManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [slideLabel, setSlideLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [boldTitle, setBoldTitle] = useState("");
  const [subMessage, setSubMessage] = useState("");

  // ── Fetch popup config (bold title + sub message) ──
  const { data: popupConfig } = useQuery({
    queryKey: ["popup-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .eq("name", POPUP_CONFIG_NAME)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // ── Fetch carousel slides ──
  const { data: slides, isLoading } = useQuery({
    queryKey: ["popup-slides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .like("name", `${POPUP_SLIDE_PREFIX}%`)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Save messaging config ──
  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      if (!boldTitle.trim()) throw new Error("Bold title is required");
      const payload = {
        name: POPUP_CONFIG_NAME,
        title: boldTitle.trim(),
        alt_text: subMessage.trim(),
        image_url: "none",
        sort_order: 0,
        is_active: true,
      };
      if (popupConfig?.id) {
        const { error } = await supabase
          .from("homepage_showcase")
          .update({ title: payload.title, alt_text: payload.alt_text })
          .eq("id", popupConfig.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("homepage_showcase")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popup-config"] });
      queryClient.invalidateQueries({ queryKey: ["waitlist-popup-config"] });
      toast({ title: "Saved", description: "Popup messaging updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Upload slide ──
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error("Please select an image");
      const fileName = `popup/${Date.now()}_${uploadFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("carousel-images")
        .upload(fileName, uploadFile);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("carousel-images")
        .getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("homepage_showcase")
        .insert({
          name: `${POPUP_SLIDE_PREFIX}:${Date.now()}`,
          title: slideLabel || uploadFile.name.replace(/\.[^.]+$/, ""),
          alt_text: slideLabel || "Popup carousel slide",
          image_url: publicUrl,
          sort_order: parseInt(sortOrder) || 0,
          is_active: true,
        });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popup-slides"] });
      queryClient.invalidateQueries({ queryKey: ["waitlist-popup-slides"] });
      toast({ title: "Uploaded", description: "Slide added to popup carousel" });
      setUploadFile(null);
      setSlideLabel("");
      setSortOrder("0");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Toggle active ──
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("homepage_showcase")
        .update({ is_active: !is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popup-slides"] });
      queryClient.invalidateQueries({ queryKey: ["waitlist-popup-slides"] });
    },
  });

  // ── Delete slide ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("homepage_showcase")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popup-slides"] });
      queryClient.invalidateQueries({ queryKey: ["waitlist-popup-slides"] });
      toast({ title: "Deleted", description: "Slide removed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Pre-fill form when config loads
  const configTitle = popupConfig?.title || "";
  const configSub = popupConfig?.alt_text || "";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <Button variant="ghost" onClick={() => navigate("/admin")} className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Popup Manager</h1>
          <p className="text-muted-foreground mt-1">
            Manage the signup popup carousel images and messaging
          </p>
        </div>

        {/* ── MESSAGING SECTION ── */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Popup Messaging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="bold-title">Bold Title</Label>
              <Input
                id="bold-title"
                placeholder={configTitle || "DesignProAI Wrap Visualizer System"}
                defaultValue={configTitle}
                onChange={(e) => setBoldTitle(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Main headline shown in the popup banner</p>
            </div>
            <div>
              <Label htmlFor="sub-message">Sub Message</Label>
              <Input
                id="sub-message"
                placeholder={configSub || "ColorPro • FadeWrap • ApprovePro • MyVehicleProAI"}
                defaultValue={configSub}
                onChange={(e) => setSubMessage(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Smaller text shown below the title</p>
            </div>
            <Button
              onClick={() => {
                if (!boldTitle && configTitle) setBoldTitle(configTitle);
                if (!subMessage && configSub) setSubMessage(configSub);
                saveConfigMutation.mutate();
              }}
              disabled={saveConfigMutation.isPending}
            >
              {saveConfigMutation.isPending ? "Saving..." : "Save Messaging"}
            </Button>
          </CardContent>
        </Card>

        {/* ── UPLOAD SECTION ── */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Add Carousel Slide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="slide-image">Slide Image</Label>
              <Input
                id="slide-image"
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="slide-label">Label (optional)</Label>
                <Input
                  id="slide-label"
                  placeholder="e.g. ColorPro"
                  value={slideLabel}
                  onChange={(e) => setSlideLabel(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sort-order">Sort Order</Label>
                <Input
                  id="sort-order"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadFile || uploadMutation.isPending}
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploadMutation.isPending ? "Uploading..." : "Upload Slide"}
            </Button>
          </CardContent>
        </Card>

        {/* ── CURRENT SLIDES ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Current Slides</CardTitle>
              <Badge variant="outline">{slides?.length ?? 0} slides</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : !slides?.length ? (
              <p className="text-muted-foreground text-sm">No slides yet. Upload your first one above.</p>
            ) : (
              <div className="space-y-3">
                {slides.map((slide) => (
                  <div
                    key={slide.id}
                    className="flex items-center gap-4 rounded-lg border p-3 bg-card"
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <img
                      src={slide.image_url}
                      alt={slide.alt_text}
                      className="w-24 h-16 object-cover rounded-md border"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{slide.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Order: {slide.sort_order} {!slide.is_active && "• Hidden"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleMutation.mutate({ id: slide.id, is_active: !!slide.is_active })}
                    >
                      {slide.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(slide.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── LIVE PREVIEW ── */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-lg">Live Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-[360px] mx-auto bg-[#0a0a0a] rounded-2xl overflow-hidden border border-white/10">
              {/* Carousel preview */}
              <div className="relative w-full h-[160px] overflow-hidden">
                {slides && slides.filter(s => s.is_active).length > 0 ? (
                  <img
                    src={slides.filter(s => s.is_active)[0]?.image_url}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-sm">
                    No active slides
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent" />
              </div>
              {/* Messaging preview */}
              <div className="px-4 py-3">
                <div className="rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/5 px-3 py-2.5 text-center">
                  <p className="text-xs text-white font-bold">
                    {boldTitle || configTitle || "DesignProAI Wrap Visualizer System"}
                  </p>
                  <p className="text-[10px] text-cyan-400 mt-1">
                    {subMessage || configSub || "ColorPro • FadeWrap • ApprovePro • MyVehicleProAI"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminPopupManager;
