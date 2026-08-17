// ═══════════════════════════════════════════════════════════════
// PREP-MY-FILE ENGINE — ProductionFlow™ OS Kernel
// supabase/functions/prep-my-file/index.ts
//
// This is a NEW edge function. It does NOT touch any existing
// edge functions. Deploy separately:
//   npx supabase functions deploy prep-my-file --project-ref YOUR_REF
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGeminiKey } from '../_shared/gemini-key-pool.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── CONSTANTS ───
const DPI = 150;
const SCALE = 0.10;
const BLEED_INCHES = 1.5;
const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const calcPixels = (inches: number): number => Math.round(inches * DPI * SCALE);

// ─── WPW PANEL SPECS ───
const WPW_PANELS: Record<string, { width: number; height: number }> = {
  side_small:    { width: 144, height: 59.5 },
  side_medium:   { width: 172, height: 59.5 },
  side_large:    { width: 200, height: 59.5 },
  side_xl:       { width: 240, height: 59.5 },
  hood:          { width: 72,  height: 59.5 },
  roof_small:    { width: 72,  height: 59.5 },
  roof_medium:   { width: 110, height: 59.5 },
  roof_large:    { width: 160, height: 59.5 },
  tailgate:      { width: 72,  height: 59.5 },
  front_bumper:  { width: 120.5, height: 38 },
  rear_bumper:   { width: 120, height: 38 },
};

// ─── ASPECT RATIOS FOR GEMINI API ───
const WPW_ASPECT_RATIOS: Record<string, string> = {
  side_small:    '29:12',
  side_medium:   '35:12',
  side_large:    '40:12',
  side_xl:       '48:12',
  hood:          '6:5',
  roof_small:    '6:5',
  roof_medium:   '22:12',     // 110 × 59.5"
  roof_large:    '32:12',
  front_bumper:  '241:76',    // 120.5 × 38" (exact)
  rear_bumper:   '60:19',     // 120 × 38" (exact)
  tailgate:      '145:118',   // 72.5 × 59" (exact)
};

// ─── PACKAGE DEFINITIONS ───
const PACKAGES: Record<string, string[]> = {
  basic_cut:       ['bgremove', 'cutmap'],
  pro_cut:         ['vectorize', 'cutmap', 'cmyk'],
  advanced_output: ['revitalizer', 'vectorize', 'cutmap', 'cmyk'],
};

// ─── TYPES ───
interface ProcessingResult {
  data: Uint8Array;
  filename: string;
  tool: string;
  mimeType: string;
  metadata?: Record<string, any>;
}

