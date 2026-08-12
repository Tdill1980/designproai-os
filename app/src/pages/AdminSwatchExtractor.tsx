import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { CheckCircle2, XCircle, Loader2, Image as ImageIcon } from "lucide-react";

interface ExtractionResult {
  code: string;
  success: boolean;
  error?: string;
  mediaUrl?: string;
}

interface ExtractionResponse {
  processed: number;
  total: number;
  nextIndex: number;
  hasMore: boolean;
  results: ExtractionResult[];
}

export default function AdminSwatchExtractor() {
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentManufacturer, setCurrentManufacturer] = useState<string | null>(null);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [totalColors, setTotalColors] = useState(0);

  const extractSwatches = async (manufacturer: "3M" | "Avery") => {
    setExtracting(true);
    setCurrentManufacturer(manufacturer);
    setResults([]);
    setProgress(0);

    try {
      let currentIndex = 0;
      let hasMore = true;
      const allResults: ExtractionResult[] = [];

      while (hasMore) {
        const { data, error } = await renderClient.functions.invoke<ExtractionResponse>(
          "extract-official-swatches",
          {
            body: {
              manufacturer,
              batchSize: 5,
              startIndex: currentIndex,
            },
          }
        );

        if (error) throw error;
        if (!data) throw new Error("No data returned");

        setTotalColors(data.total);
        allResults.push(...data.results);
        setResults([...allResults]);
        setProgress((data.nextIndex / data.total) * 100);

        hasMore = data.hasMore;
        currentIndex = data.nextIndex;

        // Small delay between batches to avoid rate limiting
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      const successCount = allResults.filter((r) => r.success).length;
      const failCount = allResults.filter((r) => !r.success).length;

      if (failCount === 0) {
        toast.success(`✅ All ${successCount} ${manufacturer} swatches extracted successfully!`);
      } else {
        toast.warning(`Completed: ${successCount} success, ${failCount} failed`);
      }
    } catch (error) {
      console.error("Extraction error:", error);
      toast.error(`Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setExtracting(false);
      setCurrentManufacturer(null);
    }
  };

  const successResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground">Official Swatch Extractor</h1>
            <p className="text-muted-foreground mt-2">
              Generate AI-powered swatch images from official manufacturer color data
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-red-500" />
                  3M 2080 Series
                </CardTitle>
                <CardDescription>
                  Extract swatches for all 100+ official 3M Wrap Film 2080 colors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => extractSwatches("3M")}
                  disabled={extracting}
                  className="w-full"
                  variant="default"
                >
                  {extracting && currentManufacturer === "3M" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-4 w-4" />
                      Extract 3M Swatches
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-blue-500" />
                  Avery Dennison SW900
                </CardTitle>
                <CardDescription>
                  Extract swatches for all 80+ official Avery Supreme Wrapping Film colors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => extractSwatches("Avery")}
                  disabled={extracting}
                  className="w-full"
                  variant="default"
                >
                  {extracting && currentManufacturer === "Avery" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-4 w-4" />
                      Extract Avery Swatches
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {extracting && (
            <Card>
              <CardHeader>
                <CardTitle>Extraction Progress</CardTitle>
                <CardDescription>
                  Processing {currentManufacturer} colors ({results.length} / {totalColors})
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={progress} className="h-3" />
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  {Math.round(progress)}% complete
                </p>
              </CardContent>
            </Card>
          )}

          {results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Extraction Results</CardTitle>
                <CardDescription>
                  <Badge variant="default" className="mr-2">
                    {successResults.length} Success
                  </Badge>
                  {failedResults.length > 0 && (
                    <Badge variant="destructive">{failedResults.length} Failed</Badge>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {results.map((result, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-2 rounded-lg ${
                        result.success ? "bg-green-500/10" : "bg-red-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className="font-mono text-sm">{result.code}</span>
                      </div>
                      {result.success && result.mediaUrl && (
                        <a
                          href={result.mediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </a>
                      )}
                      {!result.success && result.error && (
                        <span className="text-xs text-red-500">{result.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>1. Uses official manufacturer color data (codes, names, hex values)</p>
              <p>2. Generates photorealistic vinyl swatch images using AI</p>
              <p>3. Uploads to Supabase storage as ground truth reference</p>
              <p>4. Updates vinyl_swatches table with media_url for AI rendering accuracy</p>
              <p className="text-yellow-500 font-medium mt-4">
                ⚠️ This process generates ~100+ images per manufacturer. Allow 10-15 minutes per library.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

    </div>
  );
}
