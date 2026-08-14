/**
 * useBatchTestPipeline
 *
 * Multi-tool batch render pipeline for investor demos.
 * Runs 5 renders per tool (DesignProAI → ColorPro → FadeWraps → PatternPro → ApprovePro)
 * with auto 6-view generation for each successful render.
 *
 * Total: 25 renders × 6 views = up to 150 AI-generated images
 */

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getRandomPresets, type PromptPreset } from "@/data/prompt-presets";
import { getRandomColorProPresets, type ColorProPreset } from "@/data/batch-presets-colorpro";
import { getRandomFadeWrapsPresets, type FadeWrapsPreset } from "@/data/batch-presets-fadewraps";
import { getRandomWBTYPresets, type WBTYPreset } from "@/data/batch-presets-wbty";
import { getRandomDesignProPresets, type DesignProPreset } from "@/data/batch-presets-designpro";
import { generateAndSaveProof, type ProofView } from "@/lib/proof-service";
import type { ToolKey } from "@/lib/tool-registry";
import { TOP_20_VEHICLES, getVehiclesByCategory } from "@/lib/vehicle-selection";
import { stampOverlayOnImage, type OverlaySpec } from "@/lib/overlay-stamper";

/* ================================================================ */
/* TYPES                                                             */
/* ================================================================ */

export type ToolType = "designpro" | "colorpro" | "fadewraps" | "wbty" | "approvemode";

export const TOOL_LABELS: Record<ToolType, string> = {
  designpro: "DesignProAI™",
  colorpro: "ColorPro™",
  fadewraps: "FadeWraps™",
  wbty: "PatternPro™",
  approvemode: "ApprovePro™",
};

export const VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
export const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  roof: "Roof Plan",
};

/** Map batch ToolType to proof-service ToolKey */
const TOOL_KEY_MAP: Record<ToolType, ToolKey> = {
  designpro: "designpanelpro",
  colorpro: "colorpro",
  fadewraps: "fadewraps",
  wbty: "wbty",
  approvemode: "approvepro",
};

/* ================================================================ */
/* INDUSTRY → VEHICLE MAPPING for Commercial batch renders           */
/* Maps subcategories to contextually appropriate vehicles so a      */
/* pizza company renders on a delivery van, not an F-150.            */
/* ================================================================ */

const INDUSTRY_VEHICLES: Record<string, Array<{ year: string; make: string; model: string }>> = {
  "Food & Beverage":  [{ year: "2024", make: "Ford", model: "Transit" }, { year: "2024", make: "Mercedes-Benz", model: "Sprinter" }, { year: "2024", make: "Ram", model: "ProMaster 2500" }, { year: "2024", make: "Chevrolet", model: "Express" }],
  "Construction":     [{ year: "2024", make: "Ford", model: "F-250 Super Duty" }, { year: "2024", make: "Ram", model: "2500" }, { year: "2024", make: "Chevrolet", model: "Silverado 2500HD" }, { year: "2024", make: "GMC", model: "Sierra 2500HD" }],
  "Automotive":       [{ year: "2024", make: "Ford", model: "Transit Connect" }, { year: "2024", make: "Chevrolet", model: "Colorado" }, { year: "2024", make: "Ram", model: "1500" }, { year: "2024", make: "Toyota", model: "Tacoma" }],
  "Healthcare":       [{ year: "2024", make: "Toyota", model: "Sienna" }, { year: "2024", make: "Ford", model: "Transit" }, { year: "2024", make: "Chevrolet", model: "Equinox" }, { year: "2024", make: "Honda", model: "CR-V" }],
  "Real Estate":      [{ year: "2024", make: "Tesla", model: "Model Y" }, { year: "2024", make: "BMW", model: "X5" }, { year: "2024", make: "Lexus", model: "RX 350" }, { year: "2024", make: "Mercedes-Benz", model: "GLE 350" }],
  "Delivery":         [{ year: "2024", make: "Ford", model: "Transit" }, { year: "2024", make: "Mercedes-Benz", model: "Sprinter" }, { year: "2024", make: "Ram", model: "ProMaster 2500" }, { year: "2024", make: "Nissan", model: "NV200" }],
  "Entertainment":    [{ year: "2024", make: "Mercedes-Benz", model: "Sprinter" }, { year: "2024", make: "Ford", model: "E-Series" }, { year: "2024", make: "Chevrolet", model: "Suburban" }, { year: "2024", make: "GMC", model: "Yukon XL" }],
  "Technology":       [{ year: "2024", make: "Tesla", model: "Model Y" }, { year: "2024", make: "Rivian", model: "R1S" }, { year: "2024", make: "Ford", model: "Mustang Mach-E" }, { year: "2024", make: "BMW", model: "iX" }],
  "Education":        [{ year: "2024", make: "Ford", model: "Transit" }, { year: "2024", make: "Toyota", model: "Sienna" }, { year: "2024", make: "Chevrolet", model: "Express" }, { year: "2024", make: "Honda", model: "Odyssey" }],
  "Home Services":    [{ year: "2024", make: "Ford", model: "F-150" }, { year: "2024", make: "Ram", model: "1500" }, { year: "2024", make: "Chevrolet", model: "Silverado 1500" }, { year: "2024", make: "Ford", model: "Transit Connect" }],
  "Professional":     [{ year: "2024", make: "Tesla", model: "Model 3" }, { year: "2024", make: "BMW", model: "3 Series" }, { year: "2024", make: "Mercedes-Benz", model: "C-Class" }, { year: "2024", make: "Audi", model: "A4" }],
};

/** Counter per subcategory so each call picks the next vehicle in rotation */
const _industryVehicleCounters: Record<string, number> = {};

function pickVehicleForIndustry(subcategory: string): { year: string; make: string; model: string } | null {
  const pool = INDUSTRY_VEHICLES[subcategory];
  if (!pool || pool.length === 0) return null;
  const idx = (_industryVehicleCounters[subcategory] || 0) % pool.length;
  _industryVehicleCounters[subcategory] = idx + 1;
  return pool[idx];
}

// Camera angle descriptions - must match locked CAMERA_ANGLES from view-angles-os.ts
const VIEW_ANGLE_PROMPTS: Record<string, string> = {
  "side": "Camera position: perfectly level, straight-on driver side profile. Camera height: door handle height, perpendicular to vehicle body. Full vehicle in frame with 10% padding on all sides. Vehicle faces left in the frame. Show full vehicle length from front bumper to rear bumper, BOTH driver-side wheels visible.",
  "passenger-side": "Camera position: perfectly level, straight-on PASSENGER SIDE (RIGHT SIDE) profile. Camera is on the OPPOSITE side of the vehicle from the driver side - the camera sees the passenger door, NOT the driver door. Camera height: door handle height, perpendicular to vehicle body. Full vehicle in frame with 10% padding on all sides. Vehicle faces RIGHT in the frame (nose pointing right). This is the MIRROR IMAGE of the driver side view. Show full vehicle length from front bumper to rear bumper, BOTH passenger-side wheels visible.",
  "hood_detail": "Camera position: standing at the front of the vehicle, slightly elevated, looking back across the ENTIRE hood surface. Camera height: just above hood level - slightly elevated, angled gently downward (15-25 degrees). The ENTIRE HOOD is visible from front edge to windshield base - show the FULL hood wrap design. The hood panel fills the frame - this is a hood detail shot, not a front grille shot. Show the complete wrap artwork across the full hood surface from edge to edge.",
  "front": "Camera position: straight-on front view, centered on the grille. Camera height: bumper/grille height, looking straight at the front of the vehicle. See full front fascia: headlights, grille, hood edge, front bumper, windshield. NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.",
  "rear": "Camera position: straight-on rear view, centered on tailgate/hatch. Camera height: bumper height, looking straight at the back of the vehicle. See full rear: taillights, tailgate/hatch, rear bumper, rear window. NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.",
  "close-up": "Camera position: 18-24 inches from the vehicle body, waist height, angled obliquely along the bodyline curve. 85mm f/2.8, shallow depth of field. Door handle, window edge, and body curves visible for context. Body panels fill 90%+ of frame. NO full vehicle, NO wheels. Photorealistic vinyl wrap surface: ink depth, laminate sheen, specular highlights, material texture conforming to body curves, full resolution of printed design. Dramatic angled bodyline shot.",
  "roof": "Camera position: directly overhead top-down view, camera centered above the vehicle looking straight down. Show the full roof panel, A-pillars to trunk. The roof surface fills 90% of the frame.",
};

export interface PipelineJob {
  id: string;
  tool: ToolType;
  prompt: string;
  designName: string;
  vehicle: { year: string; make: string; model: string };
  finish: string;
  status: "queued" | "rendering" | "views" | "done" | "failed";
  renderUrl: string | null;
  panelUrl: string | null;
  views: Record<string, string>;
  viewsProgress: number;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
  /** Tool-specific payload for the edge function */
  edgePayload: Record<string, unknown>;
  /** PDF proof URL after proof generation */
  proofUrl: string | null;
  /** Proof record ID */
  proofId: string | null;
}

/* ================================================================ */
/* TEST PRESETS - 5 per tool = 25 total renders                      */
/* ================================================================ */

interface TestPreset {
  tool: ToolType;
  /** Natural language prompt - like a real customer filling out a design order */
  prompt: string;
  /** Unique design name: company brand for commercial, creative name for restyle */
  designName: string;
  vehicle: { year: string; make: string; model: string };
  finish: string;
  edgePayload: Record<string, unknown>;
}

