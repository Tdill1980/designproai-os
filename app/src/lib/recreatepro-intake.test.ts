import { describe, expect, it } from 'vitest';
import { buildRecreateRequest, recreateInputError, recreateFileError, recreationLinks, RECREATE_PATHS, type RecreatePath } from './recreatepro-intake';
import { permittedHandoffUrl } from './recreatepro-handoff';

const generationId = '11111111-1111-4111-8111-111111111111';
const asset = { storagePath: `users/owner/revisions/${generationId}/inputs/attachment/${'a'.repeat(64)}.png`, contentHash: 'a'.repeat(64), byteSize: 900, contentType: 'image/png' };
const vehicle = { year: '2024', make: 'Ford', model: 'Transit 250', type: 'van' as const };
const references = [{ asset, surface: 'driver' as const }];
const valid = { path: 'exact' as RecreatePath, count: 1, vehicle, notes: '', rights: true };

describe('RecreatePro input -> existing VehiclePro contract', () => {
  it.each(RECREATE_PATHS)('$key preserves the source identity and selects exact-reference authoring', ({ key }) => {
    const request = buildRecreateRequest({ generationId, path: key, vehicle, notes: '', references });
    expect(request.generationId).toBe(generationId);
    expect(request.pipelineMode).toBe('flat-first-atlas-v1');
    expect(request.brief.visionboardIntent).toBe('exact_reference');
    expect(request.brief.visionBoardImages).toEqual([asset]);
    expect(request.brief.styleDescriptors).toContain(`RecreatePro / ${key}.`);
    expect(request.brief.styleDescriptors).toContain('Reference 1: Driver side');
    expect(request.brief.styleDescriptors!.length).toBeLessThanOrEqual(2000);
    expect(Object.keys(request).sort()).toEqual(['brief', 'designName', 'generationId', 'pipelineMode', 'vehicle']);
  });
  it('keeps customer edit text verbatim, including whitespace and punctuation', () => {
    const notes = '  Keep this exact layout.\nChange ONLY the phone to (623) 555-0174.  ';
    const request = buildRecreateRequest({ generationId, path: 'complete', vehicle, notes, references });
    expect(request.brief.brief).toBe(notes);
    expect(request.brief.styleDescriptors).toContain('take precedence for the named details only');
  });
  it('one supplied van side explicitly completes unseen surfaces', () => {
    const request = buildRecreateRequest({ generationId, path: 'complete', vehicle, notes: '', references });
    expect(request.brief.styleDescriptors).toMatch(/only one side/);
    expect(request.brief.styleDescriptors).toMatch(/complete the remaining printable surfaces/);
    expect(request.brief.styleDescriptors).toMatch(/texture density/);
  });
  it('transfer names the target vehicle and records the source job without overwriting it', () => {
    const request = buildRecreateRequest({ generationId, path: 'transfer', vehicle: { ...vehicle, make: 'Mercedes-Benz', model: 'Sprinter' }, notes: '', references, sourceGenerationId: '22222222-2222-4222-8222-222222222222' });
    expect(request.vehicle.model).toBe('Sprinter');
    expect(request.brief.styleDescriptors).toContain('Reference vehicle geometry is context only');
    expect(request.brief.styleDescriptors).toContain('22222222-2222-4222-8222-222222222222');
  });
  it.each([
    [{ ...valid, path: null }, 'Choose'], [{ ...valid, count: 0 }, 'one and six'],
    [{ ...valid, count: 7 }, 'one and six'], [{ ...valid, rights: false }, 'permission'],
    [{ ...valid, vehicle: { ...vehicle, year: '24' } }, 'four-digit'],
    [{ ...valid, vehicle: { ...vehicle, make: '' } }, 'make'],
    [{ ...valid, notes: 'a'.repeat(4001) }, '4,000'],
  ])('rejects incomplete or unsafe intake %j', (input, message) => expect(recreateInputError(input)).toContain(message));
  it('accepts the supported inputs and never advertises unsupported vector import', () => {
    expect(recreateInputError(valid)).toBeNull();
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) expect(recreateFileError({ name: 'source', size: 1, type })).toBeNull();
    expect(recreateFileError({ name: 'bad.ai', size: 100, type: 'application/postscript' })).toContain('Export');
    expect(recreateFileError({ name: 'large.png', size: 25 * 1024 * 1024 + 1, type: 'image/png' })).toContain('25 MB');
    expect(recreateFileError({ name: 'empty.png', size: 0, type: 'image/png' })).toContain('empty');
  });
  it('revision and production links preserve one generation and the selected revision', () => {
    const links = recreationLinks(generationId, '33333333-3333-4333-8333-333333333333');
    expect(links.revision).toContain(`generationId=${generationId}`);
    expect(links.revision).toContain('sourceRevisionId=33333333');
    expect(links.production).toBe(`/designpro/jobs/${generationId}`);
    expect(() => recreationLinks('../someone-else')).toThrow();
  });
  it.each(['http://wozyamlnygaddievzuwn.supabase.co/storage/v1/object/a', 'https://evil.example/storage/v1/a', 'https://wozyamlnygaddievzuwn.supabase.co.evil.example/storage/v1/a', 'https://user:password@wozyamlnygaddievzuwn.supabase.co/storage/v1/a', 'javascript:alert(1)'])('rejects a non-storage handoff URL: %s', url => expect(permittedHandoffUrl(url)).toBe(false));
  it('accepts only known storage origins, reuploading rather than trusting their identity', () => {
    expect(permittedHandoffUrl('https://wozyamlnygaddievzuwn.supabase.co/storage/v1/object/sign/a')).toBe(true);
    expect(permittedHandoffUrl('https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/a')).toBe(true);
  });
});
