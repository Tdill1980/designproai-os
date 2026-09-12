import { describe, expect, it } from 'vitest';
import {
  WALL_TARGET_PPI, buildWallPanelProStudio, jobIsStale, panelHealth, panelMap, versionStage,
  wallDesignIdOf, wallForensicRecord,
} from '../wallpro-panelpro';
import type { WallQcReview, WallGenerationRow } from '../wallpro-qc';

const OWNER = '61cc6c1c-0000-4000-8000-000000000000';
const NOW = new Date('2026-09-12T21:00:00Z').getTime();
const at = (iso: string) => iso;

const version = (over: Partial<any> = {}): any => ({
  id: '11111111-1111-4111-8111-111111111111', project_id: 'p1', owner_id: OWNER, version_no: 1,
  parent_version_id: null, kind: 'create', intent: 'prompt', prompt: 'sage green leaves',
  mask_path: null, reference_path: null, artwork_path: OWNER + '/generated/g1.png',
  width_px: 4096, height_px: 4096, sha256: null, generation_id: 'g1', design_id: null,
  placement: 'cover', repeat_width_in: null, status: 'draft', note: null,
  created_at: at('2026-09-12T18:00:00Z'), approved_at: null, ...over,
});

const generation = (over: Partial<WallGenerationRow> = {}): WallGenerationRow => ({
  id: 'g1', owner_id: OWNER, state: 'completed', artwork_path: OWNER + '/generated/g1.png',
  design_name: 'Sage leaves', error: null, input: { intent: 'prompt', prompt: 'sage green leaves', width: 142, height: 96, placement: 'cover' },
  charge_source: 'privileged', created_at: at('2026-09-12T17:59:00Z'), completed_at: at('2026-09-12T18:00:00Z'), ...over,
});

const job = (over: Partial<any> = {}): any => ({
  id: 'j1', owner_id: OWNER, project_id: 'p1', version_id: version().id, request: { wallWidthIn: 142, wallHeightIn: 96, panelWidthIn: 54, overlapIn: 1, bleedIn: 2, targetPpi: 150, placement: 'cover' },
  request_hash: 'h', status: 'ready', attempts: 1, progress: {}, panels: [], manifest_path: null,
  error: null, created_at: at('2026-09-12T19:00:00Z'), updated_at: at('2026-09-12T19:10:00Z'), finished_at: at('2026-09-12T19:10:00Z'), ...over,
});

const review = (over: Partial<WallQcReview> = {}): WallQcReview => ({
  id: 'r1', version_id: version().id, project_id: 'p1', reviewer_id: OWNER,
  verdict: 'released', checks: {}, notes: null, created_at: at('2026-09-12T20:00:00Z'), ...over,
});

const build = (over: Partial<Parameters<typeof buildWallPanelProStudio>[0]> = {}) =>
  buildWallPanelProStudio({
    projects: [{ id: 'p1', name: 'Living room', owner_id: OWNER, created_at: at('2026-09-12T17:00:00Z'), updated_at: at('2026-09-12T19:00:00Z') }],
    versions: [version()], generations: [generation()], reviews: [], jobs: [], urls: {}, now: NOW, ...over,
  });

describe('the DesignID is the one WallPro already mints', () => {
  // RevisionStudioIQ files a wall design under wallDesignId(versionId). If this
  // board derived its own, the same design would carry two IDs.
  it('matches wallpro-api.wallDesignId byte for byte', () => {
    expect(wallDesignIdOf('11111111-1111-4111-8111-111111111111')).toBe('DID-11111111');
    expect(wallDesignIdOf('aefefbf9-dead-4bee-8fff-000000000000')).toBe('DID-AEFEFBF9');
  });
});

describe('the version rail', () => {
  it('carries every version oldest first, never only the newest', () => {
    const { designs } = build({
      versions: [
        version({ id: 'v3', version_no: 3, created_at: at('2026-09-12T18:30:00Z') }),
        version({ id: 'v1', version_no: 1 }),
        version({ id: 'v2', version_no: 2, created_at: at('2026-09-12T18:15:00Z') }),
      ],
    });
    expect(designs[0].versions.map(v => v.version.version_no)).toEqual([1, 2, 3]);
    expect(designs[0].versions.map(v => v.designId)).toEqual(['DID-V1', 'DID-V2', 'DID-V3']);
  });

  // Same rule listWallDesignsForStudio uses, so the DID here and the DID in
  // RevisionStudioIQ are one answer about one job.
  it('heads the project with the approved version, else the newest draft', () => {
    const drafts = build({ versions: [version({ id: 'v1', version_no: 1 }), version({ id: 'v2', version_no: 2 })] });
    expect(drafts.designs[0].designId).toBe('DID-V2');
    expect(drafts.designs[0].approvedVersionId).toBeNull();

    const approved = build({
      versions: [
        version({ id: 'v1', version_no: 1, status: 'approved', approved_at: at('2026-09-12T18:05:00Z') }),
        version({ id: 'v2', version_no: 2 }),
      ],
    });
    expect(approved.designs[0].designId).toBe('DID-V1');
    expect(approved.designs[0].approvedVersionId).toBe('v1');
  });

  it('takes the newest production job per version, not the first seen', () => {
    const { designs } = build({
      jobs: [
        job({ id: 'old', created_at: at('2026-09-12T19:00:00Z') }),
        job({ id: 'new', created_at: at('2026-09-12T19:30:00Z') }),
      ],
    });
    expect(designs[0].versions[0].job?.id).toBe('new');
  });
});