export const TEST_PRESETS: TestPreset[] = [
  // ═══════════════════════════════════════════════════════════════════
  // DesignProAI (5) - 3 commercial with real companies, 2 restyle
  // Written like a real customer filling out a design order form
  // ═══════════════════════════════════════════════════════════════════

  {
    tool: "designpro",
    designName: "Martinez Brothers Plumbing",
    prompt: "Design Type: Commercial. Company: Martinez Brothers Plumbing & Heating. Navy blue base color on the full truck. Company name 'MARTINEZ BROTHERS' large across both sides in bold white lettering. Below that 'Plumbing & Heating' in a clean condensed font. Phone number (602) 555-0173 on the tailgate and both rear quarter panels. Licensed bonded insured badge on the rear doors. Website martinezplumbing.com along the bottom rocker panels. We do residential and commercial service calls - the truck parks in driveways all day so it needs to look clean and trustworthy, not flashy. Keep it professional.",
    vehicle: { year: "2024", make: "Ford", model: "F-150" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Ember & Oak BBQ",
    prompt: "Design Type: Commercial. Company: Ember & Oak BBQ Smokehouse. Deep charcoal black base on the whole truck. A warm smoke-stained wood grain texture running along the lower third of the body panels. Company name 'EMBER & OAK' in large weathered copper-colored lettering across both sides. Below that 'Slow Smoked BBQ Since 2019' in a rustic serif font. Menu callouts on the passenger side: Brisket, Pulled Pork, Burnt Ends, Smoked Ribs. Warm orange and amber color tones throughout. Catering number (512) 555-0847 on the tailgate. Website emberandoak.com under the company name. We serve $22 brisket plates at food truck rallies - this truck IS the brand. Make it look like real smoke and real wood, not clip art.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Silverado" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Obsidian Fracture",
    prompt: "Design Type: ReStyle. I want a split-tone color change where the top half from the beltline up is deep obsidian black and the bottom half is polished gunmetal silver. Where the two colors meet I want a sharp fractured split line - jagged like cracked volcanic glass running from the nose all the way to the tail along the body line. In the cracks where black meets silver I want thin veins of molten copper color showing through. This should look like real automotive paint, not a printed pattern. Showroom quality two-tone with an aggressive geometric split line. Name this design 'Obsidian Fracture'.",
    vehicle: { year: "2024", make: "McLaren", model: "720S" },
    finish: "Gloss",
    edgePayload: { mode: "restyle" },
  },
  {
    tool: "designpro",
    designName: "Summit Electric Co.",
    prompt: "Design Type: Commercial. Company: Summit Electric Co. Bright safety yellow base covering the full van. Company name 'SUMMIT ELECTRIC' in large bold black block letters across both sliding doors. Underneath that 'Residential | Commercial | Industrial' in smaller text. Phone number (480) 555-0291 prominent on both sides and the rear doors. License number ROC# 298541 on the rear quarter panel. '24/7 Emergency Service' callout in red near the rear bumper area. Website summitelectricaz.com on the hood. A single clean bold line accent in black running along the front fender into the door - nothing busy. This van sits at job sites all day, it needs to be readable from across the street. High visibility, high trust.",
    vehicle: { year: "2024", make: "Ram", model: "ProMaster 2500" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Phantom Veil",
    prompt: "Design Type: ReStyle. Full body satin wrap in a deep midnight blue that looks almost black indoors but you can see the dark blue depth under direct light. Two thin parallel racing stripes in brushed titanium silver running from the hood scoop straight over the roof to the rear decklid - about 3 inches apart. The stripes are subtle, refined, not loud. The rest of the body is completely clean - no patterns, no text, no extra details. Just the deep dark color with those two metallic accent lines. This is for a gentleman racer who shows up to cars and coffee, not a teenager's video game build. Name this design 'Phantom Veil'.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Corvette C8" },
    finish: "Satin",
    edgePayload: { mode: "restyle" },
  },

  // ═══════════════════════════════════════════════════════════════════
  // ColorPro (5) - Full color change vinyl wraps, real film names
  // ═══════════════════════════════════════════════════════════════════

  {
    tool: "colorpro",
    designName: "KPMF Tiffany Blue",
    prompt: "Full color change wrap in KPMF Tiffany Blue gloss. That robin's egg blue with a hint of green - the jewelry box blue. Wrap everything, all painted body panels edge to edge. I want to see what this looks like on a Ferrari before I order 60 feet of film.",
    vehicle: { year: "2024", make: "Ferrari", model: "F8 Tributo" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Tiffany Blue",
        hex: "#81D8D0",
        finish: "Gloss",
        colorLibrary: "kpmf",
      },
    },
  },
  {
    tool: "colorpro",
    designName: "Avery Nardo Gray",
    prompt: "Full color change in Avery Dennison Nardo Gray satin. The flat battleship gray that Audi made famous. No shine, no sparkle, just that confident understated gray. Customer wants to see this on his Huracán before committing - needs to see how satin looks on those body lines.",
    vehicle: { year: "2024", make: "Lamborghini", model: "Huracán" },
    finish: "Satin",
    edgePayload: {
      colorData: {
        colorName: "Nardo Gray",
        hex: "#8C8C8C",
        finish: "Satin",
        colorLibrary: "avery-dennison",
      },
    },
  },
  {
    tool: "colorpro",
    designName: "3M Riviera Blue",
    prompt: "Full color change in 3M Gloss Riviera Blue. Intense electric blue with some ocean depth to it - not baby blue, not navy. The loud confident blue that turns heads in a parking lot. Customer is deciding between this and Miami Blue, needs to see it on the actual car.",
    vehicle: { year: "2024", make: "Porsche", model: "911 GT3" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Riviera Blue",
        hex: "#009FE3",
        finish: "Gloss",
        colorLibrary: "3m",
      },
    },
  },
  {
    tool: "colorpro",
    designName: "3M Acid Green Matte",
    prompt: "Full color change in 3M Matte Acid Green. That screaming neon yellow-green you can see from three blocks away. Completely flat finish, zero reflections, just raw aggressive color. The customer said he wants the car that makes people pull out their phones at a red light. Show him what it looks like.",
    vehicle: { year: "2024", make: "BMW", model: "M4" },
    finish: "Matte",
    edgePayload: {
      colorData: {
        colorName: "Acid Green",
        hex: "#B0BF1A",
        finish: "Matte",
        colorLibrary: "3m",
      },
    },
  },
  {
    tool: "colorpro",
    designName: "Avery Black Rose Metallic",
    prompt: "Full color change in Avery Dennison Black Rose Metallic gloss. A deep dark burgundy that reads black from a distance but catches wine red and plum metallic flake up close when you walk past it. Sophisticated, not flashy. Customer wants to see this on the AMG before his appointment next Tuesday.",
    vehicle: { year: "2024", make: "Mercedes-AMG", model: "GT" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Black Rose Metallic",
        hex: "#3B0A1E",
        finish: "Gloss",
        colorLibrary: "avery-dennison",
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // FadeWraps (5) - Gradient/fade wraps, each with a unique name
  // ═══════════════════════════════════════════════════════════════════

  {
    tool: "fadewraps",
    designName: "Magma Flow",
    prompt: "I want a top-to-bottom fade. Burnt orange starting at the roofline melting smoothly down into pure black at the rocker panels. The transition zone should sit right around the beltline - about 8 inches of smooth gradient where the orange dissolves into black. Like lava cooling from top down. Real vinyl color fade, not a printed pattern. Name it 'Magma Flow'.",
    vehicle: { year: "2024", make: "Lamborghini", model: "Urus" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Magma Flow",
        hex: "#FF6B00",
        finish: "Gloss",
        fadeSpec: { direction: "top-to-bottom", colorFrom: "#FF6B00", colorTo: "#0A0A0A", style: "smooth" },
      },
      customStylingPrompt: "Top-to-bottom fade from burnt orange at the roofline melting smoothly into pure black at the rocker panels. Transition zone at the beltline, about 8 inches of smooth gradient. Real vinyl color, not printed.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Deep Current",
    prompt: "Front-to-rear horizontal fade. Midnight navy blue starting at the front bumper, then it sweeps back getting gradually lighter through medium blue at the doors, transitioning into bright metallic silver by the rear quarter panels. Like looking into deep ocean water that gets lighter toward the surface. Clean automotive color transition. Name it 'Deep Current'.",
    vehicle: { year: "2024", make: "Cadillac", model: "Escalade" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Deep Current",
        hex: "#0A1628",
        finish: "Gloss",
        fadeSpec: { direction: "front-to-rear", colorFrom: "#0A1628", colorTo: "#C0C0C0", style: "smooth" },
      },
      customStylingPrompt: "Front-to-rear horizontal fade from midnight navy blue at the front bumper sweeping back through medium blue at the doors into bright metallic silver at the rear quarters. Like looking into deep ocean water toward the surface.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Rosé Dusk",
    prompt: "Soft blush pink at the roof fading smoothly down into clean pearl white at the bottom of the doors. Think the color of a glass of rosé wine at the top, transitioning into fresh white by the rocker panels. Gentle and smooth - not harsh, not stripey. My customer is a 28-year-old woman who runs a skincare brand. She wants it feminine but refined. Name it 'Rosé Dusk'.",
    vehicle: { year: "2024", make: "Nissan", model: "Z" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Rosé Dusk",
        hex: "#FFB7C5",
        finish: "Gloss",
        fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFB7C5", colorTo: "#F5F5F0", style: "smooth" },
      },
      customStylingPrompt: "Soft blush pink at the roof fading smoothly into clean pearl white at the bottom. Gentle and smooth gradient like rosé wine color at top into fresh white at rockers. Feminine but refined.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Ultraviolet Shift",
    prompt: "Satin finish diagonal fade. Deep electric purple starting vivid and saturated at the hood and front fenders, then it fades diagonally losing intensity as it sweeps back toward the rear, becoming true black at the rear bumper. The satin finish kills any shine and makes the whole thing look moody and stealth. Name it 'Ultraviolet Shift'.",
    vehicle: { year: "2024", make: "Ford", model: "Mustang GT" },
    finish: "Satin",
    edgePayload: {
      colorData: {
        colorName: "Ultraviolet Shift",
        hex: "#8B00FF",
        finish: "Satin",
        fadeSpec: { direction: "diagonal", colorFrom: "#8B00FF", colorTo: "#050510", style: "smooth" },
      },
      customStylingPrompt: "Deep electric purple at the front fading diagonally into true black at the rear. Vivid saturated purple on hood and front fenders gradually losing intensity to pure black at rear bumper. Satin finish, stealth and moody.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Emerald Sovereign",
    prompt: "Front-to-rear fade from rich emerald green at the nose flowing back into warm champagne gold at the tail. Deep British racing green on the front bumper and hood, melting through forest green at the doors, into warm gold at the rear quarters. Looks like money - the color combination you see on a vintage Rolex bezel. Luxurious and expensive-feeling. Name it 'Emerald Sovereign'.",
    vehicle: { year: "2024", make: "Lexus", model: "LC 500" },
    finish: "Gloss",
    edgePayload: {
      colorData: {
        colorName: "Emerald Sovereign",
        hex: "#006B3C",
        finish: "Gloss",
        fadeSpec: { direction: "front-to-rear", colorFrom: "#006B3C", colorTo: "#D4AF37", style: "smooth" },
      },
      customStylingPrompt: "Rich emerald green at the front flowing rearward into warm champagne gold. British racing green at the nose through forest green at doors into champagne gold at rear quarters. Looks like money - vintage Rolex color combo.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // PatternPro / WBTY (5) - Printed pattern wraps, each unique
  // ═══════════════════════════════════════════════════════════════════

  {
    tool: "wbty",
    designName: "Timber Ridge Camo",
    prompt: "Full vehicle wrap in realistic woodland camouflage. Oak leaves, pine branches, bark textures - autumn browns, olive greens, and tan. Like a real Mossy Oak or Realtree printed film, not a cartoon camo. The pattern repeats naturally across all panels. Matte finish so there is no glare in the field. This Jeep is going deer hunting in November. Name it 'Timber Ridge'.",
    vehicle: { year: "2024", make: "Jeep", model: "Grand Cherokee Trackhawk" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Timber Ridge Camo", hex: "#4A5D23", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Realistic woodland camouflage - oak leaves, pine branches, bark textures in autumn browns, olive greens, and tan. Like real Mossy Oak printed film, not cartoon. Matte flat finish, no glare.",
    },
  },
  {
    tool: "wbty",
    designName: "Operator Hex",
    prompt: "Digital hexagonal military camouflage in flat dark earth and olive drab green. Small hexagon tiles that shift between three shades of military green and brown - like digital camo on a modern military uniform but geometric hexagons instead of square pixels. Completely matte flat finish. Tactical, serious, no flash. The kind of wrap a former operator puts on his work truck. Name it 'Operator Hex'.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Silverado" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Operator Hex", hex: "#5C5B3A", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Digital hexagonal military camo in flat dark earth and olive drab green. Small hexagon tiles shifting between three shades of military green and brown. Completely matte flat finish, tactical and serious.",
    },
  },
  {
    tool: "wbty",
    designName: "Forged Carbon",
    prompt: "Full body in forged carbon fiber pattern - the chopped swirled random carbon fiber strands you see on Lamborghini factory carbon options. Not the standard 2x2 twill weave, this is the marbled swirl pattern with random fiber orientation. Black and dark gray fibers with a high-gloss clearcoat finish that catches light at different angles. Up close you can see individual strands. Name it 'Forged Carbon'.",
    vehicle: { year: "2024", make: "Porsche", model: "911 GT3" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Forged Carbon", hex: "#1A1A1A", finish: "Gloss", colorLibrary: "pattern" },
      customStylingPrompt: "Forged carbon fiber pattern - chopped swirled random carbon fiber strands like Lamborghini factory carbon. Not standard 2x2 twill weave, marbled swirl with random fiber orientation. Black and dark gray fibers, high-gloss clearcoat catching light at every angle.",
    },
  },
  {
    tool: "wbty",
    designName: "Heritage Stripe",
    prompt: "Pearl white base on the full car. Three thin parallel racing stripes - dark navy, red, and light blue - running from the front lip over the hood, across the roof, and down the rear decklid. The stripes are about 2 inches wide each with small gaps between them. Classic Martini Racing style. The rest of the vehicle is clean solid white. No numbers, no sponsor logos, no busy stuff - just the clean triple stripe on white. Timeless European racing heritage. Name it 'Heritage Stripe'.",
    vehicle: { year: "1969", make: "Ford", model: "Mustang Boss 302" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Heritage Stripe", hex: "#F5F5F0", finish: "Gloss", colorLibrary: "pattern" },
      customStylingPrompt: "Pearl white full body with three thin parallel racing stripes - dark navy, red, light blue - running from front lip over hood, across roof, down rear decklid. 2 inches wide each. Clean solid white everywhere else. No numbers, no logos. Classic Martini Racing style.",
    },
  },
  {
    tool: "wbty",
    designName: "Black Widow",
    prompt: "Full body matte black wrap with one accent detail - a red pinstripe running along the lower rocker panels on both sides that widens to a small diamond shape at the center of each door then tapers thin again. Just the matte black and that one red line. Murdered out everything - black on black on black with one dangerous red detail. Like a black widow spider marking. Menacing but clean. Name it 'Black Widow'.",
    vehicle: { year: "1970", make: "Chevrolet", model: "Chevelle SS" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Black Widow", hex: "#0A0A0A", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Full body matte black with a red pinstripe along the lower rocker panels that widens to a small diamond at center of each door then tapers thin again. Murdered out black on black with one red accent line like a black widow spider marking.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // ApprovePro (5) - Client approval proofs using DesignPro panels
  // These link to the DesignProAI renders above at runtime
  // ═══════════════════════════════════════════════════════════════════

  {
    tool: "approvemode",
    designName: "Martinez Brothers - Client Proof",
    prompt: "This is a client approval proof for Martinez Brothers Plumbing. Take the design and apply it to this vehicle as a professional vinyl wrap installation. All company branding, phone numbers, and text must be fully visible and readable across the body panels. The customer is approving this before we go to print - it needs to look exactly like the finished install will look in their driveway.",
    vehicle: { year: "2024", make: "Ferrari", model: "F8 Tributo" },
    finish: "Gloss",
    edgePayload: {},
  },
  {
    tool: "approvemode",
    designName: "Ember & Oak - Client Proof",
    prompt: "Client approval proof for Ember & Oak BBQ Smokehouse. Take the design panel and project it onto this vehicle with professional wrap installation quality. The wood grain textures, company name, menu text, and phone number all need to wrap smoothly around the body panels. This proof goes to the restaurant owner for sign-off before we send the files to print.",
    vehicle: { year: "2024", make: "Lamborghini", model: "Huracán" },
    finish: "Gloss",
    edgePayload: {},
  },
  {
    tool: "approvemode",
    designName: "Obsidian Fracture - Cross-Vehicle Test",
    prompt: "Cross-vehicle proof for the Obsidian Fracture restyle design. Take the two-tone split design with the cracked volcanic glass line and apply it to this completely different vehicle. The split line between black top and silver bottom should flow naturally along this vehicle's body lines - not just copy-paste, it should adapt to the new shape. Show the customer how their design looks on a different car.",
    vehicle: { year: "2024", make: "BMW", model: "M4" },
    finish: "Gloss",
    edgePayload: {},
  },
  {
    tool: "approvemode",
    designName: "Summit Electric - Fleet Proof",
    prompt: "Fleet approval proof for Summit Electric Co. Apply the yellow commercial wrap design onto this vehicle. The company name, phone number, license number, and all branding elements need to be properly positioned and fully readable at 30 feet. This proof is going to the fleet manager - he is ordering wraps for 12 vehicles from this design. It needs to be perfect.",
    vehicle: { year: "2024", make: "Cadillac", model: "Escalade" },
    finish: "Gloss",
    edgePayload: {},
  },
  {
    tool: "approvemode",
    designName: "Phantom Veil - Cross-Vehicle Test",
    prompt: "Cross-vehicle proof for the Phantom Veil restyle design. Take the midnight blue satin wrap with the twin brushed titanium racing stripes and apply it to this vehicle. The stripes should run from hood to tail following this car's natural body lines. The deep satin blue covers every painted panel. Show the customer what their restyle design looks like on the vehicle they actually own.",
    vehicle: { year: "2024", make: "Nissan", model: "Z" },
    finish: "Satin",
    edgePayload: {},
  },
];

/* ================================================================ */
/* HOOK                                                              */
/* ================================================================ */

const DELAY_BETWEEN_MS = 4000;
const VIEW_DELAY_MS = 3000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const MAX_RENDER_RETRIES = 3;
const MAX_INVOKE_RETRIES = 3; // retries specifically for edge function network/503 errors
const SESSION_REFRESH_INTERVAL = 10; // refresh session every N renders
const INVOKE_TIMEOUT_MS = 180_000; // 3 min max per render - edge functions can take 50s+

/**
 * Invoke a Supabase edge function with retry logic for transient failures.
 * Handles FunctionsFetchError (network), 503 (edge runtime busy), and
 * 429 (rate limited) with exponential backoff. Uses AbortController to
 * properly cancel timed-out requests and free browser connections.
 */
async function invokeWithRetry(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS,
  label = functionName,
): Promise<{ data: any; error: any }> {
  for (let attempt = 0; attempt <= MAX_INVOKE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        // @ts-expect-error - Supabase JS v2.81+ supports signal option
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!error) return { data, error: null };

      // Detect retryable errors
      const msg = error.message || "";
      const isNetworkError =
        msg.includes("Failed to send a request") ||
        msg.includes("FunctionsFetchError") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("network");

      // Detect JWT/auth errors (401) - refresh session and retry
      let isAuthError = false;
      if ((error as any).context) {
        try {
          const status = (error as any).context.status;
          isAuthError = status === 401 || status === 403;
        } catch {}
      }
      isAuthError = isAuthError ||
        msg.includes("Invalid JWT") ||
        msg.includes("JWT expired") ||
        msg.includes("invalid claim") ||
        msg.includes("token is expired") ||
        msg.includes("401");

      // Check for 503 (edge runtime busy) or 429 (rate limited)
      let isServerBusy = false;
      if ((error as any).context) {
        try {
          const status = (error as any).context.status;
          isServerBusy = status === 503 || status === 429;
        } catch {}
      }
      // Also detect from error message
      isServerBusy = isServerBusy ||
        msg.includes("503") ||
        msg.includes("Service Unavailable") ||
        msg.includes("boot") ||
        msg.includes("edge") ||
        msg.includes("429") ||
        msg.includes("rate limit");

      const isRetryable = isNetworkError || isServerBusy || isAuthError;

      if (!isRetryable || attempt === MAX_INVOKE_RETRIES) {
        return { data, error };
      }

      // On auth errors, force-refresh the session before retrying
      if (isAuthError) {
        console.warn(`🔑 [BatchPipeline] "${label}" JWT error - refreshing session before retry...`);
        try {
          await supabase.auth.refreshSession();
        } catch {
          console.warn(`🔑 [BatchPipeline] Session refresh failed`);
        }
      }

      // Exponential backoff: 4s, 8s, 16s - generous to let edge runtime recover
      // Auth errors use 1s since token refresh is fast
      const waitMs = isAuthError ? 1000 : Math.pow(2, attempt + 2) * 1000;
      console.warn(
        `⏳ [BatchPipeline] "${label}" ${isAuthError ? "JWT" : isServerBusy ? "503/429" : "network"} error, ` +
        `retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_INVOKE_RETRIES})...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } catch (err: any) {
      clearTimeout(timer);

      // AbortController timeout or other fetch-level error
      const isAbort = err?.name === "AbortError";
      const msg = err?.message || "";
      const isNetworkLevel =
        isAbort ||
        msg.includes("Failed to send") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError");

      if (!isNetworkLevel || attempt === MAX_INVOKE_RETRIES) {
        return {
          data: null,
          error: new Error(
            isAbort
              ? `${label} timed out after ${timeoutMs / 1000}s`
              : msg || "Unknown edge function error",
          ),
        };
      }

      const waitMs = Math.pow(2, attempt + 2) * 1000;
      console.warn(
        `⏳ [BatchPipeline] "${label}" ${isAbort ? "timeout" : "fetch error"}, ` +
        `retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_INVOKE_RETRIES})...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  // Final fallback (shouldn't reach here)
  return { data: null, error: new Error(`${label} failed after ${MAX_INVOKE_RETRIES + 1} attempts`) };
}

/**
 * Force-refresh auth session. If JWT is expired/invalid, show toast and
 * redirect to login. Returns the user email or null on failure.
 */
async function ensureAuth(): Promise<string | null> {
  // Try refresh first
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.user?.email) {
      return data.session.user.email;
    }
  } catch {}

  // Fallback: getSession
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) return session.user.email;
  } catch {}

  // Validate token is usable
  try {
    const { error } = await supabase.from("color_visualizations").select("id").limit(1);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("JWT") || msg.includes("401") || msg.includes("token")) {
        toast.error("Session expired — please log in again", {
          action: { label: "Log In", onClick: () => window.location.assign("/login") },
          duration: 10000,
        });
        return null;
      }
    }
  } catch {}

  // No session at all
  toast.error("Not logged in — please log in to run batch renders", {
    action: { label: "Log In", onClick: () => window.location.assign("/login") },
    duration: 10000,
  });
  return null;
}

