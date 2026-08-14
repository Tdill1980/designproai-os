import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

const MANUFACTURERS = [
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
  "Other",
];

const FINISHES = [
  "Gloss",
  "Satin",
  "Matte",
  "Metallic",
  "Pearl",
  "Chrome",
  "Carbon Fiber",
  "Brushed",
];

interface UnknownSwatchModalProps {
  open: boolean;
  onClose: () => void;
  swatchImageUrl: string;
  onConfirm: (selection: {
    manufacturer: string;
    colorName: string;
    finish: string;
  }) => void;
  onSkip: () => void;
}

export function UnknownSwatchModal({
  open,
  onClose,
  swatchImageUrl,
  onConfirm,
  onSkip,
}: UnknownSwatchModalProps) {
  const [manufacturer, setManufacturer] = useState("");
  const [colorName, setColorName] = useState("");
  const [finish, setFinish] = useState("Gloss");

  const handleConfirm = () => {
    if (manufacturer && colorName) {
      onConfirm({ manufacturer, colorName, finish });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Confirm Vinyl Details
          </DialogTitle>
          <DialogDescription>
            We couldn't read the label on this swatch. Please confirm the vinyl details for an accurate render.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Swatch preview */}
          <div className="flex justify-center">
            <img
              src={swatchImageUrl}
              alt="Uploaded swatch"
              className="h-20 w-20 object-cover rounded-lg border border-border"
            />
          </div>

          {/* Manufacturer */}
          <div className="space-y-2">
            <Label>Manufacturer *</Label>
            <Select value={manufacturer} onValueChange={setManufacturer}>
              <SelectTrigger>
                <SelectValue placeholder="Select manufacturer" />
              </SelectTrigger>
              <SelectContent>
                {MANUFACTURERS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Color Name */}
          <div className="space-y-2">
            <Label>Color Name *</Label>
            <input
              type="text"
              value={colorName}
              onChange={(e) => setColorName(e.target.value)}
              placeholder="e.g., Satin Black, Gloss Electric Blue"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            />
          </div>

          {/* Finish */}
          <div className="space-y-2">
            <Label>Finish</Label>
            <Select value={finish} onValueChange={setFinish}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINISHES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleConfirm}
            disabled={!manufacturer || !colorName}
            className="w-full"
          >
            Generate Accurate Preview
          </Button>
          <Button
            variant="ghost"
            onClick={onSkip}
            className="w-full text-muted-foreground text-sm"
          >
            Preview as concept only (less accurate)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
