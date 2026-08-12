import { Helmet } from "react-helmet-async";
import { SEOBreadcrumb } from "@/components/SEOBreadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { 
  Truck, 
  Eye, 
  Palette, 
  Layers, 
  Grid3X3, 
  ArrowRight, 
  CheckCircle2,
  Clock,
  DollarSign,
  Users,
  Sparkles
} from "lucide-react";

const FleetServices = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Fleet Services | RestyleProAI™ Vehicle Wrap Design Suite</title>
        <meta name="description" content="Streamline fleet vehicle wrapping with the world's first prompt-to-production wrap software. One design, any vehicle. Trucks, vans, cars. Design it. Panel it. Print it." />
      </Helmet>
      <SEOBreadcrumb items={[{ name: "Home", path: "/" }, { name: "Fleet Services", path: "/fleet" }]} />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-background to-amber-500/10" />
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-4xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 bg-orange-500/20 border border-orange-500/30 rounded-full px-4 py-2 mb-6">
                <Truck className="w-5 h-5 text-orange-400" />
                <span className="text-sm font-medium text-orange-300">Fleet Wrapping Solutions</span>
              </div>
              
              <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
                One Design. <span className="text-orange-400">Any Vehicle.</span>
                <br />
                <span className="text-gradient-blue">Unlimited Fleet.</span>
              </h1>
              
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Your client just added a new truck to their fleet? Show them how their existing branding 
                looks on the new vehicle - in seconds, not hours.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg" variant="gradient" className="px-8">
                  <Link to="/approvemode">
                    <Eye className="w-5 h-5 mr-2" />
                    Try ApprovePro™ Free
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/colorpro">
                    <Palette className="w-5 h-5 mr-2" />
                    Explore All Tools
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Problem/Solution Section */}
        <section className="py-16 bg-secondary/30">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div>
                  <h2 className="text-3xl font-bold text-foreground mb-4">
                    The Fleet Expansion Challenge
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    When your client expands their fleet, they need to see how their existing branding 
                    will look on completely different vehicles. Traditional methods mean hours of 
                    redesign work for every new vehicle type.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 text-muted-foreground">
                      <Clock className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                      <span>Hours spent recreating designs for each new vehicle</span>
                    </div>
                    <div className="flex items-start gap-3 text-muted-foreground">
                      <DollarSign className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                      <span>Lost revenue from slow approval processes</span>
                    </div>
                    <div className="flex items-start gap-3 text-muted-foreground">
                      <Users className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                      <span>Frustrated clients waiting for visualizations</span>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/30 rounded-2xl p-8">
                  <h3 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-orange-400" />
                    The RestylePro Solution
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">Upload ONE existing design</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">Enter ANY vehicle make & model</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">Get photorealistic 3D renders instantly</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">Generate 360° spin views for client approval</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Real Before/After Fleet Example */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-3xl font-bold text-foreground text-center mb-4">
                Same Design. Different Vehicle. <span className="text-orange-400">Real Results.</span>
              </h2>
              <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
                See how we helped a client visualize their existing van design on a new truck - in under 60 seconds.
              </p>
              
              <div className="grid md:grid-cols-2 gap-8">
                {/* Original Van */}
                <Card className="overflow-hidden bg-card border-border">
                  <div className="aspect-video relative">
                    <img 
                      src="https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/approvemode/1764659850233_Ford%20_Transit%20_hero.png"
                      alt="2018 Ford Transit with floral wrap"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 left-4">
                      <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                        ORIGINAL VEHICLE
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-foreground">2018 Ford Transit</h3>
                    <p className="text-sm text-muted-foreground">Client's existing wrapped van</p>
                  </div>
                </Card>
                
                {/* New Truck - Same Design */}
                <Card className="overflow-hidden bg-card border-orange-500/50 ring-2 ring-orange-500/30">
                  <div className="aspect-video relative">
                    <img 
                      src="https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/approvemode/1764698877854_Ford%20_F%20250%20Extended%20Cab%20Truck%20_hero.png"
                      alt="Ford F-250 with same floral wrap"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 left-4">
                      <span className="bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                        NEW FLEET ADDITION
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-foreground">Ford F-250 Extended Cab</h3>
                    <p className="text-sm text-muted-foreground">Same branding, visualized in seconds</p>
                  </div>
                </Card>
              </div>
              
              <p className="text-center mt-8 text-muted-foreground">
                ↑ Real customer workflow: Upload ONE design → Visualize on ANY vehicle
              </p>
            </div>
          </div>
        </section>

        {/* Tools for Fleet */}
        <section className="py-16 bg-secondary/30">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-3xl font-bold text-foreground text-center mb-4">
                Tools Built for Fleet Wrapping
              </h2>
              <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
                Every tool in RestyleProAI™ Vehicle Wrap Design Suite is optimized for fleet businesses
              </p>
              
              <div className="grid md:grid-cols-2 gap-6">
                {/* ApprovePro */}
                <Link to="/approvemode" className="group">
                  <Card className="p-6 h-full bg-card border-border hover:border-orange-500/50 transition-all hover:scale-[1.02]">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Eye className="w-6 h-6 text-orange-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">
                          <span className="text-foreground">Approve</span>
                          <span className="text-gradient-blue">Pro™</span>
                          <span className="ml-2 text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">FLEET FAVORITE</span>
                        </h3>
                        <p className="text-muted-foreground mb-3">
                          Upload one design, render on any vehicle. Perfect for showing clients 
                          how their existing branding looks on new fleet additions.
                        </p>
                        <span className="text-orange-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                          Try ApprovePro <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>

                {/* ColorPro */}
                <Link to="/colorpro" className="group">
                  <Card className="p-6 h-full bg-card border-border hover:border-blue-500/50 transition-all hover:scale-[1.02]">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Palette className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">
                          <span className="text-foreground">Color</span>
                          <span className="text-gradient-blue">Pro™</span>
                        </h3>
                        <p className="text-muted-foreground mb-3">
                          Visualize color change wraps on any fleet vehicle. 
                          Show clients uniform brand colors across trucks, vans, and cars.
                        </p>
                        <span className="text-blue-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                          Try ColorPro <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>

                {/* RestyleLibrary */}
                <Link to="/restylelibrary" className="group">
                  <Card className="p-6 h-full bg-card border-border hover:border-purple-500/50 transition-all hover:scale-[1.02]">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Layers className="w-6 h-6 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">
                          <span className="text-foreground">Restyle</span>
                          <span className="text-gradient-blue">Library™</span>
                        </h3>
                        <p className="text-muted-foreground mb-3">
                          Apply branded panel designs across entire fleets.
                          Perfect for consistent vehicle graphics on multiple vehicle types.
                        </p>
                        <span className="text-purple-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                          Try DesignProAI <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>

                {/* PatternPro */}
                <Link to="/wbty" className="group">
                  <Card className="p-6 h-full bg-card border-border hover:border-green-500/50 transition-all hover:scale-[1.02]">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Grid3X3 className="w-6 h-6 text-green-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">
                          <span className="text-foreground">Pattern</span>
                          <span className="text-gradient-blue">Pro™</span>
                        </h3>
                        <p className="text-muted-foreground mb-3">
                          Visualize custom patterns and textures on fleet vehicles. 
                          Show clients how carbon fiber or custom prints look on their trucks.
                        </p>
                        <span className="text-green-400 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                          Try PatternPro <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case Example */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <Card className="p-8 bg-gradient-to-br from-background to-secondary/50 border-border">
                <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
                  💡 Real Fleet Scenario
                </h2>
                
                <div className="bg-secondary/50 rounded-lg p-6 mb-6">
                  <p className="text-foreground italic mb-4">
                    "My client's plumbing company has 3 wrapped vans. They just bought a Ford F-250 
                    work truck and need to see how the same branding will look on it before committing 
                    to the install."
                  </p>
                  <p className="text-sm text-muted-foreground">- Common wrap shop scenario</p>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-foreground">With RestylePro:</h3>
                  <ol className="space-y-3 text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                      <span>Upload the existing van design proof (2 seconds)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                      <span>Type "2024 Ford F-250" as the target vehicle (3 seconds)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
                      <span>Generate photorealistic 3D renders with 360° views (~30 seconds)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">4</span>
                      <span>Send professional PDF proof to client for instant approval</span>
                    </li>
                  </ol>
                </div>

                <div className="mt-8 text-center">
                  <p className="text-lg font-semibold text-orange-400 mb-4">
                    Total time: Under 1 minute
                  </p>
                  <Button asChild size="lg" variant="gradient">
                    <Link to="/approvemode">
                      Try This Workflow Now
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-gradient-to-r from-orange-500/10 to-amber-500/10">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Ready to Streamline Your Fleet Work?
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Stop spending hours on redesigns. Show clients their branding on any new vehicle instantly.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg" variant="gradient" className="px-8">
                  <Link to="/signup">
                    Get Started Free
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/gallery">
                    View Fleet Examples
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

    </div>
  );
};

export default FleetServices;
