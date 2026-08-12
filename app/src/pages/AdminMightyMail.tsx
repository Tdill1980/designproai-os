import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, ArrowLeft, LayoutTemplate, Megaphone, LayoutGrid, FolderTree, PenSquare, Target, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { TemplateList } from '@/components/mightymail/TemplateList';
import { TemplateEditor } from '@/components/mightymail/TemplateEditor';
import { MightyMailLibrary } from '@/components/mightymail/MightyMailLibrary';
import { EmailTemplate } from '@/components/mightymail/types';
import { CampaignList } from '@/components/campaigns/CampaignList';
import { CampaignEmailDesigner } from '@/components/campaigns/CampaignEmailDesigner';
import { CampaignTemplateGallery } from '@/components/campaigns/CampaignTemplateGallery';
import { CampaignAnalytics } from '@/components/campaigns/CampaignAnalytics';
import { ImportContactsDialog } from '@/components/campaigns/ImportContactsDialog';
import { WpwImportCard } from '@/components/admin/WpwImportCard';
import AdminEmailEditor from '@/pages/AdminEmailEditor';
import AdminRetargetingDashboard from '@/pages/AdminRetargetingDashboard';
import AdminMightyMailLanding from '@/pages/AdminMightyMailLanding';
import { EmailCampaign, CampaignTemplate } from '@/components/campaigns/types';
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

type CampaignView = 'list' | 'templates' | 'editor' | 'analytics';
type TemplatesViewMode = 'library' | 'grid';
type HubTab = 'templates' | 'campaigns' | 'editor' | 'retargeting' | 'landing';

const VALID_TABS: HubTab[] = ['templates', 'campaigns', 'editor', 'retargeting', 'landing'];

