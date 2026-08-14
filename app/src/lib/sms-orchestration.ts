// ─────────────────────────────────────────────────────────────────────
// SMS Orchestration — client helpers (mirrors mightymail-orchestration)
//
// The email side has scheduled_emails + process-scheduled-emails cron.
// This module is the SMS counterpart: it inserts rows into scheduled_sms
// and lets the process-scheduled-sms cron pick them up.
//
// Pattern:
//   1. Define a series here (slug + delayDays + body template).
//   2. Call enqueueSmsSeries('wpw-offer', { sourceRef, phone, name, ... })
//      to schedule every SMS in the series for one recipient.
//   3. process-scheduled-sms (every 5 min) picks up pending rows and
//      sends via Twilio.
//   4. Cancel remaining pending rows with cancelSmsSeries(sourceRef).
//
// Source ref convention mirrors email: "<series-id>:<entity-id>".
// ─────────────────────────────────────────────────────────────────────

import { supabase } from '@/integrations/supabase/client';

export interface SmsSeriesEntry {
  /** Stable id (used for source_ref / cancellation). */
  id: string;
  delayDays: number;
  delayLabel: string;
  /** Body template — supports {{customer_name}} merge tag. */
  body: string;
  description: string;
}

export interface SmsSeries {
  id: string;
  name: string;
  description: string;
  entries: SmsSeriesEntry[];
}

// /wpw-offer + /wpw-offer-vertical retired — both redirect to /pricing.
const OFFER_URL = 'https://designproai.com/pricing';
const OFFER_URL_VERTICAL = 'https://designproai.com/pricing';

/**
 * SMS series definitions. Mirrors MIGHTYMAIL_SERIES on the email side
 * but the body lives inline (no SMS template table).
 */
export const SMS_SERIES: SmsSeries[] = [
  {
    id: 'wpw-offer',
    name: 'WPW Customer Subscribe Drip',
    description:
      '4-message SMS drip sent in lockstep with the email drip. Drives WPW shop owners to lock in WPW Family pricing — $50/mo off every tier, for life.',
    entries: [
      {
        id: 'wpw-offer-sms-intro',
        delayDays: 0,
        delayLabel: 'Day 0',
        description: 'Initial nudge — design tool free + WPW Family pricing',
        body: `{{customer_name}} — try a design tool free. WPW Family pricing $50/mo off every tier, for life. Print-ready files in 48hrs: ${OFFER_URL}  STOP to opt out.`,
      },
      {
        id: 'wpw-offer-sms-walkthrough',
        delayDays: 3,
        delayLabel: 'Day 3',
        description: 'Walkthrough nudge',
        body: `{{customer_name}}, did you watch the 2-min walkthrough yet? Visualizer → DesignPro → 48hr WrapBox files: ${OFFER_URL}`,
      },
      {
        id: 'wpw-offer-sms-pricing',
        delayDays: 7,
        delayLabel: 'Day 7',
        description: 'Pricing nudge',
        body: `{{customer_name}} — WPW Family pricing locks $50/mo off every tier for life: Starter $300, DesignPro Lite $449, Studio $649, Plus $945. Subscribe: ${OFFER_URL}`,
      },
      {
        id: 'wpw-offer-sms-lastcall',
        delayDays: 11,
        delayLabel: 'Day 11',
        description: 'Last call — WPW Family pricing reminder',
        body: `Last call {{customer_name}} — WPW Family pricing locks $50/mo off every tier for life. Starter just $300/mo. Lock it in: ${OFFER_URL}`,
      },
    ],
  },
];

export interface EnqueueSmsSeriesOptions {
  /** Convention: "<series-id>:<entity-id>" e.g. "wpw-offer:phone:+15555550100". */
  sourceRef: string;
  recipientPhone: string;
  recipientName?: string;
  /** Override the URL embedded in body templates — pass OFFER_URL_VERTICAL
   *  to switch the campaign to the 9:16 landing variant. */
  landingOverride?: 'horizontal' | 'vertical';
  /** When the delays are relative to. Defaults to now(). */
  anchorAt?: Date;
  /** Optional campaign label for reporting. */
  campaignName?: string;
}

export interface EnqueueSmsResult {
  success: boolean;
  inserted: number;
  ids: string[];
  error?: string;
}

export function getSmsSeries(seriesId: string): SmsSeries {
  const series = SMS_SERIES.find((s) => s.id === seriesId);
  if (!series) throw new Error(`Unknown SMS series id: ${seriesId}`);
  return series;
}

/**
 * Enqueue every SMS in a series for a single recipient. Each row goes
 * into scheduled_sms with send_at = anchorAt + delayDays.
 */
export async function enqueueSmsSeries(
  seriesId: string,
  opts: EnqueueSmsSeriesOptions,
): Promise<EnqueueSmsResult> {
  const series = getSmsSeries(seriesId);
  const anchor = opts.anchorAt ?? new Date();

  const { data: { user } } = await supabase.auth.getUser();

  const rows = series.entries.map((entry) => {
    const sendAt = new Date(anchor);
    sendAt.setUTCDate(sendAt.getUTCDate() + entry.delayDays);
    let body = entry.body;
    if (opts.landingOverride === 'vertical') {
      body = body.replace(/https:\/\/restyleproai\.com\/wpw-offer(?!-vertical)/g, OFFER_URL_VERTICAL);
    }
    return {
      send_at: sendAt.toISOString(),
      recipient_phone: opts.recipientPhone,
      recipient_name: opts.recipientName ?? null,
      body,
      campaign_name: opts.campaignName ?? series.name,
      source: seriesId,
      source_ref: opts.sourceRef,
      created_by: user?.id ?? null,
    };
  });

  const { data, error } = await supabase
    .from('scheduled_sms')
    .insert(rows)
    .select('id');

  if (error) {
    console.error(`enqueueSmsSeries(${seriesId}) failed:`, error);
    return { success: false, inserted: 0, ids: [], error: error.message };
  }

  return {
    success: true,
    inserted: data?.length ?? 0,
    ids: (data ?? []).map((r: { id: string }) => r.id),
  };
}

/**
 * Cancel remaining pending SMS rows for a sourceRef. Already-sent rows
 * are untouched. Use when the customer takes the desired action.
 */
export async function cancelSmsSeries(sourceRef: string): Promise<{ success: boolean; cancelled: number; error?: string }> {
  const { error, count } = await supabase
    .from('scheduled_sms')
    .update({ status: 'cancelled' })
    .eq('source_ref', sourceRef)
    .eq('status', 'pending');

  if (error) return { success: false, cancelled: 0, error: error.message };
  return { success: true, cancelled: count ?? 0 };
}
