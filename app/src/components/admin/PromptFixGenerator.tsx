import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, CheckCircle, Wand2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RenderQualityRating } from "@/types/render-quality";

interface PromptFixGeneratorProps {
  rating: RenderQualityRating;
  onFixDeployed: () => void;
}

const toolPromptPatterns: Record<string, string[]> = {
  colorpro: [
    "Ensure exact color matching with the specified hex value",
    "Maintain color saturation and vibrancy throughout the vehicle",
    "Do NOT add any color tinting or hue shifts",
  ],
  designpanelpro: [
    "Maintain consistent design across ALL angles and views",
    "Do NOT add any purple, violet, or magenta tones unless explicitly requested",
    "Keep the pattern scale and orientation uniform",
  ],
  fadewraps: [
    "Create SEAMLESS gradient transitions with no hard lines",
    "Use airbrush-style smooth fading between colors",
    "Ensure the gradient flows naturally across body panels",
  ],
  wbty: [
    "Apply pattern consistently across the entire vehicle",
    "Maintain pattern aspect ratio and scale",
    "Ensure clean edges at panel boundaries",
  ],
  approvemode: [
    "Generate accurate before/after comparisons",
    "Maintain consistent lighting and angle across both images",
    "Show realistic wrap application on the vehicle",
  ],
};

export function PromptFixGenerator({ rating, onFixDeployed }: PromptFixGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFix, setGeneratedFix] = useState<string>("");
  const [fixNotes, setFixNotes] = useState(rating.fix_notes || "");
  const [isSaving, setIsSaving] = useState(false);

  const generateAIFix = async () => {
    setIsGenerating(true);
    try {
      // Get common patterns for this tool
      const patterns = toolPromptPatterns[rating.render_type] || [];
      
      // Analyze the issue and generate a fix recommendation
      const issueText = rating.notes || rating.flag_reason || "Unknown issue";
      
      // Simple rule-based fix generation (can be enhanced with AI later)
      let recommendedFix = `## Recommended Prompt Enhancement for ${rating.render_type.toUpperCase()}\n\n`;
      recommendedFix += `### Issue Reported:\n"${issueText}"\n\n`;
      recommendedFix += `### Suggested Prompt Additions:\n`;
      
      // Add relevant patterns based on keywords
      const issueKeywords = issueText.toLowerCase();
      
      if (issueKeywords.includes("purple") || issueKeywords.includes("color") || issueKeywords.includes("tint")) {
        recommendedFix += `- "Do NOT add any purple, violet, magenta, or unintended color tones. Maintain exact color fidelity to the specified input."\n`;
      }
      
      if (issueKeywords.includes("inconsistent") || issueKeywords.includes("different") || issueKeywords.includes("angle")) {
        recommendedFix += `- "CRITICAL: Maintain absolute consistency across ALL vehicle angles and views. The design must look identical from every perspective."\n`;
      }
      
      if (issueKeywords.includes("hard line") || issueKeywords.includes("gradient") || issueKeywords.includes("fade")) {
        recommendedFix += `- "Create PERFECTLY SMOOTH gradient transitions using airbrush-style blending. There must be NO visible hard lines or abrupt color changes."\n`;
      }
      
      if (issueKeywords.includes("light") || issueKeywords.includes("dark") || issueKeywords.includes("saturation")) {
        recommendedFix += `- "Match the exact color intensity and saturation as specified. Do not lighten or darken colors."\n`;
      }
      
      if (issueKeywords.includes("hood") || issueKeywords.includes("creativity") || issueKeywords.includes("imagination")) {
        recommendedFix += `- "Follow the design specifications EXACTLY. Do not add creative interpretations or modifications to the hood or any body panel."\n`;
      }
      
      // Add default patterns for the tool
      recommendedFix += `\n### Standard ${rating.render_type} Guidelines:\n`;
      patterns.forEach((pattern) => {
        recommendedFix += `- "${pattern}"\n`;
      });
      
      recommendedFix += `\n---\nCopy this text and paste it into Lovable to update the edge function prompts.`;
      
      setGeneratedFix(recommendedFix);
    } catch (error) {
      console.error("Error generating fix:", error);
      toast({
        title: "Error",
        description: "Failed to generate fix recommendation",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedFix);
      toast({
        title: "Copied!",
        description: "Fix recommendation copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Please select and copy the text manually",
        variant: "destructive",
      });
    }
  };

  const markFixDeployed = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("render_quality_ratings")
        .update({
          fix_deployed_at: new Date().toISOString(),
          fix_notes: fixNotes,
        })
        .eq("id", rating.id);

      if (error) throw error;

      toast({
        title: "Fix Deployed!",
        description: "The issue has been marked as resolved",
      });
      onFixDeployed();
    } catch (error) {
      console.error("Error marking fix deployed:", error);
      toast({
        title: "Error",
        description: "Failed to update fix status",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const markAsV2Feature = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("render_quality_ratings")
        .update({
          is_v2_feature: true,
          fix_notes: fixNotes || "Deferred to V2",
        })
        .eq("id", rating.id);

      if (error) throw error;

      toast({
        title: "Marked as V2 Feature",
        description: "This issue has been deferred to a future version",
      });
      onFixDeployed();
    } catch (error) {
      console.error("Error marking as V2:", error);
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          AI Prompt Fix Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={generateAIFix}
          disabled={isGenerating}
          className="w-full"
          variant="outline"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analyzing Issue...
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-2" />
              Generate Fix Recommendation
            </>
          )}
        </Button>

        {generatedFix && (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <pre className="text-sm whitespace-pre-wrap font-mono text-foreground">
                {generatedFix}
              </pre>
            </div>
            <Button onClick={copyToClipboard} variant="outline" size="sm">
              <Copy className="h-4 w-4 mr-2" />
              Copy to Clipboard
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Fix Notes</label>
          <Textarea
            value={fixNotes}
            onChange={(e) => setFixNotes(e.target.value)}
            placeholder="Describe what was changed to fix this issue..."
            className="min-h-[80px]"
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={markFixDeployed}
            disabled={isSaving || !!rating.fix_deployed_at}
            className="flex-1"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            {rating.fix_deployed_at ? "Already Fixed" : "Mark Fix Deployed"}
          </Button>
          <Button
            onClick={markAsV2Feature}
            disabled={isSaving || rating.is_v2_feature}
            variant="outline"
          >
            {rating.is_v2_feature ? "V2 Marked" : "Mark as V2 Feature"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
