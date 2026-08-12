import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function AdminAIAutoFix() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-500 mt-0.5" />
            <div>
              <h1 className="text-2xl font-bold mb-2">AI Auto-Fix Disabled</h1>
              <p className="text-muted-foreground">
                The AI Auto-Fix system has been disabled. It was injecting AI-generated
                "improvement" instructions into render prompts and inserting synthetic
                records into the color_visualizations table, which degraded render quality.
              </p>
              <p className="text-muted-foreground mt-2">
                Quality ratings are still collected for analytics. Use the Render Intelligence
                dashboard to review quality trends manually.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
