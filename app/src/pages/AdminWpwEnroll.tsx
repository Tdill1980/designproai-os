/**
 * AdminWpwEnroll — enrolls WPW customers in the 5-email + 4-SMS drip.
 *
 * Workflow:
 *   1. Click "Seed templates" once (idempotent) so email_templates has
 *      the 5 wpw-offer-* (or wpw-offer-*-vertical) rows referenced by
 *      MIGHTYMAIL_SERIES.
 *   2. Paste customer list (one per line: "email, phone, name").
 *   3. Pick orientation (16:9 / 9:16) and click "Enroll N customers".
 *   4. Each row triggers fireWpwOfferSeries() which inserts:
 *        - 5 scheduled_emails rows (Day 0/2/5/8/12)
 *        - 4 scheduled_sms rows  (Day 0/3/7/11)
 *      Cron workers (every 5 min) pick up due rows and send.
 *
 * Cancellation: stopWpwOfferSeries(customerId) cancels all remaining
 * pending email + SMS rows (e.g. when customer subscribes mid-drip).
 *
 * Route: /admin/wpw-enroll (admin/tester only via RequireAuth)
 */

import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, CheckCircle2, Database, Send, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { supabase } from '@/integrations/supabase/client';
import {
  fireWpwOfferSeries,
  seedWpwOfferTemplates,
  type WpwOrientation,
} from '@/lib/mightymail-orchestration';

interface ParsedCustomer {
  email: string;
  phone?: string;
  name: string;
  raw: string;
  valid: boolean;
}

type AudienceSource = 'manual' | 'subscribers';

/** Pre-canned audience presets — each maps to an email_subscribers `source`
 *  filter. Counts are fetched live so the admin sees the real list size. */
const SUBSCRIBER_PRESETS: Array<{
  value: string;
  label: string;
  description: string;
}> = [
  {
    value: 'wpw_past_customer',
    label: 'WPW Past Customers (the 9k+ list)',
    description: 'Imported via wpw-customers-import — past WePrintWraps order history.',
  },
  {
    value: 'quotetool',
    label: 'QuoteTool Leads',
    description: 'Customers who built a quote on /quotetool or /quick-quote (capture coming).',
  },
  {
    value: 'marketplace_browse',
    label: 'Marketplace Browsers',
    description: 'Cold leads — visited marketplace listings.',
  },
  {
    value: 'marketplace_name_preview',
    label: 'Name Preview Leads (warm)',
    description: 'Saw a name preview / mockup but did not check out.',
  },
  {
    value: 'marketplace_checkout',
    label: 'Checkout Attempts (hot)',
    description: 'Started checkout — highest intent.',
  },
  {
    value: 'club_restylepro_marketplace',
    label: 'ClubRestylePro Members',
    description: 'Subscribed to the marketplace club.',
  },
  {
    value: 'beta_program',
    label: 'Beta Program',
    description: 'Beta testers from early access.',
  },
  {
    value: 'launch_waitlist',
    label: 'Launch Waitlist',
    description: 'Pre-launch interest list.',
  },
];

interface SubscriberRow {
  email: string;
  metadata: Record<string, unknown> | null;
}

const parseCustomers = (input: string): ParsedCustomer[] =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split(',').map((p) => p.trim());
      const email = parts[0] ?? '';
      const phone = parts[1] || undefined;
      const name = parts[2] || email.split('@')[0] || 'there';
      const valid = /.+@.+\..+/.test(email);
      return { email, phone, name, raw, valid };
    });

/** Convert email_subscribers row → ParsedCustomer using metadata fields
 *  (first_name, last_name, phone) when present. */
const subscriberToCustomer = (row: SubscriberRow): ParsedCustomer => {
  const md = row.metadata ?? {};
  const first = (md.first_name as string | undefined)?.trim();
  const last = (md.last_name as string | undefined)?.trim();
  const name =
    [first, last].filter(Boolean).join(' ').trim() ||
    row.email.split('@')[0] ||
    'there';
  const phone = (md.phone as string | undefined)?.trim() || undefined;
  return {
    email: row.email,
    phone,
    name,
    raw: row.email,
    valid: /.+@.+\..+/.test(row.email),
  };
};

