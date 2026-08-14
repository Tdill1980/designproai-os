import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle, XCircle, Loader2, Beaker, Image as ImageIcon, Trash2 } from 'lucide-react';

interface VinylSwatch {
  id: string;
  manufacturer: string;
  name: string;
  code: string | null;
  hex: string;
  finish: string;
  media_url: string | null;
  material_validated: boolean;
  lab: any;
  reflectivity: number | null;
  metallic_flake: number | null;
  finish_profile: any;
}

interface ReferenceImage {
  id: string;
  image_url: string;
  score: number | null;
  is_verified: boolean;
  image_type: string | null;
}

export default function AdminSwatchValidation() {
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('');
  const [swatches, setSwatches] = useState<VinylSwatch[]>([]);
  const [selectedSwatch, setSelectedSwatch] = useState<VinylSwatch | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, validated: 0, needsReview: 0 });

  useEffect(() => {
    loadManufacturers();
  }, []);

  useEffect(() => {
    if (selectedManufacturer) {
      loadSwatches(selectedManufacturer);
    }
  }, [selectedManufacturer]);

  useEffect(() => {
    if (selectedSwatch) {
      loadReferenceImages(selectedSwatch.id);
    }
  }, [selectedSwatch]);

  const loadManufacturers = async () => {
    const { data, error } = await supabase
      .from('vinyl_swatches')
      .select('manufacturer')
      .eq('verified', true);

    if (error) {
      toast.error('Failed to load manufacturers');
      return;
    }

    const uniqueManufacturers = [...new Set(data.map(d => d.manufacturer))].sort();
    setManufacturers(uniqueManufacturers);
    
    if (uniqueManufacturers.length > 0) {
      setSelectedManufacturer(uniqueManufacturers[0]);
    }

    // Load stats
    const { count: total } = await supabase
      .from('vinyl_swatches')
      .select('*', { count: 'exact', head: true })
      .eq('verified', true);

    const { count: validated } = await supabase
      .from('vinyl_swatches')
      .select('*', { count: 'exact', head: true })
      .eq('verified', true)
      .eq('material_validated', true);

    setStats({
      total: total || 0,
      validated: validated || 0,
      needsReview: (total || 0) - (validated || 0)
    });

    setLoading(false);
  };

  const loadSwatches = async (manufacturer: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('vinyl_swatches')
      .select('id, manufacturer, name, code, hex, finish, media_url, material_validated, lab, reflectivity, metallic_flake, finish_profile')
      .eq('manufacturer', manufacturer)
      .eq('verified', true)
      .order('name');

    if (error) {
      toast.error('Failed to load swatches');
      setLoading(false);
      return;
    }

    setSwatches(data as VinylSwatch[]);
    setLoading(false);
  };

  const loadReferenceImages = async (swatchId: string) => {
    const { data, error } = await supabase
      .from('vinyl_reference_images')
      .select('id, image_url, score, is_verified, image_type')
      .eq('swatch_id', swatchId)
      .order('score', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('Failed to load reference images:', error);
      return;
    }

    setReferenceImages(data as ReferenceImage[]);
  };

  const handleValidateImages = async (swatch: VinylSwatch) => {
    setProcessing(`validate-${swatch.id}`);
    try {
      const { data, error } = await renderClient.functions.invoke('validate-swatch-images', {
        body: { swatch_id: swatch.id }
      });

      if (error) throw error;

      toast.success(`Validated ${data.images_scored} images. Best score: ${data.best_image?.score?.toFixed(2)}`);
      loadSwatches(selectedManufacturer);
      if (selectedSwatch?.id === swatch.id) {
        loadReferenceImages(swatch.id);
      }
    } catch (error) {
      toast.error('Failed to validate images');
      console.error(error);
    } finally {
      setProcessing(null);
    }
  };

  const handleExtractProfile = async (swatch: VinylSwatch) => {
    setProcessing(`extract-${swatch.id}`);
    try {
      const { data, error } = await renderClient.functions.invoke('extract-material-profile', {
        body: { swatch_id: swatch.id }
      });

      if (error) throw error;

      toast.success('Material profile extracted successfully');
      loadSwatches(selectedManufacturer);
      setSelectedSwatch(null);
      setTimeout(() => {
        const updated = swatches.find(s => s.id === swatch.id);
        if (updated) setSelectedSwatch({ ...updated, ...data.material_profile });
      }, 500);
    } catch (error) {
      toast.error('Failed to extract material profile');
      console.error(error);
    } finally {
      setProcessing(null);
    }
  };

  const handleSearchWeb = async (swatch: VinylSwatch) => {
    setProcessing(`search-${swatch.id}`);
    try {
      const { data, error } = await renderClient.functions.invoke('search-vinyl-product-images', {
        body: {
          manufacturer: swatch.manufacturer,
          colorName: swatch.name,
          productCode: swatch.code
        }
      });

      if (error) throw error;

      if (data.photos && data.photos.length > 0) {
        // Store the found images
        for (const photo of data.photos.slice(0, 5)) {
          await supabase.from('vinyl_reference_images').upsert({
            swatch_id: swatch.id,
            manufacturer: swatch.manufacturer,
            color_name: swatch.name,
            product_code: swatch.code,
            image_url: photo.url,
            source_url: photo.source,
            image_type: 'web_search',
            search_query: `${swatch.manufacturer} ${swatch.code || ''} ${swatch.name} vinyl wrap`
          }, { 
            onConflict: 'swatch_id,image_url',
            ignoreDuplicates: true 
          });
        }
        toast.success(`Found and stored ${data.photos.length} reference images`);
        loadReferenceImages(swatch.id);
      } else {
        toast.info('No images found');
      }
    } catch (error) {
      toast.error('Failed to search for images');
      console.error(error);
    } finally {
      setProcessing(null);
    }
  };

  const handleBulkValidate = async () => {
    setProcessing('bulk');
    try {
      const unvalidated = swatches.filter(s => !s.material_validated).slice(0, 10);
      
      for (const swatch of unvalidated) {
        toast.info(`Processing ${swatch.name}...`);
        
        // Search for images if none exist
        const { data: refs } = await supabase
          .from('vinyl_reference_images')
          .select('id')
          .eq('swatch_id', swatch.id)
          .limit(1);

        if (!refs || refs.length === 0) {
          await renderClient.functions.invoke('search-vinyl-product-images', {
            body: {
              manufacturer: swatch.manufacturer,
              colorName: swatch.name,
              productCode: swatch.code
            }
          });
        }

        // Validate images
        await renderClient.functions.invoke('validate-swatch-images', {
          body: { swatch_id: swatch.id }
        });

        // Extract profile
        await renderClient.functions.invoke('extract-material-profile', {
          body: { swatch_id: swatch.id }
        });
      }

      toast.success(`Processed ${unvalidated.length} swatches`);
      loadSwatches(selectedManufacturer);
      loadManufacturers();
    } catch (error) {
      toast.error('Bulk validation failed');
      console.error(error);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Swatch Validation Admin</h1>
          <p className="text-muted-foreground">
            Validate reference images and extract material profiles for accurate rendering
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Total Swatches</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.validated}</div>
              <div className="text-sm text-muted-foreground">Material Validated</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-amber-600">{stats.needsReview}</div>
              <div className="text-sm text-muted-foreground">Needs Review</div>
            </CardContent>
          </Card>
        </div>

        {/* Manufacturer Tabs */}
        <Tabs value={selectedManufacturer} onValueChange={setSelectedManufacturer}>
          <div className="flex items-center justify-between mb-4">
            <TabsList className="flex-wrap h-auto gap-1">
              {manufacturers.map(m => (
                <TabsTrigger key={m} value={m} className="text-xs">
                  {m}
                </TabsTrigger>
              ))}
            </TabsList>
            
            <Button 
              onClick={handleBulkValidate}
              disabled={processing === 'bulk'}
              variant="outline"
            >
              {processing === 'bulk' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Validate All (10 max)
            </Button>
          </div>

          {manufacturers.map(m => (
            <TabsContent key={m} value={m}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Swatch List */}
                <Card>
                  <CardHeader>
                    <CardTitle>{m} Swatches ({swatches.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="max-h-[600px] overflow-y-auto">
                    {loading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {swatches.map(swatch => (
                          <div
                            key={swatch.id}
                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                              selectedSwatch?.id === swatch.id 
                                ? 'border-primary bg-primary/5' 
                                : 'hover:bg-muted/50'
                            }`}
                            onClick={() => setSelectedSwatch(swatch)}
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded border flex-shrink-0"
                                style={{ backgroundColor: swatch.hex }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{swatch.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {swatch.code} • {swatch.finish} • {swatch.hex}
                                </div>
                              </div>
                              <div className="flex gap-1">
                                {swatch.material_validated ? (
                                  <Badge variant="default" className="bg-green-600">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Valid
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    Pending
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Swatch Detail */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {selectedSwatch ? selectedSwatch.name : 'Select a swatch'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSwatch ? (
                      <div className="space-y-6">
                        {/* Current Image */}
                        <div>
                          <h4 className="font-medium mb-2">Current Media</h4>
                          {selectedSwatch.media_url ? (
                            <img 
                              src={selectedSwatch.media_url} 
                              alt={selectedSwatch.name}
                              className="w-full h-40 object-cover rounded-lg border"
                            />
                          ) : (
                            <div className="w-full h-40 bg-muted rounded-lg flex items-center justify-center">
                              <span className="text-muted-foreground">No image</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSearchWeb(selectedSwatch)}
                            disabled={processing?.startsWith('search')}
                          >
                            {processing === `search-${selectedSwatch.id}` ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <ImageIcon className="h-4 w-4 mr-2" />
                            )}
                            Search Web
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleValidateImages(selectedSwatch)}
                            disabled={processing?.startsWith('validate')}
                          >
                            {processing === `validate-${selectedSwatch.id}` ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4 mr-2" />
                            )}
                            Validate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExtractProfile(selectedSwatch)}
                            disabled={processing?.startsWith('extract')}
                          >
                            {processing === `extract-${selectedSwatch.id}` ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Beaker className="h-4 w-4 mr-2" />
                            )}
                            Extract Profile
                          </Button>
                        </div>

                        {/* Material Profile */}
                        {selectedSwatch.material_validated && selectedSwatch.lab && (
                          <div>
                            <h4 className="font-medium mb-2">Material Profile</h4>
                            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                              <div>
                                <span className="text-muted-foreground">LAB:</span>{' '}
                                L={selectedSwatch.lab.L?.toFixed(1)}, 
                                a={selectedSwatch.lab.a?.toFixed(1)}, 
                                b={selectedSwatch.lab.b?.toFixed(1)}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Reflectivity:</span>{' '}
                                {selectedSwatch.reflectivity?.toFixed(2)}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Metallic Flake:</span>{' '}
                                {selectedSwatch.metallic_flake?.toFixed(2)}
                              </div>
                              {selectedSwatch.finish_profile && (
                                <div>
                                  <span className="text-muted-foreground">Texture:</span>{' '}
                                  {selectedSwatch.finish_profile.texture || 'smooth vinyl'}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Reference Images */}
                        <div>
                          <h4 className="font-medium mb-2">
                            Reference Images ({referenceImages.length})
                          </h4>
                          {referenceImages.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                              {referenceImages.map(ref => (
                                <div key={ref.id} className="relative group">
                                  <img
                                    src={ref.image_url}
                                    alt="Reference"
                                    className={`w-full h-24 object-cover rounded border ${
                                      ref.is_verified ? 'border-green-500 border-2' : ''
                                    }`}
                                  />
                                  <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                                    <Badge 
                                      variant={ref.is_verified ? 'default' : 'secondary'}
                                      className="text-xs"
                                    >
                                      {ref.score?.toFixed(2) || 'N/A'}
                                    </Badge>
                                    {ref.is_verified && (
                                      <Badge className="bg-green-600 text-xs">Best</Badge>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              No reference images. Click "Search Web" to find images.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        Select a swatch from the list to view details
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>

    </div>
  );
}
