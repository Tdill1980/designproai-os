import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { inkFusionColors, InkFusionColor } from '@/lib/restyleproai-colors';

interface ColorDropdownProps {
  onColorSelect: (color: InkFusionColor) => void;
  selectedColor: InkFusionColor | null;
}

export function ColorDropdown({ onColorSelect, selectedColor }: ColorDropdownProps) {
  const colorsByFamily = inkFusionColors.reduce((acc, color) => {
    if (!acc[color.family]) acc[color.family] = [];
    acc[color.family].push(color);
    return acc;
  }, {} as Record<string, InkFusionColor[]>);

  return (
    <div className="space-y-3">
      <Label>InkFusion™ Color</Label>
      <Select
        value={selectedColor?.id}
        onValueChange={(id) => {
          const color = inkFusionColors.find(c => c.id === id);
          if (color) onColorSelect(color);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a color">
            {selectedColor && (
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded border"
                  style={{ backgroundColor: selectedColor.hex }}
                />
                <span>{selectedColor.name}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(colorsByFamily).map(([family, colors]) => (
            <SelectGroup key={family}>
              <SelectLabel>{family}</SelectLabel>
              {colors.map((color) => (
                <SelectItem key={color.id} value={color.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="flex flex-col">
                      <span>{color.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {color.hex} • {color.finish}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}