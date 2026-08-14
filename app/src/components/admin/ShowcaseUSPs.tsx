import { Badge } from "@/components/ui/badge";
import {
  Palette, Layers, Scissors, Sparkles, Package,
  CheckCircle2, ImageIcon, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolCard {
  name: string;
  tagline: string;
  icon: React.ReactNode;
  gradient: string;
  badgeColor: string;
}

const TOOL_CARDS: ToolCard[] = [
  {
    name: "ColorPro\u2122",
    tagline: "Visualize any color on any vehicle in seconds",
    icon: <Palette className="w-8 h-8" />,
    gradient: "from-cyan-500 to-blue-600",
    badgeColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  },
  {
    name: "DesignProAI\u2122",
    tagline: "World's First AI Prompt-to-Print Design System",
    icon: <Sparkles className="w-8 h-8" />,
    gradient: "from-purple-500 to-pink-600",
    badgeColor: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  },
  {
    name: "GENIE Production Panelizer OS",
    tagline: "Design-to-Print Production Files",
    icon: <Layers className="w-8 h-8" />,
    gradient: "from-blue-500 to-indigo-600",
    badgeColor: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  },
  {
    name: "FadeWraps\u2122",
    tagline: "Professional fade and gradient designs",
    icon: <Zap className="w-8 h-8" />,
    gradient: "from-orange-500 to-red-600",
    badgeColor: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  },
  {
    name: "Cut Contour Logo Pack",
    tagline: "AI-extracted vector cut files",
    icon: <Scissors className="w-8 h-8" />,
    gradient: "from-green-500 to-emerald-600",
    badgeColor: "bg-green-500/20 text-green-400 border-green-500/40",
  },
  {
    name: "ApprovePro\u2122",
    tagline: "Customer approval workflow",
    icon: <CheckCircle2 className="w-8 h-8" />,
    gradient: "from-blue-400 to-cyan-500",
    badgeColor: "bg-blue-400/20 text-blue-300 border-blue-400/40",
  },
  {
    name: "GraphicsPro\u2122",
    tagline: "AI graphic wrap designs",
    icon: <ImageIcon className="w-8 h-8" />,
    gradient: "from-pink-500 to-rose-600",
    badgeColor: "bg-pink-500/20 text-pink-400 border-pink-500/40",
  },
];

export function ShowcaseUSPs() {
  return (
    <div className="space-y-10">
      {/* Hero banner */}
      <div className="text-center py-12 px-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-950 to-black border border-zinc-800">
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
          DesignProAI Visualizer Suite
        </h1>
        <p className="text-lg md:text-xl text-cyan-400 font-medium max-w-3xl mx-auto">
          World's First Prompt-to-Print Production Design Software System
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-cyan-500/50" />
          <Sparkles className="w-5 h-5 text-cyan-500" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyan-500/50" />
        </div>
      </div>

      {/* Tool cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {TOOL_CARDS.map((tool) => (
          <div
            key={tool.name}
            className="group relative rounded-xl bg-zinc-900 border border-zinc-800 p-6 hover:border-zinc-600 transition-all"
          >
            {/* Gradient accent top */}
            <div className={cn(
              "absolute inset-x-0 top-0 h-1 rounded-t-xl bg-gradient-to-r",
              tool.gradient
            )} />

            <div className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br",
              tool.gradient
            )}>
              <span className="text-white">{tool.icon}</span>
            </div>

            <h3 className="text-lg font-bold text-white mb-2">{tool.name}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">{tool.tagline}</p>

            <Badge className={cn("mt-4 text-[10px] border", tool.badgeColor)}>
              Included
            </Badge>
          </div>
        ))}
      </div>

      {/* Bottom tagline */}
      <div className="text-center py-8">
        <p className="text-zinc-500 text-sm">
          Powered by AI &middot; Built for Wrap Professionals &middot; Print-Ready Output
        </p>
      </div>
    </div>
  );
}
