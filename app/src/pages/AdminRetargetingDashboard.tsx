import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Target, Mail, MessageSquare, Eye, MousePointer, UserCheck,
  Calendar, RefreshCw, TrendingUp, Users, Clock, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Search, Filter, BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  status: string;
  audience: string;
  from_name: string;
  from_email: string;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  total_opened: number;
  total_clicked: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  retarget_at: string | null;
  retarget_status: string | null;
}

interface RecipientRow {
  id: string;
  campaign_id: string;
  recipient_email: string;
  status: string;
  opened_at: string | null;
  clicked_at: string | null;
  error_message: string | null;
  created_at: string;
}

export default function AdminRetargetingDashboard({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'email' | 'sms'>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [retargetDialog, setRetargetDialog] = useState<{ campaignId: string; date: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      setCampaigns((data || []) as CampaignRow[]);
    } catch (err) {
      console.error('Error:', err);
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCampaigns();
    setRefreshing(false);
    toast.success('Data refreshed');
  };

  const fetchRecipients = async (campaignId: string) => {
    if (expandedCampaign === campaignId) {
      setExpandedCampaign(null);
      return;
    }
    setLoadingRecipients(true);
    setExpandedCampaign(campaignId);
    try {
      const { data, error } = await supabase
        .from('email_campaign_sends')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setRecipients((data || []) as RecipientRow[]);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const handleSetRetargetDate = async () => {
    if (!retargetDialog) return;
    try {
      const { error } = await supabase
        .from('email_campaigns')
        .update({
          retarget_at: retargetDialog.date ? new Date(retargetDialog.date).toISOString() : null,
          retarget_status: retargetDialog.date ? 'scheduled' : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', retargetDialog.campaignId);

      if (error) throw error;
      toast.success(retargetDialog.date ? 'Retarget date set' : 'Retarget date cleared');
      setRetargetDialog(null);
      fetchCampaigns();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    }
  };

  // Derived stats
  const stats = useMemo(() => {
    const sent = campaigns.filter(c => c.status === 'sent');
    const emailCampaigns = sent.filter(c => c.subject !== 'SMS');
    const smsCampaigns = sent.filter(c => c.subject === 'SMS');
    const totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
    const totalOpened = campaigns.reduce((s, c) => s + (c.total_opened || 0), 0);
    const totalClicked = campaigns.reduce((s, c) => s + (c.total_clicked || 0), 0);
    const overallOpenRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
    const overallClickRate = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0;
    const conversionRate = totalOpened > 0 ? Math.round((totalClicked / totalOpened) * 100) : 0;
    const scheduledRetargets = campaigns.filter(c => c.retarget_status === 'scheduled').length;

    return {
      totalCampaigns: campaigns.length,
      emailCount: emailCampaigns.length,
      smsCount: smsCampaigns.length,
      totalSent, totalOpened, totalClicked,
      overallOpenRate, overallClickRate, conversionRate,
      scheduledRetargets,
    };
  }, [campaigns]);

  // Filtered campaigns
  const filtered = useMemo(() => {
    let list = campaigns;
    if (tab === 'email') list = list.filter(c => c.subject !== 'SMS');
    if (tab === 'sms') list = list.filter(c => c.subject === 'SMS');
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q));
    }
    return list;
  }, [campaigns, tab, statusFilter, search]);

  const getConversionBadge = (campaign: CampaignRow) => {
    if (campaign.status !== 'sent') return null;
    const clickRate = campaign.total_sent > 0 ? Math.round((campaign.total_clicked / campaign.total_sent) * 100) : 0;
    if (clickRate >= 10) return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">High Convert</Badge>;
    if (clickRate >= 5) return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Medium</Badge>;
    if (clickRate > 0) return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Low</Badge>;
    return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">No Clicks</Badge>;
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {/* Header */}
      {embedded ? (
        <div className="flex items-center justify-end mb-4">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      ) : (
        <header className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
                    <Target className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-foreground">Retargeting Dashboard</h1>
                    <p className="text-sm text-muted-foreground">Email + SMS campaigns, conversions & retargeting controls</p>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </header>
      )}

      <main className={embedded ? "space-y-8" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"}>
        {/* Analytics Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-4 w-4 text-cyan-400" />
                <span className="text-xs text-muted-foreground">Total Campaigns</span>
              </div>
              <p className="text-2xl font-bold">{stats.totalCampaigns}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.emailCount} email · {stats.smsCount} SMS</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-green-400" />
                <span className="text-xs text-muted-foreground">Total Sent</span>
              </div>
              <p className="text-2xl font-bold">{stats.totalSent.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="h-4 w-4 text-purple-400" />
                <span className="text-xs text-muted-foreground">Open Rate</span>
              </div>
              <p className="text-2xl font-bold">{stats.overallOpenRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.totalOpened.toLocaleString()} opens</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <MousePointer className="h-4 w-4 text-orange-400" />
                <span className="text-xs text-muted-foreground">Click Rate</span>
              </div>
              <p className="text-2xl font-bold">{stats.overallClickRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.totalClicked.toLocaleString()} clicks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Conversion Rate</span>
              </div>
              <p className="text-2xl font-bold">{stats.conversionRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">open → click</p>
            </CardContent>
          </Card>
        </div>

        {/* Retarget Schedule Alert */}
        {stats.scheduledRetargets > 0 && (
          <Card className="border-orange-500/30 bg-orange-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <Calendar className="h-5 w-5 text-orange-400" />
              <span className="text-sm text-foreground">
                <strong>{stats.scheduledRetargets}</strong> campaign{stats.scheduledRetargets !== 1 ? 's' : ''} scheduled for retargeting
              </span>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <Tabs value={tab} onValueChange={v => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all" className="gap-1 text-xs">
                <BarChart3 className="h-3 w-3" /> All ({campaigns.length})
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-1 text-xs">
                <Mail className="h-3 w-3" /> Email ({stats.emailCount})
              </TabsTrigger>
              <TabsTrigger value="sms" className="gap-1 text-xs">
                <MessageSquare className="h-3 w-3" /> SMS ({stats.smsCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search campaigns..." className="pl-9 w-[200px]" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Campaign List */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="text-lg font-medium">No campaigns found</p>
            <p className="text-sm mt-2">Create campaigns in the Email or SMS campaign pages first.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(campaign => {
              const isExpanded = expandedCampaign === campaign.id;
              const isSms = campaign.subject === 'SMS';
              const openRate = campaign.total_sent > 0 ? Math.round((campaign.total_opened / campaign.total_sent) * 100) : 0;
              const clickRate = campaign.total_sent > 0 ? Math.round((campaign.total_clicked / campaign.total_sent) * 100) : 0;

              return (
                <Card key={campaign.id} className={`transition-all ${isExpanded ? 'border-primary/40' : ''}`}>
                  <CardContent className="p-0">
                    {/* Main row */}
                    <div className="p-5 cursor-pointer hover:bg-zinc-900/30 transition-colors" onClick={() => fetchRecipients(campaign.id)}>
                      <div className="flex flex-col lg:flex-row gap-4 justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {isSms
                              ? <MessageSquare className="h-4 w-4 text-green-400 shrink-0" />
                              : <Mail className="h-4 w-4 text-cyan-400 shrink-0" />
                            }
                            <h3 className="font-semibold text-foreground truncate">{campaign.name}</h3>
                            <Badge variant="outline" className={
                              campaign.status === 'sent' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                              campaign.status === 'draft' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                              campaign.status === 'sending' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                              'bg-red-500/20 text-red-400 border-red-500/30'
                            }>{campaign.status}</Badge>
                            {getConversionBadge(campaign)}
                            {campaign.retarget_status === 'scheduled' && campaign.retarget_at && (
                              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                                <Calendar className="h-3 w-3 mr-1" />
                                Retarget {new Date(campaign.retarget_at).toLocaleDateString()}
                              </Badge>
                            )}
                          </div>
                          {!isSms && <p className="text-sm text-muted-foreground truncate">{campaign.subject}</p>}
                          <p className="text-xs text-muted-foreground mt-1">
                            {campaign.sent_at
                              ? `Sent ${new Date(campaign.sent_at).toLocaleDateString()} ${new Date(campaign.sent_at).toLocaleTimeString()}`
                              : `Created ${new Date(campaign.created_at).toLocaleDateString()}`}
                            {' · '}<span className="capitalize">{campaign.audience?.replace('_', ' ') || 'custom'}</span>
                          </p>
                        </div>

                        {campaign.status === 'sent' && (
                          <div className="flex gap-5 items-center text-center shrink-0">
                            <div>
                              <p className="text-lg font-bold">{campaign.total_sent}</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sent</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold text-purple-400">{openRate}%</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Opens</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold text-orange-400">{clickRate}%</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Clicks</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold text-red-400">{campaign.total_failed}</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</p>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 items-center shrink-0">
                          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={e => { e.stopPropagation(); setRetargetDialog({ campaignId: campaign.id, date: campaign.retarget_at?.split('T')[0] || '' }); }}>
                            <Calendar className="h-3 w-3" /> Retarget
                          </Button>
                          <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); navigate('/admin/campaigns'); }} className="text-xs">Edit</Button>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </div>

                    {/* Expanded: Recipients */}
                    {isExpanded && (
                      <div className="border-t border-border bg-zinc-900/20 p-5">
                        {loadingRecipients ? (
                          <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                          </div>
                        ) : recipients.length === 0 ? (
                          <p className="text-center text-muted-foreground py-4">No recipient data available</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                              <div className="bg-card border border-border rounded-lg p-3 text-center">
                                <p className="text-lg font-bold">{recipients.length}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Recipients</p>
                              </div>
                              <div className="bg-card border border-border rounded-lg p-3 text-center">
                                <p className="text-lg font-bold text-green-400">{recipients.filter(r => r.status === 'sent').length}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Delivered</p>
                              </div>
                              <div className="bg-card border border-border rounded-lg p-3 text-center">
                                <p className="text-lg font-bold text-purple-400">{recipients.filter(r => r.opened_at).length}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Opened</p>
                              </div>
                              <div className="bg-card border border-border rounded-lg p-3 text-center">
                                <p className="text-lg font-bold text-orange-400">{recipients.filter(r => r.clicked_at).length}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Clicked (Converted)</p>
                              </div>
                              <div className="bg-card border border-border rounded-lg p-3 text-center">
                                <p className="text-lg font-bold text-red-400">{recipients.filter(r => r.status === 'failed').length}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Failed</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-border text-left">
                                    <th className="py-2 px-3 text-xs text-muted-foreground font-medium">Email</th>
                                    <th className="py-2 px-3 text-xs text-muted-foreground font-medium">Status</th>
                                    <th className="py-2 px-3 text-xs text-muted-foreground font-medium">Opened</th>
                                    <th className="py-2 px-3 text-xs text-muted-foreground font-medium">Clicked</th>
                                    <th className="py-2 px-3 text-xs text-muted-foreground font-medium">Conversion</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recipients.map(r => (
                                    <tr key={r.id} className="border-b border-border/50 hover:bg-zinc-800/30">
                                      <td className="py-2 px-3 font-mono text-xs">{r.recipient_email}</td>
                                      <td className="py-2 px-3">
                                        {r.status === 'sent' ? <CheckCircle2 className="h-4 w-4 text-green-400" /> :
                                         r.status === 'failed' ? <XCircle className="h-4 w-4 text-red-400" /> :
                                         <Clock className="h-4 w-4 text-yellow-400" />}
                                      </td>
                                      <td className="py-2 px-3 text-xs text-muted-foreground">
                                        {r.opened_at ? <span className="text-purple-400">{new Date(r.opened_at).toLocaleDateString()} {new Date(r.opened_at).toLocaleTimeString()}</span> : '—'}
                                      </td>
                                      <td className="py-2 px-3 text-xs text-muted-foreground">
                                        {r.clicked_at ? <span className="text-orange-400">{new Date(r.clicked_at).toLocaleDateString()} {new Date(r.clicked_at).toLocaleTimeString()}</span> : '—'}
                                      </td>
                                      <td className="py-2 px-3">
                                        {r.clicked_at ? (
                                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                                            <UserCheck className="h-3 w-3 mr-1" /> Converted
                                          </Badge>
                                        ) : r.opened_at ? (
                                          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">Engaged</Badge>
                                        ) : r.status === 'sent' ? (
                                          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-[10px]">No Action</Badge>
                                        ) : (
                                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">{r.status}</Badge>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Retarget Date Dialog */}
      <AlertDialog open={!!retargetDialog} onOpenChange={() => setRetargetDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set Retarget Date</AlertDialogTitle>
            <AlertDialogDescription>
              Schedule a follow-up send date for this campaign. Resend with updated content on this date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label>Retarget Date</Label>
            <Input
              type="date"
              value={retargetDialog?.date || ''}
              onChange={e => setRetargetDialog(prev => prev ? { ...prev, date: e.target.value } : null)}
              min={new Date().toISOString().split('T')[0]}
            />
            <p className="text-xs text-muted-foreground mt-2">Leave blank to clear the retarget schedule.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSetRetargetDate} className="bg-orange-600 hover:bg-orange-700">
              {retargetDialog?.date ? 'Schedule Retarget' : 'Clear Date'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