export default function AdminWpwEnroll() {
  const [orientation, setOrientation] = useState<WpwOrientation>('horizontal');
  const [audienceSource, setAudienceSource] = useState<AudienceSource>('subscribers');
  const [subscriberPreset, setSubscriberPreset] = useState('wpw_past_customer');
  const [subscriberLimit, setSubscriberLimit] = useState<number>(100);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [subscriberLoading, setSubscriberLoading] = useState(false);
  const [listInput, setListInput] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: number; messages: string[] } | null>(null);

  const pasted = useMemo(() => parseCustomers(listInput), [listInput]);
  const pastedValid = pasted.filter((c) => c.valid);
  const pastedInvalid = pasted.filter((c) => !c.valid);

  // Live count of available subscribers when the preset changes.
  useEffect(() => {
    if (audienceSource !== 'subscribers') return;
    let cancelled = false;
    setSubscriberLoading(true);
    setSubscriberCount(null);
    (async () => {
      const { count, error } = await supabase
        .from('email_subscribers')
        .select('*', { count: 'exact', head: true })
        .eq('source', subscriberPreset)
        .eq('unsubscribed', false);
      if (cancelled) return;
      setSubscriberLoading(false);
      if (error) {
        console.error('subscriber count error:', error);
        toast.error(`Failed to count: ${error.message}`);
        setSubscriberCount(0);
      } else {
        setSubscriberCount(count ?? 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audienceSource, subscriberPreset]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await seedWpwOfferTemplates(orientation);
      if (result.success) {
        toast.success(`Seeded ${result.upserted} templates (${orientation}).`, {
          description: 'email_templates is now in sync with wpwOfferCampaign.ts.',
        });
      } else {
        toast.error(`Seeded ${result.upserted}, ${result.errors.length} errors. Check console.`);
        console.error('seedWpwOfferTemplates errors:', result.errors);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to seed templates');
    } finally {
      setSeeding(false);
    }
  };

  /** Fetch the chosen subscriber list (capped to subscriberLimit) and
   *  return as ParsedCustomer rows. */
  const fetchSubscriberAudience = async (): Promise<ParsedCustomer[]> => {
    const limit = Math.max(1, Math.min(subscriberLimit || 1, 5000));
    const { data, error } = await supabase
      .from('email_subscribers')
      .select('email, metadata')
      .eq('source', subscriberPreset)
      .eq('unsubscribed', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw new Error(`email_subscribers fetch failed: ${error.message}`);
    }
    return (data as SubscriberRow[]).map(subscriberToCustomer).filter((c) => c.valid);
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    setResults(null);
    let ok = 0;
    let failed = 0;
    const messages: string[] = [];

    let audienceList: ParsedCustomer[];
    try {
      audienceList =
        audienceSource === 'manual'
          ? pastedValid
          : await fetchSubscriberAudience();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load audience');
      setEnrolling(false);
      return;
    }

    if (audienceList.length === 0) {
      toast.error('No valid customers to enroll');
      setEnrolling(false);
      return;
    }

    for (const c of audienceList) {
      try {
        const r = await fireWpwOfferSeries({
          customerId: c.email,
          customerEmail: c.email,
          customerPhone: c.phone,
          customerName: c.name,
          orientation,
        });
        if (r.success) {
          ok++;
          messages.push(
            `✓ ${c.email}${c.phone ? ' + SMS' : ''} — emails ${r.email.inserted}, sms ${r.sms?.inserted ?? 0}`,
          );
        } else {
          failed++;
          messages.push(
            `✗ ${c.email} — email error: ${r.email.error ?? 'unknown'}, sms error: ${r.sms?.error ?? 'n/a'}`,
          );
        }
      } catch (err: any) {
        failed++;
        messages.push(`✗ ${c.email} — ${err?.message || 'unhandled error'}`);
      }
    }

    setResults({ ok, failed, messages });
    if (failed === 0) {
      toast.success(`Enrolled ${ok} customers in WPW drip (${orientation}).`);
    } else {
      toast.error(`Enrolled ${ok}, ${failed} failed. See log below.`);
    }
    setEnrolling(false);
  };

  // Number that actually feeds the enroll button (from manual or query)
  const enrollPreviewCount =
    audienceSource === 'manual'
      ? pastedValid.length
      : Math.min(subscriberCount ?? 0, subscriberLimit || 0);

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#0F172A]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Helmet>
        <title>WPW Drip Enrollment — RestylePro</title>
      </Helmet>

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <p className="text-[11px] font-mono tracking-widest text-slate-500 mb-2">CAMPAIGN STUDIO</p>
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">
            <span style={{ backgroundImage: 'linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              WPW Customer
            </span>{' '}
            Subscribe Drip — bulk enroll
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl mt-1">
            Paste a list, pick an orientation, click enroll. Each customer gets 5 scheduled emails (Day 0 / 2 / 5 / 8 / 12) and 4 scheduled SMS (Day 0 / 3 / 7 / 11). Both run on cron — emails via send-templated-email, SMS via Twilio.
          </p>
        </div>

        {/* Orientation picker */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Pick the landing variant</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={orientation}
              onValueChange={(v) => setOrientation(v as WpwOrientation)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${orientation === 'horizontal' ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <RadioGroupItem value="horizontal" id="o-h" />
                <div>
                  <p className="text-sm font-bold">16:9 Horizontal</p>
                  <p className="text-xs text-slate-600">Landing: <code>/wpw-offer</code> · YouTube-style hero</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${orientation === 'vertical' ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <RadioGroupItem value="vertical" id="o-v" />
                <div>
                  <p className="text-sm font-bold">9:16 Vertical (Reels)</p>
                  <p className="text-xs text-slate-600">Landing: <code>/wpw-offer-vertical</code> · TikTok/Reels-style hero</p>
                </div>
              </label>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Seed templates */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">2. Seed email templates (one-time per orientation)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 mb-3">
              Inserts/upserts the 5 <code className="text-xs">wpw-offer-*</code> rows into <code className="text-xs">email_templates</code> from the rendered HTML in <code className="text-xs">src/data/wpwOfferCampaign.ts</code>. Idempotent — safe to re-click after copy edits.
            </p>
            <Button onClick={handleSeed} disabled={seeding} variant="outline">
              <Database className="w-4 h-4 mr-2" />
              {seeding ? 'Seeding…' : `Seed ${orientation} templates`}
            </Button>
          </CardContent>
        </Card>

        {/* Audience picker */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Pick the audience</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={audienceSource}
              onValueChange={(v) => setAudienceSource(v as AudienceSource)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4"
            >
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${audienceSource === 'subscribers' ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <RadioGroupItem value="subscribers" id="aud-subs" />
                <div>
                  <p className="text-sm font-bold flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Pull from email_subscribers</p>
                  <p className="text-xs text-slate-600">9k+ WPW past customers, marketplace browsers, beta, etc.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${audienceSource === 'manual' ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <RadioGroupItem value="manual" id="aud-manual" />
                <div>
                  <p className="text-sm font-bold">Paste manually</p>
                  <p className="text-xs text-slate-600">For one-off lists / testing.</p>
                </div>
              </label>
            </RadioGroup>

            {/* Subscriber preset picker */}
            {audienceSource === 'subscribers' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1.5 block">
                    List
                  </Label>
                  <Select value={subscriberPreset} onValueChange={setSubscriberPreset}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBSCRIBER_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-600 mt-1.5">
                    {SUBSCRIBER_PRESETS.find((p) => p.value === subscriberPreset)?.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="sub-limit" className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1.5 block">
                      Max recipients (cap)
                    </Label>
                    <Input
                      id="sub-limit"
                      type="number"
                      min={1}
                      max={5000}
                      step={50}
                      value={subscriberLimit}
                      onChange={(e) => setSubscriberLimit(Number(e.target.value) || 100)}
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Start small for safety (e.g. 100). Hard cap 5,000 per enroll.
                    </p>
                  </div>
                  <div className="flex flex-col">
                    <Label className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1.5 block">
                      Available
                    </Label>
                    <div className="flex-1 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 flex items-center">
                      {subscriberLoading ? (
                        <span className="text-xs text-slate-500">Counting…</span>
                      ) : (
                        <span className="text-sm font-bold text-slate-900 font-mono">
                          {subscriberCount?.toLocaleString() ?? '—'}{' '}
                          <span className="text-xs font-normal text-slate-600">
                            in this segment{subscriberCount !== null && subscriberCount > subscriberLimit ? ` (will enroll first ${subscriberLimit.toLocaleString()})` : ''}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Manual paste */}
            {audienceSource === 'manual' && (
              <div>
                <Label htmlFor="customer-list" className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-2 block">
                  Format: <code>email, +phone (optional), first name (optional)</code> — one per line
                </Label>
                <Textarea
                  id="customer-list"
                  value={listInput}
                  onChange={(e) => setListInput(e.target.value)}
                  placeholder={`john@shopname.com, +15555550100, John\nlance@weprintwraps.com\nbrice@weprintwraps.com, , Brice`}
                  className="font-mono text-sm min-h-[180px]"
                />
                <div className="flex items-center justify-between text-xs text-slate-600 mt-2">
                  <span>
                    <strong className="text-emerald-700">{pastedValid.length}</strong> valid ·{' '}
                    {pastedInvalid.length > 0 && (
                      <strong className="text-rose-600">{pastedInvalid.length} invalid</strong>
                    )}
                  </span>
                  <span>
                    {pastedValid.filter((c) => c.phone).length} with phone (will get SMS) ·{' '}
                    {pastedValid.filter((c) => !c.phone).length} email-only
                  </span>
                </div>
                {pastedInvalid.length > 0 && (
                  <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
                    Skipping {pastedInvalid.length} invalid: {pastedInvalid.slice(0, 3).map((c) => c.raw).join(' / ')}
                    {pastedInvalid.length > 3 && ` + ${pastedInvalid.length - 3} more`}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Enroll */}
        <div className="flex justify-end">
          <Button
            onClick={handleEnroll}
            disabled={enrolling || enrollPreviewCount === 0}
            size="lg"
            className="text-white"
            style={{ background: 'linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1)', boxShadow: '0 6px 16px rgba(59,130,246,0.30)' }}
          >
            <Send className="w-4 h-4 mr-2" />
            {enrolling ? 'Enrolling…' : `Enroll ${enrollPreviewCount.toLocaleString()} customer${enrollPreviewCount === 1 ? '' : 's'} in WPW drip`}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        {/* Results */}
        {results && (
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className={`w-5 h-5 ${results.failed === 0 ? 'text-emerald-600' : 'text-amber-600'}`} />
                Enrollment results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm mb-3">
                <span><strong className="text-emerald-700">{results.ok}</strong> succeeded</span>
                <span><strong className="text-rose-600">{results.failed}</strong> failed</span>
              </div>
              <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 max-h-[280px] overflow-y-auto">
                {results.messages.map((m, i) => (
                  <p key={i} className="text-[12px] font-mono text-slate-800 leading-relaxed">{m}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sanity sidebar */}
        <Card className="mt-6 bg-sky-50 border-sky-200">
          <CardContent className="pt-5">
            <p className="text-[11px] font-mono uppercase tracking-wider text-sky-700 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              How it fires
            </p>
            <ul className="text-[12px] text-sky-900 space-y-1 leading-relaxed">
              <li><strong>Email:</strong> 5 rows in <code>scheduled_emails</code> → <code>process-scheduled-emails</code> cron (every 5 min) → <code>send-templated-email</code> → SMTP</li>
              <li><strong>SMS:</strong> 4 rows in <code>scheduled_sms</code> → <code>process-scheduled-sms</code> cron (every 5 min) → Twilio Messages API</li>
              <li><strong>Cancel:</strong> call <code>stopWpwOfferSeries(customerId)</code> when a customer subscribes — kills all remaining pending rows for that source_ref</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
