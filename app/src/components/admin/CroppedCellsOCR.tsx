import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  Loader2, Check, X, Upload, Eye, Scan, 
  CheckCircle2, AlertTriangle, Edit2, Save 
} from 'lucide-react';

interface CroppedCell {
  row: number;
  col: number;
  dataUrl: string;
  productCode?: string;
  colorName?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
}

interface CroppedCellsOCRProps {
  cells: CroppedCell[];
  manufacturer: string;
  onCellsUpdated: (cells: CroppedCell[]) => void;
}

export function CroppedCellsOCR({ 
  cells, 
  manufacturer,
  onCellsUpdated 
}: CroppedCellsOCRProps) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [editingCode, setEditingCode] = useState<string>('');
  const [editingName, setEditingName] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Process a single cell with OCR
  const ocrSingleCell = async (cell: CroppedCell, index: number): Promise<CroppedCell> => {
    try {
      const { data, error } = await supabase.functions.invoke('ocr-swatch-cell', {
        body: {
          imageDataUrl: cell.dataUrl,
          manufacturer,
        },
      });

      if (error) throw error;

      return {
        ...cell,
        productCode: data.productCode || null,
        colorName: data.colorName || null,
        status: data.productCode ? 'done' : 'error',
      };
    } catch (err) {
      console.error(`OCR failed for R${cell.row}C${cell.col}:`, err);
      return { ...cell, status: 'error' };
    }
  };

  // Process all cells with OCR (batch with delays to avoid rate limits)
  const processAllCells = useCallback(async () => {
    setProcessing(true);
    setProgress(0);
    
    const updatedCells = [...cells];
    const batchSize = 5; // Process 5 at a time
    const delayBetweenBatches = 1000; // 1 second delay

    for (let i = 0; i < cells.length; i += batchSize) {
      const batch = cells.slice(i, Math.min(i + batchSize, cells.length));
      
      // Process batch in parallel
      const results = await Promise.all(
        batch.map((cell, idx) => ocrSingleCell(cell, i + idx))
      );
      
      // Update the cells array
      results.forEach((result, idx) => {
        updatedCells[i + idx] = result;
      });
      
      onCellsUpdated([...updatedCells]);
      setProgress(Math.round(((i + batch.length) / cells.length) * 100));
      
      // Delay before next batch
      if (i + batchSize < cells.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    setProcessing(false);
    
    const successCount = updatedCells.filter(c => c.status === 'done').length;
    const errorCount = updatedCells.filter(c => c.status === 'error').length;
    
    toast.success(`OCR complete: ${successCount} read, ${errorCount} failed`);
  }, [cells, manufacturer, onCellsUpdated]);

  // Save to Supabase storage and database
  const saveToDatabase = useCallback(async () => {
    const readyCells = cells.filter(c => c.status === 'done' && c.productCode);
    if (readyCells.length === 0) {
      toast.warning('No cells ready to save');
      return;
    }

    setSaving(true);
    let successCount = 0;
    let errorCount = 0;

    for (const cell of readyCells) {
      try {
        // Convert dataUrl to blob
        const response = await fetch(cell.dataUrl);
        const blob = await response.blob();
        
        // Upload to storage
        const fileName = `${cell.productCode}.png`;
        const filePath = `official/${manufacturer}/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('swatches')
          .upload(filePath, blob, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('swatches')
          .getPublicUrl(filePath);

        // Update manufacturer_colors table
        const { error: dbError } = await supabase
          .from('manufacturer_colors')
          .update({
            official_swatch_url: urlData.publicUrl,
            official_name: cell.colorName || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('product_code', cell.productCode)
          .eq('manufacturer', manufacturer === '3m' ? '3M' : 'Avery Dennison');

        if (dbError) {
          console.warn(`DB update failed for ${cell.productCode}:`, dbError);
        }

        successCount++;
      } catch (err) {
        console.error(`Failed to save ${cell.productCode}:`, err);
        errorCount++;
      }
    }

    setSaving(false);
    toast.success(`Saved ${successCount} swatches${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
  }, [cells, manufacturer]);

  // Edit a cell manually
  const startEditing = (index: number) => {
    const cell = cells[index];
    setSelectedCell(index);
    setEditingCode(cell.productCode || '');
    setEditingName(cell.colorName || '');
  };

  const saveEdit = () => {
    if (selectedCell === null) return;
    
    const updatedCells = [...cells];
    updatedCells[selectedCell] = {
      ...updatedCells[selectedCell],
      productCode: editingCode || undefined,
      colorName: editingName || undefined,
      status: editingCode ? 'done' : 'pending',
    };
    
    onCellsUpdated(updatedCells);
    setSelectedCell(null);
    toast.success('Cell updated');
  };

  const pendingCount = cells.filter(c => c.status === 'pending').length;
  const doneCount = cells.filter(c => c.status === 'done').length;
  const errorCount = cells.filter(c => c.status === 'error').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            OCR & Save ({cells.length} cells)
          </CardTitle>
          <CardDescription>
            {pendingCount} pending • {doneCount} done • {errorCount} errors
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={processAllCells} 
            disabled={processing || pendingCount === 0}
            variant="outline"
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                OCR {progress}%
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-2" />
                Run OCR on All
              </>
            )}
          </Button>
          <Button 
            onClick={saveToDatabase} 
            disabled={saving || doneCount === 0}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Save to Database ({doneCount})
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      
      {processing && (
        <div className="px-6 pb-4">
          <Progress value={progress} className="h-2" />
        </div>
      )}
      
      <CardContent>
        <ScrollArea className="h-[500px]">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {cells.map((cell, index) => (
              <div
                key={`${cell.row}-${cell.col}`}
                className={`relative border rounded-lg overflow-hidden ${
                  cell.status === 'done' ? 'border-green-500' :
                  cell.status === 'error' ? 'border-red-500' :
                  cell.status === 'processing' ? 'border-blue-500' :
                  'border-border'
                }`}
              >
                <img 
                  src={cell.dataUrl} 
                  alt={`R${cell.row}C${cell.col}`}
                  className="w-full h-auto"
                />
                
                {/* Status overlay */}
                <div className="absolute top-1 left-1">
                  <Badge 
                    variant={
                      cell.status === 'done' ? 'default' :
                      cell.status === 'error' ? 'destructive' :
                      'secondary'
                    }
                    className="text-xs"
                  >
                    R{cell.row}C{cell.col}
                  </Badge>
                </div>

                {cell.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}

                {/* OCR results */}
                {selectedCell === index ? (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2 space-y-1">
                    <Input
                      value={editingCode}
                      onChange={(e) => setEditingCode(e.target.value)}
                      placeholder="Product code"
                      className="h-6 text-xs"
                    />
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="Color name"
                      className="h-6 text-xs"
                    />
                    <div className="flex gap-1">
                      <Button size="sm" className="h-6 text-xs flex-1" onClick={saveEdit}>
                        <Save className="h-3 w-3 mr-1" />
                        Save
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-6 text-xs"
                        onClick={() => setSelectedCell(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div 
                    className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 cursor-pointer hover:bg-black/80"
                    onClick={() => startEditing(index)}
                  >
                    {cell.productCode ? (
                      <div className="text-white text-xs">
                        <p className="font-mono font-bold truncate">{cell.productCode}</p>
                        {cell.colorName && (
                          <p className="text-white/70 truncate text-[10px]">{cell.colorName}</p>
                        )}
                      </div>
                    ) : cell.status === 'error' ? (
                      <div className="flex items-center gap-1 text-red-400 text-xs">
                        <AlertTriangle className="h-3 w-3" />
                        OCR failed - click to edit
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-white/50 text-xs">
                        <Edit2 className="h-3 w-3" />
                        Click to edit
                      </div>
                    )}
                  </div>
                )}

                {cell.status === 'done' && (
                  <div className="absolute top-1 right-1">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
