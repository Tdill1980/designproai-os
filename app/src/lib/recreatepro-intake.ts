import { inferDesignMode } from './inferDesignMode';
import type { AssetIdentity, CreateGenerationRequestOptions, GenerationVehicle } from './designpro-api';

export type RecreatePath = 'exact' | 'complete' | 'transfer';
export type RecreatePayment = 'project' | 'subscription';
export type ReferenceSurface = 'reference' | 'driver' | 'passenger' | 'rear' | 'front' | 'hood' | 'roof';
export const RECREATE_MAX_FILES = 6;
export const RECREATE_MAX_BYTES = 25 * 1024 * 1024;
export const RECREATE_PATHS = [
  { key: 'exact', title: 'Recreate Exactly', description: 'Rebuild the design you love. Keep its character and apply only your requested edits.', upload: 'Upload the design, AI image, photo or proof you want recreated.', action: 'Recreate my design' },
  { key: 'complete', title: 'Complete My Design', description: 'Only have one side? Recreate it and carry the design across the rest of the vehicle.', upload: 'Upload whatever you have—even one side of a van is a starting point.', action: 'Complete my wrap' },
  { key: 'transfer', title: 'Transfer to Another Vehicle', description: 'Keep the design. Recreate and fit it for a different vehicle.', upload: 'Upload the existing design, then enter the vehicle you want it fitted to.', action: 'Recreate on this vehicle' },
] as const;
export const RECREATE_SURFACES: ReadonlyArray<{ value: ReferenceSurface; label: string }> = [
  { value: 'reference', label: 'Design / general reference' }, { value: 'driver', label: 'Driver side' },
  { value: 'passenger', label: 'Passenger side' }, { value: 'rear', label: 'Rear' },
  { value: 'front', label: 'Front' }, { value: 'hood', label: 'Hood' }, { value: 'roof', label: 'Roof' },
];
export const RECREATE_VEHICLES: ReadonlyArray<{ value: GenerationVehicle['type']; label: string }> = [
  { value: 'van', label: 'Van' }, { value: 'truck', label: 'Truck' }, { value: 'car', label: 'Car' },
  { value: 'suv', label: 'SUV' }, { value: 'trailer', label: 'Trailer' }, { value: 'rv', label: 'RV' },
  { value: 'bus', label: 'Bus' }, { value: 'motorcycle', label: 'Motorcycle' }, { value: 'boat', label: 'Boat' },
];
const PATH_INSTRUCTIONS: Record<RecreatePath, string> = {
  exact: 'Faithfully reconstruct the supplied design. Preserve its layout and visual character on the target vehicle. Complete unseen surfaces by extending the established design language.',
  complete: 'The references may show only one side or part of a wrap. Faithfully recreate the visible design and intelligently complete the remaining printable surfaces as one cohesive full wrap.',
  transfer: 'Recreate the supplied design on the TARGET vehicle named in this request. Reference vehicle geometry is context only. Adapt placement and scale to the target body while preserving the established artwork and brand identity.',
};

export function recreateFileError(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!file.size) return `${file.name}: the file is empty.`;
  if (file.size > RECREATE_MAX_BYTES) return `${file.name}: the maximum file size is 25 MB.`;
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
    return `${file.name}: use JPG, PNG, WebP or PDF. Export other formats first.`;
  }
  return null;
}

export function recreateInputError(input: {
  path: RecreatePath | null; count: number; vehicle: GenerationVehicle; notes: string; rights: boolean;
}): string | null {
  if (!RECREATE_PATHS.some(path => path.key === input.path)) return 'Choose what you need RecreatePro to do.';
  if (input.count < 1 || input.count > RECREATE_MAX_FILES) return 'Add between one and six reference images.';
  if (!/^\d{4}$/.test(input.vehicle.year.trim()) || !input.vehicle.make.trim() || !input.vehicle.model.trim()) return 'Enter the target vehicle’s four-digit year, make and model.';
  if ([input.vehicle.make, input.vehicle.model].some(value => value.length > 120)) return 'Keep the vehicle make and model under 120 characters.';
  if (!RECREATE_VEHICLES.some(item => item.value === input.vehicle.type)) return 'Choose a supported vehicle type.';
  if (input.notes.length > 4000) return 'Keep your edit instructions under 4,000 characters.';
  if (!input.rights) return 'Confirm that you have permission to use the uploaded artwork.';
  return null;
}

