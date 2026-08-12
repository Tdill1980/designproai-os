import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus, Trash2, Search, CheckCircle, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface ManufacturerColor {
  id: string;
  manufacturer: string;
  series: string | null;
  product_code: string;
  official_name: string;
  official_hex: string;
  official_swatch_url: string | null;
  lab_l: number | null;
  lab_a: number | null;
  lab_b: number | null;
  finish: string;
  is_ppf: boolean;
  is_verified: boolean;
  created_at: string;
}

const MANUFACTURERS = ["3M", "Avery", "KPMF", "Oracal", "TeckWrap", "Inozetek"];
const FINISHES = ["Gloss", "Matte", "Satin", "Metallic", "Chrome", "Brushed"];

export default function AdminManufacturerColors() {
  const [colors, setColors] = useState<ManufacturerColor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState<string>("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  // Form state for new color
  const [newColor, setNewColor] = useState({
    manufacturer: "3M",
    series: "",
    product_code: "",
    official_name: "",
    official_hex: "#000000",
    finish: "Gloss",
    is_ppf: false,
    lab_l: "",
    lab_a: "",
    lab_b: "",
  });

  useEffect(() => {
    fetchColors();
  }, []);

  const fetchColors = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("manufacturer_colors")
      .select("*")
      .order("manufacturer", { ascending: true })
      .order("official_name", { ascending: true });

    if (error) {
      toast({ title: "Error fetching colors", description: error.message, variant: "destructive" });
    } else {
      setColors(data || []);
    }
    setIsLoading(false);
  };

  const handleAddColor = async () => {
    if (!newColor.product_code || !newColor.official_name) {
      toast({ title: "Missing required fields", variant: "destructive" });
      return;
    }

    const insertData = {
      manufacturer: newColor.manufacturer,
      series: newColor.series || null,
      product_code: newColor.product_code,
      official_name: newColor.official_name,
      official_hex: newColor.official_hex,
      finish: newColor.finish,
      is_ppf: newColor.is_ppf,
      lab_l: newColor.lab_l ? parseFloat(newColor.lab_l) : null,
      lab_a: newColor.lab_a ? parseFloat(newColor.lab_a) : null,
      lab_b: newColor.lab_b ? parseFloat(newColor.lab_b) : null,
      is_verified: true,
    };

    const { error } = await supabase.from("manufacturer_colors").insert(insertData);

    if (error) {
      toast({ title: "Error adding color", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Color added successfully" });
      setIsAddDialogOpen(false);
      setNewColor({
        manufacturer: "3M",
        series: "",
        product_code: "",
        official_name: "",
        official_hex: "#000000",
        finish: "Gloss",
        is_ppf: false,
        lab_l: "",
        lab_a: "",
        lab_b: "",
      });
      fetchColors();
    }
  };

  const handleUploadSwatch = async (colorId: string, file: File) => {
    setUploading(true);
    const fileName = `${colorId}_${Date.now()}.${file.name.split('.').pop()}`;
    const filePath = `manufacturer-swatches/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("swatches")
      .upload(filePath, file);

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("swatches")
      .getPublicUrl(filePath);

    const { error: updateError } = await supabase
      .from("manufacturer_colors")
      .update({ official_swatch_url: publicUrlData.publicUrl })
      .eq("id", colorId);

    if (updateError) {
      toast({ title: "Update failed", description: updateError.message, variant: "destructive" });
    } else {
      toast({ title: "Swatch uploaded successfully" });
      fetchColors();
    }
    setUploading(false);
  };

  const handleDeleteColor = async (colorId: string) => {
    if (!confirm("Delete this color?")) return;

    const { error } = await supabase.from("manufacturer_colors").delete().eq("id", colorId);

    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Color deleted" });
      fetchColors();
    }
  };

  // Filter colors
  const filteredColors = colors.filter((c) => {
    const matchesSearch = 
      c.official_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.product_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesManufacturer = filterManufacturer === "all" || c.manufacturer === filterManufacturer;
    return matchesSearch && matchesManufacturer;
  });

  const colorStats = {
    total: colors.length,
    withSwatch: colors.filter(c => c.official_swatch_url).length,
    withLab: colors.filter(c => c.lab_l !== null).length,
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Manufacturer Colors</h1>
            <p className="text-muted-foreground">
              Authoritative source of truth for verified manufacturer colors
            </p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Add Color
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Manufacturer Color</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Manufacturer</Label>
                    <Select
                      value={newColor.manufacturer}
                      onValueChange={(v) => setNewColor({ ...newColor, manufacturer: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MANUFACTURERS.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Finish</Label>
                    <Select
                      value={newColor.finish}
                      onValueChange={(v) => setNewColor({ ...newColor, finish: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FINISHES.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Product Code *</Label>
                  <Input
                    value={newColor.product_code}
                    onChange={(e) => setNewColor({ ...newColor, product_code: e.target.value })}
                    placeholder="e.g., 2080-G12"
                  />
                </div>
                <div>
                  <Label>Official Name *</Label>
                  <Input
                    value={newColor.official_name}
                    onChange={(e) => setNewColor({ ...newColor, official_name: e.target.value })}
                    placeholder="e.g., Gloss Black"
                  />
                </div>
                <div>
                  <Label>Series</Label>
                  <Input
                    value={newColor.series}
                    onChange={(e) => setNewColor({ ...newColor, series: e.target.value })}
                    placeholder="e.g., 2080"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Official Hex</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={newColor.official_hex}
                        onChange={(e) => setNewColor({ ...newColor, official_hex: e.target.value })}
                        className="w-12 h-10 p-1"
                      />
                      <Input
                        value={newColor.official_hex}
                        onChange={(e) => setNewColor({ ...newColor, official_hex: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newColor.is_ppf}
                        onChange={(e) => setNewColor({ ...newColor, is_ppf: e.target.checked })}
                      />
                      Is PPF
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>LAB L*</Label>
                    <Input
                      type="number"
                      value={newColor.lab_l}
                      onChange={(e) => setNewColor({ ...newColor, lab_l: e.target.value })}
                      placeholder="0-100"
                    />
                  </div>
                  <div>
                    <Label>LAB a*</Label>
                    <Input
                      type="number"
                      value={newColor.lab_a}
                      onChange={(e) => setNewColor({ ...newColor, lab_a: e.target.value })}
                      placeholder="-128 to 127"
                    />
                  </div>
                  <div>
                    <Label>LAB b*</Label>
                    <Input
                      type="number"
                      value={newColor.lab_b}
                      onChange={(e) => setNewColor({ ...newColor, lab_b: e.target.value })}
                      placeholder="-128 to 127"
                    />
                  </div>
                </div>
                <Button onClick={handleAddColor} className="w-full">
                  Add Color
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{colorStats.total}</div>
              <p className="text-sm text-muted-foreground">Total Colors</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-500">{colorStats.withSwatch}</div>
              <p className="text-sm text-muted-foreground">With Swatch Image</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-500">{colorStats.withLab}</div>
              <p className="text-sm text-muted-foreground">With LAB Values</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterManufacturer} onValueChange={setFilterManufacturer}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Manufacturer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Manufacturers</SelectItem>
              {MANUFACTURERS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Colors Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : filteredColors.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No colors found. Add manufacturer colors to populate ColorPro.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredColors.map((color) => (
              <Card key={color.id} className="overflow-hidden">
                <div className="relative aspect-square">
                  {color.official_swatch_url ? (
                    <img
                      src={color.official_swatch_url}
                      alt={color.official_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{ backgroundColor: color.official_hex }}
                    />
                  )}
                  {/* Status badges */}
                  <div className="absolute top-2 right-2 flex flex-col gap-1">
                    {color.official_swatch_url ? (
                      <span className="bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                        <CheckCircle className="h-3 w-3 inline" />
                      </span>
                    ) : (
                      <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                        No Image
                      </span>
                    )}
                    {color.lab_l !== null && (
                      <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                        LAB
                      </span>
                    )}
                  </div>
                </div>
                <CardContent className="p-3">
                  <p className="text-xs text-primary font-medium">{color.manufacturer}</p>
                  <p className="font-medium text-sm truncate" title={color.official_name}>
                    {color.official_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{color.product_code}</p>
                  <p className="text-xs text-muted-foreground capitalize">{color.finish}</p>
                  <div className="flex gap-1 mt-2">
                    <label className="flex-1">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadSwatch(color.id, file);
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        disabled={uploading}
                        asChild
                      >
                        <span>
                          <Upload className="h-3 w-3 mr-1" />
                          {color.official_swatch_url ? "Replace" : "Upload"}
                        </span>
                      </Button>
                    </label>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteColor(color.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

    </div>
  );
}
