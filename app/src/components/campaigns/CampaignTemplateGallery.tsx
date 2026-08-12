import { useState } from 'react';
import { FileText, Megaphone, Gift, Newspaper, Heart, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CAMPAIGN_TEMPLATES, CampaignTemplate } from './types';

interface CampaignTemplateGalleryProps {
  onSelect: (template: CampaignTemplate) => void;
}

const categoryIcons: Record<string, any> = {
  blank: FileText,
  announcement: Megaphone,
  promotion: Gift,
  newsletter: Newspaper,
  welcome: Heart,
  marketplace: Sparkles,
};

const categoryColors: Record<string, string> = {
  blank: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  announcement: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  promotion: 'bg-green-500/20 text-green-400 border-green-500/30',
  newsletter: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  welcome: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  marketplace: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
};

export function CampaignTemplateGallery({ onSelect }: CampaignTemplateGalleryProps) {
  const [filter, setFilter] = useState<string>('all');
  const categories = ['all', 'marketplace', 'announcement', 'promotion', 'newsletter', 'welcome', 'blank'];

  const filtered = filter === 'all'
    ? CAMPAIGN_TEMPLATES
    : CAMPAIGN_TEMPLATES.filter(t => t.category === filter);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Sparkles className="h-10 w-10 text-cyan-400 mx-auto mb-3" />
        <h2 className="text-2xl font-bold text-foreground">Choose a Template</h2>
        <p className="text-muted-foreground mt-1">Start with a professionally designed template or build from scratch</p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 justify-center">
        {categories.map(cat => (
          <Button
            key={cat}
            variant={filter === cat ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(cat)}
            className="capitalize"
          >
            {cat === 'all' ? 'All Templates' : cat}
          </Button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(template => {
          const Icon = categoryIcons[template.category] || FileText;
          return (
            <Card
              key={template.id}
              className="group hover:border-cyan-500/50 transition-all cursor-pointer overflow-hidden"
              onClick={() => onSelect(template)}
            >
              {/* Preview */}
              <div className="h-48 bg-zinc-900 overflow-hidden border-b border-border relative">
                <div
                  className="transform scale-[0.4] origin-top-left w-[250%] h-[250%] pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: template.html }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                  <Button size="sm" className="gap-2">
                    <Sparkles className="h-3 w-3" />
                    Use Template
                  </Button>
                </div>
              </div>

              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{template.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Badge variant="outline" className={categoryColors[template.category]}>
                    {template.category}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
