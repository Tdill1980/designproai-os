// ─────────────────────────────────────────────────────────────────────
// MightyMail Orchestration — client helpers
//
// Wire app events to MightyMail series. The TS spec in
// `mightymail-series.ts` is the source of truth for what each series
// contains and when. This module just turns "trigger this event" into a
// queue of rows in public.scheduled_emails (via the edge function).
//
// Pattern:
//   1. App event happens (e.g. proof_sent).
//   2. Call enqueueSeries('approvepro', { sourceRef, recipientEmail, ... }).
//   3. Cron worker (process-scheduled-emails, every 5 min) picks up
//      pending rows and sends them via send-templated-email.
//   4. If the customer takes the desired action (e.g. approves proof),
//      call cancelSeries(sourceRef) to nuke remaining queued emails.
//
// Source ref convention (chose for easy querying / cancellation):
//   "<series-id>:<entity-id>"
//   e.g. "approvepro:<proof_id>"
//        "mvp-12month:<myvehicle_id>"
//        "productionflow-upsell:<install_id>"
//        "retargeting:<quote_id>"
// ─────────────────────────────────────────────────────────────────────

import { supabase } from '@/integrations/supabase/client';
import { MIGHTYMAIL_SERIES, MightyMailSeries } from './mightymail-series';

export interface EnqueueSeriesOptions {
  /** Unique-per-customer-event identifier so we can cancel later. Convention:
   *  "<series-id>:<entity-id>" e.g. "approvepro:<proof-uuid>". */
  sourceRef: string;
  recipientEmail: string;
  shopId?: string | null;
  /** Merge data for the email template (customer_name, vehicle_name, etc). */
  mergeData?: Record<string, unknown>;
  /** Optional reference timestamp the delays are relative to. Defaults to now. */
  anchorAt?: Date;
}

export interface EnqueueResult {
  success: boolean;
  inserted: number;
  ids: string[];
  error?: string;
}

/** Resolve a series id from MIGHTYMAIL_SERIES. Throws if unknown. */
export function getSeries(seriesId: string): MightyMailSeries {
  const series = MIGHTYMAIL_SERIES.find((s) => s.id === seriesId);
  if (!series) throw new Error(`Unknown MightyMail series id: ${seriesId}`);
  return series;
}

/**
 * Enqueue every email in a series for a single recipient. Each email is
 * scheduled at anchorAt + delayDays.
 */
export async function enqueueSeries(
  seriesId: string,
  opts: EnqueueSeriesOptions,
): Promise<EnqueueResult> {
  const series = getSeries(seriesId);

  // Skip emails marked manualOnly — they fire on a different trigger
  // (e.g. ap-05-approved waits for customer approval, not proof_sent).
  const emails = series.emails
    .filter((e) => !e.manualOnly)
    .map((e) => ({
      slug: e.slug,
      delayDays: e.delayDays ?? 0,
    }));

  const { data, error } = await supabase.functions.invoke('mightymail-enqueue-series', {
    body: {
      seriesId,
      sourceRef: opts.sourceRef,
      recipientEmail: opts.recipientEmail,
      shopId: opts.shopId ?? null,
      mergeData: opts.mergeData ?? {},
      emails,
      anchorAt: opts.anchorAt?.toISOString(),
    },
  });

  if (error) {
    console.error(`enqueueSeries(${seriesId}) failed:`, error);
    return { success: false, inserted: 0, ids: [], error: error.message };
  }
  return data as EnqueueResult;
}

/**
 * Cancel remaining pending emails for a sourceRef. Already-sent emails
 * are untouched. Use when the customer takes the desired action.
 */