/**
 * Reference: ProductionFlow.handleRecreateRender's reference-authoritative
 * recreation and coverage-density rules. Only transport changes: verified
 * input assets -> the SAME v3 request as VehiclePro. No legacy render, panel,
 * billing or production function is invoked. Customer edits stay verbatim in
 * brief; path guidance travels through the existing styleDescriptors field.
 */
export function buildRecreateRequest(input: {
  generationId: string; path: RecreatePath; vehicle: GenerationVehicle; notes: string;
  references: Array<{ asset: AssetIdentity; surface: ReferenceSurface }>;
  sourceGenerationId?: string;
}): CreateGenerationRequestOptions {
  const error = recreateInputError({ ...input, count: input.references.length, rights: true });
  if (error) throw new Error(error);
  const vehicle = { ...input.vehicle, year: input.vehicle.year.trim(), make: input.vehicle.make.trim(), model: input.vehicle.model.trim() };
  const sources = input.references.map((ref, i) => `Reference ${i + 1}: ${RECREATE_SURFACES.find(s => s.value === ref.surface)?.label || 'general reference'}`).join('; ');
  const guidance = [
    `RecreatePro / ${input.path}. ${PATH_INSTRUCTIONS[input.path]}`,
    'The uploaded artwork is the design authority. Preserve its colors, light-to-dark balance, texture density, gradients, striping, lettering, logos and hierarchy. A dense all-over design stays equally dense across the entire wrap. Plain areas stay plain.',
    'Keep known words, numbers, URLs and logos faithful. Reproduce each mark only where appropriate to the original composition. On unseen surfaces extend backgrounds and motifs; retain readable, correctly oriented branding.',
    input.notes.trim() ? 'The customer brief contains explicit requested edits. Those edits take precedence for the named details only; all other details remain faithful to the references.' : 'Reconstruct the supplied design without discretionary styling changes.',
    'Create complete rectangular panel artwork at the target vehicle dimensions. Printed art remains separate from mockup body lines, wheels, lighting and scenery. The existing production workflow owns bleed, proofing and final file validation.',
    sources,
    input.sourceGenerationId ? `Adapted from the reviewed production artwork of generation ${input.sourceGenerationId}.` : '',
  ].filter(Boolean).join('\n');
  if (guidance.length > 2000) throw new Error('Recreation context is too long.');
  return {
    generationId: input.generationId,
    pipelineMode: 'flat-first-atlas-v1',
    designName: `RecreatePro · ${vehicle.year} ${vehicle.make} ${vehicle.model}`.slice(0, 240),
    vehicle,
    brief: {
      brief: input.notes.trim() ? input.notes : `Recreate my uploaded design for the ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
      mode: inferDesignMode({ brief: input.notes }),
      visionboardIntent: 'exact_reference',
      visionBoardImages: input.references.map(ref => ref.asset),
      styleDescriptors: guidance,
    },
  };
}

export function recreationLinks(generationId: string, revisionId?: string | null) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationId)) throw new Error('Invalid design identity.');
  const query = new URLSearchParams({ generationId });
  if (revisionId) query.set('sourceRevisionId', revisionId);
  return {
    revision: `/revision-studio?${query}`,
    production: `/designpro/jobs/${generationId}`,
    progress: `/designpro/jobs/${generationId}/progress`,
    files: '/designpro/wrapbox',
  };
}
