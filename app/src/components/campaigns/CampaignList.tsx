import { Mail, Send, Clock, AlertCircle, Plus, BarChart3, Eye, MousePointer, Users, CalendarClock, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmailCampaign } from './types';

interface CampaignListProps {
  campaigns: EmailCampaign[];
  onEdit: (campaign: EmailCampaign) => void;
  onCreate: () => void;
  onViewAnalytics: (campaign: EmailCampaign) => void;
  onImportContacts?: () => void;
}

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  draft: { icon: Clock, color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'Draft' },
  scheduled: { icon: CalendarClock, color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', label: 'Scheduled' },
  sending: { icon: Send, color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Sending' },
  sent: { icon: Mail, color: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Sent' },
  failed: { icon: AlertCircle, color: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Failed' },
};

export function CampaignList({ campaigns, onEdit, onCreate, onViewAnalytics, onImportContacts }: CampaignListProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Email Campaigns</h2>
          <p className="text-muted-foreground">Create, send, and track email campaigns</p>
        </div>
        <div className="flex gap-2">
          {onImportContacts && (
            <Button onClick={onImportContacts} variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Import Contacts
            </Button>
          )}
          <Button onClick={onCreate} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Mail className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{campaigns.length}</p>
                <p className="text-xs text-muted-foreground">Total Campaigns</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Users className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {campaigns.reduce((sum, c) => sum + (c.total_sent || 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Sent</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Eye className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {campaigns.reduce((sum, c) => sum + (c.total_opened || 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Opens</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <MousePointer className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {campaigns.reduce((sum, c) => sum + (c.total_clicked || 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Clicks</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Campaign Cards */}
      <div className="space-y-3">
        {campaigns.map(campaign => {
          const status = statusConfig[campaign.status] || statusConfig.draft;
          const StatusIcon = status.icon;
          const openRate = campaign.total_sent > 0
            ? Math.round((campaign.total_opened / campaign.total_sent) * 100)
            : 0;
          const clickRate = campaign.total_sent > 0
            ? Math.round((campaign.total_clicked / campaign.total_sent) * 100)
            : 0;

          return (
            <Card key={campaign.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-foreground truncate">{campaign.name}</h3>
                      <Badge variant="outline" className={status.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {status.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{campaign.subject}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {campaign.status === 'scheduled' && campaign.scheduled_at
                        ? `Scheduled for ${new Date(campaign.scheduled_at).toLocaleDateString()} at ${new Date(campaign.scheduled_at).toLocaleTimeString()}`
                        : campaign.sent_at
                          ? `Sent ${new Date(campaign.sent_at).toLocaleDateString()} at ${new Date(campaign.sent_at).toLocaleTimeString()}`
                          : `Created ${new Date(campaign.created_at).toLocaleDateString()}`
                      }
                      {' · '}
                      <span className="capitalize">{campaign.audience.replace('_', ' ')}</span>
                    </p>
                  </div>

                  {/* Stats */}
                  {campaign.status === 'sent' && (
                    <div className="flex gap-6 items-center text-center shrink-0">
                      <div>
                        <p className="text-lg font-bold text-foreground">{campaign.total_sent}</p>
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
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 items-center shrink-0">
                    {campaign.status === 'sent' && (
                      <Button variant="outline" size="sm" onClick={() => onViewAnalytics(campaign)} className="gap-1">
                        <BarChart3 className="h-3 w-3" />
                        Analytics
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(campaign)}
                    >
                      {campaign.status === 'draft' ? 'Edit' : 'View'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {campaigns.length === 0 && (
        <div className="text-center py-16">
          <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground">No campaigns yet</h3>
          <p className="text-muted-foreground mb-6">Create your first email campaign to start reaching your audience</p>
          <Button onClick={onCreate} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
            <Plus className="h-4 w-4" />
            Create Campaign
          </Button>
        </div>
      )}
    </div>
  );
}