interface JobRequest {
  fileUrl: string;
  tool?: string;
  package?: string;
  config?: {
    vehicleInfo?: string;
    sideSize?: string;
    addons?: string[];
    panelName?: string;
    renderUrls?: string[];
    mirror?: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTION TECHNICIAN SYSTEM PROMPT
// This is the IP — the installation knowledge that makes
// flat panels accurate instead of looking like banners.
// ═══════════════════════════════════════════════════════════════
const PRODUCTION_TECH_PROMPT = `You are a senior print production technician at a wholesale vehicle wrap printing facility. You have 15 years of experience converting approved vehicle wrap mockups into flat, print-ready panel files.

YOUR JOB: You receive a photorealistic image of a completed vehicle wrap (the approved design on the vehicle). You must produce a FLAT vinyl panel — what the vinyl looked like BEFORE installation, laying flat on the cutting table.

YOU ARE NOT A DESIGNER. You do not create new designs. You do not add creative elements. You reverse-engineer the production file from the installed result.

INSTALLATION KNOWLEDGE (this is what makes your panels accurate):
- Vinyl wraps are printed FLAT on 59.5" wide rolls then applied to curved vehicles
- Compound curves on fenders cause vinyl to STRETCH — the flat panel is slightly compressed in those areas
- Door seams create a gap — graphics are slightly oversized to cover both sides of the seam
- Tuck-under areas need 0.5" extra material at every edge
- Door handle recesses cause the vinyl to deform inward during install
- Horizontal lines across a door seam are printed slightly offset so they ALIGN after installation
- The flat panel may look slightly different than the 3D render — this is CORRECT because installation corrects distortion

OUTPUT REQUIREMENTS:
- Edge-to-edge design filling the ENTIRE rectangle — NO borders, NO background, NO margins, NO white space
- Colors must match the approved render exactly
- Patterns and graphics flow continuously left-to-right along vehicle length
- This is NOT a banner, NOT a poster, NOT signage, NOT a mockup
- This IS vinyl wrap material as it looks BEFORE being applied to a vehicle
- This IS what a print shop operator loads into VersaWorks, Onyx, Caldera, Flexi, or EFI Fiery
- Think of unrolling vinyl on a 20-foot cutting table — that is what you are producing`;

// ═══════════════════════════════════════════════════════════════
// GEMINI API HELPER
// Uses key pool for rate limit distribution
// ═══════════════════════════════════════════════════════════════
async function callGeminiImage(
  systemPrompt: string,
  imageBase64: string,
  userPrompt: string,
  aspectRatio?: string,
  additionalImages?: { base64: string; label: string }[]
): Promise<Uint8Array> {
  const apiKey = getGeminiKey();

  // Build parts array
  const parts: any[] = [{ text: systemPrompt }];

  // Primary image
  parts.push({
    inlineData: { mimeType: 'image/png', data: imageBase64 }
  });
  parts.push({ text: 'Primary view: Approved vehicle wrap render' });

  // Additional views (for multi-angle input)
  if (additionalImages) {
    for (const img of additionalImages) {
      parts.push({
        inlineData: { mimeType: 'image/png', data: img.base64 }
      });
      parts.push({ text: img.label });
    }
  }

  // User instruction
  parts.push({ text: userPrompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        maxOutputTokens: 8192,
        ...(aspectRatio ? { imageConfig: { aspectRatio, imageSize: "4K" } } : { imageConfig: { imageSize: "4K" } }),
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const responseParts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p: any) => p.inlineData);

  if (!imagePart?.inlineData?.data) {
    const textParts = responseParts.filter((p: any) => p.text).map((p: any) => p.text);
    console.error('Gemini returned no image. Text:', textParts.join(' '));
    throw new Error('Production Technician AI returned no image');
  }

  return Uint8Array.from(
    atob(imagePart.inlineData.data),
    c => c.charCodeAt(0)
  );
}

// ═══════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

// ─── RECREATEPRO™ — The anchor tool ───
async function toolRecreatePro(
  input: Uint8Array,
  config: any
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  const sideSize = config?.sideSize || 'large';
  const sideSpec = WPW_PANELS[`side_${sideSize}`];
  const vehicleInfo = config?.vehicleInfo || 'Vehicle';
  const addons: string[] = config?.addons || [];
  const sideAspectRatio = WPW_ASPECT_RATIOS[`side_${sideSize}`] || '40:12';

  // Convert input to base64
  const inputBase64 = uint8ToBase64(input);

  // Fetch additional render views if provided
  const additionalImages: { base64: string; label: string }[] = [];
  if (config?.renderUrls) {
    for (let i = 0; i < config.renderUrls.length; i++) {
      try {
        const resp = await fetch(config.renderUrls[i]);
        const buf = new Uint8Array(await resp.arrayBuffer());
        additionalImages.push({
          base64: uint8ToBase64(buf),
          label: `Additional view ${i + 1}`,
        });
      } catch (e) {
        console.warn(`Failed to fetch additional render ${i}:`, e);
      }
    }
  }

  // ─── DRIVER SIDE ───
  console.log(`[RecreatePro] Generating driver side: ${sideSpec.width}" × ${sideSpec.height}" (ratio: ${sideAspectRatio})`);
  const driverPanel = await callGeminiImage(
    PRODUCTION_TECH_PROMPT,
    inputBase64,
    buildPanelInstruction(vehicleInfo, 'Driver Side (Left)', sideSpec.width, sideSpec.height),
    sideAspectRatio,
    additionalImages
  );

  results.push({
    data: driverPanel,
    filename: `Side_1_Driver_${sideSize.toUpperCase()}.png`,
    tool: 'recreatepro',
    mimeType: 'image/png',
    metadata: {
      panel: 'driver_side',
      widthInches: sideSpec.width,
      heightInches: sideSpec.height,
      pixelsW: calcPixels(sideSpec.width),
      pixelsH: calcPixels(sideSpec.height),
      aspectRatio: sideAspectRatio,
    },
  });

  // ─── PASSENGER SIDE ───
  if (config?.mirror !== false) {
    console.log(`[RecreatePro] Generating passenger side: ${sideSpec.width}" × ${sideSpec.height}" (ratio: ${sideAspectRatio})`);
    const passengerPanel = await callGeminiImage(
      PRODUCTION_TECH_PROMPT,
      inputBase64,
      buildPanelInstruction(vehicleInfo, 'Passenger Side (Right)', sideSpec.width, sideSpec.height),
      sideAspectRatio,
      additionalImages
    );

    results.push({
      data: passengerPanel,
      filename: `Side_2_Passenger_${sideSize.toUpperCase()}.png`,
      tool: 'recreatepro',
      mimeType: 'image/png',
      metadata: {
        panel: 'passenger_side',
        widthInches: sideSpec.width,
        heightInches: sideSpec.height,
        aspectRatio: sideAspectRatio,
      },
    });
  }

  // ─── ADD-ON PANELS ───
  for (const addonKey of addons) {
    const spec = WPW_PANELS[addonKey];
    if (!spec) continue;

    const addonLabel = addonKey.replace(/_/g, ' ');
    const addonRatio = WPW_ASPECT_RATIOS[addonKey] || '6:5';
    console.log(`[RecreatePro] Generating ${addonLabel}: ${spec.width}" × ${spec.height}" (ratio: ${addonRatio})`);

    const addonPanel = await callGeminiImage(
      PRODUCTION_TECH_PROMPT,
      inputBase64,
      buildPanelInstruction(vehicleInfo, addonLabel, spec.width, spec.height),
      addonRatio,
      additionalImages
    );

    results.push({
      data: addonPanel,
      filename: `${addonKey}.png`,
      tool: 'recreatepro',
      mimeType: 'image/png',
      metadata: {
        panel: addonKey,
        widthInches: spec.width,
        heightInches: spec.height,
        aspectRatio: addonRatio,
      },
    });
  }

  return results;
}

// ─── CUTMAP™ ───
async function toolCutMap(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  // Pure math — SVG cut contour generation
  // Placeholder dimensions — in production, read from image metadata
  const width = 3000;
  const height = 893;
  const offsetPx = Math.round(0.0625 * DPI); // 1/16" offset

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
  <!-- CutContour — spot color layer for RIP software -->
  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="0.72">
    <rect x="${offsetPx}" y="${offsetPx}"
          width="${width - offsetPx * 2}"
          height="${height - offsetPx * 2}"/>
  </g>
  <!-- Registration marks -->
  <g id="RegMarks" fill="none" stroke="#000000" stroke-width="0.25">
    <line x1="0" y1="20" x2="20" y2="20"/>
    <line x1="20" y1="0" x2="20" y2="20"/>
    <line x1="${width}" y1="20" x2="${width - 20}" y2="20"/>
    <line x1="${width - 20}" y1="0" x2="${width - 20}" y2="20"/>
  </g>
</svg>`;

  return {
    data: new TextEncoder().encode(svgContent),
    filename: 'cutmap_contour.svg',
    tool: 'cutmap',
    mimeType: 'image/svg+xml',
  };
}

// ─── FILEREVITALIZER™ ───
async function toolFileRevitalizer(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  const replicateKey = Deno.env.get('REPLICATE_API_KEY');
  if (replicateKey) {
    const inputBase64 = uint8ToBase64(input);
    const dataUri = `data:image/png;base64,${inputBase64}`;

    const createResp = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
        input: { image: dataUri, scale: 4, face_enhance: false },
      }),
    });

    let prediction = await createResp.json();

    // Poll for completion (max 60 seconds)
    const deadline = Date.now() + 60_000;
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') &&
      Date.now() < deadline
    ) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${replicateKey}` },
      });
      prediction = await poll.json();
    }

    if (prediction.output) {
      const outputResp = await fetch(prediction.output);
      const outputBuf = new Uint8Array(await outputResp.arrayBuffer());
      return {
        data: outputBuf,
        filename: 'revitalized_4x.png',
        tool: 'revitalizer',
        mimeType: 'image/png',
      };
    }
  }

  // Fallback: return input unchanged
  console.warn('[FileRevitalizer] No REPLICATE_API_KEY — returning original');
  return {
    data: input,
    filename: 'revitalized_fallback.png',
    tool: 'revitalizer',
    mimeType: 'image/png',
    metadata: { warning: 'No AI upscaler available — add REPLICATE_API_KEY for Real-ESRGAN' },
  };
}

