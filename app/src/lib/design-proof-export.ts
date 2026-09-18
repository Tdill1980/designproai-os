import { supabase } from '@/integrations/supabase/client';

export interface DesignProofMetadata {
  tool?: 'patternpro' | 'wallpro';
  brand: 'designpro' | 'weprintwraps';
  title: string;
  footer: string;
  vehicle: string;
  design: string;
  finish: string;
  yards?: number;
  wall?: { widthInches: number; heightInches: number; squareFeet: number; linearFeet: number; panels: number };
  customerName?: string;
  quoteNumber?: string;
  orderNumber?: string;
  sourceId?: string;
  includeTerms: boolean;
}

export function proofQuantity(metadata: DesignProofMetadata) {
  return metadata.tool === 'wallpro' && metadata.wall
    ? `${metadata.wall.widthInches}″ × ${metadata.wall.heightInches}″ · ${metadata.wall.squareFeet} sq ft · ${metadata.wall.panels} panels`
    : `${metadata.yards} linear yards on a 60-inch roll`;
}

export interface SavedDesignProof { path: string; pdfUrl: string }

async function invoke(body: unknown) {
  const { data, error } = await supabase.functions.invoke('design-proof-export', { body });
  if (error || !data?.success) {
    let detail = data?.error;
    if (!detail && error?.context instanceof Response) {
      try { detail = (await error.context.clone().json()).error; } catch { /* use SDK error */ }
    }
    throw new Error(detail || error?.message || 'The proof could not be saved. Please try again.');
  }
  return data;
}

export async function saveDesignProof(pdf: Blob, metadata: DesignProofMetadata): Promise<SavedDesignProof> {
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return invoke({ action: 'save', pdfBase64: btoa(binary), metadata });
}

export async function emailDesignProof(proof: SavedDesignProof, to: string, subject: string, message: string) {
  return invoke({ action: 'email', path: proof.path, to, subject, message });
}
