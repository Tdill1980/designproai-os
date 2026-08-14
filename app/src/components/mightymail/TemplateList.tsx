import { useState } from 'react';
import { Mail, Edit, Trash2, Plus, Search, Filter, ToggleLeft, ToggleRight, Copy, Eye, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { brandMeta } from '@/lib/content-tags';

// MightyMail template slugs are brand-prefixed (rp-…, wpw-…, dp-…, wtv-…, ie-…).
// Map that prefix to the ecosystem brand + its canonical color.
const SLUG_BRAND: { re: RegExp; slug: string; label: string }[] = [
  { re: /^wpw[-_]/i, slug: 'weprintwraps', label: 'WPW' },
  { re: /^(dp|dpai|designpro)[-_]/i, slug: 'designproai', label: 'DesignPro' },
  { re: /^(wtv|wraptv)[-_]/i, slug: 'wraptvworld', label: 'WrapTV' },
  { re: /^(ie|inkandedge)[-_]/i, slug: 'inkandedge', label: 'Ink & Edge' },
  { re: /^(rp|restylepro)[-_]/i, slug: 'restylepro', label: 'RP' },
];
function brandForSlug(slug: string | null | undefined) {
  const s = String(slug || '');
  const hit = SLUG_BRAND.find((b) => b.re.test(s));
  const meta = brandMeta(hit?.slug);
  return { label: hit?.label || 'RP', color: hit ? meta.color : '#64748b' };
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmailTemplate, CATEGORIES } from './types';
import { TemplatePreview } from './TemplatePreview';

interface TemplateListProps {
  templates: EmailTemplate[];
  onEdit: (template: EmailTemplate) => void;
  onDelete: (template: EmailTemplate) => void;
  onCreate: () => void;
  onToggleActive: (template: EmailTemplate) => void;
  onDuplicate: (template: EmailTemplate) => void;
  /** Push this template to Klaviyo as a draft campaign. Admin surfaces only. */
  onBuildInKlaviyo?: (template: EmailTemplate) => void;
}

export function TemplateList({ templates, onEdit, onDelete, onCreate, onToggleActive, onDuplicate, onBuildInKlaviyo }: TemplateListProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  const getTemplateStyle = (slug: string): 'formal' | 'witty' | 'neutral' => {
    if (slug.endsWith('-formal')) return 'formal';
    if (slug.endsWith('-witty')) return 'witty';
    return 'neutral';
  };

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(search.toLowerCase()) ||
      template.slug.toLowerCase().includes(search.toLowerCase()) ||
      template.description?.toLowerCase().includes(search.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || template.category === categoryFilter;

    const templateStyle = getTemplateStyle(template.slug);
    const matchesStyle = styleFilter === 'all' || templateStyle === styleFilter;

    return matchesSearch && matchesCategory && matchesStyle;
  });

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'transactional': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'marketing': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'notification': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Email Templates</h2>
          <p className="text-muted-foreground">Manage your email templates</p>
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={styleFilter} onValueChange={setStyleFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Styles</SelectItem>
            <SelectItem value="formal">Formal / Pro</SelectItem>
            <SelectItem value="witty">Witty / Funny</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => {
          const tb = brandForSlug(template.slug);
          return (
          <Card
            key={template.id}
            className={`group hover:border-primary/50 transition-colors ${!template.is_active ? 'opacity-60' : ''}`}
            style={{ borderLeft: `4px solid ${tb.color}` }}
          >
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{template.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono">{template.slug}</p>
                  </div>
                </div>
                <button
                  onClick={() => onToggleActive(template)}
                  className="text-muted-foreground hover:text-foreground"
                  title={template.is_active ? 'Deactivate' : 'Activate'}
                >
                  {template.is_active ? (
                    <ToggleRight className="h-5 w-5 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-5 w-5" />
                  )}
                </button>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2">
                {template.description || 'No description'}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" style={{ background: `${tb.color}22`, color: tb.color, borderColor: `${tb.color}55` }}>
                  {tb.label}
                </Badge>
                <Badge variant="outline" className={getCategoryColor(template.category)}>
                  {template.category}
                </Badge>
                {getTemplateStyle(template.slug) === 'formal' && (
                  <Badge variant="outline" className="text-xs bg-slate-500/20 text-slate-300 border-slate-500/30">
                    Formal
                  </Badge>
                )}
                {getTemplateStyle(template.slug) === 'witty' && (
                  <Badge variant="outline" className="text-xs bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30">
                    Witty
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {template.merge_tags?.length || 0} tags
                </Badge>
              </div>

              <div className="flex items-center gap-1 pt-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => setPreviewTemplate(template)}
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => onEdit(template)}
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDuplicate(template)}
                  title="Duplicate template"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {onBuildInKlaviyo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onBuildInKlaviyo(template)}
                    title="Build a Klaviyo draft campaign from this template"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(template)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-12">
          <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground">No templates found</h3>
          <p className="text-muted-foreground">
            {search || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create your first email template'}
          </p>
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {previewTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  {previewTemplate.name}
                  {getTemplateStyle(previewTemplate.slug) === 'formal' && (
                    <Badge variant="outline" className="text-xs bg-slate-500/20 text-slate-300 border-slate-500/30">
                      Formal / Pro
                    </Badge>
                  )}
                  {getTemplateStyle(previewTemplate.slug) === 'witty' && (
                    <Badge variant="outline" className="text-xs bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30">
                      Witty / Funny
                    </Badge>
                  )}
                </DialogTitle>
                <p className="text-sm text-muted-foreground font-mono">{previewTemplate.slug}</p>
                {previewTemplate.description && (
                  <p className="text-sm text-muted-foreground">{previewTemplate.description}</p>
                )}
              </DialogHeader>
              <div className="mt-4">
                <TemplatePreview
                  html={previewTemplate.html_content}
                  subject={previewTemplate.subject}
                />
              </div>
              <div className="flex items-center gap-2 pt-4 border-t border-border">
                <Button
                  onClick={() => {
                    onEdit(previewTemplate);
                    setPreviewTemplate(null);
                  }}
                  className="flex-1 gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Edit Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    onDuplicate(previewTemplate);
                    setPreviewTemplate(null);
                  }}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Duplicate
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
