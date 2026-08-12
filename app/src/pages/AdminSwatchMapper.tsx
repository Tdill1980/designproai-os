import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Check, X, Image as ImageIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface VinylSwatch {
  id: string;
  manufacturer: string;
  name: string;
  code: string | null;
  hex: string;
  media_url: string | null;
  series: string | null;
  finish: string;
}

interface ExtractedImage {
  name: string;
  url: string;
  selected: boolean;
}

const EXTRACTED_IMAGES_BASE = "parsed-documents://";

// Hardcoded extracted image paths from the PDF parsing
const EXTRACTED_IMAGE_SETS = {
  "3M": [
    { name: "page_1.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/page_1.jpg" },
    { name: "img_p0_3.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_3.jpg" },
    { name: "img_p0_4.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_4.jpg" },
    { name: "img_p0_5.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_5.jpg" },
    { name: "img_p0_6.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_6.jpg" },
    { name: "img_p0_7.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_7.jpg" },
    { name: "img_p0_8.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_8.jpg" },
    { name: "img_p0_9.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_9.jpg" },
    { name: "img_p0_10.jpg", url: "parsed-documents://avery-sw900-color-chart.pdf/img_p0_10.jpg" },
  ],
  "Avery Dennison": [
    { name: "page_1.jpg", url: "parsed-documents://3m-2080-color-chart.pdf/page_1.jpg" },
    { name: "img_p0_3.jpg", url: "parsed-documents://3m-2080-color-chart.pdf/img_p0_3.jpg" },
    { name: "img_p0_4.jpg", url: "parsed-documents://3m-2080-color-chart.pdf/img_p0_4.jpg" },
    { name: "img_p0_5.jpg", url: "parsed-documents://3m-2080-color-chart.pdf/img_p0_5.jpg" },
  ],
};

export default function AdminSwatchMapper() {
  const navigate = useNavigate();
  const [colors, setColors] = useState<VinylSwatch[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>("3M");
  const [selectedImage, setSelectedImage] = useState<ExtractedImage | null>(null);
  const [selectedColor, setSelectedColor] = useState<VinylSwatch | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [filterMissing, setFilterMissing] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  useEffect(() => {
    fetchColors();
  }, [selectedManufacturer, filterMissing]);

  const fetchColors = async () => {
    let query = supabase
      .from("vinyl_swatches")
      .select("*")
      .eq("manufacturer", selectedManufacturer)
      .order("name");

    if (filterMissing) {
      query = query.is("media_url", null);
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: "Error fetching colors", description: error.message, variant: "destructive" });
      return;
    }
    setColors(data || []);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    toast({ title: `${files.length} files added`, description: "Click on an image to select it for assignment" });
  };

  const handleAssign = async () => {
    if (!selectedColor || uploadedFiles.length === 0) {
      toast({ title: "Select both an image and a color", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      // Find the selected file (first one for now, or implement selection)
      const file = uploadedFiles[0];
      const ext = file.name.split('.').pop() || 'png';
      const code = selectedColor.code || selectedColor.name.replace(/\s+/g, '-').toLowerCase();
      const manufacturer = selectedColor.manufacturer.toLowerCase().replace(/\s+/g, '-');
      const filePath = `swatches/${manufacturer}/${code}.${ext}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("swatches")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("swatches")
        .getPublicUrl(filePath);

      // Update database
      const { error: updateError } = await supabase
        .from("vinyl_swatches")
        .update({ media_url: urlData.publicUrl })
        .eq("id", selectedColor.id);

      if (updateError) throw updateError;

      toast({ title: "Swatch assigned!", description: `${selectedColor.name} now has a swatch image` });
      
      // Remove assigned file and refresh
      setUploadedFiles(prev => prev.slice(1));
      setSelectedColor(null);
      fetchColors();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const manufacturers = ["3M", "Avery Dennison", "Oracal", "KPMF", "Inozetek", "Arlon"];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Admin Swatch Mapper</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Image Upload & Selection */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Swatch Images
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="swatch-upload"
                  />
                  <label htmlFor="swatch-upload" className="cursor-pointer">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Drop swatch images here or click to upload
                    </p>
                  </label>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {uploadedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                          idx === 0 ? "border-primary ring-2 ring-primary/50" : "border-border hover:border-primary/50"
                        }`}
                      >
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {uploadedFiles.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Upload extracted swatch images from your PDF color charts
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right: Color Selection */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Database Colors</CardTitle>
              <div className="flex gap-2 mt-2">
                <Select value={selectedManufacturer} onValueChange={setSelectedManufacturer}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {manufacturers.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={filterMissing ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterMissing(!filterMissing)}
                >
                  {filterMissing ? "Missing Only" : "Show All"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-y-auto space-y-2">
                {colors.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    {filterMissing ? "All colors have swatches!" : "No colors found"}
                  </p>
                ) : (
                  colors.map(color => (
                    <div
                      key={color.id}
                      onClick={() => setSelectedColor(color)}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                        selectedColor?.id === color.id
                          ? "bg-primary/20 border-2 border-primary"
                          : "bg-muted/50 hover:bg-muted border-2 border-transparent"
                      }`}
                    >
                      <div
                        className="w-10 h-10 rounded-md border border-border flex-shrink-0"
                        style={{ backgroundColor: color.hex }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{color.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {color.code || "No code"} • {color.finish}
                        </p>
                      </div>
                      {color.media_url ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Missing</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Assignment Action */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <div className="text-center">
            {uploadedFiles.length > 0 && (
              <p className="text-sm text-muted-foreground mb-2">
                First image will be assigned to: <strong>{selectedColor?.name || "Select a color"}</strong>
              </p>
            )}
            <Button
              size="lg"
              onClick={handleAssign}
              disabled={!selectedColor || uploadedFiles.length === 0 || isUploading}
            >
              {isUploading ? "Uploading..." : "Assign & Upload Swatch"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 text-center text-sm text-muted-foreground">
          {colors.length} colors shown • {uploadedFiles.length} images queued
        </div>
      </div>
    </div>
  );
}
