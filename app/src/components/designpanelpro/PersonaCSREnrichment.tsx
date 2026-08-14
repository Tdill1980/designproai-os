import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, Edit2, Sparkles, Palette } from "lucide-react";

export interface CSREnrichmentResult {
  enrichedBrief: string;
  suggestions: string[];
  colorPalette: string[];
  designStyle: string;
  wrapType: string;
}

interface PersonaCSREnrichmentProps {
  result: CSREnrichmentResult;
  onApprove: (brief: string) => void;
  onEdit: (brief: string) => void;
}

export const PersonaCSREnrichment = ({
  result,
  onApprove,
  onEdit,
}: PersonaCSREnrichmentProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBrief, setEditedBrief] = useState(result.enrichedBrief);

  const handleApprove = () => {
    onApprove(isEditing ? editedBrief : result.enrichedBrief);
  };

  const handleEdit = () => {
    if (isEditing) {
      onEdit(editedBrief);
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  };

  return (
    <Card className="overflow-hidden border-blue-500/20">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/5 to-transparent p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Wrap Consultant Brief</p>
            <p className="text-[11px] text-muted-foreground">
              Persona 1 - CSR Design Enrichment
            </p>
          </div>
          <Badge className="ml-auto bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
            {result.designStyle}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Enriched Brief */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Design Brief</p>
          {isEditing ? (
            <Textarea
              value={editedBrief}
              onChange={(e) => setEditedBrief(e.target.value)}
              className="min-h-[100px] text-sm bg-secondary/50 border-blue-500/20"
            />
          ) : (
            <p className="text-sm leading-relaxed text-foreground/90">
              {result.enrichedBrief}
            </p>
          )}
        </div>

        {/* Suggestions */}
        {result.suggestions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Pro Suggestions
            </p>
            <div className="space-y-1.5">
              {result.suggestions.map((suggestion, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-foreground/80"
                >
                  <span className="text-blue-400 mt-0.5 shrink-0">
                    {i + 1}.
                  </span>
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Color Palette */}
        {result.colorPalette.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Palette className="w-3 h-3 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">
                Color Palette
              </p>
            </div>
            <div className="flex gap-2">
              {result.colorPalette.map((color, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className="w-8 h-8 rounded-md border border-border/50 shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {color}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleApprove}
            className={cn(
              "flex-1 gap-2",
              "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0"
            )}
          >
            <Check className="w-4 h-4" />
            {isEditing ? "Approve Edited Brief" : "Approve & Design"}
          </Button>
          <Button
            onClick={handleEdit}
            variant="outline"
            className="gap-2 border-border/50"
          >
            <Edit2 className="w-3.5 h-3.5" />
            {isEditing ? "Save Edit" : "Edit Brief"}
          </Button>
        </div>
      </div>
    </Card>
  );
};