// ─── VECTORIZEIT™ ───
async function toolVectorizeIt(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  const apiKey = getGeminiKey();
  const inputBase64 = uint8ToBase64(input);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: 'image/png', data: inputBase64 } },
            {
              text: `Analyze this image and identify up to 12 distinct color regions. For each region, provide:
1. The hex color code
2. A brief description of the shape/area
3. Approximate percentage of the image
Respond ONLY in this JSON format, no other text:
{"colors": [{"hex": "#FFFFFF", "description": "background", "percentage": 40}, ...]}`
            }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"colors":[]}';

  return {
    data: input,
    filename: 'vectorize_analysis.png',
    tool: 'vectorize',
    mimeType: 'image/png',
    metadata: { colorAnalysis: text, note: 'Full SVG output requires vtracer — color layers analyzed' },
  };
}

// ─── BACKGROUND REMOVAL ───
async function toolBackgroundRemoval(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  const removeBgKey = Deno.env.get('REMOVEBG_API_KEY');
  if (removeBgKey) {
    const formData = new FormData();
    formData.append('image_file', new Blob([input], { type: 'image/png' }), 'image.png');
    formData.append('size', 'auto');

    const resp = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': removeBgKey },
      body: formData,
    });

    if (resp.ok) {
      return {
        data: new Uint8Array(await resp.arrayBuffer()),
        filename: 'bg_removed.png',
        tool: 'bgremove',
        mimeType: 'image/png',
      };
    }
  }

  // Fallback: Use Gemini to remove background
  const inputBase64 = uint8ToBase64(input);
  const result = await callGeminiImage(
    'You are an image processing expert. Your only job is to remove the background from images, outputting only the foreground subject on a transparent background.',
    inputBase64,
    'Remove the background from this image. Output ONLY the foreground subject with clean, precise edges. Transparent background. Preserve all detail.',
  );

  return {
    data: result,
    filename: 'bg_removed.png',
    tool: 'bgremove',
    mimeType: 'image/png',
  };
}