export default function AdminMightyMail() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as HubTab | null;
  const [activeTab, setActiveTab] = useState<HubTab>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'templates'
  );
  const [templatesViewMode, setTemplatesViewMode] = useState<TemplatesViewMode>('library');

  const handleTabChange = (v: string) => {
    setActiveTab(v as HubTab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', v);
      return next;
    }, { replace: true });
  };

  // Templates state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<EmailTemplate | null>(null);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignView, setCampaignView] = useState<CampaignView>('list');
  const [selectedCampaign, setSelectedCampaign] = useState<EmailCampaign | null>(null);
  const [campaignTemplateHtml, setCampaignTemplateHtml] = useState<string>('');
  const [confirmSend, setConfirmSend] = useState<Partial<EmailCampaign> | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    fetchTemplates();
    fetchCampaigns();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates((data || []) as EmailTemplate[]);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedTemplate(null);
    setView('edit');
  };

  const handleEdit = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setView('edit');
  };

  const handleBack = () => {
    setView('list');
    setSelectedTemplate(null);
    fetchTemplates();
  };

  const handleSave = async (templateData: Partial<EmailTemplate>) => {
    try {
      if (templateData.id) {
        // Update existing
        const { error } = await supabase
          .from('email_templates')
          .update({
            name: templateData.name,
            slug: templateData.slug,
            description: templateData.description,
            subject: templateData.subject,
            html_content: templateData.html_content,
            category: templateData.category,
            from_name: templateData.from_name,
            from_email: templateData.from_email,
            merge_tags: templateData.merge_tags,
          })
          .eq('id', templateData.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('email_templates')
          .insert({
            name: templateData.name,
            slug: templateData.slug,
            description: templateData.description,
            subject: templateData.subject,
            html_content: templateData.html_content,
            category: templateData.category,
            from_name: templateData.from_name,
            from_email: templateData.from_email,
            merge_tags: templateData.merge_tags,
          });

        if (error) throw error;
      }

      await fetchTemplates();
    } catch (error: any) {
      console.error('Error saving template:', error);
      if (error.code === '23505') {
        throw new Error('A template with this slug already exists');
      }
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!deleteTemplate) return;

    try {
      const { error } = await supabase
        .from('email_templates')
        .delete()
        .eq('id', deleteTemplate.id);

      if (error) throw error;
      toast.success('Template deleted');
      await fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    } finally {
      setDeleteTemplate(null);
    }
  };

  const handleToggleActive = async (template: EmailTemplate) => {
    try {
      const { error } = await supabase
        .from('email_templates')
        .update({ is_active: !template.is_active })
        .eq('id', template.id);

      if (error) throw error;
      toast.success(template.is_active ? 'Template deactivated' : 'Template activated');
      await fetchTemplates();
    } catch (error) {
      console.error('Error toggling template:', error);
      toast.error('Failed to update template');
    }
  };

  // Push a library template to Klaviyo as a DRAFT campaign. Dry-runs first so
  // unresolvable merge tags surface as a message instead of shipping literally
  // ({{order_id}} means nothing in a blast); only then does it build for real.
  const handleBuildInKlaviyo = async (template: EmailTemplate) => {
    const toastId = toast.loading(`Checking "${template.name}" for Klaviyo…`);
    const invoke = (dryRun: boolean) =>
      supabase.functions.invoke('klaviyo-build-email', {
        body: { action: 'build_library', template_id: template.id, dry_run: dryRun },
      });

    const { data: check, error: checkErr } = await invoke(true);
    const checkPayload = (check || {}) as any;
    if (checkErr || checkPayload.error) {
      toast.error(checkPayload.error || checkErr?.message || 'Could not prepare template', {
        id: toastId, duration: 12000,
      });
      return;
    }

    toast.loading(`Building "${template.name}" in Klaviyo…`, { id: toastId });
    const { data, error } = await invoke(false);
    const payload = (data || {}) as any;
    if (error || payload.error) {
      toast.error(payload.error || error?.message || 'Klaviyo build failed', {
        id: toastId, duration: 12000,
      });
      return;
    }
    toast.success(`Draft created in Klaviyo → ${payload.list?.name ?? 'list'}`, {
      id: toastId,
      duration: 15000,
      description: 'Nothing sent. Review and send it in Klaviyo.',
      action: payload.klaviyo_campaign_url
        ? { label: 'Open', onClick: () => window.open(payload.klaviyo_campaign_url, '_blank') }
        : undefined,
    });
  };

  const handleDuplicate = async (template: EmailTemplate) => {
    try {
      const newSlug = `${template.slug}-copy`;
      const newName = `${template.name} (Copy)`;
      
      const { data, error } = await supabase
        .from('email_templates')
        .insert({
          name: newName,
          slug: newSlug,
          description: template.description,
          subject: template.subject,
          html_content: template.html_content,
          category: template.category,
          from_name: template.from_name,
          from_email: template.from_email,
          merge_tags: template.merge_tags,
          is_active: false,
        })
        .select()
        .single();

      if (error) throw error;
      
      toast.success('Template duplicated');
      await fetchTemplates();
      
      // Open the duplicated template for editing
      if (data) {
        setSelectedTemplate(data as EmailTemplate);
        setView('edit');
      }
    } catch (error: any) {
      console.error('Error duplicating template:', error);
      if (error.code === '23505') {
        toast.error('A template with this slug already exists. Try a different name.');
      } else {
        toast.error('Failed to duplicate template');
      }
    }
  };

  const handleSendTest = async (template: EmailTemplate, email: string) => {
    // First save the template to ensure latest content is used
    await handleSave(template);
    
    // Call the send-templated-email edge function with sample data
    const { data, error } = await supabase.functions.invoke('send-templated-email', {
      body: {
        templateSlug: template.slug,
        to: email,
        mergeData: {
          customer_name: 'Test Customer',
          customer_email: email,
          design_name: 'Sample Design',
          vehicle_name: '2024 Porsche 911',
          download_url: 'https://example.com/download',
          expiry_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
          order_id: 'TEST-12345',
          shop_name: 'RestylePro Test Shop',
        },
      },
    });

    if (error) {
      console.error('Error sending test email:', error);
      throw error;
    }

    console.log('Test email sent:', data);
  };

  // ---------- Campaigns ----------

  const fetchCampaigns = async () => {
    setCampaignsLoading(true);
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
      setCampaignsLoading(false);
    }
  };

  const handleCampaignCreate = () => {
    setSelectedCampaign(null);
    setCampaignTemplateHtml('');
    setCampaignView('templates');
  };

  const handleCampaignSelectTemplate = (template: CampaignTemplate) => {
    setCampaignTemplateHtml(template.html);
    setSelectedCampaign(null);
    setCampaignView('editor');
  };

  const handleCampaignEdit = (campaign: EmailCampaign) => {
    setSelectedCampaign(campaign);
    setCampaignTemplateHtml('');
    setCampaignView('editor');
  };

  const handleCampaignViewAnalytics = (campaign: EmailCampaign) => {
    setSelectedCampaign(campaign);
    setCampaignView('analytics');
  };

  const handleCampaignBack = () => {
    setCampaignView('list');
    setSelectedCampaign(null);
    setCampaignTemplateHtml('');
    fetchCampaigns();
  };

  const handleCampaignSave = async (campaignData: Partial<EmailCampaign>) => {
    try {
      if (campaignData.id) {
        const updatePayload: Record<string, any> = {
          name: campaignData.name,
          subject: campaignData.subject,
          html_content: campaignData.html_content,
          from_name: campaignData.from_name,
          from_email: campaignData.from_email,
          audience: campaignData.audience,
          subscriber_source: campaignData.subscriber_source,
          custom_emails: campaignData.custom_emails,
          scheduled_at: campaignData.scheduled_at ?? null,
          updated_at: new Date().toISOString(),
        };
        if (campaignData.status) {
          updatePayload.status = campaignData.status;
        }

        const { error } = await supabase
          .from('email_campaigns')
          .update(updatePayload)
          .eq('id', campaignData.id);

        if (error) throw error;
        toast.success('Campaign saved');
      } else {
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
            subscriber_source: campaignData.subscriber_source,
            custom_emails: campaignData.custom_emails,
            scheduled_at: campaignData.scheduled_at ?? null,
            status: campaignData.status || 'draft',
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (error) throw error;
        toast.success('Campaign created');

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

  const handleCampaignScheduleRequest = async (campaignData: Partial<EmailCampaign>) => {
    if (!campaignData.scheduled_at) {
      toast.error('Pick a date and time first');
      return;
    }
    try {
      await handleCampaignSave({ ...campaignData, status: 'scheduled' });
      toast.success(`Scheduled for ${new Date(campaignData.scheduled_at).toLocaleString()}`);
      fetchCampaigns();
      handleCampaignBack();
    } catch {
      // error toast already fired in handleCampaignSave
    }
  };

  const handleCampaignSendRequest = async (campaignData: Partial<EmailCampaign>) => {
    await handleCampaignSave(campaignData);
    const campaignId = campaignData.id || selectedCampaign?.id;
    if (campaignId && campaignData.status === 'sent') {
      await supabase
        .from('email_campaigns')
        .update({ status: 'draft' })
        .eq('id', campaignId);
    }
    setConfirmSend(campaignData);
  };

  const handleCampaignConfirmSend = async () => {
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
      setCampaignView('list');
    } catch (error: any) {
      console.error('Error sending campaign:', error);
      toast.error(error.message || 'Failed to send campaign');
    }
  };

  const isTemplateEditing = view === 'edit';
  const isCampaignInFlow = campaignView !== 'list';
  const showTabs = !isTemplateEditing && !isCampaignInFlow;

  const TAB_SUBTITLES: Record<HubTab, string> = {
    templates: 'Templates & Campaigns',
    campaigns: 'Templates & Campaigns',
    editor: 'Email Editor',
    retargeting: 'Retargeting & Analytics',
    landing: 'Landing Page Assets',
  };

  const headerSubtitle = isCampaignInFlow
    ? 'Email Campaigns'
    : isTemplateEditing
      ? 'Email Template Builder'
      : TAB_SUBTITLES[activeTab];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              onClick={() => {
                if (isTemplateEditing) {
                  handleBack();
                } else if (campaignView === 'templates') {
                  setCampaignView('list');
                } else if (isCampaignInFlow) {
                  handleCampaignBack();
                } else {
                  navigate('/admin');
                }
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-fuchsia-500 shadow-md">
                <Mail className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">MightyMail</h1>
                <p className="text-sm text-gray-500">{headerSubtitle}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showTabs && (activeTab === 'templates' || activeTab === 'campaigns') && <WpwImportCard />}
        {showTabs ? (
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="mb-6 bg-gray-100 border border-gray-200 p-1 flex-wrap h-auto">
              <TabsTrigger value="templates" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500">
                <LayoutTemplate className="h-4 w-4" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500">
                <Megaphone className="h-4 w-4" />
                Campaigns
              </TabsTrigger>
              <TabsTrigger value="editor" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500">
                <PenSquare className="h-4 w-4" />
                Editor
              </TabsTrigger>
              <TabsTrigger value="retargeting" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500">
                <Target className="h-4 w-4" />
                Retargeting
              </TabsTrigger>
              <TabsTrigger value="landing" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500">
                <ImageIcon className="h-4 w-4" />
                Landing
              </TabsTrigger>
            </TabsList>

            <TabsContent value="templates">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-end">
                    <Tabs
                      value={templatesViewMode}
                      onValueChange={(v) => setTemplatesViewMode(v as TemplatesViewMode)}
                    >
                      <TabsList className="h-8 bg-gray-100">
                        <TabsTrigger value="library" className="h-7 px-3 gap-1.5 text-xs">
                          <FolderTree className="h-3.5 w-3.5" />
                          Library
                        </TabsTrigger>
                        <TabsTrigger value="grid" className="h-7 px-3 gap-1.5 text-xs">
                          <LayoutGrid className="h-3.5 w-3.5" />
                          Grid
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  {templatesViewMode === 'library' ? (
                    <MightyMailLibrary
                      templates={templates}
                      onEdit={handleEdit}
                      onDelete={setDeleteTemplate}
                      onCreate={handleCreate}
                      onToggleActive={handleToggleActive}
                      onDuplicate={handleDuplicate}
                      onBuildInKlaviyo={handleBuildInKlaviyo}
                    />
                  ) : (
                    <TemplateList
                      templates={templates}
                      onEdit={handleEdit}
                      onDelete={setDeleteTemplate}
                      onCreate={handleCreate}
                      onToggleActive={handleToggleActive}
                      onDuplicate={handleDuplicate}
                      onBuildInKlaviyo={handleBuildInKlaviyo}
                    />
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="campaigns">
              {campaignsLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <CampaignList
                  campaigns={campaigns}
                  onEdit={handleCampaignEdit}
                  onCreate={handleCampaignCreate}
                  onViewAnalytics={handleCampaignViewAnalytics}
                  onImportContacts={() => setImportOpen(true)}
                />
              )}
            </TabsContent>

            <TabsContent value="editor">
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <AdminEmailEditor embedded />
              </div>
            </TabsContent>

            <TabsContent value="retargeting">
              <AdminRetargetingDashboard embedded />
            </TabsContent>

            <TabsContent value="landing">
              <AdminMightyMailLanding embedded />
            </TabsContent>
          </Tabs>
        ) : isTemplateEditing ? (
          <TemplateEditor
            template={selectedTemplate}
            onSave={handleSave}
            onBack={handleBack}
            onSendTest={handleSendTest}
          />
        ) : campaignView === 'templates' ? (
          <CampaignTemplateGallery onSelect={handleCampaignSelectTemplate} />
        ) : campaignView === 'editor' ? (
          <CampaignEmailDesigner
            campaign={selectedCampaign}
            initialHtml={campaignTemplateHtml}
            onSave={handleCampaignSave}
            onSend={handleCampaignSendRequest}
            onSchedule={handleCampaignScheduleRequest}
            onBack={handleCampaignBack}
          />
        ) : campaignView === 'analytics' && selectedCampaign ? (
          <CampaignAnalytics campaign={selectedCampaign} onBack={handleCampaignBack} />
        ) : null}
      </main>

      {/* Delete Template Confirmation Dialog */}
      <AlertDialog open={!!deleteTemplate} onOpenChange={() => setDeleteTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTemplate?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Contacts Dialog */}
      <ImportContactsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          fetchCampaigns();
        }}
      />

      {/* Send Campaign Confirmation Dialog */}
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
              onClick={handleCampaignConfirmSend}
              className="bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:from-blue-600 hover:to-fuchsia-600 text-white"
            >
              Send Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
