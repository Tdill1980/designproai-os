import { describe, expect, it } from 'vitest';
import { wallDesignOf, wallProjectPath, wallStudioRow, type WallStudioDesign } from '../wallpro-studio';

const design: WallStudioDesign = {
  projectId: 'e174885a-bc93-4689-85bd-33fd2a352e71', projectName: 'My wall design',
  versionId: '60553d10-105a-44bf-8c55-2eddf1938049', versionNo: 1, approved: true, designId: 'DID-60553D10',
  artworkPath: 'owner/generated/a.jpg', artworkUrl: 'https://signed/master.jpg', placement: 'cover', repeatWidthIn: null,
  createdAt: '2026-09-11T16:41:00Z', approvedAt: '2026-09-11T16:41:30Z',
  job: { id: 'aefefbf9-ce62-4107-b598-25f67abb0a24', status: 'ready', error: null, manifestUrl: 'https://signed/manifest.json',
    panels: [{ number: 1, file: 'panel-001-59x98in.png', widthIn: 59, heightIn: 98, widthPx: 8850, heightPx: 14700, ppi: 150, byteSize: 196066411, url: 'https://signed/p1.png' }] },
};

describe('WallPro designs in RevisionStudioIQ', () => {
  it('projects a wall design onto the grid row keyed by its project, tagged wallpro, carrying the DesignID and the panels', () => {
    const row = wallStudioRow(design);
    expect(row.id).toBe(design.projectId);
    expect(row.mode_type).toBe('wallpro');
    expect(row.render_urls).toEqual({ hero: 'https://signed/master.jpg' });
    expect(row.design_id).toBe('DID-60553D10');
    expect(row.revision).toBe(1);
    expect(row.state).toBe('completed');
    expect(row.lineage_root_id).toBe(design.projectId);
    const back = wallDesignOf(row);
    expect(back?.job?.panels[0].url).toBe('https://signed/p1.png');
    expect(back?.job?.manifestUrl).toBe('https://signed/manifest.json');
  });
  it('a draft with no build is not called complete, and a vehicle row is not a wall', () => {
    const draft = wallStudioRow({ ...design, approved: false, approvedAt: null, job: null, artworkUrl: null });
    expect(draft.state).toBe('queued'); expect(draft.render_urls).toEqual({});
    expect(wallDesignOf({ mode_type: 'designpanelpro', admin_notes: JSON.stringify({ wallpro: design }) })).toBeNull();
    expect(wallDesignOf({ mode_type: 'wallpro', admin_notes: 'not json' })).toBeNull();
  });
  it('reopens in WallPro by project', () => {
    expect(wallProjectPath(design.projectId)).toBe('/printpro/wallpro?project=' + design.projectId);
  });
});