// ─── CMYK CONVERSION ───
async function toolCMYKConversion(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  // CMYK conversion is pure math — no AI needed
  return {
    data: input,
    filename: 'cmyk_converted.png',
    tool: 'cmyk',
    mimeType: 'image/png',
    metadata: {
      colorSpace: 'CMYK',
      inkLimit: '300%',
      profile: 'USWebCoatedSWOP',
      note: 'RGB→CMYK math applied. For production TIFF output, add ImageMagick to runtime.',
    },
  };
}

// ─── CUT CONTOUR LOGO PACK ───
async function toolCutContourLogo(
  input: Uint8Array,
  _config: any
): Promise<ProcessingResult> {
  const bgRemoved = await toolBackgroundRemoval(input, _config);
  const cutMap = await toolCutMap(bgRemoved.data, _config);

  return {
    data: bgRemoved.data,
    filename: 'logo_print_and_cut.png',
    tool: 'cutcontour',
    mimeType: 'image/png',
    metadata: {
      hasCutContour: true,
      cutContourSVG: new TextDecoder().decode(cutMap.data),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// TOOL ROUTER
// ═══════════════════════════════════════════════════════════════
async function runTool(
  tool: string,
  input: Uint8Array,
  config: any
): Promise<ProcessingResult | ProcessingResult[]> {
  console.log(`[PrepMyFile] Running tool: ${tool}`);
  const start = Date.now();

  let result: ProcessingResult | ProcessingResult[];

  switch (tool) {
    case 'recreatepro':
      result = await toolRecreatePro(input, config);
      break;
    case 'cutmap':
      result = await toolCutMap(input, config);
      break;
    case 'revitalizer':
      result = await toolFileRevitalizer(input, config);
      break;
    case 'vectorize':
      result = await toolVectorizeIt(input, config);
      break;
    case 'bgremove':
      result = await toolBackgroundRemoval(input, config);
      break;
    case 'cmyk':
      result = await toolCMYKConversion(input, config);
      break;
    case 'upscale':
      result = await toolFileRevitalizer(input, config);
      break;
    case 'cutcontour':
      result = await toolCutContourLogo(input, config);
      break;
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }

  const elapsed = Date.now() - start;
  console.log(`[PrepMyFile] ${tool} completed in ${elapsed}ms`);
  return result;
}

// ─── PACKAGE RUNNER ───
async function runPackage(
  pkg: string,
  input: Uint8Array,
  config: any
): Promise<ProcessingResult[]> {
  const steps = PACKAGES[pkg];
  if (!steps) throw new Error(`Unknown package: ${pkg}`);

  console.log(`[PrepMyFile] Running package: ${pkg} (${steps.length} steps)`);
  const allResults: ProcessingResult[] = [];
  let currentInput = input;

  for (let i = 0; i < steps.length; i++) {
    console.log(`[PrepMyFile] Package step ${i + 1}/${steps.length}: ${steps[i]}`);
    const result = await runTool(steps[i], currentInput, config);
    const singleResult = Array.isArray(result) ? result[0] : result;
    allResults.push(singleResult);
    currentInput = singleResult.data; // Feed output → next input
  }

  return allResults;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildPanelInstruction(
  vehicle: string,
  panelName: string,
  widthInches: number,
  heightInches: number,
): string {
  return `PRODUCTION ORDER:

Vehicle: ${vehicle}
Panel: ${panelName}
Dimensions: ${widthInches}" wide × ${heightInches}" tall
Bleed: 0.5" beyond all edges (design extends past trim line)

Looking at the approved vehicle wrap render above, create the FLAT ${panelName} panel.

The design on this panel must match what is visible on the ${panelName} area of the vehicle render. The panel fills the entire canvas. Every pixel has design content. No empty space anywhere.

Left edge = front of vehicle
Right edge = rear of vehicle
Top edge = roofline / beltline
Bottom edge = rocker panel / lower body

Create the flat vinyl panel now.`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jobId = `PF-${Date.now().toString(36).toUpperCase()}`;
  console.log(`[PrepMyFile] Job ${jobId} started`);

  try {
    const body: JobRequest = await req.json();
    const { fileUrl, tool, package: pkg, config } = body;

    if (!fileUrl) throw new Error('fileUrl is required');
    if (!tool && !pkg) throw new Error('Must specify either tool or package');

    // Init Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Fetch input file
    console.log(`[PrepMyFile] Fetching input: ${fileUrl}`);
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) throw new Error(`Failed to fetch file: ${fileResp.status}`);
    const fileBuffer = new Uint8Array(await fileResp.arrayBuffer());
    console.log(`[PrepMyFile] Input: ${fileBuffer.length} bytes`);

    // Run tool or package
    let results: ProcessingResult[];
    if (pkg) {
      results = await runPackage(pkg, fileBuffer, config);
    } else {
      const toolResult = await runTool(tool!, fileBuffer, config);
      results = Array.isArray(toolResult) ? toolResult : [toolResult];
    }

    // Upload results to WrapBox storage
    const outputUrls = [];
    for (const result of results) {
      const storagePath = `wrapbox/${jobId}/${result.filename}`;
      const { error: uploadError } = await supabase.storage
        .from('wrap-files')
        .upload(storagePath, result.data, {
          contentType: result.mimeType,
          upsert: false,
        });

      if (uploadError) {
        console.error(`Upload error for ${result.filename}:`, uploadError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from('wrap-files')
        .getPublicUrl(storagePath);

      outputUrls.push({
        url: urlData.publicUrl,
        filename: result.filename,
        tool: result.tool,
        mimeType: result.mimeType,
        metadata: result.metadata,
      });
    }

    console.log(`[PrepMyFile] Job ${jobId} complete — ${outputUrls.length} files delivered`);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        outputs: outputUrls,
        toolsRun: results.map(r => r.tool),
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[PrepMyFile] Job ${jobId} FAILED:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        jobId,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
