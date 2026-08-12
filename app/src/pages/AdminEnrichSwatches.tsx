import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Play, CheckCircle, XCircle, AlertCircle, Palette, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface EnrichmentResult {
  processed: number;
  updated: number;
  notFound: number;
  errors: number;
}

interface SwatchStats {
  total: number;
  withHex: number;
  missingHex: number;
  withImage: number;
}

export default function AdminEnrichSwatches() {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<SwatchStats | null>(null);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [testColor, setTestColor] = useState({ manufacturer: '', name: '' });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTestingColor, setIsTestingColor] = useState(false);

  // Fetch swatch statistics
  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    const { data: allSwatches, error } = await supabase
      .from('vinyl_swatches')
      .select('id, hex, media_url');

    if (error) {
      console.error('Error fetching stats:', error);
      return;
    }

    const total = allSwatches?.length || 0;
    const withHex = allSwatches?.filter(s => s.hex && s.hex.trim() !== '').length || 0;
    const withImage = allSwatches?.filter(s => s.media_url).length || 0;

    setStats({
      total,
      withHex,
      missingHex: total - withHex,
      withImage
    });
  }

  async function runEnrichment() {
    setIsRunning(true);
    setResult(null);
    setLogs(['Starting color enrichment...']);

    try {
      const { data, error } = await renderClient.functions.invoke('enrich-vinyl-colors');

      if (error) {
        setLogs(prev => [...prev, `Error: ${error.message}`]);
        toast.error('Enrichment failed');
        return;
      }

      setResult(data?.results);
      setLogs(prev => [
        ...prev,
        `Processed: ${data?.results?.processed || 0}`,
        `Updated: ${data?.results?.updated || 0}`,
        `Not Found: ${data?.results?.notFound || 0}`,
        `Errors: ${data?.results?.errors || 0}`,
        'Enrichment complete!'
      ]);
      toast.success('Color enrichment complete!');
      fetchStats(); // Refresh stats
    } catch (err) {
      setLogs(prev => [...prev, `Exception: ${err}`]);
      toast.error('Enrichment failed');
    } finally {
      setIsRunning(false);
    }
  }

  async function testSingleColor() {
    if (!testColor.manufacturer || !testColor.name) {
      toast.error('Enter manufacturer and color name');
      return;
    }

    setIsTestingColor(true);
    setTestResult(null);

    try {
      const { data, error } = await renderClient.functions.invoke('get-vinyl-hex', {
        body: { manufacturer: testColor.manufacturer, colorName: testColor.name }
      });

      if (error) {
        setTestResult(`Error: ${error.message}`);
      } else {
        setTestResult(data?.hex || 'NOT_FOUND');
      }
    } catch (err) {
      setTestResult(`Exception: ${err}`);
    } finally {
      setIsTestingColor(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Swatch Enrichment | Admin</title>
      </Helmet>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <Palette className="inline-block mr-3 h-8 w-8" />
            Swatch Color Enrichment
          </h1>
          <p className="text-muted-foreground">
            AI-powered system to fill missing hex colors with real manufacturer data
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Statistics Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Database Statistics
              </CardTitle>
              <CardDescription>Current state of vinyl_swatches table</CardDescription>
            </CardHeader>
            <CardContent>
              {stats ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Total Swatches</span>
                    <Badge variant="secondary">{stats.total}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>With Hex Color</span>
                    <Badge variant="default" className="bg-green-600">{stats.withHex}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Missing Hex</span>
                    <Badge variant="destructive">{stats.missingHex}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>With Image</span>
                    <Badge variant="outline">{stats.withImage}</Badge>
                  </div>
                  
                  <div className="pt-4">
                    <div className="text-sm text-muted-foreground mb-2">
                      Completion: {Math.round((stats.withHex / stats.total) * 100)}%
                    </div>
                    <Progress value={(stats.withHex / stats.total) * 100} />
                  </div>

                  <Button variant="outline" size="sm" onClick={fetchStats} className="w-full mt-4">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh Stats
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Run Enrichment Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Run Enrichment
              </CardTitle>
              <CardDescription>
                Fill all missing hex values using AI lookup
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Button 
                  onClick={runEnrichment} 
                  disabled={isRunning}
                  className="w-full"
                  size="lg"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Running Enrichment...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 mr-2" />
                      Start Batch Enrichment
                    </>
                  )}
                </Button>

                {result && (
                  <div className="grid grid-cols-2 gap-3 pt-4">
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-500">{result.updated}</div>
                      <div className="text-xs text-muted-foreground">Updated</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-yellow-500">{result.notFound}</div>
                      <div className="text-xs text-muted-foreground">Not Found</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-500">{result.processed}</div>
                      <div className="text-xs text-muted-foreground">Processed</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-500">{result.errors}</div>
                      <div className="text-xs text-muted-foreground">Errors</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Test Single Color */}
          <Card>
            <CardHeader>
              <CardTitle>Test Single Color</CardTitle>
              <CardDescription>Test AI hex lookup for a specific color</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Manufacturer (e.g., 3M, Avery)"
                  value={testColor.manufacturer}
                  onChange={(e) => setTestColor(prev => ({ ...prev, manufacturer: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <input
                  type="text"
                  placeholder="Color Name (e.g., Gloss Black)"
                  value={testColor.name}
                  onChange={(e) => setTestColor(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <Button onClick={testSingleColor} disabled={isTestingColor} className="w-full">
                  {isTestingColor ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    'Test Color Lookup'
                  )}
                </Button>

                {testResult && (
                  <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                    {testResult.startsWith('#') ? (
                      <>
                        <div 
                          className="w-12 h-12 rounded-lg border"
                          style={{ backgroundColor: testResult }}
                        />
                        <div>
                          <div className="font-mono text-lg">{testResult}</div>
                          <div className="text-sm text-green-500 flex items-center">
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Found
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-yellow-500 flex items-center">
                        <XCircle className="h-5 w-5 mr-2" />
                        {testResult}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>Real-time enrichment progress</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px] border rounded-md p-3 bg-muted/50">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground text-sm">
                    No activity yet. Start enrichment to see logs.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="text-sm font-mono">
                        <span className="text-muted-foreground">[{i + 1}]</span> {log}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
