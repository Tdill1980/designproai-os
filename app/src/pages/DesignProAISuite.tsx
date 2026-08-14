import { Helmet } from "react-helmet-async";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Palette, Layers, Image, Eye, Sparkles, Lock, Check, Car, Camera, FileText, LayoutDashboard, Package, Store, GitBranch, Zap, ArrowRight } from "lucide-react";
import { useToolAccess } from "@/hooks/useToolAccess";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PricingCard } from "@/components/PricingCard";
import { Badge } from "@/components/ui/badge";

const tools = [
  {
    id: 'colorpro',
    name: 'ColorPro™',
    description: 'Visualize InkFusion™, Avery & 3M Films on any vehicle with photorealistic 3D renders',
    icon: Palette,
    href: '/colorpro',
    color: 'from-blue-400 via-blue-500 to-blue-600',
    carouselTable: 'inkfusion_carousel',
    tier: 'Starter',
    price: '$19/mo'
  },
  {
    id: 'designpanelpro',
    name: 'RestyleLibrary™',
    description: 'Professional wrap design library with curated panels and Universal Panelizer production packs',
    icon: Sparkles,
    href: '/restylelibrary',
    color: 'from-purple-400 via-pink-500 to-red-500',
    carouselTable: 'designpanelpro_carousel',
    tier: 'Business',
    price: '$149/mo'
  },
  {
    id: 'fadewraps',
    name: 'FadeWraps™',
    description: 'Create stunning gradient and fade effects with customizable direction and scale',
    icon: Layers,
    href: '/designpro',
    color: 'from-orange-400 via-red-500 to-pink-500',
    carouselTable: 'fadewraps_carousel',
    tier: 'Professional',
    price: '$49/mo'
  },
  {
    id: 'wbty',
    name: 'PatternPro™',
    description: 'Wrap By The Yard - Visualize specialty patterns and materials before installation',
    icon: Image,
    href: '/wbty',
    color: 'from-green-400 via-blue-500 to-blue-500',
    carouselTable: 'wbty_carousel',
    tier: 'Professional',
    price: '$49/mo'
  },
  {
    id: 'approvemode',
    name: 'ApprovePro™',
    description: 'Transform 2D design proofs into 3D renders for client approval',
    icon: Eye,
    href: '/approvemode',
    color: 'from-indigo-400 via-purple-500 to-pink-500',
    carouselTable: 'approvemode_carousel',
    tier: 'Business',
    price: '$149/mo'
  },
  {
    id: 'myrenders',
    name: 'My Renders',
    description: 'Your personal library with shareable URLs & QR codes. Tag and filter renders to send specific collections to clients',
    icon: Car,
    href: '/my-renders',
    color: 'from-amber-400 via-orange-500 to-red-500',
    carouselTable: null,
    tier: 'All Tiers',
    price: 'Included'
  }
];

const anchorTools = [
  {
    name: 'MyVehiclePro™',
    description: 'Upload YOUR vehicle photos. AI detects make, model & year - then renders wraps directly on your actual car. Works across ColorPro, DesignPro & more.',
    icon: Camera,
    gradient: 'from-blue-400 via-blue-500 to-indigo-600',
    badge: 'Included',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30'
  },
  {
    name: 'RevisionStudioIQ™',
    description: 'Version timeline, Clone & Revise workflow, Design Equity gallery, VisionBoardIQ reference uploads, and 200+ AI prompt presets.',
    icon: GitBranch,
    href: '/revision-studio',
    gradient: 'from-[#FF2DA1] via-[#B620E0] to-[#6A00FF]',
    badge: 'Anchor Tool',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  },
  {
    name: 'PDF Proofs',
    description: 'Generate professional before & after proof sheets with vehicle info, color specs, and your branding - ready to send to clients or print.',
    icon: FileText,
    gradient: 'from-emerald-400 via-green-500 to-blue-600',
    badge: 'Included',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  },
  {
    name: 'DesignDashBoard',
    description: 'Your command center for all active projects, render queues, revision history, and client approvals - all in one unified view.',
    icon: LayoutDashboard,
    gradient: 'from-amber-400 via-orange-500 to-red-500',
    badge: 'Coming Soon',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  },
  {
    name: 'WrapBox',
    description: 'Package and deliver complete wrap projects - renders, proofs, panel layouts, and install specs bundled into one shareable deliverable.',
    icon: Package,
    gradient: 'from-rose-400 via-pink-500 to-fuchsia-600',
    badge: 'Coming Soon',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30'
  },
  {
    name: 'CreatorMarket',
    description: 'Sell your original wrap designs, panel packs, and templates to the RestylePro community. Turn design equity into revenue.',
    icon: Store,
    gradient: 'from-violet-400 via-purple-500 to-indigo-600',
    badge: 'Coming Soon',
    badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30'
  }
];

