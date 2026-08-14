import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Loader2, Wand2 } from "lucide-react";

export default function Admin3MSwatchGenerator() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setResults([]);

    try {
      toast({
        title: "Starting swatch generation",
        description: "This may take several minutes...",
      });

      const { data, error } = await renderClient.functions.invoke('generate-3m-swatches');

      if (error) throw error;

      setResults(data.results || []);

      toast({
        title: "Generation complete",
        description: `Processed ${data.processed} of ${data.total} swatches`,
      });

    } catch (error: any) {
      console.error('Generation error:', error);
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">3M Swatch Generator</h1>
            <p className="text-muted-foreground">
              Generate AI-powered swatch images for all 3M 2080 colors
            </p>
          </div>

          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold mb-1">Batch Generate Swatches</h3>
                  <p className="text-sm text-muted-foreground">
                    Creates professional swatch images for all 3M colors missing images
                  </p>
                </div>
                
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  size="lg"
                  className="gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" />
                      Generate All Swatches
                    </>
                  )}
                </Button>
              </div>

              {results.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="font-semibold">Results:</h4>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {results.map((result, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border ${
                          result.status === 'success'
                            ? 'bg-green-500/10 border-green-500/20'
                            : 'bg-red-500/10 border-red-500/20'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{result.name}</span>
                          <span className={`text-sm ${
                            result.status === 'success' ? 'text-green-500' : 'text-red-500'
                          }`}>
                            {result.status}
                          </span>
                        </div>
                        {result.url && (
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline"
                          >
                            View swatch
                          </a>
                        )}
                        {result.error && (
                          <p className="text-xs text-red-500 mt-1">{result.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>

    </div>
  );
}
