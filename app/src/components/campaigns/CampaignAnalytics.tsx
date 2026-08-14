import { useState, useEffect } from 'react';
import { ArrowLeft, Eye, MousePointer, Users, AlertCircle, Mail, Clock, UserMinus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { EmailCampaign, CampaignSend, CampaignEvent } from './types';

interface CampaignAnalyticsProps {
  campaign: EmailCampaign;
  onBack: () => void;
}

export function CampaignAnalytics({ campaign, onBack }: CampaignAnalyticsProps) {
  const [sends, setSends] = useState<CampaignSend[]>([]);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sendsRes, eventsRes] = await Promise.all([
        supabase
          .from('email_campaign_sends')
          .select('*')
          .eq('campaign_id', campaign.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('email_campaign_events')
          .select('*')
          .eq('campaign_id', campaign.id)
          .order('created_at', { ascending: false }),
      ]);

      setSends((sendsRes.data || []) as CampaignSend[]);
      setEvents((eventsRes.data || []) as CampaignEvent[]);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [campaign.id]);

  const openRate = campaign.total_sent > 0
    ? ((campaign.total_opened / campaign.total_sent) * 100).toFixed(1)
    : '0';
  const clickRate = campaign.total_sent > 0
    ? ((campaign.total_clicked / campaign.total_sent) * 100).toFixed(1)
    : '0';
  const failRate = campaign.total_recipients > 0
    ? ((campaign.total_failed / campaign.total_recipients) * 100).toFixed(1)
    : '0';

  const uniqueOpens = sends.filter(s => s.opened_at).length;
  const uniqueClicks = sends.filter(s => s.clicked_at).length;
  const unsubscribes = events.filter(e => e.event_type === 'unsubscribe').length;

  // Click URL breakdown
  const clickUrls: Record<string, number> = {};
  events
    .filter(e => e.event_type === 'click' && e.metadata?.url)
    .forEach(e => {
      const url = e.metadata.url as string;
      clickUrls[url] = (clickUrls[url] || 0) + 1;
    });

  const sortedClickUrls = Object.entries(clickUrls).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{campaign.name}</h2>
            <p className="text-sm text-muted-foreground">{campaign.subject}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 mx-auto text-cyan-400 mb-2" />
            <p className="text-2xl font-bold">{campaign.total_recipients}</p>
            <p className="text-xs text-muted-foreground">Recipients</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Mail className="h-5 w-5 mx-auto text-green-400 mb-2" />
            <p className="text-2xl font-bold">{campaign.total_sent}</p>
            <p className="text-xs text-muted-foreground">Delivered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Eye className="h-5 w-5 mx-auto text-purple-400 mb-2" />
            <p className="text-2xl font-bold">{openRate}%</p>
            <p className="text-xs text-muted-foreground">Open Rate ({uniqueOpens})</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <MousePointer className="h-5 w-5 mx-auto text-orange-400 mb-2" />
            <p className="text-2xl font-bold">{clickRate}%</p>
            <p className="text-xs text-muted-foreground">Click Rate ({uniqueClicks})</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertCircle className="h-5 w-5 mx-auto text-red-400 mb-2" />
            <p className="text-2xl font-bold">{failRate}%</p>
            <p className="text-xs text-muted-foreground">Failed ({campaign.total_failed})</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <UserMinus className="h-5 w-5 mx-auto text-zinc-400 mb-2" />
            <p className="text-2xl font-bold">{unsubscribes}</p>
            <p className="text-xs text-muted-foreground">Unsubscribes</p>
          </CardContent>
        </Card>
      </div>

      {/* Click URL Breakdown */}
      {sortedClickUrls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sortedClickUrls.map(([url, count]) => (
                <div key={url} className="flex items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground truncate flex-1 font-mono">{url}</p>
                  <Badge variant="outline">{count} clicks</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recipient Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipients ({sends.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 text-muted-foreground font-medium">Email</th>
                  <th className="pb-3 text-muted-foreground font-medium">Status</th>
                  <th className="pb-3 text-muted-foreground font-medium">Opened</th>
                  <th className="pb-3 text-muted-foreground font-medium">Clicked</th>
                </tr>
              </thead>
              <tbody>
                {sends.slice(0, 100).map(send => (
                  <tr key={send.id} className="border-b border-border/50">
                    <td className="py-3 text-foreground font-mono text-xs">{send.recipient_email}</td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          send.status === 'sent' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          send.status === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                          'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                        }
                      >
                        {send.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      {send.opened_at ? (
                        <span className="text-purple-400 text-xs flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {new Date(send.opened_at).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      {send.clicked_at ? (
                        <span className="text-orange-400 text-xs flex items-center gap-1">
                          <MousePointer className="h-3 w-3" />
                          {new Date(send.clicked_at).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sends.length > 100 && (
              <p className="text-xs text-muted-foreground mt-3">Showing first 100 of {sends.length} recipients</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
