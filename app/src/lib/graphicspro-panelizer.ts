// GENIE Universal Panelizer — GraphicsPro's run.
//
// Owner, 2026-09-13: "create for wallpro and graphicspro to use."
//
// Same shared model (panelizer-progress.ts), different job row. A GraphicsPro
// job is not panelised to a roll: it is CUT. Its pieces are the cut-contour
// files the plotter receives — the CutContour PDF, the layered vector film, the
// nested sheet — produced deterministically by _shared/cut-contour (no model,
// no secret on the cut line), so a piece glows when its file exists exactly as
// a wall panel does.
//
// The stage vocabulary is GraphicsPro's own `graphics_pro_jobs.status`:
//   draft → generating_surface → surface_ready → rendering → mockup_ready
//         → approved → processing → complete | failed
//
// Pure: no Supabase client. The page that renders it supplies the row.

import type {
  PanelizerPiece, PanelizerRun, PanelizerStage, PanelizerStageState,
} from './panelizer-progress';

export type GraphicsProJobStatus =
  | 'draft' | 'generating_surface' | 'surface_ready' | 'rendering'
  | 'mockup_ready' | 'approved' | 'processing' | 'complete' | 'failed';

export type GraphicsProJobRow = {
  id: string;
  status: GraphicsProJobStatus;
  mode: string;
  surface_type?: string | null;
  stage?: string | null;
  progress?: number | null;
  /** The cut files produced, once they exist. */
  files?: Array<{ format: string; label?: string; path?: string | null; error?: string }> | null;
  design_id?: string | null;
  name?: string | null;
};

/** Where each status sits on the rail. Anything at or past the step is done. */
const ORDER: GraphicsProJobStatus[] = [
  'draft', 'generating_surface', 'surface_ready', 'rendering',
  'mockup_ready', 'approved', 'processing', 'complete',
];

function stageState(status: GraphicsProJobStatus, at: GraphicsProJobStatus, running: GraphicsProJobStatus): PanelizerStageState {
  if (status === 'failed') {
    // A failure stops the rail where it stood; earlier steps really did finish.
    return ORDER.indexOf(at) < ORDER.indexOf(running) ? 'complete' : 'failed';
  }
  const here = ORDER.indexOf(at), now = ORDER.indexOf(status);
  if (now > here) return 'complete';
  if (status === running) return 'running';
  return 'pending';
}

/** The files a plotter receives. Named, so a customer can check they got them. */
const EXPECTED_CUT_FILES: Array<[format: string, label: string, detail: string]> = [
  ['pdf', 'Cut-contour PDF', 'One unified cut line as a real CutContour separation, artwork bled 1/4″ past it'],
  ['svg', 'Cut path', 'The same contour as vector, for a plotter that prefers it'],
  ['zip', 'Layered film files', 'One vector layer per colour with offset-path bleeds, nested on the sheet'],
];

export function graphicsPanelizerRun(job: GraphicsProJobRow | null): PanelizerRun {
  const status: GraphicsProJobStatus = job?.status ?? 'draft';
  const produced = new Set((job?.files || []).filter(f => f.path && !f.error).map(f => f.format));

  const pieces: PanelizerPiece[] = EXPECTED_CUT_FILES.map(([format, label, detail]) => ({
    id: format,
    label,
    detail,
    state: produced.has(format) ? 'done'
      : status === 'failed' ? 'failed'
        : status === 'processing' ? 'active' : 'pending',
  }));

  const stage = (
    key: string, label: string, explanation: string, at: GraphicsProJobStatus, running: GraphicsProJobStatus,
  ): PanelizerStage => ({ key, label, explanation, state: stageState(status, at, running) });

  const outcome = status === 'failed' ? 'failed'
    : status === 'complete' ? 'ready'
      : 'building';

  return {
    product: 'graphicspro',
    title: job?.name || 'Cut graphics',
    reference: job?.design_id || (job ? job.id.slice(0, 8).toUpperCase() : null),
    stages: [
      stage('surface', 'Your surface', 'The wall, window or vehicle photo the graphics are placed on.',
        'surface_ready', 'generating_surface'),
      stage('design', 'Artwork placed', 'Your graphics laid onto the surface at real size.',
        'mockup_ready', 'rendering'),
      stage('approved', 'You approved it', 'Cut files are produced from the approved mockup and nothing else.',
        'approved', 'approved'),
      stage('cut', 'Cut files produced',
        'The unified cut line, the colour-separated film layers and the nested sheet — worked out deterministically from your artwork, not generated.',
        'complete', 'processing'),
    ],
    pieces,
    outcome,
    headline: status === 'failed' ? 'The cut files could not be produced'
      : status === 'complete' ? 'Your cut files are ready'
        : status === 'processing' ? 'Producing your cut files'
          : 'Approve your mockup to produce the cut files',
    detail: status === 'complete'
      ? 'Everything a plotter needs: the contour, the layered film and the nested sheet.'
      : status === 'failed'
        ? 'Our team has been notified. Nothing was charged twice.'
        : 'Cut lines are calculated from your artwork, so what the plotter cuts is exactly what you approved.',
  };
}
