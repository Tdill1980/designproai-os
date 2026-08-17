// ============================================================
// EXTRACT-LOGO-ELEMENTS
// Edge Function: extract-logo-elements
// Detects logos, text, phone numbers in the approved render
// Extracts them as individual assets for Cut Contour Pack upsell
// Called by: run-production-flow orchestrator (Stage 5)
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Base64-encode bytes in chunks so large (4K) renders don't blow the call
// stack the way btoa(String.fromCharCode(...bytes)) does.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000 // 32KB per chunk — well under the arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

interface ExtractedElement {
  id: string
  type: 'logo' | 'text' | 'phone' | 'url' | 'graphic'
  label: string
  content?: string              // text content if readable
  bounding_box: {               // location on original render
    x: number
    y: number
    width: number
    height: number
  }
  dimensions_inches?: {         // real-world size estimate
    width: number
    height: number
  }
  preview_url?: string          // cropped preview of just this element
  cut_contour_url?: string      // isolated element on transparent bg (future)
  confidence: number            // 0-1 detection confidence
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!googleApiKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'GOOGLE_AI_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { job_id, approved_render_url, concept_json, user_id } = await req.json()

    if (!approved_render_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'approved_render_url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 1: Fetch the approved render
    const renderResponse = await fetch(approved_render_url)
    if (!renderResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch render: ${renderResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const renderBuffer = await renderResponse.arrayBuffer()
    // Chunked base64: btoa(String.fromCharCode(...bytes)) overflows the call
    // stack on large (4K) renders — `RangeError: Maximum call stack size
    // exceeded` — which made detection silently return []. Encode in 32KB
    // chunks so any image size is handled.
    const base64Render = bytesToBase64(new Uint8Array(renderBuffer))

    // Step 2: AI detection — find all extractable elements
    const detectionPrompt = `You are a vehicle wrap production specialist. Analyze this vehicle wrap render and identify ALL discrete elements that could be extracted as separate cut-ready assets.

Look for:
1. LOGOS — company logos, brand marks, emblems
2. TEXT — business names, taglines, slogans
3. PHONE NUMBERS — any phone numbers visible
4. URLS — website addresses, social media handles
5. GRAPHICS — standalone graphic elements (icons, mascots, symbols) that are distinct from the background pattern/texture

Do NOT include:
- Background textures, gradients, or patterns
- The vehicle itself
- Generic color fields
- Elements that are part of the overall wrap pattern and can't be meaningfully isolated

${concept_json ? `Design context: ${JSON.stringify(concept_json)}` : ''}

Respond ONLY with valid JSON (no markdown, no backticks):

{
  "elements": [
    {
      "type": "logo | text | phone | url | graphic",
      "label": "human-readable label like 'Company Logo' or 'Phone Number'",
      "content": "the actual text content if readable, or null for graphics",
      "location": "where on the vehicle (e.g., 'driver door', 'hood center', 'rear quarter')",
      "bounding_box": {
        "x_percent": 0.0,
        "y_percent": 0.0,
        "width_percent": 0.0,
        "height_percent": 0.0
      },
      "estimated_size_inches": { "width": 0, "height": 0 },
      "confidence": 0.95,
      "extraction_difficulty": "easy | medium | hard",
      "notes": "any relevant notes about this element"
    }
  ],
  "total_extractable": 0,
  "extraction_summary": "brief summary of what was found"
}`

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/png', data: base64Render } },
              { text: detectionPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            // Force pure-JSON output. Without this, gemini-2.5-flash often wrapped
            // the result in ```json fences or added preamble/trailing prose, which
            // broke JSON.parse → detection_failed → no lift → no PNG layers (the
            // intermittent "no layers" flake). JSON mode returns a bare object.
            responseMimeType: "application/json",
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text()
      console.error('Gemini element detection failed:', errText)
      return new Response(
        JSON.stringify({
          success: true, // non-blocking — orchestrator continues without elements
          elements: [],
          detection_failed: true,
          error: `AI detection unavailable: ${geminiResponse.status}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const geminiData = await geminiResponse.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    // Robustly extract the JSON object even if the model adds ```json fences,
    // preamble ("Here is the analysis:"), or trailing notes — slice from the
    // first { to the last }. A naive JSON.parse on the raw text was the #1 cause
    // of "AI response parse error" → detection_failed → no PNG layers.
    let cleanJson = rawText.replace(/```json\s*|```\s*/g, '').trim()
    const firstBrace = cleanJson.indexOf('{')
    const lastBrace = cleanJson.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.slice(firstBrace, lastBrace + 1)
    }

    let detectionResult: any
    try {
      detectionResult = JSON.parse(cleanJson)
    } catch (parseErr) {
      console.error('Failed to parse element detection:', rawText.slice(0, 500))
      return new Response(
        JSON.stringify({
          success: true,
          elements: [],
          detection_failed: true,
          error: 'AI response parse error'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 3: Convert detected elements to our format
    const elements: ExtractedElement[] = (detectionResult.elements || []).map((el: any, idx: number) => ({
      id: `${el.type}-${idx + 1}`,
      type: el.type,
      label: el.label,
      content: el.content || null,
      bounding_box: {
        x: el.bounding_box?.x_percent || 0,
        y: el.bounding_box?.y_percent || 0,
        width: el.bounding_box?.width_percent || 0,
        height: el.bounding_box?.height_percent || 0,
      },
      dimensions_inches: el.estimated_size_inches ? {
        width: el.estimated_size_inches.width,
        height: el.estimated_size_inches.height,
      } : undefined,
      confidence: el.confidence || 0.5,
      // preview_url and cut_contour_url will be populated when customer purchases Cut Contour Pack
    }))

    // Step 4: Store element data on the job for the ProductionFlow page to display
    if (job_id) {
      await supabase
        .from('panelizer_jobs')
        .update({ extracted_elements: elements })
        .eq('id', job_id)
    }

    return new Response(
      JSON.stringify({
        success: true,
        elements,
        total_found: elements.length,
        summary: detectionResult.extraction_summary || `Found ${elements.length} extractable elements`,
        by_type: {
          logos: elements.filter(e => e.type === 'logo').length,
          text: elements.filter(e => e.type === 'text').length,
          phones: elements.filter(e => e.type === 'phone').length,
          urls: elements.filter(e => e.type === 'url').length,
          graphics: elements.filter(e => e.type === 'graphic').length,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Element extraction error:', err)
    return new Response(
      JSON.stringify({
        success: true, // non-blocking
        elements: [],
        detection_failed: true,
        error: String(err)
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
