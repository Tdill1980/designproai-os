import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Grid3X3, Move, ZoomIn, Check, RotateCcw, Crop, Eye } from 'lucide-react';

interface GridConfig {
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
}

interface CroppedCell {
  row: number;
  col: number;
  dataUrl: string;
  productCode?: string;
  colorName?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
}

interface PosterGridCropperProps {
  imageUrl: string;
  manufacturer: string;
  onCellsCropped: (cells: CroppedCell[]) => void;
  onReset: () => void;
}

export function PosterGridCropper({ 
  imageUrl, 
  manufacturer, 
  onCellsCropped,
  onReset 
}: PosterGridCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isDrawingCell, setIsDrawingCell] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  
  const [gridConfig, setGridConfig] = useState<GridConfig>({
    cellWidth: 228,
    cellHeight: 168,
    offsetX: 0,
    offsetY: 0,
    cols: 10,
    rows: 20,
  });
  
  const [showGrid, setShowGrid] = useState(false);
  const [cells, setCells] = useState<CroppedCell[]>([]);
  const [scale, setScale] = useState(1);

  // Load the image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
      
      // Auto-calculate grid dimensions based on typical cell sizes
      const estimatedCols = Math.floor(img.width / gridConfig.cellWidth);
      const estimatedRows = Math.floor(img.height / gridConfig.cellHeight);
      
      setGridConfig(prev => ({
        ...prev,
        cols: Math.max(1, estimatedCols),
        rows: Math.max(1, estimatedRows),
      }));
      
      // Set scale to fit in viewport
      const maxWidth = 800;
      if (img.width > maxWidth) {
        setScale(maxWidth / img.width);
      }
    };
    img.onerror = () => {
      toast.error('Failed to load poster image');
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw the canvas with image and grid overlay
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageLoaded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;

    // Draw image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw grid overlay if enabled
    if (showGrid) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.lineWidth = 2;

      const scaledCellWidth = gridConfig.cellWidth * scale;
      const scaledCellHeight = gridConfig.cellHeight * scale;
      const scaledOffsetX = gridConfig.offsetX * scale;
      const scaledOffsetY = gridConfig.offsetY * scale;

      for (let row = 0; row < gridConfig.rows; row++) {
        for (let col = 0; col < gridConfig.cols; col++) {
          const x = scaledOffsetX + col * scaledCellWidth;
          const y = scaledOffsetY + row * scaledCellHeight;
          
          ctx.strokeRect(x, y, scaledCellWidth, scaledCellHeight);
          
          // Draw cell label
          ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
          ctx.font = `${12 * scale}px monospace`;
          ctx.fillText(`R${row + 1}C${col + 1}`, x + 4, y + 14 * scale);
        }
      }
    }

    // Draw the calibration rectangle if user is drawing
    if (drawStart && drawEnd) {
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      
      const width = drawEnd.x - drawStart.x;
      const height = drawEnd.y - drawStart.y;
      ctx.strokeRect(drawStart.x, drawStart.y, width, height);
      
      ctx.setLineDash([]);
      
      // Show dimensions
      ctx.fillStyle = 'rgba(34, 197, 94, 1)';
      ctx.font = '14px monospace';
      ctx.fillText(
        `${Math.round(width / scale)}×${Math.round(height / scale)}px`, 
        drawStart.x + 4, 
        drawStart.y - 8
      );
    }
  }, [imageLoaded, showGrid, gridConfig, scale, drawStart, drawEnd]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Handle mouse events for drawing calibration rectangle
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingCell) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setDrawStart({ x, y });
    setDrawEnd({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingCell || !drawStart) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setDrawEnd({ x, y });
  };

  const handleMouseUp = () => {
    if (!drawStart || !drawEnd) return;
    
    // Calculate cell dimensions from drawn rectangle
    const width = Math.abs(drawEnd.x - drawStart.x) / scale;
    const height = Math.abs(drawEnd.y - drawStart.y) / scale;
    
    if (width > 20 && height > 20) {
      const offsetX = Math.min(drawStart.x, drawEnd.x) / scale;
      const offsetY = Math.min(drawStart.y, drawEnd.y) / scale;
      
      const img = imageRef.current;
      if (img) {
        const cols = Math.floor((img.width - offsetX) / width);
        const rows = Math.floor((img.height - offsetY) / height);
        
        setGridConfig({
          cellWidth: Math.round(width),
          cellHeight: Math.round(height),
          offsetX: Math.round(offsetX),
          offsetY: Math.round(offsetY),
          cols: Math.max(1, cols),
          rows: Math.max(1, rows),
        });
        
        toast.success(`Grid calibrated: ${cols}×${rows} cells at ${Math.round(width)}×${Math.round(height)}px`);
      }
    }
    
    setIsDrawingCell(false);
    setDrawStart(null);
    setDrawEnd(null);
    setShowGrid(true);
  };

  // Crop all cells from the grid
  const cropAllCells = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;

    const croppedCells: CroppedCell[] = [];
    
    for (let row = 0; row < gridConfig.rows; row++) {
      for (let col = 0; col < gridConfig.cols; col++) {
        const x = gridConfig.offsetX + col * gridConfig.cellWidth;
        const y = gridConfig.offsetY + row * gridConfig.cellHeight;
        
        // Skip cells outside image bounds
        if (x + gridConfig.cellWidth > img.width || y + gridConfig.cellHeight > img.height) {
          continue;
        }
        
        // Create a temporary canvas to crop this cell
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = gridConfig.cellWidth;
        tempCanvas.height = gridConfig.cellHeight;
        
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) continue;
        
        tempCtx.drawImage(
          img,
          x, y, gridConfig.cellWidth, gridConfig.cellHeight,
          0, 0, gridConfig.cellWidth, gridConfig.cellHeight
        );
        
        croppedCells.push({
          row: row + 1,
          col: col + 1,
          dataUrl: tempCanvas.toDataURL('image/png'),
          status: 'pending',
        });
      }
    }
    
    setCells(croppedCells);
    toast.success(`Cropped ${croppedCells.length} cells from grid`);
    onCellsCropped(croppedCells);
  }, [gridConfig, onCellsCropped]);

  if (!imageLoaded) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading poster image...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Grid Calibration
          </CardTitle>
          <CardDescription>
            Draw a rectangle around ONE swatch cell to calibrate the grid, or adjust manually below
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isDrawingCell ? "default" : "outline"}
              size="sm"
              onClick={() => setIsDrawingCell(!isDrawingCell)}
            >
              <Crop className="h-4 w-4 mr-1" />
              {isDrawingCell ? 'Drawing...' : 'Draw Cell'}
            </Button>
            
            <Button
              variant={showGrid ? "default" : "outline"}
              size="sm"
              onClick={() => setShowGrid(!showGrid)}
            >
              <Eye className="h-4 w-4 mr-1" />
              {showGrid ? 'Hide Grid' : 'Show Grid'}
            </Button>
            
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            
            <div className="flex-1" />
            
            <Badge variant="secondary">
              {gridConfig.cols}×{gridConfig.rows} = {gridConfig.cols * gridConfig.rows} cells
            </Badge>
            
            <Button onClick={cropAllCells} disabled={!showGrid}>
              <Crop className="h-4 w-4 mr-2" />
              Crop All Cells
            </Button>
          </div>

          {/* Grid controls */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Cell Width: {gridConfig.cellWidth}px</Label>
              <Slider
                value={[gridConfig.cellWidth]}
                min={50}
                max={500}
                step={1}
                onValueChange={([v]) => setGridConfig(prev => ({ ...prev, cellWidth: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Cell Height: {gridConfig.cellHeight}px</Label>
              <Slider
                value={[gridConfig.cellHeight]}
                min={50}
                max={500}
                step={1}
                onValueChange={([v]) => setGridConfig(prev => ({ ...prev, cellHeight: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Offset X: {gridConfig.offsetX}px</Label>
              <Slider
                value={[gridConfig.offsetX]}
                min={0}
                max={200}
                step={1}
                onValueChange={([v]) => setGridConfig(prev => ({ ...prev, offsetX: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Offset Y: {gridConfig.offsetY}px</Label>
              <Slider
                value={[gridConfig.offsetY]}
                min={0}
                max={200}
                step={1}
                onValueChange={([v]) => setGridConfig(prev => ({ ...prev, offsetY: v }))}
              />
            </div>
          </div>

          {/* Zoom control */}
          <div className="flex items-center gap-4">
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <Slider
                value={[scale * 100]}
                min={25}
                max={150}
                step={5}
                onValueChange={([v]) => setScale(v / 100)}
              />
            </div>
            <span className="text-sm text-muted-foreground w-12">{Math.round(scale * 100)}%</span>
          </div>
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card>
        <CardContent className="p-4 overflow-auto">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`border rounded ${isDrawingCell ? 'cursor-crosshair' : 'cursor-default'}`}
            style={{ maxWidth: '100%' }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
