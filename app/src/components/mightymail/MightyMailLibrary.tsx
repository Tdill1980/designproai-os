import { useMemo, useState } from 'react';
import {
  Search,
  Mail,
  Edit,
  Eye,
  Copy,
  Trash2,
  ToggleLeft,
  ToggleRight,
  List as ListIcon,
  GanttChartSquare,
  Plus,
  Zap,
  Calendar,
  Send,
  Hand,
  Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { EmailTemplate } from './types';
import { TemplatePreview } from './TemplatePreview';
import {
  MIGHTYMAIL_SERIES,
  MightyMailSeries,
  SeriesAudience,
  AUDIENCE_LABELS,
  PHASE_LABELS,
  ACCENT_CLASSES,
  findEmailInSeries,
} from '@/lib/mightymail-series';

interface MightyMailLibraryProps {
  templates: EmailTemplate[];
  onEdit: (template: EmailTemplate) => void;
  onDelete: (template: EmailTemplate) => void;
  onCreate: () => void;
  onToggleActive: (template: EmailTemplate) => void;
  onDuplicate: (template: EmailTemplate) => void;
  /** When set, only series matching this audience are shown. Templates that
   *  belong to filtered-out series are also hidden from the auto-bucket. */
  audienceFilter?: SeriesAudience;
  /** Read-only mode: preview + duplicate stay; create / edit / delete /
   *  toggle-active are hidden. Used for the shop-facing library. */
  readOnly?: boolean;
}

type ViewMode = 'list' | 'timeline';

const TRIGGER_ICON: Record<string, typeof Zap> = {
  manual: Hand,
  event: Zap,
  scheduled: Calendar,
  campaign: Send,
};

export function MightyMailLibrary({
  templates,
  onEdit,
  onDelete,
  onCreate,
  onToggleActive,
  onDuplicate,
  audienceFilter,
  readOnly = false,
}: MightyMailLibraryProps) {
  // Apply audience filter at the series spec level so the sidebar only shows
  // groups the caller wants exposed (e.g. shop-facing view excludes RP→Shop).
  const baseSeries = useMemo(
    () => (audienceFilter ? MIGHTYMAIL_SERIES.filter((s) => s.audience === audienceFilter) : MIGHTYMAIL_SERIES),
    [audienceFilter],
  );

  const [activeSeriesId, setActiveSeriesId] = useState<string>(baseSeries[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  // Build a fast lookup of slug -> EmailTemplate
  const templateBySlug = useMemo(() => {
    const map = new Map<string, EmailTemplate>();
    for (const t of templates) map.set(t.slug, t);
    return map;
  }, [templates]);

  // Identify ungrouped templates (in DB but not in any series spec the
  // CALLER is allowed to see — for shop view, RP-only series count as
  // "in a series" so those slugs get filtered out, not auto-bucketed)
  const ungroupedTemplates = useMemo(() => {
    const inAnySeries = new Set<string>();
    for (const s of MIGHTYMAIL_SERIES) for (const e of s.emails) inAnySeries.add(e.slug);
    return templates.filter((t) => !inAnySeries.has(t.slug));
  }, [templates]);

  // The "All Other Templates" pseudo-series — only shown when no audience
  // filter is active (admin view). Shop view never sees this bucket.
  const ungroupedSeries: MightyMailSeries | null = useMemo(() => {
    if (audienceFilter) return null;
    if (ungroupedTemplates.length === 0) return null;
    return {
      id: '__ungrouped__',
      name: 'All Other Templates',
      description: 'Templates not yet assigned to a series.',
      audience: 'shop-to-customer',
      phase: 'lifecycle',
      trigger: { type: 'manual', label: 'Manual' },
      accent: 'gray',
      emails: ungroupedTemplates.map((t) => ({
        slug: t.slug,
        delayLabel: 'Manual',
        description: t.description ?? '',
      })),
    };
  }, [ungroupedTemplates, audienceFilter]);

  const allSeries = useMemo(
    () => (ungroupedSeries ? [...baseSeries, ungroupedSeries] : baseSeries),
    [baseSeries, ungroupedSeries],
  );

  const activeSeries = allSeries.find((s) => s.id === activeSeriesId) ?? allSeries[0];

  // Filter visible templates within active series by search
  const visibleEmails = useMemo(() => {
    if (!activeSeries) return [];
    const q = search.trim().toLowerCase();
    return activeSeries.emails.filter((e) => {
      if (!q) return true;
      const t = templateBySlug.get(e.slug);
      return (
        e.slug.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (t?.subject ?? '').toLowerCase().includes(q) ||
        (t?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [activeSeries, search, templateBySlug]);

  const totalActive = templates.filter((t) => t.is_active).length;

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-220px)]">
      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <aside className="w-full lg:w-72 flex-shrink-0">
        <div className="sticky top-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Library</h2>
              <p className="text-xs text-gray-500">
                {templates.length} templates · {totalActive} active
              </p>
            </div>
            {!readOnly && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onCreate}>
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            )}
          </div>

          <nav className="space-y-1">
            {(['rp-to-shop', 'shop-to-customer'] as const).map((aud) => {
              const seriesInGroup = allSeries.filter((s) => s.audience === aud);
              if (seriesInGroup.length === 0) return null;
              return (
                <div key={aud} className="pt-2 first:pt-0">
                  <p className="px-2 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    {AUDIENCE_LABELS[aud]}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {seriesInGroup.map((s) => {
                      const accent = ACCENT_CLASSES[s.accent] ?? ACCENT_CLASSES.indigo;
                      const isActive = s.id === activeSeriesId;
                      const count = s.emails.length;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActiveSeriesId(s.id)}
                          className={cn(
                            'w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
                            isActive
                              ? 'bg-gray-100 text-gray-900 font-medium'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                          )}
                        >
                          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', accent.dot)} />
                          <span className="flex-1 truncate">{s.name}</span>
                          <span className="text-xs text-gray-400">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ─── Main Pane ────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {activeSeries && (
          <SeriesHeader
            series={activeSeries}
            view={view}
            onViewChange={setView}
            search={search}
            onSearchChange={setSearch}
          />
        )}

        {activeSeries && view === 'list' && (
          <SeriesList
            series={activeSeries}
            visibleEmails={visibleEmails}
            templateBySlug={templateBySlug}
            onPreview={setPreviewTemplate}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleActive={onToggleActive}
            onDuplicate={onDuplicate}
            readOnly={readOnly}
          />
        )}

        {activeSeries && view === 'timeline' && (
          <SeriesTimeline
            series={activeSeries}
            visibleEmails={visibleEmails}
            templateBySlug={templateBySlug}
            onPreview={setPreviewTemplate}
            onEdit={onEdit}
          />
        )}
      </div>

      {/* ─── Preview Dialog ───────────────────────────────────────── */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {previewTemplate &&
            (() => {
              const found = findEmailInSeries(previewTemplate.slug);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 flex-wrap">
                      <Mail className="h-5 w-5" />
                      {previewTemplate.name}
                      {found && (
                        <Badge variant="outline" className="text-xs">
                          {found.series.name} · {found.email.delayLabel}
                        </Badge>
                      )}
                    </DialogTitle>
                    <p className="text-sm text-gray-500 font-mono">{previewTemplate.slug}</p>
                    {previewTemplate.description && (
                      <p className="text-sm text-gray-600">{previewTemplate.description}</p>
                    )}
                  </DialogHeader>
                  <div className="mt-4">
                    <TemplatePreview html={previewTemplate.html_content} subject={previewTemplate.subject} />
                  </div>
                  <div className="flex items-center gap-2 pt-4 border-t border-gray-200">
                    {!readOnly && (
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
                    )}
                    <Button
                      variant={readOnly ? 'default' : 'outline'}
                      onClick={() => {
                        onDuplicate(previewTemplate);
                        setPreviewTemplate(null);
                      }}
                      className={readOnly ? 'flex-1 gap-2' : 'gap-2'}
                    >
                      <Copy className="h-4 w-4" />
                      {readOnly ? 'Use This Template' : 'Duplicate'}
                    </Button>
                  </div>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Series header (title + meta + view toggle + search) ────────────
function SeriesHeader({
  series,
  view,
  onViewChange,
  search,
  onSearchChange,
}: {
  series: MightyMailSeries;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const accent = ACCENT_CLASSES[series.accent] ?? ACCENT_CLASSES.indigo;
  const TriggerIcon = TRIGGER_ICON[series.trigger.type] ?? Hand;

  return (
    <div className="border-b border-gray-200 pb-4 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('h-3 w-3 rounded-full', accent.dot)} />
            <h2 className="text-xl font-bold text-gray-900 truncate">{series.name}</h2>
            <Badge variant="outline" className="text-xs ml-1">
              {series.emails.length} emails
            </Badge>
          </div>
          <p className="text-sm text-gray-600">{series.description}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Inbox className="h-3 w-3" />
              {AUDIENCE_LABELS[series.audience]}
            </span>
            <span>·</span>
            <span>{PHASE_LABELS[series.phase]}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <TriggerIcon className="h-3 w-3" />
              {series.trigger.label}
            </span>
            {series.trigger.event && (
              <>
                <span>·</span>
                <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                  {series.trigger.event}
                </code>
              </>
            )}
          </div>
        </div>

        <Tabs value={view} onValueChange={(v) => onViewChange(v as ViewMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="list" className="h-7 px-3 gap-1.5 text-xs">
              <ListIcon className="h-3.5 w-3.5" />
              List
            </TabsTrigger>
            <TabsTrigger value="timeline" className="h-7 px-3 gap-1.5 text-xs">
              <GanttChartSquare className="h-3.5 w-3.5" />
              Timeline
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search this series..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 h-9"
        />
      </div>
    </div>
  );
}

// ─── List view ──────────────────────────────────────────────────────
function SeriesList({
  series,
  visibleEmails,
  templateBySlug,
  onPreview,
  onEdit,
  onDelete,
  onToggleActive,
  onDuplicate,
  readOnly = false,
}: {
  series: MightyMailSeries;
  visibleEmails: typeof series.emails;
  templateBySlug: Map<string, EmailTemplate>;
  onPreview: (t: EmailTemplate) => void;
  onEdit: (t: EmailTemplate) => void;
  onDelete: (t: EmailTemplate) => void;
  onToggleActive: (t: EmailTemplate) => void;
  onDuplicate: (t: EmailTemplate) => void;
  readOnly?: boolean;
}) {
  const accent = ACCENT_CLASSES[series.accent] ?? ACCENT_CLASSES.indigo;

  if (visibleEmails.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
        <Mail className="h-10 w-10 mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">No templates match your search.</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {visibleEmails.map((email, idx) => {
        const template = templateBySlug.get(email.slug);
        const missing = !template;
        return (
          <div
            key={email.slug}
            className={cn(
              'group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50',
              idx > 0 && 'border-t border-gray-100',
              missing && 'opacity-50',
            )}
          >
            {/* Active indicator (read-only renders as static dot) */}
            {readOnly ? (
              <span
                className={cn(
                  'h-2 w-2 rounded-full flex-shrink-0',
                  template?.is_active ? 'bg-emerald-500' : 'bg-gray-300',
                )}
                title={template?.is_active ? 'Active' : 'Paused'}
              />
            ) : (
              <button
                onClick={() => template && onToggleActive(template)}
                disabled={missing}
                className="flex-shrink-0"
                title={template?.is_active ? 'Active — click to pause' : 'Paused — click to activate'}
              >
                {template?.is_active ? (
                  <ToggleRight className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-gray-300" />
                )}
              </button>
            )}

            {/* Day badge */}
            <Badge
              variant="outline"
              className={cn('text-xs font-mono flex-shrink-0 min-w-[80px] justify-center', accent.text, accent.border)}
            >
              {email.delayLabel}
            </Badge>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {template?.name ?? email.slug}
                </p>
                {missing && (
                  <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                    Missing in DB
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {template?.subject ?? email.description}
              </p>
              <p className="text-[10px] text-gray-400 font-mono mt-0.5">{email.slug}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={missing}
                onClick={() => template && onPreview(template)}
                title="Preview"
              >
                <Eye className="h-4 w-4" />
              </Button>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={missing}
                  onClick={() => template && onEdit(template)}
                  title="Edit"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={missing}
                onClick={() => template && onDuplicate(template)}
                title={readOnly ? 'Use this template' : 'Duplicate'}
              >
                <Copy className="h-4 w-4" />
              </Button>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                  disabled={missing}
                  onClick={() => template && onDelete(template)}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Timeline view (drip emails plotted on a day axis) ─────────────
function SeriesTimeline({
  series,
  visibleEmails,
  templateBySlug,
  onPreview,
  onEdit,
}: {
  series: MightyMailSeries;
  visibleEmails: typeof series.emails;
  templateBySlug: Map<string, EmailTemplate>;
  onPreview: (t: EmailTemplate) => void;
  onEdit: (t: EmailTemplate) => void;
}) {
  const accent = ACCENT_CLASSES[series.accent] ?? ACCENT_CLASSES.indigo;
  const withDelay = visibleEmails.filter((e) => typeof e.delayDays === 'number');

  if (withDelay.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
        <GanttChartSquare className="h-10 w-10 mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">
          This series doesn’t have day-offset triggers.
        </p>
        <p className="text-xs text-gray-400 mt-1">Switch to List view to see all templates.</p>
      </div>
    );
  }

  const maxDay = Math.max(...withDelay.map((e) => e.delayDays ?? 0), 1);

  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-6 text-xs text-gray-500">
        <span>Trigger: {series.trigger.label}</span>
        <span>Span: 0 — {maxDay} days</span>
      </div>

      <div className="relative">
        {/* Axis line */}
        <div className="absolute left-0 right-0 top-5 h-0.5 bg-gray-200" />

        {/* Tick marks */}
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-y-12">
          {withDelay.map((email, idx) => {
            const template = templateBySlug.get(email.slug);
            const pct = ((email.delayDays ?? 0) / maxDay) * 100;
            return (
              <div
                key={email.slug}
                className="relative flex flex-col items-start"
                style={{
                  gridColumn: `span 1`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('h-3 w-3 rounded-full ring-4 ring-white', accent.dot)} />
                  <span className={cn('text-xs font-mono font-semibold', accent.text)}>
                    {email.delayLabel}
                  </span>
                </div>
                <button
                  onClick={() => template && onPreview(template)}
                  className={cn(
                    'text-left rounded-md border p-3 w-full hover:shadow-sm transition-shadow',
                    template?.is_active ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50',
                  )}
                >
                  <p className="text-xs font-semibold text-gray-900 line-clamp-1">
                    {template?.name ?? email.slug}
                  </p>
                  <p className="text-[11px] text-gray-500 line-clamp-2 mt-1">
                    {template?.subject ?? email.description}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        template?.is_active ? 'bg-emerald-500' : 'bg-gray-300',
                      )}
                    />
                    <span className="text-[10px] text-gray-400">
                      {template?.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>{withDelay.length} timed touchpoints</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gray-300" /> Paused
          </span>
        </span>
      </div>
    </div>
  );
}
