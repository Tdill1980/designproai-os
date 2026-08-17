// ============================================================
// PRODUCTIONFLOW™ CUSTOMER INPUT HANDLER
// Edge Function: productionflow-customer-input
// Handles: QA fix decisions, upsell purchases, pipeline resume
// Called by: ProductionFlow frontend when customer interacts
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Auth check — get user from JWT
  const authHeader = req.headers.get('Authorization')
  const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader! } }
  })
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { job_id, action, data } = await req.json()

    if (!job_id || !action) {
      return new Response(
        JSON.stringify({ error: 'job_id and action required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify job belongs to this user
    const { data: job, error: jobError } = await supabase
      .from('panelizer_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('user_id', user.id)
      .single()

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: 'Job not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {

      // ── QA FIX DECISION ──────────────────────────────────
      case 'qa_response': {
        // data: { issue_id: string, selected: 'auto_fix' | 'keep_as_is' }
        if (!data?.issue_id || !data?.selected) {
          return errorResponse('issue_id and selected required')
        }

        // Update the customer_inputs array
        const updatedInputs = (job.customer_inputs || []).map((input: any) => {
          if (input.issue_id === data.issue_id) {
            return {
              ...input,
              selected: data.selected,
              answered_at: new Date().toISOString(),
            }
          }
          return input
        })

        await supabase
          .from('panelizer_jobs')
          .update({ customer_inputs: updatedInputs })
          .eq('id', job_id)

        await logEvent(supabase, job_id, 'input_received', 'awaiting_input', {
          issue_id: data.issue_id,
          selected: data.selected,
        })

        // Check if ALL questions are now answered
        const allAnswered = updatedInputs.every((input: any) => input.answered_at)

        if (allAnswered) {
          // Calculate total fix cost
          const fixCost = updatedInputs
            .filter((i: any) => i.selected === 'auto_fix')
            .reduce((sum: number, i: any) => sum + (i.cost || 0), 0)

          // If fixes have a cost, we'd trigger a micro-payment here
          // For now, auto-approve small fixes (under $20)
          if (fixCost > 0 && fixCost <= 20) {
            // Auto-approve small fixes — add to upsell_revenue
            await supabase
              .from('panelizer_jobs')
              .update({ upsell_revenue: (job.upsell_revenue || 0) + fixCost })
              .eq('id', job_id)
          }

          // Resume the pipeline!
          const pipelineResponse = await fetch(`${supabaseUrl}/functions/v1/run-production-flow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              job_id,
              trigger: 'input_received',
            }),
          })

          const pipelineResult = await pipelineResponse.json()

          return successResponse({
            action: 'qa_response',
            all_answered: true,
            pipeline_resumed: true,
            fix_cost: fixCost,
            pipeline_status: pipelineResult.status,
          })
        }

        // Not all answered yet — tell the frontend how many remain
        const remaining = updatedInputs.filter((i: any) => !i.answered_at).length
        return successResponse({
          action: 'qa_response',
          all_answered: false,
          remaining_questions: remaining,
        })
      }

      // ── UPSELL PURCHASE ──────────────────────────────────
      case 'purchase_upsell': {
        // data: { upsell_type: string, stripe_session_id?: string }
        if (!data?.upsell_type) {
          return errorResponse('upsell_type required')
        }

        const offered = (job.upsells_offered || []).find((u: any) => u.type === data.upsell_type)
        if (!offered) {
          return errorResponse('Upsell not found in offers')
        }

        // Mark as purchased
        const updatedPurchased = [...(job.upsells_purchased || []), {
          ...offered,
          purchased: true,
          purchased_at: new Date().toISOString(),
          stripe_session_id: data.stripe_session_id || null,
        }]

        const totalUpsellRevenue = updatedPurchased.reduce((sum: number, u: any) => sum + (u.price || 0), 0)

        await supabase
          .from('panelizer_jobs')
          .update({
            upsells_purchased: updatedPurchased,
            upsell_revenue: totalUpsellRevenue,
          })
          .eq('id', job_id)

        await logEvent(supabase, job_id, 'upsell_purchased', null, {
          type: data.upsell_type,
          price: offered.price,
        })

        // TODO: Trigger the specific upsell fulfillment pipeline
        // e.g., if upsell_type === 'cut_contour_pack', run the contour extraction
        // if upsell_type === 'window_perf', generate matching window perf design

        return successResponse({
          action: 'purchase_upsell',
          upsell: data.upsell_type,
          price: offered.price,
          total_upsell_revenue: totalUpsellRevenue,
          message: `${offered.label} purchased! Processing will begin shortly.`,
        })
      }

      // ── GET JOB STATUS (polling fallback) ────────────────
      case 'get_status': {
        return successResponse({
          action: 'get_status',
          job_id: job.id,
          order_number: job.order_number,
          status: job.status,
          current_stage: job.current_stage,
          panels: job.panels,
          qa_results: job.qa_results,
          qa_requires_input: job.qa_requires_input,
          customer_inputs: job.customer_inputs,
          extracted_elements: job.extracted_elements,
          upsells_offered: job.upsells_offered,
          upsells_purchased: job.upsells_purchased,
          zip_signed_url: job.zip_signed_url,
          processing_time_ms: job.processing_time_ms,
        })
      }

      default:
        return errorResponse(`Unknown action: ${action}`)
    }

  } catch (err) {
    console.error('Customer input error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── HELPERS ───────────────────────────────────────────────────

async function logEvent(supabase: any, jobId: string, eventType: string, stage: string | null, data: any) {
  await supabase
    .from('panelizer_job_events')
    .insert({ job_id: jobId, event_type: eventType, stage, data })
}

function successResponse(data: any) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
  )
}

function errorResponse(message: string) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status: 400, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
  )
}
