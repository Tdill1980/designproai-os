/**
 * 4-LAYER IRONCLAD PROMPT ENGINE
 * For 99% accurate, editable wrap-design modifications across all RestylePro tools
 * 
 * This engine ensures:
 * - Zero geometry drift
 * - Zero angle changes
 * - Zero crop changes
 * - Perfect continuity across vehicle surfaces
 * - Accurate color/pattern/finish modifications
 */

// ============= LAYER 1: GEOMETRY LOCK (NON-NEGOTIABLE) =============
export const GEOMETRY_LOCK_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 GEOMETRY LOCK — ABSOLUTE PRESERVATION REQUIRED 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST preserve every geometric aspect of the vehicle EXACTLY:

✅ MUST PRESERVE:
• Exact camera angle - NO rotation, NO perspective changes
• Exact field of view - NO zoom in/out
• Exact cropping and framing - NO border changes
• Exact body shape, geometry, creases and reflections
• Exact panel outlines and dimensions
• Exact window shape and placement
• Identical wheels, tires, headlights, mirrors
• Identical background unless user specifically requests otherwise
• Exact vehicle proportions and silhouette
• Exact shadow positions and lighting direction

❌ UNDER NO CIRCUMSTANCES MAY YOU:
• Change the angle or camera position
• Change the silhouette or proportions
• Alter the crop or aspect ratio
• Replace wheels, tires, or mirrors
• Introduce new reflections that weren't present
• Add or remove any external elements
• Distort or blur vehicle geometry
• Modify window shapes or positions
• Change the vehicle type, make, or model
• Alter the background environment

🚨 VIOLATION OF GEOMETRY LOCK = COMPLETE RENDER FAILURE 🚨
`;

// ============= LAYER 2: VECTOR EDIT MODE (EDITOR ROLE) =============
export const VECTOR_EDIT_MODE_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 VECTOR EDIT MODE — TREAT AS LAYERED ARTWORK 🎨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Treat the wrap design as a LAYERED VECTOR ARTWORK.
Your role is to EDIT the EXISTING design, NOT recreate it from scratch.

✅ ALLOWED MODIFICATIONS:
• Color corrections (hue, saturation, brightness, temperature)
• Finish/material changes (gloss to matte, add metallic, change sheen)
• Shading adjustments (darker/lighter areas)
• Lighting intensity adjustments
• Pattern scale, flow, repetition, or vibrancy adjustments
• Gradient color stops, intensity, angle adjustments
• Selective panel edits ("just the hood", "just the doors")
• Contrast, saturation, clarity, or tonal changes
• Texture adjustments that follow body contours
• Reflectivity and specularity changes

❌ NOT ALLOWED:
• Inventing new patterns that weren't in the original
• Adding decals, logos, text, or symbols not requested
• Altering pattern geometry or flow direction without explicit request
• Breaking panel alignment or wrap continuity
• Changing gradient direction unless specifically requested
• Altering pattern placement on the vehicle
• Adding noise, grunge, or distress effects unless requested
• Removing existing design elements without explicit request
• Creating a completely new design instead of editing

🎯 GOAL: Precise, surgical edits that preserve design intent 🎯
`;

// ============= LAYER 3: REVISION INTERPRETATION RULES =============
export const REVISION_INTERPRETATION_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 REVISION INTERPRETATION — ATOMIC DESIGN OPERATIONS 📝
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the user's revision request carefully and break it into ATOMIC OPERATIONS:

OPERATION CATEGORIES:
• 🎨 GLOBAL COLOR EDIT: Affects entire wrap (e.g., "make it more blue")
• 🖌️ LOCAL COLOR EDIT: Affects specific area (e.g., "darken the hood")
• ✨ FINISH EDIT: Material change (e.g., "make it glossier", "add metallic")
• 💡 LIGHTING EDIT: Light intensity/direction (e.g., "more dramatic shadows")
• 🔄 PATTERN MODIFICATION: Scale, flow, repetition changes
• 🌓 SHADING EDIT: Light/dark balance adjustments
• 🌈 GRADIENT EDIT: Gradient stops, direction, intensity
• 📍 PANEL-SPECIFIC EDIT: Targeted area modification

