import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

const UserGuide = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>User Guide - How to Use RestyleProAI Vehicle Wrap Design Suite</title>
        <meta name="description" content="Complete guide to the world's first prompt-to-production wrap platform. Learn ColorPro, DesignPro, FadeWraps, and all RestyleProAI tools. Design it. Panel it. Print it." />
        <link rel="canonical" href="https://www.restyleproai.com/user-guide" />
        <meta property="og:title" content="User Guide - RestyleProAI Vehicle Wrap Design Suite" />
        <meta property="og:description" content="Complete guide to using RestyleProAI wrap visualization tools. Step-by-step tutorials for professionals." />
        <meta property="og:url" content="https://www.restyleproai.com/user-guide" />
      </Helmet>

      <main className="flex-1 bg-gradient-to-b from-background to-secondary/20">
        <div className="container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold mb-4">
              <span className="text-foreground">Restyle</span><span className="text-gradient-blue">ProAI™</span>{" "}
              Complete User Guide
            </h1>
            <p className="text-xl text-muted-foreground">
              Professional Vehicle Wrap Design & Visualization Platform
            </p>
          </div>

          {/* Suggested Pricing Tiers */}
          <section className="mb-16">
            <h2 className="text-3xl font-bold mb-8 text-center">Suggested Retail Pricing Tiers</h2>
            <div className="grid md:grid-cols-4 gap-6">
              {/* Free Club */}
              <Card className="border-2 hover:border-primary/50 transition-all">
                <CardHeader>
                  <CardTitle className="text-2xl">RestylePro Club</CardTitle>
                  <CardDescription>Free club membership</CardDescription>
                  <div className="text-4xl font-bold mt-4">$0<span className="text-lg text-muted-foreground">/mo</span></div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>2 renders per month</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Access to InkFusion colors</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Standard quality renders</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Watermarked downloads</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Starter Tier */}
              <Card className="border-2 hover:border-primary/50 transition-all">
                <CardHeader>
                  <CardTitle className="text-2xl">Starter</CardTitle>
                  <CardDescription>Perfect for getting started</CardDescription>
                  <div className="text-4xl font-bold mt-4">$19<span className="text-lg text-muted-foreground">/mo</span></div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span className="font-semibold">5 renders per month</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Access to all RestyleProAI™ tools</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Unwatermarked downloads</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Email support</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pro Tier */}
              <Card className="border-2 border-primary shadow-lg shadow-primary/20 scale-105">
                <CardHeader>
                  <Badge className="w-fit mb-2">MOST POPULAR</Badge>
                  <CardTitle className="text-2xl">Professional</CardTitle>
                  <CardDescription>For wrap shops & installers</CardDescription>
                  <div className="text-4xl font-bold mt-4">$49<span className="text-lg text-muted-foreground">/mo</span></div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span className="font-semibold">50 renders per month</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>All InkFusion colors (50+)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Full WBTY library (92 patterns)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>All FadeWraps gradients</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>RestyleLibrary™ & DesignProAI™ access</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>HD quality renders (1792x1024)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>No watermarks</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Multiple view angles</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Business Tier */}
              <Card className="border-2 hover:border-primary/50 transition-all">
                <CardHeader>
                  <CardTitle className="text-2xl">Business</CardTitle>
                  <CardDescription>For high-volume operations</CardDescription>
                  <div className="text-4xl font-bold mt-4">$149<span className="text-lg text-muted-foreground">/mo</span></div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span className="font-semibold">Unlimited renders</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Everything in Professional</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Custom panel upload (unlimited)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Priority rendering queue</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>Team collaboration (5 seats)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>API access for integrations</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span>White-label option available</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Product Features */}
          <section className="space-y-12">
            <h2 className="text-3xl font-bold mb-8 text-center">Product Features & Pricing</h2>

            {/* InkFusion */}
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                    InkFusion™
                  </span>
                </CardTitle>
                <CardDescription>Premium Solid Color Vinyl Wraps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>• 50 professional colors across 8 families</li>
                      <li>• Available in Gloss, Satin, and Matte finishes</li>
                      <li>• Photorealistic 3D renders</li>
                      <li>• Multiple view angles (Front, Side, Rear, Top)</li>
                      <li>• Instant visualization on any vehicle</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Product Pricing</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Price Per Roll (5ft x 60ft)</span>
                        <span className="font-bold">$650</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Full Vehicle (3-4 rolls)</span>
                        <span className="font-bold">$1,950 - $2,600</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* FadeWraps */}
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                    FadeWraps™
                  </span>
                </CardTitle>
                <CardDescription>Custom Gradient Vinyl Wraps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>• Smooth color gradient transitions</li>
                      <li>• Adjustable gradient scale (30%-300%)</li>
                      <li>• Customizable gradient direction</li>
                      <li>• Gloss, Satin, Matte lamination options</li>
                      <li>• Live preview of gradient effect</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Kit Pricing</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Small Kit - 144×59.5 (2 sides)</span>
                        <span className="font-bold">$600</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Medium Kit - 172×59.5</span>
                        <span className="font-bold">$710</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Large Kit - 200×59.5</span>
                        <span className="font-bold">$825</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>XL Kit - 240×59.5</span>
                        <span className="font-bold">$990</span>
                      </div>
                      <h4 className="font-semibold mt-4 mb-2">Add-ons:</h4>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Hood</span>
                        <span className="font-bold">$160</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Front Bumper</span>
                        <span className="font-bold">$200</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Rear Including Bumper</span>
                        <span className="font-bold">$395</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Small Roof (72x59.5)</span>
                        <span className="font-bold">$160</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Medium Roof (110x59.5)</span>
                        <span className="font-bold">$225</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-secondary/30 rounded text-sm">
                        <span>Large Roof (160x59.5)</span>
                        <span className="font-bold">$330</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* WBTY */}
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                    PatternPro™
                  </span>
                </CardTitle>
                <CardDescription>Premium Pattern Vinyl Wraps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>• 92 unique patterns across 5 categories:</li>
                      <li className="ml-4">- Metal & Marble (18 designs)</li>
                      <li className="ml-4">- Wicked & Wild (18 designs)</li>
                      <li className="ml-4">- Camo & Carbon (18 designs)</li>
                      <li className="ml-4">- Bape Camo (18 designs)</li>
                      <li className="ml-4">- Modern & Trippy (20 designs)</li>
                      <li>• Adjustable pattern scale (30%-300%)</li>
                      <li>• Live tiled preview</li>
                      <li>• Automatic yardage calculator</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Product Pricing</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Price Per Yard (All Patterns)</span>
                        <span className="font-bold">$95.50</span>
                      </div>
                      <div className="p-3 bg-primary/10 rounded mt-4">
                        <p className="text-sm text-muted-foreground">
                          Final price calculated based on vehicle size and coverage needs. 
                          Typical full vehicle wrap: 15-20 yards ($1,432 - $1,910)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* RestyleLibrary & DesignProAI */}
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                    RestyleLibrary™ & DesignProAI™
                  </span>
                </CardTitle>
                <CardDescription>Curated Design Library & AI Design-to-Print System</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>• Upload custom 186" x 56" panel designs</li>
                      <li>• AI-powered design naming</li>
                      <li>• Curated pattern library</li>
                      <li>• Multiple view angles including closeups</li>
                      <li>• Professional-grade renders</li>
                      <li>• Quality rating system</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Kit Pricing</h3>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground mb-3">Same pricing structure as FadeWraps™</p>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Small Kit - 144×59.5 (2 sides)</span>
                        <span className="font-bold">$600</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Medium Kit - 172×59.5</span>
                        <span className="font-bold">$710</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>Large Kit - 200×59.5</span>
                        <span className="font-bold">$825</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/50 rounded">
                        <span>XL Kit - 240×59.5</span>
                        <span className="font-bold">$990</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">Plus add-ons (hood, bumpers, roof) as listed in FadeWraps</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ApproveMode */}
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  <span className="bg-gradient-to-r from-[#FF2DA1] via-[#B620E0] to-[#6A00FF] text-transparent bg-clip-text">
                    ApproveMode™
                  </span>
                </CardTitle>
                <CardDescription>Before/After Design Showcase</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>• Curated before/after examples</li>
                      <li>• Professional showcase gallery</li>
                      <li>• Design comparison views</li>
                      <li>• Client presentation mode</li>
                      <li>• Portfolio building tool</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-3">Usage</h3>
                    <div className="p-3 bg-secondary/50 rounded">
                      <p className="text-muted-foreground">
                        ApproveMode is included in all subscription tiers and serves as a 
                        powerful sales and portfolio tool for showcasing your work to clients.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Generation Limits Summary */}
          <section className="mt-16">
            <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
              <CardHeader>
                <CardTitle className="text-2xl text-center">Generation Limits Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3">Feature</th>
                        <th className="text-center p-3">Starter</th>
                        <th className="text-center p-3">Professional</th>
                        <th className="text-center p-3">Business</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      <tr className="border-b">
                        <td className="p-3">Total Renders/Month</td>
                        <td className="text-center p-3">5</td>
                        <td className="text-center p-3">100</td>
                        <td className="text-center p-3">Unlimited</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">View Angles per Render</td>
                        <td className="text-center p-3">1 (Hero only)</td>
                        <td className="text-center p-3">4 (All angles)</td>
                        <td className="text-center p-3">4 (All angles)</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">InkFusion Colors</td>
                        <td className="text-center p-3">All 50</td>
                        <td className="text-center p-3">All 50</td>
                        <td className="text-center p-3">All 50</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">WBTY Patterns</td>
                        <td className="text-center p-3">10 designs</td>
                        <td className="text-center p-3">All 92</td>
                        <td className="text-center p-3">All 92</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">FadeWraps</td>
                        <td className="text-center p-3">Limited</td>
                        <td className="text-center p-3">All gradients</td>
                        <td className="text-center p-3">All gradients</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">RestyleLibrary / DesignProAI</td>
                        <td className="text-center p-3">❌</td>
                        <td className="text-center p-3">✓ (Curated only)</td>
                        <td className="text-center p-3">✓ (Custom upload)</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">Custom Panel Uploads</td>
                        <td className="text-center p-3">❌</td>
                        <td className="text-center p-3">❌</td>
                        <td className="text-center p-3">Unlimited</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-3">Render Quality</td>
                        <td className="text-center p-3">Standard</td>
                        <td className="text-center p-3">HD (1792x1024)</td>
                        <td className="text-center p-3">HD (1792x1024)</td>
                      </tr>
                      <tr>
                        <td className="p-3">Watermark</td>
                        <td className="text-center p-3">Yes</td>
                        <td className="text-center p-3">No</td>
                        <td className="text-center p-3">No</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Best Practices */}
          <section className="mt-16">
            <h2 className="text-3xl font-bold mb-8 text-center">Best Practices</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>For Best Render Quality</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Use accurate vehicle year, make, and model</li>
                    <li>• For RestyleLibrary / DesignProAI: Upload flat 2D panels on neutral backgrounds</li>
                    <li>• Select appropriate finish (Gloss/Satin/Matte) for accurate reflection</li>
                    <li>• Allow 30-60 seconds for high-quality render generation</li>
                    <li>• Download additional views for complete client presentations</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Client Presentation Tips</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Show multiple view angles to demonstrate full coverage</li>
                    <li>• Use ApproveMode for side-by-side comparisons</li>
                    <li>• Provide pricing breakdown with kit + add-ons</li>
                    <li>• Save renders to gallery for portfolio building</li>
                    <li>• Use full-screen view mode for maximum impact</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>

    </div>
  );
};

export default UserGuide;
