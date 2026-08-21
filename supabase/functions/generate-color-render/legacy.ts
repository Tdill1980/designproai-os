/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Contains proprietary prompt-engineering / render configuration
 *  (the "golden render" config) that is a TRADE SECRET of RestylePro
 *  / LoopMighty Software Development LLC, and part of the DesignIQ™ / LiftIQ Engine™
 *  architecture (patent-pending system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission. The prompt
 *  text itself must NOT appear in any published patent filing.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
import { encode as encodeBase64, decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { tokenGate } from "../_shared/token-gate.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
import { SPIN_VIEW_ANGLES, getSpinViewAngle, isValidAngle } from "../_shared/spin-view-angles.ts";
import { buildFadeWrapsPrompt } from "../_shared/fadewraps-prompt-builder.ts";
import { buildApproveModePrompt } from "../_shared/approvemode-prompt-builder.ts";
import { resolveVehicleSpecs } from "../_shared/vehicle-specs-lookup.ts";
import { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } from '../_shared/studio-os.ts';
import { getCameraAngle, WRAP_COVERAGE_RULES, getAspectRatio, getResolution, isInstantMirrorView, getMirrorSource } from '../_shared/view-angles-os.ts';
import { buildRestyleProRenderPrompt } from "../_shared/render-prompt-builder.ts";
import { buildRevisionPromptBlock, buildCondensedRevisionPrompt, validateRevisionRequest } from "../_shared/revision-prompt-engine.ts";
import { buildColorProPrompt } from "../_shared/colorpro-prompt-builder.ts";
import { buildGraphicsProPrompt, detectFamousLivery, type FamousLivery } from "../_shared/graphicspro-prompt-builder.ts";
import { runColorProEnhancedPreProcessor, formatEnhancedFilmZones, formatEnhancedGraphics } from "../_shared/colorpro-enhanced-preprocessor.ts";
import { getFadeReferenceInfo, buildFadeReferencePromptSection, STANDARD_FADE_REFERENCE_URL, buildColorSubstitutionPrompt } from "../_shared/fade-reference-images.ts";
import { buildVisualReferenceGuidance } from "../_shared/fadewraps-prompt-builder.ts";
// NeuralNetwork RAG, system examples, and dynamic exemplar retrieval REMOVED.
// These injected ~3K+ chars of exemplar text + 3 reference images into every
// DPP/ApproveMode prompt, degrading Gemini image quality. Prompt length = quality killer.
import { captureDesignDNA } from "../_shared/design-dna-capture.ts";
import { ASPECT_RATIO_REQUIREMENT } from '../_shared/aspect-ratio-requirement.ts';
import { PHOTOREALISM_REQUIREMENT } from '../_shared/photorealism-prompt.ts';
// Studio reference removed — text prompt handles lighting, driver-side render handles consistency
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from '../_shared/forbidden-text-instructions.ts';
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { emitRenderEvent, canonicalizeVehicle } from "../_shared/render-events.ts";

// === GraphicsPro Label Helpers - ALWAYS generates intelligent labels ===
const KNOWN_FILMS_MAP: Record<string, string> = {
  gold: "TeckWrap Chrome Gold",
  silver: "TeckWrap Chrome Silver",
  red: "Oracal Gloss Red Metallic",
  blue: "3M 2080 Gloss Blue Metallic",
  white: "KPMF Gloss White",
  black: "3M 2080 Gloss Black",
  purple: "3M Gloss Plum Explosion",
  green: "Avery Dennison Gloss Green",
  orange: "Avery Dennison Gloss Orange",
  yellow: "3M Gloss Bright Yellow",
  bronze: "KPMF Gloss Bronze",
  copper: "Avery Dennison Gloss Copper Metallic",
  gray: "3M Gloss Anthracite",
  grey: "3M Gloss Anthracite",
  pink: "Avery Dennison Gloss Pink",
  teal: "3M 2080 Gloss Teal",
  navy: "KPMF Gloss Dark Blue",
  beige: "Avery Dennison Matte Beige",
  brown: "3M 2080 Matte Brown Metallic",
  champagne: "KPMF Gloss Champagne Gold",
  rose: "TeckWrap Rose Gold",
  mint: "Avery Dennison Matte Mint",
  lavender: "3M Gloss Lavender",
  burgundy: "KPMF Gloss Wine Red",
  charcoal: "3M 2080 Gloss Charcoal Metallic",
};

function cap(str: string): string {
  if (!str) return '';
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ---------------------------------------------------------------------------
// Quality Gate — validates Gemini output isn't blank/corrupt/solid color
// ---------------------------------------------------------------------------
function checkImageQuality(base64Data: string): { pass: boolean; reason?: string } {
  try {
    const bytes = decodeBase64(base64Data);
    // Reject images smaller than 50KB — likely blank or corrupt
    if (bytes.byteLength < 50_000) {
      return { pass: false, reason: `Image too small (${bytes.byteLength} bytes)` };
    }
    // Sample last 10,000 bytes for pixel variance — detect solid color frames
    const sampleSize = Math.min(10_000, bytes.byteLength);
    const sample = bytes.slice(bytes.byteLength - sampleSize);
    const uniqueValues = new Set(sample);
    if (uniqueValues.size < 20) {
      return { pass: false, reason: `Low pixel variance (${uniqueValues.size} unique values) — likely solid color or blank` };
    }
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: `Quality check error: ${err}` };
  }
}

// INTELLIGENT film label picker - NEVER returns generic labels
function pickFilm(hint: string): string {
  if (!hint) return "Avery Dennison Gloss Black";
  const lower = hint.toLowerCase();
  
  // Check for explicit manufacturer mentions FIRST
  if (lower.includes('3m')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `3M 2080 ${cap(lower.includes('matte') ? 'Matte' : lower.includes('satin') ? 'Satin' : 'Gloss')} ${cap(colorMatch)}` : '3M 2080 Gloss Black';
  }
  if (lower.includes('avery')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `Avery Dennison ${cap(lower.includes('matte') ? 'Matte' : lower.includes('satin') ? 'Satin' : 'Gloss')} ${cap(colorMatch)}` : 'Avery Dennison Gloss Black';
  }
  if (lower.includes('kpmf')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `KPMF ${cap(lower.includes('matte') ? 'Matte' : lower.includes('satin') ? 'Satin' : 'Gloss')} ${cap(colorMatch)}` : 'KPMF Gloss Black';
  }
  if (lower.includes('teckwrap')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `TeckWrap ${cap(lower.includes('chrome') ? 'Chrome' : lower.includes('matte') ? 'Matte' : 'Gloss')} ${cap(colorMatch)}` : 'TeckWrap Gloss Black';
  }
  if (lower.includes('oracal')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `Oracal ${cap(lower.includes('matte') ? 'Matte' : 'Gloss')} ${cap(colorMatch)}` : 'Oracal Gloss Black';
  }
  if (lower.includes('hexis')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `Hexis ${cap(lower.includes('matte') ? 'Matte' : 'Gloss')} ${cap(colorMatch)}` : 'Hexis Gloss Black';
  }
  if (lower.includes('inozetek')) {
    const colorMatch = Object.keys(KNOWN_FILMS_MAP).find(c => lower.includes(c));
    return colorMatch ? `Inozetek ${cap(lower.includes('matte') ? 'Matte' : 'Gloss')} ${cap(colorMatch)}` : 'Inozetek Gloss Black';
  }
  
  // Check for color + finish combinations from our map
  for (const [color, film] of Object.entries(KNOWN_FILMS_MAP)) {
    if (lower.includes(color)) {
      if (lower.includes("matte")) return film.replace("Gloss", "Matte").replace("Chrome", "Matte");
      if (lower.includes("satin")) return film.replace("Gloss", "Satin").replace("Chrome", "Satin");
      if (lower.includes("chrome")) return `TeckWrap Chrome ${cap(color)}`;
      if (lower.includes("brushed")) return `3M 2080 Brushed ${cap(color)}`;
      if (lower.includes("metallic")) return film.includes("Metallic") ? film : film + " Metallic";
      return film;
    }
  }
  
  // Fallback with intelligent manufacturer selection based on finish
  if (lower.includes('chrome')) return 'TeckWrap Chrome Black';
  if (lower.includes('matte')) return '3M 2080 Matte Black';
  if (lower.includes('satin')) return 'Avery Dennison Satin Black';
  if (lower.includes('brushed')) return '3M 2080 Brushed Black Metallic';
  
  return "Avery Dennison Gloss Black";
}

// Parse GraphicsPro label from styling prompt - ALWAYS returns descriptive label
function parseGraphicsProLabel(prompt: string): string {
  if (!prompt || !prompt.trim()) return "Avery Dennison Gloss Black";
  const lower = prompt.toLowerCase().trim();

  // Two-tone: "top half X, bottom half Y"
  const twoToneMatch = lower.match(/(?:top\s*half|upper\s*(?:half)?)\s+(.+?)(?:,|\s+)(?:bottom\s*half|lower\s*(?:half)?)\s+(.+?)(?:\.|$)/i);
  if (twoToneMatch) {
    return `${pickFilm(twoToneMatch[1])} | ${pickFilm(twoToneMatch[2])}`;
  }

  // Chrome delete
  if (/chrome\s*delete/i.test(lower)) {
    const colorMatch = lower.match(/(matte|satin|gloss)?\s*(black|white|gray|grey)/i);
    if (colorMatch) return `${cap(colorMatch[1] || 'Matte')} ${cap(colorMatch[2])} Chrome Delete`;
    return "Matte Black Chrome Delete";
  }

  // Racing stripes
  if (/stripe/i.test(lower)) {
    const colorMatch = lower.match(/(white|black|red|blue|gold|silver|orange|yellow|green)\s*(?:racing\s*)?stripe/i);
    if (colorMatch) return `${cap(colorMatch[1])} Racing Stripes`;
    return "White Racing Stripes";
  }

  // Roof wrap
  if (/roof\s*(?:wrap|only)/i.test(lower)) {
    const colorMatch = lower.match(/(black|white|carbon|gloss|matte|satin)/i);
    if (colorMatch) return `${cap(colorMatch[1])} Roof Wrap`;
    return "Gloss Black Roof Wrap";
  }

  // Accent/trim package
  if (/accent|trim\s*(?:package|wrap)/i.test(lower)) {
    const colorMatch = lower.match(/(black|chrome|carbon|gold|silver)/i);
    if (colorMatch) return `${cap(colorMatch[1])} Accent Package`;
    return "Gloss Black Accent Package";
  }

  // Mirror caps
  if (/mirror\s*cap/i.test(lower)) {
    const colorMatch = lower.match(/(black|carbon|chrome|white)/i);
    if (colorMatch) return `${cap(colorMatch[1])} Mirror Caps`;
    return "Carbon Fiber Mirror Caps";
  }

  // Full body wrap
  const fullBodyMatch = lower.match(/(?:full\s*(?:body|wrap)|entire\s*(?:car|vehicle))\s*(?:in\s*)?(.+?)(?:\.|$)/i);
  if (fullBodyMatch) return pickFilm(fullBodyMatch[1]);

  // Fallback: extract colors and generate label
  return pickFilm(prompt);
}

// Helper function to validate that a URL is an actual image, not a product page
function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  const lowerUrl = url.toLowerCase();
  
  // Reject known non-image URLs (product pages, videos, listings)
  const invalidPatterns = [
    /amazon\.com\/(dp|gp|product)\//i,
    /amazon\.com\/.*\/dp\//i,
    /youtube\.com\/watch/i,
    /youtu\.be\//i,
    /ebay\.com\/itm/i,
    /buywrap\.com\/products/i,
    /metrorestyling\.com\/products/i,
    /rvinyl\.com\/products/i,
    /\/products\//i,
    /\/product\//i,
  ];
  
  if (invalidPatterns.some(p => p.test(url))) {
    console.log(`❌ Rejected invalid URL (product page): ${url.substring(0, 80)}...`);
    return false;
  }
  
  // Accept URLs with image file extensions
  const imageExtensions = /\.(jpg|jpeg|png|webp|gif|bmp|tiff?)(\?.*)?$/i;
  if (imageExtensions.test(url)) return true;
  
  // Accept URLs from known CDN/image hosting patterns
  const validCdnPatterns = [
    /cdn\./i,
    /\.cloudfront\./i,
    /supabase.*storage/i,
    /googleusercontent\.com/i,
    /imgur\.com/i,
    /cloudinary\.com/i,
    /images?\./i,
    /\/images?\//i,
    /media\./i,
    /static\./i,
  ];
  
  if (validCdnPatterns.some(p => p.test(url))) return true;
  
  // Default: reject unknown URLs to be safe
  console.log(`⚠️ Rejected unknown URL format: ${url.substring(0, 80)}...`);
  return false;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-designpro-owner-id',
};

export async function handleLegacyGenerateColorRender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per ColorPro render. Inserted BEFORE any
  // prompt-building code runs; the locked render pipeline below is
  // untouched. If the user has no quota, 402 returns before we spend
  // any Gemini cost.
  const internalCaller = await resolveDesignProInternalCaller(req);
  if (internalCaller.rejection) return internalCaller.rejection;
  const gate = await tokenGate(req, {
    reason: "generate_color_render",
    // The standalone request is already authenticated and admitted. The six
    // photographer views are one server-owned job, not six browser purchases.
    skip: internalCaller.internal,
  });
  if (!gate.ok) return gate.response!;

  const RENDER_START_MS = Date.now();

  try {
    console.log('🚀 generate-color-render INVOKED - Timestamp:', new Date().toISOString());
    
    const requestBody = await req.json();
    const { 
      vehicleYear, 
      vehicleMake, 
      vehicleModel, 
      colorData, 
      modeType, 
      viewType = 'side',
      cameraAngle, // NEW: Specific angle for 360° generation (0-330 in 30° increments)
      userEmail,
      // OPTIMIZATION: Skip redundant lookups for additional views
      skipLookups = false,
      cachedMaterialProfile = null,
      cachedReferenceUrls = null,
      // REVISION SYSTEM: User-provided modification instructions
      revisionPrompt = null,
      // REVISION: Original render image URL — sent to Gemini as visual reference
      originalRenderUrl = null,
      // CUSTOM STYLING MODE: Job ID for saving results
      customStylingJobId = null,
      // Support customStylingPrompt at top level for additional views
      customStylingPrompt: topLevelStylingPrompt = null,
      // STRIPE MODE: Preset category from frontend
      presetCategory = null,
      selectedPreset = null,
      styleDescription = null,
      // Studio / camera overrides from frontend
      tool = null,
      studio = null,
      studioMode = null,       // 'light' | 'dark' — switches between dark/light studio
      cameraProfile = null,
      lighting = null,
      disableAutoStudio = false,
      // FadeWraps: allow passing full URL for the standard fade reference (optional)
      standardFadeReferenceUrl: standardFadeReferenceUrlOverride = null,
      // BATCH MODE: Skip saving to color_visualizations (batch pipeline persists separately)
      skipCacheStorage = false,
      // CACHE BYPASS: New designs ALWAYS skip cache. Cache is only for regenerating same view of existing design.
      skipCache = false,
      // forceNew: explicit alias for skipCache — callers that want a guaranteed
      // fresh model generation (never a cached render) pass forceNew:true.
      forceNew = false,
      // Optional per-call resolution override (e.g. "1K" for a fast preview pass).
      // When omitted, the LOCKED per-view resolution from view-angles-os is used —
      // the GENIE-extract views stay 4K so panel quality is never silently degraded.
      imageSizeOverride = null,
    } = requestBody;

    // A fresh generation is requested when EITHER flag is set. Downstream cache
    // gates read `freshGeneration` so forceNew behaves exactly like skipCache.
    const freshGeneration = skipCache || forceNew;
    // Resolve the effective image size for this call. Default = locked view resolution.
    const resolveImageSize = (vt: string) => imageSizeOverride || getResolution(vt || 'side');

    // ── LOG viewType on EVERY render call ──
    console.log(`🎬 RENDER CALL — viewType: "${viewType}", modeType: "${modeType}", vehicle: ${vehicleYear} ${vehicleMake} ${vehicleModel}`);

    // Resolve a FULL URL for the FadeWraps gold-standard reference image
    // V1 FIX: STANDARD_FADE_REFERENCE_URL is now a hardcoded full Supabase URL
    // No longer relying on requestOrigin which could be null
    const standardFadeReferenceUrl =
      (typeof standardFadeReferenceUrlOverride === 'string' && standardFadeReferenceUrlOverride.startsWith('http'))
        ? standardFadeReferenceUrlOverride
        : STANDARD_FADE_REFERENCE_URL; // This is now a full URL, not a relative path
    
    // HARD OVERRIDE: Force dedicated FadeWraps studio + camera when tool is fadewraps
    let effectiveStudio = studio;
    let effectiveCameraProfile = cameraProfile;
    let effectiveLighting = lighting;
    let effectiveDisableAutoStudio = disableAutoStudio;
    const effectiveTool = tool || modeType;

    if (effectiveTool === 'fadewraps' || modeType === 'fadewraps') {
      // Use DesignPro auto-studio selection (no hard override)
      effectiveCameraProfile = 'full_vehicle';
    }
    
    // Merge customStylingPrompt from top level into colorData if missing
    const effectiveColorData = colorData ? {
      ...colorData,
      customStylingPrompt: colorData.customStylingPrompt || topLevelStylingPrompt
    } : (topLevelStylingPrompt ? { customStylingPrompt: topLevelStylingPrompt } : null);

    // ============= SECURITY: REQUIRE AUTHENTICATION =============
    // Block anonymous/unauthenticated requests entirely
    if (!userEmail) {
      console.log('❌ SECURITY: No userEmail provided - blocking anonymous request');
      return new Response(
        JSON.stringify({ 
          error: 'Authentication required. Please log in to generate renders.',
          authRequired: true
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= CONTENT MODERATION =============
    // Initialize Supabase client early for moderation checks
    const supabaseUrl = getExternalSupabaseUrl();
    const supabaseKey = getExternalServiceRoleKey();
    const supabase = createExternalClient();

    // Studio reference removed — text prompt handles lighting, driver-side render handles consistency

    // Check if user is blocked
    const { data: blockedUser } = await supabase
      .from('blocked_users')
      .select('id, reason')
      .eq('email', userEmail)
      .maybeSingle();
    
    if (blockedUser) {
      console.log('❌ SECURITY: Blocked user attempted generation:', userEmail);
      return new Response(
        JSON.stringify({ 
          error: 'Your account has been suspended. Contact support for assistance.',
          blocked: true
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Expanded blocklist: Political, Pornography, Profanity, Hate Speech, Drugs
    const BLOCKED_TERMS = [
      // Political/Terrorism
      'palestine', 'israel', 'hamas', 'hezbollah', 'isis', 'taliban',
      'nazi', 'swastika', 'confederate', 'rebel fist', 'freedom fighter',
      'political', 'terrorist', 'militia', 'uprising', 'revolution',
      'genocide', 'ethnic cleansing', 'war crime',
      
      // Pornography/Adult Content
      'porn', 'xxx', 'nude', 'naked', 'sex', 'erotic', 'hentai', 
      'nsfw', 'adult content', 'explicit', 'genitals', 'breasts',
      'penetration', 'orgasm', 'fetish', 'bondage',
      
      // Profanity (common vulgar terms)
      'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy',
      'asshole', 'bastard', 'whore', 'slut',
      
      // Hate Speech/Slurs
      'nigger', 'faggot', 'retard', 'kike', 'spic', 'chink',
      'wetback', 'beaner', 'white power', 'black power',
      'racial slur', 'hate speech',
      
      // Drug Paraphernalia
      'crack pipe', 'drug paraphernalia'
    ];
    
    const contentToCheck = [
      colorData?.colorName,
      colorData?.patternName,
      colorData?.designName,
      colorData?.customStylingPrompt,
      vehicleMake,
      vehicleModel
    ].filter(Boolean).join(' ').toLowerCase();
    
    const blockedTermFound = BLOCKED_TERMS.find(term => contentToCheck.includes(term));
    
    if (blockedTermFound) {
      console.log('❌ SECURITY: Content moderation violation detected - term:', blockedTermFound);
      
      // Log the blocked attempt for audit
      await supabase.from('moderation_log').insert({
        user_email: userEmail,
        blocked_term: blockedTermFound,
        attempted_content: contentToCheck.substring(0, 500),
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Content policy violation. This type of content is not allowed.',
          contentViolation: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Log revision prompt if present
    if (revisionPrompt) {
      console.log('📝 REVISION MODE - User revision instructions:', revisionPrompt);
    }
    
    console.log('📦 Request body received:', JSON.stringify({ 
      vehicleYear, 
      vehicleMake, 
      vehicleModel, 
      modeType, 
      viewType, 
      cameraAngle, 
      colorData: colorData ? { ...colorData, hex: colorData.hex } : null,
      userEmail 
    }, null, 2));

    // ============= GOLDEN TEMPLATE CACHE LOOKUP =============
    // Check if we have a cached "perfect" render for this exact request
    // skipCache/forceNew=true means new design — ALWAYS generate fresh render
    if (!freshGeneration && modeType === 'GraphicsPro' && effectiveColorData?.customStylingPrompt && !revisionPrompt) {
      const promptSignature = effectiveColorData.customStylingPrompt.toLowerCase().trim();
      const vehicleSignature = `${vehicleYear} ${vehicleMake} ${vehicleModel}`;
      
      console.log('🔍 Checking golden template cache for:', { promptSignature, vehicleSignature });
      
      const { data: goldenTemplate, error: cacheError } = await supabase
        .from('render_templates')
        .select('*')
        .eq('prompt_signature', promptSignature)
        .eq('vehicle_signature', vehicleSignature)
        .eq('is_golden_template', true)
        .maybeSingle();
      
      if (cacheError) {
        console.log('⚠️ Golden template lookup error:', cacheError.message);
      } else if (goldenTemplate && goldenTemplate.render_urls) {
        console.log('✅ GOLDEN TEMPLATE CACHE HIT! Returning cached perfect render');
        
        // Increment use count
        await supabase
          .from('render_templates')
          .update({ use_count: (goldenTemplate.use_count || 0) + 1 })
          .eq('id', goldenTemplate.id);
        
        // Return the cached render for the requested view
        const cachedUrls = goldenTemplate.render_urls as Record<string, string>;
        const cachedUrl = cachedUrls[viewType] || cachedUrls['side'] || Object.values(cachedUrls)[0];
        
        if (cachedUrl) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              renderUrl: cachedUrl,
              allViews: cachedUrls,
              fromCache: true,
              cacheTemplateId: goldenTemplate.id,
              message: 'Served from golden template cache'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        console.log('📭 No golden template found, proceeding with AI generation');
      }
    }

    // Validate cameraAngle if provided
    if (cameraAngle !== undefined && !isValidAngle(cameraAngle)) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid camera angle: ${cameraAngle}. Must be one of: ${SPIN_VIEW_ANGLES.map(v => v.angle).join(', ')}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!vehicleYear || !vehicleMake || !vehicleModel || !modeType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Declare web search variables at function scope for ColorPro custom colors
    let webSearchPhotos: any[] = [];
    let validatedColorData: any = null;

    // Authenticated user ID — resolved from JWT token below, used for user-scoped storage paths
    let authenticatedUserId: string | null = internalCaller.userId;

    // ============= CHECK ADMIN/TESTER ROLE FIRST (BYPASS LIMITS) =============
    let isPrivilegedUser = internalCaller.internal;
    if (!internalCaller.internal && userEmail) {
      try {
        console.log('🔍 Checking admin/tester role for email:', userEmail);
        
        // Get the authenticated user from the JWT token in the request
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
          const token = authHeader.replace('Bearer ', '');
          const { data: { user }, error: authUserError } = await supabase.auth.getUser(token);
          
          if (authUserError) {
            console.log('⚠️ Could not verify auth token:', authUserError.message);
          } else if (user) {
            authenticatedUserId = user.id;
            console.log('✅ Authenticated user ID:', user.id);
            
            // Check if this specific user has admin OR tester role
            const { data: userRoleData, error: roleError } = await supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', user.id)
              .in('role', ['admin', 'tester']);
            
            if (roleError) {
              console.log('⚠️ Role check error:', roleError.message);
            } else if (userRoleData && userRoleData.length > 0) {
              isPrivilegedUser = true;
              const roles = userRoleData.map(r => r.role).join(', ');
              console.log(`✅ Privileged user detected (${roles}) - bypassing render limits`);
            } else {
              console.log('ℹ️ User is authenticated but not admin/tester');
            }
          }
        } else {
          console.log('ℹ️ No auth header provided');
        }
      } catch (error) {
        console.error('❌ Role check exception:', error);
      }
    }

    // ============= CHECK RENDER LIMITS (NON-PRIVILEGED ONLY) =============
    if (!isPrivilegedUser) {
      console.log('🔒 Checking render limits for:', userEmail);
      
      try {
        // First check subscription-based limits via RPC
        const { data: limitCheck, error: limitError } = await supabase
          .rpc('can_generate_render', { user_email: userEmail });

        if (limitError) {
          console.error('Error checking subscription limits:', limitError);
        } else if (limitCheck && !limitCheck.can_generate) {
          console.log('❌ Subscription render limit exceeded:', limitCheck);
          return new Response(
            JSON.stringify({ 
              error: limitCheck.message,
              limitExceeded: true,
              limitStatus: limitCheck
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // SECONDARY CHECK: Hard limit for non-subscribed users (prevent freemium abuse)
        // Check renders in last 24 hours for this email
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentRenders, error: recentError } = await supabase
          .from('color_visualizations')
          .select('id', { count: 'exact', head: true })
          .eq('customer_email', userEmail)
          .gte('created_at', twentyFourHoursAgo);
        
        if (!recentError && recentRenders !== null) {
          const renderCount = (recentRenders as any)?.length || 0;
          const FREEMIUM_DAILY_LIMIT = 2;
          
          // If no active subscription and exceeded daily limit
          if (!limitCheck?.can_generate && renderCount >= FREEMIUM_DAILY_LIMIT) {
            console.log(`❌ Freemium daily limit exceeded: ${renderCount}/${FREEMIUM_DAILY_LIMIT}`);
            return new Response(
              JSON.stringify({ 
                error: 'Daily render limit reached. Please subscribe for unlimited renders.',
                limitExceeded: true,
                dailyLimit: FREEMIUM_DAILY_LIMIT,
                used: renderCount
              }),
              { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
        
        console.log('✅ Render limits OK:', limitCheck);
      } catch (error) {
        console.error('Limit check exception:', error);
        // Block on limit check failure for security
        return new Response(
          JSON.stringify({ error: 'Could not verify render limits. Please try again.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // FadeWraps and WBTY both use patterns, others use solid colors
    if ((modeType === 'wbty' || modeType === 'fadewraps') && !colorData) {
      return new Response(
        JSON.stringify({ error: 'colorData required for pattern-based modes' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (modeType !== 'wbty' && modeType !== 'fadewraps' && modeType !== 'approvemode' && modeType !== 'CustomStyling' && modeType !== 'ColorProEnhanced' && !colorData) {
      return new Response(
        JSON.stringify({ error: 'colorData required for non-WBTY modes' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ColorProEnhanced requires a styling prompt (check effectiveColorData which merges top-level prompt)
    if (modeType === 'ColorProEnhanced' && (!effectiveColorData || !effectiveColorData.customStylingPrompt)) {
      console.log('❌ ColorProEnhanced missing customStylingPrompt. colorData:', colorData, 'topLevelPrompt:', topLevelStylingPrompt);
      return new Response(
        JSON.stringify({ error: 'customStylingPrompt required for ColorProEnhanced mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= GRAPHICSPRO PRINT-ONLY CONTENT DETECTION =============
    // GraphicsPro handles COLOR-CHANGE FILM only, not printed designs
    if ((modeType === 'GraphicsPro' || modeType === 'ColorProEnhanced') && effectiveColorData?.customStylingPrompt) {
      const PRINT_ONLY_KEYWORDS = [
        'photo', 'picture', 'image', 'galaxy', 'marble', 'camo', 'camouflage',
        'printed', 'print', 'texture', 'realistic flames', 'photo wrap',
        'forest', 'ocean', 'sunset', 'landscape', 'portrait', 'graphic design',
        'artwork', 'illustration', 'digital print', 'full print'
      ];
      
      const promptLower = effectiveColorData.customStylingPrompt.toLowerCase();
      const printKeywordFound = PRINT_ONLY_KEYWORDS.find(kw => promptLower.includes(kw));
      
      if (printKeywordFound) {
        console.log('🎨 PRINT-ONLY CONTENT DETECTED in GraphicsPro prompt:', printKeywordFound);
        return new Response(
          JSON.stringify({ 
            error: 'print_required',
            message: 'This design requires printing. GraphicsPro™ handles color-change film only. Try RestyleLibrary™ or DesignProAI™ for printed wraps, textures, and photo-based designs.'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ApproveMode requires a design URL
    if (modeType === 'approvemode' && (!colorData || !colorData.designUrl)) {
      return new Response(
        JSON.stringify({ error: 'designUrl required for ApproveMode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Gemini key pool — shared round-robin rotation from _shared/gemini-key-pool.ts
    if (!hasGeminiKey()) {
      console.error('GOOGLE_AI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Helper function to convert image URL to base64 for Gemini API
    async function imageUrlToBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
      try {
        // If already a data URL, extract the base64 part
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            return { mimeType: matches[1], data: matches[2] };
          }
          return null;
        }

        // Fetch the image
        let response = await fetch(url);

        // If transform URL fails (403/404), fall back to original URL
        if (!response.ok && url.includes('/render/image/')) {
          const originalUrl = url.replace('/storage/v1/render/image/public/', '/storage/v1/object/public/').split('?')[0];
          console.warn(`Transform URL failed (${response.status}), falling back to original: ${originalUrl.substring(0, 80)}...`);
          response = await fetch(originalUrl);
        }

        if (!response.ok) {
          console.warn(`Failed to fetch image (${response.status}): ${url.substring(0, 80)}...`);
          return null;
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        // Chunked base64 conversion — spread operator crashes on large arrays
        // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
        // string-building transiently ate hundreds of MB on multi-MB images.
        const binaryString64 = encodeBase64(arrayBuffer);
        const base64 = binaryString64;

        return { mimeType: contentType, data: base64 };
      } catch (error) {
        console.warn(`Error converting image to base64: ${url.substring(0, 80)}...`, error);
        return null;
      }
    }

    // ============= RENDER CACHING LOGIC =============
    // Check if we already have a cached render for this exact request
    console.log('🔍 Checking cache for existing render...');
    if (freshGeneration) {
      console.log(`🚫 fresh generation (skipCache=${skipCache}, forceNew=${forceNew}) — bypassing ALL cache layers`);
    }

    try {
      // skipCache/forceNew from request body = new design, ALWAYS fresh render
      // Some modes (like FadeWraps) also force skip
      let skipCacheLocal = freshGeneration;

      let cacheQuery = supabase
        .from('color_visualizations')
        .select('id, render_urls, generation_status')
        .eq('vehicle_year', parseInt(vehicleYear))
        .eq('vehicle_make', vehicleMake.trim().toLowerCase())
        .eq('vehicle_model', vehicleModel.trim().toLowerCase())
        .eq('mode_type', modeType)
        .eq('customer_email', userEmail)
        .eq('generation_status', 'completed');

      // Add mode-specific cache matching
      if (modeType === 'approvemode' && effectiveColorData?.designUrl) {
        cacheQuery = cacheQuery.eq('custom_design_url', effectiveColorData.designUrl);
      } else if ((modeType === 'CustomStyling' || modeType === 'ColorProEnhanced' || modeType === 'GraphicsPro') && effectiveColorData?.customStylingPrompt) {
        // ==========================================================
        // COLORPRO ENHANCED CACHE — PROMPT-SPECIFIC MATCHING
        // ==========================================================
        const promptKey = effectiveColorData.customStylingPrompt
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 200);
        cacheQuery = cacheQuery.eq('custom_styling_prompt_key', promptKey);
        console.log('🆕 Using ColorProEnhanced promptKey:', promptKey);
      } else if ((modeType === 'inkfusion' || modeType === 'colorpro' || modeType === 'ColorPro') && effectiveColorData?.colorName) {
        // For color modes, match BOTH color name AND hex code to prevent manufacturer collisions
        cacheQuery = cacheQuery.eq('color_name', effectiveColorData.colorName);
        if (effectiveColorData?.hex) {
          cacheQuery = cacheQuery.eq('color_hex', effectiveColorData.hex);
        }
      } else if (modeType === 'wbty' && effectiveColorData?.patternUrl) {
        // For WBTY pattern mode, match on pattern URL
        cacheQuery = cacheQuery.eq('custom_swatch_url', effectiveColorData.patternUrl);
      } else if (modeType === 'fadewraps') {
        // For FadeWraps, SKIP caching entirely to force fresh generation
        // FadeWraps prompt engineering is actively being developed and cached renders may have wrong fade direction
        console.log('⚠️ FADEWRAPS: Skipping cache - always generate fresh render for fade direction accuracy');
        skipCacheLocal = true;
      } else if (modeType === 'designpanelpro' && effectiveColorData?.panelUrl) {
        // For DesignPanelPro, match on panel URL + vehicle to prevent cross-vehicle cache hits.
        // Without vehicle matching, a "Toyota stripe kit" cache could serve a "Bronco stripe kit".
        cacheQuery = cacheQuery
          .eq('custom_swatch_url', effectiveColorData.panelUrl)
          .eq('vehicle_make', vehicleMake.trim().toLowerCase())
          .eq('vehicle_model', vehicleModel.trim().toLowerCase());
      }

      if (!skipCacheLocal) {
        const { data: cachedRenders, error: cacheError } = await cacheQuery.limit(1).maybeSingle();

        if (cacheError) {
          console.warn('Cache lookup error:', cacheError);
        } else if (cachedRenders && cachedRenders.render_urls) {
          // Check if the specific view exists in cached renders
          const renderUrls = cachedRenders.render_urls as Record<string, any>;
          
          // 360° spin: Check for specific angle in spin_views
          if (cameraAngle !== undefined) {
            const spinViews = renderUrls.spin_views as Record<number, string> | undefined;
            const cachedAngleUrl = spinViews?.[cameraAngle];
            
            if (cachedAngleUrl) {
              console.log(`✅ Cache HIT! Found existing 360° angle ${cameraAngle}° render`);
              return new Response(
                JSON.stringify({ 
                  renderUrl: cachedAngleUrl,
                  cached: true,
                  cacheId: cachedRenders.id
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            } else {
              console.log(`⚠️ Cache MISS for 360° angle ${cameraAngle}°, proceeding with generation`);
            }
          } else {
            // Legacy view type cache lookup
            const cachedViewUrl = renderUrls[viewType];
            
            if (cachedViewUrl) {
              console.log(`✅ Cache HIT! Found existing ${viewType} render`);
              return new Response(
                JSON.stringify({ 
                  renderUrl: cachedViewUrl,
                  cached: true,
                  cacheId: cachedRenders.id
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            } else {
              console.log(`⚠️ Cache PARTIAL: Found record but missing ${viewType} view`);
            }
          }
        } else {
          console.log('❌ Cache MISS: No matching render found, proceeding with generation');
        }
      } else {
        console.log('🧹 Cache completely bypassed for this mode, forcing fresh generation.');
      }
    } catch (cacheCheckError) {
      console.error('Error checking cache:', cacheCheckError);
      // Continue with generation if cache check fails
    }
    // ============= END CACHING LOGIC =============

    // Canonicalize make/model so Gemini sees the proper-noun model name
    // ("Tesla Cybertruck", not "tesla cyber truck") and locks geometry correctly.
    const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel, vehicleYear);
    const vehicle = [vehicleYear, canonicalMakeModel || `${vehicleMake} ${vehicleModel}`]
      .filter(Boolean)
      .join(' ');
    
    // ============= DETERMINE CAMERA POSITIONING (360° OR LEGACY) =============
    // Determine camera positioning based on cameraAngle (360°) or viewType (legacy)
    let cameraPositioning: string;
    
    if (cameraAngle !== undefined) {
      // Use 360° spin view angle configuration
      const spinView = getSpinViewAngle(cameraAngle);
      if (spinView) {
        cameraPositioning = spinView.cameraPrompt;
        console.log(`📸 Using 360° angle: ${cameraAngle}° (${spinView.label})`);
      } else {
        cameraPositioning = 'FRONT 3/4 VIEW - Default camera angle';
        console.warn(`⚠️ Invalid angle ${cameraAngle}, using default`);
      }
    } else {
      // Locked camera angles from view-angles-os.ts
      cameraPositioning = getCameraAngle(viewType || 'side');
      console.log(`📸 Using locked viewType: ${viewType}`);
    }
    // ============= END CAMERA POSITIONING =============
    
    let aiPrompt = '';
    let patternImageUrl = null;
    let referenceImages: string[] = []; // For AI Reference Learning System
    let referenceImageBase64: string | null = null; // For CustomStyling reference image
    let multiZoneLabel = ''; // For GraphicsPro two-tone zone labels
    // Hoisted from ColorPro block — needed at function scope for shared image logic (line ~2744)
    let isColorFlipFilm = false;
    let swatchMediaUrl: string | null = null;

    // ===============================================================
    // CUSTOM STYLING MODE — DEPRECATED (Replaced by ColorPro Enhanced)
    // ===============================================================
    if (modeType === 'CustomStyling') {
      console.log('⚠️ CustomStyling Mode is DEPRECATED - use ColorProEnhanced instead');
      return new Response(
        JSON.stringify({
          error: "Custom Styling mode has been replaced. Use ColorPro Enhanced mode instead.",
          deprecated: true,
          suggestedMode: 'ColorProEnhanced'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===============================================================
    // COLORPRO ENHANCED / GRAPHICSPRO MODE — Multi-Zone + Graphics via ColorPro Engine
    // ===============================================================
    // CRITICAL: GraphicsPro from frontend maps to this handler!
    if (modeType === 'ColorProEnhanced' || modeType === 'GraphicsPro') {
      console.log(`🚀 ${modeType} Mode Activated - Multi-zone via ColorPro engine`);
      
      // Use effectiveColorData which merges top-level customStylingPrompt
      const { customStylingPrompt, referenceImageUrl } = effectiveColorData || {};
      
      console.log('📝 ColorProEnhanced customStylingPrompt:', customStylingPrompt);
      console.log('📝 presetCategory:', presetCategory);
      
      if (!customStylingPrompt) {
        console.log('❌ Still missing customStylingPrompt after merge. effectiveColorData:', effectiveColorData);
        return new Response(
          JSON.stringify({ error: 'customStylingPrompt required for ColorProEnhanced mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const promptLower = customStylingPrompt.toLowerCase();
      
      // ============= FAMOUS LIVERY ENGINE - MUST CHECK FIRST =============
      // Canonical liveries (Martini, Gulf, Rothmans, etc.) need visual grounding
      // This MUST fire BEFORE generic stripe detection to prevent simplification
      const liveryInfo = detectFamousLivery(customStylingPrompt);
      
      if (liveryInfo) {
        console.log(`🏁🏁🏁 FAMOUS LIVERY DETECTED: ${liveryInfo.name} 🏁🏁🏁`);
        console.log(`📸 Fetching DataForSEO reference images for: ${liveryInfo.searchQueries[0]}`);
        
        // Fetch reference images via DataForSEO for visual grounding
        const liveryReferenceImages: string[] = [];
        const DATAFORSEO_API_KEY = Deno.env.get('DATAFORSEO_API_KEY');
        
        if (DATAFORSEO_API_KEY) {
          for (const query of liveryInfo.searchQueries.slice(0, 2)) {
            try {
              console.log(`🔍 DataForSEO query: "${query}"`);
              const searchResponse = await fetch('https://api.dataforseo.com/v3/serp/google/images/live/advanced', {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${DATAFORSEO_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify([{
                  keyword: query,
                  location_code: 2840,
                  language_code: "en",
                  device: "desktop",
                  depth: 10,
                }])
              });
              
              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                const results = searchData.tasks?.[0]?.result?.[0]?.items || [];
                console.log(`📸 Found ${results.length} images for query: "${query}"`);
                
                // Filter for valid image URLs only
                for (const item of results.slice(0, 3)) {
                  if (item.url && isValidImageUrl(item.url)) {
                    liveryReferenceImages.push(item.url);
                    console.log(`✅ Added livery reference: ${item.url.substring(0, 80)}...`);
                  }
                }
              }
            } catch (e) {
              console.error(`Failed to fetch livery images for query: ${query}`, e);
            }
          }
        } else {
          console.warn('⚠️ DATAFORSEO_API_KEY not configured - livery render without visual grounding');
        }
        
        console.log(`📸 Total livery reference images: ${liveryReferenceImages.length}`);
        
        // Build SPECIALIZED livery prompt with visual grounding
        const studioEnv = STUDIO_ENVIRONMENT;

        aiPrompt = `
=== 🏁🏁🏁 GRAPHICSPRO FAMOUS RACING LIVERY MODE 🏁🏁🏁 ===

THIS IS A FAMOUS, HISTORICALLY DOCUMENTED RACING LIVERY.
YOU MUST RENDER IT WITH EXACT HISTORICAL ACCURACY.

=== VEHICLE ===
${vehicle}

=== LIVERY: ${liveryInfo.name.toUpperCase()} ===

${liveryInfo.rules}

=== STRIPE CONFIGURATION ===
${liveryInfo.stripeConfig}

=== COLORS ===
${liveryInfo.colors.join(', ')}

=== BASE VEHICLE COLOR ===
${liveryInfo.baseColor}

${liveryReferenceImages.length > 0 ? `
=== 📸 REFERENCE IMAGES PROVIDED (CRITICAL) ===
${liveryReferenceImages.length} REFERENCE IMAGES are included showing the EXACT livery design.

YOU MUST:
• STUDY the reference images VERY CAREFULLY
• COUNT the number of stripes in the references
• MATCH the exact stripe colors, widths, and spacing
• REPLICATE the stripe layout precisely on the target vehicle
• The references show the CORRECT design - copy it faithfully

DO NOT:
❌ Simplify to a single stripe - liveries have MULTIPLE stripes
❌ Change the historical color palette
❌ Ignore the reference images
❌ Create your own interpretation

The reference images are your PRIMARY source of truth.
=== END REFERENCE INSTRUCTIONS ===
` : `
⚠️ NO REFERENCE IMAGES AVAILABLE - Follow rules PRECISELY
`}

=== STUDIO ENVIRONMENT ===
${studioEnv}

=== CAMERA POSITION ===
${cameraPositioning}

=== OUTPUT QUALITY ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
Professional DSLR automotive photography quality

=== 🚨 CRITICAL FAILURE CONDITIONS 🚨 ===
❌ RENDER FAILS if only ONE stripe is generated (${liveryInfo.name} requires MULTIPLE stripes)
❌ RENDER FAILS if wrong colors are used
❌ RENDER FAILS if stripe configuration doesn't match historical livery
❌ RENDER FAILS if base vehicle color is wrong

=== GENERATE NOW ===
Create hyper-photorealistic render of ${vehicle} with the EXACT ${liveryInfo.name.toUpperCase()}.
MATCH THE REFERENCE IMAGES. RENDER ALL STRIPES. USE CORRECT COLORS.

${STUDIO_REINFORCEMENT}
`.trim();

        console.log('🏁 LIVERY MODE PROMPT BUILT - Skipping stripe/two-tone handlers');
        
        // Add livery references to webSearchPhotos for AI vision call
        webSearchPhotos = liveryReferenceImages.map(url => ({
          url,
          title: liveryInfo.name,
          source: 'livery_reference'
        }));
        
        // Set multi-zone label for display
        multiZoneLabel = `${liveryInfo.name} - ${liveryInfo.colors.join(' | ')}`;
        
        // SKIP to AI generation - bypass all other handlers
      } else {
      
      // ============= STRIPE MODE v2 - EARLY DETECTION & BYPASS =============
      // This MUST fire BEFORE the complex multi-zone preprocessors
      // Stripe categories that bypass full config: OEM, vintage, bodylines
      const STRIPE_CATEGORIES = ['bodylines', 'oem', 'vintage'];
      const isStripeCategoryMode = STRIPE_CATEGORIES.includes(presetCategory ?? '');
      
      const stripeIntent = (
        isStripeCategoryMode || // OEM, vintage, bodylines tabs = ALWAYS stripe mode
        selectedPreset?.toLowerCase().includes('stripe') ||
        selectedPreset?.toLowerCase().includes('beltline') ||
        selectedPreset?.toLowerCase().includes('rocker') ||
        selectedPreset?.toLowerCase().includes('shoulder') ||
        selectedPreset?.toLowerCase().includes('sweep') ||
        selectedPreset?.toLowerCase().includes('oem') ||
        selectedPreset?.toLowerCase().includes('hockey') ||
        selectedPreset?.toLowerCase().includes('bumblebee') ||
        selectedPreset?.toLowerCase().includes('rally') ||
        selectedPreset?.toLowerCase().includes('heritage') ||
        /stripe|rocker|beltline|shoulder|swoosh|panel sweep|panel stripe|body line|pinstripe|quarter sweep|oem|racing|rally|hockey|bumblebee|heritage/i.test(promptLower)
      ) && !(
        // NOT a two-tone request
        promptLower.includes('two tone') ||
        promptLower.includes('two-tone') ||
        (promptLower.includes('top half') && promptLower.includes('bottom half')) ||
        (promptLower.includes('upper half') && promptLower.includes('lower half')) ||
        (promptLower.includes('left side') && promptLower.includes('right side')) ||
        (promptLower.includes('left half') && promptLower.includes('right half'))
      );
      
      if (stripeIntent) {
        console.log('🎯 STRIPE MODE ACTIVATED - Bypassing complex preprocessors');
        
        // Detect base vehicle color from "on [color] car" pattern
        let detectedBaseColor = '';
        const baseColorMatch = promptLower.match(/\bon\s+(\w+)\s+(?:car|vehicle|truck|suv)/i);
        if (baseColorMatch) {
          detectedBaseColor = baseColorMatch[1].charAt(0).toUpperCase() + baseColorMatch[1].slice(1);
        }
        
        const studioEnv = STUDIO_ENVIRONMENT;
        
        // Build CLEAN stripe-only prompt - bypasses ALL complex engines
        aiPrompt = `
=== GRAPHICSPRO STRIPE MODE — VINYL STRIPES ONLY ===

You are generating VINYL STRIPES on a vehicle. NOT a full-body wrap.
This is NOT a two-tone wrap. This is NOT a multi-zone color split.

=== VEHICLE ===
${vehicle}

=== STUDIO ENVIRONMENT ===
${studioEnv}

=== CAMERA POSITION ===
${cameraPositioning}

=== OUTPUT QUALITY ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
Professional DSLR automotive photography quality

=== USER STRIPE REQUEST ===
"${customStylingPrompt}"

=== STRIPE-ONLY RULES (CRITICAL) ===

1. VEHICLE BODY COLOR MUST REMAIN UNCHANGED
   ${detectedBaseColor ? `• Base vehicle color: ${detectedBaseColor.toUpperCase()} - the ENTIRE car body stays this color` : '• Keep the vehicle in its original factory/base color'}
   • Hood, doors, fenders, quarters, roof - ALL stay the BASE COLOR
   • Do NOT repaint ANY body panels

2. APPLY STRIPE COLORS ONLY TO THE STRIPE LINE ITSELF
   • A stripe is a THIN ACCENT LINE (1-6 inches wide typically)
   • Only the stripe geometry gets the user's specified colors
   • The stripe sits ON TOP of the base body color

3. STRIPE TYPE DEFINITIONS:
   • ROCKER STRIPE: Horizontal line along lower body (8-14" from ground)
   • BELTLINE STRIPE: Mid-body line at window sill height (2-4" wide)
   • SHOULDER STRIPE: Upper body line just below window line
   • QUARTER PANEL SWEEP: Flowing accent on rear quarter panels
   • FENDER-TO-QUARTER SWOOSH: Continuous arc from front fender to rear

4. MULTI-COLOR STRIPE INTERPRETATION:
   • "Red and gold stripe" = Red stripe WITH gold accent/outline, NOT two car halves
   • Primary color = main stripe body
   • Secondary color = outline/accent layer on the stripe

=== WHAT THIS IS NOT ===
❌ NOT a two-tone wrap (car painted two different colors)
❌ NOT a multi-zone split (top half/bottom half)
❌ NOT large color blocks or panels
❌ NOT a full-body recolor

=== WHAT THIS IS ===
✅ A thin decorative stripe line on an otherwise single-color car
✅ Clean vinyl installer-style stripe geometry
✅ Colors apply ONLY to the stripe, not the vehicle body

=== IGNORE PRESET IMAGE COLORS (CRITICAL) ===
• DO NOT copy any colors from preset thumbnail images
• DO NOT add neon, glow, backlight, illumination, or lighting effects
• DO NOT add purple, blue, or orange glow halos
• Preset images are GEOMETRY DIAGRAMS ONLY - ignore their colors completely
• Use ONLY the colors explicitly specified by the user
• If user does NOT specify colors, use neutral white/black vinyl for the stripe

=== STRIPE GEOMETRY MUST BE IDENTICAL IN ALL VIEWS ===
• Same width, same placement, same colors across all render angles
• NO drift between views

=== DO NOT DO THESE THINGS ===
• DO NOT create full-body two-tone sections
• DO NOT paint half the car one color and half another
• DO NOT create diagonal color blocks
• DO NOT add random shapes or logos
• DO NOT recolor the vehicle body
• DO NOT apply preset two-tone patterns
• DO NOT add neon glow or lighting effects

=== NEGATIVE PROMPT ===
NO two-tone body wraps, NO multi-zone color splits, NO full-body recolors,
NO diagonal blocks, NO half-car painting, NO top/bottom splits,
NO random shapes, NO logos unless requested, NO neon, NO glow,
NO backlight effects, NO illumination, NO purple/blue/orange halos.

=== GENERATE NOW ===
Create hyper-photorealistic render of ${vehicle} with ONLY the requested STRIPE.
Vehicle body color remains UNCHANGED. Only the stripe line gets the specified colors.
Use clean solid vinyl with NO glow or lighting effects.

${STUDIO_REINFORCEMENT}
`.trim();

        console.log('🎯 STRIPE MODE PROMPT LENGTH:', aiPrompt.length);
        // Skip the rest of the GraphicsPro preprocessor - go directly to AI generation
      } else {
        // ============= TWO-TONE DETECTION - EARLY BYPASS =============
        // Check if this is a two-tone request BEFORE running any preprocessors
        const twoToneIntent = (
          promptLower.includes('two tone') ||
          promptLower.includes('two-tone') ||
          (promptLower.includes('top half') && promptLower.includes('bottom half')) ||
          (promptLower.includes('upper half') && promptLower.includes('lower half')) ||
          (promptLower.includes('top') && promptLower.includes('bottom') && (promptLower.includes('chrome') || promptLower.includes('satin') || promptLower.includes('matte') || promptLower.includes('gloss')))
        );
        
        if (twoToneIntent) {
          console.log('🎨 TWO-TONE MODE ACTIVATED - Direct bypass for reliability');
          
          // Parse top/bottom colors directly from prompt
          // Pattern: "top half [color1] [finish1], bottom half [color2] [finish2]"
          // Or: "top half [finish1] [color1] bottom half [finish2] [color2]"
          let topColor = 'Gold';
          let topFinish = 'Chrome';
          let bottomColor = 'Black';
          let bottomFinish = 'Satin';
          
          // Try to extract colors from prompt
          const topMatch = promptLower.match(/top\s+(?:half\s+)?(\w+)\s*(\w*)\s*(?:chrome|satin|matte|gloss|metallic)?/i);
          const bottomMatch = promptLower.match(/bottom\s+(?:half\s+)?(\w+)\s*(\w*)\s*(?:chrome|satin|matte|gloss|metallic)?/i);
          
          // More specific parsing for "gold chrome" vs "chrome gold" patterns
          if (promptLower.includes('gold chrome') || promptLower.includes('chrome gold')) {
            topColor = 'Gold';
            topFinish = 'Chrome';
          }
          if (promptLower.includes('satin black') || promptLower.includes('black satin')) {
            bottomColor = 'Black';
            bottomFinish = 'Satin';
          }
          
          // Check for specific finish keywords in top section
          if (promptLower.match(/top.*(chrome)/i)) topFinish = 'Chrome';
          if (promptLower.match(/top.*(satin)/i)) topFinish = 'Satin';
          if (promptLower.match(/top.*(matte)/i)) topFinish = 'Matte';
          if (promptLower.match(/top.*(gloss)/i)) topFinish = 'Gloss';
          
          // Check for specific finish keywords in bottom section
          if (promptLower.match(/bottom.*(chrome)/i)) bottomFinish = 'Chrome';
          if (promptLower.match(/bottom.*(satin)/i)) bottomFinish = 'Satin';
          if (promptLower.match(/bottom.*(matte)/i)) bottomFinish = 'Matte';
          if (promptLower.match(/bottom.*(gloss)/i)) bottomFinish = 'Gloss';
          
          // Extract color names
          const colorMatch1 = promptLower.match(/top\s+(?:half\s+)?(gold|silver|black|white|red|blue|green|purple|orange|pink|gray|grey)/i);
          const colorMatch2 = promptLower.match(/bottom\s+(?:half\s+)?(gold|silver|black|white|red|blue|green|purple|orange|pink|gray|grey)/i);
          if (colorMatch1) topColor = colorMatch1[1].charAt(0).toUpperCase() + colorMatch1[1].slice(1);
          if (colorMatch2) bottomColor = colorMatch2[1].charAt(0).toUpperCase() + colorMatch2[1].slice(1);
          
          const studioEnv = STUDIO_ENVIRONMENT;

          console.log(`🎨 TWO-TONE: Top=${topColor} ${topFinish}, Bottom=${bottomColor} ${bottomFinish}`);
          
          // Build TWO-TONE SPECIFIC prompt - completely bypasses ColorPro's single-color logic
          aiPrompt = `
=== GRAPHICSPRO TWO-TONE WRAP — MANDATORY TWO-COLOR VEHICLE ===

🚨🚨🚨 THIS IS A TWO-TONE WRAP. THE VEHICLE MUST HAVE TWO DISTINCT COLORS. 🚨🚨🚨

If the entire vehicle appears as ONE color, the render FAILS COMPLETELY.

=== VEHICLE ===
${vehicle}

=== STUDIO ENVIRONMENT ===
${studioEnv}

=== CAMERA POSITION ===
${cameraPositioning}

=== OUTPUT QUALITY ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
Professional DSLR automotive photography quality
16:9 aspect ratio MANDATORY

=== THE TWO ZONES (READ CAREFULLY) ===

🔴 TOP HALF (Upper 50% of vehicle):
   COLOR: ${topColor.toUpperCase()}
   FINISH: ${topFinish.toUpperCase()}
   INCLUDES: Hood, Roof, A/B/C pillars, Upper doors (above beltline), Upper fenders, Upper quarters
   ${topFinish.toLowerCase() === 'chrome' ? 'CHROME REQUIREMENTS: Mirror-like perfect reflections, visible softbox reflections, extremely high reflectivity' : ''}

🔵 BOTTOM HALF (Lower 50% of vehicle):
   COLOR: ${bottomColor.toUpperCase()}
   FINISH: ${bottomFinish.toUpperCase()}
   INCLUDES: Lower doors (below beltline), Lower fenders, Lower quarters, Rockers, Lower bumpers
   ${bottomFinish.toLowerCase() === 'satin' ? 'SATIN REQUIREMENTS: Soft sheen, minimal reflection, smooth matte-like appearance with slight gloss' : ''}

=== SPLIT LINE LOCATION (CRITICAL) ===
The dividing line between TOP and BOTTOM is at the BELTLINE:
• The beltline is the horizontal crease that runs along the door handles
• Everything ABOVE this line = TOP zone (${topColor} ${topFinish})
• Everything BELOW this line = BOTTOM zone (${bottomColor} ${bottomFinish})
• The split must be a SHARP, CLEAN horizontal line - NO gradient, NO fade

=== VISUAL VERIFICATION CHECKLIST ===
✓ Can you see ${topColor.toUpperCase()} color on the hood? → REQUIRED
✓ Can you see ${topColor.toUpperCase()} color on the roof? → REQUIRED  
✓ Can you see ${bottomColor.toUpperCase()} color on the lower doors? → REQUIRED
✓ Can you see ${bottomColor.toUpperCase()} color on the rockers? → REQUIRED
✓ Is there a clear horizontal split line visible? → REQUIRED

=== FAILURE CONDITIONS (RENDER REJECTED IF) ===
❌ Entire vehicle is ONE solid color
❌ Only roof is different color (need full upper 50%)
❌ Colors blend/gradient together (need sharp separation)
❌ Wrong colors in wrong zones
❌ Split line is diagonal or curved (must be horizontal at beltline)

=== WHAT YOU ARE RENDERING ===
A ${vehicle} with a professional TWO-TONE vinyl wrap:
- TOP HALF: ${topColor} ${topFinish} vinyl
- BOTTOM HALF: ${bottomColor} ${bottomFinish} vinyl
- Split at beltline (door handle height)

=== NO TEXT RULE ===
DO NOT add ANY text, watermarks, logos, or branding to this image.

GENERATE THE TWO-TONE WRAP NOW. BOTH COLORS MUST BE CLEARLY VISIBLE.

${STUDIO_REINFORCEMENT}
`.trim();

          console.log('🎨 TWO-TONE PROMPT LENGTH:', aiPrompt.length);
          // Skip the rest - go directly to AI generation
        } else {
        // ============= STANDARD MULTI-ZONE MODE =============
      
        // 1) Run the ColorPro Enhanced Pre-Processor
        const enhancedProfile = await runColorProEnhancedPreProcessor(
          customStylingPrompt,
          vehicle,
          revisionPrompt,
          supabase
        );
        
        console.log('✨ Enhanced Profile:', JSON.stringify({
          zoneCount: enhancedProfile.overrideFilmZones.length,
          graphicCount: enhancedProfile.overrideGraphics.length,
          multiFilmInfo: enhancedProfile.multiFilmInfo
        }));
        
        // 2) Build the ColorPro base prompt using the PRIMARY zone
        const primaryZone = enhancedProfile.overrideFilmZones[0];
        if (!primaryZone) {
          return new Response(
            JSON.stringify({ error: 'No valid zones found in styling prompt' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Use GraphicsProPrompt builder for GraphicsPro mode, ColorPro for ColorProEnhanced
        if (modeType === 'GraphicsPro') {
          // ✅ CORRECT: Use GraphicsPro prompt builder
          aiPrompt = buildGraphicsProPrompt({
            userPrompt: customStylingPrompt,
            vehicle,
            viewType,
            cameraPositioning,
            revisionPrompt,
            styleDescription,
            selectedPreset,
            presetCategory,
            hasReferenceImage: !!referenceImageUrl,
          });
          console.log('✅ GraphicsPro: Using buildGraphicsProPrompt');
        } else {
          // ColorProEnhanced mode - use ColorPro builder with zone block
          aiPrompt = buildColorProPrompt({
            vehicle,
            colorName: primaryZone.colorName,
            manufacturer: primaryZone.manufacturer,
            hex: primaryZone.hex,
            finish: primaryZone.finish,
            cameraAngle: cameraPositioning,
            viewType,
            lab: primaryZone.lab,
            reflectivity: primaryZone.reflectivity,
            metallic_flake: primaryZone.metallic_flake,
            materialValidated: primaryZone.materialValidated,
            graphicsProZoneBlock: enhancedProfile.overrideFilmZones.length > 1 
              ? formatEnhancedFilmZones(enhancedProfile.overrideFilmZones)
              : undefined,
            zones: enhancedProfile.overrideFilmZones.map(z => ({
              finish_profile: z.finish_profile,
              finish: z.finish
            })),
            toolBranding: 'ColorPro™',
          });
        }
      
      // Append graphics if present (cut vinyl overlays)
      if (enhancedProfile.overrideGraphics.length > 0) {
        aiPrompt += formatEnhancedGraphics(enhancedProfile.overrideGraphics);
      }
      
      // 5) Handle reference image if provided
      if (referenceImageUrl) {
        try {
          console.log('Fetching reference image:', referenceImageUrl);
          const refResponse = await fetch(referenceImageUrl, {
            headers: { 'User-Agent': 'Deno/1.0' }
          });
          
          if (refResponse.ok) {
            const refBlob = await refResponse.arrayBuffer();
            // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
            // string-building transiently ate hundreds of MB on multi-MB images.
            const binaryString64 = encodeBase64(refBlob);
            const contentType = refResponse.headers.get('content-type') || 'image/jpeg';
            referenceImageBase64 = `data:${contentType};base64,${binaryString64}`;
            console.log('Reference image loaded successfully');
            
            // Add reference image instructions to the prompt
            aiPrompt += `

=== 🎯 REFERENCE IMAGE PROVIDED (CRITICAL) ===

A reference image has been uploaded showing the EXACT style wanted.

YOU MUST:
• STUDY the reference image carefully
• MATCH the exact curve flow, scallop pattern, edge treatment
• REPLICATE the stripe style, width, and placement from the reference
• ADAPT the design to fit the target vehicle's proportions
• MAINTAIN the same visual language (thick/thin lines, flowing curves, layered effects)

DO NOT:
• Ignore the reference image
• Create a generic design instead  
• Change the style significantly from the reference

The reference image is your PRIMARY source of design direction.
=== END REFERENCE IMAGE INSTRUCTIONS ===
`;
          }
        } catch (error) {
          console.warn('Failed to load reference image, continuing without it:', error);
        }
      }
      
      console.log('✅ ColorPro Enhanced prompt built with', enhancedProfile.overrideFilmZones.length, 'zones');
      
      // Build multi-zone label for display (e.g., "TeckWrap Chrome Gold | KPMF Satin Black")
      if (enhancedProfile.multiFilmInfo && enhancedProfile.multiFilmInfo.length > 1) {
        multiZoneLabel = enhancedProfile.multiFilmInfo
          .filter(z => z.zone !== 'body') // Exclude spurious body zone for two-tone
          .map(z => `${z.manufacturer} ${z.colorName}`.trim())
          .join(' | ');
        console.log('📝 Multi-zone label:', multiZoneLabel);
      } else if (enhancedProfile.multiFilmInfo && enhancedProfile.multiFilmInfo.length === 1) {
        const zone = enhancedProfile.multiFilmInfo[0];
        multiZoneLabel = `${zone.manufacturer} ${zone.colorName}`.trim();
      }
        } // Close the else block for standard multi-zone mode (from twoToneIntent else)
      } // Close the stripeIntent else block
      } // Close the liveryInfo else block
    }
    // WBTY uses repeating patterns, FadeWraps uses gradients
    else if (modeType === 'wbty' || modeType === 'fadewraps') {
      const { 
        patternUrl, finish = 'gloss', patternScale = 1, gradientScale = 1, gradientDirection = 'front-to-back',
        fadeStyle, colorName, colorHex,
        addHood = false, addFrontBumper = false, addRearBumper = false, kitSize, roofSize,
        isInkFusion = false,
        fadeSpec // 🔒 S.A.W. DETERMINISTIC FADE SPEC from frontend
      } = colorData || {};
      
      // 🔒 S.A.W. STUDIO LOCK from frontend (prevents drift to cyclorama/white)
      const studioLock = requestBody.studioLock;
      
      // InkFusion colors don't need a pattern URL - they use hex color for gradient
      const needsPatternUrl = modeType === 'wbty' || (modeType === 'fadewraps' && !isInkFusion);
      
      if (!patternUrl && needsPatternUrl) {
        return new Response(
          JSON.stringify({ error: `Pattern URL required for ${modeType.toUpperCase()} mode` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // For FadeWraps with InkFusion (no pattern), build prompt from color data directly
      if (modeType === 'fadewraps' && isInkFusion) {
        console.log('🎨 FadeWraps InkFusion mode - using hex-based gradient rendering');
        console.log(`📸 FadeWraps viewType: ${viewType}, fadeStyle: ${fadeStyle}`);
        
        // 🔒 S.A.W. DETERMINISTIC LOGGING - verify params are correct
        if (fadeSpec) {
          console.log('🎯 DETERMINISTIC FADE SPEC RECEIVED:', JSON.stringify({
            fadeAxis: fadeSpec.fadeAxis,
            fadeStart: fadeSpec.fadeStart,
            fadeEnd: fadeSpec.fadeEnd,
            fadeProfile: fadeSpec.fadeProfile
          }));
        } else {
          console.warn('⚠️ NO FADE SPEC RECEIVED - using default fade logic');
        }
        
        if (studioLock) {
          console.log('🔒 STUDIO LOCK RECEIVED:', JSON.stringify({
            studioEnvironment: studioLock.studioEnvironment,
            disableCyclorama: studioLock.disableCyclorama,
            wallColor: studioLock.wallColor
          }));
        }
        
        // ============= FETCH FADE DIRECTION REFERENCE IMAGES =============
        // CRITICAL: AI ignores text prompts for directional instructions - needs VISUAL REFERENCE
        const fadeReferenceInfo = getFadeReferenceInfo(fadeStyle || 'front_back');
        let fadeDirectionReferenceImages: string[] = [];
        
        if (fadeReferenceInfo) {
          console.log(`🔍 Fetching fade direction reference images for style: ${fadeStyle || 'front_back'}`);
          console.log(`🔍 Search query: ${fadeReferenceInfo.searchQuery}`);
          
          try {
            const externalUrl = getExternalSupabaseUrl();
            const externalKey = getExternalServiceRoleKey();

            if (externalUrl && externalKey) {
              const searchResponse = await fetch(`${externalUrl}/functions/v1/search-vinyl-product-images`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${externalKey}`
                },
                body: JSON.stringify({
                  query: fadeReferenceInfo.searchQuery,
                  maxResults: 3
                })
              });
              
              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                fadeDirectionReferenceImages = (searchData.photos || [])
                  .filter((p: any) => isValidImageUrl(p.url))
                  .map((p: any) => p.url)
                  .slice(0, 3);
                console.log(`✅ Found ${fadeDirectionReferenceImages.length} fade direction reference images`);
              } else {
                console.error('❌ Fade reference search failed:', searchResponse.status);
              }
            }
          } catch (err) {
            console.error('❌ Fade reference search error:', err);
          }
        }
        
        // Store for contentParts builder
        if (fadeDirectionReferenceImages.length > 0) {
          webSearchPhotos = fadeDirectionReferenceImages.map(url => ({ url }));
        }
        
        // 🔒 INKFUSION HARD GATE — Enforce InkFusion-specific render parameters
        const inkFusionParams = {
          materialType: 'printed-ink',
          allowTextOverlay: false,
          allowWatermark: false,
          disableColorPro: true,
          disableVinylReflectivity: true,
          // 🔒 S.A.W. FREEZE EXISTING SHEEN — Do NOT override gloss/specular
          lockExistingMaterialResponse: true,
          preventGlossOverride: true,
          preventSpecularOverride: true,
          reuseMaterialCache: true,
          // 🏗️ S.A.W. STUDIO ENVIRONMENT ONLY (no material interaction)
          studioEnvironment: studioLock?.studioEnvironment || 'seamless-gray-concrete',
          floorMaterial: studioLock?.floorMaterial || 'smooth-matte-concrete',
          floorRoughness: 0.7,
          floorReflectivity: 0.02,
          wallColor: studioLock?.wallColor || '#959595',
          contactShadows: true,
          disableCyclorama: studioLock?.disableCyclorama ?? true,
          disableCurvedBackdrop: studioLock?.disableCurvedBackdrop ?? true,
          // 📸 S.A.W. REQUIRED VIEWS with material cache
          requiredViews: ['side', 'rear_3q', 'front_3q', 'top']
        };
        
        // 🔒 CROSSFADE ZONE MODEL — Remove direction, use zone-based fade
        const effectiveFadeStyle = fadeStyle;
        const useZoneModel = fadeStyle === 'crossfade';
        
        console.log(`🎨 InkFusion params: ${JSON.stringify(inkFusionParams)}`);
        console.log(`🔥 CrossFade zone model: ${useZoneModel}`);
        
        // Build base prompt
        aiPrompt = buildFadeWrapsPrompt({
          vehicle,
          colorData: {
            ...colorData,
            colorHex: colorHex || colorName,
            isInkFusion: true,
            finish: finish || 'Gloss',
            ...inkFusionParams,
            // 🔒 S.A.W. PASS DETERMINISTIC FADE SPEC TO PROMPT BUILDER
            fadeSpec
          },
          finish,
          gradientDirection: useZoneModel ? 'crossfade-zones' : gradientDirection,
          fadeStyle: effectiveFadeStyle,
          cameraAngle: cameraPositioning,
          addHood,
          addFrontBumper,
          addRearBumper,
          kitSize,
          roofSize,
          viewType // Pass viewType for top-view specific handling
        });
        
        // 🔒 S.A.W. APPEND DETERMINISTIC FADE SPEC CONSTRAINT BLOCK
        if (fadeSpec && fadeSpec.prompt) {
          aiPrompt += `

${fadeSpec.prompt}
`;
          console.log('✅ Appended deterministic fade spec constraint to prompt');
        }
        
        // 🔒 S.A.W. APPEND STUDIO LOCK CONSTRAINT BLOCK
        if (studioLock) {
          aiPrompt += `

🔒 STUDIO ENVIRONMENT — LOCKED (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• studioEnvironment: ${studioLock.studioEnvironment}
• Floor: Medium-dark gray smooth matte concrete (#383838-#484848), FLAT plane, NO curves
• Floor is DRY — NOT wet, NOT mirror, NOT epoxy — subtle natural sheen only
• Walls: Medium gray (${studioLock.wallColor}), FLAT, NO cyclorama dome
• SEAMLESS gradient from floor to backdrop — no hard edges, no visible seam
• disableCyclorama: ${studioLock.disableCyclorama} — NO curved floor/wall transitions
• disableCurvedBackdrop: ${studioLock.disableCurvedBackdrop} — NO rounded edges anywhere
• Output: 4K minimum (${studioLock.minWidth}x${studioLock.minHeight})
• NO TEXT/WATERMARKS in image (client overlay handles branding)

⚠️ FLAT CONTINUOUS FLOOR ONLY — no circular pads, no cyclorama cutouts
`;
          console.log('✅ Appended studio lock constraint to prompt');
        }
        
        // Append fade reference prompt section if we have reference images
        if (fadeDirectionReferenceImages.length > 0) {
          const fadeReferencePrompt = buildFadeReferencePromptSection(fadeStyle || 'front_back', true);
          aiPrompt += '\n\n' + fadeReferencePrompt;
          console.log('✅ Added fade direction reference prompt section');
        }
      }
      
      // Pattern-based rendering (original logic)
      if (patternUrl && !isInkFusion) {
        console.log(`Fetching pattern image for ${modeType.toUpperCase()} mode:`, patternUrl);
        try {
        // Validate URL format
        if (!patternUrl.startsWith('http://') && !patternUrl.startsWith('https://')) {
          throw new Error(`Invalid pattern URL format: ${patternUrl}`);
        }

        const patternResponse = await fetch(patternUrl, {
          headers: {
            'User-Agent': 'Deno/1.0'
          }
        });
        
        if (!patternResponse.ok) {
          throw new Error(`Failed to fetch pattern: ${patternResponse.status} ${patternResponse.statusText}`);
        }

        const patternBlob = await patternResponse.arrayBuffer();
        
        // Convert array buffer to base64 in chunks to avoid stack overflow
        // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
        // string-building transiently ate hundreds of MB on multi-MB images.
        const binaryString64 = encodeBase64(patternBlob);
        const base64Pattern = binaryString64;
        
        patternImageUrl = `data:image/png;base64,${base64Pattern}`;
        console.log('Pattern image loaded successfully, size:', patternBlob.byteLength);
      } catch (error: any) {
        console.error('Failed to fetch pattern image:', error);
        console.error('Pattern URL was:', patternUrl);
        return new Response(
          JSON.stringify({ error: `Failed to load pattern image: ${error?.message || 'Unknown error'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
        }

        // Different prompts for WBTY vs FadeWraps
        if (modeType === 'fadewraps') {
        aiPrompt = buildFadeWrapsPrompt({
          vehicle,
          colorData,
          finish,
          gradientDirection,
          fadeStyle,
          cameraAngle: cameraPositioning,
          addHood,
          addFrontBumper,
          addRearBumper,
          kitSize,
          roofSize,
          viewType // Pass viewType for top-view specific handling
        });
      } else {
        // WBTY mode = repeating pattern tiles - UNIFIED BUILDER
        console.log("🎨 Using Unified Builder Suite (PatternPro Mode)");
        
        const patternName = colorData?.patternName || colorData?.colorName || "Custom Pattern";
        const patternNameLower = patternName.toLowerCase();
        
        // Auto-detect pattern category
        const patternCategory =
          ["marble", "stone", "granite", "onyx"].some(v => patternNameLower.includes(v)) ? "marble" as const :
          ["carbon", "fiber", "kevlar", "weave", "honeycomb"].some(v => patternNameLower.includes(v)) ? "carbon" as const :
          ["camo", "tactical", "multicam", "military"].some(v => patternNameLower.includes(v)) ? "camo" as const :
          ["hex", "grid", "geometric"].some(v => patternNameLower.includes(v)) ? "geometric" as const :
          "abstract" as const;
        
        aiPrompt = buildRestyleProRenderPrompt({
          mode: "pattern",
          vehicle,
          cameraPositioning,
          viewType,
          patternName,
          patternCategory,
          patternScale,
          finish,
          textureProfile: colorData?.textureProfile || null,
          environment: "studio",
          debugMode: false,
        });
        
        console.log("✅ Unified Builder PatternPro active");
        }
      } // Close if (patternUrl && !isInkFusion)
    } else if (modeType === 'designpanelpro') {
      // DesignPanelPro mode - custom panel designs
      const { panelUrl, panelName, finish = 'gloss', designAnchorText, heroReferenceUrl, coverageType } = colorData || {};

      // ── PHOTO REALISM (explicit-request only) ──────────────────────────────
      // DesignPro reproduces its hero here. It ILLUSTRATES by default (pro
      // designer's call) and only enforces photographic realism when the customer
      // EXPLICITLY asked for it. We detect that from any brief text available in
      // this branch (the design name, the hero anchor description, and any brief
      // fields the caller forwarded). Scene words alone (ranch, sunset) do NOT
      // trigger it. This ONLY appends a directive string to the 3D render prompt —
      // it never changes panel layout, labels, dimensions, or the flat-panel
      // production pipeline. Self-contained; affects nothing else in this file.
      const dppBriefText = [
        panelName,
        designAnchorText,
        (colorData as any)?.customStylingPrompt,
        (colorData as any)?.originalPrompt,
        (colorData as any)?.designBrief,
        (colorData as any)?.prompt,
      ].filter(Boolean).join(" ").toLowerCase();
      const dppWantsPhoto =
        /\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(dppBriefText) ||
        /\b(lifelike|true[-\s]to[-\s]life)\b/.test(dppBriefText) ||
        (/\brealistic\b/.test(dppBriefText) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(dppBriefText));
      const DPP_PHOTO_LOCK = `\n\nPHOTOGRAPHIC REALISM LOCK (the customer explicitly asked for a real photo — obey over any "artistic" wording): the imagery in this wrap must read as an actual high-resolution color PHOTOGRAPH — natural light, true-to-life color, real depth and texture. It is NOT a cartoon, illustration, drawing, painting, vector, or clip-art. Only a LOGO may be a designed graphic.`;
      if (dppWantsPhoto) console.log('[DesignIQ DPP Render] photo-realism requested → appending photo lock');

      console.log(`[DesignIQ DPP Render] viewType: "${viewType}", finish: "${finish}", panelName: "${panelName}", panelUrl: ${panelUrl?.substring(0, 80)}...`);
      
      if (!panelUrl) {
        return new Response(
          JSON.stringify({ error: 'Panel URL is required for DesignPanelPro mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Fetching panel image for DesignPanelPro mode:', panelUrl);
      try {
        // Resize via Supabase Storage transforms (512px max) to prevent 20MB payloads
        let panelFetchUrl = panelUrl;
        if (panelUrl.includes('supabase.co/storage/v1/object/public/')) {
          panelFetchUrl = panelUrl.replace(
            '/storage/v1/object/public/',
            '/storage/v1/render/image/public/'
          ) + (panelUrl.includes('?') ? '&' : '?') + 'width=512&height=512&resize=contain';
          console.log('📐 Resizing panel via Supabase Storage transforms (512px max)');
        }
        const panelResponse = await fetch(panelFetchUrl, {
          headers: { 'User-Agent': 'Deno/1.0' }
        });
        
        if (!panelResponse.ok) {
          throw new Error(`Failed to fetch panel: ${panelResponse.status}`);
        }

        // Get actual content type from response
        const contentType = panelResponse.headers.get('content-type') || 'image/png';
        
        const panelBlob = await panelResponse.arrayBuffer();
        // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
        // string-building transiently ate hundreds of MB on multi-MB images.
        const binaryString64 = encodeBase64(panelBlob);
        const base64Panel = binaryString64;
        
        // Use actual content type instead of hardcoding
        patternImageUrl = `data:${contentType};base64,${base64Panel}`;
        console.log('Panel image loaded successfully, size:', panelBlob.byteLength, 'type:', contentType);
      } catch (error: any) {
        console.error('Failed to fetch panel image:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to load panel image' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use the same camera angles as RecreatePro — from view-angles-os.ts, no overrides
      const cameraAngle = getCameraAngle(viewType || 'side');

      // ============= V3 — FOCUSED DPP RENDER PROMPT =============
      // V3 strips the prompt back to ~3,500 chars (down from ~17,000 in V2).
      // Gemini image generation quality degrades with prompt bloat — the model
      // splits attention across hundreds of bullet points instead of focusing
      // on the actual design. V3 keeps the essential instructions concise.
      console.log("DesignIQ V3: Building focused DPP render prompt");

      const DPP_FINISH_SPEC: Record<string, string> = {
        gloss: 'High-gloss laminate — shiny wet-look surface with crisp reflections.',
        matte: 'Matte laminate — completely flat, zero reflections, velvet appearance.',
        satin: 'Satin laminate — soft sheen between matte and gloss, silk-like.',
      };
      const finishSpec = DPP_FINISH_SPEC[(finish || 'gloss').toLowerCase()] || DPP_FINISH_SPEC.gloss;

      // ── DESIGNIQ vs LIBRARY PANEL PROMPT SPLIT ──
      // heroReferenceUrl present = DesignIQ flow (hero is a full vehicle render)
      // heroReferenceUrl absent = Library panel flow (panel is a flat 2D design)
      //
      // DesignIQ: Treat hero as a REFERENCE PHOTOGRAPH. Ask Gemini to render
      //   the same wrapped vehicle from a different camera angle.
      // Library: Treat panel as FLAT ARTWORK to apply onto the vehicle body.
      //
      // The old prompt treated both the same ("attached panel artwork installed
      // as vinyl"), which degraded DesignIQ renders into clip-art.

      if (heroReferenceUrl && viewType !== 'side' && viewType !== 'driver-side') {
        // ── DESIGNIQ ADDITIONAL VIEW PROMPT ──
        // The attached image is a COMPLETED WRAP photographed from driver-side.
        // Generate the SAME wrap from a different camera angle.
        // NO STUDIO_REINFORCEMENT — its negative instructions ("not cartoon",
        // "not illustrated") cause Gemini to produce exactly that.
        console.log(`[DesignIQ] Using reference-photo prompt for viewType="${viewType}"`);

        // View-specific scene framing — IDENTICAL to RecreatePro's restyleScene in design-panel-ai-generate
        const viewScene = viewType === 'hood_detail'
          ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl — the hood artwork is the hero, rich with layered detail and depth. No text, no logos, no branding.`
          : viewType === 'close-up'
          ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
          : `A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed. The wrap is real printed vinyl — a bold, gallery-worthy design with hero artwork spanning the door panels as the focal point. The design flows naturally with the vehicle's body lines, following fender curves and wheel arch contours. Rich layered composition with depth: background atmosphere, mid-ground flow elements, and foreground hero artwork. No text, no logos, no branding on the vehicle.`;

        const viewLabel = viewType.replace(/[-_]/g, ' ');

        aiPrompt = `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${viewScene} The attached reference image shows this EXACT wrap design photographed from the driver side. Render the SAME vehicle with the SAME wrap design from the ${viewLabel} angle.

The wrap is real printed vinyl — every color, pattern, graphic element, and design detail from the reference must appear consistently on this view. The design flows naturally with the vehicle body lines.${designAnchorText ? `

DESIGN CONTINUITY — match this driver-side description exactly:
${designAnchorText}` : ''}

Finish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.

${STUDIO_ENVIRONMENT}

${cameraAngle}

The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${viewType === 'close-up'
  ? `\nCanon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors.`
  : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`}${dppWantsPhoto ? DPP_PHOTO_LOCK : ''}`;

        console.log(`[DesignIQ] Reference-photo prompt ready (${aiPrompt.length} chars)`);

      } else {
        // ── LIBRARY PANEL PROMPT (or DesignIQ hero/side view) ──
        // The attached image is FLAT 2D panel artwork to apply onto the vehicle.
        // STUDIO_REINFORCEMENT REMOVED — it was ~700 chars of negative instructions
        // ("NOT cartoon", "NOT illustrated", "NEVER show ceiling") that cause Gemini
        // to over-index on the forbidden concepts and produce cartoonish output.
        // The golden design-panel-ai-generate prompt uses STUDIO_ENVIRONMENT only.
        aiPrompt = `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a professionally installed vinyl wrap. The attached panel artwork has been physically printed on cast vinyl, laminated, and hand-installed on this vehicle. Render this EXACT artwork on the vehicle body — the wrap follows every body line, fender curve, and wheel arch contour.

Panel Design: ${panelName || "Custom Panel Design"}
Finish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.

${STUDIO_ENVIRONMENT}

${cameraAngle}

The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.
Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.${dppWantsPhoto ? DPP_PHOTO_LOCK : ''}`;

        // Cross-View Design Anchor — inject continuity for Views 2-6
        if (designAnchorText && viewType !== 'side') {
          aiPrompt = `Same wrap from a different angle. Match this driver-side reference:\n${designAnchorText}\n\n` + aiPrompt;
          console.log(`Design Anchor injected for viewType="${viewType}" (${designAnchorText.length} chars)`);
        }
      }

      console.log(`DPP V3 prompt ready (${aiPrompt.length} chars — target <5000)`);
    } else if (modeType === 'approvemode') {
      // ApproveMode - any 2D design uploaded by user
      const { designUrl, designName = 'Custom Design', coverageType } = colorData || {};
      
      if (!designUrl) {
        return new Response(
          JSON.stringify({ error: 'Design URL required for ApproveMode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Fetching ApproveMode design:', designUrl);
      try {
        if (!designUrl.startsWith('http://') && !designUrl.startsWith('https://')) {
          throw new Error(`Invalid design URL format: ${designUrl}`);
        }

        const designResponse = await fetch(designUrl, {
          headers: { 'User-Agent': 'Deno/1.0' }
        });
        
        if (!designResponse.ok) {
          throw new Error(`Failed to fetch design: ${designResponse.status} ${designResponse.statusText}`);
        }

        const designBlob = await designResponse.arrayBuffer();
        // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
        // string-building transiently ate hundreds of MB on multi-MB images.
        const binaryString64 = encodeBase64(designBlob);
        const base64Design = binaryString64;
        patternImageUrl = `data:image/png;base64,${base64Design}`;
        console.log('Design image loaded successfully');
      } catch (error: any) {
        console.error('Failed to fetch design image:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to load design image', details: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Resolve real vehicle panel dimensions from 1,660-vehicle database
      const vehicleSpecs = resolveVehicleSpecs(vehicleYear, vehicleMake, vehicleModel);
      console.log(`[ApproveMode] Vehicle specs: source=${vehicleSpecs.source}, sideW=${vehicleSpecs.sideW}", sideH=${vehicleSpecs.sideH}"`);

      aiPrompt = buildApproveModePrompt({
        vehicle,
        colorData: colorData || {},
        viewType: viewType || 'side',
        panelDimensions: vehicleSpecs.source !== 'none' ? {
          sideW: vehicleSpecs.sideW,
          sideH: vehicleSpecs.sideH,
          hoodW: vehicleSpecs.hoodW,
          hoodL: vehicleSpecs.hoodL,
          backW: vehicleSpecs.backW,
          backH: vehicleSpecs.backH,
          roofW: vehicleSpecs.roofW,
          roofL: vehicleSpecs.roofL,
          totalSqFt: vehicleSpecs.totalSqFt,
        } : undefined,
      });

      // ── APPROVEMODE MULTI-VIEW CONSISTENCY ──
      // When generating additional views from RevisionStudio, the hero render
      // is passed as heroReferenceUrl in colorData. Append a reference-image
      // instruction so Gemini clones the SAME wrap design from a different angle
      // instead of re-interpreting the flat design independently each time.
      const approveModeHeroRef = (colorData as any)?.heroReferenceUrl;
      if (approveModeHeroRef && viewType && viewType !== 'side' && viewType !== 'driver-side') {
        const viewLabel = (viewType || '').replace(/[-_]/g, ' ');
        aiPrompt += `\n\nREFERENCE IMAGE ATTACHED: The second image is the driver side render of this exact wrap design already installed on this vehicle. Clone this IDENTICAL wrap design from the ${viewLabel} angle. Match every design element exactly — colors, patterns, graphics, composition, and style. The wrap design is the same, only the camera position changes.`;
        console.log(`[ApproveMode] Hero reference instruction added for viewType="${viewType}"`);
      }
    } else {
      // Solid color mode (ColorPro, Material, etc.)
      // ============= SOLID COLOR MODE (ColorPro) - CENTRALIZED PROMPT =============
      let { colorName, hex, finish = 'gloss', colorLibrary = 'colorpro', swatchImageUrl, manufacturer } = colorData || {};

      // Normalize manufacturer to avoid accidental AI overrides (e.g. "Avery Dennison" vs "Avery")
      const normalizedManufacturer = typeof manufacturer === 'string'
        ? (manufacturer.toLowerCase().includes('avery') ? 'Avery' : manufacturer.toLowerCase().includes('3m') ? '3M' : manufacturer)
        : manufacturer;

      // 🔒 PRIORITY: Database finish (dbFinish) overrides AI-detected finish for verified swatches
      if (colorData?.dbFinish && colorData.isVerifiedMatch) {
        console.log(`🔒 USING DATABASE FINISH: ${colorData.dbFinish} (was: ${finish})`);
        finish = colorData.dbFinish;
      }

      // ============= 🔒 HARD-LOCKED DATAFORSEO PIPELINE FOR SWATCH UPLOADS 🔒 =============
      // MANDATORY: For uploaded swatches, DataForSEO MUST return wrapped vehicle images
      // If no real-world references found, we CANNOT do realistic renders
      let isUploadedSwatch = !!swatchImageUrl;
      let wrappedVehicleImages: string[] = [];
      let renderMode: 'realistic' | 'abstract' = 'realistic';
      let abstractReason: string | null = null;

      if (isUploadedSwatch && normalizedManufacturer && colorName) {
        console.log('🔒 SWATCH UPLOAD DETECTED - Initiating MANDATORY DataForSEO search');
        console.log(`📸 Searching for: ${normalizedManufacturer} ${colorName} ${finish} wrapped vehicles`);

        const DATAFORSEO_API_KEY = Deno.env.get('DATAFORSEO_API_KEY');

        if (!DATAFORSEO_API_KEY) {
          console.warn('⚠️ DATAFORSEO_API_KEY not configured - cannot ground swatch in reality');
        } else {
          // Build multiple search queries for best results
          const searchQueries = [
            `${normalizedManufacturer} ${colorName} ${finish} vinyl wrap car`,
            `${normalizedManufacturer} ${colorName} wrapped vehicle`,
            `${colorName} ${finish} wrap installed car`,
          ];

          for (const query of searchQueries) {
            if (wrappedVehicleImages.length >= 3) break; // Got enough

            try {
              console.log(`🔍 DataForSEO query: "${query}"`);
              const searchResponse = await fetch('https://api.dataforseo.com/v3/serp/google/images/live/advanced', {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${DATAFORSEO_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify([{
                  keyword: query,
                  location_code: 2840,
                  language_code: "en",
                  device: "desktop",
                  depth: 15,
                }])
              });

              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                const results = searchData.tasks?.[0]?.result?.[0]?.items || [];
                console.log(`📸 Found ${results.length} images for query: "${query}"`);

                // Filter for valid VEHICLE images (not product pages)
                for (const item of results) {
                  if (wrappedVehicleImages.length >= 5) break;
                  if (item.url && isValidImageUrl(item.url)) {
                    // Prioritize images that look like wrapped vehicles
                    const titleLower = (item.title || '').toLowerCase();
                    const isVehiclePhoto = titleLower.includes('wrap') ||
                      titleLower.includes('car') ||
                      titleLower.includes('vehicle') ||
                      titleLower.includes('installed') ||
                      titleLower.includes('vinyl');
                    if (isVehiclePhoto || wrappedVehicleImages.length < 2) {
                      wrappedVehicleImages.push(item.url);
                      console.log(`✅ Added wrapped vehicle reference: ${item.url.substring(0, 60)}...`);
                    }
                  }
                }
              }
            } catch (e) {
              console.error(`DataForSEO search failed for query: ${query}`, e);
            }
          }
        }

        // 🔒 DATABASE MATCH BYPASS - If verified database match, skip abstract mode requirement
        const isVerifiedDbMatch = colorData?.isVerifiedMatch === true;

        // 🔒 HARD REQUIREMENT CHECK - Must have 2+ images for realistic mode UNLESS we have DB match
        if (wrappedVehicleImages.length < 2 && !isVerifiedDbMatch) {
          console.warn(`⚠️ INSUFFICIENT REFERENCE IMAGES (${wrappedVehicleImages.length}) and no DB match - Downgrading to ABSTRACT mode`);
          renderMode = 'abstract';
          abstractReason = `No real-world wrapped vehicle references found for ${normalizedManufacturer} ${colorName}. Showing color preview.`;
        } else if (wrappedVehicleImages.length < 2 && isVerifiedDbMatch) {
          console.log(`✅ DATABASE MATCH FOUND - Using realistic mode despite limited references (verified: ${normalizedManufacturer} ${colorName})`);
          renderMode = 'realistic';
        } else {
          console.log(`✅ GROUNDED IN REALITY: ${wrappedVehicleImages.length} wrapped vehicle references found`);
          // Populate webSearchPhotos for use in AI call
          webSearchPhotos = wrappedVehicleImages.map(url => ({
            url,
            title: `${normalizedManufacturer} ${colorName} wrapped vehicle`,
            source: 'dataforseo_mandatory'
          }));
        }
      }

      // ============= AI COLOR INTELLIGENCE SYSTEM =============
      let colorIntelligence: any = null;

      // HARDWIRED: If we have a swatchId, we treat it as a database-authoritative match
      // and we DO NOT run any AI-based "corrections".
      const swatchIdPresent = !!(colorData?.id || colorData?.swatchId);

      // Extract isVerifiedMatch flag from colorData - if true, skip AI overrides
      const isVerifiedMatch = colorData?.isVerifiedMatch === true || swatchIdPresent;

      // Only run AI Color Intelligence for NON-verified matches
      if (!isVerifiedMatch && normalizedManufacturer && normalizedManufacturer !== 'InkFusion' && normalizedManufacturer !== 'Avery' && normalizedManufacturer !== '3M') {
        console.log('🔍 Getting AI color intelligence for custom manufacturer:', { manufacturer: normalizedManufacturer, colorName, finish, hex });
      } else if (isVerifiedMatch) {
        console.log('✅ Skipping AI color intelligence - using verified database match');
      }

      if (!isVerifiedMatch && normalizedManufacturer && normalizedManufacturer !== 'InkFusion' && normalizedManufacturer !== 'Avery' && normalizedManufacturer !== '3M') {
        try {
          const intelligenceResponse = await supabase.functions.invoke('search-vinyl-color-intelligence', {
            body: { manufacturer: normalizedManufacturer, colorName, finishType: finish, userProvidedHex: hex }
          });
          
          if (intelligenceResponse.data?.success && intelligenceResponse.data.intelligence) {
            colorIntelligence = intelligenceResponse.data.intelligence;
            console.log('✅ AI Color Intelligence received:', colorIntelligence);
            
            if (colorIntelligence.correctedHex && colorIntelligence.confidence >= 0.7) {
              console.log(`🎨 Using AI-corrected hex: ${colorIntelligence.correctedHex} (was: ${hex})`);
              hex = colorIntelligence.correctedHex;
            }
            
            if (colorIntelligence.detectedFinish && colorIntelligence.confidence >= 0.7) {
              console.log(`✨ Using AI-detected finish: ${colorIntelligence.detectedFinish} (was: ${finish})`);
              finish = colorIntelligence.detectedFinish;
            }
          }
        } catch (error) {
          console.error('⚠️ Color intelligence fetch failed, continuing with original values:', error);
        }
      }
      
      // ============= COLOR-FLIP/CHAMELEON DETECTION =============
      const colorFlipKeywords = ['flip', 'chameleon', 'colorflow', 'iridescent', 'psychedelic', 'color shift', 'colorshift', 'duo', 'duotone', 'multitone', 'color flip', 'satin flip'];
      isColorFlipFilm = colorFlipKeywords.some(keyword =>
        colorName.toLowerCase().includes(keyword) ||
        (colorData?.series && colorData.series.toLowerCase().includes(keyword))
      );
      
      if (isColorFlipFilm) {
        console.log(`🌈 COLOR-FLIP FILM DETECTED: ${colorName}`);
      }
      
      // ============= MATERIAL PROFILE FROM manufacturer_colors (AUTHORITATIVE) =============
      // PRIORITY: manufacturer_colors is the authoritative source of truth
      // Only fall back to vinyl_swatches if not found in manufacturer_colors
      let materialProfile: { lab?: any; reflectivity?: number; metallic_flake?: number; finish_profile?: any; material_validated?: boolean } = {};
      swatchMediaUrl = null; // Reset for this render — assigned from manufacturer_colors or vinyl_swatches below
      const swatchId = colorData?.id || colorData?.swatchId;
      let isFromOfficialSource = false;
      
      // OPTIMIZATION: Use cached data if provided (for additional views)
      if (skipLookups && cachedMaterialProfile) {
        materialProfile = cachedMaterialProfile;
        console.log('⚡ Using cached material profile (skipLookups=true)');
      } else if (swatchId || (normalizedManufacturer && colorName)) {
        console.log(`🔬 Fetching material profile - checking manufacturer_colors FIRST`);
        
        // STEP 1: Try manufacturer_colors table (authoritative source)
        try {
          let mfcQuery = supabase
            .from('manufacturer_colors')
            .select('id, official_name, official_hex, official_swatch_url, lab_l, lab_a, lab_b, finish, manufacturer, product_code, grounded_description')
            .eq('is_verified', true);
          
          // Try to match by ID first, then by manufacturer + name
          if (swatchId) {
            mfcQuery = mfcQuery.eq('id', swatchId);
          } else if (normalizedManufacturer && colorName) {
            mfcQuery = mfcQuery
              .eq('manufacturer', normalizedManufacturer)
              .ilike('official_name', colorName);
          }
          
          const { data: mfcData, error: mfcError } = await mfcQuery.maybeSingle();
          
          if (mfcData && !mfcError) {
            console.log('✅ AUTHORITATIVE SOURCE: Found in manufacturer_colors table');
            isFromOfficialSource = true;
            
            // Build LAB object if values exist
            if (mfcData.lab_l !== null && mfcData.lab_a !== null && mfcData.lab_b !== null) {
              materialProfile.lab = {
                l: mfcData.lab_l,
                a: mfcData.lab_a,
                b: mfcData.lab_b
              };
            }
            materialProfile.material_validated = true;
            
            // Use official swatch URL as the authoritative reference
            if (mfcData.official_swatch_url) {
              swatchMediaUrl = mfcData.official_swatch_url;
              console.log('🔒 Using OFFICIAL swatch URL from manufacturer_colors:', swatchMediaUrl);
            }
            
            // Override color data with authoritative values
            if (mfcData.official_hex) {
              hex = mfcData.official_hex;
              console.log('🔒 Using OFFICIAL hex from manufacturer_colors:', hex);
            }
            if (mfcData.official_name) {
              colorName = mfcData.official_name;
              console.log('🔒 Using OFFICIAL name from manufacturer_colors:', colorName);
            }
            if (mfcData.finish) {
              finish = mfcData.finish;
              console.log('🔒 Using OFFICIAL finish from manufacturer_colors:', finish);
            }

            // Store Google-grounded film description for prompt enrichment
            if (mfcData.grounded_description) {
              materialProfile.grounded_description = mfcData.grounded_description;
              console.log('🔍 GROUNDED film description:', mfcData.grounded_description.slice(0, 100) + '...');
            }

            console.log('✅ Material profile loaded from AUTHORITATIVE source:', {
              hasLab: !!materialProfile.lab,
              material_validated: materialProfile.material_validated,
              hasOfficialSwatchImage: !!swatchMediaUrl,
              hasGroundedDescription: !!materialProfile.grounded_description,
              productCode: mfcData.product_code
            });
          }
        } catch (e) {
          console.error('⚠️ Failed to query manufacturer_colors:', e);
        }
        
        // STEP 2: Fall back to vinyl_swatches ONLY if not found in manufacturer_colors
        if (!isFromOfficialSource && swatchId) {
          console.log('⚠️ Not found in manufacturer_colors, falling back to vinyl_swatches');
          try {
            const { data: swatchData, error: swatchError } = await supabase
              .from('vinyl_swatches')
              .select('lab, reflectivity, metallic_flake, finish_profile, material_validated, media_url')
              .eq('id', swatchId)
              .single();
            
            if (swatchData && !swatchError) {
              materialProfile = {
                lab: swatchData.lab,
                reflectivity: swatchData.reflectivity,
                metallic_flake: swatchData.metallic_flake,
                finish_profile: swatchData.finish_profile,
                material_validated: swatchData.material_validated
              };
              // Store swatch media_url as fallback reference
              if (swatchData.media_url) {
                swatchMediaUrl = swatchData.media_url;
                console.log('📷 Fallback swatch media_url:', swatchMediaUrl);
              }
              console.log('✅ Material profile loaded from vinyl_swatches (fallback):', {
                hasLab: !!materialProfile.lab,
                reflectivity: materialProfile.reflectivity,
                metallic_flake: materialProfile.metallic_flake,
                material_validated: materialProfile.material_validated,
                hasSwatchImage: !!swatchMediaUrl
              });
            }
          } catch (e) {
            console.error('⚠️ Failed to fetch material profile from vinyl_swatches:', e);
          }
        }
      }
      
      // ============= STORED REFERENCE IMAGES (CHECK FIRST - FAST) =============
      let storedReferenceUrls: string[] = [];
      let hasStoredReferences = false;
      
      // OPTIMIZATION: Use cached reference URLs if provided (for additional views)
      if (skipLookups && cachedReferenceUrls && cachedReferenceUrls.length > 0) {
        storedReferenceUrls = cachedReferenceUrls;
        hasStoredReferences = true;
        webSearchPhotos = cachedReferenceUrls.map((url: string) => ({ 
          url, 
          title: `${manufacturer} ${colorName}`,
          source: 'cached_reference'
        }));
        console.log(`⚡ Using ${cachedReferenceUrls.length} cached reference URLs (skipLookups=true)`);
      } else if (manufacturer && manufacturer !== 'InkFusion') {
        console.log(`🔍 Checking stored references for: ${manufacturer} ${colorName}`);
        
        let refQuery = supabase
          .from('vinyl_reference_images')
          .select('image_url, image_type, color_characteristics, is_verified, score')
          .eq('manufacturer', manufacturer)
          .ilike('color_name', colorName);
        
        if (swatchId) {
          refQuery = supabase
            .from('vinyl_reference_images')
            .select('image_url, image_type, color_characteristics, is_verified, score')
            .eq('swatch_id', swatchId);
        }
        
        const { data: storedRefs, error: refError } = await refQuery
          .order('is_verified', { ascending: false })
          .order('score', { ascending: false, nullsFirst: false })
          .order('image_type', { ascending: true })
          .limit(5);
        
        if (storedRefs && storedRefs.length > 0 && !refError) {
          const validRefs = storedRefs.filter(r => isValidImageUrl(r.image_url));
          
          if (validRefs.length > 0) {
            hasStoredReferences = true;
            storedReferenceUrls = validRefs.map(r => r.image_url);
            console.log(`✅ Found ${validRefs.length} VALID stored reference images`);
            
            webSearchPhotos = validRefs.map(r => ({ 
              url: r.image_url, 
              title: `${manufacturer} ${colorName}`,
              source: 'stored_reference'
            }));
          }
        }
      }
      
      // ============= MANDATORY WEB IMAGE SEARCH =============
      // ALWAYS search for manufacturer images when no stored references exist
      // This ensures we use REAL manufacturer film images, not just hex colors
      const shouldSearchWeb = !hasStoredReferences && manufacturer && manufacturer !== 'InkFusion';
      const isColorFlowFilm = isColorFlipFilm || (finish || '').toLowerCase().includes('colorflow');
      
      // For ColorFlow/flip films: ALWAYS search fresh (color-shift requires real photos)
      const forceSearch = isColorFlowFilm && manufacturer && manufacturer !== 'InkFusion';
      
      if (shouldSearchWeb || forceSearch) {
        console.log(`🔍 MANDATORY DataForSEO search for: ${manufacturer} ${colorName} (forceSearch=${forceSearch})`);
        try {
          const searchResponse = await fetch(`${supabaseUrl}/functions/v1/search-vinyl-product-images`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ manufacturer, colorName, productCode: colorData?.productCode }),
          });

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            console.log(`✅ Found ${searchData.photos?.length || 0} web images from DataForSEO`);
            webSearchPhotos = searchData.photos || [];
            
            // CRITICAL: Store reference images in database for future renders
            // This is MANDATORY - every successful search populates our reference library
            if (webSearchPhotos.length > 0) {
              // Filter to only actual image URLs before storing
              const validPhotos = webSearchPhotos.filter(photo => isValidImageUrl(photo.url));
              console.log(`📸 SAVING ${validPhotos.length} valid manufacturer images to database (filtered from ${webSearchPhotos.length} web results)`);
              
              const swatchIdToUse = swatchId || colorData?.id || null;
              
              const insertPromises = validPhotos.slice(0, 5).map(photo => 
                supabase.from('vinyl_reference_images').upsert({
                  swatch_id: swatchIdToUse,
                  manufacturer,
                  color_name: colorName,
                  product_code: colorData?.productCode || colorData?.code || null,
                  image_url: photo.url,
                  source_url: photo.source || null,
                  image_type: photo.title?.toLowerCase().includes('wrap') ? 'vehicle_installation' : 'product_sheet',
                  search_query: `${manufacturer} ${colorData?.productCode || ''} ${colorName} vinyl wrap`,
                  color_characteristics: { finish, is_flip: isColorFlipFilm },
                  is_verified: true,
                  verified_at: new Date().toISOString()
                }, { onConflict: 'image_url', ignoreDuplicates: true })
              );
              
              // Execute all inserts and update swatch flags
              Promise.all(insertPromises).then(async () => {
                console.log('✅ SAVED manufacturer reference images to vinyl_reference_images table');
                
                // Update vinyl_swatches to mark reference bundle as complete
                if (swatchIdToUse) {
                  await supabase.from('vinyl_swatches').update({
                    has_reference_bundle: true,
                    is_flip_film: isColorFlipFilm,
                    reference_image_count: validPhotos.length
                  }).eq('id', swatchIdToUse);
                  console.log('✅ Updated vinyl_swatches.has_reference_bundle = true');
                }
              }).catch(e => console.error('❌ Failed to store reference images:', e));
            }

            // Validate color from real photos
            if (webSearchPhotos.length > 0) {
              console.log('🤖 Validating color from real product photos...');
              const validateResponse = await fetch(`${supabaseUrl}/functions/v1/validate-vinyl-color-from-images`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  referenceImages: webSearchPhotos,
                  manufacturer, colorName,
                  productCode: colorData?.productCode,
                  userProvidedHex: hex,
                }),
              });

              if (validateResponse.ok) {
                const validateData = await validateResponse.json();
                validatedColorData = validateData.validated;
                console.log('✅ Color validated from real photos:', {
                  originalHex: hex,
                  validatedHex: validatedColorData.hexCode,
                  confidence: validatedColorData.confidence,
                });

                if (validatedColorData.confidence >= 0.7) {
                  hex = validatedColorData.hexCode;
                  console.log(`🎨 Using validated hex from real photos: ${hex}`);
                }
              }
            }
          }
        } catch (error) {
          console.error('Web search error (non-fatal):', error);
        }
      }
      
      // ============= CRITICAL: SWATCH MEDIA_URL IS PRIMARY REFERENCE =============
      // The swatch image from vinyl_swatches IS the real manufacturer color - use it FIRST
      // Web search results are supplementary references, not primary
      if (swatchMediaUrl) {
        console.log('🎯 USING SWATCH MEDIA_URL AS PRIMARY COLOR REFERENCE (THIS IS THE REAL MANUFACTURER COLOR)');
        // Prepend swatch to stored references so it's always first
        storedReferenceUrls = [swatchMediaUrl, ...storedReferenceUrls.filter(url => url !== swatchMediaUrl)];
        hasStoredReferences = true;
      } else if (storedReferenceUrls.length === 0 && webSearchPhotos.length === 0) {
        console.warn('⚠️ NO SWATCH IMAGE OR REFERENCE IMAGES - rendering from hex only (less accurate)');
      }
      
      // ============= LOAD REFERENCE IMAGES FOR AI =============
      let referenceImages: string[] = [];
      
      if (storedReferenceUrls.length > 0) {
        console.log(`📸 Loading ${storedReferenceUrls.length} reference images...`);
        for (const refUrl of storedReferenceUrls.slice(0, 3)) {
          try {
            const imgResponse = await fetch(refUrl, { headers: { 'User-Agent': 'Deno/1.0' } });
            if (imgResponse.ok) {
              const imgBlob = await imgResponse.arrayBuffer();
              // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
              // string-building transiently ate hundreds of MB on multi-MB images.
              const binaryString64 = encodeBase64(imgBlob);
              referenceImages.push(`data:image/png;base64,${binaryString64}`);
              console.log(`✅ Loaded stored reference image ${referenceImages.length}`);
            }
          } catch (e) {
            console.error('Failed to load stored reference image:', e);
          }
        }
      } else if (manufacturer && colorName && finish) {
        console.log('🔍 Searching database for quality-verified reference renders...');
        try {
          const refResponse = await supabase.functions.invoke('find-reference-renders', {
            body: { manufacturer, colorName, finish, hex }
          });

          if (refResponse.data?.references && refResponse.data.references.length > 0) {
            console.log(`✅ Found ${refResponse.data.references.length} quality-verified reference renders`);
            
            for (const ref of refResponse.data.references) {
              try {
                const imgResponse = await fetch(ref.url, { headers: { 'User-Agent': 'Deno/1.0' } });
                if (imgResponse.ok) {
                  const imgBlob = await imgResponse.arrayBuffer();
                  // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
                  // string-building transiently ate hundreds of MB on multi-MB images.
                  const binaryString64 = encodeBase64(imgBlob);
                  referenceImages.push(`data:image/png;base64,${binaryString64}`);
                  console.log(`✅ Loaded reference image ${referenceImages.length}`);
                }
              } catch (e) {
                console.error('Failed to load reference image:', e);
              }
            }
          }
        } catch (e) {
          console.error('Error fetching reference renders:', e);
        }
      }
      
      // Load custom swatch image if provided
      if (swatchImageUrl) {
        try {
          if (swatchImageUrl.startsWith('http://') || swatchImageUrl.startsWith('https://')) {
            const swatchResponse = await fetch(swatchImageUrl, { headers: { 'User-Agent': 'Deno/1.0' } });
            if (swatchResponse.ok) {
              const swatchBlob = await swatchResponse.arrayBuffer();
              // MEMORY (546 guard): single-pass base64 — the old chunked fromCharCode
              // string-building transiently ate hundreds of MB on multi-MB images.
              const binaryString64 = encodeBase64(swatchBlob);
              patternImageUrl = `data:image/png;base64,${binaryString64}`;
              console.log('✅ Custom swatch image loaded');
            }
          }
        } catch (e) {
          console.error('Failed to load custom swatch image:', e);
        }
      }

      // ============= USE UNIFIED BUILDER SUITE (COLORPRO STRICT MODE) =============
      console.log('🎯 Using Unified Builder Suite (ColorPro Strict Mode)');
      
      // 🔒 HARD-LOCKED: For swatch uploads, use wrapped vehicle images as PRIMARY references
      const effectiveReferenceUrls = isUploadedSwatch && wrappedVehicleImages.length >= 2
        ? [...wrappedVehicleImages, ...(storedReferenceUrls || [])]
        : storedReferenceUrls;
      
      // Build prompt with render mode awareness
      if (isUploadedSwatch && renderMode === 'abstract') {
        // ABSTRACT MODE: No real-world references, generate concept preview only
        console.log('⚠️ ABSTRACT MODE: Generating color concept preview (not grounded in reality)');
        
        // 🔒 HARD-LOCKED STUDIO ENVIRONMENT (imported from studio-os.ts)
        const ABSTRACT_STUDIO = STUDIO_ENVIRONMENT;

        // 🔒 FINISH ENFORCEMENT - MATTE vs GLOSS vs SATIN
        const finishLower = (finish || '').toLowerCase();
        let FINISH_ENFORCEMENT = '';
        if (finishLower.includes('matte') || finishLower.includes('mat')) {
          FINISH_ENFORCEMENT = `
=== 🔒 FINISH ENFORCEMENT: MATTE (CRITICAL) ===
The finish is MATTE - this means:
• COMPLETELY FLAT, NON-REFLECTIVE surface
• ZERO shine, ZERO gloss, ZERO specularity
• NO mirror reflections, NO highlights
• Soft, velvety appearance that absorbs light
• Like brushed concrete or velvet - NO wet look whatsoever
YOU MUST render this as TRUE MATTE with absolutely NO glossy appearance.
`;
        } else if (finishLower.includes('satin')) {
          FINISH_ENFORCEMENT = `
=== 🔒 FINISH ENFORCEMENT: SATIN ===
The finish is SATIN - this means:
• Soft subtle sheen, silk-like appearance
• Low reflectivity, diffused highlights
• Smooth but not mirror-like
• Somewhere between matte and gloss
`;
        } else if (finishLower.includes('gloss') || finishLower.includes('high gloss')) {
          FINISH_ENFORCEMENT = `
=== 🔒 FINISH ENFORCEMENT: GLOSS ===
The finish is GLOSS - this means:
• SHINY reflective surface with sharp highlights
• Mirror-like reflections visible
• Wet-look appearance with high specularity
`;
        }

        aiPrompt = `
=== 🎨 COLOR PREVIEW MODE 🎨 ===

VEHICLE: ${vehicle}
${ABSTRACT_STUDIO}

COLOR INFORMATION:
- Color Name: ${colorName}
- Manufacturer: ${manufacturer || 'Unknown'}
- Hex Code: ${hex}
- Finish: ${finish}
${FINISH_ENFORCEMENT}

CAMERA: ${cameraPositioning}

OUTPUT: Render ${vehicle} with ${colorName} ${finish} color from ${manufacturer || 'Unknown'}.
Show the vehicle with this EXACT color and EXACT finish type.
Professional automotive photography quality.

=== NO TEXT RULE ===
DO NOT add ANY text, watermarks, logos, or branding to this image.

Ultra-high resolution 4K output (3840×2160px minimum), 16:9 aspect ratio.
Tack-sharp detail on all body panels. No soft focus.

${STUDIO_REINFORCEMENT}
`.trim();
      } else {
        // REALISTIC MODE: Grounded in real wrapped vehicle photos
        aiPrompt = buildRestyleProRenderPrompt({
          mode: "color",
          vehicle,
          cameraPositioning,
          viewType,
          colorName,
          manufacturer: manufacturer || '',
          hex,
          finish,
          lab: materialProfile.lab,
          reflectivity: materialProfile.reflectivity,
          metallic_flake: materialProfile.metallic_flake,
          finish_profile: materialProfile.finish_profile,
          referenceImages: effectiveReferenceUrls,
          isColorFlipFilm,
          validatedColorData,
          colorIntelligence,
          groundedDescription: materialProfile.grounded_description,
          environment: "studio",
          debugMode: false,
        });
        
        // 🔒 For swatch uploads with DataForSEO references, add grounding instructions
        if (isUploadedSwatch && wrappedVehicleImages.length >= 2) {
          aiPrompt += `

=== 📸 MANDATORY: GROUNDED IN REAL WRAPPED VEHICLES 📸 ===

${wrappedVehicleImages.length} REAL WRAPPED VEHICLE REFERENCE IMAGES are provided.

YOU MUST:
• USE the reference images as PRIMARY source of truth for color appearance
• MATCH how the vinyl actually looks when installed on real vehicles
• The swatch image shows the COLOR only - wrapped vehicles show BEHAVIOR
• Reference images show: real-world reflections, panel curves, lighting interaction

DO NOT:
• Ignore the wrapped vehicle reference photos
• Guess at color behavior based only on hex code
• Create your own interpretation of how the finish should look

The wrapped vehicle photos ARE your ground truth for material behavior.
=== END GROUNDING INSTRUCTIONS ===
`;
        }
      }
      
      console.log(`✅ Unified Builder ColorPro ${renderMode === 'abstract' ? 'Abstract' : 'Strict'} Mode active`);
    }

    // ============= APPEND WRAP COVERAGE RULES TO ALL MODES =============
    // Ensures grille, windows, emblems, wheels stay factory in every render
    if (aiPrompt && !aiPrompt.includes('WRAP COVERAGE')) {
      aiPrompt += `\n\n${WRAP_COVERAGE_RULES}`;
      aiPrompt += `\nDESIGN PLACEMENT: Design like a pro-level designer educated on correct wrap installation placement. Design must flow seamlessly across the vehicle. Every render must display the same cohesive design — if a hood design is created and the hood is visible in another view, it must show the same design.`;
      console.log('✅ Appended WRAP_COVERAGE_RULES + DESIGN PLACEMENT to prompt');
    }

    // ============= REVISION MODE — GEMINI BEST PRACTICES =============
    // When originalRenderUrl is present, use CONDENSED prompt (image provides context).
    // When no original image, fall back to full 4-layer prompt appended to generation prompt.
    if (revisionPrompt && typeof revisionPrompt === 'string' && revisionPrompt.trim()) {
      console.log('📝 REVISION MODE ACTIVATED');

      // Validate the revision request
      const validation = validateRevisionRequest(revisionPrompt);
      if (validation.warnings.length > 0) {
        console.log('⚠️ Revision warnings:', validation.warnings);
        if (validation.suggestedAction) {
          console.log('💡 Suggested action:', validation.suggestedAction);
        }
      }

      // Determine tool type for context
      const toolType = modeType === 'wbty' ? 'patternpro'
        : modeType === 'inkfusion' || modeType === 'colorpro' || modeType === 'ColorPro' ? 'colorpro'
        : modeType as 'colorpro' | 'designpanelpro' | 'patternpro' | 'wbty' | 'fadewraps' | 'approvemode';

      const isMultiView = modeType === 'approvemode';

      if (originalRenderUrl) {
        // BEST PRACTICE: When we have the original image, REPLACE the full generation
        // prompt with a short [EDIT]-prefixed revision prompt. The image provides all
        // visual context — a long text prompt degrades Gemini image quality.
        const condensedRevision = buildCondensedRevisionPrompt({
          revisionPrompt: revisionPrompt.trim(),
          toolType,
          currentViewType: viewType,
          isMultiView,
        });

        // Replace the full generation prompt — don't append to it.
        // Prepend studio environment so revisions keep correct lighting/background.
        // Light studio override (line ~2799) swaps these if studioMode === 'light'.
        aiPrompt = `${STUDIO_ENVIRONMENT}\n${STUDIO_REINFORCEMENT}\n\n${condensedRevision}`;
        console.log('✅ Condensed revision prompt (image-anchored) with studio lighting:', {
          tool: toolType,
          isMultiView,
          viewType,
          promptLength: aiPrompt.length,
          strategy: 'REPLACE + STUDIO — original image provides visual context, studio ensures lighting consistency'
        });
      } else {
        // No original image available — fall back to full 4-layer append mode
        const revisionBlock = buildRevisionPromptBlock({
          revisionPrompt: revisionPrompt.trim(),
          toolType,
          isMultiView,
          currentViewType: viewType
        });
        aiPrompt += revisionBlock;
        console.log('✅ 4-Layer revision block appended (no original image):', {
          tool: toolType,
          isMultiView,
          viewType,
          promptLength: revisionPrompt.length
        });
      }
    }

    // Inject universal emblem enforcement for every render
    if (vehicleMake) {
    }

    console.log('Calling Google Gemini API');

    // Retry logic for transient errors (timeouts, 503s)
    let aiData: { imageUrl?: string; error?: { message?: string; code?: number } } = {};
    let lastError;

    // Build Gemini request parts - collect all image URLs to convert
    const imagesToConvert: { url: string; label: string; priority: number }[] = [];
    // Priority system: lower = more important, kept during payload reduction
    // 1 = CRITICAL (panel/pattern primary), 2 = HIGH (style ref, fade ref),
    // 3 = MEDIUM (web/db refs), 4 = LOW (system examples — first to drop)

    // REVISION MODE: Include original render image as PRIMARY visual reference
    // This ensures Gemini modifies the existing design instead of generating from scratch
    if (revisionPrompt && originalRenderUrl) {
      console.log('📸 REVISION MODE: Adding original render image as PRIMARY reference for modification');
      imagesToConvert.push({ url: originalRenderUrl, label: 'original-render-reference', priority: 1 });
    }

    // SYSTEM-LEVEL EXAMPLE IMAGES — REMOVED
    // ProFinish, TimberWrap, SipCo reference images were injected into every
    // DPP/ApproveMode render, bloating the payload and degrading quality.
    const hasUserDesignImage = !!patternImageUrl;

    // FadeWraps: ALWAYS include the gold-standard visual reference image (if resolvable)
    if (modeType === 'fadewraps' && standardFadeReferenceUrl) {
      console.log('📸 Adding FadeWraps gold-standard gradient reference image');
      imagesToConvert.push({ url: standardFadeReferenceUrl, label: 'fade-reference', priority: 2 });
    }

    // For ColorProEnhanced/GraphicsPro - add reference image if provided
    if ((modeType === 'ColorProEnhanced' || modeType === 'GraphicsPro') && referenceImageBase64) {
      console.log(`📸 Adding ${modeType} reference image for style inspiration`);
      imagesToConvert.push({ url: referenceImageBase64, label: 'style-reference', priority: 2 });
    }

    // For DesignPanelPro, WBTY, ApproveMode, and FadeWraps - panel/pattern image is PRIMARY
    if (patternImageUrl && (modeType === 'designpanelpro' || modeType === 'wbty' || modeType === 'approvemode' || modeType === 'fadewraps')) {
      console.log(`📸 Adding pattern/design image as PRIMARY reference for ${modeType}`);
      imagesToConvert.push({ url: patternImageUrl, label: 'pattern-primary', priority: 1 });
    }

    // DPP: Send hero render as visual reference for additional views (design consistency)
    // heroReferenceUrl is the driver-side render URL — Gemini sees it to match the design exactly
    const dppHeroRef = (colorData as any)?.heroReferenceUrl;
    if ((modeType === 'designpanelpro' || modeType === 'approvemode' || modeType === 'ColorPro' || modeType === 'colorpro' || modeType === 'GraphicsPro') && dppHeroRef && viewType !== 'side' && viewType !== 'driver-side') {
      // Use Supabase Storage transforms to resize hero to 512px (same as panel image)
      let heroFetchUrl = dppHeroRef;
      if (dppHeroRef.includes('supabase.co/storage/v1/object/public/')) {
        heroFetchUrl = dppHeroRef.replace(
          '/storage/v1/object/public/',
          '/storage/v1/render/image/public/'
        ) + (dppHeroRef.includes('?') ? '&' : '?') + 'width=512&height=512&resize=contain';
      }
      console.log(`📸 Adding hero render as design consistency reference for ${viewType}`);
      imagesToConvert.push({ url: heroFetchUrl, label: 'hero-reference', priority: 1 });
    }

    // Add web search photos — ONLY for color-flip/chameleon films that need visual angle references.
    // Standard solid-color renders must NOT include web search images because Gemini copies
    // the color from the reference photo instead of following the text prompt (hex/LAB).
    const isColorProSolid = (modeType === 'colorpro' || modeType === 'ColorPro' || modeType === 'inkfusion') && !isColorFlipFilm;
    if (webSearchPhotos && webSearchPhotos.length > 0 && !isColorProSolid) {
      const validPhotos = webSearchPhotos.filter(photo => isValidImageUrl(photo.url));
      const cappedPhotos = validPhotos.slice(0, 2); // CAP at 2 reference photos
      console.log(`📸 Adding ${cappedPhotos.length}/${webSearchPhotos.length} reference photos (capped at 2)`);
      for (const photo of cappedPhotos) {
        imagesToConvert.push({ url: photo.url, label: 'web-reference', priority: 3 });
      }
    } else if (isColorProSolid && webSearchPhotos && webSearchPhotos.length > 0) {
      console.log(`🚫 SKIPPING ${webSearchPhotos.length} web search photos for solid-color ColorPro — Gemini copies image color instead of following hex/LAB`);
    }

    // Add database reference images (if found and no web photos) — limit to 2 max
    // For solid-color ColorPro: ONLY send the official swatch image (first item = swatchMediaUrl),
    // skip any other stored references (web search results cached in DB) to prevent color drift.
    if ((!webSearchPhotos || webSearchPhotos.length === 0) && referenceImages && referenceImages.length > 0) {
      if (isColorProSolid) {
        // Only send the official swatch (always first in referenceImages when swatchMediaUrl exists)
        if (swatchMediaUrl && referenceImages.length > 0) {
          imagesToConvert.push({ url: referenceImages[0], label: 'official-swatch', priority: 1 });
          console.log(`🎯 Adding ONLY official manufacturer swatch for solid-color ColorPro (skipping ${referenceImages.length - 1} other references)`);
        } else {
          console.log(`🚫 No official swatch available — rendering from hex/LAB only`);
        }
      } else {
        const cappedRefs = referenceImages.slice(0, 2);
        console.log(`📸 Adding ${cappedRefs.length}/${referenceImages.length} database reference images (capped at 2)`);
        for (const refImg of cappedRefs) {
          imagesToConvert.push({ url: refImg, label: 'db-reference', priority: 3 });
        }
      }
    }

    // For ColorPro/InkFusion - pattern/swatch image comes after references
    if (patternImageUrl && modeType !== 'designpanelpro' && modeType !== 'wbty' && modeType !== 'approvemode' && modeType !== 'fadewraps') {
      imagesToConvert.push({ url: patternImageUrl, label: 'swatch', priority: 1 });
    }

    // --- RAG + Dynamic Examples — SKIP for DesignPanelPro ---
    // DPP V3 prompt is deliberately concise (~3,500 chars). Appending RAG text
    // (~4,000 chars) and dynamic examples (~2,000 chars) bloats the prompt to
    // ~10,000+ chars, which degrades Gemini image generation quality.
    // RAG and examples are still valuable for ApproveMode (commercial wraps).
    if (modeType !== 'designpanelpro') {
      // RAG context and dynamic exemplar retrieval REMOVED.
      // fetchRAGContext + retrieveTopRatedExamples were appending ~3K+ chars
      // of exemplar text to the prompt, degrading Gemini image quality.
    } else {
      console.log('⏭️ Skipping RAG + dynamic examples for DPP — V3 focused prompt is self-contained');
    }

    // ============= STUDIO MODE OVERRIDE =============
    // When studioMode === 'light', replace dark studio references with light studio
    if (studioMode === 'light') {
      console.log('☀️ LIGHT STUDIO MODE — Overriding dark studio colors with white studio palette');
      // Replace inline dark floor/wall references with light mode equivalents
      aiPrompt = aiPrompt
        .replace(/Dark charcoal gray textured floor \(#2a2a2a to #333333\)/g, 'Clean white polished floor (#f0f0f0 to #ffffff)')
        .replace(/dark charcoal gray textured floor/gi, 'clean white polished floor')
        .replace(/Dark charcoal.*?polished concrete or epoxy finish/g, 'Clean white polished floor (#f0f0f0 to #ffffff) — glossy epoxy or white marble finish')
        .replace(/Light neutral gray walls \(#d0d0d0 to #e8e8e8\)/g, 'Pure white walls (#ffffff to #f5f5f5)')
        .replace(/dark floor/gi, 'white floor')
        .replace(/#2a2a2a/g, '#f0f0f0')
        .replace(/#333333/g, '#ffffff')
        .replace(/#1a1a1a/g, '#f5f5f5');
    }

    // ============= PAYLOAD SIZE LOGGING =============
    const promptCharCount = aiPrompt.length;
    const estimatedTokens = Math.ceil(promptCharCount / 4);
    console.log(`📊 PAYLOAD METRICS:`);
    console.log(`   Prompt: ${promptCharCount.toLocaleString()} chars (~${estimatedTokens.toLocaleString()} tokens)`);
    console.log(`   Images to convert: ${imagesToConvert.length}`);
    console.log(`   Image labels: ${imagesToConvert.map(i => i.label).join(', ')}`);

    // ============= CONVERT IMAGES TO BASE64 =============
    // Sort by priority (critical first) so we keep the right ones if we need to shed
    imagesToConvert.sort((a, b) => a.priority - b.priority);

    // CAP total images at 4 for image generation mode
    const MAX_IMAGES_FOR_GENERATION = 4;
    if (imagesToConvert.length > MAX_IMAGES_FOR_GENERATION) {
      const dropped = imagesToConvert.splice(MAX_IMAGES_FOR_GENERATION);
      console.warn(`⚠️ PAYLOAD CAP: Dropped ${dropped.length} lowest-priority images: ${dropped.map(d => d.label).join(', ')}`);
    }

    console.log(`Converting ${imagesToConvert.length} images to base64 for Gemini...`);
    const geminiImageParts: { inlineData: { mimeType: string; data: string }; label: string }[] = [];

    let totalImageBytes = 0;
    // PARALLEL FETCH: download + base64-encode all reference images concurrently
    // (was a sequential await loop). Order is preserved by mapping over the
    // priority-sorted array and pushing results back in index order.
    const convertedImages = await Promise.all(
      imagesToConvert.map(async (img) => ({ img, base64Data: await imageUrlToBase64(img.url) }))
    );
    for (const { img, base64Data } of convertedImages) {
      if (base64Data) {
        const imageBytes = Math.ceil(base64Data.data.length * 0.75); // base64 -> actual bytes
        totalImageBytes += imageBytes;
        geminiImageParts.push({
          inlineData: {
            mimeType: base64Data.mimeType,
            data: base64Data.data
          },
          label: img.label
        });
        console.log(`✅ Converted ${img.label} image to base64 (${(imageBytes / 1024).toFixed(0)}KB)`);
      } else {
        console.warn(`⚠️ Failed to convert ${img.label} image, skipping`);
      }
    }

    console.log(`📊 TOTAL PAYLOAD: ${promptCharCount.toLocaleString()} chars prompt + ${(totalImageBytes / 1024).toFixed(0)}KB images (${geminiImageParts.length} images)`);

    // Build initial geminiParts with all images
    const geminiParts: any[] = [
      { text: aiPrompt },
      ...geminiImageParts.map(p => ({ inlineData: p.inlineData }))
    ];

    // ============= INSTANT MIRROR — Skip AI for Passenger Side =============
    if (isInstantMirrorView(viewType)) {
      const mirrorSource = getMirrorSource(viewType);
      console.log(`INSTANT_MIRROR: viewType="${viewType}" — looking for cached ${mirrorSource} render to flip`);

      try {
        const { data: existingRecord } = await supabase
          .from('color_visualizations')
          .select('render_urls')
          .eq('vehicle_year', vehicleYear)
          .eq('vehicle_make', vehicleMake)
          .eq('vehicle_model', vehicleModel)
          .eq('customer_email', userEmail)
          .not('render_urls', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const driverUrl = existingRecord?.render_urls?.['side'] || existingRecord?.render_urls?.['driver-side'];

        if (driverUrl) {
          console.log(`INSTANT_MIRROR: Found driver-side render, returning for frontend flip`);
          return new Response(
            JSON.stringify({
              renderUrl: driverUrl,
              mirrorSource: 'driver-side',
              instantMirror: true,
              message: 'Frontend: call generatePassengerMirror() to flip this image'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.log(`INSTANT_MIRROR: No driver-side render found, falling back to AI generation`);
        }
      } catch (mirrorError) {
        console.warn('INSTANT_MIRROR lookup failed, falling back to AI:', mirrorError);
      }
    }
    // ============= END INSTANT MIRROR =============

    // ============= 3-TIER CREATIVE FALLBACK WITH ANCHOR SYSTEM =============
    //
    // Attempt 1: Original prompt as-is, ["TEXT","IMAGE"]
    // Attempt 2: Anchor prefix + truncate to 2000 chars, ["TEXT","IMAGE"]
    // Attempt 3: Anchor + truncate to 1000 chars, ["IMAGE"] only
    // Attempt 4: Ultra-minimal, anchor + ["TEXT","IMAGE"]
    // ALL tiers run on gemini-3-pro-image-preview — no weaker-model downgrade.
    const ANCHOR_PREFIX = "[GENERATE IMAGE] Create a photorealistic production asset: ";
    const totalTiers = 4;

    for (let attempt = 1; attempt <= totalTiers; attempt++) {
      try {
        let currentModel: string;
        let currentModalities: string[];
        let requestParts: any[];

        // Revision mode flag — revision prompts are already [EDIT]-prefixed and short
        const isRevisionMode = !!(revisionPrompt && originalRenderUrl);

        if (attempt === 1) {
          // Tier 1: Full creative payload — no anchor, original prompt + all images
          requestParts = geminiParts;
          currentModel = "gemini-3-pro-image-preview";
          currentModalities = ["TEXT", "IMAGE"];
          console.log(`🎯 [${viewType}] Gemini attempt ${attempt}/${totalTiers}: Tier 1 — Full payload (${geminiImageParts.length} images), model: ${currentModel}${isRevisionMode ? ' [REVISION]' : ''}`);
        } else if (attempt === 2) {
          // Tier 2: Anchor prefix + truncated prompt + primary/revision images only
          const truncatedPrompt = isRevisionMode
            ? aiPrompt.substring(0, 2000) // Already [EDIT]-prefixed, no anchor needed
            : (ANCHOR_PREFIX + aiPrompt).substring(0, 2000);
          // For revisions, keep the original-render-reference image (most critical)
          // For DPP additional views, keep hero-reference for design consistency
          const keepLabels = isRevisionMode
            ? ['original-render-reference', 'pattern-primary', 'swatch']
            : ['pattern-primary', 'hero-reference', 'swatch'];
          const keptImages = geminiImageParts
            .filter(p => keepLabels.includes(p.label))
            .map(p => ({ inlineData: p.inlineData }));
          requestParts = [{ text: truncatedPrompt }, ...keptImages];
          currentModel = "gemini-3-pro-image-preview";
          currentModalities = ["TEXT", "IMAGE"];
          console.log(`🔄 [${viewType}] Gemini attempt ${attempt}/${totalTiers}: Tier 2 — Anchored + truncated (${truncatedPrompt.length} chars, ${keptImages.length} images), model: ${currentModel}${isRevisionMode ? ' [REVISION]' : ''}`);
        } else if (attempt === 3) {
          // Tier 3: Modality isolation — short prompt, IMAGE only
          // ALWAYS keep design/pattern image — without it Gemini invents a random design
          const shortPrompt = isRevisionMode
            ? aiPrompt.substring(0, 1500) // Already short [EDIT] prompt
            : ("[GENERATE IMAGE] " + aiPrompt).substring(0, 1000);
          const keepLabels3 = isRevisionMode
            ? ['original-render-reference']
            : ['pattern-primary', 'hero-reference', 'swatch'];
          const keptImages3 = geminiImageParts
            .filter(p => keepLabels3.includes(p.label))
            .map(p => ({ inlineData: p.inlineData }));
          requestParts = [{ text: shortPrompt }, ...keptImages3];
          currentModel = "gemini-3-pro-image-preview";
          currentModalities = ["IMAGE"];
          console.log(`🔄 [${viewType}] Gemini attempt ${attempt}/${totalTiers}: Tier 3 — Modality isolation (IMAGE only, ${shortPrompt.length} chars, ${keptImages3.length} ref images), model: ${currentModel}${isRevisionMode ? ' [REVISION]' : ''}`);
        } else {
          // Tier 4: Ultra-minimal — LAST RESORT, but STAY ON PRO.
          // Previously this dropped to gemini-3.1-flash-image-preview (a weaker
          // image model) with IMAGE-only output — which silently produced muted /
          // illustrated cloned views whenever the earlier Pro tiers timed out or
          // returned NO_IMAGE. Keep the pro model and TEXT+IMAGE so a view never
          // renders on the weaker model; only the prompt/image payload is minimal.
          // ALWAYS keep design/pattern image.
          const shortPrompt = isRevisionMode
            ? aiPrompt.substring(0, 1500)
            : ("[GENERATE IMAGE] " + aiPrompt).substring(0, 1000);
          const keepLabels4 = isRevisionMode
            ? ['original-render-reference']
            : ['pattern-primary', 'hero-reference', 'swatch'];
          const keptImages4 = geminiImageParts
            .filter(p => keepLabels4.includes(p.label))
            .map(p => ({ inlineData: p.inlineData }));
          requestParts = [{ text: shortPrompt }, ...keptImages4];
          currentModel = "gemini-3-pro-image-preview";
          currentModalities = ["TEXT", "IMAGE"];
          console.log(`🔄 [${viewType}] Gemini attempt ${attempt}/${totalTiers}: Tier 4 — Pro minimal last-resort (TEXT+IMAGE, ${keptImages4.length} ref images), model: ${currentModel}${isRevisionMode ? ' [REVISION]' : ''}`);
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${getGeminiKey()}`;

        // Single-turn contents — no studio reference, text prompt handles lighting
        const geminiContents = [{ role: "user", parts: requestParts }];

        const aiResponse = await fetch(geminiEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: {
              // Google spec: image-gen temperature stays at the default 1.0 to
              // maximize visual variance / avoid homogeneous output.
              temperature: 1.0,
              responseModalities: currentModalities,
              imageConfig: {
                aspectRatio: getAspectRatio(viewType || 'side'),
                imageSize: resolveImageSize(viewType || 'side')
              }
            },
          }),
          signal: AbortSignal.timeout(90_000), // 90s timeout
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`[${viewType}] Google Gemini API HTTP error (attempt ${attempt}/${totalTiers}):`, errorText);

          // Retry on rate limit with exponential backoff (batch renders hit this)
          if (aiResponse.status === 429) {
            if (attempt < totalTiers) {
              const waitTime = 5000 * attempt; // 5s, 10s, 15s
              console.log(`[${viewType}] Rate limited — escalating to Tier ${attempt + 1} in ${waitTime / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
            return new Response(
              JSON.stringify({ error: 'Rate limit reached after retries. Please try again in a moment.' }),
              { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          if (aiResponse.status === 403) {
            return new Response(
              JSON.stringify({ error: 'API key invalid or quota exceeded.' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          throw new Error(`Google Gemini API failed: ${aiResponse.status}`);
        }

        const geminiData = await aiResponse.json();
        console.log(`AI response received (attempt ${attempt}/${totalTiers})`);

        // Check if response contains an error
        if (geminiData.error) {
          const errorMsg = geminiData.error.message || 'Unknown error';
          const errorCode = geminiData.error.code;

          console.error(`[${viewType}] Gemini error (attempt ${attempt}/${totalTiers}):`, {
            code: errorCode,
            message: errorMsg
          });

          // Don't retry for regional restrictions or safety blocks
          if (errorCode === 400 && (errorMsg.includes('blocked') || errorMsg.includes('SAFETY'))) {
            throw new Error(`Image generation blocked. Please try a different prompt or tool.`);
          }

          // Retry for transient errors (503, timeout, unavailable)
          if (errorCode === 503 || errorMsg.includes('Deadline') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('overloaded')) {
            if (attempt < totalTiers) {
              const waitTime = Math.pow(2, attempt) * 1000;
              console.log(`[${viewType}] Escalating to Tier ${attempt + 1} after ${waitTime}ms due to transient error...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }

          throw new Error(`Gemini API error: ${errorMsg}`);
        }

        // Extract image from Gemini response format
        const candidates = geminiData.candidates;
        if (!candidates || candidates.length === 0) {
          console.error('No candidates in Gemini response');
          throw new Error('No response from Gemini API');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
          console.error('No parts in Gemini response');
          throw new Error('No content in Gemini response');
        }

        // Find the image part in the response
        let imageBase64: string | null = null;
        let imageMimeType = 'image/png';

        for (const part of parts) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || 'image/png';
            break;
          }
        }

        // ============= TEXT-ONLY DETECTION — escalate to next tier =============
        if (!imageBase64) {
          const textParts = parts.filter((p: any) => p.text);
          if (textParts.length > 0) {
            const textContent = textParts.map((p: any) => p.text).join(' ').substring(0, 200);
            console.error(`🚨 [${viewType}] GEMINI RETURNED TEXT INSTEAD OF IMAGE (attempt ${attempt}/${totalTiers}):`);
            console.error(`   Text preview: "${textContent}..."`);
            console.error(`   Payload was: ${promptCharCount} chars + ${geminiImageParts.length} images (${(totalImageBytes / 1024).toFixed(0)}KB)`);
          }

          if (attempt < totalTiers) {
            const waitTime = 1000 * Math.pow(2, attempt - 1);
            console.log(`🔄 [${viewType}] No image — escalating to Tier ${attempt + 1} in ${waitTime / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          console.error(`[${viewType}] No image data in Gemini response after all tiers exhausted`);
          throw new Error(`[${viewType}] No image generated by Gemini after 4-tier fallback`);
        }

        // Quality Gate — reject blank/corrupt/solid-color frames
        const qualityResult = checkImageQuality(imageBase64);
        if (!qualityResult.pass) {
          console.warn(`⚠️ [${viewType}] Quality gate FAILED (attempt ${attempt}/${totalTiers}): ${qualityResult.reason}`);
          if (attempt < totalTiers) {
            const waitTime = 2000;
            console.log(`   [${viewType}] Escalating to Tier ${attempt + 1} after ${waitTime}ms due to quality failure...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          // Last tier — accept the image anyway but log the failure
          console.warn(`⚠️ [${viewType}] Quality gate failed on final tier — accepting image with warning`);
        } else {
          console.log('✅ Quality gate PASSED');
        }

        // Convert to data URL format for consistency with existing code
        const imageUrl = `data:${imageMimeType};base64,${imageBase64}`;
        aiData.imageUrl = imageUrl;
        console.log(`IMAGE GEN SUCCESS — Attempt ${attempt}, model: ${currentModel}`);

        // Success - break out of retry loop
        break;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${viewType}] Attempt ${attempt}/${totalTiers} failed:`, errorMsg);

        if (attempt < totalTiers) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`[${viewType}] Escalating to Tier ${attempt + 1} after ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // Check if we exhausted all tiers
    if (!aiData || aiData.error || !aiData.imageUrl) {
      return new Response(
        JSON.stringify({
          error: 'AI generation failed after all fallback tiers. The service is temporarily busy.',
          details: lastError?.message || 'Please try again in a moment'
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const imageUrl = aiData.imageUrl;

    // Supabase client already initialized at the top for caching
    const base64Data = imageUrl.split(',')[1];
    const imageBuffer = decodeBase64(base64Data);

    const timestamp = Date.now();
    // User-scoped storage path: renders/{userId}/{modeType}/...
    const userPrefix = authenticatedUserId ? `${authenticatedUserId}/` : '';
    // Sanitize path segments — Supabase Storage rejects keys containing characters
    // like the en-dash "–", smart quotes, or runs of whitespace. Vehicle models in
    // the DB carry these (e.g. "Yukon –  4 Door"), which made EVERY render upload
    // 500 with "Invalid key". Keep only ASCII alphanumerics, dash, and underscore.
    const safeSeg = (s: string) =>
      String(s ?? '')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '') || 'x';
    const fileName = `renders/${userPrefix}${modeType}/${timestamp}_${safeSeg(vehicleMake)}_${safeSeg(vehicleModel)}_${safeSeg(viewType)}.png`;

    console.log('Uploading to storage:', fileName);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('wrap-files')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error(`Failed to upload render: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('wrap-files')
      .getPublicUrl(fileName);

    console.log('Render uploaded successfully:', publicUrl);

    let visualizationId: string | null = null;

    // ============= CACHE STORAGE LOGIC =============
    // Store render in color_visualizations for caching future requests
    // BATCH MODE: skipCacheStorage=true means batch pipeline persists separately —
    // prevents duplicate records and stops batch renders polluting RestyleLibrary
    if (skipCacheStorage) {
      console.log('⏭️ skipCacheStorage=true — skipping cache storage (batch mode)');
    }

    if (!skipCacheStorage) try {
      // Check if a visualization record already exists for this design
      let existingViz = null;
      
      let vizQuery = supabase
        .from('color_visualizations')
        .select('id, render_urls')
        .eq('vehicle_year', parseInt(vehicleYear))
        .eq('vehicle_make', vehicleMake.trim().toLowerCase())
        .eq('vehicle_model', vehicleModel.trim().toLowerCase())
        .eq('mode_type', modeType)
        .eq('customer_email', userEmail);

      // Add mode-specific matching
      if (modeType === 'approvemode' && effectiveColorData?.designUrl) {
        vizQuery = vizQuery.eq('custom_design_url', effectiveColorData.designUrl);
      } else if ((modeType === 'CustomStyling' || modeType === 'ColorProEnhanced' || modeType === 'GraphicsPro') && effectiveColorData?.customStylingPrompt) {
        // CustomStyling/ColorProEnhanced/GraphicsPro: match on prompt key
        const promptKey = effectiveColorData.customStylingPrompt
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 200);
        vizQuery = vizQuery.eq('custom_styling_prompt_key', promptKey);
      } else if (modeType === 'inkfusion' && effectiveColorData?.colorName) {
        vizQuery = vizQuery.eq('color_name', effectiveColorData.colorName);
      } else if ((modeType === 'wbty' || modeType === 'fadewraps') && effectiveColorData?.patternUrl) {
        vizQuery = vizQuery.eq('custom_swatch_url', effectiveColorData.patternUrl);
      } else if (modeType === 'designpanelpro' && effectiveColorData?.panelUrl) {
        vizQuery = vizQuery.eq('custom_swatch_url', effectiveColorData.panelUrl);
      }

      const { data: existingData } = await vizQuery.limit(1).maybeSingle();
      existingViz = existingData;

      if (existingViz) {
        // Update existing record with new view
        console.log('Updating existing visualization record:', existingViz.id);
        const currentRenderUrls = (existingViz.render_urls as Record<string, any> || {});
        
        let updatedRenderUrls;
        
        // 360° spin: Store under spin_views[angle]
        if (cameraAngle !== undefined) {
          updatedRenderUrls = {
            ...currentRenderUrls,
            spin_views: {
              ...(currentRenderUrls.spin_views || {}),
              [cameraAngle]: publicUrl
            }
          };
          console.log(`✅ Stored 360° angle ${cameraAngle}° under spin_views`);
        } else {
          // Legacy view type storage
          updatedRenderUrls = {
            ...currentRenderUrls,
            [viewType]: publicUrl
          };
          console.log(`✅ Stored ${viewType} view`);
        }

        const { error: updateError } = await supabase
          .from('color_visualizations')
          .update({
            render_urls: updatedRenderUrls,
            generation_status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingViz.id);

        if (updateError) {
          console.error('Error updating visualization:', updateError);
        } else {
          visualizationId = existingViz.id;
          console.log(`✅ Updated cache record with new render`);
        }
      } else {
        // Create new visualization record
        console.log('Creating new visualization record for user:', userEmail);
        const vizData: any = {
          vehicle_year: parseInt(vehicleYear),
          vehicle_make: vehicleMake.trim().toLowerCase(),
          vehicle_model: vehicleModel.trim().toLowerCase(),
        mode_type: modeType,
        // Use multiZoneLabel for GraphicsPro two-tone, otherwise use colorData
        // NEVER save "Unknown", empty, "Custom", or generic names - use descriptive fallback
        color_name: (() => {
          // Priority 1: multiZoneLabel from zone interpreter (if it's NOT generic)
          if (multiZoneLabel && multiZoneLabel.trim() && 
              !multiZoneLabel.toLowerCase().includes('custom ') &&
              !multiZoneLabel.includes('Custom |') &&
              multiZoneLabel !== 'Unknown' &&
              multiZoneLabel !== 'Custom') {
            // Clean up any "Custom" manufacturers in multi-zone labels
            const cleanedLabel = multiZoneLabel
              .split(' | ')
              .map((part: string) => {
                if (part.trim().startsWith('Custom ')) {
                  // Re-parse this zone's color
                  const colorPart = part.replace(/^Custom\s+/i, '');
                  return pickFilm(colorPart);
                }
                return part;
              })
              .join(' | ');
            return cleanedLabel;
          }
          // Priority 2: colorData.colorName if valid (not generic)
          const name = colorData?.colorName || colorData?.name;
          if (name && name.trim() && 
              name !== 'GraphicsPro Custom' && 
              name !== 'Custom' && 
              name !== 'Custom Color' &&
              name !== 'Unknown' &&
              name !== '(1)' &&
              !name.toLowerCase().startsWith('custom ')) {
            return name;
          }
          // Priority 3: Parse from styling prompt using intelligent label parser
          if (colorData?.customStylingPrompt) {
            return parseGraphicsProLabel(colorData.customStylingPrompt);
          }
          // Priority 4: Construct from manufacturer + finish (if manufacturer is valid)
          const mfr = colorData?.manufacturer;
          if (mfr && mfr !== 'Custom' && mfr.trim()) {
            const colorPart = colorData?.name || colorData?.colorName || '';
            const fin = colorData?.finish || 'Gloss';
            return `${mfr} ${cap(fin)} ${colorPart}`.trim();
          }
          // Priority 5: Use hex to generate a descriptive name
          const hex = colorData?.hex;
          if (hex && hex !== '#000000' && hex !== '#888888') {
            return `${colorData?.finish || 'Gloss'} Custom Wrap`;
          }
          return 'Avery Dennison Gloss Black';
        })(),
          color_hex: colorData?.hex || '#000000',
          finish_type: colorData?.finish || 'gloss',
          customer_email: userEmail, // SECURITY: Always require authenticated user email
          render_urls: { [viewType]: publicUrl },
          generation_status: 'completed',
          is_saved: true // ALL renders are saved to public gallery
        };

        // Add mode-specific fields
        if (modeType === 'approvemode' && effectiveColorData?.designUrl) {
          vizData.custom_design_url = effectiveColorData.designUrl;
          vizData.uses_custom_design = true;
          vizData.design_file_name = effectiveColorData.designName || 'custom-design';
        } else if ((modeType === 'CustomStyling' || modeType === 'ColorProEnhanced' || modeType === 'GraphicsPro') && effectiveColorData?.customStylingPrompt) {
          // Store prompt key for cache matching (GraphicsPro included so RevisionStudio
          // can recover the original styling prompt and reproduce the SAME design)
          const promptKey = effectiveColorData.customStylingPrompt
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 200);
          vizData.custom_styling_prompt_key = promptKey;
        } else if ((modeType === 'wbty' || modeType === 'fadewraps') && effectiveColorData?.patternUrl) {
          vizData.custom_swatch_url = effectiveColorData.patternUrl;
        } else if (modeType === 'designpanelpro' && effectiveColorData?.panelUrl) {
          vizData.custom_swatch_url = effectiveColorData.panelUrl;
          vizData.custom_design_url = effectiveColorData.panelUrl;
          vizData.design_file_name = effectiveColorData.panelName || 'Custom Panel Design';
        } else if (modeType === 'ColorPro' && effectiveColorData?.manufacturer) {
          // Store manufacturer for proper gallery display (NEVER use InkFusion fallback)
          vizData.infusion_color_id = colorData?.manufacturer || '';
        }

        const { data: newViz, error: insertError } = await supabase
          .from('color_visualizations')
          .insert(vizData)
          .select('id')
          .single();

        if (insertError) {
          console.error('Error creating visualization:', insertError);
        } else {
          visualizationId = newViz.id;
          console.log('✅ Created new public gallery record:', newViz.id);
        }
      }
    } catch (cacheError) {
      console.error('Cache storage error:', cacheError);
      // Don't fail the request if caching fails
    }
    // ============= END CACHE STORAGE LOGIC =============

    // Legacy: Also save to vehicle_renders table for backwards compatibility
    const { data: renderRecord, error: dbError } = await supabase
      .from('vehicle_renders')
      .insert({
        vehicle_year: vehicleYear,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        mode_type: modeType,
        render_url: publicUrl,
        color_data: colorData || {}
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database insert error:', dbError);
      // Don't throw - vehicle_renders is legacy
    }

    // Auto-save front/side/closeup view to carousel if applicable
    if (viewType === 'front' || viewType === 'side' || viewType === 'closeup') {
      const carouselTable = modeType === 'wbty' ? 'wbty_carousel' 
        : modeType === 'fadewraps' ? 'fadewraps_carousel'
        : 'inkfusion_carousel';
      const finishType = colorData?.finish || 'gloss';
      
      const carouselData: any = {
        name: `${vehicleMake || 'Vehicle'} ${vehicleModel || ''} ${vehicleYear || ''}`.trim(),
        media_url: publicUrl,
        vehicle_name: `${vehicleMake || ''} ${vehicleModel || ''}`.trim(),
        is_active: true,
        sort_order: Math.floor(Date.now() / 1000) % 100000
      };

      if (modeType === 'wbty' || modeType === 'fadewraps') {
        const patternName = colorData?.colorName || colorData?.patternName || 'Custom Pattern';
        carouselData.pattern_name = patternName;
        carouselData.title = patternName;
        carouselData.subtitle = `${finishType.charAt(0).toUpperCase() + finishType.slice(1)} Finish`;
        carouselData.manufacturer = 'WePrintWraps';
      } else {
        // Use multiZoneLabel for GraphicsPro two-tone, otherwise colorData
        // NEVER save "Unknown", "Custom", or empty names to carousel
        let colorName = multiZoneLabel || colorData?.colorName || colorData?.name || '';
        
        // Clean up generic labels
        if (!colorName || colorName === 'Unknown' || colorName.trim() === '' || 
            colorName === '(1)' || colorName.toLowerCase().startsWith('custom ') ||
            colorName === 'Custom' || colorName === 'Custom Color') {
          // Use intelligent label parser for styling prompts
          if (colorData?.customStylingPrompt) {
            colorName = parseGraphicsProLabel(colorData.customStylingPrompt);
          } else if (colorData?.manufacturer && colorData.manufacturer !== 'Custom') {
            colorName = `${colorData.manufacturer} ${cap(colorData?.finish || 'Gloss')} ${colorData?.name || ''}`.trim();
          } else {
            colorName = pickFilm(colorData?.name || colorData?.colorName || colorData?.finish || 'black');
          }
        }
        
        // Clean up any remaining "Custom" in multi-zone labels
        if (colorName.includes('Custom ')) {
          colorName = colorName.split(' | ').map((part: string) => {
            if (part.trim().startsWith('Custom ')) {
              const colorPart = part.replace(/^Custom\s+/i, '');
              return pickFilm(colorPart);
            }
            return part;
          }).join(' | ');
        }
        
        const manufacturer = colorData?.manufacturer && colorData.manufacturer !== 'Custom' 
          ? colorData.manufacturer 
          : '';
        carouselData.color_name = colorName;
        carouselData.title = colorName;
        carouselData.subtitle = `${finishType.charAt(0).toUpperCase() + finishType.slice(1)} Finish`;
        carouselData.manufacturer = manufacturer;
      }

      const { error: carouselError } = await supabase
        .from(carouselTable)
        .insert(carouselData);

      if (carouselError) {
        console.error('Carousel save error:', carouselError);
        // Don't throw - carousel save is optional
      } else {
        console.log(`✅ Auto-saved to ${carouselTable}`);
      }
    }

    // ============= DESIGN ANCHOR GENERATION (DesignPanelPro View 1 only) =============
    // After a successful driver-side (View 1) render, analyze the image to create a
    // structured text description ("Design Anchor") that enforces visual continuity
    // across all subsequent views (2-6).
    let generatedDesignAnchorText: string | null = null;

    if (modeType === 'designpanelpro' && (viewType === 'side' || viewType === 'driver-side' || !viewType)) {
      try {
        console.log('🔗 DesignIQ v3.1: Generating Design Anchor from View 1 render...');

        const anchorPrompt = `Analyze this vehicle wrap render in precise detail. Your analysis will be used to ensure visual continuity when rendering the same wrap from different angles.

Describe:
1. COLORS: Every color present with approximate hex values and where each color appears on the vehicle (e.g., "Electric blue #0066FF covers the main body panels, transitioning to...")
2. DESIGN ELEMENTS: All stripes, curves, gradients, shapes, geometric patterns — their exact position, size, direction of flow, and relationship to vehicle body lines
3. TYPOGRAPHY: Any text, fonts, and their exact placement (or state "No typography present" if text-free)
4. COMPOSITION: Overall flow direction (front-to-back, top-to-bottom), symmetry type, focal points, and how the design interacts with the vehicle's contours
5. SCALE & COVERAGE: How the design maps to specific vehicle panels (doors, fenders, hood, roof), where it starts and ends, and any areas left unwrapped

Output a single structured paragraph that another AI could use to recreate this EXACT design on the same vehicle from any angle. Be specific about spatial relationships and color placement.`;

        // Use the already-extracted image data for the analysis call
        const anchorGeminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;

        const anchorResponse = await fetch(anchorGeminiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: anchorPrompt },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: base64Data
                  }
                }
              ]
            }],
            generationConfig: {
              responseMimeType: "text/plain",
              maxOutputTokens: 1024
            }
          }),
          signal: AbortSignal.timeout(30_000), // 30s timeout for anchor analysis
        });

        if (anchorResponse.ok) {
          const anchorData = await anchorResponse.json();
          const anchorParts = anchorData?.candidates?.[0]?.content?.parts;
          if (anchorParts) {
            for (const part of anchorParts) {
              if (part.text) {
                generatedDesignAnchorText = part.text.trim();
                console.log(`✅ DesignIQ v3.1: Design Anchor generated (${generatedDesignAnchorText.length} chars)`);
                break;
              }
            }
          }
        } else {
          console.warn('⚠️ Design Anchor generation failed (non-critical):', anchorResponse.status);
        }
      } catch (anchorError) {
        console.warn('⚠️ Design Anchor generation error (non-critical):', anchorError);
        // Non-fatal — views 2-6 will still render, just without anchor continuity
      }
    }
    // ============= END DESIGN ANCHOR GENERATION =============

    // ============= NEURALNETWORK DNA CAPTURE =============
    // Record this render's DNA for the learning loop. Non-blocking, fail-safe.
    // This feeds the NeuralNetwork with data for few-shot retrieval + subscriber personalization.
    if (authenticatedUserId) {
      captureDesignDNA({
        userId: authenticatedUserId,
        promptText: aiPrompt.substring(0, 2000),
        enhancedPrompt: aiPrompt,
        vehicle: {
          year: vehicleYear,
          make: vehicleMake,
          model: vehicleModel,
        },
        designConfig: {
          mode: modeType,
          finish: colorData?.finish || 'gloss',
          color: colorData?.colorName || colorData?.name,
          hex: colorData?.hex,
          manufacturer: colorData?.manufacturer,
        },
        renderUrl: publicUrl,
        designName: generatedDesignAnchorText?.substring(0, 200) || undefined,
        viewType: viewType || 'side',
      }).then(dnaId => {
        if (dnaId) console.log(`[DNA] Captured ColorPro render DNA: ${dnaId}`);
      }).catch(() => { /* fail-safe */ });
    }
    // ============= END DNA CAPTURE =============

    // Provenance ledger — one row per successful render. Never throws.
    await emitRenderEvent({
      userId: authenticatedUserId,
      email: userEmail || null,
      tool: typeof modeType === 'string' && modeType.length > 0 ? modeType : 'generate_color_render',
      mode: typeof modeType === 'string' ? modeType : null,
      geminiModel: "gemini-3-pro-image-preview",
      geminiFinishReason: "STOP",
      vehicleYear: vehicleYear != null ? String(vehicleYear) : null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      viewType: typeof cameraAngle === 'number' ? `spin_${cameraAngle}` : (viewType || null),
      finish: colorData?.finish || null,
      rawPrompt: colorData?.colorName || colorData?.name || null,
      enhancedPrompt: aiPrompt,
      renderUrl: publicUrl,
      success: true,
      latencyMs: Date.now() - RENDER_START_MS,
      sourceTable: "vehicle_renders",
      sourceId: renderRecord?.id || null,
    });

    return new Response(
      JSON.stringify({
        renderUrl: publicUrl,
        // The private path never crosses the browser boundary. It lets the
        // standalone worker download and content-address the exact Edge output.
        ...(internalCaller.internal
          ? { storagePath: fileName, contentType: 'image/png' }
          : {}),
        renderId: renderRecord?.id,
        visualizationId,
        cached: false,
        ...(generatedDesignAnchorText ? { designAnchorText: generatedDesignAnchorText } : {})
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Error in generate-color-render:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
}
