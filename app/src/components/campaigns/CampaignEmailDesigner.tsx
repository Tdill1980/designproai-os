import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Save, Send, Eye, Code, Palette, Type, Image, Link, Minus, Square, LayoutTemplate, Upload, ImagePlus, Edit3, FolderOpen, Trash2, Copy, RefreshCw, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EmailCampaign, AudienceType } from './types';
import { RenderBrowser } from '@/components/RenderBrowser';
import { UploadedAssetsBrowser } from '@/components/UploadedAssetsBrowser';

interface CampaignEmailDesignerProps {
  campaign: Partial<EmailCampaign> | null;
  initialHtml?: string;
  onSave: (campaign: Partial<EmailCampaign>) => Promise<void>;
  onSend: (campaign: Partial<EmailCampaign>) => Promise<void>;
  onSchedule?: (campaign: Partial<EmailCampaign>) => Promise<void>;
  onBack: () => void;
}

// Convert an ISO date string to the "YYYY-MM-DDTHH:mm" value the
// <input type="datetime-local"> control expects (in local TZ).
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const MERGE_TAG_OPTIONS = [
  { tag: '{{customer_name}}', label: 'Customer Name' },
  { tag: '{{customer_email}}', label: 'Customer Email' },
  { tag: '{{unsubscribe_url}}', label: 'Unsubscribe Link' },
  { tag: '{{current_year}}', label: 'Current Year' },
];

