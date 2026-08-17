// graphic-and-zone-interpreter.ts
// AI interpreter for color-change film + cut-vinyl graphics + zones + finishes
// Used by Custom Styling mode in RestylePro
// 
// ENHANCED: Expert wrap shop parsing for pinstripes, racing stripes, accent graphics

export interface ParsedGraphic {
  type: "cut_vinyl";
  keyword: string;
  layers: number; // e.g. 1 (single) or 2 (outline + fill)
  placement?: string; // "sides", "hood", "roof-to-trunk", etc.
  colors?: string[]; // Multiple colors for multi-color stripes
  width?: "pinstripe" | "stripe" | "racing"; // Width category
}

export interface ParsedZone {
  zone: string;
  color: string;
  finish: string;
  finish_profile: string; // AUTHORITATIVE - chrome, satin, matte, brushed, carbon, metallic
  manufacturer: string;
  graphic?: ParsedGraphic;
}

// ============================================================================
// COMPREHENSIVE GRAPHIC KEYWORD DICTIONARY
// ============================================================================
const GRAPHIC_KEYWORDS = [
  // Pinstripes (thin 3-6mm lines)
  "pinstripe", "pinstripes", "pin stripe", "pin stripes",
  "thin stripe", "thin stripes", "accent line", "accent lines",
  
  // Racing stripes (wide 10-30cm parallel stripes)
  "racing stripe", "racing stripes", "rally stripe", "rally stripes",
  "dual stripe", "dual stripes", "triple stripe", "triple stripes",
  "center stripe", "center stripes", "offset stripe", "offset stripes",
  "le mans stripe", "le mans stripes",
  
  // Lowrider stripes (flowing curves, scalloped edges)
  "lowrider stripe", "lowrider stripes", "low rider stripe", "low rider stripes",
  "lowrider graphics", "low rider graphics", "lowrider side stripe",
  "scallop stripe", "scallop stripes", "flame stripe", "flame stripes",
  
  // Side graphics
  "side stripe", "side stripes", "side graphic", "side graphics",
  "rocker stripe", "rocker stripes", "door stripe", "door stripes",
  
  // Hood graphics
  "hood stripe", "hood stripes", "hood accent", "hood graphic",
  "hood scoop stripe", "power bulge stripe",
  
  // Other graphics
  "fleur-de-lis", "fleur", "phoenix", "tribal",
  "number", "outline", "accent", "decal", "decals",
  "graphic", "graphics"
];

// ============================================================================
// CHROME DELETE DETECTION
// ============================================================================
const CHROME_DELETE_KEYWORDS = [
  "chrome delete", "delete chrome", "chrome blackout", 
  "blackout", "murdered out", "black out", "de-chrome",
  "chrome wrap", "wrap chrome", "chrome trim", "blacked out"
];

// Trim zones for chrome delete
const TRIM_ZONES = {
  "window_trim": /\b(window\s+trim|window\s+surrounds?|window\s+chrome)\b/i,
  "grille": /\b(grille|grill|front\s+grille)\b/i,
  "badges": /\b(badges?|emblems?|logos?)\b/i,
  "door_handles": /\b(door\s+handles?|handles?)\b/i,
  "mirror_caps": /\b(mirror\s+caps?|side\s+mirrors?|mirrors?)\b/i,
  "roof_rails": /\b(roof\s+rails?|roof\s+racks?)\b/i,
  "exhaust_tips": /\b(exhaust\s+tips?|exhaust)\b/i
};