describe('the recovery lane', () => {
  // The whole reason the board reads the generation table beside the versions.
  it('lists a completed generation that never became a version', () => {
    const { orphans } = build({
      versions: [], projects: [],
      generations: [generation({ id: 'lost' })],
    });
    expect(orphans.map(o => o.generation.id)).toEqual(['lost']);
  });

  it('never lists a generation a version already claims', () => {
    const { orphans } = build({ generations: [generation({ id: 'g1' })], versions: [version({ generation_id: 'g1' })] });
    expect(orphans).toHaveLength(0);
  });

  it('never lists a failed or still-running generation', () => {
    const { orphans } = build({
      versions: [], projects: [],
      generations: [
        generation({ id: 'failed', state: 'failed', artwork_path: null }),
        generation({ id: 'running', state: 'working', artwork_path: null, created_at: new Date(NOW - 30_000).toISOString() }),
      ],
    });
    expect(orphans).toHaveLength(0);
  });
});

describe('the version stage', () => {
  it('reads draft, approved, building and ready off the rows themselves', () => {
    const draft = build().designs[0].versions[0];
    expect(versionStage(draft)).toBe('draft');

    const approved = build({ versions: [version({ status: 'approved', approved_at: at('2026-09-12T18:05:00Z') })] }).designs[0].versions[0];
    expect(versionStage(approved)).toBe('approved');

    const building = build({ jobs: [job({ status: 'running' })] }).designs[0].versions[0];
    expect(versionStage(building)).toBe('building');

    expect(versionStage(build({ jobs: [job({ status: 'ready' })] }).designs[0].versions[0])).toBe('panels-ready');
    expect(versionStage(build({ jobs: [job({ status: 'failed' })] }).designs[0].versions[0])).toBe('build-failed');
  });

  // The gate outranks the build: files can be ready and still forbidden.
  it('lets the QC verdict outrank every build state', () => {
    const held = build({ jobs: [job({ status: 'ready' })], reviews: [review({ verdict: 'hold', notes: 'motif too small' })] });
    expect(versionStage(held.designs[0].versions[0])).toBe('held');

    const released = build({ jobs: [job({ status: 'failed' })], reviews: [review({ verdict: 'released' })] });
    expect(versionStage(released.designs[0].versions[0])).toBe('released');
  });
});

describe('staleness and panel health', () => {
  // A wall job carries version_id so it cannot come from another version; what
  // it CAN do is predate the approval it is shown under.
  it('calls a build made before the current approval stale', () => {
    const stale = build({
      versions: [version({ status: 'approved', approved_at: at('2026-09-12T20:00:00Z') })],
      jobs: [job({ created_at: at('2026-09-12T19:00:00Z') })],
    }).designs[0].versions[0];
    expect(jobIsStale(stale)).toBe(true);

    const fresh = build({
      versions: [version({ status: 'approved', approved_at: at('2026-09-12T19:00:00Z') })],
      jobs: [job({ created_at: at('2026-09-12T20:00:00Z') })],
    }).designs[0].versions[0];
    expect(jobIsStale(fresh)).toBe(false);
  });

  it('is not stale when there is no job and not stale on an unapproved version', () => {
    expect(jobIsStale(build().designs[0].versions[0])).toBe(false);
    expect(jobIsStale(build({ jobs: [job()] }).designs[0].versions[0])).toBe(false);
  });

  it('reports the LOWEST panel PPI against the print target, not the average', () => {
    const panels = [
      { number: 1, ppi: 150, widthIn: 54, byteSize: 10, upscale: { engine: 'topaz' } },
      { number: 2, ppi: 96, widthIn: 34, byteSize: 5, upscale: { engine: 'none' } },
    ];
    const health = panelHealth(job({ panels }) as any)!;
    expect(health.minPpi).toBe(96);
    expect(health.meetsTarget).toBe(false);
    expect(health.nativePanels).toBe(1);
    expect(health.panelCount).toBe(2);

    const good = panelHealth(job({ panels: [{ number: 1, ppi: WALL_TARGET_PPI, widthIn: 54, byteSize: 1, upscale: { engine: 'topaz' } }] }) as any)!;
    expect(good.meetsTarget).toBe(true);
  });

  it('has nothing to report with no panels', () => {
    expect(panelHealth(null)).toBeNull();
    expect(panelHealth(job() as any)).toBeNull();
  });
});

