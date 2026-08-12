import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import JSZip from 'jszip';
import { 
  Loader2, Upload, Check, X, FileArchive, 
  CheckCircle2, AlertTriangle, FolderOpen 
} from 'lucide-react';

interface SwatchFile {
  manufacturer: string;
  productCode: string;
  fileName: string;
  blob: Blob;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function BulkSwatchUploader() {
  const [files, setFiles] = useState<SwatchFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Parse ZIP file and extract swatch images
  const handleZipUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setFiles([]);

    try {
      const zip = await JSZip.loadAsync(file);
      const swatchFiles: SwatchFile[] = [];

      // Iterate through all files in the zip
      for (const [path, zipEntry] of Object.entries(zip.files)) {
        // Skip directories
        if (zipEntry.dir) continue;
        
        // Skip non-image files
        if (!path.toLowerCase().endsWith('.png') && !path.toLowerCase().endsWith('.jpg') && !path.toLowerCase().endsWith('.jpeg')) {
          continue;
        }

        // Parse path: expect format like "3m/2080-G103.png" or "avery/SW900-771-O.png"
        const parts = path.split('/').filter(p => p.length > 0);
        
        let manufacturer: string;
        let fileName: string;
        
        if (parts.length >= 2) {
          // Has folder structure
          manufacturer = parts[parts.length - 2].toLowerCase();
          fileName = parts[parts.length - 1];
        } else if (parts.length === 1) {
          // Flat structure - try to detect manufacturer from filename
          fileName = parts[0];
          if (fileName.startsWith('2080-') || fileName.startsWith('1080-')) {
            manufacturer = '3m';
          } else if (fileName.startsWith('SW900-') || fileName.startsWith('SW')) {
            manufacturer = 'avery';
          } else {
            manufacturer = 'unknown';
          }
        } else {
          continue;
        }

        // Extract product code from filename
        const productCode = fileName.replace(/\.(png|jpg|jpeg)$/i, '');
        
        // Get blob content
        const blob = await zipEntry.async('blob');

        swatchFiles.push({
          manufacturer,
          productCode,
          fileName,
          blob,
          status: 'pending',
        });
      }

      // Sort by manufacturer then product code
      swatchFiles.sort((a, b) => {
        if (a.manufacturer !== b.manufacturer) {
          return a.manufacturer.localeCompare(b.manufacturer);
        }
        return a.productCode.localeCompare(b.productCode);
      });

      setFiles(swatchFiles);
      toast.success(`Found ${swatchFiles.length} swatch images in ZIP`);
    } catch (err) {
      console.error('Failed to parse ZIP:', err);
      toast.error('Failed to parse ZIP file');
    } finally {
      setLoading(false);
    }
  }, []);

  // Upload all files to Supabase Storage and update database
  const uploadAll = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);

    const updatedFiles = [...files];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      updatedFiles[i] = { ...file, status: 'uploading' };
      setFiles([...updatedFiles]);

      try {
        // Determine storage path
        const storagePath = `official/${file.manufacturer}/${file.productCode}.png`;
        
        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('swatches')
          .upload(storagePath, file.blob, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('swatches')
          .getPublicUrl(storagePath);

        // Map manufacturer key to database name
        const dbManufacturer = file.manufacturer === '3m' ? '3M' : 
                               file.manufacturer === 'avery' ? 'Avery Dennison' : 
                               file.manufacturer;

        // Update manufacturer_colors table
        const { error: dbError } = await supabase
          .from('manufacturer_colors')
          .update({
            official_swatch_url: urlData.publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('product_code', file.productCode)
          .eq('manufacturer', dbManufacturer);

        if (dbError) {
          console.warn(`DB update for ${file.productCode}:`, dbError.message);
          // Still mark as done if storage upload succeeded
        }

        updatedFiles[i] = { ...file, status: 'done' };
        successCount++;
      } catch (err: any) {
        console.error(`Failed to upload ${file.productCode}:`, err);
        updatedFiles[i] = { ...file, status: 'error', error: err.message };
        errorCount++;
      }

      setFiles([...updatedFiles]);
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setUploading(false);
    toast.success(`Upload complete: ${successCount} succeeded, ${errorCount} failed`);
  }, [files]);

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const doneCount = files.filter(f => f.status === 'done').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  // Group files by manufacturer for display
  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.manufacturer]) {
      acc[file.manufacturer] = [];
    }
    acc[file.manufacturer].push(file);
    return acc;
  }, {} as Record<string, SwatchFile[]>);

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      {files.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileArchive className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <Label htmlFor="zip-upload" className="cursor-pointer">
                <span className="text-xl font-medium">Upload Swatches ZIP</span>
                <p className="text-sm text-muted-foreground mt-2">
                  Expected structure: /3m/2080-G103.png, /avery/SW900-771-O.png
                </p>
              </Label>
              <Input
                id="zip-upload"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleZipUpload}
                disabled={loading}
              />
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => document.getElementById('zip-upload')?.click()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Extracting ZIP...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Select ZIP File
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary & Actions */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  {files.length} Swatches Ready
                </CardTitle>
                <CardDescription>
                  {pendingCount} pending • {doneCount} uploaded • {errorCount} errors
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFiles([]);
                    setProgress(0);
                  }}
                  disabled={uploading}
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear
                </Button>
                <Button 
                  onClick={uploadAll} 
                  disabled={uploading || pendingCount === 0}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading {progress}%
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload All ({pendingCount})
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            
            {uploading && (
              <div className="px-6 pb-4">
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </Card>

          {/* File List by Manufacturer */}
          {Object.entries(groupedFiles).map(([manufacturer, manufacturerFiles]) => (
            <Card key={manufacturer}>
              <CardHeader className="py-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  {manufacturer.toUpperCase()}
                  <Badge variant="secondary">{manufacturerFiles.length} files</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    {manufacturerFiles.map((file, index) => (
                      <div
                        key={`${file.manufacturer}-${file.productCode}`}
                        className={`relative border rounded overflow-hidden text-center p-2 ${
                          file.status === 'done' ? 'border-emerald-500 bg-emerald-500/10' :
                          file.status === 'error' ? 'border-destructive bg-destructive/10' :
                          file.status === 'uploading' ? 'border-primary bg-primary/10' :
                          'border-border'
                        }`}
                      >
                        {/* Preview (create object URL) */}
                        <img 
                          src={URL.createObjectURL(file.blob)} 
                          alt={file.productCode}
                          className="w-full aspect-square object-cover rounded mb-1"
                        />
                        
                        <p className="text-xs font-mono truncate" title={file.productCode}>
                          {file.productCode}
                        </p>

                        {/* Status indicator */}
                        {file.status === 'uploading' && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          </div>
                        )}
                        {file.status === 'done' && (
                          <div className="absolute top-1 right-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          </div>
                        )}
                        {file.status === 'error' && (
                          <div className="absolute top-1 right-1" title={file.error}>
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
