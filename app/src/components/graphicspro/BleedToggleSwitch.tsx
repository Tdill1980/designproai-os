import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface BleedToggleSwitchProps {
  showBleed: boolean;
  onToggle: (showBleed: boolean) => void;
}

export const BleedToggleSwitch = ({ showBleed, onToggle }: BleedToggleSwitchProps) => {
  return (
    <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg border border-border/50">
      <div className="flex flex-col">
        <Label className="text-sm font-medium text-foreground">Show Bleed</Label>
        <p className="text-xs text-muted-foreground">
          Toggle 0.5" production bleed outline
        </p>
      </div>
      <Switch
        checked={showBleed}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-blue-500"
      />
    </div>
  );
};
