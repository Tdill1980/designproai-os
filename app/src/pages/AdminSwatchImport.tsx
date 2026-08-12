import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Upload, FileImage, Grid3X3, FileArchive } from 'lucide-react';
import { PosterGridCropper } from '@/components/admin/PosterGridCropper';
import { CroppedCellsOCR } from '@/components/admin/CroppedCellsOCR';
import { BulkSwatchUploader } from '@/components/admin/BulkSwatchUploader';

interface CroppedCell {
  row: number;
  col: number;
  dataUrl: string;
  productCode?: string;
  colorName?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
}

interface PosterState {
  imageUrl: string | null;
  cells: CroppedCell[];
}

export default function AdminSwatchImport() {
  const [activeTab, setActiveTab] = useState<string>('bulk');
  const [activeManufacturer, setActiveManufacturer] = useState<string>('3m');
  const [posters, setPosters] = useState<Record<string, PosterState>>({
    '3m': { imageUrl: null, cells: [] },
    'avery': { imageUrl: null, cells: [] },
  });

  // Handle poster image upload
  const handlePosterUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, manufacturer: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create object URL for preview
    const imageUrl = URL.createObjectURL(file);
    
    setPosters(prev => ({
      ...prev,
      [manufacturer]: { imageUrl, cells: [] },
    }));

    toast.success(`${manufacturer.toUpperCase()} poster loaded. Draw a rectangle around one swatch to calibrate the grid.`);
  }, []);

  // Handle cells cropped from grid
  const handleCellsCropped = useCallback((manufacturer: string, cells: CroppedCell[]) => {
    setPosters(prev => ({
      ...prev,
      [manufacturer]: { ...prev[manufacturer], cells },
    }));
  }, []);

  // Handle cells updated (after OCR or manual edit)
  const handleCellsUpdated = useCallback((manufacturer: string, cells: CroppedCell[]) => {
    setPosters(prev => ({
      ...prev,
      [manufacturer]: { ...prev[manufacturer], cells },
    }));
  }, []);

  // Reset poster
  const handleReset = useCallback((manufacturer: string) => {
    setPosters(prev => ({
      ...prev,
      [manufacturer]: { imageUrl: null, cells: [] },
    }));
  }, []);

  const currentPoster = posters[activeManufacturer];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5" />
              Swatch Import Tool
            </CardTitle>
            <CardDescription>
              Bulk upload pre-cropped swatches from a ZIP, or extract from poster images.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="bulk" className="flex items-center gap-2">
                  <FileArchive className="h-4 w-4" />
                  Bulk ZIP Upload
                </TabsTrigger>
                <TabsTrigger value="poster" className="flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4" />
                  Poster Grid Extraction
                </TabsTrigger>
              </TabsList>

              <TabsContent value="bulk">
                <BulkSwatchUploader />
              </TabsContent>

              <TabsContent value="poster">
                <Tabs value={activeManufacturer} onValueChange={setActiveManufacturer}>
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="3m">3M 2080 Series</TabsTrigger>
                    <TabsTrigger value="avery">Avery Dennison</TabsTrigger>
                  </TabsList>

              <TabsContent value="3m" className="space-y-4">
                {!currentPoster.imageUrl ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <FileImage className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <Label htmlFor="3m-poster" className="cursor-pointer">
                      <span className="text-lg font-medium">Upload 3M 2080 Poster</span>
                      <p className="text-sm text-muted-foreground mt-1">
                        Upload a screenshot of the official 3M poster (PNG or JPG)
                      </p>
                    </Label>
                    <Input
                      id="3m-poster"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePosterUpload(e, '3m')}
                    />
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => document.getElementById('3m-poster')?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Select Poster Image
                    </Button>
                  </div>
                ) : currentPoster.cells.length === 0 ? (
                  <PosterGridCropper
                    imageUrl={currentPoster.imageUrl}
                    manufacturer="3m"
                    onCellsCropped={(cells) => handleCellsCropped('3m', cells)}
                    onReset={() => handleReset('3m')}
                  />
                ) : (
                  <CroppedCellsOCR
                    cells={currentPoster.cells}
                    manufacturer="3m"
                    onCellsUpdated={(cells) => handleCellsUpdated('3m', cells)}
                  />
                )}
              </TabsContent>

              <TabsContent value="avery" className="space-y-4">
                {!posters.avery.imageUrl ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <FileImage className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <Label htmlFor="avery-poster" className="cursor-pointer">
                      <span className="text-lg font-medium">Upload Avery Dennison Poster</span>
                      <p className="text-sm text-muted-foreground mt-1">
                        Upload a screenshot of the official Avery poster (PNG or JPG)
                      </p>
                    </Label>
                    <Input
                      id="avery-poster"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePosterUpload(e, 'avery')}
                    />
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => document.getElementById('avery-poster')?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Select Poster Image
                    </Button>
                  </div>
                ) : posters.avery.cells.length === 0 ? (
                  <PosterGridCropper
                    imageUrl={posters.avery.imageUrl}
                    manufacturer="avery"
                    onCellsCropped={(cells) => handleCellsCropped('avery', cells)}
                    onReset={() => handleReset('avery')}
                  />
                ) : (
                  <CroppedCellsOCR
                    cells={posters.avery.cells}
                    manufacturer="avery"
                    onCellsUpdated={(cells) => handleCellsUpdated('avery', cells)}
                  />
                )}
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Instructions */}
      {activeTab === 'poster' && !currentPoster.imageUrl && (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground space-y-4">
                <h3 className="text-lg font-medium">How This Works</h3>
                <ol className="text-left max-w-lg mx-auto space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">1.</span>
                    Upload the official manufacturer poster image (PNG/JPG screenshot of the PDF)
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">2.</span>
                    Click "Draw Cell" and draw a rectangle around ONE swatch to calibrate the grid size
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">3.</span>
                    Adjust sliders if needed, then click "Show Grid" to verify alignment
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">4.</span>
                    Click "Crop All Cells" to extract each swatch as a separate image
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">5.</span>
                    Run OCR to read product codes, or manually edit any that fail
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-foreground">6.</span>
                    Save to database - uploads images to storage and updates manufacturer_colors
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
