import { openDB } from 'idb';
import type { CreateGenerationRequestOptions, GenerationVehicle } from './designpro-api';
import type { RecreatePath, RecreatePayment, ReferenceSurface } from './recreatepro-intake';

export type RecreateReference = { id: string; file: File; originalPdf?: File; surface: ReferenceSurface };
export type RecreateDraft = {
  version: 1; updatedAt: number; path: RecreatePath | null; payment: RecreatePayment;
  vehicle: GenerationVehicle; notes: string; references: RecreateReference[];
  requestId?: string; submitted?: CreateGenerationRequestOptions; sourceGenerationId?: string;
};
const MAX_AGE = 24 * 60 * 60 * 1000;
const db = () => openDB('designproai-recreatepro', 1, { upgrade(database) { database.createObjectStore('drafts'); } });

export async function loadRecreateDraft(owner: string): Promise<RecreateDraft | null> {
  const database = await db();
  try {
    const value = await database.get('drafts', owner) as RecreateDraft | undefined;
    if (!value || value.version !== 1 || !Number.isFinite(value.updatedAt) || Math.abs(Date.now() - value.updatedAt) > MAX_AGE
      || !Array.isArray(value.references) || value.references.length > 6
      || value.references.some(ref => !(ref?.file instanceof Blob) || !ref.id)
      || !value.vehicle || typeof value.notes !== 'string'
      || ![null, 'exact', 'complete', 'transfer'].includes(value.path)
      || !['project', 'subscription'].includes(value.payment)) {
      if (value) await database.delete('drafts', owner);
      return null;
    }
    return value;
  } finally { database.close(); }
}
export async function saveRecreateDraft(owner: string, draft: RecreateDraft): Promise<void> {
  const database = await db();
  try { await database.put('drafts', draft, owner); } finally { database.close(); }
}
export async function clearRecreateDraft(owner: string): Promise<void> {
  const database = await db();
  try { await database.delete('drafts', owner); } finally { database.close(); }
}
