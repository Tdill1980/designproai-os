/**
 * The recovery lane must publish the batch's designs and NOT a customer's.
 *
 * Fixtures are the real production rows, taken verbatim from
 * `wallpro_generations` in designproai-os-prod on 2026-09-18: the 09-16 batch
 * run, the 09-14 legacy-library batch run, and the customer sessions
 * ("Matched design" with a wallPath, a refine, a design-for-my-wall) that sit
 * beside them in the same table and must never reach a public storefront.
 */
import { describe, it, expect } from 'vitest';
import {
  looksLikeBatchRun,
  recoverableGenerations,
  nextRecoveryDesignId,
  recoveryTitle,
  inferIndustry,
  segmentForIndustry,
  recoveryEntry,
  RECOVERY_DESIGN_TYPE,
  RECOVERY_FALLBACK_INDUSTRY,
  type RecoverableGeneration,
} from '../wallpro-recovery';
import { designUpsertRow, engineForDesignType } from '../wallpro-catalog';

const BATCH: RecoverableGeneration = {
  id: 'b6c8c2fb-f990-454a-829e-3c350238efd2',
  design_name: 'Layered mountain range silhouettes — five overlapping layers from dark navy foreground to light blue background, clean f',
  artwork_path: '61cc6c1c/generated/b6c8c2fb.jpg',
  created_at: '2026-09-16T02:49:23.022Z',
  input: { width: 144, height: 96, intent: 'prompt', prompt: 'Layered mountain range silhouettes — five overlapping layers from dark navy foreground to light blue background, clean flat design, peaceful depth', wallPath: null },
};
const BEAST: RecoverableGeneration = {
  id: '980a98f8-2baf-4253-8c65-df58d48a393a',
  design_name: 'Aggressive grunge typography wall — massive BEAST MODE text with cracked concrete texture, splattered red and black pain',
  artwork_path: '61cc6c1c/generated/980a98f8.jpg',
  created_at: '2026-09-16T02:29:34.128Z',
  input: { intent: 'prompt', prompt: 'Aggressive grunge typography wall — massive BEAST MODE text with cracked concrete texture, splattered red and black paint, industrial metal rivets, raw power energy', wallPath: null },
};
const MATCHED: RecoverableGeneration = {
  id: '121d12a8-d1e4-4b69-8585-0aa2acf7e566',
  design_name: 'Matched design',
  artwork_path: '61cc6c1c/generated/121d12a8.jpg',
  created_at: '2026-09-12T21:11:09.332Z',
  input: { width: 120, height: 96, intent: 'match', prompt: '', wallPath: '61cc6c1c/uploads/dfe9202e.jpg' },
};
const FOR_MY_WALL: RecoverableGeneration = {
  id: '55c4d580-4654-427f-a163-4f11454e0f9f',
  design_name: 'Serene floral with modern design beige , blue , sage green boho look',
  artwork_path: '61cc6c1c/generated/55c4d580.jpg',
  created_at: '2026-09-12T06:05:27.970Z',
  input: { intent: 'wall', prompt: 'Serene floral with modern design beige , blue , sage green boho look', wallPath: '61cc6c1c/uploads/4b30a6b4.png' },
};
const REFINE: RecoverableGeneration = {
  id: '71400f69-1278-4e49-8eeb-aadbd2ee95df',
  design_name: 'Refined: straighten curtains',
  artwork_path: '61cc6c1c/generated/71400f69.jpg',
  created_at: '2026-09-12T06:01:31.913Z',
  input: { intent: 'refine', prompt: 'straighten curtains', wallPath: null },
};

describe('looksLikeBatchRun', () => {
  it('accepts a prompt-only batch generation', () => {
    expect(looksLikeBatchRun(BATCH.input)).toBe(true);
    expect(looksLikeBatchRun(BEAST.input)).toBe(true);
  });

  it("refuses a customer's matched upload", () => {
    expect(looksLikeBatchRun(MATCHED.input)).toBe(false);
  });

  it("refuses a design made for somebody's own wall photo", () => {
    expect(looksLikeBatchRun(FOR_MY_WALL.input)).toBe(false);
  });

  it('refuses a refinement — it edits a private version, it is not stock', () => {
    expect(looksLikeBatchRun(REFINE.input)).toBe(false);
  });

  it('refuses a missing or empty brief rather than publishing an untitled design', () => {
    expect(looksLikeBatchRun(null)).toBe(false);
    expect(looksLikeBatchRun({ intent: 'prompt', prompt: '   ' })).toBe(false);
  });
});

describe('recoverableGenerations', () => {
  const all = [BATCH, BEAST, MATCHED, FOR_MY_WALL, REFINE];

  it('returns only the batch runs', () => {
    expect(recoverableGenerations(all, []).map(g => g.id)).toEqual([BATCH.id, BEAST.id]);
  });

  it('drops anything already published, so a second pass cannot duplicate it', () => {
    expect(recoverableGenerations(all, [BATCH.id]).map(g => g.id)).toEqual([BEAST.id]);
  });

  it('is newest first', () => {
    const out = recoverableGenerations([BEAST, BATCH], []);
    expect(out[0].id).toBe(BATCH.id);
  });

  it('drops a generation with no artwork', () => {
    expect(recoverableGenerations([{ ...BATCH, artwork_path: '' }], [])).toHaveLength(0);
  });
});