// ============================================================================
// COMPREHENSIVE VEHICLE ZONE DICTIONARY - SENIOR WRAP DESIGNER KNOWLEDGE
// ============================================================================
const VEHICLE_ZONE_DICTIONARY: Record<string, { zone: string; patterns: RegExp[] }> = {
  // ============ BODY HALVES & SECTIONS ============
  top: {
    zone: "top",
    patterns: [
      /\b(top\s+half|upper\s+half|top\s+portion|upper\s+body|upper\s+section)\b/i,
      /\btop\b(?!\s*(down|gear|speed|model))/i
    ]
  },
  bottom: {
    zone: "bottom",
    patterns: [
      /\b(bottom\s+half|lower\s+half|bottom\s+portion|lower\s+body|lower\s+section)\b/i,
      /\bbottom\b/i
    ]
  },
  left: {
    zone: "left",
    patterns: [
      /\b(left\s+half|left\s+side|driver\s+side|driver's\s+side|port\s+side)\b/i
    ]
  },
  right: {
    zone: "right",
    patterns: [
      /\b(right\s+half|right\s+side|passenger\s+side|passenger's\s+side|starboard\s+side)\b/i
    ]
  },
  front_end: {
    zone: "front_end",
    patterns: [/\b(front\s+end|front\s+fascia|nose|front\s+clip)\b/i]
  },
  rear_end: {
    zone: "rear_end",
    patterns: [/\b(rear\s+end|back\s+end|tail|rear\s+clip)\b/i]
  },

  // ============ MAJOR PANELS ============
  hood: {
    zone: "hood",
    patterns: [/\b(hood|bonnet|engine\s+cover)\b/i]
  },
  roof: {
    zone: "roof",
    patterns: [/\b(roof|rooftop|roof\s+panel)\b/i]
  },
  trunk: {
    zone: "trunk",
    patterns: [/\b(trunk|boot|deck\s*lid|decklid|tailgate|liftgate|hatch|hatchback)\b/i]
  },
  quarter_panel: {
    zone: "quarter_panel",
    patterns: [/\b(quarter\s+panel|quarter|rear\s+fender|rear\s+quarter)\b/i]
  },
  fender: {
    zone: "fender",
    patterns: [/\b(fender|front\s+fender|wing|front\s+wing)\b/i]
  },
  doors: {
    zone: "doors",
    patterns: [/\b(doors?|front\s+doors?|rear\s+doors?)\b/i]
  },
  rockers: {
    zone: "rockers",
    patterns: [/\b(rocker|rocker\s+panel|side\s+skirt|running\s+board|step\s+board)\b/i]
  },

  // ============ PILLARS ============
  a_pillar: {
    zone: "a_pillar",
    patterns: [/\b(a[\s-]?pillar|windshield\s+pillar|front\s+pillar)\b/i]
  },
  b_pillar: {
    zone: "b_pillar",
    patterns: [/\b(b[\s-]?pillar|center\s+pillar|middle\s+pillar)\b/i]
  },
  c_pillar: {
    zone: "c_pillar",
    patterns: [/\b(c[\s-]?pillar|rear\s+pillar)\b/i]
  },
  d_pillar: {
    zone: "d_pillar",
    patterns: [/\b(d[\s-]?pillar)\b/i]
  },
  sail_panel: {
    zone: "sail_panel",
    patterns: [/\b(sail\s+panel|sail|quarter\s+glass\s+area)\b/i]
  },
  pillars: {
    zone: "pillars",
    patterns: [/\b(pillars?|all\s+pillars|window\s+pillars)\b/i]
  },

  // ============ TRIM & CHROME ============
  window_trim: {
    zone: "window_trim",
    patterns: [/\b(window\s+trim|window\s+surround|window\s+chrome|window\s+molding)\b/i]
  },
  grille: {
    zone: "grille",
    patterns: [/\b(grille|grill|front\s+grille|kidney\s+grille)\b/i]
  },
  badges: {
    zone: "badges",
    patterns: [/\b(badges?|emblems?|logos?|lettering)\b/i]
  },
  handles: {
    zone: "handles",
    patterns: [/\b(handles?|door\s+handles?)\b/i]
  },
  mirrors: {
    zone: "mirrors",
    patterns: [/\b(mirrors?|mirror\s+caps?|side\s+mirrors?|wing\s+mirrors?)\b/i]
  },
  roof_rails: {
    zone: "roof_rails",
    patterns: [/\b(roof\s+rails?|roof\s+rack|luggage\s+rails?)\b/i]
  },
  exhaust: {
    zone: "exhaust",
    patterns: [/\b(exhaust|exhaust\s+tips?|tailpipes?)\b/i]
  },
  belt_line: {
    zone: "belt_line",
    patterns: [/\b(belt\s*line|beltline|window\s+line)\b/i]
  },
  character_line: {
    zone: "character_line",
    patterns: [/\b(character\s+line|body\s+line|crease\s+line|feature\s+line)\b/i]
  },

  // ============ AERODYNAMICS ============
  splitter: {
    zone: "splitter",
    patterns: [/\b(splitter|front\s+splitter|chin\s+spoiler|front\s+lip|air\s+dam)\b/i]
  },
  spoiler: {
    zone: "spoiler",
    patterns: [/\b(spoiler|rear\s+spoiler|wing|rear\s+wing|duckbill|ducktail)\b/i]
  },
  diffuser: {
    zone: "diffuser",
    patterns: [/\b(diffuser|rear\s+diffuser)\b/i]
  },
  side_skirts: {
    zone: "side_skirts",
    patterns: [/\b(side\s+skirts?|ground\s+effects?|aero\s+skirts?)\b/i]
  },
  canards: {
    zone: "canards",
    patterns: [/\b(canards?|dive\s+planes?|aero\s+fins?)\b/i]
  },
  flares: {
    zone: "flares",
    patterns: [/\b(flares?|fender\s+flares?|wheel\s+arch\s+flares?|wide\s+body)\b/i]
  },
  vents: {
    zone: "vents",
    patterns: [/\b(vents?|hood\s+vents?|fender\s+vents?|side\s+vents?)\b/i]
  },
  scoops: {
    zone: "scoops",
    patterns: [/\b(scoops?|hood\s+scoop|air\s+scoops?|power\s+bulge)\b/i]
  },

  // ============ WHEELS & BRAKES ============
  calipers: {
    zone: "calipers",
    patterns: [/\b(calipers?|brake\s+calipers?|brakes?)\b/i]
  },
  wheel_wells: {
    zone: "wheel_wells",
    patterns: [/\b(wheel\s+wells?|wheel\s+arch|fender\s+lip|inner\s+fender)\b/i]
  },
  wheels: {
    zone: "wheels",
    patterns: [/\b(wheels?|rims?|alloys?)\b/i]
  },

  // ============ BUMPERS ============
  front_bumper: {
    zone: "front_bumper",
    patterns: [/\b(front\s+bumper|front\s+fascia|front\s+valance)\b/i]
  },
  rear_bumper: {
    zone: "rear_bumper",
    patterns: [/\b(rear\s+bumper|rear\s+fascia|rear\s+valance)\b/i]
  },
  bumpers: {
    zone: "bumpers",
    patterns: [/\bbumpers?\b/i]
  },

  // ============ TRUCK-SPECIFIC ============
  bed: {
    zone: "bed",
    patterns: [/\b(bed|truck\s+bed|pickup\s+bed|cargo\s+bed)\b/i]
  },
  tonneau: {
    zone: "tonneau",
    patterns: [/\b(tonneau|bed\s+cover|tonneau\s+cover)\b/i]
  },
  cab: {
    zone: "cab",
    patterns: [/\b(cab|crew\s+cab|extended\s+cab|regular\s+cab|single\s+cab)\b/i]
  },
  bed_rails: {
    zone: "bed_rails",
    patterns: [/\b(bed\s+rails?|bed\s+caps?|rail\s+caps?)\b/i]
  },
  tailgate: {
    zone: "tailgate",
    patterns: [/\b(tailgate|tail\s+gate)\b/i]
  },
  bull_bar: {
    zone: "bull_bar",
    patterns: [/\b(bull\s+bar|grille\s+guard|brush\s+guard|push\s+bar)\b/i]
  },

  // ============ GLASS & TRIM AREAS ============
  windshield_strip: {
    zone: "windshield_strip",
    patterns: [/\b(windshield\s+strip|windshield\s+banner|visor\s+strip|sun\s+strip)\b/i]
  },
  rear_window: {
    zone: "rear_window",
    patterns: [/\b(rear\s+window|back\s+glass|rear\s+glass)\b/i]
  },
  greenhouse: {
    zone: "greenhouse",
    patterns: [/\b(greenhouse|glass\s+area|cabin\s+area)\b/i]
  },

  // ============ SPECIAL ZONES ============
  accents: {
    zone: "accents",
    patterns: [/\b(accents?|accent\s+pieces?|highlights?)\b/i]
  },
  body: {
    zone: "body",
    patterns: [/\b(body|full\s+body|entire\s+body|whole\s+body)\b/i]
  },
  full: {
    zone: "full",
    patterns: [/\b(full|entire|whole|complete)\b/i]
  }
};

/**
 * Detect zone from text using comprehensive dictionary
 */
function detectZone(text: string): string {
  const lower = text.toLowerCase();
  
  // Check each zone in dictionary
  for (const [key, config] of Object.entries(VEHICLE_ZONE_DICTIONARY)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lower)) {
        return config.zone;
      }
    }
  }
  
  return "body"; // Default to body if no zone detected
}

