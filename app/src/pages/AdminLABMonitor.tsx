import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Beaker, AlertTriangle, CheckCircle, Image } from "lucide-react";

interface SwatchStats {
  total: number;
  completedLAB: number;
  missingLAB: number;
  missingMaterial: number;
  missingMedia: number;
  lowConfidence: number;
  progress: number;
}

interface VinylSwatch {
  id: string;
  name: string;
  manufacturer: string;
  hex: string;
  finish: string;
  media_url: string | null;
  lab: { L: number; a: number; b: number } | null;
  reflectivity: number | null;
  metallic_flake: number | null;
  material_validated: boolean | null;
  ai_confidence: number | null;
  reference_image_count: number | null;
}

export default function AdminLABMonitor() {
  const [stats, setStats] = useState<SwatchStats | null>(null);
  const [swatches, setSwatches] = useState<VinylSwatch[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const { data, error } = await supabase
      .from("vinyl_swatches")
      .select("id, name, manufacturer, hex, finish, media_url, lab, reflectivity, metallic_flake, material_validated, ai_confidence, reference_image_count")
      .order("manufacturer")
      .order("name");

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const all = (data || []) as VinylSwatch[];
    setSwatches(all);

    const total = all.length;
    const missingLAB = all.filter(s => !s.lab).length;
    const missingMaterial = all.filter(s => !s.material_validated).length;
    const missingMedia = all.filter(s => !s.media_url).length;
    const lowConfidence = all.filter(s => s.ai_confidence !== null && s.ai_confidence < 0.75).length;
    const completedLAB = total - missingLAB;

    setStats({
      total,
      completedLAB,
      missingLAB,
      missingMaterial,
      missingMedia,
      lowConfidence,
      progress: total > 0 ? (completedLAB / total) * 100 : 0,
    });

    setLoading(false);
  }

  async function reextractMaterial(swatch: VinylSwatch) {
    setExtracting(swatch.id);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-all-wrap-swatch-colors`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            manufacturer: swatch.manufacturer,
            limit: 1,
            skipValidated: false,
            onlyMissingMaterial: true,
          }),
        }
      );
      
      if (!response.ok) throw new Error("Failed to trigger extraction");
      
      toast({ title: "Extraction triggered", description: `Re-extracting ${swatch.name}` });
      setTimeout(loadData, 3000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setExtracting(null);
    }
  }

  async function runBulkExtraction() {
    toast({ title: "Bulk extraction started", description: "Processing all swatches with missing LAB..." });
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-wrap-swatch-colors`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      
      if (!response.ok) throw new Error("Failed to start bulk extraction");
      
      const result = await response.json();
      toast({ 
        title: "Bulk extraction complete", 
        description: `Success: ${result.success}, Failed: ${result.failed}` 
      });
      loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  const filtered = swatches.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.manufacturer.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <Helmet>
        <title>LAB Extraction Monitor | Admin</title>
      </Helmet>

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">LAB Extraction Monitor</h1>
            <p className="text-muted-foreground">Real-time material profile extraction progress</p>
          </div>
          <Button onClick={runBulkExtraction} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Run Bulk Extraction
          </Button>
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                  <p className="text-sm text-muted-foreground">Total Swatches</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{stats.completedLAB}</p>
                  <p className="text-sm text-muted-foreground">LAB Complete</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-orange-600">{stats.missingLAB}</p>
                  <p className="text-sm text-muted-foreground">Missing LAB</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-yellow-600">{stats.missingMaterial}</p>
                  <p className="text-sm text-muted-foreground">Missing Material</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{stats.missingMedia}</p>
                  <p className="text-sm text-muted-foreground">Missing Media</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{stats.lowConfidence}</p>
                  <p className="text-sm text-muted-foreground">Low Confidence</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Beaker className="h-5 w-5" />
                  LAB Extraction Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Progress value={stats.progress} className="h-4" />
                <p className="mt-2 text-sm text-muted-foreground text-center">
                  {stats.progress.toFixed(1)}% complete ({stats.completedLAB} of {stats.total})
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Input
          placeholder="Filter by color or manufacturer..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />

        {loading ? (
          <p className="text-muted-foreground">Loading swatches...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((swatch) => (
              <Card key={swatch.id} className="overflow-hidden">
                <div className="h-32 bg-muted flex items-center justify-center">
                  {swatch.media_url ? (
                    <img
                      src={swatch.media_url}
                      alt={swatch.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Image className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-foreground truncate">{swatch.name}</p>
                      <p className="text-xs text-muted-foreground">{swatch.manufacturer}</p>
                    </div>
                    {swatch.lab ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 shrink-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        LAB
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-orange-500/10 text-orange-600 shrink-0">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        No LAB
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>
                      <span className="font-medium">LAB:</span>{" "}
                      {swatch.lab
                        ? `L:${swatch.lab.L.toFixed(1)} a:${swatch.lab.a.toFixed(1)} b:${swatch.lab.b.toFixed(1)}`
                        : "-"}
                    </p>
                    <p>
                      <span className="font-medium">Reflectivity:</span> {swatch.reflectivity?.toFixed(2) ?? "-"}
                    </p>
                    <p>
                      <span className="font-medium">Metallic:</span> {swatch.metallic_flake?.toFixed(2) ?? "-"}
                    </p>
                    <p>
                      <span className="font-medium">Refs:</span> {swatch.reference_image_count ?? 0}
                    </p>
                    <p>
                      <span className="font-medium">Confidence:</span>{" "}
                      {swatch.ai_confidence ? `${(swatch.ai_confidence * 100).toFixed(0)}%` : "-"}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2"
                    disabled={extracting === swatch.id}
                    onClick={() => reextractMaterial(swatch)}
                  >
                    {extracting === swatch.id ? "Extracting..." : "Re-extract Material"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