describe('nextRecoveryDesignId', () => {
  it('starts at WPB-R0001 on an empty catalog', () => {
    expect(nextRecoveryDesignId([])).toBe('WPB-R0001');
  });

  it('continues past the highest existing recovery id', () => {
    expect(nextRecoveryDesignId(['WPB-R0001', 'WPB-R0007', 'WPB-0042'])).toBe('WPB-R0008');
  });

  it('ignores library and AI ids when numbering', () => {
    expect(nextRecoveryDesignId(['WPB-0500', 'WPB-AI-20260918-03'])).toBe('WPB-R0001');
  });

  it('never repeats within one pass', () => {
    const assigned: string[] = [];
    for (let i = 0; i < 5; i += 1) assigned.push(nextRecoveryDesignId(assigned));
    expect(new Set(assigned).size).toBe(5);
  });
});

describe('recoveryTitle', () => {
  it('takes the subject clause, not the whole brief', () => {
    expect(recoveryTitle(BATCH.design_name)).toBe('Layered mountain range silhouettes');
  });

  it('never ends on the half word the column truncation left', () => {
    const title = recoveryTitle('A very long single clause with no dash at all that runs past the ninety character cap and stops mid-wo');
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith('mid-wo')).toBe(false);
  });

  it('falls back to the prompt, then to a label — never to empty', () => {
    expect(recoveryTitle(null, 'Brushed brass fan pattern')).toBe('Brushed brass fan pattern');
    expect(recoveryTitle(null, null)).toBe('Recovered design');
    expect(recoveryTitle('   ')).toBe('Recovered design');
  });

  it('produces a title designUpsertRow will accept', () => {
    for (const g of [BATCH, BEAST, MATCHED, FOR_MY_WALL]) {
      const title = recoveryTitle(g.design_name);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(160);
    }
  });
});

describe('inferIndustry', () => {
  it('reads the gym out of the owner BEAST MODE brief', () => {
    expect(inferIndustry(BEAST.design_name)).toBe('Gyms & Performance Fitness');
  });

  it('reads a tech space out of a data-network brief', () => {
    expect(inferIndustry('Abstract world map — continents as connected dot networks, global business aesthetic')).toBe('Tech, SaaS & Innovation Spaces');
  });

  it('reads a bedroom as residential', () => {
    expect(inferIndustry('Create a photographic fine art for a primary bedroom')).toBe('Homeowner Residential');
  });

  it('prefers the specific term when both appear', () => {
    expect(inferIndustry('A gym inside a corporate office')).toBe('Gyms & Performance Fitness');
  });

  it('falls back rather than inventing an industry the storefront cannot filter', () => {
    expect(inferIndustry('Layered mountain range silhouettes')).toBe(RECOVERY_FALLBACK_INDUSTRY);
    expect(inferIndustry('')).toBe(RECOVERY_FALLBACK_INDUSTRY);
  });
});

describe('segmentForIndustry', () => {
  it('marks homes B2C and businesses B2B', () => {
    expect(segmentForIndustry('Homeowner Residential')).toBe('B2C');
    expect(segmentForIndustry('Nursery, Kids & Teen Residential')).toBe('B2C');
    expect(segmentForIndustry('Gyms & Performance Fitness')).toBe('B2B');
  });
});

describe('recoveryEntry', () => {
  it('keeps the original brief verbatim as the prompt', () => {
    const entry = recoveryEntry(BATCH, 'WPB-R0001');
    expect(entry.prompt).toBe(BATCH.input!.prompt);
  });

  it('is always a mural design type, never a repeat', () => {
    expect(engineForDesignType(RECOVERY_DESIGN_TYPE)).toBe('mural');
    expect(engineForDesignType(recoveryEntry(BEAST, 'WPB-R0002').designType)).toBe('mural');
  });

  it("takes the curator's edits over the inference", () => {
    const entry = recoveryEntry(BATCH, 'WPB-R0001', { title: 'Blue Ridge', industry: 'Hotels & Resorts' });
    expect(entry.title).toBe('Blue Ridge');
    expect(entry.industry).toBe('Hotels & Resorts');
    expect(entry.segment).toBe('B2B');
  });

  it('survives an empty edit without publishing an empty title', () => {
    expect(recoveryEntry(BATCH, 'WPB-R0001', { title: '  ' }).title).toBe('Recovered design');
  });

  it('builds a row designUpsertRow accepts end to end', () => {
    const entry = recoveryEntry(BEAST, nextRecoveryDesignId([]));
    const row = designUpsertRow({
      entry, mode: 'mural',
      generationId: BEAST.id,
      promptHash: 'a'.repeat(64), masterSha256: 'b'.repeat(64),
      masterPath: 'catalog/x.jpg', thumbPath: 'catalog/x-thumb.jpg',
      widthPx: 4096, heightPx: 2731, seam: null, createdBy: '61cc6c1c-554c-440c-8e07-a64469f1f4eb',
    });
    expect(row.design_id).toBe('WPB-R0001');
    expect(row.industry).toBe('Gyms & Performance Fitness');
    expect(row.mode).toBe('mural');
    expect(row.tile_width_in).toBeNull();
    expect(row.seam).toBeNull();
    expect(row.approval_status).toBe('approved');
    expect(row.is_active).toBe(true);
  });
});