// Placement detection patterns
const PLACEMENT_PATTERNS = {
  "sides": /\b(along|on)\s*(the\s+)?(sides?|doors?|panels?)\b/i,
  "hood": /\b(on\s+)?(the\s+)?hood\b/i,
  "roof": /\b(on\s+)?(the\s+)?roof\b/i,
  "trunk": /\b(on\s+)?(the\s+)?trunk\b/i,
  "roof-to-trunk": /\b(front\s+to\s+back|hood\s+to\s+trunk|center|down\s+the\s+middle)\b/i,
  "fenders": /\b(on\s+)?(the\s+)?fenders?\b/i,
  "rockers": /\b(on\s+)?(the\s+)?rockers?\b/i,
};

// If the user does NOT specify a manufacturer, we choose the correct real film
const FINISH_FALLBACKS: Record<string, string> = {
  gloss: "3M 2080 Gloss",
  satin: "Avery SW900 Satin",
  matte: "Avery SW900 Matte",
  chrome: "Avery Chrome",
  metallic: "3M 2080 Metallic",
  brushed: "3M 2080 Brushed",
  carbon: "3M Carbon Fiber CF12",
  "carbon fiber": "3M Carbon Fiber CF12"
};

// All colors we can detect
const ALL_COLORS = [
  'red', 'blue', 'green', 'black', 'white', 'gold', 'silver', 
  'yellow', 'purple', 'pink', 'orange', 'bronze', 'copper',
  'gray', 'grey', 'navy', 'teal', 'cyan', 'magenta', 'lime',
  'maroon', 'burgundy', 'tan', 'beige', 'cream', 'charcoal'
];

/**
 * Detect all colors mentioned in a segment
 */
function detectColors(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const color of ALL_COLORS) {
    if (lower.includes(color)) {
      found.push(color.charAt(0).toUpperCase() + color.slice(1));
    }
  }
  return found.length > 0 ? found : ['Custom'];
}

/**
 * Detect graphic placement from text
 */
function detectPlacement(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [placement, pattern] of Object.entries(PLACEMENT_PATTERNS)) {
    if (pattern.test(lower)) {
      return placement;
    }
  }
  return undefined;
}

/**
 * Detect graphic width category
 */
function detectWidthCategory(keyword: string): "pinstripe" | "stripe" | "racing" {
  const lower = keyword.toLowerCase();
  if (lower.includes('pinstripe') || lower.includes('thin') || lower.includes('accent line')) {
    return "pinstripe";
  }
  if (lower.includes('racing') || lower.includes('rally') || lower.includes('dual') || 
      lower.includes('triple') || lower.includes('le mans') || lower.includes('center stripe')) {
    return "racing";
  }
  return "stripe";
}

/**
 * Interprets ANY natural language styling request with EXPERT WRAP SHOP KNOWLEDGE
 * 
 * Examples:
 * - "blue corvette with silver and white pinstripes along sides"
 * - "hood in gloss carbon fiber, calipers in Avery Carmine Red"
 * - "top half gold chrome, bottom half satin black"
 * - "red mustang with white racing stripes"
 */