export async function cancelSeries(sourceRef: string, reason?: string) {
  const { data, error } = await supabase.functions.invoke('mightymail-cancel-series', {
    body: { sourceRef, reason },
  });
  if (error) {
    console.error(`cancelSeries(${sourceRef}) failed:`, error);
    return { success: false, cancelled: 0, error: error.message };
  }
  return data as { success: boolean; cancelled: number };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience wrappers — one per series the app needs to fire. Each one
// builds the canonical sourceRef, picks the right merge keys, and calls
// enqueueSeries. Add new wrappers here as you wire trigger points.
// ─────────────────────────────────────────────────────────────────────

/** ApprovePro: customer just received a proof. */
export async function fireApproveProSeries(args: {
  proofId: string;
  customerEmail: string;
  customerName: string;
  vehicleName: string;
  proofUrl: string;
  shopId?: string | null;
}) {
  return enqueueSeries('approvepro', {
    sourceRef: `approvepro:${args.proofId}`,
    recipientEmail: args.customerEmail,
    shopId: args.shopId,
    mergeData: {
      customer_name: args.customerName,
      vehicle_name: args.vehicleName,
      proof_url: args.proofUrl,
    },
  });
}

/** Customer approved/declined the proof — stop the chase. */
export async function stopApproveProSeries(proofId: string, reason = 'proof resolved') {
  return cancelSeries(`approvepro:${proofId}`, reason);
}

/** MyVehiclePro: customer just visualized their car. Kicks off 12-month drip. */
export async function fireMyVehicleProSeries(args: {
  myVehicleId: string;
  customerEmail: string;
  customerName: string;
  bookingUrl: string;
  shopId?: string | null;
}) {
  return enqueueSeries('mvp-12month', {
    sourceRef: `mvp-12month:${args.myVehicleId}`,
    recipientEmail: args.customerEmail,
    shopId: args.shopId,
    mergeData: {
      customer_name: args.customerName,
      booking_url: args.bookingUrl,
    },
  });
}

/** ProductionFlow upsell: install just completed. */
export async function fireProductionFlowSeries(args: {
  installId: string;
  customerEmail: string;
  customerName: string;
  bookingUrl: string;
  reviewUrl: string;
  referralUrl: string;
  shopId?: string | null;
}) {
  return enqueueSeries('productionflow-upsell', {
    sourceRef: `productionflow:${args.installId}`,
    recipientEmail: args.customerEmail,
    shopId: args.shopId,
    mergeData: {
      customer_name: args.customerName,
      booking_url: args.bookingUrl,
      review_url: args.reviewUrl,
      referral_url: args.referralUrl,
    },
  });
}

/** Retargeting: customer saw a preview / got a quote and went silent. */
export async function fireRetargetingSeries(args: {
  quoteOrPreviewId: string;
  customerEmail: string;
  customerName: string;
  previewUrl: string;
  bookingUrl: string;
  shopId?: string | null;
}) {
  return enqueueSeries('retargeting', {
    sourceRef: `retargeting:${args.quoteOrPreviewId}`,
    recipientEmail: args.customerEmail,
    shopId: args.shopId,
    mergeData: {
      customer_name: args.customerName,
      preview_url: args.previewUrl,
      booking_url: args.bookingUrl,
    },
  });
}

/** Customer booked / replied — kill the rest of the retarget chase. */
export async function stopRetargetingSeries(quoteOrPreviewId: string, reason = 'customer engaged') {
  return cancelSeries(`retargeting:${quoteOrPreviewId}`, reason);
}

// ─────────────────────────────────────────────────────────────────────
// WPW Customer Subscribe Drip — fires email + SMS in lockstep
// ─────────────────────────────────────────────────────────────────────

import { enqueueSmsSeries, cancelSmsSeries } from './sms-orchestration';
import {
  WPW_OFFER_EMAIL_SERIES_HORIZONTAL,
  WPW_OFFER_EMAIL_SERIES_VERTICAL,
  type CampaignEmail,
} from '@/data/wpwOfferCampaign';

export type WpwOrientation = 'horizontal' | 'vertical';

export interface FireWpwOfferArgs {
  /** Stable id used as `wpw-offer:<id>` for cancellation. Use email or
   *  customer id. */
  customerId: string;
  customerEmail: string;
  customerPhone?: string;
  customerName: string;
  /** 16:9 hero (default) or 9:16 Reels-style hero. */
  orientation?: WpwOrientation;
  shopId?: string | null;
}

/** Enroll one customer in the WPW drip — schedules 5 emails + 4 SMS. */
export async function fireWpwOfferSeries(args: FireWpwOfferArgs): Promise<{
  success: boolean;
  email: EnqueueResult;
  sms?: { success: boolean; inserted: number; error?: string };
}> {
  const orientation = args.orientation ?? 'horizontal';
  const sourceRef = `wpw-offer:${args.customerId}`;

  const email = await enqueueSeries('wpw-offer', {
    sourceRef,
    recipientEmail: args.customerEmail,
    shopId: args.shopId,
    mergeData: {
      customer_name: args.customerName,
      orientation,
      landing_url:
        orientation === 'vertical'
          ? 'https://restyleproai.com/wpw-offer-vertical'
          : 'https://restyleproai.com/wpw-offer',
    },
  });

  let sms: { success: boolean; inserted: number; error?: string } | undefined;
  if (args.customerPhone) {
    sms = await enqueueSmsSeries('wpw-offer', {
      sourceRef,
      recipientPhone: args.customerPhone,
      recipientName: args.customerName,
      landingOverride: orientation,
    });
  }

  return {
    success: email.success && (sms?.success ?? true),
    email,
    sms,
  };
}

/** Customer subscribed / unsubscribed — kill the remaining drip. */
export async function stopWpwOfferSeries(customerId: string, reason = 'customer engaged') {
  const sourceRef = `wpw-offer:${customerId}`;
  const [emailResult, smsResult] = await Promise.all([
    cancelSeries(sourceRef, reason),
    cancelSmsSeries(sourceRef),
  ]);
  return {
    success: emailResult.success && smsResult.success,
    cancelled: (emailResult.cancelled ?? 0) + (smsResult.cancelled ?? 0),
  };
}

/**
 * Idempotent seeder — inserts/upserts the 5 wpw-offer email templates
 * into public.email_templates from the rendered HTML in
 * src/data/wpwOfferCampaign.ts. Pass orientation to choose which
 * landing URL is baked into the bodies.
 *
 * Slug pattern: `wpw-offer-<id>` (horizontal) / `wpw-offer-<id>-vertical`.
 *
 * Run once after the migration ships, or whenever the source-of-truth
 * HTML in wpwOfferCampaign.ts changes.
 */
export async function seedWpwOfferTemplates(
  orientation: WpwOrientation = 'horizontal',
): Promise<{ success: boolean; upserted: number; errors: string[] }> {
  const series: CampaignEmail[] =
    orientation === 'vertical'
      ? WPW_OFFER_EMAIL_SERIES_VERTICAL
      : WPW_OFFER_EMAIL_SERIES_HORIZONTAL;

  const errors: string[] = [];
  let upserted = 0;

  for (const email of series) {
    const slug =
      orientation === 'vertical'
        ? `wpw-offer-${email.id}-vertical`
        : `wpw-offer-${email.id}`;

    const { error } = await supabase.from('email_templates').upsert(
      {
        slug,
        name: `WPW Offer · ${email.id} (${orientation})`,
        subject: email.subject,
        html_content: email.bodyHtml,
        text_content: email.preview,
        from_name: email.fromName,
        from_email: email.fromEmail,
        merge_tags: {
          customer_name: 'Recipient first name',
          customer_email: 'Recipient email',
          current_year: 'Current year',
          unsubscribe_url: 'Unsubscribe link',
        },
        category: 'rp-to-shop',
        is_active: true,
      },
      { onConflict: 'slug' },
    );

    if (error) {
      errors.push(`${slug}: ${error.message}`);
    } else {
      upserted++;
    }
  }

  return { success: errors.length === 0, upserted, errors };
}
