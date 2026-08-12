import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, FileCode, Scissors, Layers, Grid, FileText, Crown, ArrowRight, CheckCircle2, Sparkles, Eye, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

interface ProductionUpgradePromptProps {
  hasAccess?: boolean;
}

export const ProductionUpgradePrompt = ({ hasAccess = false }: ProductionUpgradePromptProps) => {
  const navigate = useNavigate();
  const [activePreview, setActivePreview] = useState<'cut' | 'bleed' | 'tiles' | 'guide'>('cut');

  const features = [
    { icon: Scissors, label: "SVG Cut Paths", description: "Plotter-ready vector outlines", preview: 'cut' as const },
    { icon: Layers, label: "Bleed Vectors", description: "Production-ready with 0.125\" bleed", preview: 'bleed' as const },
    { icon: Grid, label: "Print Tiles", description: "53\"/60\" roll-ready panels", preview: 'tiles' as const },
    { icon: FileText, label: "Installer Guide", description: "Professional install instructions", preview: 'guide' as const },
  ];

  const previewImages = {
    cut: "/production-preview/cutpath_sample.svg",
    bleed: "/production-preview/bleed_sample.svg",
    tiles: "/production-preview/tiles_sample.svg",
    guide: "/production-preview/installer_sample.svg",
  };

  const outputExamples = [
    "cutfile.svg - Cut path only",
    "bleedfile.svg - Cut path + bleed",
    "tiles/*.svg - Tiled printable panels",
    "installGuide.pdf - Installer instructions",
    "panelMask.png - Verification map",
  ];

  // If user has access, show full production panel
  if (hasAccess) {
    return (
      <Card className="p-6 bg-gradient-to-br from-emerald-500/10 via-blue-500/10 to-background border-emerald-500/30 overflow-hidden relative">
        <div className="absolute top-4 right-4">
          <div className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-500 text-xs font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            PRO UNLOCKED
          </div>
        </div>

        <div className="flex flex-col space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500/30 to-blue-500/30 flex items-center justify-center">
              <FileCode className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Production Mode</h3>
              <p className="text-sm text-muted-foreground">Generate print-ready production files</p>
            </div>
          </div>

          {/* Preview Tabs */}
          <div className="flex gap-2 flex-wrap">
            {features.map((feature) => (
              <Button
                key={feature.preview}
                variant={activePreview === feature.preview ? "default" : "outline"}
                size="sm"
                onClick={() => setActivePreview(feature.preview)}
                className="gap-2"
              >
                <feature.icon className="w-4 h-4" />
                {feature.label}
              </Button>
            ))}
          </div>

          {/* Active Preview */}
          <div className="bg-white rounded-lg p-4 border border-border/50">
            <img 
              src={previewImages[activePreview]} 
              alt={`${activePreview} preview`}
              className="w-full h-auto"
            />
          </div>

          {/* Download Buttons */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Cut Path
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Bleed SVG
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Print Tiles
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Install Guide
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Non-Pro users see locked preview with samples
  return (
    <Card className="p-6 bg-gradient-to-br from-amber-500/10 via-purple-500/10 to-background border-amber-500/30 overflow-hidden relative">
      {/* Locked badge */}
      <div className="absolute top-4 right-4">
        <div className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-500 text-xs font-medium flex items-center gap-1">
          <Lock className="w-3 h-3" />
          PRO
        </div>
      </div>

      <div className="flex flex-col items-center text-center space-y-5">
        {/* Header */}
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/30 to-purple-500/30 flex items-center justify-center">
          <Lock className="w-8 h-8 text-amber-500" />
        </div>
        
        <div>
          <h3 className="text-xl font-bold text-foreground mb-1">
            Production Mode
          </h3>
          <p className="text-sm text-muted-foreground">
            Unlock print-ready assets for professional installations
          </p>
        </div>

        {/* Preview Tabs */}
        <div className="flex gap-2 flex-wrap justify-center">
          {features.map((feature) => (
            <Button
              key={feature.preview}
              variant={activePreview === feature.preview ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActivePreview(feature.preview)}
              className="gap-2"
            >
              <Eye className="w-3 h-3" />
              {feature.label}
            </Button>
          ))}
        </div>

        {/* Sample Preview (visible but marked as sample) */}
        <div className="w-full max-w-lg relative">
          <div className="bg-white rounded-lg p-4 border border-border/50 relative overflow-hidden">
            <img 
              src={previewImages[activePreview]} 
              alt={`${activePreview} preview`}
              className="w-full h-auto opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent flex items-end justify-center pb-4">
              <div className="px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-600 text-xs font-medium flex items-center gap-1.5">
                <Eye className="w-3 h-3" />
                Sample Preview
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-2 gap-3 w-full max-w-md">
          {features.map((feature) => (
            <div 
              key={feature.label}
              className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border/50 hover:bg-secondary/70 transition-colors cursor-pointer"
              onClick={() => setActivePreview(feature.preview)}
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <feature.icon className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">{feature.label}</p>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What You'll Get Section */}
        <div className="w-full max-w-md">
          <div className="text-left mb-3">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Output Files You'll Receive:
            </p>
          </div>
          <div className="bg-secondary/30 rounded-lg p-3 border border-border/50">
            <div className="space-y-2">
              {outputExamples.map((example, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  <code className="text-muted-foreground font-mono">{example}</code>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <Button 
          onClick={() => navigate('/pricing')}
          className="bg-gradient-to-r from-amber-500 to-purple-500 hover:from-amber-600 hover:to-purple-600 text-white font-semibold px-8 group"
        >
          <Crown className="w-4 h-4 mr-2" />
          Unlock Production Mode
          <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
        </Button>

        <p className="text-xs text-muted-foreground">
          Available with Advanced, Complete, or Agency plans
        </p>
      </div>
    </Card>
  );
};