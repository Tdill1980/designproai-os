import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2024-06-20',
});

const PRICE_TO_TIER: Record<string, string> = {
  // Legacy prices
  "price_1SWJgDH1V6OhfCAPSCR5VbT2": "starter",
  "price_1SWNNuH1V6OhfCAPDChwyuAX": "advanced",
  "price_1SWO9QH1V6OhfCAPjqYLT7Ko": "complete",
  // Presale prices
  "price_1TEFVwH1V6OhfCAPeKAF34NH": "starter",
  "price_1TEFVxH1V6OhfCAPDdkZaoCP": "proshop",
  "price_1TEFVyH1V6OhfCAPiptL1RKW": "enterprise",
  // Live /pricing-page tiers (public + WPW partner price). Tier strings
  // match get_tier_limit (Starter 50, Lite 75, Studio 150, Plus 300).
  "price_1TTTzSH1V6OhfCAPGVZDZlZd": "starter",          // Starter $350
  "price_1TTTzhH1V6OhfCAP8VEk52tv": "starter",          // Starter WPW $300
  "price_1TTUyoH1V6OhfCAPaIf5OMDW": "designpro_lite",   // DesignPro Lite $499
  "price_1TTUyvH1V6OhfCAPddCu27xk": "designpro_lite",   // Lite WPW $449
  "price_1TEFVxH1V6OhfCAPPATuqoGZ": "designpro_studio", // DesignPro Studio $699 (was presale "professional")
  "price_1TTTzoH1V6OhfCAPqcDURY6T": "designpro_studio", // Studio WPW $649
  "price_1TTTzbH1V6OhfCAPkTef8yrl": "designpro_plus",   // DesignPro Plus $995
  "price_1TTTzuH1V6OhfCAP9zEqAlBh": "designpro_plus",   // Plus WPW $945
};

async function stableWebhookJobId(material: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalizeWebhookValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeWebhookValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeWebhookValue(item)]),
    );
  }
  return value;
}

function stabilizeWebhookInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilizeWebhookInput);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stabilizeWebhookInput(item)]),
    );
  }
  if (typeof value === "string") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return `${parsed.origin}${parsed.pathname}`;
      }
    } catch {
      // Non-URL production material remains byte-for-byte stable.
    }
  }
  return value;
}

async function canonicalWebhookSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalizeWebhookValue(value)),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret!
    );

    console.log('Webhook event received:', event.type);

    const supabase = createExternalClient();

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Get customer email
        const customer = await stripe.customers.retrieve(customerId);
        const rawEmail = (customer as Stripe.Customer).email;

        if (!rawEmail) {
          console.error('No email found for customer:', customerId);
          break;
        }
        const email = rawEmail.toLowerCase();

        // Resolve the auth user_id for this subscription.
        //
        // user_subscriptions.user_id is a NOT NULL uuid, so the previous
        // `subscription.metadata.user_id || ''` wrote an empty string and the
        // upsert was REJECTED by Postgres (invalid uuid) — silently leaving
        // every paying customer on the free tier. Stripe does NOT copy the
        // Checkout Session's metadata onto the subscription, so metadata.user_id
        // is almost always absent here. Resolve it defensively:
        //   1) subscription metadata (set by create-checkout going forward)
        //   2) the existing user_subscriptions row for this email (auth-trigger
        //      stamps the correct user_id on signup)
        //   3) the auth user that owns this email
        let resolvedUserId: string | null = subscription.metadata?.user_id || null;
        if (!resolvedUserId) {
          const { data: existingSub } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('email', email)
            .maybeSingle();
          resolvedUserId = (existingSub as any)?.user_id || null;
        }
        if (!resolvedUserId) {
          try {
            const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
            const match = list?.users?.find((u: any) => u.email?.toLowerCase() === email);
            resolvedUserId = match?.id || null;
          } catch (lookupErr) {
            console.error('Failed to look up auth user for', email, lookupErr);
          }
        }

        if (!resolvedUserId) {
          console.error(
            'Cannot record subscription — no user_id resolvable for email:',
            email,
            '(subscription:', subscription.id, ')',
          );
          break;
        }

        // Find the main price (not the metered one)
        const mainItem = subscription.items.data.find((item: any) => 
          Object.keys(PRICE_TO_TIER).includes(item.price.id)
        );
        
        // Find the metered item
        const meteredItem = subscription.items.data.find((item: any) =>
          item.price.id === "price_1SWNl3H1V6OhfCAPas1HJF05"
        );

        if (!mainItem) {
          console.error('No valid price found in subscription');
          break;
        }

        const tier = PRICE_TO_TIER[mainItem.price.id as keyof typeof PRICE_TO_TIER];
        const billingCycleStart = new Date(subscription.current_period_start * 1000);
        const billingCycleEnd = new Date(subscription.current_period_end * 1000);

        // Upsert subscription record
        const { error } = await supabase
          .from('user_subscriptions')
          .upsert({
            email,
            user_id: resolvedUserId,
            tier,
            status: subscription.status === 'active' ? 'active' : 'inactive',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_subscription_item_extra: meteredItem?.id || null,
            stripe_price_id: mainItem.price.id,
            billing_cycle_start: billingCycleStart.toISOString(),
            billing_cycle_end: billingCycleEnd.toISOString(),
            render_count: 0,
            render_reset_date: billingCycleStart.toISOString()
          }, {
            onConflict: 'email'
          });

        if (error) {
          console.error('Error upserting subscription:', error);
        } else {
          console.log('Subscription saved for:', email, 'Tier:', tier);
        }

        // ─── WPW Founder Invitation: grant 1 free design credit ───
        // The promise on /from/weprintwraps is "1 complimentary custom wrap
        // design". Stamps the credit onto user_subscriptions.alacarte_renders_remaining
        // (existing render-limit RPC will consume it before any monthly cap).
        // Idempotent: only fires once per Stripe subscription via the
        // founder_credit_granted_subscription_id metadata key.
        if (
          event.type === 'customer.subscription.created' &&
          subscription.metadata?.affiliate_code === 'WPW-FOUNDER'
        ) {
          try {
            const { data: subRow } = await supabase
              .from('user_subscriptions')
              .select('id, alacarte_renders_remaining, metadata')
              .eq('email', email)
              .maybeSingle();

            const alreadyGranted =
              (subRow as any)?.metadata?.founder_credit_granted_subscription_id ===
              subscription.id;

            if (subRow && !alreadyGranted) {
              const current = (subRow as any).alacarte_renders_remaining || 0;
              const prevMeta = (subRow as any).metadata || {};
              await supabase
                .from('user_subscriptions')
                .update({
                  alacarte_renders_remaining: current + 1,
                  metadata: {
                    ...prevMeta,
                    founder_credit_granted_subscription_id: subscription.id,
                    founder_credit_granted_at: new Date().toISOString(),
                  },
                  updated_at: new Date().toISOString(),
                } as any)
                .eq('id', (subRow as any).id);
              console.log('🎁 WPW Founder: granted 1 free design credit to', email);
            }
          } catch (grantErr) {
            console.error('Failed to grant WPW Founder credit:', grantErr);
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        
        // Get customer email
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email;
        
        if (!email) break;

        // Reset render count on successful payment
        const { error } = await supabase
          .from('user_subscriptions')
          .update({
            render_count: 0,
            render_reset_date: new Date().toISOString(),
            status: 'active'
          })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Error resetting render count:', error);
        } else {
          console.log('Render count reset for:', email);
        }

        // --- Affiliate Commission Tracking ---
        try {
          const subscriptionId = invoice.subscription as string;
          if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ['discount.coupon'],
            });
            // Prefer explicit metadata, but fall back to whichever coupon
            // the customer actually applied at checkout (or that's now
            // attached to the subscription / invoice). This makes
            // attribution work even if upstream code forgot to set the
            // metadata, as long as the affiliate's coupon was used.
            let affiliateCouponId = sub.metadata?.affiliate_coupon_id
              || (sub as any).discount?.coupon?.id
              || (invoice as any).discount?.coupon?.id
              || null;
            if (!affiliateCouponId && Array.isArray((invoice as any).discounts) && (invoice as any).discounts.length > 0) {
              const firstDiscount = (invoice as any).discounts[0];
              if (typeof firstDiscount === 'object' && firstDiscount?.coupon?.id) {
                affiliateCouponId = firstDiscount.coupon.id;
              }
            }

            if (affiliateCouponId) {
              // Look up the affiliate partner by coupon_id
              const { data: partner } = await supabase
                .from('affiliate_partners')
                .select('id, commission_rate, recurring_rate')
                .eq('coupon_id', affiliateCouponId)
                .in('status', ['approved', 'active'])
                .maybeSingle();

              if (partner) {
                const invoiceAmountCents = invoice.amount_paid || 0;
                const now = new Date();
                const payoutPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                // Determine if this is the first payment for this subscription
                const { count: existingCount } = await supabase
                  .from('affiliate_transactions')
                  .select('*', { count: 'exact', head: true })
                  .eq('stripe_subscription_id', subscriptionId);

                const isInitial = (existingCount || 0) === 0;

                // Initial signup pays commission_rate; renewals pay recurring_rate.
                // One-time partners (designers, legacy 10% deals) have
                // recurring_rate = 0, so they earn once on the first invoice and
                // nothing on renewals — preserving the single-payout policy for them.
                const initialRate = Number((partner as any).commission_rate) || 0;
                const recurringRate = Number((partner as any).recurring_rate) || 0;
                const rate = isInitial ? initialRate : recurringRate;

                if (!isInitial && recurringRate <= 0) {
                  console.log(`[affiliate] Skipping renewal invoice ${invoice.id} — one-time payout partner`);
                  break;
                }

                const commissionCents = Math.round(invoiceAmountCents * rate / 100);

                const { error: txError } = await supabase
                  .from('affiliate_transactions')
                  .insert({
                    partner_id: (partner as any).id,
                    coupon_id: affiliateCouponId,
                    customer_email: email,
                    stripe_invoice_id: invoice.id,
                    stripe_subscription_id: subscriptionId,
                    invoice_amount_cents: invoiceAmountCents,
                    commission_rate: rate,
                    commission_amount_cents: commissionCents,
                    is_initial_payment: isInitial,
                    payout_status: 'pending',
                    payout_period: payoutPeriod,
                  });

                if (txError) {
                  if (txError.code === '23505') {
                    console.log('Affiliate transaction already exists for invoice:', invoice.id);
                  } else {
                    console.error('Error inserting affiliate transaction:', txError);
                  }
                } else {
                  // Update partner stats atomically
                  await supabase.rpc('increment_affiliate_stats', {
                    p_partner_id: (partner as any).id,
                    p_commission_cents: commissionCents,
                    p_is_initial: isInitial,
                  });
                  console.log(`Affiliate commission recorded: $${(commissionCents / 100).toFixed(2)} for partner ${(partner as any).id}`);
                }
              }
            }
          }
        } catch (affErr) {
          // Non-fatal — don't break the webhook
          console.error('Affiliate commission tracking error (non-fatal):', affErr);
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        
        // Mark subscription as past_due
        const { error } = await supabase
          .from('user_subscriptions')
          .update({ status: 'past_due' })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Error updating subscription status:', error);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Mark subscription as canceled
        const { error } = await supabase
          .from('user_subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Error canceling subscription:', error);
        }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // ─── WPW pay-first subscription: provision account + magic link ───
        // create-wpw-sub-checkout stamps purchase_type='wpw_subscription'.
        // The tier itself is recorded by customer.subscription.created
        // (keyed by email). Here we just ensure the buyer has an account to
        // sign into and email them a magic link (mirrors the $25 guest flow).
        if (session.metadata?.purchase_type === 'wpw_subscription') {
          const buyerEmail = String(
            (session.customer_details as any)?.email || session.customer_email || '',
          ).trim().toLowerCase();
          if (!buyerEmail) {
            console.warn('[wpw_subscription] no email on session', session.id);
            break;
          }
          const tier = session.metadata?.wpw_tier || 'RestyleProAI';
          console.log('🪄 WPW subscription:', { buyerEmail, tier });

          // Find-or-create the auth user.
          let userId: string | null = null;
          const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
          const existing = list?.users?.find((u: any) => u.email?.toLowerCase() === buyerEmail);
          if (existing) {
            userId = existing.id;
          } else {
            const { data: created, error: createErr } = await supabase.auth.admin.createUser({
              email: buyerEmail,
              email_confirm: true,
              user_metadata: { source: 'wpw_subscription', wpw_tier: tier },
            });
            if (createErr || !created?.user) {
              console.error('[wpw_subscription] createUser failed:', createErr);
              break;
            }
            userId = created.user.id;
          }

          const origin = (Deno.env.get('PUBLIC_SITE_URL') || 'https://restyleproai.com').replace(/\/$/, '');
          const redirectTo = `${origin}/designpro?from=wpw_subscription`;
          const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: buyerEmail,
            options: { redirectTo },
          });
          const resendKey = Deno.env.get('RESEND_API_KEY');
          if (linkErr || !linkData?.properties?.action_link || !resendKey) {
            console.error('[wpw_subscription] link/email setup failed', { linkErr, hasKey: !!resendKey });
            break;
          }
          const actionLink = linkData.properties.action_link;
          const resend = new Resend(resendKey);
          const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="height:4px;border-radius:4px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:20px;"></div>
    <div style="font-size:11px;letter-spacing:2px;color:#64748b;text-transform:uppercase;margin-bottom:8px;">RestyleProAI</div>
    <h1 style="font-size:26px;font-weight:800;line-height:1.2;margin:0 0 16px;">Your ${tier} plan is active.</h1>
    <p style="font-size:15px;line-height:1.55;color:#334155;margin:0 0 24px;">Thanks for subscribing through WePrintWraps. Click below to sign in and start designing — your monthly render allotment is ready.</p>
    <p style="margin:0 0 24px;">
      <a href="${actionLink}" style="display:inline-block;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#fff;font-weight:700;padding:14px 24px;border-radius:8px;text-decoration:none;font-size:15px;">Sign in to RestyleProAI</a>
    </p>
    <p style="font-size:13px;color:#64748b;line-height:1.55;margin:0 0 8px;">Or paste this link into your browser:</p>
    <p style="font-size:12px;color:#94a3b8;word-break:break-all;margin:0;">${actionLink}</p>
  </div>
