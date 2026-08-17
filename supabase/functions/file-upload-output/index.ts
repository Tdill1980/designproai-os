// ============================================================
// FILE-UPLOAD-OUTPUT — Universal File Intake + Output Service
//
// Accepts ANY customer file (PNG, JPG, TIFF, PDF, SVG, AI, EPS),
// stores it, analyzes format/resolution/color space, and returns
// production-ready metadata. This is the entry point for every
// RIP station workflow — RestylePro files or walk-in customer files.
//
// Revenue: Standalone service. Token-gated per file processed.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'wrap-files'

// Supported file types and their MIME mappings
const FILE_TYPES: Record<string, { category: string; printReady: boolean; vectorCapable: boolean }> = {
  'image/png':       { category: 'raster', printReady: true,  vectorCapable: false },
  'image/jpeg':      { category: 'raster', printReady: true,  vectorCapable: false },
  'image/tiff':      { category: 'raster', printReady: true,  vectorCapable: false },
  'image/svg+xml':   { category: 'vector', printReady: false, vectorCapable: true },
  'application/pdf': { category: 'mixed',  printReady: true,  vectorCapable: true },
  'application/postscript': { category: 'vector', printReady: true, vectorCapable: true }, // AI/EPS
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const { user_id, file_url, file_name, action, options } = body

    if (!user_id || !file_url) {
      return fail('user_id and file_url required')
    }

    const startMs = Date.now()

    // ── STEP 1: Fetch the file ─────────────────────────────────
    const fileResp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/ProductionFlow' } })
    if (!fileResp.ok) return fail(`Cannot fetch file: ${fileResp.status}`)

    const fileBytes = new Uint8Array(await fileResp.arrayBuffer())
    const contentType = fileResp.headers.get('content-type') || detectMimeFromName(file_name || '')
    const fileSizeKB = Math.round(fileBytes.byteLength / 1024)

    console.log(`[FILE-UPLOAD] User ${user_id}: ${file_name} (${fileSizeKB} KB, ${contentType})`)

    // ── STEP 2: Store in production workspace ──────────────────
    const timestamp = Date.now()
    const ext = (file_name || 'file').split('.').pop() || 'png'
    const storagePath = `file-services/${user_id}/${timestamp}/original.${ext}`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, fileBytes, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    })
    if (upErr) return fail(`Storage upload failed: ${upErr.message}`)

    // Get signed URL for downstream services
    const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600)
    const signedUrl = signedData?.signedUrl || ''

    // ── STEP 3: Analyze file properties ────────────────────────
    const typeInfo = FILE_TYPES[contentType || ''] || { category: 'unknown', printReady: false, vectorCapable: false }

    // Detect image dimensions for raster files
    let width = 0, height = 0, estimatedDPI = 0
    if (typeInfo.category === 'raster' && (contentType === 'image/png' || contentType === 'image/jpeg')) {
      const dims = detectImageDimensions(fileBytes, contentType)
      width = dims.width
      height = dims.height
      // Estimate DPI assuming 60" wide print (standard wrap width)
      if (width > 0) {
        estimatedDPI = Math.round(width / 60)
      }
    }

    // Color space detection (basic — checks for CMYK markers in JPEG)
    const colorSpace = detectColorSpace(fileBytes, contentType || '')

    // Transparency detection (PNG alpha channel)
    const hasTransparency = contentType === 'image/png' && detectPNGTransparency(fileBytes)

    const fileAnalysis = {
      file_name: file_name || 'unknown',
      file_type: typeInfo.category,
      mime_type: contentType,
      file_size_kb: fileSizeKB,
      width_px: width,
      height_px: height,
      estimated_dpi: estimatedDPI,
      color_space: colorSpace,
      has_transparency: hasTransparency,
      vector_capable: typeInfo.vectorCapable,
      print_ready: typeInfo.printReady,
      storage_path: storagePath,
    }

    // ── STEP 4: Production readiness assessment ────────────────
    const issues: Array<{ issue: string; severity: string; fixable: boolean; service: string }> = []

    if (estimatedDPI > 0 && estimatedDPI < 100) {
      issues.push({
        issue: `Low resolution (${estimatedDPI} DPI estimated). Minimum 150 DPI recommended for wraps.`,
        severity: 'critical',
        fixable: true,
        service: 'file-revitalizer',
      })
    }

    if (colorSpace === 'RGB' && typeInfo.printReady) {
      issues.push({
        issue: 'File is RGB. CMYK conversion recommended for accurate print color.',
        severity: 'warning',
        fixable: true,
        service: 'quick-prep-color-sep',
      })
    }

    if (!typeInfo.vectorCapable && typeInfo.category === 'raster') {
      issues.push({
        issue: 'Raster file — no cut path available. Vector conversion needed for contour cutting.',
        severity: 'info',
        fixable: true,
        service: 'vectorize-it',
      })
    }

    if (typeInfo.category === 'raster' && !hasTransparency) {
      issues.push({
        issue: 'No transparency detected. Background removal recommended for contour cut.',
        severity: 'info',
        fixable: true,
        service: 'quick-prep-bg-remove',
      })
    }

    // ── STEP 5: Recommend services ─────────────────────────────
    const recommendedServices: Array<{ service: string; label: string; reason: string; tokens: number }> = []

    if (estimatedDPI > 0 && estimatedDPI < 150) {
      recommendedServices.push({
        service: 'file-revitalizer',
        label: 'FileRevitalizer',
        reason: 'Upscale to print-ready resolution',
        tokens: 3,
      })
    }

    if (!typeInfo.vectorCapable) {
      recommendedServices.push({
        service: 'vectorize-it',
        label: 'VectorizeIt',
        reason: 'Convert to vector for clean cut paths',
        tokens: 4,
      })
    }

    recommendedServices.push({
      service: 'cut-map',
      label: 'CutMap',
      reason: 'Generate print & cut contour lines',
      tokens: 3,
    })

    // ── STEP 6: Output format options ──────────────────────────
    const outputFormats = [
      { id: 'production_pdf', label: 'Production PDF (CMYK + CutContour)', tokens: 2 },
      { id: 'print_png', label: 'Print-Ready PNG (300 DPI)', tokens: 1 },
      { id: 'svg_cutfile', label: 'SVG Cut File', tokens: 2 },
      { id: 'tiff_cmyk', label: 'TIFF CMYK (Separated)', tokens: 2 },
    ]

    // ── RESPONSE ───────────────────────────────────────────────
    const processingMs = Date.now() - startMs

    return ok({
      file_id: `file-${timestamp}`,
      file_analysis: fileAnalysis,
      production_readiness: {
        score: issues.filter(i => i.severity === 'critical').length === 0 ? 'good' : 'needs_work',
        issues,
        issues_count: issues.length,
        critical_count: issues.filter(i => i.severity === 'critical').length,
      },
      recommended_services: recommendedServices,
      output_formats: outputFormats,
      file_url: signedUrl,
      storage_path: storagePath,
      processing_ms: processingMs,
      rip_station: {
        compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
        note: 'File analyzed for RIP compatibility. Run recommended services for full production readiness.',
      },
    })
  } catch (err) {
    console.error('[FILE-UPLOAD] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: `File upload failed: ${String(err)}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ── Helpers ──────────────────────────────────────────────────

function detectMimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
    pdf: 'application/pdf', ai: 'application/postscript', eps: 'application/postscript',
  }
  return map[ext] || 'application/octet-stream'
}

function detectImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  try {
    if (mime === 'image/png' && bytes.length > 24) {
      // PNG IHDR chunk: width at bytes 16-19, height at bytes 20-23 (big-endian)
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
      return { width, height }
    }
    if (mime === 'image/jpeg') {
      // Scan for SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
      for (let i = 0; i < bytes.length - 9; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
          const height = (bytes[i + 5] << 8) | bytes[i + 6]
          const width = (bytes[i + 7] << 8) | bytes[i + 8]
          return { width, height }
        }
      }
    }
  } catch (_) { /* fallthrough */ }
  return { width: 0, height: 0 }
}

function detectColorSpace(bytes: Uint8Array, mime: string): string {
  if (mime === 'image/jpeg') {
    // Check for Adobe CMYK marker
    for (let i = 0; i < Math.min(bytes.length - 12, 65536); i++) {
      if (bytes[i] === 0x41 && bytes[i+1] === 0x64 && bytes[i+2] === 0x6F &&
          bytes[i+3] === 0x62 && bytes[i+4] === 0x65) {
        // "Adobe" marker found — check color transform byte
        if (i + 11 < bytes.length && bytes[i + 11] === 2) return 'CMYK'
      }
    }
    return 'RGB'
  }
  if (mime === 'image/png') return 'RGB'
  if (mime === 'image/svg+xml') return 'RGB'
  if (mime === 'application/pdf') return 'mixed' // PDFs can have both
  return 'unknown'
}

function detectPNGTransparency(bytes: Uint8Array): boolean {
  // PNG color type at byte 25: 4 = greyscale+alpha, 6 = RGBA
  if (bytes.length > 25) {
    return bytes[25] === 4 || bytes[25] === 6
  }
  return false
}

function ok(d: any) {
  return new Response(JSON.stringify({ success: true, ...d }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(m: string) {
  return new Response(JSON.stringify({ success: false, error: m }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
