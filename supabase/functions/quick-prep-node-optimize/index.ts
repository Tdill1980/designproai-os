// ============================================================
// QUICK-PREP: Node Optimization
// Reduces node count in SVG paths for cleaner cut output.
// Fewer nodes = smoother cut, faster RIP processing.
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
    const { user_id, file_url, file_name, step_key, action_id, options } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    const tolerance = (options?.tolerance as number) || 2.0 // Ramer-Douglas-Peucker tolerance
    console.log(`[NODE-OPTIMIZE] Processing: ${file_name || 'file'} | tolerance: ${tolerance}`)

    // Fetch SVG content
    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const svgContent = await resp.text()

    // Extract path data and simplify
    const pathMatch = svgContent.match(/d="([^"]+)"/g) || []
    let originalNodes = 0
    let optimizedNodes = 0

    let optimizedSVG = svgContent
    for (const match of pathMatch) {
      const pathData = match.slice(3, -1) // Remove d=" and "
      const points = parsePathPoints(pathData)
      originalNodes += points.length

      const simplified = rdpSimplify(points, tolerance)
      optimizedNodes += simplified.length

      let newPathData = ''
      if (simplified.length > 0) {
        newPathData = `M ${simplified[0].x} ${simplified[0].y}`
        for (let i = 1; i < simplified.length; i++) {
          newPathData += ` L ${simplified[i].x} ${simplified[i].y}`
        }
        if (pathData.endsWith('Z') || pathData.endsWith('z')) newPathData += ' Z'
      }

      optimizedSVG = optimizedSVG.replace(match, `d="${newPathData}"`)
    }

    // Save
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = `file-services/${userId}/${ts}/node-optimized.svg`
    await supabase.storage.from(BUCKET).upload(outPath, new TextEncoder().encode(optimizedSVG), { contentType: 'image/svg+xml', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    const reduction = originalNodes > 0 ? ((1 - optimizedNodes / originalNodes) * 100).toFixed(1) : '0'
    console.log(`[NODE-OPTIMIZE] Done: ${originalNodes} → ${optimizedNodes} nodes (${reduction}% reduction) in ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      original_nodes: originalNodes,
      optimized_nodes: optimizedNodes,
      reduction_percent: `${reduction}%`,
      step: step_key || 'node_cleanup',
      metrics: { original_nodes: originalNodes, optimized_nodes: optimizedNodes, processing_ms: ms },
    })
  } catch (err) {
    console.error('[NODE-OPTIMIZE] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'node_cleanup' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function parsePathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  const commands = d.match(/[MLZ]\s*[\d.\s,-]+/gi) || []
  for (const cmd of commands) {
    const nums = cmd.match(/-?\d+\.?\d*/g)
    if (nums && nums.length >= 2) {
      for (let i = 0; i < nums.length - 1; i += 2) {
        points.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) })
      }
    }
  }
  return points
}

function rdpSimplify(points: Array<{ x: number; y: number }>, tolerance: number): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0

  const start = points[0]
  const end = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpDist(points[i], start, end)
    if (dist > maxDist) { maxDist = dist; maxIdx = i }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance)
    const right = rdpSimplify(points.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [start, end]
}

function perpDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
