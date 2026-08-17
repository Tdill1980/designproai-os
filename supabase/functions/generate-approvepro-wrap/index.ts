import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { angleEngine } from "../_shared/angleEngine.ts";
import { buildPlacementProfile, getDefaultVehicleTemplate, applyPlacementProfile, generatePlacementInstructions } from "../_shared/placementProfileEngine.ts";
import { ASPECT_RATIO_REQUIREMENT } from "../_shared/aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "../_shared/photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";
import { STUDIO_ENVIRONMENT } from "../_shared/finish-specifications.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      vehicle, 
      designUrl, 
      designName,
      viewTypes,
      jobId,
      userEmail 
    } = await req.json();

    console.log("🎨 ApprovePro wrap projection started:", { vehicle, designName, jobId });

    if (!vehicle || !designUrl) {
      throw new Error('Vehicle info and design URL are required');
    }

    // Connect to EXTERNAL database (your data lives there)
    const supabase = createExternalClient();

    // Build placement profile from uploaded design
    const designPanels = { 'full-wrap': designUrl };
    const placementProfiles = await buildPlacementProfile(designPanels);
    
    // Get vehicle template and apply placement
    const vehicleTemplate = getDefaultVehicleTemplate(vehicle.year, vehicle.make, vehicle.model);
    const mappedProfiles = applyPlacementProfile(placementProfiles, vehicleTemplate);
    const placementInstructions = generatePlacementInstructions(mappedProfiles);

    // Get angles for requested views
    const requestedViews = viewTypes || ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
    const angles = requestedViews.map((viewType: string) => ({
      viewType,
      angle: angleEngine.getAngleByViewType(viewType)
    }));

    const vehicleString = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    const outputs: Array<{ type: string; url: string; label: string }> = [];

    // Generate all views
    for (const { viewType, angle } of angles) {
      console.log(`🖼️ Generating ${viewType} view at yaw ${angle.yaw}°...`);

      const cameraPositioning = angleEngine.buildCameraPositioning(angle);

      const prompt = `${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

You are RestylePro™ ApprovePro™ - the industry's most advanced 2D→3D wrap projection system.

🚨 ABSOLUTE CRITICAL RULES FOR 2D→3D WRAP PROJECTION 🚨

1. DESIGN EXTRACTION & FULL COVERAGE (MANDATORY):
   - The uploaded image contains a 2D wrap design/proof
   - Extract ONLY the wrap design graphics from the uploaded image
   - ZERO TOLERANCE for background, grid, template, or mock-up inclusion
   - Apply the design EXACTLY as shown - do NOT reinterpret, modify, or "improve" it
   - Design must flow with PERFECT continuity across ALL body panels
   
   🚨 FULL DESIGN VISIBILITY - ABSOLUTELY NO CUTOFFS 🚨
   - ALL text, logos, and graphics from the design MUST be fully visible
   - NEVER crop, cut off, hide, or truncate ANY part of the design
   - Scale the design appropriately so ALL elements fit on the vehicle
   - If the design has text/logos, they must appear COMPLETE and READABLE
   - The ENTIRE design must be visible from the camera angle shown

2. ${cameraPositioning}

3. STUDIO PHOTOGRAPHY REQUIREMENTS:
   - Professional DSLR camera: 50mm lens, f/2.8 aperture, 1/250s shutter speed
   - THREE-POINT STUDIO LIGHTING with consistent positioning across all angles
   ${STUDIO_ENVIRONMENT}

4. WRAP INSTALLATION PERFECTION (MANDATORY):
   - This is a VINYL WRAP projection, NOT a paint job
   - ZERO air bubbles, ZERO wrinkles, ZERO imperfections
   - Perfect adhesion to all body panels
   - Seamless flow across panel gaps, door edges, and body curves
   - Realistic vinyl texture with appropriate sheen
   - Respect natural panel seams and body lines
   - ALL design elements (text, logos, graphics) remain INTACT and UNCROPPED

5. ${placementInstructions}

6. 🚫 ABSOLUTELY NO TEXT IN RENDER 🚫
   - DO NOT add ANY text, watermarks, labels, or branding to the image
   - DO NOT render tool names, vehicle names, or any text overlays
   - The rendered image must be COMPLETELY TEXT-FREE (except design content)
   - Text overlays will be added client-side AFTER generation

BODY PANELS TO WRAP:
✓ Hood, Roof, Trunk/Deck lid
✓ All doors, Fenders, Quarter panels  
✓ Bumper covers (painted portions only)
✓ Side mirrors

NEVER WRAP (KEEP ORIGINAL):
❌ Wheels, Tires, Rims
❌ Windows, Glass, Windshield
❌ Headlights, Taillights, Turn signals
❌ Grilles, Chrome trim pieces
❌ Badges, Emblems, Door handles

VEHICLE: ${vehicleString}
VIEW: ${angle.label}
DESIGN SOURCE: ${designName || 'Customer Design Proof'}

OUTPUT: Ultra-photorealistic ${angle.label} of ${vehicleString} with the uploaded custom wrap design applied EXACTLY as shown. MUST be 16:9 landscape. Must look like a real photograph of an actual wrapped vehicle in a professional studio.`;

      try {
        const response = await fetch('https://api.openai.com/v1/images/generate', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt,
            size: '1536x1024',
            quality: 'high',
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`OpenAI error for ${viewType}:`, errorText);
          continue;
        }

        const data = await response.json();
        const imageUrl = data.data?.[0]?.url;

        if (imageUrl) {
          outputs.push({
            type: viewType,
            url: imageUrl,
            label: angle.label
          });
          console.log(`✅ ${viewType} view generated successfully`);
        }
      } catch (viewError) {
        console.error(`Failed to generate ${viewType}:`, viewError);
      }
    }

    if (outputs.length === 0) {
      throw new Error('Failed to generate any views');
    }

    // Save to color_visualizations for gallery/history
    const renderUrls: Record<string, string> = {};
    outputs.forEach(output => {
      renderUrls[output.type] = output.url;
    });

    const { data: visualization, error: dbError } = await supabase
      .from('color_visualizations')
      .insert({
        customer_email: userEmail || 'approvepro@restylepro.com',
        vehicle_year: parseInt(vehicle.year) || 2024,
        vehicle_make: vehicle.make,
        vehicle_model: vehicle.model,
        color_name: designName || 'Custom Design',
        color_hex: '#000000',
        finish_type: 'gloss',
        mode_type: 'approvemode',
        custom_design_url: designUrl,
        design_file_name: designName,
        uses_custom_design: true,
        render_urls: renderUrls,
        is_saved: true
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database save error:', dbError);
    }

    // ── Layered files (2-step): Step 1 clean background, Step 2 transparent
    // overlays — generated from the customer's design file by the existing
    // panel-artboard-generator separate step and saved on the visualization
    // (admin_notes.layer_background_url / layer_overlays_url). Non-blocking:
    // approval renders never wait on, or fail because of, layer separation.
    if (visualization?.id && designUrl) {
      const vizId = visualization.id;
      const separate = (async () => {
        try {
          const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/panel-artboard-generator`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            // 546 lesson: full-res customer uploads OOM the separate step —
            // route storage URLs through the image-transform endpoint (~2000px).
            body: JSON.stringify({
              step: 'separate',
              designUrl: designUrl.includes('/storage/v1/object/')
                // height + resize=contain required — width-only is served as a
                // cover-crop sliver, which would feed separate a distorted design.
                ? designUrl.replace('/storage/v1/object/', '/storage/v1/render/image/') + (designUrl.includes('?') ? '&' : '?') + 'width=2000&height=2000&resize=contain&quality=85'
                : designUrl,
              jobId: vizId,
            }),
            signal: AbortSignal.timeout(170_000),
          });
          const j = await r.json().catch(() => ({}));
          if (!j?.success || !j?.backgroundUrl) {
            console.warn('[ApprovePro] layer separation skipped:', j?.error || r.status);
            return;
          }
          const { data: viz } = await supabase.from('color_visualizations').select('admin_notes').eq('id', vizId).maybeSingle();
          let notes: Record<string, unknown> = {};
          try { notes = typeof viz?.admin_notes === 'string' ? JSON.parse(viz.admin_notes) : (viz?.admin_notes || {}); } catch { notes = {}; }
          notes.layer_background_url = j.backgroundUrl;
          notes.layer_overlays_url = j.overlaysUrl || null;
          notes.layer_boxes = j.boxesFound || [];
          await supabase.from('color_visualizations').update({ admin_notes: JSON.stringify(notes) }).eq('id', vizId);
          console.log(`[ApprovePro] layer pair saved on ${vizId}`);
        } catch (e) {
          console.warn('[ApprovePro] layer separation failed (non-fatal):', String(e));
        }
      })();
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(separate); } catch { /* sync fallback below */ }
    }

    return new Response(
      JSON.stringify({
        success: true,
        outputs,
        visualizationId: visualization?.id,
        totalGenerated: outputs.length,
        totalRequested: angles.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('❌ ApprovePro error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