describe('the forensic record', () => {
  it('carries the whole lineage, not only the selected version', () => {
    const studio = build({
      versions: [version({ id: 'v1', version_no: 1 }), version({ id: 'v2', version_no: 2 })],
      reviews: [review({ version_id: 'v2', verdict: 'hold', notes: 'seam drifts' })],
    });
    const design = studio.designs[0];
    const record = wallForensicRecord(design, design.versions[1]);
    expect(record.contract).toBe('wallpro.panelpro-forensic-record.v1');
    expect(record.designId).toBe('DID-V2');
    expect(record.history.map(h => h.version)).toEqual([1, 2]);
    expect(record.qc.release).toBe('held');
    expect(record.qc.reviews[0].notes).toBe('seam drifts');
    // The brief the version was judged against travels with it.
    expect(record.brief.prompt).toBe('sage green leaves');
    expect(record.production).toBeNull();
  });
});

describe('the panelization QC shows', () => {
  const cut = (over: Partial<any> = {}): any => ({
    number: 1, file: 'p1.png', path: 'x/p1.png', xIn: -1, yIn: -1, widthIn: 55, heightIn: 98,
    overlapLeftIn: 0, widthPx: 8250, heightPx: 14700, ppi: 150, sha256: 'a', byteSize: 1,
    upscale: { engine: 'topaz' }, ...over,
  });
  // A 142" wall on a 54" roll with 1" bleed and 1/2" overlap.
  const threePanel = job({
    request: { wallWidthIn: 142, wallHeightIn: 96, panelWidthIn: 54, overlapIn: 0.5, bleedIn: 1, targetPpi: 150, placement: 'repeat' },
    panels: [
      cut({ number: 1, xIn: -1, widthIn: 54, overlapLeftIn: 0 }),
      cut({ number: 2, xIn: 52.5, widthIn: 54, overlapLeftIn: 0.5 }),
      cut({ number: 3, xIn: 106, widthIn: 37, overlapLeftIn: 0.5 }),
    ],
  });

  it('reports the half-inch overlap from the panel that was CUT, not the request', () => {
    // The request is what was asked for; the panel is what exists. If a job was
    // built before a spec change, QC must see the built number.
    const stated = panelMap(job({
      request: { wallWidthIn: 142, wallHeightIn: 96, panelWidthIn: 54, overlapIn: 2, bleedIn: 1, targetPpi: 150 },
      panels: [cut({ number: 1, xIn: 0, widthIn: 54 }), cut({ number: 2, xIn: 53.5, widthIn: 54, overlapLeftIn: 0.5 })],
    }))!;
    expect(stated.overlapIn).toBe(0.5);
  });

  it('counts seams as panels minus one', () => {
    expect(panelMap(threePanel)!.seams).toBe(2);
    expect(panelMap(job({ panels: [cut()] }))!.seams).toBe(0);
  });

  it('lays every panel out to scale across the printed width', () => {
    const map = panelMap(threePanel)!;
    // -1 (bleed) through 143 = 144 inches of printed width.
    expect(map.totalWidthIn).toBe(144);
    expect(map.entries[0].leftPct).toBe(0);
    expect(map.entries.map(e => e.number)).toEqual([1, 2, 3]);
    // Panel 2 starts at 52.5, which is 53.5 inches from the left bleed edge.
    expect(map.entries[1].leftPct).toBeCloseTo((53.5 / 144) * 100, 6);
    // The overlap band is drawn at the same scale as the panel it sits on.
    expect(map.entries[1].overlapPct).toBeCloseTo((0.5 / 144) * 100, 6);
    expect(map.entries[0].overlapPct).toBe(0);
  });

  it('carries the shop spec the reviewer signs against', () => {
    const map = panelMap(threePanel)!;
    expect(map.panelWidthIn).toBe(54);
    expect(map.bleedIn).toBe(1);
    expect(map.targetPpi).toBe(150);
  });

  it('has nothing to draw before the panels exist', () => {
    expect(panelMap(null)).toBeNull();
    expect(panelMap(job())).toBeNull();
  });
});
