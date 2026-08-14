import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Send, Copy, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SMS_TEMPLATES, SmsTemplate } from '@/components/campaigns/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function AdminSmsCampaigns() {
  const navigate = useNavigate();
  const [messageBody, setMessageBody] = useState('');
  const [recipientList, setRecipientList] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);

  const charCount = messageBody.length;
  const smsSegments = Math.ceil(charCount / 160) || 0;

  const parseRecipients = () => {
    return recipientList
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        // Support "phone,name" or just "phone"
        const parts = line.split(',').map(p => p.trim());
        return { phone: parts[0], name: parts[1] || undefined };
      })
      .filter(r => r.phone);
  };

  const handleSelectTemplate = (template: SmsTemplate) => {
    setMessageBody(template.body);
    setCampaignName(template.name);
    toast.success(`Loaded: ${template.name}`);
  };

  const handleSend = async () => {
    const recipients = parseRecipients();
    if (!recipients.length) {
      toast.error('Add at least one phone number');
      return;
    }
    if (!messageBody.trim()) {
      toast.error('Message body is empty');
      return;
    }
    setConfirmSend(true);
  };

  const handleConfirmSend = async () => {
    setConfirmSend(false);
    setSending(true);
    const recipients = parseRecipients();

    try {
      const { data, error } = await supabase.functions.invoke('send-sms-campaign', {
        body: {
          recipients,
          messageTemplate: messageBody,
          campaignName: campaignName || 'SMS Campaign',
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`SMS sent! ${data.sent} delivered, ${data.failed} failed of ${data.total} total.`);
      } else {
        toast.error(data?.error || 'Failed to send SMS campaign');
      }
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast.error(error.message || 'Failed to send SMS campaign');
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleAt) {
      toast.error('Pick a date and time first');
      return;
    }
    const sendAtIso = new Date(scheduleAt).toISOString();
    if (new Date(sendAtIso).getTime() <= Date.now()) {
      toast.error('Schedule time must be in the future');
      return;
    }
    const recipients = parseRecipients();
    if (!recipients.length) {
      toast.error('Add at least one phone number');
      return;
    }
    if (!messageBody.trim()) {
      toast.error('Message body is empty');
      return;
    }
    setScheduling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = recipients.map(r => ({
        send_at: sendAtIso,
        recipient_phone: r.phone,
        recipient_name: r.name ?? null,
        body: messageBody,
        campaign_name: campaignName || 'SMS Campaign',
        source: 'manual_schedule',
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from('scheduled_sms').insert(rows);
      if (error) throw error;
      toast.success(
        `Scheduled ${rows.length} SMS for ${new Date(sendAtIso).toLocaleString()}`,
      );
      setScheduleAt('');
    } catch (err: any) {
      console.error('Error scheduling SMS:', err);
      toast.error(err?.message || 'Failed to schedule SMS');
    } finally {
      setScheduling(false);
    }
  };

  const recipients = parseRecipients();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-green-600">
                <MessageSquare className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">SMS Campaigns</h1>
                <p className="text-sm text-muted-foreground">Send text message campaigns via Twilio</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Compose */}
          <div className="lg:col-span-2 space-y-6">
            {/* Campaign Name */}
            <div className="p-5 border border-border rounded-lg bg-card">
              <Label>Campaign Name</Label>
              <Input
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g., WePrintWraps Friends & Family SMS"
              />
            </div>

            {/* Message Composer */}
            <div className="p-5 border border-border rounded-lg bg-card space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Message Body</Label>
                <div className="flex items-center gap-3">
                  <Badge variant={charCount > 160 ? 'destructive' : 'secondary'}>
                    {charCount} chars
                  </Badge>
                  <Badge variant="outline">
                    {smsSegments} SMS segment{smsSegments !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </div>
              <Textarea
                value={messageBody}
                onChange={e => setMessageBody(e.target.value)}
                placeholder="Type your SMS message here. Use {{customer_name}} for personalization."
                rows={6}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                160 chars = 1 SMS segment. Messages over 160 chars are sent as multiple segments.
                Always include "Reply STOP to opt out" for compliance.
              </p>
            </div>

            {/* Recipients */}
            <div className="p-5 border border-border rounded-lg bg-card space-y-4">
              <Label className="text-base font-semibold">Recipients</Label>
              <Textarea
                value={recipientList}
                onChange={e => setRecipientList(e.target.value)}
                placeholder={"+15551234567,John Smith\n+15559876543,Jane Doe\n+15551112222"}
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                One per line. Format: <code>+1XXXXXXXXXX,Name</code> (name is optional).
                Include country code (+1 for US).
              </p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</span>
                <span>{smsSegments} segment{smsSegments !== 1 ? 's' : ''} x {recipients.length} = ~{smsSegments * recipients.length} total SMS</span>
              </div>
            </div>

            {/* Schedule for Later */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 mb-3">
              <Label htmlFor="sms-schedule-at" className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 block">
                Schedule for Later (optional)
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="sms-schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-auto flex-1 min-w-[220px]"
                />
                <Button
                  variant="outline"
                  onClick={handleSchedule}
                  disabled={scheduling || !scheduleAt || !messageBody.trim() || recipients.length === 0}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  {scheduling ? 'Scheduling…' : `Schedule ${recipients.length} SMS`}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Inserts into <code>scheduled_sms</code>; cron worker fires Twilio every 5 min.
              </p>
            </div>

            {/* Send Now */}
            <div className="flex justify-end gap-3">
              <Button
                onClick={handleSend}
                disabled={sending || !messageBody.trim() || recipients.length === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                <Send className="h-4 w-4 mr-2" />
                {sending ? 'Sending...' : `Send Now to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>

          {/* Right: Templates */}
          <div className="space-y-6">
            <div className="p-4 border border-border rounded-lg bg-card space-y-3">
              <Label className="text-base font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-green-400" />
                SMS Templates
              </Label>
              <p className="text-xs text-muted-foreground">Click to load a pre-built message</p>
              <div className="flex flex-col gap-3">
                {SMS_TEMPLATES.map(template => (
                  <Card
                    key={template.id}
                    className="cursor-pointer hover:border-green-500/50 transition-all"
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm text-foreground">{template.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                        </div>
                        <Copy className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 font-mono">{template.body.substring(0, 80)}...</p>
                      <Badge variant="outline" className="mt-2 text-[10px]">{template.body.length} chars</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Tips */}
            <div className="p-4 border border-border rounded-lg bg-card space-y-3">
              <Label className="text-base font-semibold">SMS Best Practices</Label>
              <ul className="text-xs text-muted-foreground space-y-2">
                <li>Keep messages under 160 chars when possible</li>
                <li>Always include opt-out: "Reply STOP to opt out"</li>
                <li>Lead with value, not your brand name</li>
                <li>Include one clear call-to-action with a URL</li>
                <li>Use {"{{customer_name}}"} for personalization</li>
                <li>Send during business hours (9am-6pm local)</li>
              </ul>
            </div>

            {/* Twilio Setup */}
            <div className="p-4 border border-border rounded-lg bg-card space-y-3">
              <Label className="text-base font-semibold">Twilio Setup</Label>
              <p className="text-xs text-muted-foreground">
                Set these Supabase secrets to enable SMS:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 font-mono">
                <li>TWILIO_ACCOUNT_SID</li>
                <li>TWILIO_AUTH_TOKEN</li>
                <li>TWILIO_PHONE_NUMBER</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmSend} onOpenChange={() => setConfirmSend(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send SMS Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send {smsSegments * recipients.length} SMS message{smsSegments * recipients.length !== 1 ? 's' : ''} to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}.
              <br /><br />
              <strong>Standard SMS rates apply via Twilio. This cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSend} className="bg-green-600 hover:bg-green-700">
              Send Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
