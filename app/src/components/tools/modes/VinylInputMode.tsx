import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SwatchUploader } from "@/components/visualize/SwatchUploader";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MANUAL_MANUFACTURERS = [
  "Avery Dennison",
  "3M",
  "KPMF",
  "Oracal",
  "Inozetek",
  "Arlon",
  "TeckWrap",
  "VViViD",
  "STEK",
  "Carlas",
  "FlexiShield",
  "Other (Custom)",
];

const MANUAL_FINISHES = [
  "Gloss",
  "Satin",
  "Matte",
  "Metallic",
  "Pearl",
  "ColorShift",
  "Chrome",
  "Carbon Fiber",
  "Brushed",
];

interface VinylInputModeProps {
  selectedMode: 'upload' | 'manual';
  onSwatchSelect: (swatch: any) => void;
}

export function VinylInputMode({ selectedMode, onSwatchSelect }: VinylInputModeProps) {
  const [manualManufacturer, setManualManufacturer] = useState("");
  const [manualColorName, setManualColorName] = useState("");
  const [manualFinish, setManualFinish] = useState("");

  // UPLOAD MODE
  if (selectedMode === 'upload') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a photo of ANY manufacturer swatch. AI will detect the exact color, finish, and product code.
        </p>
        <SwatchUploader
          onAnalysisComplete={(verifiedSwatch) => {
            if (verifiedSwatch) {
              onSwatchSelect({
                ...verifiedSwatch,
                colorLibrary: "verified_vinyl",
                manufacturer: verifiedSwatch.manufacturer || "Unknown",
                finish: verifiedSwatch.finishType || "Gloss",
                // CRITICAL: Map 'url' to 'swatchImageUrl' for generate-color-render
                swatchImageUrl: verifiedSwatch.url,
              });
            }
          }}
        />
      </div>
    );
  }

  // MANUAL MODE
  if (selectedMode === 'manual') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Type the manufacturer name and color details below
        </p>

        {/* MANUFACTURER DROPDOWN */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Manufacturer *</Label>
          <Select value={manualManufacturer} onValueChange={setManualManufacturer}>
            <SelectTrigger className="w-full bg-background border-border">
              <SelectValue placeholder="Select Manufacturer" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              {MANUAL_MANUFACTURERS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* FINISH DROPDOWN */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Finish (Optional)</Label>
          <Select value={manualFinish} onValueChange={setManualFinish}>
            <SelectTrigger className="w-full bg-background border-border">
              <SelectValue placeholder="Select Finish" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              {MANUAL_FINISHES.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* COLOR NAME */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Color Name / Product Code *</Label>
          <Input
            placeholder="Type here: Carmine Red / SW900-436-O"
            value={manualColorName}
            onChange={(e) => setManualColorName(e.target.value)}
            className="border-2 border-border focus:border-primary focus:ring-2 focus:ring-primary/20 p-3 text-base bg-background"
          />
        </div>

        <Button
          disabled={!manualManufacturer || !manualColorName}
          className="w-full"
          onClick={() => {
            let detectedFinish = manualFinish || "Gloss";
            const colorNameLower = manualColorName.toLowerCase();
            
            if (!manualFinish) {
              if (colorNameLower.includes('chrome') || colorNameLower.includes('mirror')) {
                detectedFinish = "Chrome";
              } else if (colorNameLower.includes('metallic')) {
                detectedFinish = "Metallic";
              } else if (colorNameLower.includes('pearl') || colorNameLower.includes('iridescent')) {
                detectedFinish = "Pearl";
              } else if (colorNameLower.includes('matte') || colorNameLower.includes('flat')) {
                detectedFinish = "Matte";
              } else if (colorNameLower.includes('satin')) {
                detectedFinish = "Satin";
              }
            }
            
            onSwatchSelect({
              manufacturer: manualManufacturer,
              name: manualColorName,
              finish: detectedFinish,
              colorLibrary: "verified_vinyl",
            });
          }}
        >
          Use This Color
        </Button>
      </div>
    );
  }

  // Default fallback (shouldn't reach here with proper types)
  return null;
}