APPLICATION RULES:
1. Apply ONLY the specified operations — no additional "improvements"
2. DO NOT modify ANY geometry or composition
3. If instruction is ambiguous, choose the LEAST DESTRUCTIVE interpretation
4. If instruction refers to a panel (hood, doors, bumper, roof), apply ONLY to that region
5. Maintain perfect color/pattern continuity across panel edges
6. Preserve the overall design intent while applying changes
7. Keep all branding overlays in their exact positions

PANEL REFERENCE MAP:
• "Hood" = Front top panel only
• "Roof" = Top center panel only  
• "Doors" = Side panels between fenders
• "Fenders" = Front and rear wheel arch areas
• "Bumper" = Front or rear bumper covers
• "Trunk" / "Tailgate" = Rear top panel
• "Quarter panels" = Rear side panels behind doors

🎯 PRECISION IS PARAMOUNT — Apply exactly what was requested 🎯
`;

// ============= LAYER 4: MULTI-VIEW CONSISTENCY (ApproveMode) =============
export const MULTI_VIEW_CONSISTENCY_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 MULTI-VIEW CONSISTENCY — IDENTICAL ACROSS ALL ANGLES 🔄
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When generating multiple views, you MUST apply revision instructions CONSISTENTLY:

✅ MUST BE IDENTICAL ACROSS ALL VIEWS:
• Same saturation levels and color values
• Same color interpretations (if "more blue" = specific shade, use it everywhere)
• Same finish appearance (gloss level, metallic intensity)
• Same pattern flow direction and scale
• Same gradient color stops and positions
• Same lighting adjustment intensity
• Same shading depth and character

❌ DO NOT INTRODUCE DISCREPANCIES:
• Different colors between left and right sides
• Inconsistent pattern scale on different panels
• Varying finish appearance (gloss on one side, matte-looking on other)
• Different gradient intensities per view
• Inconsistent lighting corrections

CONTINUITY CHECK:
Before finalizing, mentally verify:
"If I placed these views side-by-side, would they look like the SAME vehicle?"

🎯 ALL VIEWS = SAME VEHICLE = SAME REVISION 🎯
`;

// ============= QUICK REVISION CHIP INTERPRETERS =============
export const REVISION_CHIP_EXPANSIONS: Record<string, string> = {
  "Make the colors more vibrant": "Increase color saturation by 20-30% across all wrapped surfaces while maintaining the same hue. Make colors pop more without becoming neon or unnatural.",
  "Add more contrast": "Increase the difference between light and dark areas. Deepen shadows slightly and brighten highlights while preserving the original color palette.",
  "Make it darker/moodier": "Reduce overall brightness by 15-20%. Deepen shadow areas, reduce highlight intensity, and create a more dramatic, subdued atmosphere while maintaining wrap visibility.",
  "Brighter lighting": "Increase the intensity of studio lighting. Add more pronounced highlights, brighter reflections, and a more vibrant overall illumination while keeping the design clearly visible.",
  "More dramatic angle": "This is a GEOMETRY request - not applicable. Maintain current angle exactly and suggest user regenerate with a different view type instead.",
  "Cleaner background": "Simplify the background environment. Reduce any visual noise, ensure clean neutral studio backdrop, and improve contrast between vehicle and background."
};

/**
 * Builds the complete revision prompt block for AI
 * Combines all 4 layers based on the tool and request type
 */
