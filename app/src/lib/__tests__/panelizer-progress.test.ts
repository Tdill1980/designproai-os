import { describe, expect, it } from 'vitest';
import { panelizerIsLive, panelizerProgress, stageProgress, type PanelizerRun } from '../panelizer-progress';
import { graphicsPanelizerRun } from '../graphicspro-panelizer';

const run = (over: Partial<PanelizerRun> = {}): PanelizerRun => ({
  product: 'test', title: 'A wall', reference: 'DID-1',
  stages: [], pieces: [], outcome: 'building', headline: '', detail: '', ...over,
});

describe('progress is counted from files, not steps', () => {
  // The vehicle page's own rule, generalised: a side glows when its print panel
  // exists, never when a step merely ran. A rail can be three-quarters ticked
  // while nothing printable exists, so the bar reads the pieces.
  it('counts done pieces and ignores the rail', () => {
    const p = panelizerProgress(run({
      stages: [{ key: 'a', label: 'A', explanation: '', state: 'complete' }],
      pieces: [
        { id: '1', label: 'Panel 1', state: 'done' },
        { id: '2', label: 'Panel 2', state: 'done' },
        { id: '3', label: 'Panel 3', state: 'active' },
        { id: '4', label: 'Panel 4', state: 'pending' },
      ],
    }));
    expect(p).toMatchObject({ done: 2, total: 4, failed: 0, percent: 50, allGlowing: false });
  });

  it('only says it is a go when every piece glows', () => {
    expect(panelizerProgress(run({ pieces: [{ id: '1', label: 'P', state: 'done' }] })).allGlowing).toBe(true);
    expect(panelizerProgress(run({ pieces: [] })).allGlowing).toBe(false);
    expect(panelizerProgress(run({ pieces: [] })).percent).toBe(0);
  });

  it('reports failures without counting them as progress', () => {
    const p = panelizerProgress(run({ pieces: [
      { id: '1', label: 'P1', state: 'done' }, { id: '2', label: 'P2', state: 'failed' },
    ] }));
    expect(p).toMatchObject({ done: 1, failed: 1, allGlowing: false });
  });
});

describe('the rail', () => {
  it('excludes skipped steps from the count and finds the live one', () => {
    const s = stageProgress(run({ stages: [
      { key: 'a', label: 'A', explanation: '', state: 'complete' },
      { key: 'b', label: 'B', explanation: '', state: 'skipped' },
      { key: 'c', label: 'C', explanation: '', state: 'waiting' },
      { key: 'd', label: 'D', explanation: '', state: 'pending' },
    ] }));
    expect(s.done).toBe(1);
    expect(s.total).toBe(3);
    expect(s.current?.key).toBe('c');
  });
});

describe('what keeps polling', () => {
  // A human release can land at any moment; the customer should see it without
  // reloading. A released or failed run has nothing left to watch.
  it('polls while building AND while a person is checking', () => {
    expect(panelizerIsLive(run({ outcome: 'building' }))).toBe(true);
    expect(panelizerIsLive(run({ outcome: 'validating' }))).toBe(true);
    expect(panelizerIsLive(run({ outcome: 'ready' }))).toBe(false);
    expect(panelizerIsLive(run({ outcome: 'failed' }))).toBe(false);
  });
});

describe('GraphicsPro speaks the same model', () => {
  it('turns its own status vocabulary into the shared rail', () => {
    const r = graphicsPanelizerRun({ id: 'abc12345-0000', status: 'processing', mode: 'design' });
    expect(r.product).toBe('graphicspro');
    expect(r.stages.map(s => s.key)).toEqual(['surface', 'design', 'approved', 'cut']);
    // Everything before the running step really did finish.
    expect(r.stages.find(s => s.key === 'surface')!.state).toBe('complete');
    expect(r.stages.find(s => s.key === 'cut')!.state).toBe('running');
    expect(r.outcome).toBe('building');
  });

  it('glows a cut file only once the file exists', () => {
    const r = graphicsPanelizerRun({
      id: 'a', status: 'complete', mode: 'design',
      files: [{ format: 'pdf', path: 'x.pdf' }, { format: 'svg', path: null as any, error: 'failed' }],
    });
    expect(r.pieces.find(p => p.id === 'pdf')!.state).toBe('done');
    expect(r.pieces.find(p => p.id === 'svg')!.state).not.toBe('done');
    expect(r.outcome).toBe('ready');
  });

  // A failure stops the rail where it stood rather than reddening steps that
  // genuinely completed earlier.
  it('keeps completed steps complete when a later one fails', () => {
    const r = graphicsPanelizerRun({ id: 'a', status: 'failed', mode: 'design' });
    expect(r.outcome).toBe('failed');
    expect(r.headline).toMatch(/could not be produced/i);
    expect(r.detail).toMatch(/nothing was charged twice/i);
  });
});
