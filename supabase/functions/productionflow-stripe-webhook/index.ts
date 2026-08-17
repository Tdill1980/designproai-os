// ============================================================
// PRODUCTIONFLOW™ STRIPE WEBHOOK
// Edge Function: productionflow-stripe-webhook
// Catches Stripe payment events → creates panelizer_job → triggers pipeline
// Deploy: supabase functions deploy productionflow-stripe-webhook
// Set secret: supabase secrets set STRIPE_PRODUCTIONFLOW_WEBHOOK_SECRET=whsec_xxx
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import Stripe from 'https://esm.sh/stripe@14.14.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
  const webhookSecret = Deno.env.get('STRIPE_PRODUCTIONFLOW_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // Verify Stripe signature
    const body = await req.text()
    const sig = req.headers.get('stripe-signature')

    let event: Stripe.Event
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
    } else {
      // Dev mode — parse without verification
      event = JSON.parse(body)
    }

    // Only handle successful payments for production packs
    if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Extract metadata from the Stripe event
    let metadata: any = {}
    let userId: string = ''
    let amount: number = 0

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      metadata = session.metadata || {}
      userId = metadata.user_id || ''
      amount = (session.amount_total || 0) / 100
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent
      metadata = intent.metadata || {}
      userId = metadata.user_id || ''
      amount = (intent.amount || 0) / 100
    }

    // Verify this is a production-related purchase
    const validProductTypes = ['production_pack', 'productionflow', 'logo_pack', 'cut_contour_pack'];
    if (!validProductTypes.includes(metadata.product_type)) {
      return new Response(JSON.stringify({ received: true, skipped: true, reason: 'not_production_type' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const isLogoPack = metadata.product_type === 'logo_pack' || metadata.product_type === 'cut_contour_pack';

    // Required metadata from the checkout
    const generationId = metadata.generation_id
    const approvedRenderUrl = metadata.approved_render_url
    const vehicleYear = metadata.vehicle_year ? parseInt(metadata.vehicle_year) : null
    const vehicleMake = metadata.vehicle_make || null
    const vehicleModel = metadata.vehicle_model || null
    const vehicleTrim = metadata.vehicle_trim || null

    if (!generationId || !userId) {
      console.error('Missing required metadata:', { generationId, userId, metadata })
      return new Response(
        JSON.stringify({ error: 'Missing generation_id or user_id in Stripe metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch the generation record for full context
    const { data: generation } = await supabase
      .from('designiq_generations')
      .select('*')
      .eq('id', generationId)
      .single()

    // ── Resolve the customer's WooCommerce order number for this design ──
    // The design's approval carries it (proof_approvals.source_visualization_id
    // → metadata.wpw_order_number) — the SAME join RevisionStudio's badge and
    // Studio Board's order search use. When found, the panelizer job is keyed
    // by the Woo order number instead of minting a fresh RP-XXXXXX (the
    // panelizer_auto_order_number trigger only fires when order_number is NULL).
    let wooOrderNumber: string | null = null
    try {
      const { data: proofRows } = await supabase
        .from('proof_approvals')
        .select('metadata')
        .eq('source_visualization_id', generationId)
        .order('created_at', { ascending: false })
        .limit(1)
      const md: any = proofRows?.[0]?.metadata || {}
      const on = md.wpw_order_number || md.woo_order_number || md.wpw_woo_order_id
      if (on) wooOrderNumber = String(on)
    } catch (e) {
      console.warn('Woo order-number resolve failed (non-fatal):', e)
    }

    // Create the panelizer job
    const { data: job, error: jobError } = await supabase
      .from('panelizer_jobs')
      .insert({
        user_id: userId,
        generation_id: generationId,
        ...(wooOrderNumber ? { order_number: wooOrderNumber } : {}),
        approved_render_url: approvedRenderUrl || generation?.hero_image_url || generation?.image_url,
        all_view_urls: generation?.all_view_urls || [],
        concept_json: {
          ...(generation?.concept_json || generation?.design_config || {}),
          // Carry the 2D production proof onto the PAID job so the proven
          // qc-generate-flat-artboard generator (used by both orchestration and
          // the manual QC fallback for past/failed jobs) has its source. Without
          // this a $299 paid job had no flat_proof_url and the artboard tools
          // reported "no 2D proof on job."
          ...((generation as any)?.flat_proof_url ? { flat_proof_url: (generation as any).flat_proof_url } : {}),
          ...(isLogoPack ? { type: 'logo_pack' } : {}),
        },
        vehicle_year: vehicleYear || generation?.vehicle_year,
        vehicle_make: vehicleMake || generation?.vehicle_make,
        vehicle_model: vehicleModel || generation?.vehicle_model,
        vehicle_trim: vehicleTrim || generation?.vehicle_trim,
        job_type: isLogoPack ? 'logo_pack' : 'production_pack',
        status: isLogoPack ? 'ready' : 'queued',
        started_at: new Date().toISOString(),
        ...(isLogoPack ? { completed_at: new Date().toISOString() } : {}),
      })
      .select()
      .single()

    if (jobError) {
      console.error('Failed to create panelizer job:', jobError)
      return new Response(
        JSON.stringify({ error: 'Failed to create job', details: jobError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`ProductionFlow job created: ${job.id} (${job.order_number})`)

    // ── Flip the design to the order number ──
    // Stamp the job's order number into the design row's admin_notes JSON
    // (same convention wpw-proof-link uses) so order-number search and the
    // RevisionStudio badge resolve it without a proof_approvals hop. The
    // generation id is either the color_visualizations id itself or a
    // designiq_generations id back-linked via admin_notes.designiq_generation_id.
    try {
      let { data: viz } = await supabase
        .from('color_visualizations')
        .select('id, admin_notes')
        .eq('id', generationId)
        .maybeSingle()
      if (!viz) {
        const { data: byLink } = await supabase
          .from('color_visualizations')
          .select('id, admin_notes')
          .ilike('admin_notes', `%designiq_generation_id%${generationId}%`)
          .order('created_at', { ascending: false })
          .limit(1)
        viz = byLink?.[0] || null
      }
      if (viz?.id && job.order_number) {
        let notes: Record<string, unknown> = {}
        try { notes = JSON.parse((viz as any).admin_notes || '{}') } catch { notes = {} }
        notes.wpw_order_number = String(job.order_number)
        notes.order_number = String(job.order_number)
        notes.panelizer_job_id = job.id
        await supabase
          .from('color_visualizations')
          .update({ admin_notes: JSON.stringify(notes) })
          .eq('id', viz.id)
        console.log(`Design ${viz.id} flipped to order ${job.order_number}`)
      }
    } catch (e) {
      console.warn('order-number stamp onto design failed (non-fatal):', e)
    }

    // ── Land the paid order in the Print Production Queue (AdminPrintProduction
    // reads print_production_requests). Without this, paid production-pack orders
    // never appear in the new ProductionFlow Admin. Carries the approved 2D proof
    // (true-source flat proof first, then the hero) + the design/job link so the
    // designer can review, attach panels, and ship to WrapBox. Non-fatal: a queue
    // hiccup must never fail the payment webhook. Skipped for logo packs (they
    // complete instantly, no production queue). */
    if (!isLogoPack) {
      try {
        const proofUrl =
          (generation as any)?.flat_proof_url ||
          approvedRenderUrl ||
          (generation as any)?.hero_render_url ||
          (generation as any)?.hero_image_url ||
          (generation as any)?.image_url ||
          null
        const stripeSessionId =
          event.type === 'checkout.session.completed' ? (event.data.object as any).id : null
        const { error: reqError } = await supabase
          .from('print_production_requests')
          .insert({
            user_id: userId,
            shop_id: (generation as any)?.shop_id ?? null,
            design_id: generationId,
            panelizer_job_id: job.id,
            order_number: job.order_number,
            customer_name: (generation as any)?.company_name ?? null,
            vehicle_year: String(vehicleYear || (generation as any)?.vehicle_year || ''),
            vehicle_make: vehicleMake || (generation as any)?.vehicle_make || '',
            vehicle_model: vehicleModel || (generation as any)?.vehicle_model || '',
            approved_proof_url: proofUrl,
            requested_output_type: 'full_wrap_panels',
            payment_status: 'paid',
            amount_cents: Math.round((amount || 299) * 100),
            stripe_session_id: stripeSessionId,
            production_status: 'paid_submitted',
          })
        if (reqError) {
          console.error('print_production_requests insert failed (non-fatal):', reqError.message)
        } else {
          console.log(`Print Production Queue row created for job ${job.order_number}`)
        }
      } catch (e) {
        console.error('print_production_requests insert threw (non-fatal):', e)
      }
    }

    // Also create/update the design_pack_purchases record if it exists
    await supabase
      .from('design_pack_purchases')
      .upsert({
        user_id: userId,
        generation_id: generationId,
        stripe_payment_intent: metadata.payment_intent || event.data.object.id,
        amount_paid: amount,
        production_status: 'processing',
        panelizer_job_id: job.id,
      }, {
        onConflict: 'generation_id,user_id',
        ignoreDuplicates: false,
      })

    // 🚀 TRIGGER THE PIPELINE (skip for logo packs — they complete instantly via generate-cut-files)
    let pipelineStatus = 'skipped';
    if (!isLogoPack) {
      const pipelineResponse = await fetch(`${supabaseUrl}/functions/v1/run-production-flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          job_id: job.id,
          trigger: 'payment_confirmed',
        }),
      })

      const pipelineResult = await pipelineResponse.json()
      pipelineStatus = pipelineResult.status || 'triggered';
      console.log(`Pipeline triggered for job ${job.order_number}:`, pipelineStatus)
    } else {
      console.log(`Logo pack job ${job.order_number} — no pipeline needed (instant completion)`)
    }

    return new Response(
      JSON.stringify({
        received: true,
        job_id: job.id,
        order_number: job.order_number,
        job_type: isLogoPack ? 'logo_pack' : 'production_pack',
        pipeline_status: pipelineStatus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Stripe webhook error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
