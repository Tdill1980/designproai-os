import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Play, CheckCircle2, XCircle, Download, Eye, History } from "lucide-react";
import { Link } from "react-router-dom";

interface TestCase {
  id: number;
  name: string;
  mode: "commercial" | "design" | "restyle";
  surfaceType: "vehicle" | "wall" | "glass" | "surface";
  year: string;
  make: string;
  model: string;
  zones: Array<{ id: string; label: string; content: string }>;
  businessName: string;
  phone: string;
  website: string;
  industry: string;
  tagline: string;
  copyText: string;
  font: string;
  designPrompt: string;
  vinylFinish: string;
  restylePrompt?: string;
  surfaceImageUrl?: string;
  // Wall/glass specific
  wallTexture?: string;
  indoor?: boolean;
  glassType?: string;
  glassMount?: string;
}

interface RenderJob {
  testId: number;
  style: string;
  status: "pending" | "running" | "done" | "error";
  mockupUrl?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

const TEST_CASES: TestCase[] = [
  // === COMMERCIAL MODE ===
  {
    id: 1, name: "Construction Truck", surfaceType: "vehicle", mode: "commercial", year: "2024", make: "Ford", model: "F-250",
    zones: [
      { id: "zone-door", label: "Door", content: "logo + name" },
      { id: "zone-side-panel", label: "Side Panel", content: "phone + website" },
      { id: "zone-tailgate", label: "Tailgate", content: "logo only" },
    ],
    businessName: "Titan Construction Co.", phone: "(555) 867-5309", website: "titanconstruction.com",
    industry: "Construction", tagline: "Building Tomorrow Today",
    copyText: "Licensed & Insured, Lic #CA-98765, Free Estimates", font: "Oswald",
    designPrompt: "Rugged construction truck with hard hat icon, bold black and safety yellow",
    vinylFinish: "matte",
  },
  {
    id: 2, name: "Plumber Van", surfaceType: "vehicle", mode: "commercial", year: "2023", make: "Mercedes-Benz", model: "Sprinter",
    zones: [
      { id: "zone-door", label: "Door", content: "logo + name" },
      { id: "zone-side-panel", label: "Side Panel", content: "full contact" },
    ],
    businessName: "AquaFlow Plumbing", phone: "(555) 234-5678", website: "aquaflowplumbing.com",
    industry: "Plumbing", tagline: "Flow With Confidence",
    copyText: "24/7 Emergency Service, Licensed Master Plumber", font: "Inter",
    designPrompt: "Clean plumbing company with water drop icon, blue and white, professional",
    vinylFinish: "glossy",
  },
  {
    id: 3, name: "Electrician Van", surfaceType: "vehicle", mode: "commercial", year: "2023", make: "Ford", model: "Transit",
    zones: [
      { id: "zone-door", label: "Door", content: "logo + name" },
      { id: "zone-side-panel", label: "Side Panel", content: "phone + website" },
      { id: "zone-rear-window", label: "Rear Window", content: "license + certs" },
    ],
    businessName: "Volt Electric Services", phone: "(555) 456-7890", website: "voltelectric.com",
    industry: "Electrical", tagline: "Powering Your World",
    copyText: "Master Electrician Lic #EL-44321, Commercial & Residential", font: "Bebas Neue",
    designPrompt: "Electrical contractor with lightning bolt, dark gray and safety orange, tough",
    vinylFinish: "matte",
  },
  // === DESIGN MODE (custom art, no business fields) ===
  {
    id: 4, name: "Race Truck Flames", surfaceType: "vehicle", mode: "design", year: "2024", make: "Chevrolet", model: "Silverado",
    zones: [
      { id: "zone-side-panel", label: "Side Panel", content: "accent stripe" },
      { id: "zone-hood", label: "Hood", content: "logo only" },
      { id: "zone-tailgate", label: "Tailgate", content: "accent stripe" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Aggressive tribal flame pattern flowing from front fender to tailgate, matte black and orange metallic, racing-inspired with sharp angular edges",
    vinylFinish: "matte",
  },
  {
    id: 5, name: "Stealth Military SUV", surfaceType: "vehicle", mode: "design", year: "2024", make: "Jeep", model: "Wrangler",
    zones: [
      { id: "zone-door", label: "Door", content: "accent stripe" },
      { id: "zone-hood", label: "Hood", content: "logo only" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Military-inspired stealth graphics with tactical star emblem on doors, matte olive drab and flat black geometric camo pattern across hood, subdued and aggressive",
    vinylFinish: "matte",
  },
  // === RESTYLE MODE (modernize existing design) ===
  {
    id: 6, name: "Restyle Food Truck", surfaceType: "vehicle", mode: "restyle", year: "2022", make: "Ford", model: "E-450",
    zones: [
      { id: "zone-side-panel", label: "Side Panel", content: "logo + name" },
      { id: "zone-rear-window", label: "Rear", content: "phone + website" },
    ],
    businessName: "Taco Loco", phone: "(555) 555-TACO", website: "tacoloco.com",
    industry: "Food Service", tagline: "Authentic Street Tacos",
    copyText: "Catering Available, Follow us @tacoloco", font: "Lobster",
    designPrompt: "Modernize with vibrant Mexican colors, hand-drawn taco illustration, playful but professional",
    restylePrompt: "Make the lettering bolder and more modern, add a fun taco character mascot, keep the warm colors but make them pop more",
    vinylFinish: "glossy",
  },
  {
    id: 7, name: "Restyle HVAC Van", surfaceType: "vehicle", mode: "restyle", year: "2023", make: "Ram", model: "ProMaster",
    zones: [
      { id: "zone-door", label: "Door", content: "logo + name" },
      { id: "zone-side-panel", label: "Side Panel", content: "full contact" },
    ],
    businessName: "Arctic Air HVAC", phone: "(555) 222-COOL", website: "arcticairhvac.com",
    industry: "HVAC", tagline: "Your Comfort, Our Mission",
    copyText: "Heating, Cooling, Ventilation, 24/7 Service, EPA Certified", font: "Montserrat",
    designPrompt: "Clean professional HVAC company, ice blue and silver color scheme, snowflake/flame dual icon",
    restylePrompt: "Modernize the old-fashioned look, make it sleek and tech-forward, clean lines, keep the ice blue but add a gradient to silver",
    vinylFinish: "satin",
  },
  // === UPLOAD MODE (user's own photo, commercial graphics applied) ===
  {
    id: 8, name: "Upload: F-250 Tremor", surfaceType: "vehicle", mode: "commercial", year: "2024", make: "Ford", model: "F-250 Tremor",
    surfaceImageUrl: "/hero-mustang.jpg", // placeholder — swap with actual uploaded truck photo URL
    zones: [
      { id: "zone-door", label: "Door", content: "logo + name" },
      { id: "zone-side-panel", label: "Side Panel", content: "phone + website" },
      { id: "zone-tailgate", label: "Tailgate", content: "website only" },
    ],
    businessName: "Titan Construction Co.", phone: "(555) 867-5309", website: "titanconstruction.com",
    industry: "Construction", tagline: "Building Tomorrow Today",
    copyText: "Licensed & Insured, Free Estimates", font: "Oswald",
    designPrompt: "Bold construction company graphics, black and safety yellow, rugged professional look",
    vinylFinish: "matte",
  },
  // === RACE / AUTOMOTIVE DESIGN ===
  {
    id: 9, name: "Charger Scat Pack Bee", surfaceType: "vehicle", mode: "design", year: "2024", make: "Dodge", model: "Charger",
    zones: [
      { id: "zone-door", label: "Door", content: "accent stripe" },
      { id: "zone-side-panel", label: "Side Panel", content: "accent stripe" },
      { id: "zone-tailgate", label: "Tailgate", content: "logo only" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Dodge Scat Pack angry bee emblem on rear quarter panel, dual racing stripes hood to trunk in satin black, aggressive muscle car styling with subtle bee badge accents",
    vinylFinish: "satin",
  },
  {
    id: 10, name: "Hot Rod Flames", surfaceType: "vehicle", mode: "design", year: "2023", make: "Chevrolet", model: "Camaro",
    zones: [
      { id: "zone-side-panel", label: "Side Panel", content: "accent stripe" },
      { id: "zone-hood", label: "Hood", content: "accent stripe" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Classic hot rod tribal flame pattern flowing from front fenders back, deep candy red and orange fading to yellow tips, old school but clean execution, pinstripe border detail",
    vinylFinish: "glossy",
  },
  {
    id: 11, name: "Toyota Vintage Decals", surfaceType: "vehicle", mode: "design", year: "2024", make: "Toyota", model: "4Runner",
    zones: [
      { id: "zone-door", label: "Door", content: "accent stripe" },
      { id: "zone-side-panel", label: "Side Panel", content: "accent stripe" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Retro 1980s Toyota off-road racing heritage livery, vintage red-orange-yellow sunset stripe along beltline, retro TOYOTA block letter badge, TRD vintage racing graphics inspired by Ivan Stewart desert truck",
    vinylFinish: "matte",
  },
  // === WALL SURFACES ===
  {
    id: 12, name: "Gym Wall Logo", surfaceType: "wall", mode: "commercial", year: "", make: "", model: "",
    wallTexture: "smooth", indoor: true,
    zones: [
      { id: "zone-wall-1", label: "Main Wall", content: "logo + name" },
    ],
    businessName: "Iron Temple Fitness", phone: "(555) 999-LIFT", website: "irontemplefitness.com",
    industry: "Fitness", tagline: "Forge Your Strength",
    copyText: "Personal Training, Group Classes, Open 24/7", font: "Bebas Neue",
    designPrompt: "Aggressive gym branding, matte black wall with large white and red logo, industrial feel",
    vinylFinish: "matte",
  },
  {
    id: 13, name: "Salon Window", surfaceType: "glass", mode: "commercial", year: "", make: "", model: "",
    glassType: "storefront", glassMount: "exterior",
    zones: [
      { id: "zone-glass-1", label: "Window", content: "logo + name" },
      { id: "zone-glass-2", label: "Lower Window", content: "phone + website" },
    ],
    businessName: "Luxe Hair Studio", phone: "(555) 333-LUXE", website: "luxehairstudio.com",
    industry: "Beauty", tagline: "Your Style, Elevated",
    copyText: "Cuts, Color, Extensions, Bridal", font: "Playfair Display",
    designPrompt: "Elegant frosted vinyl storefront lettering, gold metallic on frosted glass, high-end salon feel",
    vinylFinish: "satin",
  },
  {
    id: 14, name: "Office Wall Mural", surfaceType: "wall", mode: "design", year: "", make: "", model: "",
    wallTexture: "smooth", indoor: true,
    zones: [
      { id: "zone-wall-1", label: "Feature Wall", content: "accent stripe" },
    ],
    businessName: "", phone: "", website: "",
    industry: "", tagline: "",
    copyText: "", font: "",
    designPrompt: "Modern corporate office feature wall with abstract geometric mountain range silhouette, navy blue and gold, inspirational but minimal, tech company lobby feel",
    vinylFinish: "matte",
  },
  {
    id: 15, name: "Brick Wall Bar Sign", surfaceType: "wall", mode: "commercial", year: "", make: "", model: "",
    wallTexture: "textured", indoor: true,
    zones: [
      { id: "zone-wall-1", label: "Brick Wall", content: "logo + name" },
    ],
    businessName: "The Rusty Barrel", phone: "", website: "therustybarrel.com",
    industry: "Restaurant/Bar", tagline: "Craft Beer & Good Times",
    copyText: "Est. 2019, Happy Hour 4-7pm", font: "Lobster",
    designPrompt: "Vintage bar signage on exposed red brick, distressed hand-painted lettering look, warm amber and cream colors, old-school pub feel",
    vinylFinish: "matte",
  },
];

const STYLES = ["bold", "modern"];

const AdminGraphicsProBatchTest = () => {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load past results
  const { data: pastResults, refetch: refetchHistory } = useQuery({
    queryKey: ["graphicspro_batch_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("graphicspro_batch_results")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: showHistory,
  });

  const initJobs = useCallback(() => {
    const allJobs: RenderJob[] = [];
    for (const tc of TEST_CASES) {
      for (const style of STYLES) {
        allJobs.push({ testId: tc.id, style, status: "pending" });
      }
    }
    setJobs(allJobs);
    return allJobs;
  }, []);

  const updateJob = (idx: number, updates: Partial<RenderJob>) => {
    setJobs((prev) => prev.map((j, i) => (i === idx ? { ...j, ...updates } : j)));
  };

  const runSingle = async (tc: TestCase, style: string, jobIdx: number) => {
    updateJob(jobIdx, { status: "running", startTime: Date.now() });

    try {
      let surfaceUrl = tc.surfaceImageUrl || null;

      // Step 1: Generate surface (skip if upload mode with pre-set URL)
      if (!surfaceUrl) {
        const surfaceParams: any = { type: tc.surfaceType };
        if (tc.surfaceType === "vehicle") {
          surfaceParams.year = tc.year;
          surfaceParams.make = tc.make;
          surfaceParams.model = tc.model;
          surfaceParams.area = tc.zones[0]?.id.replace("zone-", "") || "door";
        } else if (tc.surfaceType === "wall") {
          surfaceParams.wallTexture = tc.wallTexture || "smooth";
          surfaceParams.indoor = tc.indoor ?? true;
        } else if (tc.surfaceType === "glass") {
          surfaceParams.glassType = tc.glassType || "storefront";
          surfaceParams.glassMount = tc.glassMount || "exterior";
        }

        const { data: surfRes, error: surfErr } = await supabase.functions.invoke("generate-graphics-pro", {
          body: { action: "generate_surface", surfaceParams },
        });

        if (surfErr || !surfRes?.surfaceUrl) {
          throw new Error(surfRes?.error || surfErr?.message || "Surface generation failed");
        }
        surfaceUrl = surfRes.surfaceUrl;
      }

      // Step 2: Generate mockup
      const mockupBody = {
        action: "generate_mockup",
        surfaceImageUrl: surfaceUrl,
        surfaceType: tc.surfaceType,
        surfaceTexture: tc.wallTexture || "",
        vinylFinish: tc.vinylFinish,
        graphicMode: tc.mode,
        designPrompt: tc.designPrompt,
        designStyle: style,
        businessName: tc.businessName,
        businessPhone: tc.phone,
        businessWebsite: tc.website,
        businessIndustry: tc.industry,
        businessTagline: tc.tagline,
        businessCopyText: tc.copyText,
        businessFont: tc.font,
        restylePrompt: tc.restylePrompt || "",
        generateLogo: tc.mode === "commercial",
        uploadedArtworkUrls: [],
        businessLogoUrl: null,
        restyleSourceUrl: null,
        visionBoardUrls: [],
        visionBoardIntent: "style_inspiration",
        vinylZones: tc.zones.map((z) => ({
          id: z.id, label: z.label, designPrompt: z.content,
          x: 10, y: 10, width: 80, height: 80,
          widthInches: 0, heightInches: 0, location: z.label,
        })),
      };

      console.log(`[BatchTest] #${tc.id} ${style}:`, JSON.stringify(mockupBody, null, 2));

      const { data: mockRes, error: mockErr } = await supabase.functions.invoke("generate-graphics-pro", {
        body: mockupBody,
      });

      if (mockErr || !mockRes?.mockupUrl) {
        throw new Error(mockRes?.error || mockErr?.message || "Mockup render failed");
      }

      const endTime = Date.now();
      updateJob(jobIdx, { status: "done", mockupUrl: mockRes.mockupUrl, endTime });

      // Save to DB for review later
      await supabase.from("graphicspro_batch_results").insert({
        test_name: tc.name,
        test_id: tc.id,
        mode: tc.mode,
        style,
        vehicle: tc.surfaceType === "vehicle" ? `${tc.year} ${tc.make} ${tc.model}`.trim() : tc.surfaceType,
        business_name: tc.businessName || null,
        design_prompt: tc.designPrompt,
        zones: tc.zones,
        surface_url: surfaceUrl,
        mockup_url: mockRes.mockupUrl,
        duration_seconds: Math.round((endTime - (jobs[jobIdx]?.startTime || endTime)) / 1000),
        payload: mockupBody,
      });
    } catch (err: any) {
      const endTime = Date.now();
      updateJob(jobIdx, { status: "error", error: err.message, endTime });

      await supabase.from("graphicspro_batch_results").insert({
        test_name: tc.name,
        test_id: tc.id,
        mode: tc.mode,
        style,
        vehicle: tc.surfaceType === "vehicle" ? `${tc.year} ${tc.make} ${tc.model}`.trim() : tc.surfaceType,
        design_prompt: tc.designPrompt,
        error: err.message,
        zones: tc.zones,
      });
    }
  };

  const runAll = async () => {
    setRunning(true);
    const allJobs = initJobs();

    // Run sequentially to avoid rate limits
    for (let i = 0; i < allJobs.length; i++) {
      const job = allJobs[i];
      const tc = TEST_CASES.find((t) => t.id === job.testId)!;
      await runSingle(tc, job.style, i);
    }

    setRunning(false);
  };

  const completedCount = jobs.filter((j) => j.status === "done").length;
  const errorCount = jobs.filter((j) => j.status === "error").length;
  const runningIdx = jobs.findIndex((j) => j.status === "running");

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Admin</Button>
            </Link>
            <h1 className="text-xl font-bold text-foreground">GraphicsPro Batch Test</h1>
          </div>
          <div className="flex items-center gap-3">
            {jobs.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {completedCount}/{jobs.length} done{errorCount > 0 ? ` · ${errorCount} errors` : ""}
              </span>
            )}
            <Button
              onClick={runAll}
              disabled={running}
              className="bg-gradient-to-r from-blue-600 via-purple-600 to-fuchsia-600 text-white"
            >
              {running ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Run All {TEST_CASES.length * STYLES.length} Renders</>
              )}
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {TEST_CASES.length} test vehicles × 2 styles (Bold + Modern) = {TEST_CASES.length * STYLES.length} renders. Modes: Commercial, Design, Restyle. Runs sequentially (~2 min each).
        </p>

        {/* Test Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEST_CASES.map((tc) => (
            <Card key={tc.id} className="bg-secondary border-border/30 overflow-hidden">
              <div className="border-b border-border/30 px-4 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">{tc.name} <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 ml-1">{tc.mode}</span></h3>
                  <div className="flex gap-1">
                    {tc.zones.map((z) => (
                      <span key={z.id} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border/30 text-muted-foreground">
                        {z.label}: {z.content}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <p><span className="text-foreground/60">Vehicle:</span> {tc.year} {tc.make} {tc.model} · <span className="text-foreground/60">Finish:</span> {tc.vinylFinish}{tc.surfaceImageUrl ? " · 📷 Upload" : ""}</p>
                  <p><span className="text-foreground/60">Biz:</span> {tc.businessName} · {tc.phone} · {tc.website}</p>
                  <p><span className="text-foreground/60">Industry:</span> {tc.industry} · <span className="text-foreground/60">Tagline:</span> {tc.tagline} · <span className="text-foreground/60">Font:</span> {tc.font}</p>
                  <p><span className="text-foreground/60">Prompt:</span> {tc.designPrompt}</p>
                  <p><span className="text-foreground/60">Extra:</span> {tc.copyText} · <span className="text-foreground/60">AI Logo:</span> Yes</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-0 divide-x divide-border/30">
                {STYLES.map((style) => {
                  const job = jobs.find((j) => j.testId === tc.id && j.style === style);
                  return (
                    <div key={style} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground capitalize">{style}</span>
                        {job?.status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                        {job?.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                        {job?.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                      {job?.mockupUrl && (
                        <div className="space-y-1">
                          <img src={job.mockupUrl} alt={`${tc.name} ${style}`} className="w-full rounded border border-border/30" />
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">
                              {job.endTime && job.startTime ? `${Math.round((job.endTime - job.startTime) / 1000)}s` : ""}
                            </span>
                            <a href={job.mockupUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-400">
                                <Download className="w-3 h-3 mr-1" /> Full Size
                              </Button>
                            </a>
                          </div>
                        </div>
                      )}
                      {job?.error && (
                        <p className="text-[10px] text-red-400 truncate" title={job.error}>{job.error}</p>
                      )}
                      {!job && (
                        <div className="h-20 rounded bg-secondary/50 border border-border/20 flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground">Waiting...</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        {/* Past Results */}
        <div className="border-t border-border/30 pt-6">
          <Button
            variant="outline"
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) refetchHistory(); }}
            className="gap-2"
          >
            <History className="w-4 h-4" />
            {showHistory ? "Hide" : "Show"} Past Results
          </Button>

          {showHistory && pastResults && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {pastResults.map((r: any) => (
                <Card key={r.id} className="bg-secondary border-border/30 overflow-hidden">
                  {r.mockup_url ? (
                    <a href={r.mockup_url} target="_blank" rel="noopener noreferrer">
                      <img src={r.mockup_url} alt={r.test_name} className="w-full aspect-video object-cover" />
                    </a>
                  ) : (
                    <div className="w-full aspect-video bg-red-500/10 flex items-center justify-center">
                      <XCircle className="w-6 h-6 text-red-400" />
                    </div>
                  )}
                  <div className="p-2 space-y-0.5">
                    <p className="text-xs font-medium text-foreground truncate">{r.test_name}</p>
                    <div className="flex gap-1">
                      <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400">{r.mode}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400">{r.style}</span>
                      {r.duration_seconds && (
                        <span className="text-[9px] text-muted-foreground ml-auto">{r.duration_seconds}s</span>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground truncate">{r.vehicle || r.design_prompt}</p>
                    {r.error && <p className="text-[9px] text-red-400 truncate">{r.error}</p>}
                    <p className="text-[9px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminGraphicsProBatchTest;
