import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, Upload, Check, AlertTriangle, Palette, Database } from "lucide-react";

interface ManufacturerColor {
  id: string;
  manufacturer: string;
  product_code: string;
  official_name: string;
  official_hex: string;
  official_swatch_url: string | null;
  finish: string;
  hex_source: string | null;
  hex_confidence: number | null;
  is_verified: boolean | null;
}

export default function AdminColorAudit() {
  const [colors, setColors] = useState<ManufacturerColor[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>("all");
  const [editingHex, setEditingHex] = useState<{ id: string; hex: string } | null>(null);

  useEffect(() => {
    fetchColors();
  }, []);

  const fetchColors = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("manufacturer_colors")
      .select("*")
      .order("manufacturer")
      .order("product_code");

    if (error) {
      toast.error("Failed to fetch colors");
      console.error(error);
    } else {
      setColors(data || []);
    }
    setLoading(false);
  };

  const importColors = async () => {
    setImporting(true);
    try {
      const response = await renderClient.functions.invoke("import-official-colors", {
        body: { manufacturer: "all" }
      });

      if (response.error) throw response.error;

      toast.success(`Imported: ${response.data.inserted} new, ${response.data.updated} updated`);
      fetchColors();
    } catch (error) {
      toast.error("Import failed");
      console.error(error);
    }
    setImporting(false);
  };

  const extractSwatches = async (manufacturer: string) => {
    setExtracting(manufacturer);
    try {
      // Use the poster URLs from public storage
      const posterUrl = manufacturer === "Avery Dennison"
        ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/color-charts/avery-sw900-poster.jpg`
        : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/color-charts/3m-2080-poster.jpg`;

      const response = await renderClient.functions.invoke("extract-color-swatches", {
        body: { posterUrl, manufacturer }
      });

      if (response.error) throw response.error;

      toast.success(`Extracted ${response.data.updated} colors for ${manufacturer}`);
      fetchColors();
    } catch (error) {
      toast.error(`Extraction failed for ${manufacturer}`);
      console.error(error);
    }
    setExtracting(null);
  };

  const updateHex = async (id: string, hex: string) => {
    const { error } = await supabase
      .from("manufacturer_colors")
      .update({
        official_hex: hex,
        hex_source: "manual_verified",
        hex_confidence: 100,
        is_verified: true
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update hex");
    } else {
      toast.success("Hex updated and verified");
      setEditingHex(null);
      fetchColors();
    }
  };

  const approveColor = async (id: string) => {
    const { error } = await supabase
      .from("manufacturer_colors")
      .update({
        hex_confidence: 100,
        is_verified: true
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to approve");
    } else {
      toast.success("Color approved");
      fetchColors();
    }
  };

  const filteredColors = selectedManufacturer === "all"
    ? colors
    : colors.filter(c => c.manufacturer === selectedManufacturer);

  const stats = {
    total: colors.length,
    verified: colors.filter(c => c.is_verified).length,
    extracted: colors.filter(c => c.hex_source === "poster_extracted").length,
    aiGuessed: colors.filter(c => c.hex_source === "ai_guessed" || !c.hex_source).length,
    withSwatch: colors.filter(c => c.official_swatch_url).length
  };

  const manufacturers = [...new Set(colors.map(c => c.manufacturer))];

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Color Audit Dashboard</h1>
            <p className="text-muted-foreground">Review and verify manufacturer color data</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchColors} variant="outline" disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={importColors} disabled={importing}>
              <Database className="h-4 w-4 mr-2" />
              {importing ? "Importing..." : "Import Registry"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Total Colors</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.verified}</div>
              <div className="text-sm text-muted-foreground">Verified</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-600">{stats.extracted}</div>
              <div className="text-sm text-muted-foreground">Poster Extracted</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.aiGuessed}</div>
              <div className="text-sm text-muted-foreground">AI Guessed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-purple-600">{stats.withSwatch}</div>
              <div className="text-sm text-muted-foreground">With Swatch Image</div>
            </CardContent>
          </Card>
        </div>

        {/* Manufacturer Actions */}
        <div className="flex flex-wrap gap-4 mb-8">
          <Button
            variant={selectedManufacturer === "all" ? "default" : "outline"}
            onClick={() => setSelectedManufacturer("all")}
          >
            All ({colors.length})
          </Button>
          {manufacturers.map(m => (
            <div key={m} className="flex items-center gap-2">
              <Button
                variant={selectedManufacturer === m ? "default" : "outline"}
                onClick={() => setSelectedManufacturer(m)}
              >
                {m} ({colors.filter(c => c.manufacturer === m).length})
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => extractSwatches(m)}
                disabled={!!extracting}
              >
                <Palette className="h-4 w-4 mr-1" />
                {extracting === m ? "Extracting..." : "Extract"}
              </Button>
            </div>
          ))}
        </div>

        {/* Color Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredColors.map(color => (
            <Card key={color.id} className="overflow-hidden">
              <div className="flex">
                {/* Hex Block */}
                <div
                  className="w-20 h-20 flex-shrink-0 border-r"
                  style={{ backgroundColor: color.official_hex }}
                />
                {/* Swatch Image */}
                <div className="w-20 h-20 flex-shrink-0 bg-muted flex items-center justify-center">
                  {color.official_swatch_url ? (
                    <img
                      src={color.official_swatch_url}
                      alt={color.official_name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "";
                        (e.target as HTMLImageElement).className = "hidden";
                      }}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">No swatch</span>
                  )}
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">{color.official_name}</div>
                    <div className="text-xs text-muted-foreground">{color.product_code}</div>
                  </div>
                  {color.is_verified ? (
                    <Badge variant="default" className="bg-green-600">
                      <Check className="h-3 w-3 mr-1" />
                      Verified
                    </Badge>
                  ) : color.hex_source === "poster_extracted" ? (
                    <Badge variant="secondary">Extracted</Badge>
                  ) : (
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Guessed
                    </Badge>
                  )}
                </div>

                {editingHex?.id === color.id ? (
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={editingHex.hex}
                      onChange={(e) => setEditingHex({ id: color.id, hex: e.target.value })}
                      placeholder="#000000"
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => updateHex(color.id, editingHex.hex)}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {color.official_hex}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setEditingHex({ id: color.id, hex: color.official_hex })}
                    >
                      Edit
                    </Button>
                    {!color.is_verified && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-green-600"
                        onClick={() => approveColor(color.id)}
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                )}

                <div className="text-xs text-muted-foreground mt-2">
                  {color.manufacturer} • {color.finish}
                  {color.hex_confidence !== null && (
                    <span className="ml-2">• {color.hex_confidence}% confidence</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

    </div>
  );
}
