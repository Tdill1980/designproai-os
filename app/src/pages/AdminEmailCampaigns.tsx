import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Megaphone, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
import { CampaignList } from '@/components/campaigns/CampaignList';
import { CampaignEmailDesigner } from '@/components/campaigns/CampaignEmailDesigner';
import { CampaignTemplateGallery } from '@/components/campaigns/CampaignTemplateGallery';
import { CampaignAnalytics } from '@/components/campaigns/CampaignAnalytics';
import { EmailCampaign, CampaignTemplate } from '@/components/campaigns/types';

type ViewState = 'list' | 'templates' | 'editor' | 'analytics';

export default function AdminEmailCampaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewState>('list');
  const [selectedCampaign, setSelectedCampaign] = useState<EmailCampaign | null>(null);
  const [templateHtml, setTemplateHtml] = useState<string>('');
  const [confirmSend, setConfirmSend] = useState<Partial<EmailCampaign> | null>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns((data || []) as EmailCampaign[]);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedCampaign(null);
    setTemplateHtml('');
    setView('templates');
  };

  const handleSelectTemplate = (template: CampaignTemplate) => {
    setTemplateHtml(template.html);
    setSelectedCampaign(null);
    setView('editor');
  };

  const handleEdit = (campaign: EmailCampaign) => {
    setSelectedCampaign(campaign);
    setTemplateHtml('');
    setView('editor');
  };

  const handleViewAnalytics = (campaign: EmailCampaign) => {
    setSelectedCampaign(campaign);
    setView('analytics');
  };

  const handleBack = () => {
    setView('list');
    setSelectedCampaign(null);
    setTemplateHtml('');
    fetchCampaigns();
  };

  const handleSave = async (campaignData: Partial<EmailCampaign>) => {
    try {
      if (campaignData.id) {
        const { error } = await supabase
          .from('email_campaigns')
          .update({
            name: campaignData.name,
            subject: campaignData.subject,
            html_content: campaignData.html_content,
            from_name: campaignData.from_name,
            from_email: campaignData.from_email,
            audience: campaignData.audience,
            subscriber_source: campaignData.subscriber_source,
            custom_emails: campaignData.custom_emails,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignData.id);

        if (error) throw error;
        toast.success('Campaign saved');
      } else {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await supabase
          .from('email_campaigns')
          .insert({
            name: campaignData.name,
            subject: campaignData.subject,
            html_content: campaignData.html_content,
            from_name: campaignData.from_name,
            from_email: campaignData.from_email,
            audience: campaignData.audience,
            custom_emails: campaignData.custom_emails,
            status: 'draft',
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (error) throw error;
        toast.success('Campaign created');

        // Update the selected campaign so future saves are updates
        if (data) {
          setSelectedCampaign(data as EmailCampaign);
        }
      }
    } catch (error: any) {
      console.error('Error saving campaign:', error);
      toast.error(error.message || 'Failed to save campaign');
      throw error;
    }
  };

  const handleSendRequest = async (campaignData: Partial<EmailCampaign>) => {
    // Save first, then show confirmation
    await handleSave(campaignData);
    // If resending a sent campaign, reset its status to draft first
    const campaignId = campaignData.id || selectedCampaign?.id;
    if (campaignId && campaignData.status === 'sent') {
      await supabase
        .from('email_campaigns')
        .update({ status: 'draft' })
        .eq('id', campaignId);
    }
    setConfirmSend(campaignData);
  };

  // Schedule a campaign for a future send. Flips the campaign to
  // status='scheduled' with scheduled_at set — the process-scheduled-campaigns
  // pg_cron worker (every minute) picks it up once the time passes and fires
  // send-email-campaign automatically.
  const handleSchedule = async (campaignData: Partial<EmailCampaign>) => {
    // Save the content first so we have an id to flip
    await handleSave(campaignData);

    const campaignId = campaignData.id || selectedCampaign?.id;
    if (!campaignId) {
      toast.error('Campaign must be saved before scheduling');
      return;
    }
    if (!campaignData.scheduled_at) {
      toast.error('Pick a send time first');
      return;
    }

    const scheduledAt = new Date(campaignData.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      toast.error('Schedule time must be in the future');
      return;
    }

    try {
      const { error } = await supabase
        .from('email_campaigns')
        .update({
          status: 'scheduled',
          scheduled_at: scheduledAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);

      if (error) throw error;

      toast.success(
        `Campaign scheduled for ${scheduledAt.toLocaleString()}. The cron worker will send it automatically.`
      );

      fetchCampaigns();
      setView('list');
      setSelectedCampaign(null);
    } catch (error: any) {
      console.error('Error scheduling campaign:', error);
      toast.error(error.message || 'Failed to schedule campaign');
      throw error;
    }
  };

  const handleConfirmSend = async () => {
    if (!confirmSend) return;

    const campaignId = confirmSend.id || selectedCampaign?.id;
    if (!campaignId) {
      toast.error('Campaign must be saved before sending');
      return;
    }

    try {
      toast.info('Sending campaign...');

      const { data, error } = await supabase.functions.invoke('send-email-campaign', {
        body: { campaignId },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Campaign sent! ${data.sent} emails delivered, ${data.failed} failed.`);
      } else {
        toast.error(data?.error || 'Failed to send campaign');
      }

      setConfirmSend(null);
      fetchCampaigns();
      setView('list');
    } catch (error: any) {
      console.error('Error sending campaign:', error);
      toast.error(error.message || 'Failed to send campaign');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => {
              if (view === 'list') navigate('/admin');
              else if (view === 'templates') setView('list');
              else handleBack();
            }}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600">
                <Megaphone className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Email Campaigns</h1>
                <p className="text-sm text-muted-foreground">Create, send & track email campaigns with conversion tracking</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && view === 'list' ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : view === 'list' ? (
          <CampaignList
            campaigns={campaigns}
            onEdit={handleEdit}
            onCreate={handleCreate}
            onViewAnalytics={handleViewAnalytics}
          />
        ) : view === 'templates' ? (
          <CampaignTemplateGallery onSelect={handleSelectTemplate} />
        ) : view === 'editor' ? (
          <CampaignEmailDesigner
            campaign={selectedCampaign}
            initialHtml={templateHtml}
            onSave={handleSave}
            onSend={handleSendRequest}
            onSchedule={handleSchedule}
            onBack={handleBack}
          />
        ) : view === 'analytics' && selectedCampaign ? (
          <CampaignAnalytics campaign={selectedCampaign} onBack={handleBack} />
        ) : null}
      </main>

      {/* Send Confirmation Dialog */}
      <AlertDialog open={!!confirmSend} onOpenChange={() => setConfirmSend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send "{confirmSend?.subject}" to{' '}
              {confirmSend?.audience === 'all_users' ? 'all registered users' :
               confirmSend?.audience === 'subscribers' ? 'all email subscribers' :
               `${confirmSend?.custom_emails?.length || 0} custom recipients`}.
              <br /><br />
              <strong>This action cannot be undone.</strong> Make sure you've previewed the email content before sending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSend}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              Send Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
