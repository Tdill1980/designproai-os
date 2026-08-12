import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";

interface VinylSwatch {
  id: string;
  name: string;
  manufacturer: string;
  hex: string;
  media_url: string | null;
  lab: any;
  reflectivity: number | null;
  metallic_flake: number | null;
  finish_profile: any;
  material_validated: boolean | null;
  ai_confidence: number | null;
  reference_image_count: number | null;
  finish: string;
}

export default function AdminSwatchQA() {
  const [swatches, setSwatches] = useState<VinylSwatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [runningBulkUpdate, setRunningBulkUpdate] = useState(false);

  useEffect(() => {
    loadSwatches();
  }, []);

  async function loadSwatches() {
    setLoading(true);
    const { data, error } = await supabase
      .from("vinyl_swatches")
      .select("*")
      .order("manufacturer")
      .order("name");

    if (error) {
      toast.error("Failed to load swatches");
      console.error(error);
    } else {
      setSwatches(data || []);
    }
    setLoading(false);
  }

  async function reprocessSwatch(swatch: VinylSwatch) {
    setReprocessingId(swatch.id);
    try {
      const { error } = await supabase.functions.invoke("ingest-all-wrap-swatch-colors", {
        body: {
          manufacturer: swatch.manufacturer,
          limit: 1,
          skipValidated: false,
          onlyMissingMaterial: false,
          onlyMissingMedia: false
        }
      });

      if (error) throw error;
      toast.success(`Reprocessed ${swatch.manufacturer} ${swatch.name}`);
      await loadSwatches();
    } catch (e: any) {
      toast.error(`Failed to reprocess: ${e.message}`);
    } finally {
      setReprocessingId(null);
    }
  }

  async function runIncrementalUpdate() {
    setRunningBulkUpdate(true);
    try {
      const { error } = await supabase.functions.invoke("update-wrap-swatch-colors");
      if (error) throw error;
      toast.success("Incremental update started");
      await loadSwatches();
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setRunningBulkUpdate(false);
    }
  }

  const filtered = swatches.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.manufacturer.toLowerCase().includes(filter.toLowerCase())
  );

  const stats = {
    total: swatches.length,
    validated: swatches.filter(s => s.material_validated).length,
    missingMedia: swatches.filter(s => !s.media_url).length,
    missingLab: swatches.filter(s => !s.lab).length,
    lowConfidence: swatches.filter(s => s.ai_confidence !== null && s.ai_confidence < 0.75).length
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Swatch QA Dashboard | Admin</title>
      </Helmet>
      
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Swatch QA Dashboard</h1>
          <div className="flex gap-2">
            <Button onClick={loadSwatches} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button 
              onClick={runIncrementalUpdate} 
              disabled={runningBulkUpdate}
              size="sm"
            >
              {runningBulkUpdate ? "Running..." : "Run Incremental Update"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Total Swatches</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.validated}</div>
              <div className="text-sm text-muted-foreground">Validated</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">{stats.missingMedia}</div>
              <div className="text-sm text-muted-foreground">Missing Media</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-orange-600">{stats.missingLab}</div>
              <div className="text-sm text-muted-foreground">Missing LAB</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.lowConfidence}</div>
              <div className="text-sm text-muted-foreground">Low Confidence</div>
            </CardContent>
          </Card>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            className="pl-10"
            placeholder="Filter by color or manufacturer..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-center py-12">Loading swatches...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(swatch => (
              <Card key={swatch.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm font-medium">
                        {swatch.manufacturer}
                      </CardTitle>
                      <p className="text-lg font-semibold">{swatch.name}</p>
                    </div>
                    {swatch.material_validated ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Validated
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Incomplete
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video bg-muted rounded-md overflow-hidden mb-3">
                    {swatch.media_url ? (
                      <img
                        src={swatch.media_url}
                        alt={swatch.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div 
                        className="w-full h-full flex items-center justify-center"
                        style={{ backgroundColor: swatch.hex || '#ccc' }}
                      >
                        <span className="text-xs text-white/80">No image</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hex:</span>
                      <span className="font-mono">{swatch.hex}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Finish:</span>
                      <span>{swatch.finish}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">LAB:</span>
                      <span className="font-mono">
                        {swatch.lab ? `L:${swatch.lab.L?.toFixed(1)} a:${swatch.lab.a?.toFixed(1)} b:${swatch.lab.b?.toFixed(1)}` : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reflectivity:</span>
                      <span>{swatch.reflectivity?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Metallic:</span>
                      <span>{swatch.metallic_flake?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">References:</span>
                      <span>{swatch.reference_image_count ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Confidence:</span>
                      <span>{swatch.ai_confidence ? `${(swatch.ai_confidence * 100).toFixed(0)}%` : "-"}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => reprocessSwatch(swatch)}
                    disabled={reprocessingId === swatch.id}
                    size="sm"
                    className="w-full mt-3"
                    variant="outline"
                  >
                    {reprocessingId === swatch.id ? (
                      <>
                        <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                        Reprocessing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3 mr-2" />
                        Reprocess Swatch
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
