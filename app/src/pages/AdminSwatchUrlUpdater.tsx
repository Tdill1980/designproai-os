import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Play, CheckCircle, XCircle, Image, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface BrandResult {
  brand: string;
  updated: number;
  skipped: number;
  errors: string[];
  status: 'pending' | 'running' | 'complete' | 'error';
}

const BRANDS = ['kpmf', 'teckwrap', 'vvivid', 'arlon'];

export default function AdminSwatchUrlUpdater() {
  const [brandResults, setBrandResults] = useState<Record<string, BrandResult>>({});
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [stats, setStats] = useState<{ total: number; withMedia: number; missingMedia: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    fetchStats();
    // Initialize brand results
    const initial: Record<string, BrandResult> = {};
    BRANDS.forEach(brand => {
      initial[brand] = { brand, updated: 0, skipped: 0, errors: [], status: 'pending' };
    });
    setBrandResults(initial);
  }, []);

  async function fetchStats() {
    const { data, error } = await supabase
      .from('vinyl_swatches')
      .select('id, media_url, manufacturer');

    if (error) {
      console.error('Error fetching stats:', error);
      return;
    }

    const total = data?.length || 0;
    const withMedia = data?.filter(s => s.media_url && s.media_url.trim() !== '').length || 0;

    setStats({
      total,
      withMedia,
      missingMedia: total - withMedia
    });
  }

  async function runForBrand(brand: string) {
    setBrandResults(prev => ({
      ...prev,
      [brand]: { ...prev[brand], status: 'running' }
    }));
    setLogs(prev => [...prev, `Starting ${brand.toUpperCase()}...`]);

    try {
      const { data, error } = await supabase.functions.invoke('update-swatch-media-urls', {
        body: { brand }
      });

      if (error) {
        setBrandResults(prev => ({
          ...prev,
          [brand]: { ...prev[brand], status: 'error', errors: [error.message] }
        }));
        setLogs(prev => [...prev, `❌ ${brand.toUpperCase()}: ${error.message}`]);
        return;
      }

      setBrandResults(prev => ({
        ...prev,
        [brand]: {
          brand,
          updated: data?.updated || 0,
          skipped: data?.skipped || 0,
          errors: data?.errors || [],
          status: 'complete'
        }
      }));
      setLogs(prev => [...prev, `✅ ${brand.toUpperCase()}: ${data?.updated || 0} updated, ${data?.skipped || 0} skipped`]);
    } catch (err) {
      setBrandResults(prev => ({
        ...prev,
        [brand]: { ...prev[brand], status: 'error', errors: [String(err)] }
      }));
      setLogs(prev => [...prev, `❌ ${brand.toUpperCase()}: ${err}`]);
    }
  }

  async function runAllBrands() {
    setIsRunningAll(true);
    setLogs(['Starting batch update for all brands...']);

    for (const brand of BRANDS) {
      await runForBrand(brand);
    }

    setIsRunningAll(false);
    setLogs(prev => [...prev, '🎉 All brands complete!']);
    toast.success('Swatch URL update complete!');
    fetchStats();
  }

  const totalUpdated = Object.values(brandResults).reduce((sum, r) => sum + r.updated, 0);
  const totalSkipped = Object.values(brandResults).reduce((sum, r) => sum + r.skipped, 0);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Swatch URL Updater | Admin</title>
      </Helmet>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <Image className="inline-block mr-3 h-8 w-8" />
            Swatch URL Updater
          </h1>
          <p className="text-muted-foreground">
            Scrape real swatch image URLs from manufacturer websites and update vinyl_swatches table
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Statistics Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Database Statistics
              </CardTitle>
              <CardDescription>Current media_url status in vinyl_swatches</CardDescription>
            </CardHeader>
            <CardContent>
              {stats ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Total Swatches</span>
                    <Badge variant="secondary">{stats.total}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>With Media URL</span>
                    <Badge className="bg-green-600">{stats.withMedia}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Missing Media URL</span>
                    <Badge variant="destructive">{stats.missingMedia}</Badge>
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

          {/* Run All Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Update All Brands
              </CardTitle>
              <CardDescription>
                Scrape and update swatch URLs for all supported manufacturers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={runAllBrands} 
                disabled={isRunningAll}
                className="w-full mb-4"
                size="lg"
              >
                {isRunningAll ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    Update All Brands
                  </>
                )}
              </Button>

              {totalUpdated > 0 || totalSkipped > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-500">{totalUpdated}</div>
                    <div className="text-xs text-muted-foreground">Total Updated</div>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-yellow-500">{totalSkipped}</div>
                    <div className="text-xs text-muted-foreground">Total Skipped</div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Per-Brand Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {BRANDS.map(brand => {
            const result = brandResults[brand];
            return (
              <Card key={brand} className="relative">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg uppercase">{brand}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {result?.status === 'complete' && (
                      <>
                        <div className="flex items-center text-green-500 text-sm">
                          <CheckCircle className="h-4 w-4 mr-1" />
                          {result.updated} updated
                        </div>
                        <div className="text-muted-foreground text-sm">
                          {result.skipped} skipped
                        </div>
                      </>
                    )}
                    {result?.status === 'error' && (
                      <div className="flex items-center text-red-500 text-sm">
                        <XCircle className="h-4 w-4 mr-1" />
                        Error
                      </div>
                    )}
                    {result?.status === 'running' && (
                      <div className="flex items-center text-blue-500 text-sm">
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Running...
                      </div>
                    )}
                    {result?.status === 'pending' && (
                      <div className="text-muted-foreground text-sm">Pending</div>
                    )}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full mt-3"
                    onClick={() => runForBrand(brand)}
                    disabled={result?.status === 'running' || isRunningAll}
                  >
                    {result?.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Run'
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Activity Log */}
        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
            <CardDescription>Real-time update progress</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px] border rounded-md p-3 bg-muted/50">
              {logs.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                  No activity yet. Click "Update All Brands" to start.
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
      </main>
    </div>
  );
}
