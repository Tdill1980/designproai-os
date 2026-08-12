import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Paintbrush, Palette, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomStylingPromptProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const STYLING_SUGGESTIONS = [
  {
    label: "Two-Tone Roof",
    prompt: "Matte black roof and A-pillars, gloss body color on everything else",
    icon: Layers
  },
  {
    label: "Racing Stripes",
    prompt: "Dual racing stripes down the center of hood, roof, and trunk in contrasting color",
    icon: Paintbrush
  },
  {
    label: "Brushed Gold Top",
    prompt: "Brushed gold on hood and roof, matte black on body panels and bumpers",
    icon: Sparkles
  },
  {
    label: "Lowrider Accents",
    prompt: "Chrome pinstripe accents along door lines and wheel arches, cut vinyl trim details on body lines",
    icon: Palette
  },
  {
    label: "Carbon Hood",
    prompt: "Carbon fiber weave hood and side mirrors, gloss black body",
    icon: Layers
  },
  {
    label: "Split Body",
    prompt: "Top half matte white, bottom half gloss black, chrome divider stripe at belt line",
    icon: Paintbrush
  },
];

export const CustomStylingPrompt = ({
  value,
  onChange,
  className
}: CustomStylingPromptProps) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleSuggestionClick = (prompt: string) => {
    // Append to existing prompt or set as new
    if (value.trim()) {
      onChange(value + ". " + prompt);
    } else {
      onChange(prompt);
    }
  };

  const characterCount = value.length;
  const isValid = characterCount >= 20;

  return (
    <Card className={cn("p-4 bg-secondary/30 border-border/50", className)}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Describe Your Custom Styling
          </Label>
          <Badge 
            variant={isValid ? "default" : "secondary"}
            className={cn(
              "text-xs",
              isValid ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
            )}
          >
            {characterCount} / 20+ chars
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Describe exactly how you want your vehicle styled - multiple colors, accents, zones, pinstripes, anything you can imagine
        </p>

        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="e.g., Brushed gold on hood and roof, matte black body panels, lowrider-style chrome pinstripe accents along the door lines and wheel arches..."
          className={cn(
            "bg-background border-2 text-sm min-h-[120px] transition-all",
            isFocused ? "border-primary/50" : "border-border/50",
            !isValid && value.length > 0 && "border-yellow-500/50"
          )}
        />

        {/* Quick Suggestions */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Quick styling ideas (click to add):</Label>
          <div className="flex flex-wrap gap-2">
            {STYLING_SUGGESTIONS.map((suggestion) => {
              const Icon = suggestion.icon;
              return (
                <button
                  key={suggestion.label}
                  onClick={() => handleSuggestionClick(suggestion.prompt)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs",
                    "bg-primary/10 text-primary hover:bg-primary/20",
                    "border border-primary/20 hover:border-primary/40",
                    "transition-all cursor-pointer"
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {suggestion.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Styling Tips */}
        <div className="bg-muted/30 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">💡 AI Styling Tips:</p>
          <ul className="text-xs text-muted-foreground/80 space-y-0.5 list-disc list-inside">
            <li>Specify zones: hood, roof, body, bumpers, mirrors, trim</li>
            <li>Name colors + finishes: "brushed gold", "matte black", "gloss white"</li>
            <li>Mention accents: pinstripes, cut vinyl, chrome trim</li>
            <li>Reference styles: lowrider, racing, two-tone, carbon fiber</li>
          </ul>
        </div>
      </div>
    </Card>
  );
};