const ToolCard = ({ tool }: { tool: typeof tools[0] }) => {
  const { hasAccess } = useToolAccess(tool.id);
  const Icon = tool.icon;

  const { data: exampleImage } = useQuery({
    queryKey: ['tool-example', tool.carouselTable],
    queryFn: async () => {
      const tableName = tool.carouselTable;

      // Skip query if no carousel table
      if (!tableName) return null;

      if (tableName === 'inkfusion_carousel') {
        const { data } = await supabase
          .from('inkfusion_carousel')
          .select('media_url, title, subtitle')
          .eq('is_active', true)
          .order('sort_order')
          .limit(1)
          .single();
        return data;
      } else if (tableName === 'designpanelpro_carousel') {
        const { data } = await supabase
          .from('designpanelpro_carousel')
          .select('media_url, title, subtitle')
          .eq('is_active', true)
          .order('sort_order')
          .limit(1)
          .single();
        return data;
      } else if (tableName === 'fadewraps_carousel') {
        const { data } = await supabase
          .from('fadewraps_carousel')
          .select('media_url, title, subtitle')
          .eq('is_active', true)
          .order('sort_order')
          .limit(1)
          .single();
        return data;
      } else if (tableName === 'wbty_carousel') {
        const { data } = await supabase
          .from('wbty_carousel')
          .select('media_url, title, subtitle')
          .eq('is_active', true)
          .order('sort_order')
          .limit(1)
          .single();
        return data;
      } else if (tableName === 'approvemode_carousel') {
        const { data } = await supabase
          .from('approvemode_carousel')
          .select('media_url, title, subtitle')
          .eq('is_active', true)
          .order('sort_order')
          .limit(1)
          .single();
        return data;
      }
      return null;
    },
    enabled: !!tool.carouselTable
  });

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Link to={tool.href}>
          <Card className="group relative overflow-hidden transition-all hover:shadow-xl border-border cursor-pointer">
          <div className={`absolute inset-0 bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-10 transition-opacity`} />

          <div className="p-6 relative space-y-4">
            <div className="flex items-start justify-between">
              <div className={`rounded-full p-3 bg-gradient-to-br ${tool.color} text-white`}>
                <Icon className="w-6 h-6" />
              </div>
              {hasAccess ? (
                <div className="flex items-center gap-1 text-sm text-primary font-medium">
                  <Check className="w-4 h-4" />
                  <span>Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Lock className="w-4 h-4" />
                  <span>Locked</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">
                {tool.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {tool.description}
              </p>
            </div>

            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-muted-foreground">Required Tier</div>
                <div className="text-sm font-semibold text-foreground">{tool.tier}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Pricing</div>
                <div className="text-sm font-semibold text-foreground">{tool.price}</div>
              </div>
            </div>

            <Button
              className={`w-full ${hasAccess ? 'bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 hover:opacity-90 text-white font-bold' : 'bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 hover:opacity-90 text-white font-bold'}`}
            >
              {hasAccess ? 'Launch Tool' : 'Try Free'}
            </Button>
          </div>
        </Card>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-96 p-0 overflow-hidden border-2 border-primary/20 shadow-2xl" side="top" sideOffset={8}>
        {exampleImage ? (
          <div className="relative">
            <img
              src={exampleImage.media_url}
              alt={exampleImage.title || tool.name}
              className="w-full h-64 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
              <h4 className="font-bold text-xl mb-1">{exampleImage.title || tool.name}</h4>
              {exampleImage.subtitle && (
                <p className="text-sm text-white/95 leading-relaxed">{exampleImage.subtitle}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full h-64 bg-muted flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Loading preview...</p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};

const DesignProAISuite = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>DesignPro AI Suite - Complete Vehicle Wrap Design Tools | RestyleProAI</title>
        <meta name="description" content="The world's first prompt-to-production vehicle wrap design software. From wrap design prompt to print-ready production. Design it. Panel it. Print it. ColorPro, DesignPro, FadeWraps, GraphicsPro - all in one platform." />
        <link rel="canonical" href="https://www.restyleproai.com/tools" />
        <meta property="og:title" content="DesignPro AI Suite - Complete Wrap Design Tools | RestyleProAI" />
        <meta property="og:description" content="All RestyleProAI design tools in one place. Professional vehicle wrap design powered by AI." />
        <meta property="og:url" content="https://www.restyleproai.com/tools" />
      </Helmet>

      <main className="flex-1">
        {/* ========== HERO - ABOVE THE FOLD ========== */}
        <section className="relative overflow-hidden">
          {/* Purple gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a0030] via-[#0d001a] to-black" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(182,32,224,0.25)_0%,_rgba(106,0,255,0.15)_30%,_transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(255,45,161,0.1)_0%,_transparent_50%)]" />

          <div className="relative container mx-auto px-4 pt-16 pb-20">
            <div className="max-w-5xl mx-auto text-center space-y-8">
              {/* Meet ACE & Sprocket */}
              <div className="flex justify-center mb-2">
                <img
                  src="/sprocket/meet-ace-and-sprocket.png"
                  alt="Meet ACE & Sprocket"
                  className="w-40 h-40 sm:w-48 sm:h-48 object-contain drop-shadow-[0_0_24px_rgba(168,85,247,0.4)]"
                  style={{ animation: 'float 3s ease-in-out infinite' }}
                />
              </div>

              {/* World's First badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-purple-500/30 bg-purple-500/10 backdrop-blur-sm">
                <Zap className="w-4 h-4 text-[#FF2DA1]" />
                <span className="text-sm font-semibold bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                  World's First - Prompt to Print Production Platform
                </span>
                <Zap className="w-4 h-4 text-[#6A00FF]" />
              </div>

              {/* Main headline */}
              <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold leading-tight tracking-tight">
                <span className="text-white">Design</span>
                <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">ProAI</span>
                <span className="text-white/40 text-[0.6em] align-super ml-1">™</span>
              </h1>

              {/* Tagline */}
              <p className="text-xl sm:text-2xl md:text-3xl font-semibold text-white/90 max-w-4xl mx-auto leading-snug">
                The World's First{' '}
                <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text font-bold">
                  Prompt to Print
                </span>{' '}
                Production Vehicle Wrap Design Tool
              </p>

              {/* Sub-description */}
              <p className="text-lg text-white/60 max-w-3xl mx-auto">
                AI-powered 3D visualization, version-controlled design revisions, professional proof generation,
                and print-ready production output - all in one platform built for wrap professionals.
              </p>

              {/* CTA buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <Button asChild size="lg" className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] hover:opacity-90 text-white font-bold text-lg px-8 py-6 shadow-[0_0_30px_rgba(182,32,224,0.4)]">
                  <Link to="/colorpro">
                    Start Designing <ArrowRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="border-purple-500/30 text-white hover:bg-purple-500/10 text-lg px-8 py-6">
                  <Link to="/gallery">
                    View Gallery
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ========== ANCHOR TOOLS & PLATFORM BENEFITS ========== */}
        <section className="relative border-t border-purple-500/20">
          <div className="absolute inset-0 bg-gradient-to-b from-[#0d001a] via-background to-background" />

          <div className="relative container mx-auto px-4 py-16">
            <div className="max-w-6xl mx-auto space-y-10">
              {/* Section header */}
              <div className="text-center space-y-3">
                <h2 className="text-3xl md:text-4xl font-bold">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">Platform</span>
                  <span className="text-foreground"> Benefits</span>
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  Every subscription includes powerful tools that no other wrap platform offers
                </p>
              </div>

              {/* Anchor tool / benefit cards */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {anchorTools.map((item) => {
                  const Icon = item.icon;
                  const inner = (
                    <Card key={item.name} className="group relative overflow-hidden border-border hover:border-purple-500/30 transition-all hover:shadow-[0_0_30px_rgba(182,32,224,0.15)] cursor-pointer">
                      <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
                      <div className="p-6 relative space-y-4">
                        <div className="flex items-start justify-between">
                          <div className={`rounded-xl p-3 bg-gradient-to-br ${item.gradient} text-white shadow-lg`}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <Badge variant="outline" className={`${item.badgeColor} text-xs font-semibold`}>
                            {item.badge}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-lg font-bold text-foreground group-hover:text-white transition-colors">
                            {item.name}
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </Card>
                  );

                  if (item.href) {
                    return <Link key={item.name} to={item.href}>{inner}</Link>;
                  }
                  return <div key={item.name}>{inner}</div>;
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ========== VISUALIZATION TOOLS GRID ========== */}
        <section className="container mx-auto px-4 py-16">
          <div className="max-w-6xl mx-auto space-y-12">
            <div className="text-center space-y-3">
              <h2 className="text-3xl md:text-4xl font-bold">
                <span className="text-foreground">Restyle</span>
                <span className="text-gradient-blue">ProAI™</span>
                <span className="text-foreground"> Visualization Tools</span>
              </h2>
              <p className="text-muted-foreground text-lg">
                Professional 3D wrap visualization - from concept to client-ready render
              </p>
            </div>

            {/* Tools Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>

            {/* Pricing Tiers */}
            <div className="space-y-12 pt-12">
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">Choose</span>
                  <span className="text-foreground"> Your Plan</span>
                </h2>
                <p className="text-muted-foreground">
                  Select the tier that fits your business needs
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <PricingCard
                  title="Starter"
                  price={19}
                  features={[
                    "10 renders per month",
                    "ColorPro™ access",
                    "MyVehiclePro™ included",
                    "PDF Proofs included",
                    "Basic vehicle library",
                    "HD quality renders",
                    "Email support"
                  ]}
                />
                <PricingCard
                  title="Professional"
                  price={49}
                  isPopular={true}
                  features={[
                    "50 renders per month",
                    "All Starter features",
                    "FadeWraps™ access",
                    "WBTY™ access",
                    "RevisionStudioIQ™ access",
                    "Extended vehicle library",
                    "Priority support"
                  ]}
                />
                <PricingCard
                  title="Business"
                  price={149}
                  features={[
                    "200 renders per month",
                    "All Professional features",
                    "RestyleLibrary™ & DesignProAI™ access",
                    "ApproveMode™ access",
                    "DesignDashBoard access",
                    "WrapBox deliverables",
                    "Dedicated support"
                  ]}
                />
              </div>
            </div>
          </div>
        </section>
      </main>

    </div>
  );
};

export default DesignProAISuite;