export function buildRevisionPromptBlock(params: {
  revisionPrompt: string;
  toolType: 'colorpro' | 'designpanelpro' | 'patternpro' | 'wbty' | 'fadewraps' | 'approvemode' | 'graphicspro';
  isMultiView?: boolean;
  currentViewType?: string;
  styleDNA?: string | null;
  selectedPreset?: string | null;
  originalPrompt?: string | null; // Add original prompt to detect stripe intent
}): string {
  const { revisionPrompt, toolType, isMultiView = false, currentViewType, styleDNA, selectedPreset, originalPrompt } = params;
  
  // ============= STRIPE MODE DETECTION FOR REVISIONS =============
  const stripeIntent = originalPrompt ? (
    /stripe|rocker|beltline|shoulder|swoosh|accent|panel sweep|panel stripe|body line|pinstripe|quarter sweep/i.test(originalPrompt)
  ) && !(
    originalPrompt.toLowerCase().includes('two tone') ||
    originalPrompt.toLowerCase().includes('two-tone') ||
    (originalPrompt.toLowerCase().includes('top half') && originalPrompt.toLowerCase().includes('bottom half'))
  ) : false;

  // ============= STRIPE-ONLY REVISION MODE =============
  if (stripeIntent) {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 STRIPE-ONLY REVISION MODE 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are updating a VINYL STRIPE DESIGN. NOT a full-body wrap.

USER REVISION REQUEST:
"${revisionPrompt}"

CRITICAL STRIPE REVISION RULES:

✅ ALLOWED:
• Change stripe COLOR (e.g., "make stripe red instead of gold")
• Change stripe FINISH (e.g., "make stripe chrome instead of gloss")
• Adjust stripe WIDTH slightly
• Adjust stripe BRIGHTNESS/SATURATION

❌ STRICTLY FORBIDDEN:
• DO NOT recolor the vehicle body
• DO NOT introduce new geometric shapes
• DO NOT add extra color zones
• DO NOT create two-tone body wraps
• DO NOT add random logos or graphics
• DO NOT convert stripe to full-body wrap
• DO NOT add diagonal blocks or panels

PRESERVE:
• Exact stripe PLACEMENT (rocker, beltline, shoulder, etc.)
• Exact stripe GEOMETRY
• Vehicle body color UNCHANGED
• Stripe type and location LOCKED

Apply ONLY the user's requested change to the STRIPE ITSELF.
The vehicle body color must remain EXACTLY as it was.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 EXECUTE STRIPE REVISION NOW 🎬
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }
  
  // ============= STANDARD REVISION MODE =============
  
  // Expand quick chip prompts if they match
  let expandedPrompt = revisionPrompt;
  for (const [chip, expansion] of Object.entries(REVISION_CHIP_EXPANSIONS)) {
    if (revisionPrompt.toLowerCase().includes(chip.toLowerCase())) {
      expandedPrompt = expansion;
      break;
    }
  }

  // Tool-specific context
  const toolContext = {
    colorpro: "solid vinyl wrap color",
    designpanelpro: "printed panel design wrap",
    patternpro: "repeating pattern wrap",
    wbty: "fabric/texture pattern wrap",
    fadewraps: "gradient fade wrap",
    approvemode: "custom 2D design wrap proof",
    graphicspro: "multi-zone vinyl wrap design"
  };

  let revisionBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 DESIGN REVISION MODE — 4-LAYER IRONCLAD ENGINE 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOOL CONTEXT: ${toolType.toUpperCase()} — ${toolContext[toolType]}
${currentViewType ? `CURRENT VIEW: ${currentViewType.toUpperCase()}` : ''}

${GEOMETRY_LOCK_BLOCK}

${VECTOR_EDIT_MODE_BLOCK}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 USER REVISION REQUEST 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"${expandedPrompt}"

${REVISION_INTERPRETATION_BLOCK}
`;

  // Add style DNA preservation for GraphicsPro
  if (styleDNA) {
    revisionBlock += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 STYLE DNA PRESERVATION (CRITICAL) 🎨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maintain the original artistic style throughout all revisions:
${styleDNA}

✅ PRESERVE:
• Line weight and stroke geometry
• Curve flow and flourish patterns
• Symmetry and balance
• Multi-line relationships
• Accent layer structure

❌ DO NOT alter style DNA during revisions unless explicitly requested.
`;
  }

  // Add preset preservation
  if (selectedPreset) {
    revisionBlock += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 OEM PRESET GEOMETRY LOCK 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maintain OEM geometry from preset: ${selectedPreset}

• OEM stripe layout LOCKED
• OEM proportions LOCKED
• OEM placement rules LOCKED
• User can modify COLOR/FINISH only
• NEVER change stripe width, spacing, or geometry during revision
`;
  }

  // Add zone geometry preservation for two-tone splits
  revisionBlock += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 ZONE GEOMETRY PRESERVATION (CRITICAL) 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOU MUST MAINTAIN THE ORIGINAL TOP/BOTTOM ZONE SPLIT:

• If original had GOLD CHROME top half → keep GOLD CHROME in TOP HALF only
• If original had SATIN BLACK bottom half → keep SATIN BLACK in BOTTOM HALF only

DO NOT:
- Raise or lower the dividing line
- Change zone definitions  
- Alter geometry from the original render
- Allow colors to bleed into opposite zones

Zoning MUST remain identical across all views and revisions.
`;

  // Add panel stripe type preservation
  revisionBlock += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PANEL STRIPE TYPE PRESERVATION 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the original design used a PANEL STRIPE TYPE:

• ROCKER STRIPE → Stays on LOWER BODY (8-14" from ground)
• BELTLINE STRIPE → Stays at MID-BODY CREASE (window sill height)
• SHOULDER STRIPE → Stays BELOW WINDOW LINE
• QUARTER SWEEP → Stays on REAR QUARTER PANELS
• SWOOSH → Maintains FENDER-TO-QUARTER continuous flow

DO NOT:
- Shift stripe to a different panel region
- Change vertical placement of stripes
- Convert one stripe type to another
- Allow stripe drift between views
- Alter stripe width or proportions

Stripe type and placement MUST be identical in all revision angles.
User can modify stripe COLOR and FINISH only.
`;

  // Add multi-view consistency for ApproveMode or when generating multiple views
  if (isMultiView || toolType === 'approvemode' || toolType === 'graphicspro') {
    revisionBlock += `
${MULTI_VIEW_CONSISTENCY_BLOCK}
`;
  }

  revisionBlock += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 EXECUTE REVISION NOW 🎬
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply the user's revision request using the rules above.
Output ONLY the revised render with changes applied.
Preserve ALL geometric and spatial properties exactly.
Maintain perfect wrap continuity across all surfaces.
${styleDNA ? 'Preserve original STYLE DNA completely.' : ''}
${selectedPreset ? 'Preserve OEM PRESET geometry exactly.' : ''}

🔴 FINAL CHECK: Does this revision match EXACTLY what the user asked for? 🔴
`;

  return revisionBlock;
}

/**
 * Builds a condensed revision prompt optimized for Gemini best practices.
 * Used when the original render image is attached — Gemini can SEE the design,
 * so we don't need verbose text descriptions of what to preserve.
 *
 * Gemini Best Practices applied:
 * - [EDIT] prefix signals modification mode (not new generation)
 * - ACTION-FORWARD: Lead with what to change, not what to keep
 * - Short prompt (~800 chars target) — shorter = higher quality from Gemini
 * - Positive framing only — no "DO NOT" or "NEVER" instructions
 * - Single clear instruction beats five redundant ones
 */
export function buildCondensedRevisionPrompt(params: {
  revisionPrompt: string;
  toolType: 'colorpro' | 'designpanelpro' | 'patternpro' | 'wbty' | 'fadewraps' | 'approvemode' | 'graphicspro';
  currentViewType?: string;
  isMultiView?: boolean;
  styleDNA?: string | null;
  selectedPreset?: string | null;
  originalPrompt?: string | null;
}): string {
  const { revisionPrompt, toolType, currentViewType, isMultiView = false, styleDNA, selectedPreset, originalPrompt } = params;

  // Expand quick chip prompts — ONLY when the user's text IS exactly the quick
  // chip (i.e. they tapped a one-click button). A SUBSTRING match here was
  // destructive: a long, detailed customer message that merely happened to
  // contain a chip phrase (e.g. "...add more contrast...") had its ENTIRE
  // request discarded and replaced by the generic canned sentence — the model
  // then "did nothing" the customer actually asked for. Free-text requests are
  // now always forwarded verbatim.
  let expandedPrompt = revisionPrompt;
  const chipKey = revisionPrompt.trim().toLowerCase();
  for (const [chip, expansion] of Object.entries(REVISION_CHIP_EXPANSIONS)) {
    if (chipKey === chip.toLowerCase()) {
      expandedPrompt = expansion;
      break;
    }
  }

  // Stripe detection — route to stripe-specific block
  const stripeIntent = originalPrompt ? (
    /stripe|rocker|beltline|shoulder|swoosh|accent|panel sweep|panel stripe|body line|pinstripe|quarter sweep/i.test(originalPrompt)
  ) && !(
    originalPrompt.toLowerCase().includes('two tone') ||
    originalPrompt.toLowerCase().includes('two-tone') ||
    (originalPrompt.toLowerCase().includes('top half') && originalPrompt.toLowerCase().includes('bottom half'))
  ) : false;

  if (stripeIntent) {
    return `[EDIT] Using the provided image as the current design, apply this stripe-only revision:

"${expandedPrompt}"

MAINTAIN: Exact stripe placement, vehicle body color, geometry, camera angle, and all non-stripe elements.
MODIFY: Only the stripe as described above. Do not change body color or add new elements.
${selectedPreset ? `OEM PRESET: ${selectedPreset} — stripe layout and proportions are LOCKED.` : ''}

Output the revised vehicle render.`;
  }

  // Detect intent category from the revision text
  const lowerRevision = expandedPrompt.toLowerCase();
  const isAdditive = /\b(add|place|put|include|insert|overlay|write|print|stamp)\b/i.test(lowerRevision);
  const isRemoval = /\b(remove|delete|erase|take off|get rid of|no more|clear)\b/i.test(lowerRevision);

  // Remove-AND-replace: the request removes an element but ALSO names a new
  // treatment for that same area — e.g. "remove the flag on the hood and make it
  // navy with gold stars". Pure-removal healing ("fill with the surrounding
  // material, do not recolor the panel") then DIRECTLY contradicts the recolor
  // the user asked for, which is the #1 reason "remove X and make it Y" came
  // back unchanged. Detect the replacement intent (a second add, or any new
  // color/finish word) and switch to a replace instruction below.
  const isReplace = isRemoval && (
    isAdditive ||
    /\b(replace|instead|rather than|swap|turn (it|the|that)|make (it|the|that)|recolou?r|repaint|paint|solid|matte|gloss|chrome|satin|metallic|navy|blue|red|black|white|gold|silver|grey|gray|green|orange|purple|pink|yellow|colou?r|stars?|pattern|design|graphic)\b/i.test(lowerRevision)
  );

  // Detect if user references specific panels/areas for targeted edits
  const hasAreaTarget = /\b(hood|roof|door|fender|bumper|trunk|tailgate|quarter|window|windshield|rear|front|side|top|bottom)\b/i.test(lowerRevision);

  // Element-narrowing trap. Phrases like "fix the wildcat so it's just the
  // head", "make the logo simpler", or "only the cat" describe shrinking ONE
  // graphic down to part of itself. Gemini reads "just/only/simpler" as an
  // image-wide instruction and strips OTHER unrelated elements it visually
  // groups with the edited graphic — most commonly a team name or business
  // name sitting next to a mascot. We clarify (below) that the narrowing
  // applies to the single referenced element only. Skip removal edits, where
  // exclusivity ("remove everything but the logo") is genuinely intended.
  const hasNarrowing = /\b(just|only|simpler|simplify|simplified|isolate|by itself|on its own|nothing but|without the)\b/i.test(lowerRevision);

  // Global IMAGE-QUALITY intent (blur, sharpness, focus, grain, exposure,
  // lighting, contrast, saturation, resolution). These are whole-image
  // corrections, NOT element edits. This must take priority over the removal
  // branch below: "remove blur" otherwise matches isRemoval and gets framed as
  // "remove an element + fill the void", so Gemini finds no "blur element" and
  // returns the image unchanged. Skip when the user names a discrete element
  // (e.g. "remove the blurry logo") — that is a real element edit.
  // Restricted to UNAMBIGUOUS image-quality terms. Color-adjacent words
  // (brighter, darker, vibrant, saturation, contrast) are intentionally
  // excluded — they are common in legitimate color revisions like "brighter
  // red", and this builder is shared with generate-color-render.
  const isQualityEdit =
    /\b(blur|blurry|blurred|unblur|deblur|sharpen|sharper|sharpness|crisp|crisper|clarity|in focus|out of focus|refocus|grain|grainy|denoise|pixelat\w*|fuzzy|soften|upscale|low[\s-]?res|low resolution)\b/i.test(lowerRevision) &&
    !/\b(logo|text|lettering|decal|graphic|stripe|name|phone|number|word|wording|sticker|emblem|badge|sign)\b/i.test(lowerRevision);

  if (isQualityEdit) {
    return `[EDIT] Apply a global image-quality correction to the attached vehicle render.

QUALITY ADJUSTMENT: ${expandedPrompt}

Treat this as a whole-image photographic correction (e.g. sharpness, focus, clarity, lighting, exposure, contrast) — it is NOT an element to remove. Apply it uniformly across the render so the result looks like a clean, naturally photographed, photorealistic image.

PRESERVE EXACTLY:
• The wrap design, colors, finishes, patterns, text, logos, graphics, stripes, and decals — same artwork, same placement, nothing added or removed
• Vehicle make/model, body geometry, and proportions
• Camera angle, perspective, framing, crop, and vehicle pose
• Overall composition and background layout

Only the image-quality attribute described above may change. Output the corrected vehicle image.`;
  }

  // Multi-part detection. Real revision requests from designers bundle several
  // distinct operations into one message ("more grey on the cab, no wrap on the
  // hood, move the logo down and to the left, end the wrap at the headlight").
  // The old prompt framed everything as a single "ONE change", so the model
  // executed only the first clause and appeared to ignore the rest. We now tell
  // it to read the WHOLE request like a designer and apply EVERY part, while
  // still locking geometry and anything the request does not mention.
  const partSignals = (expandedPrompt.match(/[.;\n]|(\band\b)|(\balso\b)|(\bthen\b)|(\bplus\b)/gi) || []).length;
  const isComplex = partSignals >= 2 || expandedPrompt.length > 140;

  // Build the prompt — DESIGNER INTERPRETATION first, then a tight preservation
  // lock. Gemini can SEE the image, so we don't describe what to preserve in
  // detail — we tell it to apply the full request and leave the rest untouched.
  let prompt = `[EDIT] You are a master vehicle-wrap designer revising an existing wrap proof (the attached image). Read the ENTIRE change request and apply every part of it the way an experienced designer would — interpret the intent, coverage, placement, and color language precisely, not just the first instruction.

CHANGE REQUEST${isComplex ? ` (this has multiple parts — complete ALL of them)` : ``}: ${expandedPrompt}`;

  // Spatial / placement interpretation — only when the request uses positional
  // language. Keeps simple color edits short.
  const hasSpatialLanguage = /\b(left|right|top|bottom|above|below|under|over|behind|center|middle|body ?line|belt ?line|rocker|quarter|fender|panel|door|hood|roof|cab|bed|tailgate|bumper|mirror|headlight|lower|higher|up|down|toward|towards?|end(s|ing)? at|start(s|ing)? at|smaller|larger|bigger|move|shift|angle|slant|corner|edge)\b/i.test(lowerRevision);
  if (hasSpatialLanguage) {
    prompt += `\n\nFollow the placement, coverage, and edge directions EXACTLY, using standard vehicle-panel locations: hood, roof, front fender, front quarter panel, door, rocker (lower body below the doors), beltline (the crease at window-sill height), cab corner, bed side, rear quarter panel, tailgate, and bumpers. Land the wrap's edges and any graphic precisely where described — e.g. "end in the center of the front quarter panel", "below the body line", "smaller and shifted left", or "cut off at the headlight then slant up toward the mirror" are exact instructions. If the request says a panel stays factory or "no wrap", render that panel in the vehicle's original paint.`;
  }

  // Wrap-coverage vocabulary. A real installer/designer understands coverage
  // terms ("three-quarter wrap", "half wrap", "full wrap") and renders the
  // right amount of the body covered. The LLM knows these terms — we just make
  // sure it applies the coverage the customer named with clean transitions.
  const hasCoverageType = /\b(full wrap|three[\s-]?quarter wrap|3\/4 wrap|half wrap|quarter wrap|partial wrap|spot (graphics?|wrap)|hood wrap|roof wrap|color change)\b/i.test(lowerRevision);
  if (hasCoverageType) {
    prompt += `\n\nWRAP COVERAGE: Interpret coverage terms like a professional wrap installer — "full wrap" = the entire body is covered; "three-quarter (3/4) wrap" = roughly the rear three-quarters of the body is covered while the front section (front bumper, front fenders, often the hood) stays in factory paint or the design fades out toward the front; "half wrap" = the lower or rear half is covered; "quarter / partial / spot" = only a defined section; "hood wrap" or "roof wrap" = just that panel. Render exactly the coverage the customer named, with clean professional transitions, and leave every uncovered panel in the vehicle's original factory paint.`;
  }

  // Additive edits: make sure the new element is clearly visible, scoped.
  if (isAdditive) {
    prompt += `\n\nFor anything to ADD, place only what is described, at the specified location and size.`;
    if (hasAreaTarget) {
      prompt += ` Place it exactly where specified.`;
    }
  }

  // Removal edits. Two distinct cases:
  //  • Pure removal ("remove the phone number"): heal the void with the
  //    surrounding material so we don't recolor the whole panel (root cause of
  //    "remove text → bumper turned white").
  //  • Remove-and-replace ("remove the flag on the hood and make it navy with
  //    gold stars"): the area must take on the NEW treatment the request names —
  //    healing it back to the surrounding design here is the exact reason these
  //    came back unchanged. Apply the replacement instead.
  if (isRemoval && !isReplace) {
    prompt += `\n\nFor anything to REMOVE, delete only that element and fill the area it occupied with the SAME material, color, finish, and texture as the surrounding surface — match the existing panel exactly. Do not recolor, repaint, or alter the panel it was sitting on.`;
  } else if (isReplace) {
    prompt += `\n\nFor anything to REMOVE-AND-REPLACE, delete the named element, then apply the NEW color, finish, or graphic the request specifies to that exact area. Render the requested replacement cleanly on that panel — do NOT restore the old design and do NOT simply blend it into the surrounding panel; the area takes on the new treatment described.`;
  }

  // Targeted panel edits (non-additive, non-removal): scope to the named area.
  if (hasAreaTarget && !isAdditive && !isRemoval) {
    prompt += `\n\nApply each change to the area(s) named in the request. Leave panels the request does not mention exactly as they are in the input.`;
  }

  // PRESERVATION LOCK — keep geometry and anything the request does NOT mention.
  // Positive framing only. This protects the vehicle/camera and unrelated design
  // elements WITHOUT suppressing the (possibly many) changes the user asked for.
  prompt += `

PRESERVE — keep these exactly as they appear in the attached image, unless the request explicitly changes them:
• Camera angle, perspective, framing, crop, and vehicle pose — identical to the input
• Vehicle make, model, body shape, panels, windows, wheels, mirrors, and proportions
• Any color, finish, text, logo, graphic, stripe, or decal the request does NOT mention
• Lighting, shadows, reflections, and the background environment
Apply every change the request asks for; leave everything it does not ask for untouched.`;

  // Defuse the element-narrowing trap (see hasNarrowing above): make it
  // unmistakable that "just"/"only"/"simpler" scope to the single graphic
  // named in CHANGE REQUIRED, not to the whole vehicle.
  if (hasNarrowing && !isRemoval) {
    prompt += `

ELEMENT SCOPE: The words "just" / "only" / "simpler" describe the ONE graphic element named in CHANGE REQUIRED — they apply to that element's own artwork only. They do NOT mean strip content from the rest of the vehicle. Any separate team name, business name, lettering, phone number, slogan, or other logo elsewhere on the wrap is a DIFFERENT element and stays exactly as it is.`;
  }

  if (styleDNA) {
    prompt += `\n• Preserve artistic style: ${styleDNA}`;
  }

  if (selectedPreset) {
    prompt += `\n• OEM PRESET: ${selectedPreset} — stripe layout locked, color/finish changes only.`;
  }

  if (isMultiView) {
    prompt += `\n• Apply identically across all angles.`;
  }

  if (currentViewType) {
    prompt += `\n\nView: ${currentViewType}`;
  }

  prompt += `\n\nOutput the revised vehicle image with ALL requested changes applied.`;

  return prompt;
}

/**
 * Builds a logo-placement edit prompt for revise-render.
 *
 * Used when the client has composited one or more brand elements (uploaded
 * logos and/or extracted text/logos) onto the render at marked positions.
 * Gemini's only job is to blend the overlaid elements into the vehicle
 * surface as if they were professionally applied vinyl — match curvature,
 * perspective, lighting, and surface highlights — while leaving every other
 * pixel of the image untouched.
 *
 * Stays under ~900 chars. Positive framing only. Single clear instruction.
 */
export function buildLogoPlacementPrompt(params: {
  /** Optional extra notes from the user (free text) */
  userNotes?: string | null;
  /** Number of layers placed on this view (informational, not enforced) */
  layerCount: number;
  /** Current view, e.g. "side", "rear" */
  currentViewType?: string;
}): string {
  const { userNotes, layerCount, currentViewType } = params;
  const noun = layerCount === 1 ? "brand element has" : "brand elements have";

  let prompt = `[EDIT] One or more ${noun} been overlaid on this vehicle render at marked positions. Blend each overlaid element into the vehicle surface as if it were professionally applied vinyl: match the body curvature, perspective foreshortening, lighting direction, and surface highlights at that exact position.

Treat every overlaid element as the SOURCE OF TRUTH for placement, scale, orientation, and content. Keep each one at its current location and size. Do not duplicate them elsewhere.`;

  // A revision can combine a DETERMINISTIC placement (the composited overlay)
  // with a typed DESIGN CHANGE in the same pass ("...and make the roof matte",
  // "end the wrap at the headlight"). The old prompt treated the typed text as
  // passive "User notes" and told the model to "preserve the rest of the image
  // exactly" — so the customer's actual change was silently dropped. We now
  // detect a real instruction and execute it as a master-designer edit on TOP
  // of integrating the overlay, while still preserving anything neither the
  // overlay nor the instruction touches. The "Place logos as marked"
  // placeholder (sent when there is no typed request) is treated as no change.
  const notes = (userNotes || "").trim();
  const isPlaceholderOnly = !notes || /^place\s+logos?\s+as\s+marked\.?$/i.test(notes);

  if (isPlaceholderOnly) {
    prompt += ` Preserve the rest of the image — vehicle, paint, background, camera angle, and framing — exactly as it is.`;
  } else {
    const trimmed = notes.slice(0, 600);
    prompt += ` ALSO apply this design change the customer requested, the way an experienced wrap designer would — complete every part of it:

"${trimmed}"

Preserve everything that neither the overlaid element(s) nor this change request touches — the vehicle make/model and body shape, camera angle, framing, and any color, finish, text, logo, graphic, or stripe not mentioned — exactly as it appears in the input.`;
  }

  if (currentViewType) {
    prompt += `\nView: ${currentViewType}.`;
  }

  prompt += `\n\nOutput the edited vehicle image with the overlaid element(s) integrated naturally${isPlaceholderOnly ? "" : " and the requested change applied"}.`;

  return prompt;
}

/**
 * Validates if a revision request can be processed
 * Returns warnings for requests that might cause issues
 */
export function validateRevisionRequest(prompt: string): {
  isValid: boolean;
  warnings: string[];
  suggestedAction?: string;
} {
  const warnings: string[] = [];
  let suggestedAction: string | undefined;

  const lowerPrompt = prompt.toLowerCase();

  // Check for geometry-changing requests — but NOT view-change requests
  // (close-up, front view, etc. are handled by the frontend view generator)
  const isViewRequest = /\b(close[\s-]?up|closeup|macro|front\s+view|rear\s+view|hood\s+view|roof\s+view|top\s+view)\b/i.test(lowerPrompt);
  const geometryKeywords = ['different angle', 'change angle', 'rotate', 'different view', 'zoom out', 'crop', 'wider shot'];
  if (!isViewRequest && geometryKeywords.some(kw => lowerPrompt.includes(kw))) {
    warnings.push("This request involves camera/geometry changes which may not be fully achievable in revision mode.");
    suggestedAction = "Consider regenerating with a different view type instead of using revision mode.";
  }
  if (isViewRequest) {
    warnings.push("This looks like a request for a different camera view. Use 'Generate Missing Views' to create the view you need.");
    suggestedAction = "Click 'Generate Missing Views' instead of using revision mode for camera angle changes.";
  }

  // Check for vehicle-changing requests
  const vehicleKeywords = ['different car', 'change vehicle', 'different truck', 'change to a'];
  if (vehicleKeywords.some(kw => lowerPrompt.includes(kw))) {
    warnings.push("Changing the vehicle type requires a full regeneration, not a revision.");
    suggestedAction = "Start a new render with the desired vehicle.";
  }

  // Check for very vague requests
  if (prompt.length < 10) {
    warnings.push("Very short revision requests may produce unpredictable results. Consider being more specific.");
  }

  return {
    isValid: warnings.length === 0,
    warnings,
    suggestedAction
  };
}
