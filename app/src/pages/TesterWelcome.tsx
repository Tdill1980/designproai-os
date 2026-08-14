import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Palette, 
  Layers, 
  Grid3X3, 
  FileCheck, 
  MessageSquare, 
  Star,
  ArrowRight,
  CheckCircle
} from "lucide-react";

const tools = [
  {
    name: "ColorPro™",
    route: "/colorpro",
    icon: Palette,
    description: "Visualize any manufacturer's vinyl wrap on vehicles",
    feedbackFocus: [
      "Color accuracy vs real vinyl",
      "Image quality & realism",
      "Speed of generation",
      "Ease of color selection"
    ]
  },
  {
    name: "RestyleLibrary™",
    route: "/restylelibrary",
    icon: Layers,
    description: "Curated wrap designs, FadeWraps, and Universal Panelizer production packs",
    feedbackFocus: [
      "Design placement accuracy",
      "Panel coverage realism",
      "FadeWrap gradient quality",
      "Design library variety"
    ]
  },
  {
    name: "PatternPro™",
    route: "/wbty",
    icon: Grid3X3,
    description: "Visualize patterns and textures on vehicles",
    feedbackFocus: [
      "Pattern scaling accuracy",
      "Texture realism",
      "Pattern library quality",
      "Custom upload experience"
    ]
  },
  {
    name: "ApprovePro™",
    route: "/approvemode",
    icon: FileCheck,
    description: "Convert 2D design proofs to 3D vehicle renders",
    feedbackFocus: [
      "2D to 3D conversion accuracy",
      "Proof quality for clients",
      "Multi-view usefulness",
      "PDF export quality"
    ]
  }
];

export default function TesterWelcome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <Badge className="mb-4 bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Star className="h-3 w-3 mr-1" />
            Tester Access Granted
          </Badge>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Welcome to RestyleProAI™ Vehicle Wrap Design Suite
          </h1>
          <p className="text-muted-foreground">
            You have unlimited access to all tools. Here's how to test and give feedback.
          </p>
        </div>

        {/* How to Give Feedback */}
        <Card className="mb-8 border-blue-500/30 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <MessageSquare className="h-5 w-5 text-blue-400" />
              How to Give Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-background/50 border">
                <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  After Each Render
                </h4>
                <p className="text-sm text-muted-foreground">
                  Rate the quality (1-5 stars) and flag any issues directly on the render. Your ratings help us improve AI accuracy.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-background/50 border">
                <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  General Feedback
                </h4>
                <p className="text-sm text-muted-foreground">
                  Text or email your overall impressions, bugs found, feature requests, and pricing suggestions to your contact.
                </p>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-background/50 border">
              <h4 className="font-medium text-foreground mb-2">Key Questions We Need Answered:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• What monthly price would you pay for unlimited renders?</li>
                <li>• Which tool is most valuable to your business?</li>
                <li>• What's missing that would make this a must-have?</li>
                <li>• How does render quality compare to competitors?</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Tools Grid */}
        <h2 className="text-xl font-semibold text-foreground mb-4">Test These Tools</h2>
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {tools.map((tool) => (
            <Card 
              key={tool.name} 
              className="cursor-pointer hover:border-blue-500/50 transition-colors"
              onClick={() => navigate(tool.route)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <tool.icon className="h-5 w-5 text-blue-400" />
                  {tool.name}
                </CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Focus your feedback on:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {tool.feedbackFocus.map((item, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-blue-400" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="mt-3 text-blue-400 hover:text-blue-300 p-0"
                >
                  Try {tool.name} <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Start */}
        <div className="text-center">
          <Button 
            size="lg" 
            onClick={() => navigate('/colorpro')}
            className="bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600"
          >
            Start Testing with ColorPro™
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </main>

    </div>
  );
}