export function CampaignEmailDesigner({ campaign, initialHtml, onSave, onSend, onSchedule, onBack }: CampaignEmailDesignerProps) {
  const [name, setName] = useState(campaign?.name || '');
  const [subject, setSubject] = useState(campaign?.subject || '');
  const [htmlContent, setHtmlContent] = useState(campaign?.html_content || initialHtml || '');
  const [fromName, setFromName] = useState(campaign?.from_name || 'DesignProAI');
  const [fromEmail, setFromEmail] = useState(campaign?.from_email || 'hello@restyleproai.com');
  const [audience, setAudience] = useState<AudienceType>(campaign?.audience || 'all_users');
  const [subscriberSource, setSubscriberSource] = useState(campaign?.subscriber_source || '');
  const [customEmails, setCustomEmails] = useState(campaign?.custom_emails?.join('\n') || '');
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>(
    campaign?.status === 'scheduled' || campaign?.scheduled_at ? 'schedule' : 'now'
  );
  const [scheduledAt, setScheduledAt] = useState<string>(isoToLocalInput(campaign?.scheduled_at));
  const [editorTab, setEditorTab] = useState<'visual' | 'html'>('html');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [libraryImages, setLibraryImages] = useState<{ name: string; url: string }[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);

  const topImageRef = useRef<HTMLInputElement>(null);
  const bottomImageRef = useRef<HTMLInputElement>(null);
  const inlineImageRef = useRef<HTMLInputElement>(null);
  const libraryUploadRef = useRef<HTMLInputElement>(null);

  const isSent = campaign?.status === 'sent';

  const loadLibraryImages = async () => {
    setLoadingLibrary(true);
    try {
      const { data, error } = await supabase.storage
        .from('wrap-files')
        .list('email-assets', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });

      if (error) throw error;

      const images = (data || [])
        .filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name))
        .map(f => {
          const { data: { publicUrl } } = supabase.storage
            .from('wrap-files')
            .getPublicUrl(`email-assets/${f.name}`);
          return { name: f.name, url: publicUrl };
        });

      setLibraryImages(images);
    } catch (err: any) {
      console.error('Failed to load library:', err);
      toast.error('Failed to load image library');
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    loadLibraryImages();
  }, []);

  const handleLibraryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 5MB — skipped`);
        continue;
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.[^.]+$/, '');
      const fileName = `email-assets/${safeName}-${Date.now().toString(36)}.${ext}`;

      const { error } = await supabase.storage
        .from('wrap-files')
        .upload(fileName, file, { upsert: true, contentType: file.type });

      if (error) {
        toast.error(`Failed: ${file.name}`);
      } else {
        uploaded++;
      }
    }

    if (uploaded > 0) {
      toast.success(`${uploaded} image${uploaded > 1 ? 's' : ''} uploaded`);
      await loadLibraryImages();
    }
    setUploading(false);
    e.target.value = '';
  };

  const insertLibraryImage = (url: string) => {
    const imgTag = `\n<img src="${url}" alt="Email image" style="width:100%;display:block;border-radius:8px;margin:16px 0" />\n`;
    setHtmlContent(prev => prev + imgTag);
    toast.success('Image inserted');
  };

  const copyImageUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('URL copied to clipboard');
  };

  const deleteLibraryImage = async (name: string) => {
    const { error } = await supabase.storage
      .from('wrap-files')
      .remove([`email-assets/${name}`]);

    if (error) {
      toast.error('Failed to delete image');
    } else {
      toast.success('Image deleted');
      setLibraryImages(prev => prev.filter(i => i.name !== name));
    }
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const fileName = `email-assets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('wrap-files')
        .upload(fileName, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('wrap-files')
        .getPublicUrl(fileName);

      toast.success('Image uploaded');
      loadLibraryImages();
      return publicUrl;
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error(err.message || 'Failed to upload image');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleImageUpload = async (file: File, position: 'top' | 'bottom' | 'inline') => {
    const url = await uploadImage(file);
    if (!url) return;

    const imgTag = `<img src="${url}" alt="Email image" style="width:100%;display:block;border-radius:${position === 'inline' ? '8px' : '0'};margin:${position === 'inline' ? '16px 0' : '0'}" />`;

    if (position === 'top') {
      // Insert image right after the first opening div tag
      const firstDivEnd = htmlContent.indexOf('>');
      if (firstDivEnd > -1) {
        setHtmlContent(prev => prev.slice(0, firstDivEnd + 1) + '\n' + imgTag + '\n' + prev.slice(firstDivEnd + 1));
      } else {
        setHtmlContent(prev => imgTag + '\n' + prev);
      }
    } else if (position === 'bottom') {
      // Insert before the last closing div or at end
      const lastDivIdx = htmlContent.lastIndexOf('</div>');
      if (lastDivIdx > -1) {
        setHtmlContent(prev => prev.slice(0, lastDivIdx) + '\n' + imgTag + '\n' + prev.slice(lastDivIdx));
      } else {
        setHtmlContent(prev => prev + '\n' + imgTag);
      }
    } else {
      setHtmlContent(prev => prev + '\n' + imgTag);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, position: 'top' | 'bottom' | 'inline') => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image must be under 5MB');
        return;
      }
      handleImageUpload(file, position);
    }
    e.target.value = '';
  };

  const buildCampaignData = (): Partial<EmailCampaign> => ({
    id: campaign?.id,
    name,
    subject,
    html_content: htmlContent,
    from_name: fromName,
    from_email: fromEmail,
    audience,
    subscriber_source: audience === 'subscribers' && subscriberSource ? subscriberSource : null,
    custom_emails: audience === 'custom'
      ? customEmails.split('\n').map(e => e.trim()).filter(Boolean)
      : null,
    scheduled_at: sendMode === 'schedule' ? localInputToIso(scheduledAt) : null,
    status: campaign?.status,
  });

  const handleSave = async () => {
    if (!name || !subject) return;
    setSaving(true);
    try {
      await onSave(buildCampaignData());
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!name || !subject || !htmlContent) return;
    setSending(true);
    try {
      await onSend({ ...buildCampaignData(), scheduled_at: null });
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!name || !subject || !htmlContent || !onSchedule) return;
    const iso = localInputToIso(scheduledAt);
    if (!iso) {
      toast.error('Pick a valid date and time');
      return;
    }
    if (new Date(iso).getTime() <= Date.now()) {
      toast.error('Schedule time must be in the future');
      return;
    }
    setScheduling(true);
    try {
      await onSchedule({ ...buildCampaignData(), scheduled_at: iso });
    } finally {
      setScheduling(false);
    }
  };

  const insertMergeTag = (tag: string) => {
    setHtmlContent(prev => prev + tag);
  };

  const insertBlock = (type: string) => {
    const blocks: Record<string, string> = {
      heading: '\n<h1 style="color:#06b6d4;margin:0 0 16px;font-size:24px">Your Heading</h1>\n',
      text: '\n<p style="color:#ccc;line-height:1.7;font-size:15px">Your text content here.</p>\n',
      button: '\n<div style="text-align:center;margin:24px 0"><a href="https://designproai.com" style="display:inline-block;background:#06b6d4;color:#000;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700">Button Text →</a></div>\n',
      divider: '\n<hr style="border:none;border-top:1px solid #333;margin:24px 0"/>\n',
      image: '\n<img src="YOUR_IMAGE_URL" alt="Image" style="width:100%;border-radius:8px;margin:16px 0"/>\n',
      card: '\n<div style="background:#111;border:1px solid #333;border-radius:12px;padding:24px;margin:20px 0">\n  <h3 style="color:#06b6d4;margin:0 0 8px;font-size:16px">Card Title</h3>\n  <p style="color:#999;margin:0;font-size:14px">Card content goes here.</p>\n</div>\n',
      footer: '\n<div style="padding:20px 0;border-top:1px solid #222;margin-top:24px">\n  <p style="color:#666;font-size:12px;margin:0;text-align:center">DesignProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>\n</div>\n',
    };
    setHtmlContent(prev => prev + (blocks[type] || ''));
  };

  // Hidden file inputs
  const hiddenInputs = (
    <>
      <input ref={topImageRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, 'top')} />
      <input ref={bottomImageRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, 'bottom')} />
      <input ref={inlineImageRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, 'inline')} />
      <input ref={libraryUploadRef} type="file" accept="image/*" multiple className="hidden" onChange={handleLibraryUpload} />
    </>
  );

  return (
    <div className="space-y-6">
      {hiddenInputs}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              {isSent ? 'Edit Sent Campaign' : campaign?.id ? 'Edit Campaign' : 'New Campaign'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isSent ? 'Update message content — save to apply changes' : 'Design your email and pick your audience'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving || !name || !subject}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : isSent ? 'Save Changes' : 'Save Draft'}
          </Button>
          {!isSent && sendMode === 'now' && (
            <Button onClick={handleSend} disabled={sending || !name || !subject || !htmlContent}
              className="bg-cyan-600 hover:bg-cyan-700">
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Sending...' : 'Send Now'}
            </Button>
          )}
          {!isSent && sendMode === 'schedule' && (
            <Button onClick={handleSchedule} disabled={scheduling || !name || !subject || !htmlContent || !scheduledAt || !onSchedule}
              className="bg-purple-600 hover:bg-purple-700">
              <CalendarClock className="h-4 w-4 mr-2" />
              {scheduling ? 'Scheduling...' : 'Schedule Send'}
            </Button>
          )}
          {isSent && (
            <Button onClick={handleSend} disabled={sending || !name || !subject || !htmlContent}
              className="bg-orange-600 hover:bg-orange-700">
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Resending...' : 'Resend Campaign'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Settings + Editor */}
        <div className="lg:col-span-2 space-y-6">
          {/* Campaign Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 border border-border rounded-lg bg-card">
            <div className="md:col-span-2">
              <Label>Campaign Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., March Launch Blast" />
            </div>
            <div className="md:col-span-2">
              <Label>Subject Line *</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="e.g., Your wrap game just leveled up" />
              <p className="text-xs text-muted-foreground mt-1">Use merge tags for personalization</p>
            </div>
            <div>
              <Label>From Name</Label>
              <Input value={fromName} onChange={e => setFromName(e.target.value)} />
            </div>
            <div>
              <Label>From Email</Label>
              <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
            </div>
          </div>

          {/* Audience Picker */}
          <div className="p-5 border border-border rounded-lg bg-card space-y-4">
            <Label className="text-base font-semibold">Audience</Label>
            <Select value={audience} onValueChange={v => setAudience(v as AudienceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_users">All Users (auth accounts)</SelectItem>
                <SelectItem value="subscribers">Contact Database (Subscribers + Imported)</SelectItem>
                <SelectItem value="custom">Custom Email List</SelectItem>
              </SelectContent>
            </Select>
            {audience === 'subscribers' && (
              <p className="text-xs text-muted-foreground">
                Sends to everyone in your <span className="text-foreground">email_subscribers</span> database — including leads captured on the site and contacts you've imported. Filter by source below to target a segment.
              </p>
            )}
            {audience === 'subscribers' && (
              <div>
                <Label>Filter by Source (optional)</Label>
                <Select value={subscriberSource} onValueChange={setSubscriberSource}>
                  <SelectTrigger>
                    <SelectValue placeholder="All subscribers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subscribers</SelectItem>
                    <SelectItem value="marketplace_browse">Marketplace Browsers</SelectItem>
                    <SelectItem value="marketplace_name_preview">Name Preview Leads (warm)</SelectItem>
                    <SelectItem value="marketplace_checkout">Checkout Attempts (hot)</SelectItem>
                    <SelectItem value="club_restylepro_marketplace">ClubRestylePro Members</SelectItem>
                    <SelectItem value="beta_program">Beta Program</SelectItem>
                    <SelectItem value="early_access">Early Access</SelectItem>
                    <SelectItem value="launch_waitlist">Launch Waitlist</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {subscriberSource && subscriberSource !== 'all'
                    ? `Targeting: ${subscriberSource.replace(/_/g, ' ')}`
                    : 'Sending to all email subscribers'}
                </p>
              </div>
            )}
            {audience === 'custom' && (
              <div>
                <Label>Email Addresses (one per line)</Label>
                <Textarea
                  value={customEmails}
                  onChange={e => setCustomEmails(e.target.value)}
                  placeholder={"email1@example.com\nemail2@example.com"}
                  rows={5}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {customEmails.split('\n').filter(e => e.trim()).length} recipients
                </p>
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="p-5 border border-border rounded-lg bg-card space-y-4">
            <Label className="text-base font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-purple-400" />
              When to Send
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={sendMode === 'now' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSendMode('now')}
                className={sendMode === 'now' ? 'bg-cyan-600 hover:bg-cyan-700' : ''}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Send Now
              </Button>
              <Button
                type="button"
                variant={sendMode === 'schedule' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSendMode('schedule')}
                className={sendMode === 'schedule' ? 'bg-purple-600 hover:bg-purple-700' : ''}
              >
                <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
                Schedule for Later
              </Button>
            </div>
            {sendMode === 'schedule' && (
              <div className="space-y-2">
                <Label>Send date &amp; time</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={isoToLocalInput(new Date(Date.now() + 60_000).toISOString())}
                />
                <p className="text-xs text-muted-foreground">
                  {scheduledAt
                    ? `Will send on ${new Date(scheduledAt).toLocaleString()} (your local time). The cron worker checks every minute.`
                    : 'Pick a future date and time in your local timezone.'}
                </p>
              </div>
            )}
          </div>

          {/* Email Designer */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            {/* Block Insert Toolbar */}
            <div className="flex flex-wrap gap-1 p-3 border-b border-border bg-zinc-900/50">
              <span className="text-xs text-muted-foreground self-center mr-2">Insert:</span>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('heading')} className="h-7 text-xs gap-1">
                <Type className="h-3 w-3" /> Heading
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('text')} className="h-7 text-xs gap-1">
                <Type className="h-3 w-3" /> Text
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('button')} className="h-7 text-xs gap-1">
                <Square className="h-3 w-3" /> Button
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('card')} className="h-7 text-xs gap-1">
                <LayoutTemplate className="h-3 w-3" /> Card
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('divider')} className="h-7 text-xs gap-1">
                <Minus className="h-3 w-3" /> Divider
              </Button>
              <Button variant="ghost" size="sm" onClick={() => insertBlock('footer')} className="h-7 text-xs gap-1">
                <Link className="h-3 w-3" /> Footer
              </Button>
            </div>

            {/* Image Upload Toolbar */}
            <div className="flex flex-wrap gap-1 p-3 border-b border-border bg-zinc-900/30">
              <span className="text-xs text-muted-foreground self-center mr-2">
                <Upload className="h-3 w-3 inline mr-1" />
                Upload Image:
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => topImageRef.current?.click()}
                disabled={uploading}
                className="h-7 text-xs gap-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
              >
                <ImagePlus className="h-3 w-3" /> Top of Email
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => inlineImageRef.current?.click()}
                disabled={uploading}
                className="h-7 text-xs gap-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              >
                <Image className="h-3 w-3" /> Inline (at cursor)
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => bottomImageRef.current?.click()}
                disabled={uploading}
                className="h-7 text-xs gap-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
              >
                <ImagePlus className="h-3 w-3" /> Bottom of Email
              </Button>
              <RenderBrowser
                onSelect={(url) => {
                  const imgTag = `<img src="${url}" alt="Vehicle wrap render" style="width:100%;display:block;border-radius:8px;margin:16px 0" />`;
                  setHtmlContent(prev => prev + '\n' + imgTag);
                }}
                triggerLabel="From Renders"
                triggerVariant="outline"
                triggerSize="sm"
                triggerClassName="h-7 text-xs gap-1 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              />
              <UploadedAssetsBrowser
                onSelect={(url) => {
                  const imgTag = `<img src="${url}" alt="Email image" style="width:100%;display:block;border-radius:8px;margin:16px 0" />`;
                  setHtmlContent(prev => prev + '\n' + imgTag);
                }}
                triggerLabel="From Uploads"
                triggerVariant="outline"
                triggerSize="sm"
                triggerClassName="h-7 text-xs gap-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              />
              {uploading && (
                <span className="text-xs text-muted-foreground self-center ml-2 animate-pulse">Uploading...</span>
              )}
            </div>

            <Tabs value={editorTab} onValueChange={v => setEditorTab(v as 'visual' | 'html')}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <TabsList>
                  <TabsTrigger value="html" className="gap-1 text-xs">
                    <Code className="h-3 w-3" /> HTML
                  </TabsTrigger>
                  <TabsTrigger value="visual" className="gap-1 text-xs">
                    <Eye className="h-3 w-3" /> Preview
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="html" className="m-0">
                <Textarea
                  value={htmlContent}
                  onChange={e => setHtmlContent(e.target.value)}
                  placeholder="Paste or write your HTML email here..."
                  rows={24}
                  className="font-mono text-sm border-0 rounded-none resize-none focus-visible:ring-0"
                />
              </TabsContent>

              <TabsContent value="visual" className="m-0">
                <div className="bg-zinc-800 p-6 min-h-[400px]">
                  <div className="max-w-[600px] mx-auto bg-zinc-900 rounded-lg overflow-hidden shadow-2xl">
                    {/* Email header bar */}
                    <div className="bg-zinc-950 px-4 py-3 border-b border-zinc-700">
                      <p className="text-xs text-zinc-500">From: {fromName} &lt;{fromEmail}&gt;</p>
                      <p className="text-xs text-zinc-400 mt-1">Subject: {subject || '(no subject)'}</p>
                    </div>
                    <div
                      className="p-0"
                      dangerouslySetInnerHTML={{ __html: htmlContent || '<p style="color:#666;padding:32px;text-align:center">Your email preview will appear here</p>' }}
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Right Sidebar: Merge Tags & Tips */}
        <div className="space-y-6">
          {/* Merge Tags */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Palette className="h-4 w-4 text-cyan-400" />
              Merge Tags
            </Label>
            <p className="text-xs text-muted-foreground">Click to insert personalization tags</p>
            <div className="flex flex-col gap-2">
              {MERGE_TAG_OPTIONS.map(mt => (
                <Button
                  key={mt.tag}
                  variant="outline"
                  size="sm"
                  className="justify-between font-mono text-xs"
                  onClick={() => insertMergeTag(mt.tag)}
                >
                  {mt.label}
                  <Badge variant="secondary" className="ml-2 text-[10px]">{mt.tag}</Badge>
                </Button>
              ))}
            </div>
          </div>

          {/* Image Library */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold flex items-center gap-2 cursor-pointer" onClick={() => setLibraryOpen(!libraryOpen)}>
                <FolderOpen className="h-4 w-4 text-orange-400" />
                Image Library ({libraryImages.length})
              </Label>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadLibraryImages} disabled={loadingLibrary}>
                  <RefreshCw className={`h-3 w-3 ${loadingLibrary ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLibraryOpen(!libraryOpen)}>
                  <span className="text-xs">{libraryOpen ? '▼' : '▶'}</span>
                </Button>
              </div>
            </div>

            <Button
              variant="outline" size="sm"
              onClick={() => libraryUploadRef.current?.click()}
              disabled={uploading}
              className="w-full h-8 text-xs gap-1 border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
            >
              <Upload className="h-3 w-3" />
              {uploading ? 'Uploading...' : 'Upload Images to Library'}
            </Button>

            {libraryOpen && (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {loadingLibrary && (
                  <p className="text-xs text-muted-foreground text-center py-4 animate-pulse">Loading images...</p>
                )}
                {!loadingLibrary && libraryImages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No images yet. Upload some above.</p>
                )}
                {libraryImages.map(img => (
                  <div key={img.name} className="group relative border border-border rounded-lg overflow-hidden bg-zinc-900">
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-24 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => insertLibraryImage(img.url)}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        variant="secondary" size="icon"
                        className="h-7 w-7 bg-cyan-600/80 hover:bg-cyan-600"
                        onClick={() => insertLibraryImage(img.url)}
                        title="Insert into email"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="secondary" size="icon"
                        className="h-7 w-7 bg-zinc-600/80 hover:bg-zinc-600"
                        onClick={() => copyImageUrl(img.url)}
                        title="Copy URL"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="secondary" size="icon"
                        className="h-7 w-7 bg-red-600/80 hover:bg-red-600"
                        onClick={() => deleteLibraryImage(img.name)}
                        title="Delete image"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground px-2 py-1 truncate">{img.name}</p>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">Click an image to insert. Hover for more options. Multi-select supported.</p>
          </div>

          {/* Image Upload Tips */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4 text-purple-400" />
              Quick Upload
            </Label>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li><strong className="text-cyan-400">Top</strong> — Hero banner, logo header</li>
              <li><strong className="text-purple-400">Inline</strong> — Product shots, screenshots</li>
              <li><strong className="text-green-400">Bottom</strong> — Footer image, signature</li>
              <li>Max 5MB per image. PNG/JPG/WebP.</li>
            </ul>
          </div>

          {/* Quick Tips */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-3">
            <Label className="text-base font-semibold">Email Tips</Label>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>Keep subject lines under 50 characters</li>
              <li>Always include an unsubscribe link</li>
              <li>Use inline CSS for email compatibility</li>
              <li>Test with "Save Draft" before sending</li>
              <li>max-width: 600px is the email sweet spot</li>
            </ul>
          </div>

          {/* Audience Summary */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-2">
            <Label className="text-base font-semibold">Send Summary</Label>
            <div className="text-sm text-muted-foreground">
              <p>Audience: <span className="text-foreground capitalize">{audience.replace('_', ' ')}</span></p>
              {audience === 'subscribers' && subscriberSource && subscriberSource !== 'all' && (
                <p>Segment: <span className="text-foreground">{subscriberSource.replace(/_/g, ' ')}</span></p>
              )}
              {audience === 'custom' && (
                <p>Recipients: <span className="text-foreground">{customEmails.split('\n').filter(e => e.trim()).length}</span></p>
              )}
              <p>
                Timing:{' '}
                <span className="text-foreground">
                  {sendMode === 'schedule' && scheduledAt
                    ? new Date(scheduledAt).toLocaleString()
                    : 'Send immediately'}
                </span>
              </p>
              <p className="mt-2 text-xs">Tracking: Opens, clicks, and unsubscribes are tracked automatically.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
