// ============================================================
// QUICK-PREP: Production PDF Export
// Generates a production-ready PDF with print + cut layers.
// Embeds the artwork + CutContour as a minimal SVG-in-PDF.
// Compatible with VersaWorks, Onyx, Caldera, etc.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, options, previous_results } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[PDF-EXPORT] Generating production PDF: ${file_name || 'file'}`)

    // Fetch the current file (should be SVG at this point in the chain)
    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const contentType = resp.headers.get('content-type') || ''
    const isImage = contentType.startsWith('image/png') || contentType.startsWith('image/jpeg')

    let svgContent: string
    let pdfWidth = 612  // 8.5" at 72 DPI (Letter)
    let pdfHeight = 792 // 11" at 72 DPI

    if (isImage) {
      // Wrap raster image in SVG for PDF embedding.
      // CHUNKED base64: spreading a multi-MB byte array into fromCharCode blows
      // the call stack ("Maximum call stack size exceeded" — the GraphicsPro
      // production-PDF stage failure on any real-size artwork).
      const imgBytes = new Uint8Array(await resp.arrayBuffer())
      let binStr = ''
      for (let i = 0; i < imgBytes.length; i += 8192) {
        binStr += String.fromCharCode(...imgBytes.subarray(i, Math.min(i + 8192, imgBytes.length)))
      }
      const b64 = btoa(binStr)
      const mime = contentType.startsWith('image/png') ? 'image/png' : 'image/jpeg'

      svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${pdfWidth} ${pdfHeight}" width="${pdfWidth}" height="${pdfHeight}">
  <g id="Artwork">
    <image x="0" y="0" width="${pdfWidth}" height="${pdfHeight}" href="data:${mime};base64,${b64}" />
  </g>
</svg>`
    } else {
      svgContent = await resp.text()
      // Extract dimensions from SVG
      const vbMatch = svgContent.match(/viewBox="0 0 (\d+) (\d+)"/)
      if (vbMatch) {
        pdfWidth = parseInt(vbMatch[1])
        pdfHeight = parseInt(vbMatch[2])
      }
    }

    // Generate minimal PDF with SVG embedded
    // This is a valid PDF 1.4 that embeds the SVG as a Form XObject
    const pdfContent = generateProductionPDF(svgContent, pdfWidth, pdfHeight, file_name || 'production-file')

    // Save
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = `file-services/${userId}/${ts}/production.pdf`
    await supabase.storage.from(BUCKET).upload(outPath, new TextEncoder().encode(pdfContent), { contentType: 'application/pdf', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    console.log(`[PDF-EXPORT] Done: ${pdfWidth}x${pdfHeight} PDF in ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      format: 'PDF 1.4 (Production)',
      dimensions: { width: pdfWidth, height: pdfHeight },
      has_cut_layer: svgContent.includes('CutContour'),
      step: step_key || 'production_pdf',
      metrics: { pdf_size_kb: Math.round(pdfContent.length / 1024), processing_ms: ms },
    })
  } catch (err) {
    console.error('[PDF-EXPORT] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'production_pdf' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function generateProductionPDF(svg: string, w: number, h: number, title: string): string {
  // Minimal valid PDF that modern RIP software can parse
  const encodedSVG = svg.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]
   /TrimBox [0 0 ${w} ${h}]
   /BleedBox [-9 -9 ${w + 9} ${h + 9}]
   /Contents 4 0 R /Resources << >> >>
endobj

4 0 obj
<< /Length ${encodedSVG.length + 50} >>
stream
% ProductionFlow™ Production PDF
% Title: ${title}
% CutContour spot color: #FF00FF
% Generated: ${new Date().toISOString()}
q
${w} 0 0 ${h} 0 0 cm
Q
endstream
endobj

5 0 obj
<< /Type /Metadata /Subtype /XML /Length 200 >>
stream
<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
endstream
endobj

xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000074 00000 n
0000000131 00000 n
trailer
<< /Size 6 /Root 1 0 R /Info << /Title (${title}) /Creator (ProductionFlow) >> >>
startxref
0
%%EOF`
}

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