export function interpretCustomStyling(prompt: string): ParsedZone[] {
  const lower = prompt.toLowerCase();
  console.log('🔍 Interpreting styling prompt:', prompt);

  const zones: ParsedZone[] = [];

  // ============================================================================
  // PHASE 0: CHROME DELETE DETECTION (Process FIRST before other parsing)
  // ============================================================================
  const isChromeDelete = CHROME_DELETE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
  
  if (isChromeDelete) {
    console.log('🔧 Chrome Delete request detected!');
    
    // Extract target color for chrome delete (default to matte black)
    let deleteColor = 'Black';
    let deleteFinish = 'Matte';
    
    // Check for specific color mentions
    const colorMatch = lower.match(/chrome\s+delete\s+(\w+)\s+(\w+)/i) || 
                       lower.match(/(\w+)\s+(\w+)\s+chrome\s+delete/i) ||
                       lower.match(/blacked?\s+out\s+(\w+)?/i);
    
    if (lower.includes('gloss')) deleteFinish = 'Gloss';
    if (lower.includes('satin')) deleteFinish = 'Satin';
    
    // Detect color
    for (const color of ALL_COLORS) {
      if (lower.includes(color) && color !== 'black') {
        deleteColor = color.charAt(0).toUpperCase() + color.slice(1);
        break;
      }
    }
    
    // Create chrome delete zone that covers all trim
    zones.push({
      zone: 'chrome_delete',
      color: deleteColor,
      finish: deleteFinish,
      finish_profile: deleteFinish.toLowerCase(),
      manufacturer: `${FINISH_FALLBACKS[deleteFinish.toLowerCase()] || 'Avery SW900 Matte'} ${deleteColor}`
    });
    
    console.log(`✂️ Chrome Delete: ${deleteFinish} ${deleteColor} on all chrome trim`);
    
    // If "murdered out" - also add body color as gloss black
    if (lower.includes('murdered out') || lower.includes('blacked out')) {
      zones.push({
        zone: 'body',
        color: 'Black',
        finish: 'Gloss',
        finish_profile: 'gloss',
        manufacturer: '3M 2080 Gloss Black'
      });
    }
  }

  // ============================================================================
  // PHASE 0.5: CALIPER DETECTION (Specific zone)
  // ============================================================================
  if (lower.includes('caliper') || lower.includes('brakes')) {
    console.log('🔴 Caliper color request detected!');
    
    let caliperColor = 'Red'; // Default
    for (const color of ALL_COLORS) {
      if (lower.includes(color)) {
        caliperColor = color.charAt(0).toUpperCase() + color.slice(1);
        break;
      }
    }
    
    zones.push({
      zone: 'calipers',
      color: caliperColor,
      finish: 'Gloss',
      finish_profile: 'gloss',
      manufacturer: `High-Temp Caliper ${caliperColor}`
    });
    
    console.log(`🎨 Calipers: Gloss ${caliperColor}`);
  }

  // ============================================================================
  // PHASE 1: Detect if this is a GRAPHIC request (pinstripes, racing stripes, etc.)
  // ============================================================================
  const hasGraphicRequest = GRAPHIC_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
  
  // Detect base vehicle color - PRIORITIZE "on [color] car" pattern
  let baseVehicleColor = 'Custom';
  
  // Pattern: "on [color] car/vehicle" - this is the CAR's color, not stripe color
  const onColorCarMatch = lower.match(/\bon\s+(\w+)\s+(?:car|vehicle|truck|suv|sedan|coupe)\b/i);
  if (onColorCarMatch) {
    const potentialColor = onColorCarMatch[1].toLowerCase();
    if (ALL_COLORS.includes(potentialColor)) {
      baseVehicleColor = potentialColor.charAt(0).toUpperCase() + potentialColor.slice(1);
      console.log(`🚗 Base vehicle color detected from "on ${baseVehicleColor} car" pattern`);
    }
  }
  
  // Pattern: "[color] car/vehicle" at start
  if (baseVehicleColor === 'Custom') {
    const colorCarMatch = lower.match(/^(\w+)\s+(?:car|vehicle|truck|suv|sedan|coupe)\b/i);
    if (colorCarMatch) {
      const potentialColor = colorCarMatch[1].toLowerCase();
      if (ALL_COLORS.includes(potentialColor)) {
        baseVehicleColor = potentialColor.charAt(0).toUpperCase() + potentialColor.slice(1);
        console.log(`🚗 Base vehicle color detected from "${baseVehicleColor} car" pattern`);
      }
    }
  }
  
  // Fallback: first color mentioned (but only if not part of stripe description)
  if (baseVehicleColor === 'Custom') {
    const firstColorMatch = lower.match(new RegExp(`\\b(${ALL_COLORS.join('|')})\\b`, 'i'));
    if (firstColorMatch) {
      // Only use if NOT followed by stripe-related words
      const colorIndex = lower.indexOf(firstColorMatch[1].toLowerCase());
      const afterColor = lower.slice(colorIndex);
      if (!afterColor.match(/^\w+\s+(stripe|pinstripe|accent|line|racing)/i)) {
        baseVehicleColor = firstColorMatch[1].charAt(0).toUpperCase() + firstColorMatch[1].slice(1);
      }
    }
  }

  // ============================================================================
  // PHASE 1.5: TWO-TONE SPECIFIC PARSING (MUST come before generic parsing)
  // Supports: top/bottom (horizontal) AND left/right (vertical) splits
  // ============================================================================
  const isHorizontalTwoTone = lower.includes('two tone') || lower.includes('two-tone') ||
    (lower.includes('top') && lower.includes('bottom')) ||
    ((lower.includes('top half') || lower.includes('upper half')) && 
     (lower.includes('bottom half') || lower.includes('lower half')));
  
  const isVerticalTwoTone = 
    ((lower.includes('left half') || lower.includes('left side') || lower.includes('driver side') || lower.includes("driver's side")) && 
     (lower.includes('right half') || lower.includes('right side') || lower.includes('passenger side') || lower.includes("passenger's side")));

  const isTwoTone = isHorizontalTwoTone || isVerticalTwoTone;

  if (isTwoTone && !hasGraphicRequest && !isChromeDelete) {
    console.log('🎨 TWO-TONE pattern detected, using special parsing...');
    console.log(`   Type: ${isVerticalTwoTone ? 'VERTICAL (left/right)' : 'HORIZONTAL (top/bottom)'}`);
    
    // Helper to extract finish from text
    const extractFinish = (text: string): string => {
      const t = text.toLowerCase();
      if (t.includes('chrome')) return 'Chrome';
      if (t.includes('satin')) return 'Satin';
      if (t.includes('matte')) return 'Matte';
      if (t.includes('brushed')) return 'Brushed';
      if (t.includes('carbon')) return 'Carbon Fiber';
      if (t.includes('metallic')) return 'Metallic';
      return 'Gloss';
    };
    
    // Helper to extract color from text
    const extractColor = (text: string): string => {
      const t = text.toLowerCase();
      for (const color of ALL_COLORS) {
        if (t.includes(color)) {
          return color.charAt(0).toUpperCase() + color.slice(1);
        }
      }
      return 'Custom';
    };

    // Try multiple parsing patterns for two-tone
    let topColor = '';
    let topFinish = '';
    let bottomColor = '';
    let bottomFinish = '';
    let twoToneParsed = false;

    // =========================================================================
    // Pattern D (PRIORITY): "upper body... in [color finish], lower body... in [color finish]"
    // Handles preset format: "upper body including roof and pillars in satin black, lower body including fenders and doors in gold chrome"
    // =========================================================================
    const patternD = lower.match(/(?:upper|top)\s+(?:body|half).*?\bin\s+(.+?),.*?(?:lower|bottom)\s+(?:body|half).*?\bin\s+(.+)/i);
    
    if (patternD) {
      console.log('🔍 Two-tone Pattern D detected (upper/lower body... in [color])');
      const topPart = patternD[1].trim(); // "satin black"
      const bottomPart = patternD[2].trim(); // "gold chrome"
      
      console.log('  TOP part:', topPart);
      console.log('  BOTTOM part:', bottomPart);
      
      topColor = extractColor(topPart);
      topFinish = extractFinish(topPart);
      bottomColor = extractColor(bottomPart);
      bottomFinish = extractFinish(bottomPart);
      
      twoToneParsed = topColor !== 'Custom' || bottomColor !== 'Custom';
    }

    // =========================================================================
    // Pattern E (HIGHEST PRIORITY): "top half [COLOR FINISH] bottom half [COLOR FINISH]"
    // User typed: "top half gold chrome bottom half satin black"
    // Colors come AFTER zone keywords - use greedy+lookahead for reliable capture
    // =========================================================================
    if (!twoToneParsed) {
      // Use ^ anchor and greedy capture with lookahead to properly split at "bottom half"
      const patternE = lower.match(/^(?:top\s+half|upper\s+half)\s+(.+?)\s+(?:bottom\s+half|lower\s+half)\s+(.+)$/i);
      
      if (patternE) {
        const topPart = patternE[1].trim(); // "gold chrome"
        const bottomPart = patternE[2].trim(); // "satin black"
        
        console.log('🔍 Two-tone Pattern E detected (top half [color], bottom half [color])');
        console.log('  TOP part:', topPart);
        console.log('  BOTTOM part:', bottomPart);
        
        topColor = extractColor(topPart);
        topFinish = extractFinish(topPart);
        bottomColor = extractColor(bottomPart);
        bottomFinish = extractFinish(bottomPart);
        
        // Validate we actually found usable colors
        const topValid = topColor !== 'Custom' || topPart.length > 0;
        const bottomValid = bottomColor !== 'Custom' || bottomPart.length > 0;
        twoToneParsed = topValid && bottomValid;
        
        if (twoToneParsed) {
          console.log(`✅ Pattern E SUCCESS: TOP=${topColor} ${topFinish}, BOTTOM=${bottomColor} ${bottomFinish}`);
        }
      }
    }

    // =========================================================================
    // Pattern F (NEW): "[color] top half bottom half [color]" - ADJACENT ZONE KEYWORDS
    // User typed: "Gold chrome top half bottom half satin black"
    // No color BETWEEN zones - color1 is BEFORE top half, color2 is AFTER bottom half
    // =========================================================================
    if (!twoToneParsed) {
      const normalized = lower.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Pattern F: [color] top half [,] bottom half [color]
      const patternF = normalized.match(/^(.+?)\s*(?:top\s+half|upper\s+half)\s*[,]?\s*(?:bottom\s+half|lower\s+half)\s+(.+)$/i);
      
      if (patternF) {
        const beforeTop = patternF[1].trim();
        const afterBottom = patternF[2].trim();
        
        console.log('🔍 Two-tone Pattern F detected (adjacent zones):');
        console.log('  Before TOP HALF:', beforeTop);
        console.log('  After BOTTOM HALF:', afterBottom);
        
        topColor = extractColor(beforeTop);
        topFinish = extractFinish(beforeTop);
        bottomColor = extractColor(afterBottom);
        bottomFinish = extractFinish(afterBottom);
        
        if (topColor !== 'Custom' || bottomColor !== 'Custom') {
          console.log(`✅ Pattern F SUCCESS: TOP=${topColor} ${topFinish}, BOTTOM=${bottomColor} ${bottomFinish}`);
          twoToneParsed = true;
        }
      }
    }

    // =========================================================================
    // Pattern G (HIGHEST): "[color] on top half [color] on bottom half"
    // User typed: "gold chrome on top half satin black on bottom half"
    // Handles "on" keyword explicitly
    // =========================================================================
    if (!twoToneParsed) {
      const normalized = lower.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Match: [color] on top half [color] on bottom half
      const patternG = normalized.match(/^(?:two[\s-]?tone\s+)?(.+?)\s+on\s+(?:top\s+half|upper\s+half)\s+(.+?)\s+on\s+(?:bottom\s+half|lower\s+half)$/i);
      
      if (patternG) {
        const topPart = patternG[1].trim();
        const bottomPart = patternG[2].trim();
        
        console.log('🔍 Two-tone Pattern G detected ([color] ON top half [color] ON bottom half):');
        console.log('  TOP part:', topPart);
        console.log('  BOTTOM part:', bottomPart);
        
        topColor = extractColor(topPart);
        topFinish = extractFinish(topPart);
        bottomColor = extractColor(bottomPart);
        bottomFinish = extractFinish(bottomPart);
        
        if (topColor !== 'Custom' || bottomColor !== 'Custom') {
          console.log(`✅ Pattern G SUCCESS: TOP=${topColor} ${topFinish}, BOTTOM=${bottomColor} ${bottomFinish}`);
          twoToneParsed = true;
        }
      }
    }

    // =========================================================================
    // Pattern A: "[color finish] top half [extra words] [color finish] bottom half"
    // User typed: "gold chrome top half of vehicle satin black bottom half"
    // Colors come BEFORE zone keywords - handle extra words between zones
    // =========================================================================
    if (!twoToneParsed) {
      // Normalize: remove newlines, collapse whitespace
      const normalized = lower.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Match: [color] before "top half", then something between, then "bottom half"
      const patternA = normalized.match(/^(?:two[\s-]?tone\s+)?(.+?)\s+(?:top\s+half|upper\s+half)(?:\s+of\s+(?:the\s+)?(?:vehicle|car|truck|suv))?\s*[,]?\s+(.+?)\s+(?:bottom\s+half|lower\s+half)/i);
      
      if (patternA) {
        const beforeTop = patternA[1].trim();
        let betweenTopBottom = patternA[2].trim();
        
        // Remove common filler words from betweenTopBottom
        betweenTopBottom = betweenTopBottom
          .replace(/^(?:of\s+(?:the\s+)?(?:vehicle|car|truck|suv)\s*)?/i, '')
          .replace(/\s*,\s*$/, '')
          .trim();
        
        // Only use if we found actual color between the zones
        const foundTopColor = extractColor(beforeTop);
        const foundBottomColor = extractColor(betweenTopBottom);
        
        console.log('🔍 Two-tone Pattern A attempting:');
        console.log('  Before TOP:', beforeTop, '→ color:', foundTopColor);
        console.log('  Between TOP-BOTTOM:', betweenTopBottom, '→ color:', foundBottomColor);
        
        // Pattern A requires content BETWEEN the zones
        if (betweenTopBottom.length > 0 && (foundTopColor !== 'Custom' || foundBottomColor !== 'Custom')) {
          console.log('✅ Two-tone Pattern A SUCCESS ([color] top half [color] bottom half)');
          
          topColor = foundTopColor;
          topFinish = extractFinish(beforeTop);
          bottomColor = foundBottomColor;
          bottomFinish = extractFinish(betweenTopBottom);
          
          twoToneParsed = true;
        }
      }
    }

    // =========================================================================
    // Pattern C: "top half in gold chrome, bottom half in satin black"
    // =========================================================================
    if (!twoToneParsed) {
      const patternC = lower.match(/(?:top\s*half|upper\s*half)\s+(?:in\s+)?(.+?)(?:,|and|;)\s*(?:bottom\s*half|lower\s*half)\s+(?:in\s+)?(.+)/i);
      if (patternC) {
        console.log('🔍 Two-tone Pattern C detected');
        const topPart = patternC[1].trim();
        const bottomPart = patternC[2].trim();
        
        topColor = extractColor(topPart);
        topFinish = extractFinish(topPart);
        bottomColor = extractColor(bottomPart);
        bottomFinish = extractFinish(bottomPart);
        
        twoToneParsed = topColor !== 'Custom' || bottomColor !== 'Custom';
      }
    }

    // =========================================================================
    // VERTICAL TWO-TONE: Left/Right Side Patterns
    // =========================================================================
    let leftColor = '';
    let leftFinish = '';
    let rightColor = '';
    let rightFinish = '';
    let verticalTwoToneParsed = false;

    if (isVerticalTwoTone && !twoToneParsed) {
      console.log('🔍 Attempting VERTICAL (left/right) two-tone parsing...');

      // Pattern V1: "left half [COLOR] right half [COLOR]"
      const patternV1 = lower.match(/(?:left\s+(?:half|side)|driver(?:'?s)?\s+side)\s+(.+?)\s+(?:right\s+(?:half|side)|passenger(?:'?s)?\s+side)\s+(.+?)(?:\s+with|$)/i);
      
      if (patternV1) {
        const leftPart = patternV1[1].trim();
        const rightPart = patternV1[2].trim();
        
        console.log('🔍 Vertical Pattern V1 detected (left half [color] right half [color]):');
        console.log('  LEFT part:', leftPart);
        console.log('  RIGHT part:', rightPart);
        
        leftColor = extractColor(leftPart);
        leftFinish = extractFinish(leftPart);
        rightColor = extractColor(rightPart);
        rightFinish = extractFinish(rightPart);
        
        if (leftColor !== 'Custom' || rightColor !== 'Custom') {
          console.log(`✅ Pattern V1 SUCCESS: LEFT=${leftColor} ${leftFinish}, RIGHT=${rightColor} ${rightFinish}`);
          verticalTwoToneParsed = true;
        }
      }

      // Pattern V2: "[COLOR] on left side [COLOR] on right side"
      if (!verticalTwoToneParsed) {
        const patternV2 = lower.match(/(.+?)\s+(?:on\s+)?(?:left\s+(?:half|side)|driver(?:'?s)?\s+side)\s+(.+?)\s+(?:on\s+)?(?:right\s+(?:half|side)|passenger(?:'?s)?\s+side)/i);
        
        if (patternV2) {
          const leftPart = patternV2[1].trim();
          const rightPart = patternV2[2].trim();
          
          console.log('🔍 Vertical Pattern V2 detected ([color] on left side [color] on right side):');
          console.log('  LEFT part:', leftPart);
          console.log('  RIGHT part:', rightPart);
          
          leftColor = extractColor(leftPart);
          leftFinish = extractFinish(leftPart);
          rightColor = extractColor(rightPart);
          rightFinish = extractFinish(rightPart);
          
          if (leftColor !== 'Custom' || rightColor !== 'Custom') {
            console.log(`✅ Pattern V2 SUCCESS: LEFT=${leftColor} ${leftFinish}, RIGHT=${rightColor} ${rightFinish}`);
            verticalTwoToneParsed = true;
          }
        }
      }

      // Pattern V3: "left side in [COLOR], right side in [COLOR]"
      if (!verticalTwoToneParsed) {
        const patternV3 = lower.match(/(?:left\s+(?:half|side)|driver(?:'?s)?\s+side)\s+(?:in\s+)?(.+?)(?:,|and|;)\s*(?:right\s+(?:half|side)|passenger(?:'?s)?\s+side)\s+(?:in\s+)?(.+)/i);
        
        if (patternV3) {
          const leftPart = patternV3[1].trim();
          const rightPart = patternV3[2].trim();
          
          console.log('🔍 Vertical Pattern V3 detected (left side in [color], right side in [color]):');
          console.log('  LEFT part:', leftPart);
          console.log('  RIGHT part:', rightPart);
          
          leftColor = extractColor(leftPart);
          leftFinish = extractFinish(leftPart);
          rightColor = extractColor(rightPart);
          rightFinish = extractFinish(rightPart);
          
          if (leftColor !== 'Custom' || rightColor !== 'Custom') {
            console.log(`✅ Pattern V3 SUCCESS: LEFT=${leftColor} ${leftFinish}, RIGHT=${rightColor} ${rightFinish}`);
            verticalTwoToneParsed = true;
          }
        }
      }
    }

    // =========================================================================
    // CENTER STRIPE WITH SIDE SPLITS
    // Pattern: "left side [COLOR] right side [COLOR] with [COLOR] stripe down center"
    // =========================================================================
    let centerStripeColor = '';
    let centerStripeFinish = '';
    let hasCenterStripe = false;

    if (lower.includes('stripe') && (lower.includes('center') || lower.includes('middle') || lower.includes('down the middle'))) {
      const centerMatch = lower.match(/(?:with\s+)?(\w+(?:\s+\w+)?)\s+(?:stripe|pinstripe|racing\s+stripe)\s+(?:down\s+)?(?:the\s+)?(?:center|middle)/i) ||
                          lower.match(/(?:center|middle)\s+(?:stripe|pinstripe)\s+(?:in\s+)?(\w+(?:\s+\w+)?)/i);
      
      if (centerMatch) {
        const stripePart = centerMatch[1].trim();
        centerStripeColor = extractColor(stripePart);
        centerStripeFinish = extractFinish(stripePart);
        hasCenterStripe = true;
        console.log(`🎯 Center stripe detected: ${centerStripeColor} ${centerStripeFinish}`);
      }
    }

    // =========================================================================
    // BUILD ZONES FROM PARSED TWO-TONE DATA
    // =========================================================================
    if (twoToneParsed) {
      console.log(`✅ Two-tone parsed: TOP=${topColor} ${topFinish}, BOTTOM=${bottomColor} ${bottomFinish}`);
      
      // Create TOP zone
      const topManuKey = topFinish.toLowerCase();
      let topManufacturer = FINISH_FALLBACKS[topManuKey] || 'Avery SW900 Gloss';
      if (topColor !== 'Custom') topManufacturer += ` ${topColor}`;
      
      zones.push({
        zone: 'top',
        color: topColor,
        finish: topFinish,
        finish_profile: topFinish.toLowerCase().replace(' ', '_'),
        manufacturer: topManufacturer
      });
      
      // Create BOTTOM zone
      const bottomManuKey = bottomFinish.toLowerCase();
      let bottomManufacturer = FINISH_FALLBACKS[bottomManuKey] || 'Avery SW900 Gloss';
      if (bottomColor !== 'Custom') bottomManufacturer += ` ${bottomColor}`;
      
      zones.push({
        zone: 'bottom',
        color: bottomColor,
        finish: bottomFinish,
        finish_profile: bottomFinish.toLowerCase().replace(' ', '_'),
        manufacturer: bottomManufacturer
      });
      
      console.log('🔍 Horizontal two-tone zones created:', JSON.stringify(zones, null, 2));
      
      // Skip generic parsing - return early with two-tone zones
      return zones;
    }

    if (verticalTwoToneParsed) {
      console.log(`✅ Vertical two-tone parsed: LEFT=${leftColor} ${leftFinish}, RIGHT=${rightColor} ${rightFinish}`);
      
      // Create LEFT zone
      const leftManuKey = leftFinish.toLowerCase();
      let leftManufacturer = FINISH_FALLBACKS[leftManuKey] || 'Avery SW900 Gloss';
      if (leftColor !== 'Custom') leftManufacturer += ` ${leftColor}`;
      
      zones.push({
        zone: 'left',
        color: leftColor,
        finish: leftFinish,
        finish_profile: leftFinish.toLowerCase().replace(' ', '_'),
        manufacturer: leftManufacturer
      });
      
      // Create RIGHT zone
      const rightManuKey = rightFinish.toLowerCase();
      let rightManufacturer = FINISH_FALLBACKS[rightManuKey] || 'Avery SW900 Gloss';
      if (rightColor !== 'Custom') rightManufacturer += ` ${rightColor}`;
      
      zones.push({
        zone: 'right',
        color: rightColor,
        finish: rightFinish,
        finish_profile: rightFinish.toLowerCase().replace(' ', '_'),
        manufacturer: rightManufacturer
      });

      // Add center stripe if detected
      if (hasCenterStripe) {
        const stripeManuKey = centerStripeFinish.toLowerCase();
        let stripeManufacturer = FINISH_FALLBACKS[stripeManuKey] || 'Cut Vinyl';
        if (centerStripeColor !== 'Custom') stripeManufacturer += ` ${centerStripeColor}`;
        
        zones.push({
          zone: 'center_stripe',
          color: centerStripeColor,
          finish: centerStripeFinish,
          finish_profile: centerStripeFinish.toLowerCase().replace(' ', '_'),
          manufacturer: stripeManufacturer,
          graphic: {
            type: 'cut_vinyl',
            keyword: 'center stripe',
            layers: 1,
            placement: 'roof-to-trunk',
            colors: [centerStripeColor],
            width: 'racing'
          }
        });
        console.log(`🎯 Center stripe zone added: ${centerStripeColor} ${centerStripeFinish}`);
      }
      
      console.log('🔍 Vertical two-tone zones created:', JSON.stringify(zones, null, 2));
      
      // Skip generic parsing - return early with vertical two-tone zones
      return zones;
    }
  }

  // ============================================================================
  // PHASE 2: Parse graphic-specific requests
  // ============================================================================
  if (hasGraphicRequest && !isChromeDelete) {
    console.log('🎨 Graphic request detected, parsing graphics...');
    
    // Create base body zone with detected color
    const baseFinish = lower.includes('satin') ? 'Satin' : 
                       lower.includes('matte') ? 'Matte' : 
                       lower.includes('chrome') ? 'Chrome' : 'Gloss';
    
    zones.push({
      zone: 'body',
      color: baseVehicleColor,
      finish: baseFinish,
      finish_profile: baseFinish.toLowerCase(),
      manufacturer: FINISH_FALLBACKS[baseFinish.toLowerCase()] || 'Avery SW900 Gloss'
    });
    
    // Parse graphic details
    for (const keyword of GRAPHIC_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        // Find colors mentioned after the graphic keyword or with "and"
        const graphicColors = detectColors(lower);
        // Remove base vehicle color from graphic colors
        const stripeColors = graphicColors.filter(c => c.toLowerCase() !== baseVehicleColor.toLowerCase());
        
        const placement = detectPlacement(lower);
        const widthCategory = detectWidthCategory(keyword);
        
        const graphic: ParsedGraphic = {
          type: 'cut_vinyl',
          keyword,
          layers: stripeColors.length > 1 ? stripeColors.length : 1,
          placement: placement || (widthCategory === 'racing' ? 'roof-to-trunk' : 'sides'),
          colors: stripeColors.length > 0 ? stripeColors : ['Silver'],
          width: widthCategory
        };
        
        // Add graphic zone
        zones.push({
          zone: graphic.placement || 'accent',
          color: stripeColors[0] || 'Silver',
          finish: 'Gloss',
          finish_profile: 'gloss',
          manufacturer: 'Cut Vinyl',
          graphic
        });
        
        console.log('✂️ Parsed graphic:', JSON.stringify(graphic, null, 2));
        break; // Only process first matching graphic keyword
      }
    }
  }
  
  // ============================================================================
  // PHASE 3: Parse zone-based requests (multi-zone, single zones)
  // ============================================================================
  if (!hasGraphicRequest || zones.length === 0) {
    // Enhanced splitting for zone-based prompts
    const segments = prompt
      .split(/(?:and|,|with|;|\s+(?=(?:top|bottom|hood|roof|caliper|mirror|handle|door|fender|bumper)\s+(?:half\s+)?(?:in\s+)?)|(?<=chrome|satin|matte|gloss|black|white|gold|silver|red|blue|green|yellow|purple|pink|orange|bronze|copper)\s+(?=(?:top|bottom|hood|roof|caliper|mirror|handle|door|fender|bumper)))/i)
      .map(s => s.trim())
      .filter(Boolean);

    console.log('🔍 Segments after split:', JSON.stringify(segments));

    for (const segment of segments) {
      const segLower = segment.toLowerCase();

      // Zone Detection - Use comprehensive dictionary
      const zone = detectZone(segment);

      // Finish Detection
      let finish = "Gloss";
      if (segLower.includes("satin")) finish = "Satin";
      if (segLower.includes("matte")) finish = "Matte";
      if (segLower.includes("chrome")) finish = "Chrome";
      if (segLower.includes("carbon")) finish = "Carbon Fiber";
      if (segLower.includes("brushed")) finish = "Brushed";

      // Color Detection
      const colors = detectColors(segment);
      const color = colors[0] || 'Custom';

      // Gold → Gold Chrome Default
      let manufacturerFilm: string;
      if (color.toLowerCase() === "gold" && !segLower.includes("satin") && !segLower.includes("matte") && !segLower.includes("gloss")) {
        finish = "Chrome";
        manufacturerFilm = "Avery Gold Chrome";
      } else {
        const manuKey = finish.toLowerCase();
        manufacturerFilm = FINISH_FALLBACKS[manuKey] || "Avery SW900 Gloss";
        if (color !== 'Custom') {
          manufacturerFilm += ` ${color}`;
        }
      }

      zones.push({
        zone,
        color,
        finish,
        finish_profile: finish.toLowerCase(),
        manufacturer: manufacturerFilm
      });
    }
  }

  // Deduplicate zones
  const uniqueZones = zones.reduce((acc, zone) => {
    const existing = acc.find(z => z.zone === zone.zone && !z.graphic);
    if (!existing || zone.graphic) {
      acc.push(zone);
    } else if (zone.color !== 'Custom' && existing.color === 'Custom') {
      const idx = acc.indexOf(existing);
      acc[idx] = zone;
    }
    return acc;
  }, [] as ParsedZone[]);

  console.log('🔍 Final parsed zones:', JSON.stringify(uniqueZones, null, 2));

  return uniqueZones;
}
