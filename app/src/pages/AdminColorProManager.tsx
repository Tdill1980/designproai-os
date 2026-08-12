import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Sparkles, Loader2 } from "lucide-react";

export default function AdminColorProManager() {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLibrary, setCurrentLibrary] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  const generateSwatches = async (colorLibrary: '3m_2080' | 'avery_sw900', batchSize = 10) => {
    setGenerating(true);
    setCurrentLibrary(colorLibrary);
    setProgress(0);
    setResults(null);

    try {
      // Get total count of colors needing generation
      const { count } = await supabase
        .from('inkfusion_swatches')
        .select('*', { count: 'exact', head: true })
        .eq('color_library', colorLibrary)
        .like('media_url', 'https://placeholder%');

      const totalColors = count || 0;
      
      if (totalColors === 0) {
        toast.success(`All ${colorLibrary === '3m_2080' ? '3M 2080' : 'Avery SW900'} swatches already generated!`);
        setGenerating(false);
        return;
      }

      toast.info(`Generating ${totalColors} ${colorLibrary === '3m_2080' ? '3M 2080' : 'Avery SW900'} swatches...`);

      let totalGenerated = 0;
      let totalFailed = 0;
      const allResults: any[] = [];
      const allErrors: any[] = [];

      // Process in batches
      while (totalGenerated + totalFailed < totalColors) {
        console.log(`Processing batch: ${totalGenerated + totalFailed}/${totalColors}`);
        
        const { data, error } = await renderClient.functions.invoke('batch-generate-swatches', {
          body: { 
            colorLibrary,
            limit: batchSize,
          }
        });

        if (error) {
          console.error('Batch generation error:', error);
          throw error;
        }

        if (data) {
          totalGenerated += data.generated || 0;
          totalFailed += data.failed || 0;
          allResults.push(...(data.results || []));
          allErrors.push(...(data.errors || []));

          const progressPercent = Math.round(((totalGenerated + totalFailed) / totalColors) * 100);
          setProgress(progressPercent);

          console.log(`Batch complete: ${data.generated} generated, ${data.failed} failed`);

          // If no more colors to process, break
          if (data.generated === 0 && data.failed === 0) {
            break;
          }
        }

        // Small delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      setResults({
        generated: totalGenerated,
        failed: totalFailed,
        results: allResults,
        errors: allErrors,
      });

      if (totalFailed > 0) {
        toast.warning(`Generated ${totalGenerated} swatches, ${totalFailed} failed`);
      } else {
        toast.success(`Successfully generated all ${totalGenerated} swatches!`);
      }

    } catch (error: any) {
      console.error('Error generating swatches:', error);
      toast.error(error.message || 'Failed to generate swatches');
    } finally {
      setGenerating(false);
      setCurrentLibrary(null);
      setProgress(0);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-4xl font-bold mb-2">ColorPro™ Swatch Generator</h1>
            <p className="text-muted-foreground">
              AI-generate realistic vinyl wrap swatches for all color libraries
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* 3M 2080 Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  3M 2080 Series
                </CardTitle>
                <CardDescription>
                  Generate swatches for all 3M 2080 colors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => generateSwatches('3m_2080', 5)}
                  disabled={generating}
                  className="w-full"
                  size="lg"
                >
                  {generating && currentLibrary === '3m_2080' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate 3M Swatches
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Avery SW900 Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Avery SW900
                </CardTitle>
                <CardDescription>
                  Generate swatches for all Avery SW900 colors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => generateSwatches('avery_sw900', 5)}
                  disabled={generating}
                  className="w-full"
                  size="lg"
                >
                  {generating && currentLibrary === 'avery_sw900' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Avery Swatches
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Progress */}
          {generating && (
            <Card>
              <CardHeader>
                <CardTitle>Generation Progress</CardTitle>
                <CardDescription>
                  Generating {currentLibrary === '3m_2080' ? '3M 2080' : 'Avery SW900'} swatches...
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progress} className="w-full" />
                <p className="text-center text-sm text-muted-foreground">
                  {progress}% complete
                </p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {results && (
            <Card>
              <CardHeader>
                <CardTitle>Generation Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">{results.generated}</div>
                    <div className="text-sm text-muted-foreground">Generated</div>
                  </div>
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">{results.failed}</div>
                    <div className="text-sm text-muted-foreground">Failed</div>
                  </div>
                </div>

                {results.errors && results.errors.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Errors:</h4>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {results.errors.map((err: any, idx: number) => (
                        <div key={idx} className="p-2 bg-red-500/10 border border-red-500/20 rounded text-sm">
                          <div className="font-medium">{err.name}</div>
                          <div className="text-xs text-muted-foreground">{err.error}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {results.results && results.results.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Successfully Generated:</h4>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {results.results.map((res: any, idx: number) => (
                        <div key={idx} className="text-sm text-muted-foreground">
                          ✓ {res.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardHeader>
              <CardTitle className="text-orange-600">⚠️ Important Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>• Generation processes colors in small batches (5 at a time) to avoid rate limits</p>
              <p>• Each swatch takes ~5-10 seconds to generate with OpenAI's gpt-image-1</p>
              <p>• The process may take 10-30 minutes for large libraries</p>
              <p>• Do not close this page while generation is in progress</p>
              <p>• Failed swatches can be regenerated individually later</p>
            </CardContent>
          </Card>
        </div>
      </main>

    </div>
  );
}