</body></html>`;
          const text = `Your RestyleProAI ${tier} plan is active.\n\nSign in and start designing:\n${actionLink}\n\n— RestylePro`;
          const emailRes = await resend.emails.send({
            from: 'RestylePro <noreply@restyleproai.com>',
            to: [buyerEmail],
            subject: `Your RestyleProAI ${tier} plan is active — sign in`,
            html,
            text,
          });
          if (emailRes.error) console.error('[wpw_subscription] Resend error:', emailRes.error);
          else console.log('[wpw_subscription] magic link emailed:', emailRes.data?.id);
          break;
        }

        // ─── Never Miss a Lead — auto-provision Twilio ───
        if (session.metadata?.purchase_type === 'never_miss_a_lead') {
          const meta = session.metadata;
          const tier = meta.tier === 'pro' ? 'pro' : 'basic';
          console.log('📞 NML purchase:', { tier, shopId: meta.shop_id, areaCode: meta.area_code });

          // Save forwarding phone to shop_profiles
          if (meta.forwarding_phone && meta.shop_id) {
            await supabase
              .from('shop_profiles')
              .update({ phone: meta.forwarding_phone })
              .eq('id', meta.shop_id);
          }

          // Fire provisioning (async — don't block Stripe webhook)
          const provisionUrl = `${getExternalSupabaseUrl()}/functions/v1/twilio-subaccount-provision`;
          fetch(provisionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getExternalServiceRoleKey()}`,
            },
            body: JSON.stringify({
              shopId: meta.shop_id,
              areaCode: meta.area_code || '',
              friendlyName: `NML-${meta.shop_id?.slice(0, 8)}`,
              forwardingPhone: meta.forwarding_phone || '',
              voiceAgentEnabled: tier === 'pro',
            }),
          }).then(async (res) => {
            const result = await res.json();
            if (res.ok && result.ok) {
              console.log('📞 NML provisioned:', result.phoneNumber);
            } else {
              console.error('📞 NML provision failed:', result);
            }
          }).catch((err) => console.error('📞 NML provision error:', err));

          break;
        }

        // ─── CreatorMarket marketplace purchase ───
        // creator-market-checkout stamps metadata.listing_id; design_pack flow uses design_id.
        if (session.metadata?.listing_id) {
          const meta = session.metadata;
          const listingId = meta.listing_id;
          const buyerEmail = meta.buyer_email || session.customer_email || '';
          const paymentIntentId = (session.payment_intent as string) || session.id;
          console.log('🛒 Marketplace purchase:', { listingId, buyerEmail, paymentIntentId });

          // Mark transaction paid (matched by stripe_payment_intent_id)
          const { data: txRows, error: txUpdateErr } = await supabase
            .from('marketplace_transactions')
            .update({
              status: 'paid',
              payout_status: 'transferred',
              stripe_charge_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
              payout_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntentId)
            .select('id, creator_id, creator_payout');

          if (txUpdateErr) {
            console.error('Failed to mark marketplace transaction paid:', txUpdateErr);
          }

          const transaction = (txRows || [])[0];

          // Stamp purchase_mode, buyer, and shipping address back onto
          // the listing row so the RP Design Team card can flag the
          // order as "+ Wrap Ship" and ProductionFlow has the address
          // it needs to ship the printed wrap. Stripe puts the
          // collected shipping address on session.shipping_details.
          try {
            const shippingDetails =
              (session as { shipping_details?: unknown }).shipping_details ?? null;
            const updates: Record<string, unknown> = {
              buyer_user_id: meta.buyer_user_id || null,
              sold_at: new Date().toISOString(),
              transaction_id: paymentIntentId,
              purchase_mode: meta.purchase_mode || 'design_only',
            };
            if (shippingDetails) {
              updates.shipping_address = shippingDetails;
            }
            await supabase
              .from('marketplace_listings')
              .update(updates)
              .eq('id', listingId);
          } catch (e) {
            console.warn('Marketplace post-purchase stamp failed:', (e as Error).message);
          }

          // Fetch listing + creator
          const { data: listing } = await supabase
            .from('marketplace_listings')
            .select('id, title, design_dna_id, creator_id, view_count, vehicle_year, vehicle_make, vehicle_model')
            .eq('id', listingId)
            .single();

          if (listing) {
            // Increment creator stats
            const creatorId = listing.creator_id || transaction?.creator_id;
            const payoutDollars = (transaction?.creator_payout || 0);
            if (creatorId) {
              const { data: creator } = await supabase
                .from('neuralnetwork_creator_profiles')
                .select('total_sales, total_earnings')
                .eq('id', creatorId)
                .single();
              if (creator) {
                await supabase
                  .from('neuralnetwork_creator_profiles')
                  .update({
                    total_sales: (creator.total_sales || 0) + 1,
                    total_earnings: (creator.total_earnings || 0) + payoutDollars,
                  })
                  .eq('id', creatorId);
              }
            }

            // Look up production pack URL + design linkage from the linked
            // design_dna_id (CreatorMarket stores production_pack.id in
            // design_dna_id when listing). visualization_id / generation_id are
            // the hop to the canonical DesignIQ generation the print pipeline
            // keys off (proof, artboards, Build-Assets vault).
            let downloadUrl: string | null = null;
            let pack: {
              pack_url?: string | null;
              visualization_id?: string | null;
              generation_id?: string | null;
              user_id?: string | null;
            } | null = null;
            if (listing.design_dna_id) {
              const { data: packRow } = await supabase
                .from('production_packs')
                .select('pack_url, visualization_id, generation_id, user_id')
                .eq('id', listing.design_dna_id)
                .maybeSingle();
              pack = (packRow as any) || null;
              downloadUrl = pack?.pack_url || null;
            }

            // ─── AUTO-CREATE A PRODUCTION JOB FOR THIS ORDER ───────────────
            // Wire CreatorMarket into the SAME DesignProAI file-output pipeline
            // every other paid pack uses (mirrors the print_production_pack
            // branch below): resolve the design's canonical DesignIQ generation
            // + its 2D proof, then open a panelizer_job keyed to that generation
            // with the BUYER's entered make/model. The job lands in
            // ProductionFlow + the Admin QC queue; the sanctioned per-side
            // build (enticePanelsFromProof, sized to the buyer's vehicle) is
            // kicked from the buyer's post-purchase return page and fires
            // activate-print-worker for the Railway hi-res files. Fully
            // isolated + non-fatal so it can never break the sale.
            try {
              const buyerUserId = meta.buyer_user_id || transaction?.buyer_user_id || null;
              // The generation id the pipeline keys off = the design's
              // color_visualizations id (activate-print-worker / the vault
              // resolve the canonical DesignIQ id from its admin_notes
              // back-link). Fall back to the pack's own generation_id.
              const genIdForJob = pack?.visualization_id || pack?.generation_id || null;

              // Idempotency: Stripe retries webhooks, so never queue a second
              // job for the same checkout session.
              let alreadyQueued = false;
              try {
                const { data: dupe } = await supabase
                  .from('panelizer_jobs')
                  .select('id')
                  .eq('customer_inputs->>stripe_session', session.id)
                  .limit(1)
                  .maybeSingle();
                alreadyQueued = !!(dupe as any)?.id;
              } catch { /* if the check fails, fall through — a rare dupe beats no job */ }

              if (alreadyQueued) {
                console.log('[creatormarket-job] job already queued for session', session.id, '— skipping');
              } else if (buyerUserId && genIdForJob) {
                // Resolve the design's SOURCE FLAT ARTBOARD (vehicle-agnostic
                // design sheet) + its views. The buyer gives their own
                // year/make/model, so this is a RecreatePro-class job: the flat
                // artboard is projected/sliced onto the BUYER's vehicle — never
                // a crop of the creator's on-vehicle proof. Lookup order matches
                // the client pipeline: designiq_generations.master_artboard_url
                // via the canonical back-link; flat_proof_url is a fallback
                // source only.
                let renderUrls: Record<string, string> | null = null;
                let flatProofUrl: string | null = null;
                let canonicalGid: string | null = null;
                try {
                  const { data: viz } = await supabase
                    .from('color_visualizations')
                    .select('render_urls, admin_notes')
                    .eq('id', genIdForJob)
                    .maybeSingle();
                  if (viz) {
                    const ru = (viz as any).render_urls;
                    if (ru && typeof ru === 'object') {
                      renderUrls = ru as Record<string, string>;
                      flatProofUrl = (ru.production_proof || ru.proof_2d || null) as string | null;
                    }
                    let notes: Record<string, any> = {};
                    try {
                      const rawNotes = (viz as any).admin_notes;
                      notes = typeof rawNotes === 'string' ? JSON.parse(rawNotes) : (rawNotes || {});
                    } catch { notes = {}; }
                    if (!flatProofUrl && typeof notes.flat_proof_url === 'string') flatProofUrl = notes.flat_proof_url;
                    if (notes.designiq_generation_id) canonicalGid = String(notes.designiq_generation_id);
                  }
                } catch (vizErr) {
                  console.warn('[creatormarket-job] viz lookup failed (non-fatal):', (vizErr as Error).message);
                }
                // Resolve the design's flat master artboard (branded + clean) +
                // proof fallback from the canonical DesignIQ generation.
                let masterArtboardUrl: string | null = null;
                let masterArtboardCleanUrl: string | null = null;
                if (canonicalGid) {
                  try {
                    const { data: gen } = await supabase
                      .from('designiq_generations')
                      .select('master_artboard_url, master_artboard_clean_url, flat_proof_url')
                      .eq('id', canonicalGid)
                      .maybeSingle();
                    if ((gen as any)?.master_artboard_url) masterArtboardUrl = String((gen as any).master_artboard_url);
                    if ((gen as any)?.master_artboard_clean_url) masterArtboardCleanUrl = String((gen as any).master_artboard_clean_url);
                    if (!flatProofUrl && (gen as any)?.flat_proof_url) flatProofUrl = String((gen as any).flat_proof_url);
                  } catch { /* no designiq row — build gates honestly downstream */ }
                }

                const primaryRenderUrl = renderUrls
                  ? (renderUrls.side || renderUrls['driver-side'] || Object.values(renderUrls)[0] || null)
                  : null;

                // Does the buyer's vehicle match the design's original vehicle?
                // Exact make+model match → the existing design already fits, so
                // the client reuses it (no recreate). Otherwise recreate/re-slice
                // onto the buyer's vehicle.
                const norm = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
                const sameVehicle = !!(meta.vehicle_make && meta.vehicle_model)
                  && norm(meta.vehicle_make) === norm((listing as any).vehicle_make)
                  && norm(meta.vehicle_model) === norm((listing as any).vehicle_model);

                const { error: cmJobErr } = await supabase
                  .from('panelizer_jobs')
                  .insert({
                    user_id: buyerUserId,
                    generation_id: genIdForJob,
                    approved_render_url: primaryRenderUrl,
                    all_view_urls: renderUrls,
                    // The BUYER's vehicle — production files are sized to this
                    // (GENIE resolves per-side dims from it), NOT the creator's.
                    vehicle_year: meta.vehicle_year ? parseInt(meta.vehicle_year, 10) || null : null,
                    vehicle_make: meta.vehicle_make || null,
                    vehicle_model: meta.vehicle_model || null,
                    job_type: 'production_pack',
                    status: 'queued',
                    started_at: new Date().toISOString(),
                    concept_json: {
                      source: 'creatormarket',
                      listing_id: listingId,
                      // RecreatePro-class linkage: the design's canonical id +
                      // its flat artboard, projected onto the buyer's vehicle.
                      source_designiq_id: canonicalGid,
                      source_visualization_id: genIdForJob,
                      recreate_needed: !sameVehicle,
                      original_vehicle: {
                        year: (listing as any).vehicle_year || null,
                        make: (listing as any).vehicle_make || null,
                        model: (listing as any).vehicle_model || null,
                      },
                      universal_size: meta.universal_size || null,
                      business_name: meta.business_name || null,
                      business_phone: meta.business_phone || null,
                      business_website: meta.business_website || null,
                      business_colors: meta.business_colors || null,
                      logo_url: meta.logo_url || null,
                      wants_vehicle_render: meta.wants_vehicle_render === 'true',
                      render_urls: renderUrls,
                      ...(masterArtboardUrl ? { source_artboard_url: masterArtboardUrl } : {}),
                      ...(masterArtboardCleanUrl ? { source_artboard_clean_url: masterArtboardCleanUrl } : {}),
                      ...(flatProofUrl ? { flat_proof_url: flatProofUrl } : {}),
                    },
                    customer_inputs: {
                      source: 'creatormarket_order',
                      buyer_email: buyerEmail,
                      stripe_session: session.id,
                      listing_id: listingId,
                    },
                  } as any);
                if (cmJobErr) {
                  console.error('[creatormarket-job] panelizer_jobs insert failed (non-fatal):', cmJobErr.message);
                } else {
                  console.log('[creatormarket-job] production job queued for listing', listingId, 'buyer', buyerUserId,
                    sameVehicle ? '(same vehicle — reuse)' : '(recreate on buyer vehicle)',
                    masterArtboardUrl ? '(artboard ready)' : '(no artboard — will gate)');
                }
              } else {
                console.log('[creatormarket-job] skipped job creation:', { buyerUserId: !!buyerUserId, genIdForJob: !!genIdForJob });
              }
            } catch (cmJobOuter) {
              console.error('[creatormarket-job] handler error (non-fatal):', cmJobOuter);
            }

            // Send delivery email (fire-and-forget — don't block webhook)
            if (buyerEmail) {
              fetch(`${getExternalSupabaseUrl()}/functions/v1/send-design-pack-email`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${getExternalServiceRoleKey()}`,
                },
                body: JSON.stringify({
                  email: buyerEmail,
                  designName: listing.title || 'CreatorMarket Design',
                  downloadUrl,
                  vehicle: `${meta.vehicle_year || ''} ${meta.vehicle_make || ''} ${meta.vehicle_model || ''}`.trim(),
                  selectedSize: meta.universal_size,
                }),
              }).catch((err) => console.error('Marketplace delivery email failed:', err));
            }

            // Update transaction with the delivery URL we resolved
            if (transaction?.id) {
              await supabase
                .from('marketplace_transactions')
                .update({
                  delivery_url: downloadUrl,
                  production_pack_delivered: !!downloadUrl,
                })
                .eq('id', transaction.id);
            }
          }

          break;
        }

        // ─── Token pack purchase ───
        // create-token-checkout stamps purchase_type='token_pack' with
        // a numeric `tokens` count + per-tier `unit_amount`. Credit the
        // user's user_tokens.balance via the add_user_tokens RPC. Falls
        // back to a direct upsert if the RPC misbehaves so a paid
        // customer never loses their grant to a DB blip.
        if (session.metadata?.purchase_type === 'token_pack') {
          const userId = session.metadata?.user_id;
          const userEmail = session.metadata?.user_email || session.customer_email || '';
          const tokens = Math.max(1, parseInt(session.metadata?.tokens || '0', 10) || 0);
          if (!userId || !tokens) {
            console.warn('[token_pack] missing user_id or tokens metadata', session.id);
            break;
          }
          console.log('🪙 Token pack purchase:', { userId, userEmail, tokens });

          let rpcOk = false;
          try {
            const { error: rpcErr } = await supabase.rpc('add_user_tokens', {
              p_user_id: userId,
              p_amount: tokens,
              p_reason: `token_pack_purchase:${session.id}`,
            });
            if (!rpcErr) rpcOk = true;
            else console.warn('[token_pack] RPC add_user_tokens failed:', rpcErr.message);
          } catch (e) {
            console.warn('[token_pack] RPC threw:', (e as Error).message);
          }

          if (!rpcOk) {
            // Fallback path — direct upsert + manual transaction row so
            // the tokens land and the audit log stays accurate even if
            // the RPC is missing on this environment.
            const { data: tokRow } = await supabase
              .from('user_tokens')
              .select('balance, total_purchased')
              .eq('user_id', userId)
              .maybeSingle();
            const prevBal = Number((tokRow as any)?.balance ?? 0);
            const prevPurchased = Number((tokRow as any)?.total_purchased ?? 0);
            const nextBal = prevBal + tokens;
            await supabase
              .from('user_tokens')
              .upsert({
                user_id: userId,
                balance: nextBal,
                total_purchased: prevPurchased + tokens,
                updated_at: new Date().toISOString(),
              } as any);
            await supabase.from('token_transactions').insert({
              user_id: userId,
              amount: tokens,
              reason: `token_pack_purchase:${session.id}`,
              balance_after: nextBal,
            } as any);
          }
          break;
        }

        // ─── Print production pack — CLEAN entitlement (proven pipeline) ───
        // create-print-pack-checkout stamps product_type='print_pack_entitlement'
        // + generation_id. Unlike the legacy print_production_pack flow, this
        // does NOT kick the old panelizer pipeline — it just marks the
        // generation PAID by upserting a production_packs row. The pack-gate on
        // upscale-panel-to-print then unlocks print-file export for every side.
        // Metered once per vehicle: idempotent per generation + webhook retry.
        if (session.metadata?.product_type === 'print_pack_entitlement') {
          const userId = session.metadata?.user_id || null;
          const generationId = String(session.metadata?.generation_id || '').trim();
          const amountCents = parseInt(session.metadata?.amount_cents || '29900', 10) || 29900;
          if (!generationId) {
            console.warn('[print_pack_entitlement] missing generation_id metadata', session.id);
            break;
          }
          console.log('📦 Print pack entitlement paid:', { userId, generationId, session: session.id });

          // Idempotency — a Stripe webhook can fire more than once. Only record
          // the entitlement if this generation isn't already marked paid via
          // this path (avoids duplicate rows on retries).
          const { data: already } = await supabase
            .from('production_packs')
            .select('id')
            .eq('generation_id', generationId)
            .eq('source', 'print_pack_entitlement')
            .in('payment_status', ['paid', 'included', 'comp', 'free'])
            .limit(1)
            .maybeSingle();
          if (already?.id) {
            console.log('[print_pack_entitlement] already recorded for', generationId);
            break;
          }

          const { error: packErr } = await supabase
            .from('production_packs')
            .insert({
              user_id: userId,
              generation_id: generationId,
              payment_status: 'paid',
              total_price_cents: amountCents,
              source: 'print_pack_entitlement',
              pipeline_version: 'buildassets',
            } as any);
          if (packErr) console.error('[print_pack_entitlement] production_packs insert failed:', packErr.message);
          else console.log('[print_pack_entitlement] generation marked paid:', generationId);

          // ── Flip the design's job to the customer's order number ──
          // Resolve the WooCommerce order number from the design's approval
          // (proof_approvals.source_visualization_id → metadata.wpw_order_number),
          // stamp it into color_visualizations.admin_notes, and retag any
          // auto-minted RP- panelizer job for this generation so Studio Board's
          // order search, RevisionStudio's badge, and ProductionFlow all key by
          // the SAME order number. Best-effort — never fails the webhook.
          try {
            let orderNo: string | null = null;
            const { data: proofRows } = await supabase
              .from('proof_approvals')
              .select('metadata')
              .eq('source_visualization_id', generationId)
              .order('created_at', { ascending: false })
              .limit(1);
            const md: any = proofRows?.[0]?.metadata || {};
            const on = md.wpw_order_number || md.woo_order_number || md.wpw_woo_order_id;
            if (on) orderNo = String(on);

            if (orderNo) {
              // Retag auto-minted RP- jobs only — never overwrite a real order #.
              await supabase
                .from('panelizer_jobs')
                .update({ order_number: orderNo })
                .eq('generation_id', generationId)
                .like('order_number', 'RP-%');

              let { data: viz } = await supabase
                .from('color_visualizations')
                .select('id, admin_notes')
                .eq('id', generationId)
                .maybeSingle();
              if (!viz) {
                const { data: byLink } = await supabase
                  .from('color_visualizations')
                  .select('id, admin_notes')
                  .ilike('admin_notes', `%designiq_generation_id%${generationId}%`)
                  .order('created_at', { ascending: false })
                  .limit(1);
                viz = (byLink as any)?.[0] || null;
              }
              if (viz?.id) {
                let notes: Record<string, unknown> = {};
                try { notes = JSON.parse((viz as any).admin_notes || '{}'); } catch { notes = {}; }
                notes.wpw_order_number = orderNo;
                notes.order_number = orderNo;
                await supabase
                  .from('color_visualizations')
                  .update({ admin_notes: JSON.stringify(notes) })
                  .eq('id', viz.id);
                console.log(`[print_pack_entitlement] design ${viz.id} flipped to order ${orderNo}`);
              }
            }
          } catch (e) {
            console.warn('[print_pack_entitlement] order-number flip failed (non-fatal):', e);
          }
          break;
        }

        // ─── À la carte render purchase (Phase 8) ───
        // create-alacarte-render-checkout stamps purchase_type='alacarte_render'
        // and a numeric quantity. Increment alacarte_renders_remaining on
        // user_subscriptions so the user can keep generating without
        // committing to a tier.
        if (session.metadata?.purchase_type === 'alacarte_render') {
          const userId = session.metadata?.user_id;
          const userEmail = session.metadata?.user_email || session.customer_email || '';
          const qty = Math.max(1, parseInt(session.metadata?.quantity || '1', 10) || 1);
          if (!userId) {
            console.warn('[alacarte_render] checkout completed with no user_id metadata', session.id);
            break;
          }
          console.log('🎟️  À la carte render purchase:', { userId, userEmail, qty });

          const { data: subRow } = await supabase
            .from('user_subscriptions')
            .select('id, alacarte_renders_remaining')
            .eq('user_id', userId)
            .maybeSingle();

          if (subRow) {
            const current = (subRow as any).alacarte_renders_remaining || 0;
            await supabase
              .from('user_subscriptions')
              .update({
                alacarte_renders_remaining: current + qty,
                updated_at: new Date().toISOString(),
              } as any)
              .eq('id', (subRow as any).id);
          } else {
            // No subscription row yet — create a free-tier shell with the
            // alacarte renders attached so the limit RPC can find them.
            await supabase
              .from('user_subscriptions')
              .insert({
                user_id: userId,
                email: userEmail,
                tier: 'free',
                status: 'free',
                alacarte_renders_remaining: qty,
              } as any);
          }
          break;
        }

        // ─── Print-Ready Production Pack ($299) — guest-capable ───
        // create-single-use-checkout (tool=production_pack) stamps
        // product_type='print_production_pack'. Find-or-create the buyer's user
        // (guests have no account yet), then open a panelizer_job so it lands in
        // ProductionFlow + the Admin QC queue. Fully isolated + non-fatal so it
        // can never break other purchases.
        if (session.metadata?.product_type === 'print_production_pack') {
          try {
            const ppEmail = String(
              session.customer_email || (session as any).customer_details?.email || ''
            ).trim().toLowerCase();
            let ppUserId = String(session.metadata?.user_id || '').trim() || null;
            if (!ppUserId && ppEmail) {
              const { data: ppList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
              const ppExisting = ppList?.users?.find((u: any) => u.email?.toLowerCase() === ppEmail);
              if (ppExisting) {
                ppUserId = ppExisting.id;
              } else {
                const { data: ppCreated } = await supabase.auth.admin.createUser({
                  email: ppEmail,
                  email_confirm: true,
                  user_metadata: { source: 'print_production_pack' },
                });
                ppUserId = ppCreated?.user?.id || null;
              }
            }
            if (!ppUserId) {
              console.error('[print_production_pack] could not resolve user', { ppEmail, session: session.id });
              break;
            }
            const { data: ppAuthUser, error: ppAuthUserError } =
              await supabase.auth.admin.getUserById(ppUserId);
            if (ppAuthUserError || !ppAuthUser?.user) {
              console.error('[print_production_pack] resolved user does not exist', {
                session: session.id,
                user: ppUserId,
                error: ppAuthUserError?.message || null,
              });
              break;
            }
            const ppResolvedEmail = String(ppAuthUser.user.email || '').trim().toLowerCase();
            if (ppEmail && ppResolvedEmail && ppEmail !== ppResolvedEmail) {
              console.error('[print_production_pack] checkout user identity conflict', {
                session: session.id,
                user: ppUserId,
              });
              break;
            }
            const ppSubmittedGenerationId = String(session.metadata?.generation_id || '').trim() || null;
            const ppUuid =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            const ppSha256 = /^[0-9a-f]{64}$/i;
            if (!ppSubmittedGenerationId || !ppUuid.test(ppSubmittedGenerationId)) {
              console.error('[print_production_pack] missing or invalid generation identity', {
                session: session.id,
              });
              break;
            }
            const ppJobSelect =
              'id,user_id,shop_id,generation_id,order_number,status,approved_render_url,vehicle_year,vehicle_make,vehicle_model,concept_json,customer_inputs,error_stage,error_message';
            const ppMetadataEnticePackId = String(
              session.metadata?.entice_pack_id
              || session.metadata?.enticePackId
              || '',
            ).trim() || null;
            if (ppMetadataEnticePackId && !ppUuid.test(ppMetadataEnticePackId)) {
              console.error('[print_production_pack] invalid Entice Pack pin', {
                session: session.id,
              });
              break;
            }
            // A webhook retry must reuse the first accepted pin even if a newer
            // revision becomes active between deliveries. Read the one
            // session-bound job before consulting mutable active-pack state.
            const { data: ppExistingJobs, error: ppExistingJobsError } =
              await supabase
                .from('panelizer_jobs')
                .select(ppJobSelect)
                .eq('customer_inputs->>stripe_session', session.id)
                .eq('job_type', 'production_pack')
                .order('created_at', { ascending: true })
                .limit(2);
            if (ppExistingJobsError) {
              console.error(
                '[print_production_pack] panelizer job lookup failed:',
                ppExistingJobsError,
              );
              break;
            }
            if ((ppExistingJobs || []).length > 1) {
              console.error('[print_production_pack] duplicate Stripe panelizer jobs detected', {
                session: session.id,
              });
              break;
            }
            let ppJob = ppExistingJobs?.[0] || null;
            const ppExistingInputs =
              ppJob?.customer_inputs
              && typeof ppJob.customer_inputs === 'object'
              && !Array.isArray(ppJob.customer_inputs)
                ? ppJob.customer_inputs
                : {};
            const ppPersistedEnticePackId =
              String(ppExistingInputs.entice_pack_id || '').trim() || null;
            if (
              ppPersistedEnticePackId
              && !ppUuid.test(ppPersistedEnticePackId)
            ) {
              console.error('[print_production_pack] persisted Entice Pack pin is invalid', {
                session: session.id,
                job: ppJob?.id || null,
              });
              break;
            }
            if (
              ppMetadataEnticePackId
              && ppPersistedEnticePackId
              && ppMetadataEnticePackId !== ppPersistedEnticePackId
            ) {
              console.error('[print_production_pack] checkout and job pack pins conflict', {
                session: session.id,
                job: ppJob?.id || null,
              });
              break;
            }
            const ppRequestedEnticePackId =
              ppMetadataEnticePackId || ppPersistedEnticePackId;

            // Pin one exact verified revision pack before creating any mutable
            // panelizer request. New checkouts name the pack directly; legacy
            // checkouts resolve the active pack exactly once here. Every later
            // write and enqueue reuse this row's id and frozen manifest. An
            // exact Stripe/job pin may remain valid after a later revision
            // supersedes it; an unpinned legacy checkout may only resolve active.
            let ppPackLookup = supabase
              .from('designpro_entice_packs')
              .select(
                'id,user_id,design_id,designiq_generation_id,source_visualization_id,revision_id,dimension_manifest_id,status,verified_at,activated_at,source_contract_hash,manifest_hash,pack_identity_hash,pack_version,surface_manifest,proof_artifact',
              )
              .not('verified_at', 'is', null);
            ppPackLookup = ppRequestedEnticePackId
              ? ppPackLookup
                  .eq('id', ppRequestedEnticePackId)
                  .in('status', ['active', 'superseded'])
              : ppPackLookup
                  .eq('status', 'active')
                  .or(
                    `designiq_generation_id.eq.${ppSubmittedGenerationId},source_visualization_id.eq.${ppSubmittedGenerationId}`,
                  );
            const { data: ppPackMatches, error: ppIdentityError } =
              await ppPackLookup
              .order('activated_at', { ascending: false })
              .limit(2);
            if (ppIdentityError) {
              console.error('[print_production_pack] revision identity lookup failed:', ppIdentityError);
              break;
            }
            if ((ppPackMatches || []).length !== 1) {
              console.error('[print_production_pack] exact verified Entice Pack required', {
                session: session.id,
                generation: ppSubmittedGenerationId,
                requestedPack: ppRequestedEnticePackId,
                matches: (ppPackMatches || []).length,
              });
              break;
            }
            const ppPinnedPack = (ppPackMatches || [])[0] as any;
            const ppGenerationId = String(
              ppPinnedPack.designiq_generation_id || '',
            ).trim();
            const ppVisualizationId = String(
              ppPinnedPack.source_visualization_id || '',
            ).trim();
            const ppSubmittedIdentityMatches =
              ppSubmittedGenerationId === ppGenerationId
              || ppSubmittedGenerationId === ppVisualizationId;
            if (
              String(ppPinnedPack.user_id || '') !== ppUserId
              || !ppSubmittedIdentityMatches
              || String(ppPinnedPack.design_id || '') !== ppGenerationId
              || !ppUuid.test(String(ppPinnedPack.id || ''))
              || !ppUuid.test(ppGenerationId)
              || !ppUuid.test(ppVisualizationId)
              || !ppUuid.test(String(ppPinnedPack.revision_id || ''))
              || !ppUuid.test(String(ppPinnedPack.dimension_manifest_id || ''))
              || !ppSha256.test(String(ppPinnedPack.source_contract_hash || ''))
              || !ppSha256.test(String(ppPinnedPack.manifest_hash || ''))
              || !ppSha256.test(String(ppPinnedPack.pack_identity_hash || ''))
              || !String(ppPinnedPack.pack_version || '').trim()
            ) {
              console.error('[print_production_pack] pinned Entice Pack identity conflict', {
                session: session.id,
                generation: ppGenerationId,
                visualization: ppVisualizationId,
                pack: ppPinnedPack.id || null,
              });
              break;
            }
            const ppSurfaceManifest =
              ppPinnedPack.surface_manifest
              && typeof ppPinnedPack.surface_manifest === 'object'
              && !Array.isArray(ppPinnedPack.surface_manifest)
                ? ppPinnedPack.surface_manifest
                : {};
            const ppManifestVehicle =
              ppSurfaceManifest.vehicle
              && typeof ppSurfaceManifest.vehicle === 'object'
              && !Array.isArray(ppSurfaceManifest.vehicle)
                ? ppSurfaceManifest.vehicle
                : {};
            const ppManifestOptions =
              ppSurfaceManifest.selectedOptions
              && typeof ppSurfaceManifest.selectedOptions === 'object'
              && !Array.isArray(ppSurfaceManifest.selectedOptions)
                ? ppSurfaceManifest.selectedOptions
                : {};
            const ppExpectedPanelSides = Array.isArray(ppSurfaceManifest.expectedSides)
              ? ppSurfaceManifest.expectedSides.map(
                  (side: unknown) => String(side || '').trim().toUpperCase(),
                )
              : [];
            const ppManifestSurfaces = Array.isArray(ppSurfaceManifest.surfaces)
              ? ppSurfaceManifest.surfaces
              : [];
            const ppExpectedSurfaceKeys = ppManifestSurfaces.map(
              (surface: any) => String(surface?.key || '').trim().toUpperCase(),
            );
            if (
              ppExpectedPanelSides.length === 0
              || new Set(ppExpectedPanelSides).size !== ppExpectedPanelSides.length
              || ppExpectedPanelSides.some((side: string) => !side)
              || ppExpectedSurfaceKeys.length !== ppExpectedPanelSides.length
              || ppExpectedPanelSides.some(
                (side: string) => !ppExpectedSurfaceKeys.includes(side),
              )
            ) {
              console.error('[print_production_pack] frozen surface manifest is invalid', {
                session: session.id,
                pack: ppPinnedPack.id,
              });
              break;
            }
            const ppVehicleYearText = String(ppManifestVehicle.year || '').trim();
            if (ppVehicleYearText && !/^[0-9]{4}$/.test(ppVehicleYearText)) {
              console.error('[print_production_pack] frozen vehicle year is invalid', {
                session: session.id,
                pack: ppPinnedPack.id,
              });
              break;
            }
            const ppVehicleYear = ppVehicleYearText
              ? parseInt(ppVehicleYearText, 10)
              : null;
            const ppVehicleMake = String(ppManifestVehicle.make || '').trim() || null;
            const ppVehicleModel = String(ppManifestVehicle.model || '').trim() || null;
            const ppVehicleType =
              String(ppManifestVehicle.type || 'standard').trim().toLowerCase()
              || 'standard';
            const ppSideSize =
              String(ppManifestOptions.sideSize || 'medium').trim().toLowerCase()
              || 'medium';
            const ppRoofSize =
              String(ppManifestOptions.roofSize || 'none').trim().toLowerCase()
              || 'none';
            const ppProofArtifact =
              ppPinnedPack.proof_artifact
              && typeof ppPinnedPack.proof_artifact === 'object'
              && !Array.isArray(ppPinnedPack.proof_artifact)
                ? ppPinnedPack.proof_artifact
                : {};
            const ppRenderUrl = String(ppProofArtifact.url || '').trim() || null;
            if (!ppRenderUrl) {
              console.error('[print_production_pack] pinned proof artifact is missing', {
                session: session.id,
                pack: ppPinnedPack.id,
              });
              break;
            }
            const ppPinnedConcept = {
              ...ppManifestOptions,
              sideSize: ppSideSize,
              roofSize: ppRoofSize,
              addHood: ppExpectedPanelSides.includes('HOOD'),
              addRoof: ppExpectedPanelSides.includes('ROOF'),
              addFrontBumper: ppExpectedPanelSides.includes('FRONT'),
              addRearBumper: ppExpectedPanelSides.includes('REAR'),
              expected_panel_sides: ppExpectedPanelSides,
              vehicle_type: ppVehicleType,
              surface_manifest_version:
                String(ppSurfaceManifest.version || 'designpro.surface-manifest.v1'),
              flat_proof_url: ppRenderUrl,
              entice_pack_id: ppPinnedPack.id,
              revision_id: ppPinnedPack.revision_id,
              dimension_manifest_id: ppPinnedPack.dimension_manifest_id,
              source_contract_hash: ppPinnedPack.source_contract_hash,
              manifest_hash: ppPinnedPack.manifest_hash,
              pack_identity_hash: ppPinnedPack.pack_identity_hash,
              pack_version: ppPinnedPack.pack_version,
            };
            // Stripe retries and concurrent deliveries must resolve to one
            // authoritative request. Reuse any pre-cutover job first, then use
            // a deterministic UUID so new deliveries cannot race two inserts.
            const ppPinnedCustomerInputs = {
              source: 'print_production_pack_299',
              buyer_email: ppEmail,
              stripe_session: session.id,
              entice_pack_id: ppPinnedPack.id,
              revision_id: ppPinnedPack.revision_id,
              dimension_manifest_id: ppPinnedPack.dimension_manifest_id,
              source_contract_hash: ppPinnedPack.source_contract_hash,
              manifest_hash: ppPinnedPack.manifest_hash,
              pack_identity_hash: ppPinnedPack.pack_identity_hash,
              pack_version: ppPinnedPack.pack_version,
            };
            const ppSameText = (left: unknown, right: unknown) =>
              String(left || '').trim().toLowerCase()
              === String(right || '').trim().toLowerCase();
            const ppSameSides = (value: unknown) => {
              const actual = Array.isArray(value)
                ? value.map(
                    (side: unknown) => String(side || '').trim().toUpperCase(),
                  ).sort()
                : [];
              const expected = [...ppExpectedPanelSides].sort();
              return JSON.stringify(actual) === JSON.stringify(expected);
            };
            const ppJobMatchesPin = (job: any) => {
              const concept =
                job?.concept_json
                && typeof job.concept_json === 'object'
                && !Array.isArray(job.concept_json)
                  ? job.concept_json
                  : {};
              const inputs =
                job?.customer_inputs
                && typeof job.customer_inputs === 'object'
                && !Array.isArray(job.customer_inputs)
                  ? job.customer_inputs
                  : {};
              return (
                String(job?.user_id || '') === ppUserId
                && String(job?.generation_id || '') === ppGenerationId
                && String(inputs.stripe_session || '') === session.id
                && String(inputs.entice_pack_id || '') === String(ppPinnedPack.id)
                && String(inputs.revision_id || '') === String(ppPinnedPack.revision_id)
                && String(inputs.dimension_manifest_id || '')
                  === String(ppPinnedPack.dimension_manifest_id)
                && String(inputs.source_contract_hash || '').toLowerCase()
                  === String(ppPinnedPack.source_contract_hash).toLowerCase()
                && String(inputs.manifest_hash || '').toLowerCase()
                  === String(ppPinnedPack.manifest_hash).toLowerCase()
                && String(inputs.pack_identity_hash || '').toLowerCase()
                  === String(ppPinnedPack.pack_identity_hash).toLowerCase()
                && ppSameText(inputs.pack_version, ppPinnedPack.pack_version)
                && String(concept.entice_pack_id || '') === String(ppPinnedPack.id)
                && String(concept.revision_id || '') === String(ppPinnedPack.revision_id)
                && String(concept.dimension_manifest_id || '')
                  === String(ppPinnedPack.dimension_manifest_id)
                && String(concept.source_contract_hash || '').toLowerCase()
                  === String(ppPinnedPack.source_contract_hash).toLowerCase()
                && String(concept.manifest_hash || '').toLowerCase()
                  === String(ppPinnedPack.manifest_hash).toLowerCase()
                && String(concept.pack_identity_hash || '').toLowerCase()
                  === String(ppPinnedPack.pack_identity_hash).toLowerCase()
                && ppSameText(concept.pack_version, ppPinnedPack.pack_version)
                && ppSameText(job.vehicle_year, ppVehicleYearText)
                && ppSameText(job.vehicle_make, ppVehicleMake)
                && ppSameText(job.vehicle_model, ppVehicleModel)
                && ppSameText(concept.vehicle_type || 'standard', ppVehicleType)
                && ppSameText(concept.sideSize || 'medium', ppSideSize)
                && ppSameText(concept.roofSize || 'none', ppRoofSize)
                && ppSameSides(concept.expected_panel_sides)
                && String(job.approved_render_url || '') === ppRenderUrl
              );
            };
            const ppJobHasConflictingPin = (job: any) => {
              const concept =
                job?.concept_json
                && typeof job.concept_json === 'object'
                && !Array.isArray(job.concept_json)
                  ? job.concept_json
                  : {};
              const inputs =
                job?.customer_inputs
                && typeof job.customer_inputs === 'object'
                && !Array.isArray(job.customer_inputs)
                  ? job.customer_inputs
                  : {};
              const pinnedValues: Array<[unknown, unknown]> = [
                [inputs.entice_pack_id, ppPinnedPack.id],
                [inputs.revision_id, ppPinnedPack.revision_id],
                [inputs.dimension_manifest_id, ppPinnedPack.dimension_manifest_id],
                [inputs.source_contract_hash, ppPinnedPack.source_contract_hash],
                [inputs.manifest_hash, ppPinnedPack.manifest_hash],
                [inputs.pack_identity_hash, ppPinnedPack.pack_identity_hash],
                [inputs.pack_version, ppPinnedPack.pack_version],
                [concept.entice_pack_id, ppPinnedPack.id],
                [concept.revision_id, ppPinnedPack.revision_id],
                [concept.dimension_manifest_id, ppPinnedPack.dimension_manifest_id],
                [concept.source_contract_hash, ppPinnedPack.source_contract_hash],
                [concept.manifest_hash, ppPinnedPack.manifest_hash],
                [concept.pack_identity_hash, ppPinnedPack.pack_identity_hash],
                [concept.pack_version, ppPinnedPack.pack_version],
              ];
              return pinnedValues.some(
                ([actual, expected]) =>
                  String(actual || '').trim() !== ''
                  && String(actual).toLowerCase() !== String(expected).toLowerCase(),
              );
            };
            if (ppJob && (
              String(ppJob.user_id || '') !== ppUserId
              || String(ppJob.generation_id || '') !== String(ppGenerationId || '')
              || ppJobHasConflictingPin(ppJob)
            )) {
              console.error('[print_production_pack] existing job identity conflict', {
                session: session.id,
                job: ppJob.id,
              });
              break;
            }
            if (ppJob && !ppJobMatchesPin(ppJob)) {
              if (String(ppJob.status || '') !== 'queued') {
                console.error('[print_production_pack] existing unpinned job is no longer mutable', {
                  session: session.id,
                  job: ppJob.id,
                  status: ppJob.status,
                });
                break;
              }
              const existingInputs =
                ppJob.customer_inputs
                && typeof ppJob.customer_inputs === 'object'
                && !Array.isArray(ppJob.customer_inputs)
                  ? ppJob.customer_inputs
                  : {};
              const { data: pinnedJob, error: pinJobError } = await supabase
                .from('panelizer_jobs')
                .update({
                  approved_render_url: ppRenderUrl,
                  vehicle_year: ppVehicleYear,
                  vehicle_make: ppVehicleMake,
                  vehicle_model: ppVehicleModel,
                  concept_json: ppPinnedConcept,
                  customer_inputs: {
                    ...existingInputs,
                    ...ppPinnedCustomerInputs,
                  },
                })
                .eq('id', ppJob.id)
                .eq('user_id', ppUserId)
                .eq('generation_id', ppGenerationId)
                .eq('status', 'queued')
                .select(ppJobSelect)
                .maybeSingle();
              if (pinJobError || !pinnedJob || !ppJobMatchesPin(pinnedJob)) {
                console.error('[print_production_pack] existing job pin failed:', pinJobError);
                break;
              }
              ppJob = pinnedJob;
            }
            if (!ppJob) {
              const deterministicJobId = await stableWebhookJobId(
                `designpro.production_pack:${session.id}`,
              );
              const { data: insertedJob, error: ppErr } = await supabase
                .from('panelizer_jobs')
                .insert({
                  id: deterministicJobId,
                  user_id: ppUserId,
                  generation_id: ppGenerationId,
                  approved_render_url: ppRenderUrl,
                  vehicle_year: ppVehicleYear,
                  vehicle_make: ppVehicleMake,
                  vehicle_model: ppVehicleModel,
                  job_type: 'production_pack',
                  concept_json: ppPinnedConcept,
                  status: 'queued',
                  started_at: new Date().toISOString(),
                  customer_inputs: ppPinnedCustomerInputs,
                })
                .select(ppJobSelect)
                .single();
              if (ppErr && ppErr.code !== '23505') {
                console.error('[print_production_pack] panelizer_jobs insert failed:', ppErr);
                break;
              }
              if (insertedJob) {
                ppJob = insertedJob;
              } else {
                const { data: racedJob, error: racedJobError } = await supabase
                  .from('panelizer_jobs')
                  .select(ppJobSelect)
                  .eq('id', deterministicJobId)
                  .maybeSingle();
                if (
                  racedJobError
                  || !racedJob
                  || ppJobHasConflictingPin(racedJob)
                  || !ppJobMatchesPin(racedJob)
                ) {
                  console.error('[print_production_pack] idempotent panelizer job recovery failed:', racedJobError);
                  break;
                }
                ppJob = racedJob;
              }
            }
            if (!ppJob
              || String(ppJob.user_id || '') !== ppUserId
              || String(ppJob.generation_id || '') !== String(ppGenerationId || '')
              || !ppJobMatchesPin(ppJob)
            ) {
              console.error('[print_production_pack] resolved job identity conflict', {
                session: session.id,
                job: ppJob?.id || null,
              });
              break;
            }
            console.log('[print_production_pack] job resolved:', ppJob.id, 'for', ppEmail);

            // Record the paid entitlement BEFORE asking the facade to enqueue
            // production. enqueue_designpro_production_pack verifies this row;
            // without it a successful Stripe payment is rejected as
            // `pack_required`. The deterministic primary key serializes
            // concurrent webhook deliveries without adding another job table.
            const ppEntitlementId = await stableWebhookJobId(
              `designpro.production_pack.entitlement:${session.id}`,
            );
            // Reuse the existing source vocabulary so downstream entitlement
            // readers do not need a parallel paid-pack classification.
            const ppEntitlementSource = 'print_pack_entitlement';
            const ppEntitlementContract = 'designpro.production-pack-entitlement.v1';
            const ppEntitlementAmount = Math.max(
              0,
              Math.trunc(
                Number(
                  session.amount_total
                  ?? session.metadata?.unit_amount
                  ?? 29900,
                ) || 0,
              ),
            );
            const entitlementMatches = (row: any) => {
              const selected =
                row?.panels_selected
                && typeof row.panels_selected === 'object'
                && !Array.isArray(row.panels_selected)
                  ? row.panels_selected
                  : {};
              return (
                String(row?.user_id || '') === ppUserId
                && String(row?.generation_id || '') === ppGenerationId
                && String(row?.visualization_id || '') === String(ppVisualizationId || '')
                && String(row?.payment_status || '') === 'paid'
                && String(row?.source || '') === ppEntitlementSource
                && String(selected.stripe_session || '') === session.id
                && String(selected.contract || '') === ppEntitlementContract
                && String(selected.entice_pack_id || '') === String(ppPinnedPack.id)
                && String(selected.revision_id || '') === String(ppPinnedPack.revision_id)
                && String(selected.dimension_manifest_id || '')
                  === String(ppPinnedPack.dimension_manifest_id)
                && String(selected.source_contract_hash || '').toLowerCase()
                  === String(ppPinnedPack.source_contract_hash).toLowerCase()
                && String(selected.manifest_hash || '').toLowerCase()
                  === String(ppPinnedPack.manifest_hash).toLowerCase()
                && String(selected.pack_identity_hash || '').toLowerCase()
                  === String(ppPinnedPack.pack_identity_hash).toLowerCase()
                && ppSameText(selected.pack_version, ppPinnedPack.pack_version)
              );
            };

            let { data: ppEntitlement, error: ppEntitlementLookupError } =
              await supabase
                .from('production_packs')
                .select(
                  'id,user_id,generation_id,visualization_id,payment_status,source,panels_selected',
                )
                .eq('id', ppEntitlementId)
                .maybeSingle();
            if (ppEntitlementLookupError) {
              console.error(
                '[print_production_pack] entitlement lookup failed:',
                ppEntitlementLookupError,
              );
              break;
            }

            if (!ppEntitlement) {
              // Compatibility lookup for a row written by an earlier webhook
              // revision before deterministic entitlement ids were introduced.
              const { data: priorEntitlements, error: priorEntitlementError } =
                await supabase
                  .from('production_packs')
                  .select(
                    'id,user_id,generation_id,visualization_id,payment_status,source,panels_selected',
                  )
                  .eq('source', ppEntitlementSource)
                  .eq('panels_selected->>stripe_session', session.id)
                  .order('created_at', { ascending: true })
                  .limit(2);
              if (priorEntitlementError) {
                console.error(
                  '[print_production_pack] prior entitlement lookup failed:',
                  priorEntitlementError,
                );
                break;
              }
              if ((priorEntitlements || []).length > 1) {
                console.error('[print_production_pack] duplicate Stripe entitlements detected', {
                  session: session.id,
                });
                break;
              }
              ppEntitlement = priorEntitlements?.[0] || null;
            }

            if (ppEntitlement && !entitlementMatches(ppEntitlement)) {
              console.error('[print_production_pack] entitlement identity conflict', {
                session: session.id,
                entitlement: ppEntitlement.id,
              });
              break;
            }

            if (!ppEntitlement) {
              const entitlementPayload = {
                id: ppEntitlementId,
                user_id: ppUserId,
                generation_id: ppGenerationId,
                visualization_id: ppVisualizationId,
                panels_selected: {
                  contract: ppEntitlementContract,
                  stripe_session: session.id,
                  stripe_payment_intent:
                    typeof session.payment_intent === 'string'
                      ? session.payment_intent
                      : null,
                  generation_id: ppGenerationId,
                  visualization_id: ppVisualizationId,
                  entice_pack_id: ppPinnedPack.id,
                  revision_id: ppPinnedPack.revision_id,
                  dimension_manifest_id: ppPinnedPack.dimension_manifest_id,
                  source_contract_hash: ppPinnedPack.source_contract_hash,
                  manifest_hash: ppPinnedPack.manifest_hash,
                  pack_identity_hash: ppPinnedPack.pack_identity_hash,
                  pack_version: ppPinnedPack.pack_version,
                },
                total_price_cents: ppEntitlementAmount,
                payment_status: 'paid',
                source: ppEntitlementSource,
                pipeline_version: 'designpro.production_pack.v1',
              };
              const { data: insertedEntitlement, error: insertEntitlementError } =
                await supabase
                  .from('production_packs')
                  .insert(entitlementPayload as any)
                  .select(
                    'id,user_id,generation_id,visualization_id,payment_status,source,panels_selected',
                  )
                  .maybeSingle();
              if (insertEntitlementError && insertEntitlementError.code !== '23505') {
                console.error(
                  '[print_production_pack] entitlement insert failed:',
                  insertEntitlementError,
                );
                break;
              }
              if (insertedEntitlement) {
                ppEntitlement = insertedEntitlement;
              } else {
                const { data: racedEntitlement, error: racedEntitlementError } =
                  await supabase
                    .from('production_packs')
                    .select(
                      'id,user_id,generation_id,visualization_id,payment_status,source,panels_selected',
                    )
                    .eq('id', ppEntitlementId)
                    .maybeSingle();
                if (racedEntitlementError || !racedEntitlement) {
                  console.error(
                    '[print_production_pack] idempotent entitlement recovery failed:',
                    racedEntitlementError,
                  );
                  break;
                }
                ppEntitlement = racedEntitlement;
              }
            }
            if (!ppEntitlement || !entitlementMatches(ppEntitlement)) {
              console.error('[print_production_pack] resolved entitlement identity conflict', {
                session: session.id,
                entitlement: ppEntitlement?.id || null,
              });
              break;
            }
            console.log(
              '[print_production_pack] paid entitlement resolved:',
              ppEntitlement.id,
            );

            // Atomically record the paid Production Pack workflow in Postgres.
            // The service-role webhook already authenticated Stripe and pinned
            // the exact job, user, and Entice Pack; another HTTP edge hop only
            // creates a response-loss window. This RPC is the same sanctioned
            // enqueue used by the facade, without re-resolving mutable state.
            let ppWorkerActivated = false;
            if (ppJob?.id) {
              const ppDefinitionVersion = 'designpro.production_pack.v1';
              const ppEnqueueIdempotencyKey =
                `designpro:${ppUserId}:stripe:${session.id}`;
              let ppSubmissionHash = '';
              try {
                const ppJobConcept =
                  ppJob.concept_json
                  && typeof ppJob.concept_json === 'object'
                  && !Array.isArray(ppJob.concept_json)
                    ? ppJob.concept_json
                    : {};
                const ppConceptMaterial = Object.fromEntries(
                  Object.entries(ppJobConcept).filter(
                    ([key]) => key !== 'workflow',
                  ),
                );
                ppSubmissionHash = await canonicalWebhookSha256({
                  definitionVersion: ppDefinitionVersion,
                  panelizerJobId: ppJob.id,
                  generationId: ppGenerationId,
                  userId: ppUserId,
                  shopId: ppJob.shop_id || null,
                  orderNumber: ppJob.order_number || ppJob.id,
                  concept: stabilizeWebhookInput(ppConceptMaterial),
                  orderRequestId: null,
                  revisionId: ppPinnedPack.revision_id,
                  enticePackId: ppPinnedPack.id,
                  dimensionManifestId: ppPinnedPack.dimension_manifest_id,
                  sourceContractHash: ppPinnedPack.source_contract_hash,
                  packVersion: ppPinnedPack.pack_version,
                });
                const { data: ppEnqueued, error: ppEnqueueError } =
                  await supabase.rpc('enqueue_designpro_production_pack_v2', {
                    p_panelizer_job_id: ppJob.id,
                    p_entice_pack_id: ppPinnedPack.id,
                    p_order_request_id: null,
                    p_requested_by: ppUserId,
                    p_idempotency_key: ppEnqueueIdempotencyKey,
                    p_submission_hash: ppSubmissionHash,
                    p_definition_version: ppDefinitionVersion,
                  });
                if (ppEnqueueError) {
                  const enqueueFailure = new Error(
                    String(ppEnqueueError.message || 'Production enqueue RPC failed'),
                  );
                  Object.assign(enqueueFailure, {
                    code: ppEnqueueError.code,
                    details: ppEnqueueError.details,
                    hint: ppEnqueueError.hint,
                  });
                  throw enqueueFailure;
                }
                const ppEnqueueResult = Array.isArray(ppEnqueued)
                  ? ppEnqueued[0]
                  : ppEnqueued;
                const ppProductionJobId = String(
                  ppEnqueueResult?.productionJobId || '',
                );
                const ppWorkflowRunId = String(
                  ppEnqueueResult?.workflowRunId || '',
                );
                if (
                  !ppUuid.test(ppProductionJobId)
                  || !ppUuid.test(ppWorkflowRunId)
                  || String(ppEnqueueResult?.enticePackId || '')
                    !== String(ppPinnedPack.id)
                  || String(ppEnqueueResult?.revisionId || '')
                    !== String(ppPinnedPack.revision_id)
                  || String(ppEnqueueResult?.dimensionManifestId || '')
                    !== String(ppPinnedPack.dimension_manifest_id)
                  || String(ppEnqueueResult?.sourceContractHash || '').toLowerCase()
                    !== String(ppPinnedPack.source_contract_hash).toLowerCase()
                ) {
                  const invalidAcceptance = new Error(
                    'Production enqueue returned no matching durable identity',
                  );
                  Object.assign(invalidAcceptance, {
                    code: 'durable_acceptance_missing',
                  });
                  throw invalidAcceptance;
                }
                ppWorkerActivated = true;
                const acceptedAt = new Date().toISOString();
                const currentInputs =
                  ppJob.customer_inputs
                  && typeof ppJob.customer_inputs === 'object'
                  && !Array.isArray(ppJob.customer_inputs)
                    ? ppJob.customer_inputs
                    : {};
                const {
                  production_enqueue_failure: _priorFailure,
                  ...inputsWithoutFailure
                } = currentInputs as Record<string, unknown>;
                const acceptedInputs = {
                  ...inputsWithoutFailure,
                  production_enqueue: {
                    contract: 'designpro.production-pack-enqueue.v1',
                    status: 'accepted',
                    production_job_id: ppProductionJobId,
                    workflow_run_id: ppWorkflowRunId,
                    entice_pack_id: ppPinnedPack.id,
                    idempotency_key: ppEnqueueIdempotencyKey,
                    submission_hash: ppSubmissionHash,
                    accepted_at: acceptedAt,
                  },
                };
                const acceptancePatch: Record<string, unknown> = {
                  customer_inputs: acceptedInputs,
                };
                if (String(ppJob.error_stage || '') === 'production_enqueue') {
                  acceptancePatch.error_stage = null;
                  acceptancePatch.error_message = null;
                }
                const { error: ppAcceptancePersistError } = await supabase
                  .from('panelizer_jobs')
                  .update(acceptancePatch)
                  .eq('id', ppJob.id)
                  .eq('user_id', ppUserId)
                  .eq('customer_inputs->>stripe_session', session.id);
                if (ppAcceptancePersistError) {
                  // The returned IDs are already durable; this marker is
                  // observational and must not cause a duplicate enqueue.
                  console.error(
                    '[print_production_pack] durable acceptance marker failed:',
                    ppAcceptancePersistError,
                  );
                }
                console.log(
                  '[print_production_pack] durable production accepted:',
                  {
                    productionJobId: ppProductionJobId,
                    workflowRunId: ppWorkflowRunId,
                    idempotent: ppEnqueueResult?.created !== true,
                  },
                );
              } catch (enqueueError) {
                const rawFailure = enqueueError as {
                  message?: string;
                  code?: string;
                  details?: string;
                  hint?: string;
                };
                const failureMessage = String(
                  rawFailure?.message || enqueueError || 'Unknown enqueue failure',
                );
                const failureCode = String(
                  rawFailure?.code || 'production_enqueue_failed',
                );
                const failure = {
                  contract: 'designpro.production-pack-enqueue-failure.v1',
                  code: failureCode,
                  message: failureMessage,
                  details: String(rawFailure?.details || '') || null,
                  hint: String(rawFailure?.hint || '') || null,
                  retryable: !/(identity|conflict|invalid|pack_required|source_changed)/i.test(
                    `${failureCode} ${failureMessage}`,
                  ),
                  panelizer_job_id: ppJob.id,
                  entice_pack_id: ppPinnedPack.id,
                  stripe_session: session.id,
                  idempotency_key: ppEnqueueIdempotencyKey,
                  submission_hash: ppSubmissionHash || null,
                  failed_at: new Date().toISOString(),
                };
                const failureInputs =
                  ppJob.customer_inputs
                  && typeof ppJob.customer_inputs === 'object'
                  && !Array.isArray(ppJob.customer_inputs)
                    ? ppJob.customer_inputs
                    : {};
                const { error: ppFailurePersistError } = await supabase
                  .from('panelizer_jobs')
                  .update({
                    error_stage: 'production_enqueue',
                    error_message: JSON.stringify(failure),
                    customer_inputs: {
                      ...failureInputs,
                      production_enqueue_failure: failure,
                    },
                  })
                  .eq('id', ppJob.id)
                  .eq('user_id', ppUserId)
                  .eq('customer_inputs->>stripe_session', session.id);
                if (ppFailurePersistError) {
                  console.error(
                    '[print_production_pack] enqueue failure persistence failed:',
                    ppFailurePersistError,
                  );
                }
                console.error(
                  '[print_production_pack] durable production enqueue failed:',
                  failure,
                );
                // A paid order must not depend on a later human noticing this
                // marker. Stripe is already our durable event source, so ask it
                // to redeliver any retryable enqueue failure. Every identity
                // above is deterministic and the v2 RPC is idempotent, making
                // a webhook retry safe. Domain conflicts remain acknowledged
                // and queryable instead of retrying forever.
                if (failure.retryable || ppFailurePersistError) {
                  return new Response(
                    JSON.stringify({
                      error: 'Paid Production Pack enqueue will be retried',
                      code: failure.code,
                    }),
                    {
                      status: 503,
                      headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': '30',
                      },
                    },
                  );
                }
              }
            }
            // No legacy re-slicer fallback. Missing canonical assets are a durable
            // awaiting_build_assets state; an order must never manufacture from a
            // different producer merely because the sanctioned vault is incomplete.
            if (!ppWorkerActivated && ppJob?.id && ppRenderUrl) {
              console.warn('[print_production_pack] production safely paused; legacy Vercel slicer is disabled');
              /*
              // Phase 6: fire the deterministic manufacturing slicer (Vercel api/
              // process-production-pack). Payment completion is the trigger — this
              // is the "creative done → manufacturing begins at pay" boundary.
              // Non-fatal: a failure leaves the job queued for the standard flow.
              // Pin the known-good www host (PROD_PACK_SIDECAR_URL drifted to a dead
              // deploy hash → DEPLOYMENT_NOT_FOUND). The kick goes through pg_net
              // below (edge→Vercel-custom-domain fetch is blocked at the edge egress).
              const prodPackUrl = 'https://www.restyleproai.com/api/process-production-pack';
              if (prodPackUrl) {
                try {
                  // Phase 5 read: pull the generation's persisted LayerLiftIQ
                  // assets (clean background SEPARATE from transparent overlays +
                  // GENIE zones + layer manifest) so the slicer manufactures from
                  // clean Layer 1, not the text-baked hero. Falls back to the hero
                  // when no assets were persisted (older generations / guests).
                  const ppGenId = String(session.metadata?.generation_id || '').trim();
                  let ppArtworkUrl = ppRenderUrl;
                  let ppPanels: unknown = undefined;
                  let ppLayers: unknown = undefined;
                  let ppProof2d: unknown = undefined;
                  let ppProof3d: unknown = undefined;
                  if (ppGenId) {
                    const { data: ppAssets } = await supabase
                      .from('design_generation_assets')
                      .select('background_url, panel_zones, layer_manifest, proof_2d_url, proof_3d_url')
                      .eq('generation_id', ppGenId)
                      .eq('is_current', true)
                      .order('iteration_index', { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    if (ppAssets) {
                      if (ppAssets.background_url) ppArtworkUrl = ppAssets.background_url;
                      if (Array.isArray(ppAssets.panel_zones) && ppAssets.panel_zones.length) ppPanels = ppAssets.panel_zones;
                      if (Array.isArray(ppAssets.layer_manifest) && ppAssets.layer_manifest.length) ppLayers = ppAssets.layer_manifest;
                      if (ppAssets.proof_2d_url) ppProof2d = ppAssets.proof_2d_url;
                      if (ppAssets.proof_3d_url) ppProof3d = ppAssets.proof_3d_url;
                    }
                  }

                  // Kick via pg_net (kick_production_slicer), NOT a direct edge
                  // fetch: Supabase Edge → Vercel-custom-domain returns
                  // DEPLOYMENT_NOT_FOUND from the edge egress network, so the direct
                  // fetch never reached the slicer. pg_net reaches it from the DB
                  // network. Auth = the service-role key (the SAME value on Vercel +
                  // Supabase — the slicer accepts it), immune to the SIDECAR_SECRET
                  // drift that 401'd every server kick. The slicer auto-resolves the
                  // clean artwork + GENIE zones from the job/generation, so {job_id}
                  // is sufficient.
                  const ppSecret = (getExternalServiceRoleKey() || '').replace(/[^\x20-\x7E]/g, '').trim();
                  const { data: ppKickId, error: ppKickErr } = await supabase.rpc('kick_production_slicer', {
                    p_job_id: ppJob.id,
                    p_url: prodPackUrl,
                    p_secret: ppSecret,
                  });
                  if (ppKickErr) {
                    console.error('[print_production_pack] Phase 6 slicer kick failed (non-fatal):', ppKickErr.message);
                  } else {
                    console.log('[print_production_pack] Phase 6 slicer kicked via pg_net for job', ppJob.id, 'req', ppKickId, ppGenId ? `(assets gen ${ppGenId})` : '(hero fallback)');
                  }
                } catch (ppSlicerErr) {
                  console.error('[print_production_pack] Phase 6 slicer trigger failed (non-fatal):', ppSlicerErr);
                }
              }
              */
            }
          } catch (ppOuter) {
            console.error('[print_production_pack] handler error (non-fatal):', ppOuter);
          }
          break;
        }

        // ─── Guest single-design purchase ($25, no account required) ───
        // create-guest-design-checkout stamps purchase_type='guest_single_design'.
        // We:
        //   1. Find-or-create an auth user for the guest's email
        //   2. Grant 1 design token via add_user_tokens RPC (attribution via reason)
        //   3. Generate a magic link and email it via Resend
        if (session.metadata?.purchase_type === 'guest_single_design') {
          const guestEmail = String(
            session.metadata?.guest_email || session.customer_email || ''
          ).trim().toLowerCase();
          const ref = String(session.metadata?.ref || '').trim().toLowerCase();
          if (!guestEmail) {
            console.warn('[guest_single_design] no email on session', session.id);
            break;
          }
          console.log('🪄  Guest single-design purchase:', { guestEmail, ref });

          // 1. Find-or-create the auth user.
          let userId: string | null = null;
          const { data: list } = await supabase.auth.admin.listUsers({
            page: 1,
            perPage: 200,
          });
          const existing = list?.users?.find(
            (u: any) => u.email?.toLowerCase() === guestEmail,
          );
          if (existing) {
            userId = existing.id;
          } else {
            const { data: created, error: createErr } = await supabase.auth.admin.createUser({
              email: guestEmail,
              email_confirm: true,
              user_metadata: {
                source: 'guest_single_design',
                ref: ref || null,
              },
            });
            if (createErr || !created?.user) {
              console.error('[guest_single_design] createUser failed:', createErr);
              break;
            }
            userId = created.user.id;
          }

          // 2. Grant 4 design tokens (1 design + 3 revisions) to match what the
          //    $250 Custom Wrap Design product sells on /try-design ("1 custom
          //    design with 3 revisions"; 1 token = 1 render or revision). Reason
          //    encodes referrer attribution + Stripe session id so we can never
          //    double-grant and can audit later.
          const reason = `guest_single_design_purchase:${session.id}${ref ? `:${ref}` : ''}`;
          const { error: tokenErr } = await supabase.rpc('add_user_tokens', {
            p_user_id: userId,
            p_amount: 4,
            p_reason: reason,
          });
          if (tokenErr) {
            console.error('[guest_single_design] add_user_tokens failed:', tokenErr);
            break;
          }

          // 2b. Affiliate commission — single-payout policy (no MRR).
          //     Lookup the partner by referral_code matching the URL slug
          //     (case-insensitive, with optional WPW- prefix to handle both
          //     "TROY" and "WPW-TROY" patterns in affiliate_partners).
          //     Non-fatal: any error here is logged but does NOT break the
          //     customer's purchase or magic-link delivery.
          if (ref) {
            try {
              const { data: partner } = await supabase
                .from('affiliate_partners')
                .select('id, commission_rate, referral_code')
                .ilike('referral_code', `%${ref}`)
                .eq('status', 'approved')
                .limit(1)
                .maybeSingle();

              if (partner) {
                const rate = Number((partner as any).commission_rate) || 0;
                const amountCents = Number(session.amount_total) || 2500;
                const commissionCents = Math.round((amountCents * rate) / 100);
                const now = new Date();
                const payoutPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                const { error: txErr } = await supabase
                  .from('affiliate_transactions')
                  .insert({
                    partner_id: (partner as any).id,
                    coupon_id: `guest_single_design:${(partner as any).referral_code}`,
                    customer_email: guestEmail,
                    stripe_invoice_id: session.id, // checkout session id (UNIQUE)
                    stripe_subscription_id: null,
                    invoice_amount_cents: amountCents,
                    commission_rate: rate,
                    commission_amount_cents: commissionCents,
                    is_initial_payment: true, // single-use is always initial
                    payout_status: 'pending',
                    payout_period: payoutPeriod,
                  });

                if (txErr && txErr.code !== '23505') {
                  console.error('[guest_single_design] commission insert failed:', txErr);
                } else if (!txErr) {
                  // Update partner stats atomically.
                  await supabase.rpc('increment_affiliate_stats', {
                    p_partner_id: (partner as any).id,
                    p_commission_cents: commissionCents,
                    p_is_initial: true,
                  });
                  console.log(
                    `💰 $25 commission: $${(commissionCents / 100).toFixed(2)} → ${(partner as any).referral_code}`,
                  );
                }
              } else {
                console.log(`[guest_single_design] No active partner found for ref=${ref}`);
              }
            } catch (commErr) {
              console.error('[guest_single_design] commission error (non-fatal):', commErr);
            }
          }

          // 3. Generate a magic link and email it via Resend.
          const origin = (Deno.env.get('PUBLIC_SITE_URL') || 'https://restyleproai.com').replace(/\/$/, '');
          const redirectTo = `${origin}/designpro?from=guest_purchase`;
          const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: guestEmail,
            options: { redirectTo },
          });
          if (linkErr || !linkData?.properties?.action_link) {
            console.error('[guest_single_design] generateLink failed:', linkErr);
            break;
          }
          const actionLink = linkData.properties.action_link;

          const resendKey = Deno.env.get('RESEND_API_KEY');
          if (!resendKey) {
            console.error('[guest_single_design] RESEND_API_KEY not configured; cannot deliver link');
            break;
          }
          const resend = new Resend(resendKey);

          const html = `<!doctype html><html><body style="margin:0;padding:0;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:8px;">RestyleProAI</div>
    <h1 style="font-size:26px;font-weight:800;line-height:1.2;margin:0 0 16px;">Your design credits are ready.</h1>
    <p style="font-size:15px;line-height:1.55;color:#ddd;margin:0 0 24px;">Thanks for your purchase. Click below to open the designer — you've got 4 credits loaded (1 design + 3 revisions).</p>
    <p style="margin:0 0 24px;">
      <a href="${actionLink}" style="display:inline-block;background:#00C7FF;color:#000;font-weight:700;padding:14px 24px;border-radius:8px;text-decoration:none;font-size:15px;">Open the designer</a>
    </p>
    <p style="font-size:13px;color:#888;line-height:1.55;margin:0 0 8px;">Or paste this link into your browser:</p>
    <p style="font-size:12px;color:#666;word-break:break-all;margin:0 0 24px;">${actionLink}</p>
    <p style="font-size:12px;color:#666;line-height:1.55;margin:0;">No subscription. No recurring charges. Just one design. — RestylePro</p>
  </div>
</body></html>`;

          const text = `Your RestyleProAI design credits are ready.

Open the designer (4 credits loaded — 1 design + 3 revisions):
${actionLink}

No subscription. No recurring charges. — RestylePro`;

          const emailRes = await resend.emails.send({
            from: 'RestylePro <noreply@restyleproai.com>',
            to: [guestEmail],
            subject: 'Your RestyleProAI design credits are ready (4 loaded)',
            html,
            text,
          });
          if (emailRes.error) {
            console.error('[guest_single_design] Resend error:', emailRes.error);
          } else {
            console.log('[guest_single_design] magic link emailed:', emailRes.data?.id);
          }
          break;
        }

        // Check if this is a design pack purchase
        if (!session.metadata?.design_id || !session.metadata?.purchase_type) {
          console.log('Not a design pack purchase, skipping');
          break;
        }

        const { design_id, purchase_type, user_email, user_id } = session.metadata;
        const meta = session.metadata;

        console.log('Processing design pack purchase:', { design_id, purchase_type, user_email, user_id });

        // Get the design details
        const { data: design, error: designError } = await supabase
          .from('designpanelpro_patterns')
          .select('*')
          .eq('id', design_id)
          .single();

        if (designError || !design) {
          console.error('Error fetching design:', designError);
          break;
        }

        // Only generate download URL for production files purchases that already have files
        let downloadUrl = null;
        let expiresAt = null;

        if (purchase_type === 'production_files' && design.production_file_url) {
          const urlParts = design.production_file_url.split('/production-files/');
          const filePath = urlParts[1];

          if (filePath) {
            const { data: signedUrlData, error: signedUrlError } = await supabase.storage
              .from('production-files')
              .createSignedUrl(filePath, 86400);

            if (signedUrlError) {
              console.error('Error creating signed URL:', signedUrlError);
            } else {
              downloadUrl = signedUrlData.signedUrl;
              expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();
            }
          }
        }

        // Build order metadata with Production Pack V2 fields
        const orderMetadata: Record<string, any> = {
          total_amount: session.amount_total || 0,
          currency: session.currency || 'usd',
        };

        if (purchase_type === 'printed_panels') {
          orderMetadata.kit_size = meta.kit_size || meta.selected_size || null;
          orderMetadata.kit_price = meta.kit_price ? parseInt(meta.kit_price) : 0;
          orderMetadata.add_hood = meta.add_hood === 'true' || meta.include_hood === 'true';
          orderMetadata.hood_price = orderMetadata.add_hood ? 160 : 0;
          orderMetadata.add_front_bumper = meta.add_front_bumper === 'true' || meta.include_front_bumper === 'true';
          orderMetadata.front_bumper_price = orderMetadata.add_front_bumper ? 200 : 0;
          orderMetadata.add_rear_bumper = meta.add_rear_bumper === 'true' || meta.include_rear_plus_bumper === 'true';
          orderMetadata.rear_bumper_price = orderMetadata.add_rear_bumper ? 395 : 0;
          orderMetadata.roof_size = meta.roof_size || 'none';
          orderMetadata.roof_price = meta.roof_price ? parseInt(meta.roof_price) : 0;
        }

        // Save purchase record with Production Pack V2 fields
        // order_number auto-generates via trigger
        const purchaseInsert: Record<string, any> = {
          email: user_email || session.customer_email,
          design_id,
          purchase_type,
          stripe_checkout_id: session.id,
          download_url: downloadUrl,
          download_expires_at: expiresAt,
          order_metadata: orderMetadata,
          // Production Pack V2 columns
          user_id: user_id || null,
          selected_size: meta.selected_size || null,
          recommended_size: meta.recommended_size || null,
          size_was_overridden: meta.size_was_overridden === 'true',
          include_hood: meta.include_hood === 'true',
          include_front_bumper: meta.include_front_bumper === 'true',
          include_rear_plus_bumper: meta.include_rear_plus_bumper === 'true',
          roof_size: meta.roof_size || null,
          customer_order_number: meta.customer_order_number || null,
          vehicle_year: meta.vehicle_year || null,
          vehicle_make: meta.vehicle_make || null,
          vehicle_model: meta.vehicle_model || null,
          production_status: 'paid',
        };

        const { data: purchaseRecord, error: purchaseError } = await supabase
          .from('design_pack_purchases')
          .insert(purchaseInsert)
          .select('id, order_number')
          .single();

        if (purchaseError) {
          console.error('Error saving purchase record:', purchaseError);
          break;
        }

        const purchaseId = purchaseRecord?.id;
        const orderNumber = purchaseRecord?.order_number;
        console.log('Purchase record created:', { purchaseId, orderNumber });

        // ============================================================
        // PRODUCTION PACK PIPELINE V2: Auto-trigger Panelizer
        // ============================================================
        // For production_files purchases that don't already have files,
        // trigger the Panelizer V4.0 to generate them automatically.
        // ============================================================

        if (purchase_type === 'production_files' && !design.production_file_url && meta.selected_size) {
          console.log('🏭 PRODUCTION PIPELINE: Triggering Panelizer V4.0 for order', orderNumber);

          // GATE CHECK: Verify the design has render data
          // Check designiq_generations for approved 3D renders
          let renderUrls: Record<string, string> = {};
          let hasApprovedRenders = false;

          try {
            // Try to find render URLs from designiq_generations
            const { data: genData } = await supabase
              .from('designiq_generations' as any)
              .select('hero_render_url, render_urls, panel_url')
              .eq('id', design_id)
              .single();

            if (genData) {
              const gen = genData as any;
              if (gen.hero_render_url) {
                renderUrls.hero = gen.hero_render_url;
                hasApprovedRenders = true;
              }
              if (gen.panel_url) {
                renderUrls.panel = gen.panel_url;
              }
              // render_urls may be a JSON object with view-specific URLs
              if (gen.render_urls && typeof gen.render_urls === 'object') {
                Object.assign(renderUrls, gen.render_urls);
                hasApprovedRenders = true;
              }
            }
          } catch (e) {
            console.warn('Could not check designiq_generations:', e);
          }

          // Also check color_visualizations for render URLs
          if (!hasApprovedRenders) {
            try {
              const { data: vizData } = await supabase
                .from('color_visualizations')
                .select('render_urls')
                .eq('customer_email', user_email || session.customer_email)
                .eq('generation_status', 'completed')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

              if (vizData?.render_urls && typeof vizData.render_urls === 'object') {
                Object.assign(renderUrls, vizData.render_urls as Record<string, string>);
                hasApprovedRenders = Object.keys(renderUrls).length > 0;
              }
            } catch (e) {
              console.warn('Could not check color_visualizations:', e);
            }
          }

          // Also check the design pattern itself for image URL
          if (!hasApprovedRenders && design.image_url) {
            renderUrls.hero = design.image_url;
            hasApprovedRenders = true;
          }

          if (!hasApprovedRenders || Object.keys(renderUrls).length === 0) {
            console.error('BLOCKED: No approved render URLs found for design', design_id);
            await supabase
              .from('design_pack_purchases')
              .update({ production_status: 'blocked_missing_renders' })
              .eq('id', purchaseId);

            // Payment is valid — customer will get files once renders are resolved
            console.log('Order', orderNumber, 'blocked — awaiting manual render resolution');
          } else {
            // All gate checks passed — trigger Panelizer V4.0
            await supabase
              .from('design_pack_purchases')
              .update({ generation_started_at: new Date().toISOString() })
              .eq('id', purchaseId);

            const panelizeUrl = `${getExternalSupabaseUrl()}/functions/v1/generate-production-files`;
            console.log('🚀 Triggering Panelizer:', panelizeUrl);

            // Fire-and-forget — don't await, return 200 to Stripe immediately
            fetch(panelizeUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getExternalServiceRoleKey()}`
              },
              body: JSON.stringify({
                production_pack_id: purchaseId,
                order_number: orderNumber,
                design_id: design_id,
                user_id: user_id,
                user_email: user_email || session.customer_email,
                // Panel selection from size recommendation
                selection: {
                  sideSize: meta.selected_size?.toLowerCase() || 'medium',
                  addHood: meta.include_hood === 'true',
                  addFrontBumper: meta.include_front_bumper === 'true',
                  addRearBumper: meta.include_rear_plus_bumper === 'true',
                  roofSize: meta.roof_size || 'none',
                },
                // Vehicle info
                vehicleYear: meta.vehicle_year,
                vehicleMake: meta.vehicle_make,
                vehicleModel: meta.vehicle_model,
                // Approved render URLs
                approvedRenderUrls: renderUrls,
                heroRenderUrl: renderUrls.hero || renderUrls.side || Object.values(renderUrls)[0],
                // Source
                source: 'stripe_webhook_auto',
              })
            }).then(async (resp) => {
              if (!resp.ok) {
                const errText = await resp.text();
                console.error('Panelizer trigger failed:', resp.status, errText);
                await supabase
                  .from('design_pack_purchases')
                  .update({ production_status: 'generation_failed' })
                  .eq('id', purchaseId);
              } else {
                const result = await resp.json();
                console.log('Panelizer completed:', result);
                // Update purchase with production results
                await supabase
                  .from('design_pack_purchases')
                  .update({
                    production_status: 'ready',
                    generation_completed_at: new Date().toISOString(),
                    wrapbox_delivery_url: result.packUrl || null,
                    download_url: result.packUrl || null,
                    download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
                  })
                  .eq('id', purchaseId);

                // Send delivery notification email
                try {
                  await fetch(`${getExternalSupabaseUrl()}/functions/v1/send-design-pack-email`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${getExternalServiceRoleKey()}`
                    },
                    body: JSON.stringify({
                      email: user_email || session.customer_email,
                      designName: design.name || 'Custom Wrap Design',
                      downloadUrl: result.packUrl,
                      orderNumber: orderNumber,
                      vehicle: `${meta.vehicle_year || ''} ${meta.vehicle_make || ''} ${meta.vehicle_model || ''}`.trim(),
                      selectedSize: meta.selected_size,
                    })
                  });
                  console.log('Delivery notification email sent for order', orderNumber);

                  // Mark as delivered
                  await supabase
                    .from('design_pack_purchases')
                    .update({ delivered_at: new Date().toISOString() })
                    .eq('id', purchaseId);
                } catch (emailErr) {
                  console.error('Email notification failed:', emailErr);
                }
              }
            }).catch(err => {
              console.error('Panelizer trigger network error:', err);
            });

            console.log('Panelizer triggered asynchronously for order', orderNumber);
          }
        } else if (purchase_type === 'production_files' && downloadUrl) {
          // Existing production files — send download email immediately
          try {
            const emailResponse = await fetch(`${getExternalSupabaseUrl()}/functions/v1/send-design-pack-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getExternalServiceRoleKey()}`
              },
              body: JSON.stringify({
                email: user_email || session.customer_email,
                designName: design.name,
                downloadUrl,
                expiresAt,
                orderNumber,
              })
            });

            if (!emailResponse.ok) {
              console.error('Error sending email:', await emailResponse.text());
            } else {
              console.log('Email sent successfully to:', user_email || session.customer_email);

              await supabase
                .from('design_pack_purchases')
                .update({
                  production_status: 'ready',
                  delivered_at: new Date().toISOString(),
                })
                .eq('id', purchaseId);
            }
          } catch (emailError) {
            console.error('Error calling email function:', emailError);
          }
        }

        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 400 }
    );
  }
});