/**
 * Official stamp + re-upload: uses the same overlay-stamper.ts that ColorPro uses.
 * Downloads image → stamps via canvas → uploads stamped PNG back to storage.
 */
async function stampAndUpload(
  imageUrl: string,
  overlay: OverlaySpec,
): Promise<string> {
  const blob = await stampOverlayOnImage(imageUrl, overlay);
  const fileName = `stamped/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Stamp upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(fileName);
  return urlData.publicUrl;
}

/** Build official OverlaySpec for a batch job */
function buildOverlaySpec(job: PipelineJob): OverlaySpec | null {
  if (job.tool === "colorpro") {
    const colorData = job.edgePayload?.colorData as Record<string, unknown> | undefined;
    const colorLib = (colorData?.colorLibrary as string) || "";
    const colorName = (colorData?.colorName as string) || "";
    const productCode = (colorData?.productCode as string) || "";
    const mfr = MANUFACTURER_LABELS[colorLib] || colorLib.toUpperCase();
    const label = productCode ? `${colorName} ${productCode}` : colorName;
    return {
      toolKey: "colorpro",
      manufacturer: mfr,
      colorOrDesignName: label,
    };
  }
  if (job.tool === "wbty") {
    return {
      toolKey: "wbty",
      colorOrDesignName: job.designName,
    };
  }
  if (job.tool === "designpro") {
    return {
      toolKey: "designpanelpro",
      colorOrDesignName: job.designName,
    };
  }
  if (job.tool === "fadewraps") {
    return {
      toolKey: "fadewraps",
      colorOrDesignName: job.designName,
    };
  }
  return null;
}

let _seq = 0;

export interface BatchPipelineConfig {
  vehicles: { year: string; make: string; model: string }[];
  tools: ToolType[];
  quantityPerCombo: number;
  customPrompt?: string;
  promptCategory?: "commercial" | "restyle";
  concurrencyLimit?: number;
  /** Pre-selected prompt presets from the preview panel - overrides random selection */
  customPrompts?: PromptPreset[];
}

/** Config for the "10 ColorPro + 5 PatternPro" random batch */
export interface MixedBatchConfig {
  colorProCount: number;
  patternProCount: number;
  /** Enable watermark overlays (tool name top-left, color/pattern label bottom-right) */
  watermark?: boolean;
}

/** Map colorLibrary ids to human-readable manufacturer names */
const MANUFACTURER_LABELS: Record<string, string> = {
  "3m": "3M",
  "avery-dennison": "Avery Dennison",
  "kpmf": "KPMF",
  "hexis": "Hexis",
  "teckwrap": "TeckWrap",
  "oracal": "Oracal",
  "inozetek": "Inozetek",
};

export function useBatchTestPipeline() {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "rendering" | "views" | "complete">("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const watermarkRef = useRef(false);

  /* ---- helpers ---- */
  const patch = (id: string, fields: Partial<PipelineJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...fields } : j)));

  /** Spin-wait while paused (checks every 500ms). Resolves false if aborted. */
  const waitWhilePaused = async (): Promise<boolean> => {
    while (pauseRef.current) {
      if (abortRef.current) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return !abortRef.current;
  };

  const getSession = async () => {
    for (let i = 0; i < 3; i++) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) return session;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  /** Refresh the Supabase session to prevent token expiration during long batches */
  const refreshSession = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn("[BatchPipeline] Session refresh failed, trying getSession:", error.message);
        const session = await getSession();
        return session?.user?.email || null;
      }
      return data.session?.user?.email || null;
    } catch (err) {
      console.warn("[BatchPipeline] Session refresh error:", err);
      const session = await getSession();
      return session?.user?.email || null;
    }
  };

  /* ================================================================ */
  /* RENDER ONE JOB (initial render - tool-specific)                   */
  /* ================================================================ */

  const renderOne = async (
    job: PipelineJob,
    email: string,
    designProPanels: Record<number, string>,
    queue: PipelineJob[],
  ): Promise<Partial<PipelineJob>> => {
    const t0 = Date.now();

    try {
      if (job.tool === "designpro") {
        // DesignProAI: Call design-panel-ai-generate to get direct 3D vehicle render
        const body = {
          mode: (job.edgePayload.mode as string) || "restyle",
          prompt: job.prompt,
          finish: job.finish,
          vehicleYear: job.vehicle.year,
          vehicleMake: job.vehicle.make,
          vehicleModel: job.vehicle.model,
        };

        const { data, error } = await invokeWithRetry(
          "design-panel-ai-generate",
          body,
          INVOKE_TIMEOUT_MS,
          `DesignProAI render ${job.designName}`,
        );

        if (error) {
          // Try to extract the real error from the response context
          let detail = data?.message || data?.error;
          if (!detail && (error as any).context) {
            try { const b = await (error as any).context.json(); detail = b?.message || b?.error || JSON.stringify(b); } catch {}
          }
          throw new Error(detail || error.message);
        }

        const renderUrl = data?.renderUrl || data?.panel?.media_url || null;
        if (!renderUrl) throw new Error("No image returned from DesignProAI");

        return {
          status: "done",
          renderUrl,
          panelUrl: data?.panel?.media_url || renderUrl,
          durationMs: Date.now() - t0,
        };
      }

      if (job.tool === "approvemode") {
        // ApprovePro: Use a DesignPro panel as the design source
        // Find which ApprovePro job this is (0-4) using the queue, not React state
        const panelKeys = Object.keys(designProPanels);
        const panelIdx = queue
          .filter((j) => j.tool === "approvemode")
          .findIndex((j) => j.id === job.id);
        const panelUrl = (panelIdx >= 0 && designProPanels[panelIdx])
          ? designProPanels[panelIdx]
          : panelKeys.length > 0
            ? designProPanels[Number(panelKeys[0])]
            : null;

        if (!panelUrl) throw new Error("No DesignPro panel available for ApprovePro test");

        const { data, error } = await invokeWithRetry(
          "generate-color-render",
          {
            vehicleYear: job.vehicle.year,
            vehicleMake: job.vehicle.make,
            vehicleModel: job.vehicle.model,
            modeType: "approvemode",
            viewType: "side",
            userEmail: email,
            customStylingPrompt: job.prompt,
            colorData: {
              colorName: "ApprovePro Design",
              hex: "#000000",
              finish: job.finish,
              colorLibrary: "approvemode",
              panelUrl,
            },
          },
          INVOKE_TIMEOUT_MS,
          `ApprovePro render ${job.designName}`,
        );

        if (error) {
          let detail = data?.message || data?.error;
          if (!detail && (error as any).context) {
            try { const b = await (error as any).context.json(); detail = b?.message || b?.error || JSON.stringify(b); } catch {}
          }
          throw new Error(detail || error.message);
        }
        if (!data?.renderUrl) throw new Error("No image returned from ApprovePro");

        return {
          status: "done",
          renderUrl: data.renderUrl,
          panelUrl,
          durationMs: Date.now() - t0,
        };
      }

      // ColorPro, FadeWraps, PatternPro: Call generate-color-render directly
      const modeTypeMap: Record<string, string> = {
        colorpro: "colorpro",
        fadewraps: "fadewraps",
        wbty: "wbty",
      };

      const colorData = (job.edgePayload.colorData as Record<string, unknown>) || {};
      const customStylingPrompt = (job.edgePayload.customStylingPrompt as string) || job.prompt;

      const { data, error } = await invokeWithRetry(
        "generate-color-render",
        {
          vehicleYear: job.vehicle.year,
          vehicleMake: job.vehicle.make,
          vehicleModel: job.vehicle.model,
          modeType: modeTypeMap[job.tool],
          viewType: "side",
          userEmail: email,
          customStylingPrompt,
          colorData: {
            ...colorData,
            finish: job.finish,
          },
        },
        INVOKE_TIMEOUT_MS,
        `${TOOL_LABELS[job.tool]} render ${job.designName}`,
      );

      if (error) {
        let detail = data?.message || data?.error;
        if (!detail && (error as any).context) {
          try { const b = await (error as any).context.json(); detail = b?.message || b?.error || JSON.stringify(b); } catch {}
        }
        throw new Error(detail || error.message);
      }
      if (!data?.renderUrl) throw new Error("No image returned");

      return {
        status: "done",
        renderUrl: data.renderUrl,
        panelUrl: (colorData as Record<string, unknown>)?.panelUrl as string || null,
        durationMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      };
    }
  };

  /* ================================================================ */
  /* GENERATE 7 VIEWS (auto after successful initial render)           */
  /* ================================================================ */

  const generateViews = async (job: PipelineJob, email: string): Promise<Record<string, string>> => {
    patch(job.id, { status: "views", viewsProgress: 0 });

    const modeTypeMap: Record<string, string> = {
      designpro: "designpanelpro",
      colorpro: "colorpro",
      fadewraps: "fadewraps",
      wbty: "wbty",
      approvemode: "approvemode",
    };

    const newViews: Record<string, string> = {};
    let completed = 0;

    for (const viewType of VIEW_ORDER) {
      let viewUrl: string | null = null;

      // Retry up to 2 times per view
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // DesignProAI renders: route through generate-color-render with panelUrl
          // so it uses the locked camera angles, studio, and finish specs.
          // Matches server-side batch-pipeline-executor behavior.
          if (job.tool === "designpro") {
            const body: Record<string, unknown> = {
              vehicleYear: job.vehicle.year,
              vehicleMake: job.vehicle.make,
              vehicleModel: job.vehicle.model,
              modeType: "designpanelpro",
              viewType,
              userEmail: email,
              skipCacheStorage: true,
              colorData: {
                panelUrl: job.panelUrl || job.renderUrl,
                panelName: job.designName,
                finish: job.finish,
              },
              skipLookups: completed > 0,
            };

            const { data, error } = await invokeWithRetry(
              "generate-color-render",
              body,
              INVOKE_TIMEOUT_MS,
              `${job.designName} view ${viewType}`,
            );

            if (!error && data?.renderUrl) {
              viewUrl = data.renderUrl;
              break;
            }
          } else {
            // ColorPro, FadeWraps, WBTY, ApprovePro: use generate-color-render (correct for these tools)
            const colorData = (job.edgePayload.colorData as Record<string, unknown>) || {};
            const panelUrl = job.panelUrl || job.renderUrl;
            const customStylingPrompt = (job.edgePayload.customStylingPrompt as string) || job.prompt;

            const body: Record<string, unknown> = {
              vehicleYear: job.vehicle.year,
              vehicleMake: job.vehicle.make,
              vehicleModel: job.vehicle.model,
              modeType: modeTypeMap[job.tool],
              viewType,
              userEmail: email,
              customStylingPrompt,
              colorData: {
                ...colorData,
                finish: job.finish,
                ...(job.tool === "approvemode"
                  ? {
                      colorLibrary: "approvemode",
                      panelUrl,
                      panelName: job.prompt.slice(0, 60),
                    }
                  : {}),
              },
              skipLookups: completed > 0,
            };

            const { data, error } = await invokeWithRetry(
              "generate-color-render",
              body,
              INVOKE_TIMEOUT_MS,
              `${job.designName} view ${viewType}`,
            );

            if (!error && data?.renderUrl) {
              viewUrl = data.renderUrl;
              break;
            }
          }
        } catch {
          /* retry */
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }

      // Stamp the view if enabled (uses official overlay-stamper)
      if (viewUrl && watermarkRef.current) {
        const overlay = buildOverlaySpec(job);
        if (overlay) {
          try {
            viewUrl = await stampAndUpload(viewUrl, overlay);
          } catch (err) {
            console.warn(`[BatchPipeline] View stamp failed for ${viewType}, using original:`, err);
          }
        }
      }

      if (viewUrl) {
        newViews[viewType] = viewUrl;
      }

      completed++;
      patch(job.id, { views: { ...newViews }, viewsProgress: completed });

      // Wait between views to avoid rate limiting
      if (completed < VIEW_ORDER.length) {
        await new Promise((r) => setTimeout(r, VIEW_DELAY_MS));
      }
    }

    const success = Object.keys(newViews).length === VIEW_ORDER.length;
    patch(job.id, {
      views: newViews,
      status: success ? "done" : "done", // Mark done even if partial views
      viewsProgress: VIEW_ORDER.length,
    });

    return newViews;
  };

  /* ================================================================ */
  /* PERSIST RENDER TO SUPABASE                                        */
  /* ================================================================ */

  const persistRender = async (
    job: PipelineJob,
    views: Record<string, string>,
    currentBatchId: string,
    email: string,
  ): Promise<string | null> => {
    try {
      const renderUrls: Record<string, string> = {};
      // Include the initial render as the hero/side if not already in views
      if (job.renderUrl) {
        renderUrls.side = job.renderUrl;
      }
      // Merge in all views
      for (const [key, url] of Object.entries(views)) {
        renderUrls[key] = url;
      }
      // If we have a panel URL, store it too
      if (job.panelUrl) {
        renderUrls.panel = job.panelUrl;
      }

      const modeTypeMap: Record<string, string> = {
        designpro: "designpanelpro",
        colorpro: "colorpro",
        fadewraps: "fadewraps",
        wbty: "wbty",
        approvemode: "approvemode",
      };

      const viewCount = Object.keys(views).length;
      const designiqMode = (job.edgePayload?.mode as string) || undefined;
      const adminNotes = JSON.stringify({
        batch: true,
        batch_id: currentBatchId,
        tool: job.tool,
        original_prompt: job.prompt,
        design_name: job.designName,
        duration_ms: job.durationMs,
        panel_url: job.panelUrl,
        views_generated: viewCount,
        ...(designiqMode ? { designiq_mode: designiqMode } : {}),
        ...(designiqMode === "commercial" && job.edgePayload ? {
          company_name: (job.edgePayload as any).companyName,
          phone: (job.edgePayload as any).phone,
          mascot: (job.edgePayload as any).mascot,
          industry_type: (job.edgePayload as any).industryType,
          brand_keywords: (job.edgePayload as any).bulletPoints,
        } : {}),
      });

      const { data } = await supabase.from("color_visualizations").insert({
        customer_email: email,
        vehicle_year: parseInt(job.vehicle.year) || 2024,
        vehicle_make: job.vehicle.make,
        vehicle_model: job.vehicle.model,
        color_name: job.designName,
        color_hex: ((job.edgePayload?.colorData as Record<string, unknown>)?.hex as string) || "#000000",
        finish_type: job.finish,
        mode_type: modeTypeMap[job.tool] || job.tool,
        render_urls: renderUrls as Json,
        admin_notes: adminNotes,
        design_file_name: `${job.designName} - ${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model} [Batch ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}]`,
        generation_status: "completed",
        subscription_tier: "admin",
      }).select("id").single();

      return data?.id || null;
    } catch (err) {
      console.error("Failed to persist batch render:", err);
      return null;
    }
  };

  /* ================================================================ */
  /* MAIN BATCH EXECUTION                                              */
  /* ================================================================ */

  const startPipeline = useCallback(async (config?: BatchPipelineConfig) => {
    // Generate unique batch ID for this run
    const currentBatchId = `batch_${Date.now()}`;
    setBatchId(currentBatchId);

    // Build job queue - from custom config or fallback to presets
    let queue: PipelineJob[];

    if (config && config.vehicles.length > 0 && config.tools.length > 0) {
      // Custom batch: cross-product of vehicles × tools × quantity
      queue = [];

      // Pre-fetch shuffled prompt pools per tool so each job gets a unique prompt.
      // Each tool now has its own large preset library (50-60 presets) so batch
      // renders of qty 5, 20, or more always get unique prompts + colorData combos.
      const toolPromptPools: Record<string, PromptPreset[]> = {};
      const toolPromptIdx: Record<string, number> = {};

      // Tool-specific preset pools from dedicated libraries
      let colorProPool: ColorProPreset[] = [];
      let colorProIdx = 0;
      let fadeWrapsPool: FadeWrapsPreset[] = [];
      let fadeWrapsIdx = 0;
      let wbtyPool: WBTYPreset[] = [];
      let wbtyIdx = 0;

      // Fallback: legacy TEST_PRESETS for approvemode (still needs DesignPro panels)
      const toolPresetPools: Record<string, TestPreset[]> = {};
      const toolPresetIdx: Record<string, number> = {};

      const totalPerTool = config.vehicles.length * config.quantityPerCombo;

      for (const tool of config.tools) {
        if (tool === "designpro") {
          // DesignPro: use pre-selected prompts if provided, otherwise pull from library
          toolPromptPools[tool] = config.customPrompts && config.customPrompts.length > 0
            ? config.customPrompts
            : getRandomPresets(totalPerTool, config.promptCategory);
          toolPromptIdx[tool] = 0;
        } else if (tool === "colorpro") {
          colorProPool = getRandomColorProPresets(totalPerTool);
        } else if (tool === "fadewraps") {
          fadeWrapsPool = getRandomFadeWrapsPresets(totalPerTool);
        } else if (tool === "wbty") {
          wbtyPool = getRandomWBTYPresets(totalPerTool);
        } else {
          // approvemode: still uses TEST_PRESETS (needs DesignPro panels)
          const presets = TEST_PRESETS.filter((p) => p.tool === tool);
          const shuffled = [...presets].sort(() => Math.random() - 0.5);
          toolPresetPools[tool] = shuffled;
          toolPresetIdx[tool] = 0;
        }
      }

      const FINISHES: Array<"Gloss" | "Satin" | "Matte"> = ["Gloss", "Satin", "Matte"];
      let finishIdx = 0;

      for (const vehicle of config.vehicles) {
        for (const tool of config.tools) {
          for (let q = 0; q < config.quantityPerCombo; q++) {
            // Get the next unique prompt for this tool
            let prompt: string;
            let designName: string;
            let finish: string;
            let edgePayload: Record<string, unknown>;
            // resolvedVehicle may be overridden by industry mapping
            let resolvedVehicle = vehicle;

            if (config.customPrompt?.trim()) {
              // User-supplied custom prompt overrides library
              prompt = config.customPrompt.trim();
              designName = `Custom ${TOOL_LABELS[tool]} #${q + 1}`;
              finish = FINISHES[finishIdx % FINISHES.length];
              edgePayload = {};
            } else if (tool === "designpro" && toolPromptPools[tool]) {
              // DesignPro: pull from the 200-prompt library
              const idx = toolPromptIdx[tool]!;
              const presetPrompt = toolPromptPools[tool][idx % toolPromptPools[tool].length];
              toolPromptIdx[tool] = idx + 1;

              prompt = presetPrompt.prompt;
              designName = presetPrompt.subcategory
                ? `${presetPrompt.subcategory} - ${presetPrompt.id}`
                : presetPrompt.id;
              finish = FINISHES[finishIdx % FINISHES.length];
              edgePayload = { mode: presetPrompt.category };

              // Auto-select vehicle based on industry subcategory
              if (presetPrompt.subcategory) {
                const industryVehicle = pickVehicleForIndustry(presetPrompt.subcategory);
                if (industryVehicle) {
                  resolvedVehicle = industryVehicle;
                }
              }
            } else if (tool === "colorpro") {
              // ColorPro: pull from 60-preset vinyl color library
              const preset = colorProPool[colorProIdx % Math.max(colorProPool.length, 1)];
              colorProIdx++;

              prompt = `Full color change wrap in ${preset.colorLibrary.toUpperCase()} ${preset.colorName} ${preset.finish.toLowerCase()}. Professional vinyl wrap visualization.`;
              designName = preset.designName;
              finish = preset.finish;
              edgePayload = {
                colorData: {
                  colorName: preset.colorName,
                  hex: preset.hex,
                  finish: preset.finish,
                  colorLibrary: preset.colorLibrary,
                },
              };
            } else if (tool === "fadewraps") {
              // FadeWraps: pull from 50-preset fade library
              const preset = fadeWrapsPool[fadeWrapsIdx % Math.max(fadeWrapsPool.length, 1)];
              fadeWrapsIdx++;

              prompt = `${preset.designName} - ${preset.customStylingPrompt}`;
              designName = preset.designName;
              finish = preset.finish;
              edgePayload = {
                colorData: {
                  colorName: preset.designName,
                  hex: preset.hex,
                  finish: preset.finish,
                  fadeSpec: preset.fadeSpec,
                },
                customStylingPrompt: preset.customStylingPrompt,
              };
            } else if (tool === "wbty") {
              // WBTY/PatternPro: pull from 50-preset pattern library
              const preset = wbtyPool[wbtyIdx % Math.max(wbtyPool.length, 1)];
              wbtyIdx++;

              prompt = `Full vehicle wrap in ${preset.designName} pattern. ${preset.customStylingPrompt}`;
              designName = preset.designName;
              finish = preset.finish;
              edgePayload = {
                colorData: {
                  colorName: preset.colorName,
                  hex: preset.hex,
                  finish: preset.finish,
                  colorLibrary: "pattern",
                },
                customStylingPrompt: preset.customStylingPrompt,
              };
            } else {
              // approvemode or unknown: cycle through legacy TEST_PRESETS
              const pool = toolPresetPools[tool] || [];
              const idx = toolPresetIdx[tool] || 0;
              const preset = pool[idx % Math.max(pool.length, 1)];
              toolPresetIdx[tool] = idx + 1;

              prompt = preset?.prompt || `Generate a ${tool} render for ${vehicle.year} ${vehicle.make} ${vehicle.model}`;
              designName = preset?.designName || `${tool} render #${q + 1}`;
              finish = preset?.finish || FINISHES[finishIdx % FINISHES.length];
              edgePayload = preset?.edgePayload || {};
            }

            finishIdx++;

            queue.push({
              id: `pj_${Date.now()}_${++_seq}`,
              tool,
              prompt,
              designName,
              vehicle: resolvedVehicle,
              finish,
              status: "queued" as const,
              renderUrl: null,
              panelUrl: null,
              views: {},
              viewsProgress: 0,
              error: null,
              startedAt: null,
              durationMs: null,
              edgePayload,
              proofUrl: null,
              proofId: null,
            });
          }
        }
      }
    } else {
      // Preset pipeline (default)
      queue = TEST_PRESETS.map((preset) => ({
        id: `pj_${Date.now()}_${++_seq}`,
        tool: preset.tool,
        prompt: preset.prompt,
        designName: preset.designName,
        vehicle: preset.vehicle,
        finish: preset.finish,
        status: "queued" as const,
        renderUrl: null,
        panelUrl: null,
        views: {},
        viewsProgress: 0,
        error: null,
        startedAt: null,
        durationMs: null,
        edgePayload: preset.edgePayload,
        proofUrl: null,
        proofId: null,
      }));
    }

    setJobs(queue);
    setRunning(true);
    setPaused(false);
    setPhase("rendering");
    setCurrentIdx(0);
    abortRef.current = false;
    pauseRef.current = false;
    watermarkRef.current = false;

    let email: string | undefined = (await ensureAuth()) || undefined;
    if (!email) { setRunning(false); setPhase("idle"); return; }
    console.log(`[BatchPipeline] Session validated for ${email}`);

    // Track DesignPro panels for ApprovePro use
    const designProPanels: Record<number, string> = {};
    let dpIdx = 0;

    // Concurrency limit from config (default 1 = sequential)
    const concurrency = config?.concurrencyLimit || 1;

    /** Render a single job with retry + exponential backoff */
    const processJob = async (
      i: number,
      currentEmail: { value: string },
    ) => {
      const job = queue[i];

      // Update status in state
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "rendering" as const, startedAt: Date.now() } : j,
        ),
      );

      let result = await renderOne(job, currentEmail.value, designProPanels, queue);

      // Retry with exponential backoff on failure
      for (let attempt = 1; attempt < MAX_RENDER_RETRIES && result.status === "failed"; attempt++) {
        if (abortRef.current) break;
        const backoffMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 3s, 6s, 12s
        await new Promise((r) => setTimeout(r, backoffMs));
        result = await renderOne(job, currentEmail.value, designProPanels, queue);
      }

      // Save DesignPro panel URLs for ApprovePro
      if (job.tool === "designpro" && result.status === "done" && result.renderUrl) {
        designProPanels[dpIdx++] = result.panelUrl || result.renderUrl;
      }

      // Apply official stamp overlay if enabled
      if (watermarkRef.current && result.status === "done" && result.renderUrl) {
        const overlay = buildOverlaySpec(job);
        if (overlay) {
          try {
            const stampedUrl = await stampAndUpload(result.renderUrl, overlay);
            result = { ...result, renderUrl: stampedUrl };
          } catch (err) {
            console.warn(`[BatchPipeline] Stamp failed for ${job.id}, using original:`, err);
          }
        }
      }

      // Always update the queue array (not just for successes)
      queue[i] = { ...queue[i], ...result } as PipelineJob;

      patch(job.id, result);
    };

    // Phase 1: Generate initial renders - with concurrency support
    if (concurrency <= 1) {
      // Sequential mode (original behavior, enhanced with retries)
      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;

        const canContinue = await waitWhilePaused();
        if (!canContinue) break;

        setCurrentIdx(i);

        // Periodic session refresh to prevent token expiration
        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          const refreshedEmail = await refreshSession();
          if (refreshedEmail) email = refreshedEmail;
        }

        await processJob(i, { value: email });

        if (i < queue.length - 1 && !abortRef.current) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
        }
      }
    } else {
      // Concurrent mode - process jobs in batches of `concurrency`
      for (let batchStart = 0; batchStart < queue.length; batchStart += concurrency) {
        if (abortRef.current) break;

        const canContinue = await waitWhilePaused();
        if (!canContinue) break;

        // Refresh session periodically
        if (batchStart > 0 && batchStart % (SESSION_REFRESH_INTERVAL * concurrency) === 0) {
          const refreshedEmail = await refreshSession();
          if (refreshedEmail) email = refreshedEmail;
        }

        setCurrentIdx(batchStart);

        const batchEnd = Math.min(batchStart + concurrency, queue.length);
        const batchPromises: Promise<void>[] = [];

        for (let i = batchStart; i < batchEnd; i++) {
          batchPromises.push(processJob(i, { value: email }));
        }

        await Promise.all(batchPromises);

        if (batchEnd < queue.length && !abortRef.current) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
        }
      }
    }

    // Refresh session before persistence phase
    const refreshedEmail1 = await refreshSession();
    if (refreshedEmail1) email = refreshedEmail1;

    // Phase 1.5: Persist ALL successful initial renders immediately
    // This ensures results appear in Batch Results even if views fail
    const persistedIds: Record<string, string> = {}; // job.id -> visualization UUID
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.status === "failed" || !job.renderUrl) continue;

      try {
        const vizId = await persistRender(job, {}, currentBatchId, email);
        if (vizId) persistedIds[job.id] = vizId;
      } catch (err) {
        console.error(`[BatchPipeline] Failed to persist initial render for job ${job.id}:`, err);
      }
    }

    // Phase 2: Generate 7 views for all successful renders + update persisted records
    if (!abortRef.current) {
      setPhase("views");

      // Refresh session before views phase
      const refreshedEmail2 = await refreshSession();
      if (refreshedEmail2) email = refreshedEmail2;

      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;

        // Wait if paused
        const canContinue = await waitWhilePaused();
        if (!canContinue) break;

        setCurrentIdx(i);

        // Use the local queue array (updated in Phase 1) instead of reading from React state
        const job = queue[i];
        if (!job || job.status === "failed" || !job.renderUrl) continue;

        // Periodic session refresh during views phase
        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          const refreshedViewEmail = await refreshSession();
          if (refreshedViewEmail) email = refreshedViewEmail;
        }

        const views = await generateViews(job, email);

        // Update the persisted record with views
        const vizId = persistedIds[job.id];
        if (vizId && views && Object.keys(views).length > 0) {
          try {
            const renderUrls: Record<string, string> = {};
            if (job.renderUrl) renderUrls.side = job.renderUrl;
            for (const [key, url] of Object.entries(views)) {
              renderUrls[key] = url;
            }
            if (job.panelUrl) renderUrls.panel = job.panelUrl;

            await supabase
              .from("color_visualizations")
              .update({ render_urls: renderUrls as Json })
              .eq("id", vizId);
          } catch (err) {
            console.error(`[BatchPipeline] Failed to update views for job ${job.id}:`, err);
          }
        }

        // Phase 2.5: Generate PDF proof for this render
        if (views && Object.keys(views).length > 0) {
          try {
            const proofViews: ProofView[] = Object.entries(views).map(([type, url]) => ({
              type,
              url,
              label: VIEW_LABELS[type] || type,
            }));
            // Include the initial render as driver-side if not already present
            if (job.renderUrl && !views.side) {
              proofViews.unshift({ type: "side", url: job.renderUrl, label: "Driver Side" });
            }

            const toolKey = TOOL_KEY_MAP[job.tool];
            const colorData = (job.edgePayload?.colorData as Record<string, unknown>) || {};

            const proofResult = await generateAndSaveProof({
              toolKey,
              views: proofViews,
              vehicleInfo: {
                year: job.vehicle.year,
                make: job.vehicle.make,
                model: job.vehicle.model,
              },
              filmName: job.designName,
              finish: job.finish,
              manufacturer: (colorData.colorLibrary as string) || undefined,
              customerName: `Batch ${currentBatchId.replace("batch_", "")}`,
            });

            if (proofResult.success) {
              patch(job.id, { proofUrl: proofResult.pdfUrl || null, proofId: proofResult.proofId || null });
              console.log(`[BatchPipeline] Proof generated for ${job.designName}: ${proofResult.pdfUrl}`);
            } else {
              console.warn(`[BatchPipeline] Proof generation failed for ${job.designName}:`, proofResult.error);
            }
          } catch (err) {
            console.warn(`[BatchPipeline] Proof generation error for ${job.designName}:`, err);
          }
        }

        if (i < queue.length - 1 && !abortRef.current) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    setRunning(false);
    setPaused(false);
    setPhase("complete");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    pauseRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pauseRef.current = false;
    setPaused(false);
  }, []);

  /* ---- stats ---- */
  const stats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    rendering: jobs.filter((j) => j.status === "rendering").length,
    viewsInProgress: jobs.filter((j) => j.status === "views").length,
    totalViews: jobs.reduce((sum, j) => sum + Object.keys(j.views).length, 0),
    totalProofs: jobs.filter((j) => j.proofUrl).length,
    byTool: (Object.keys(TOOL_LABELS) as ToolType[]).reduce(
      (acc, tool) => {
        const toolJobs = jobs.filter((j) => j.tool === tool);
        acc[tool] = {
          total: toolJobs.length,
          done: toolJobs.filter((j) => j.status === "done").length,
          failed: toolJobs.filter((j) => j.status === "failed").length,
          views: toolJobs.reduce((s, j) => s + Object.keys(j.views).length, 0),
        };
        return acc;
      },
      {} as Record<ToolType, { total: number; done: number; failed: number; views: number }>,
    ),
  };

  /* ================================================================ */
  /* MIXED BATCH: N ColorPro + M PatternPro, random selection          */
  /* ================================================================ */

  const startMixedBatch = useCallback(async (mixedConfig: MixedBatchConfig) => {
    const { colorProCount, patternProCount, watermark = true } = mixedConfig;
    watermarkRef.current = watermark;

    // Shuffle vehicle pool
    const shuffledVehicles = [...TOP_20_VEHICLES].sort(() => Math.random() - 0.5);

    // Pull random presets
    const cpPresets = getRandomColorProPresets(colorProCount);
    const ppPresets = getRandomWBTYPresets(patternProCount);

    const FINISHES: Array<"Gloss" | "Satin" | "Matte"> = ["Gloss", "Satin", "Matte"];
    let finishIdx = 0;
    let vIdx = 0;

    const queue: PipelineJob[] = [];

    // Build ColorPro jobs
    for (const preset of cpPresets) {
      const vehicle = shuffledVehicles[vIdx % shuffledVehicles.length];
      vIdx++;
      queue.push({
        id: `pj_${Date.now()}_${++_seq}`,
        tool: "colorpro",
        prompt: `Full color change wrap in ${MANUFACTURER_LABELS[preset.colorLibrary] || preset.colorLibrary.toUpperCase()} ${preset.colorName} ${preset.finish.toLowerCase()}. Professional vinyl wrap visualization.`,
        designName: preset.designName,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        finish: preset.finish,
        status: "queued",
        renderUrl: null,
        panelUrl: null,
        views: {},
        viewsProgress: 0,
        error: null,
        startedAt: null,
        durationMs: null,
        edgePayload: {
          colorData: {
            colorName: preset.colorName,
            hex: preset.hex,
            finish: preset.finish,
            colorLibrary: preset.colorLibrary,
          },
        },
        proofUrl: null,
        proofId: null,
      });
      finishIdx++;
    }

    // Build PatternPro jobs
    for (const preset of ppPresets) {
      const vehicle = shuffledVehicles[vIdx % shuffledVehicles.length];
      vIdx++;
      queue.push({
        id: `pj_${Date.now()}_${++_seq}`,
        tool: "wbty",
        prompt: `Full vehicle wrap in ${preset.designName} pattern. ${preset.customStylingPrompt}`,
        designName: preset.designName,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        finish: preset.finish,
        status: "queued",
        renderUrl: null,
        panelUrl: null,
        views: {},
        viewsProgress: 0,
        error: null,
        startedAt: null,
        durationMs: null,
        edgePayload: {
          colorData: {
            colorName: preset.colorName,
            hex: preset.hex,
            finish: preset.finish,
            colorLibrary: "pattern",
          },
          customStylingPrompt: preset.customStylingPrompt,
        },
        proofUrl: null,
        proofId: null,
      });
      finishIdx++;
    }

    // Shuffle the combined queue so ColorPro and PatternPro are interleaved
    queue.sort(() => Math.random() - 0.5);

    // Launch using the existing pipeline execution (pass as a config that maps to this queue)
    // We call startPipeline internally but build our own queue, so we invoke it directly:
    // Actually, to reuse all the pipeline logic we set up the state and run the same loop.
    // The simplest way: call startPipeline with a fake config that produces the right queue.
    // But it's cleaner to just launch directly. Let's build a config:

    // Build a config that produces 1 vehicle × 2 tools × max(colorProCount, patternProCount)
    // This won't work well because the cross-product logic differs. Instead, we'll
    // construct the queue and pass it through the pipeline manually by setting state
    // and relying on the same execution path.

    // The cleanest approach: modify startPipeline to accept a pre-built queue.
    // For now, we piggyback on the existing startPipeline by constructing a
    // compatible config. Since that won't give us per-tool counts, we override:

    // Direct execution path (mirrors startPipeline internals)
    const currentBatchId = `batch_mixed_${Date.now()}`;
    setBatchId(currentBatchId);
    setJobs(queue);
    setRunning(true);
    setPaused(false);
    setPhase("rendering");
    setCurrentIdx(0);
    abortRef.current = false;
    pauseRef.current = false;

    let email: string | undefined = (await ensureAuth()) || undefined;
    if (!email) { setRunning(false); setPhase("idle"); return; }

    const designProPanels: Record<number, string> = {};

    /** Process a single job with retry */
    const processJob = async (i: number, currentEmail: { value: string }) => {
      const job = queue[i];
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "rendering" as const, startedAt: Date.now() } : j,
        ),
      );

      let result = await renderOne(job, currentEmail.value, designProPanels, queue);
      for (let attempt = 1; attempt < MAX_RENDER_RETRIES && result.status === "failed"; attempt++) {
        if (abortRef.current) break;
        const backoffMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        result = await renderOne(job, currentEmail.value, designProPanels, queue);
      }

      // Official stamp
      if (watermarkRef.current && result.status === "done" && result.renderUrl) {
        const overlay = buildOverlaySpec(job);
        if (overlay) {
          try {
            const stampedUrl = await stampAndUpload(result.renderUrl, overlay);
            result = { ...result, renderUrl: stampedUrl };
          } catch (err) {
            console.warn(`[MixedBatch] Stamp failed for ${job.id}:`, err);
          }
        }
      }

      queue[i] = { ...queue[i], ...result } as PipelineJob;
      patch(job.id, result);
    };

    // Phase 1: Render all jobs sequentially
    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const canContinue = await waitWhilePaused();
      if (!canContinue) break;
      setCurrentIdx(i);

      if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
        const refreshedEmail = await refreshSession();
        if (refreshedEmail) email = refreshedEmail;
      }

      await processJob(i, { value: email });

      if (i < queue.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    // Persist all successful renders
    const persistedIds: Record<string, string> = {};
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.status === "failed" || !job.renderUrl) continue;
      try {
        const vizId = await persistRender(job, {}, currentBatchId, email);
        if (vizId) persistedIds[job.id] = vizId;
      } catch (err) {
        console.error(`[MixedBatch] Persist failed for ${job.id}:`, err);
      }
    }

    // Phase 2: Generate 7 views
    if (!abortRef.current) {
      setPhase("views");
      const refreshedEmail2 = await refreshSession();
      if (refreshedEmail2) email = refreshedEmail2;

      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;
        const canContinue = await waitWhilePaused();
        if (!canContinue) break;
        setCurrentIdx(i);

        const job = queue[i];
        if (!job || job.status === "failed" || !job.renderUrl) continue;

        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          const refreshedViewEmail = await refreshSession();
          if (refreshedViewEmail) email = refreshedViewEmail;
        }

        const views = await generateViews(job, email);

        const vizId = persistedIds[job.id];
        if (vizId && views && Object.keys(views).length > 0) {
          try {
            const renderUrls: Record<string, string> = {};
            if (job.renderUrl) renderUrls.side = job.renderUrl;
            for (const [key, url] of Object.entries(views)) {
              renderUrls[key] = url;
            }
            await supabase
              .from("color_visualizations")
              .update({ render_urls: renderUrls as Json })
              .eq("id", vizId);
          } catch {}
        }
      }
    }

    setPhase("complete");
    setRunning(false);
    watermarkRef.current = false;
  }, []);

  /* ================================================================ */
  /* COLORPRO-ONLY BATCH: N random colors with watermarks              */
  /* ================================================================ */

  const startColorProBatch = useCallback(async (count: number = 10, watermark = true) => {
    watermarkRef.current = watermark;

    // Pull REAL manufacturer film colors from the database
    // Try manufacturer_colors first (authoritative), fallback to vinyl_swatches
    let dbColors: Array<{
      id: string; manufacturer: string; product_code: string;
      official_name: string; official_hex: string; finish: string;
    }> = [];

    const { data: mfcData, error: mfcError } = await supabase
      .from("manufacturer_colors")
      .select("id, manufacturer, product_code, official_name, official_hex, finish")
      .or("is_verified.eq.true,is_verified.is.null")
      .eq("is_ppf", false);

    if (mfcError) {
      console.error("[ColorProBatch] manufacturer_colors query FAILED:", mfcError.message);
    }

    if (mfcData && mfcData.length > 0) {
      // Filter out boring basics — no white, black, grey, silver for marketing batches
      const boringPatterns = /\b(white|black|grey|gray|silver|anthracite|charcoal|graphite|sand|chalk|khaki|olive|nato|telegrey|dark grey)\b/i;
      const boringHex = new Set(['#FFFFFF', '#ffffff', '#000000', '#1A1A1A', '#1a1a1a', '#080808', '#FAFAFA', '#fafafa', '#F0F0F0', '#f0f0f0', '#E8E8E8', '#555555', '#383838', '#404040', '#1C1C1C']);
      dbColors = mfcData.filter(c => c.official_hex && !boringPatterns.test(c.official_name) && !boringHex.has(c.official_hex));
      console.log(`[ColorProBatch] ✅ Loaded ${dbColors.length} exciting film colors (filtered ${mfcData.length - dbColors.length} boring basics)`);
      toast.info(`Loaded ${dbColors.length} exciting colors (skipped ${mfcData.length - dbColors.length} basics)`);
    } else {
      console.warn("[ColorProBatch] manufacturer_colors returned 0 rows, trying vinyl_swatches...");
      // Fallback to vinyl_swatches
      const { data: vsData, error: vsError } = await supabase
        .from("vinyl_swatches")
        .select("id, manufacturer, code, name, hex, finish")
        .eq("verified", true)
        .or("ppf.eq.false,ppf.is.null");

      if (vsError) {
        console.error("[ColorProBatch] vinyl_swatches query FAILED:", vsError.message);
      }

      if (vsData && vsData.length > 0) {
        dbColors = vsData.map((r) => ({
          id: r.id, manufacturer: r.manufacturer, product_code: r.code || "",
          official_name: r.name, official_hex: r.hex, finish: r.finish,
        }));
        console.log(`[ColorProBatch] ✅ Loaded ${dbColors.length} real film colors from vinyl_swatches (fallback)`);
        toast.info(`Loaded ${dbColors.length} colors from vinyl_swatches (fallback)`);
      }
    }

    if (dbColors.length === 0) {
      console.error("[ColorProBatch] ❌ No colors found in EITHER table");
      toast.error("No manufacturer colors found in database — check RLS policies or run an import");
      setRunning(false);
      setPhase("idle");
      return;
    }

    // Deduplicate by color name (across ALL manufacturers) AND by hex
    const seenNames = new Set<string>();
    const seenHex = new Set<string>();
    const uniqueColors = dbColors.filter(c => {
      const nameKey = c.official_name.toLowerCase().trim();
      const hexKey = (c.official_hex || "").toLowerCase();
      if (seenNames.has(nameKey)) return false;
      if (hexKey && seenHex.has(hexKey)) return false;
      seenNames.add(nameKey);
      if (hexKey) seenHex.add(hexKey);
      return true;
    });
    console.log(`[ColorProBatch] Deduplicated: ${dbColors.length} → ${uniqueColors.length} unique colors (by name + hex)`);

    // Ensure manufacturer diversity — at least 1 from each manufacturer that has colors
    const byMfr: Record<string, typeof uniqueColors> = {};
    for (const c of uniqueColors) {
      const m = c.manufacturer;
      if (!byMfr[m]) byMfr[m] = [];
      byMfr[m].push(c);
    }
    const selected: typeof uniqueColors = [];
    const mfrNames = Object.keys(byMfr).sort(() => Math.random() - 0.5);
    // Round-robin: pick 1 from each manufacturer until we hit count
    let round = 0;
    while (selected.length < count && round < 50) {
      for (const mfr of mfrNames) {
        if (selected.length >= count) break;
        const pool = byMfr[mfr];
        if (round < pool.length) {
          // Pick a random unused one from this manufacturer
          const unused = pool.filter(c => !selected.includes(c));
          if (unused.length > 0) {
            const pick = unused[Math.floor(Math.random() * unused.length)];
            selected.push(pick);
          }
        }
      }
      round++;
    }
    console.log(`[ColorProBatch] Selected ${selected.length} colors from ${mfrNames.length} manufacturers: ${mfrNames.map(m => `${m}(${selected.filter(c => c.manufacturer === m).length})`).join(', ')}`);

    // Marketing vehicles — all categories
    const shuffledVehicles = [...TOP_20_VEHICLES].sort(() => Math.random() - 0.5);

    const queue: PipelineJob[] = selected.map((color, i) => {
      const vehicle = shuffledVehicles[i % shuffledVehicles.length];
      const mfrLabel = MANUFACTURER_LABELS[color.manufacturer.toLowerCase().replace(/\s+/g, "-")] || color.manufacturer;
      const productCode = color.product_code || "";
      const designLabel = productCode
        ? `${mfrLabel} ${color.official_name} (${productCode})`
        : `${mfrLabel} ${color.official_name}`;
      return {
        id: `pj_${Date.now()}_${++_seq}`,
        tool: "colorpro" as ToolType,
        prompt: `Full color change wrap in ${mfrLabel} ${color.official_name} ${productCode} ${color.finish.toLowerCase()}. Professional vinyl wrap visualization showing the exact manufacturer film color.`,
        designName: designLabel,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        finish: color.finish,
        status: "queued" as const,
        renderUrl: null,
        panelUrl: null,
        views: {},
        viewsProgress: 0,
        error: null,
        startedAt: null,
        durationMs: null,
        edgePayload: {
          colorData: {
            id: color.id,
            swatchId: color.id,
            colorName: color.official_name,
            hex: color.official_hex,
            finish: color.finish,
            colorLibrary: color.manufacturer.toLowerCase().replace(/\s+/g, "-"),
            productCode: color.product_code,
            isVerifiedMatch: true,
          },
        },
        proofUrl: null,
        proofId: null,
      };
    });

    console.log(`[ColorProBatch] Queue built: ${queue.map(j => j.designName).join(", ")}`);

    const currentBatchId = `batch_colorpro_${Date.now()}`;
    setBatchId(currentBatchId);
    setJobs(queue);
    setRunning(true);
    setPaused(false);
    setPhase("rendering");
    setCurrentIdx(0);
    abortRef.current = false;
    pauseRef.current = false;

    let email: string | undefined = (await ensureAuth()) || undefined;
    if (!email) { setRunning(false); setPhase("idle"); return; }

    const designProPanels: Record<number, string> = {};

    const processJob = async (i: number, currentEmail: { value: string }) => {
      const job = queue[i];
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "rendering" as const, startedAt: Date.now() } : j,
        ),
      );

      let result = await renderOne(job, currentEmail.value, designProPanels, queue);
      for (let attempt = 1; attempt < MAX_RENDER_RETRIES && result.status === "failed"; attempt++) {
        if (abortRef.current) break;
        const backoffMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        result = await renderOne(job, currentEmail.value, designProPanels, queue);
      }

      if (watermarkRef.current && result.status === "done" && result.renderUrl) {
        const overlay = buildOverlaySpec(job);
        if (overlay) {
          try {
            const stampedUrl = await stampAndUpload(result.renderUrl, overlay);
            result = { ...result, renderUrl: stampedUrl };
          } catch (err) {
            console.warn(`[Batch] Stamp failed for ${job.id}, using original:`, err);
          }
        }
      }

      queue[i] = { ...queue[i], ...result } as PipelineJob;
      patch(job.id, result);
    };

    // Phase 1: Render all jobs
    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const canContinue = await waitWhilePaused();
      if (!canContinue) break;
      setCurrentIdx(i);

      if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
        const refreshedEmail = await refreshSession();
        if (refreshedEmail) email = refreshedEmail;
      }

      await processJob(i, { value: email });

      if (i < queue.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    // Persist
    const persistedIds: Record<string, string> = {};
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.status === "failed" || !job.renderUrl) continue;
      try {
        const vizId = await persistRender(job, {}, currentBatchId, email);
        if (vizId) persistedIds[job.id] = vizId;
      } catch (err) {
        console.error(`[ColorProBatch] Persist failed for ${job.id}:`, err);
      }
    }

    // Phase 2: Generate 7 views
    if (!abortRef.current) {
      setPhase("views");
      const refreshedEmail2 = await refreshSession();
      if (refreshedEmail2) email = refreshedEmail2;

      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;
        const canContinue = await waitWhilePaused();
        if (!canContinue) break;
        setCurrentIdx(i);

        const job = queue[i];
        if (!job || job.status === "failed" || !job.renderUrl) continue;

        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          const refreshedViewEmail = await refreshSession();
          if (refreshedViewEmail) email = refreshedViewEmail;
        }

        const views = await generateViews(job, email);

        const vizId = persistedIds[job.id];
        if (vizId && views && Object.keys(views).length > 0) {
          try {
            const renderUrls: Record<string, string> = {};
            if (job.renderUrl) renderUrls.side = job.renderUrl;
            for (const [key, url] of Object.entries(views)) {
              renderUrls[key] = url;
            }
            await supabase
              .from("color_visualizations")
              .update({ render_urls: renderUrls as Json })
              .eq("id", vizId);
          } catch {}
        }
      }
    }

    setPhase("complete");
    setRunning(false);
    watermarkRef.current = false;
  }, []);

  /* ================================================================ */
  /* DESIGNPRO PREMIUM BATCH: N random photo-integrated commercial     */
  /* ================================================================ */

  const startDesignProBatch = useCallback(async (count: number = 10, watermark = true) => {
    watermarkRef.current = watermark;

    const dpPresets = getRandomDesignProPresets(count);
    console.log(`[DesignProBatch] Loaded ${dpPresets.length} PREMIUM presets:`, dpPresets.map(p => p.designName));

    const queue: PipelineJob[] = dpPresets.map((preset) => ({
      id: `pj_${Date.now()}_${++_seq}`,
      tool: "designpro" as ToolType,
      prompt: preset.prompt,
      designName: preset.designName,
      vehicle: preset.vehicle,
      finish: "Gloss",
      status: "queued" as const,
      renderUrl: null,
      panelUrl: null,
      views: {},
      viewsProgress: 0,
      error: null,
      startedAt: null,
      durationMs: null,
      edgePayload: { mode: preset.mode },
      proofUrl: null,
      proofId: null,
    }));

    const currentBatchId = `batch_designpro_${Date.now()}`;
    setBatchId(currentBatchId);
    setJobs(queue);
    setRunning(true);
    setPaused(false);
    setPhase("rendering");
    setCurrentIdx(0);
    abortRef.current = false;
    pauseRef.current = false;

    let email: string | undefined = (await ensureAuth()) || undefined;
    if (!email) { setRunning(false); setPhase("idle"); return; }

    const designProPanels: Record<number, string> = {};
    let dpIdx = 0;

    const processJob = async (i: number, currentEmail: { value: string }) => {
      const job = queue[i];
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "rendering" as const, startedAt: Date.now() } : j,
        ),
      );

      let result = await renderOne(job, currentEmail.value, designProPanels, queue);
      for (let attempt = 1; attempt < MAX_RENDER_RETRIES && result.status === "failed"; attempt++) {
        if (abortRef.current) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
        result = await renderOne(job, currentEmail.value, designProPanels, queue);
      }

      if (result.status === "done" && result.renderUrl) {
        designProPanels[dpIdx++] = result.panelUrl || result.renderUrl;
      }

      if (watermarkRef.current && result.status === "done" && result.renderUrl) {
        const overlay = buildOverlaySpec(job);
        if (overlay) {
          try {
            const stampedUrl = await stampAndUpload(result.renderUrl, overlay);
            result = { ...result, renderUrl: stampedUrl };
          } catch (err) {
            console.warn(`[DesignProBatch] Stamp failed for ${job.id}:`, err);
          }
        }
      }

      queue[i] = { ...queue[i], ...result } as PipelineJob;
      patch(job.id, result);
    };

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const canContinue = await waitWhilePaused();
      if (!canContinue) break;
      setCurrentIdx(i);

      if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
        const refreshedEmail = await refreshSession();
        if (refreshedEmail) email = refreshedEmail;
      }

      await processJob(i, { value: email });

      if (i < queue.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    // Persist
    const persistedIds: Record<string, string> = {};
    for (const job of queue) {
      if (job.status === "failed" || !job.renderUrl) continue;
      try {
        const vizId = await persistRender(job, {}, currentBatchId, email);
        if (vizId) persistedIds[job.id] = vizId;
      } catch {}
    }

    // Phase 2: Views
    if (!abortRef.current) {
      setPhase("views");
      const re2 = await refreshSession();
      if (re2) email = re2;

      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;
        const canContinue = await waitWhilePaused();
        if (!canContinue) break;
        setCurrentIdx(i);
        const job = queue[i];
        if (!job || job.status === "failed" || !job.renderUrl) continue;

        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          const re = await refreshSession();
          if (re) email = re;
        }

        const views = await generateViews(job, email);
        const vizId = persistedIds[job.id];
        if (vizId && views && Object.keys(views).length > 0) {
          try {
            const renderUrls: Record<string, string> = {};
            if (job.renderUrl) renderUrls.side = job.renderUrl;
            for (const [key, url] of Object.entries(views)) renderUrls[key] = url;
            await supabase.from("color_visualizations").update({ render_urls: renderUrls as Json }).eq("id", vizId);
          } catch {}
        }
      }
    }

    setPhase("complete");
    setRunning(false);
    watermarkRef.current = false;
  }, []);

  return {
    jobs,
    running,
    paused,
    currentIdx,
    phase,
    stats,
    batchId,
    startPipeline,
    startMixedBatch,
    startColorProBatch,
    startDesignProBatch,
    stop,
    pause,
    resume,
  };
}
