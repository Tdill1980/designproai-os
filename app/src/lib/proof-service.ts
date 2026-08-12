/**
 * PROOF SERVICE
 * 
 * Central service for generating, saving, and sharing proof sheets.
 * All proof generation must go through this service.
 * 
 * Responsibilities:
 * 1. Call generate-approvepro-pdf edge function
 * 2. Create record in proofs table
 * 3. Generate shareable token in proof_access_tokens
 * 4. Return PDF URL and share link
 */

import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { getToolLabel, type ToolKey } from './tool-registry';

export interface ProofView {
  type: string;
  url: string;
  label?: string;
}

export interface VehicleInfo {
  year?: string;
  make?: string;
  model?: string;
}

export interface ProofRequest {
  // Tool identification
  toolKey: ToolKey;

  // Views to include
  views: ProofView[];

  // Vehicle info
  vehicleInfo: VehicleInfo;

  // Film/design information
  manufacturer?: string;
  filmName?: string;
  productCode?: string;
  finish?: string;

  // Customer/shop info
  customerName?: string;
  shopName?: string;
  shopLogoUrl?: string;

  // Multi-tenant scope — shops.id from OrganizationContext. Populated on
  // writes so teammates can see each other's proofs via Phase 1b RLS.
  // Optional for legacy call sites that haven't been wired yet.
  shopId?: string | null;

  // Options
  includeTerms?: boolean;
}

export interface ProofResult {
  success: boolean;
  proofId?: string;
  pdfUrl?: string;
  shareUrl?: string;
  shareToken?: string;
  error?: string;
}

/**
 * Generate and save a proof sheet
 */
export async function generateAndSaveProof(request: ProofRequest): Promise<ProofResult> {
  try {
    // Get the authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'User must be authenticated to generate proofs' };
    }

    // Get tool label from registry
    const toolLabel = getToolLabel(request.toolKey);

    // 1. Call the edge function to generate PDF
    const { data: pdfData, error: pdfError } = await renderClient.functions.invoke('generate-approvepro-pdf', {
      body: {
        toolName: toolLabel,
        views: request.views,
        vehicleInfo: request.vehicleInfo,
        manufacturer: request.manufacturer,
        filmName: request.filmName,
        productCode: request.productCode,
        finish: request.finish,
        customerName: request.customerName,
        shopName: request.shopName,
        shopLogoUrl: request.shopLogoUrl,
        includeTerms: request.includeTerms,
      },
    });

    if (pdfError) {
      console.error('PDF generation error:', pdfError);
      return { success: false, error: pdfError.message };
    }

    if (!pdfData?.success || !pdfData?.url) {
      return { success: false, error: pdfData?.error || 'Failed to generate PDF' };
    }

    const pdfUrl = pdfData.url;

    // 2. Create proof record in database
    const { data: proofRecord, error: proofError } = await supabase
      .from('proofs')
      .insert({
        owner_user_id: user.id,
        shop_id: request.shopId ?? null,
        tool_name: toolLabel,
        manufacturer: request.manufacturer,
        film_or_design_name: request.filmName,
        render_urls: request.views.map(v => v.url),
        pdf_url: pdfUrl,
        vehicle_info: {
          year: request.vehicleInfo.year,
          make: request.vehicleInfo.make,
          model: request.vehicleInfo.model,
          shopName: request.shopName, // Store shop name in vehicle_info jsonb
        },
        customer_name: request.customerName,
        status: 'pending',
      })
      .select()
      .single();

    if (proofError) {
      console.error('Proof record creation error:', proofError);
      // PDF was generated, return it even if database save failed
      return { 
        success: true, 
        pdfUrl,
        error: 'PDF generated but failed to save record',
      };
    }

    const proofId = proofRecord.id;

    // 3. Generate shareable token
    const shareToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Token expires in 30 days

    const { error: tokenError } = await supabase
      .from('proof_access_tokens')
      .insert({
        proof_id: proofId,
        token: shareToken,
        expires_at: expiresAt.toISOString(),
        revoked: false,
      });

    if (tokenError) {
      console.error('Token creation error:', tokenError);
      // Proof was saved, return without share URL
      return {
        success: true,
        proofId,
        pdfUrl,
        error: 'Proof saved but failed to create share link',
      };
    }

    // Build share URL (proof viewer page) - safe for SSR/non-browser contexts
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = baseUrl ? `${baseUrl}/proof/${shareToken}` : undefined;

    return {
      success: true,
      proofId,
      pdfUrl,
      shareUrl,
      shareToken,
    };

  } catch (error) {
    console.error('Proof generation error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate PDF only (without saving to database)
 * Use for Download/Print actions
 */
export async function generateProofPdf(request: ProofRequest): Promise<{ success: boolean; pdfUrl?: string; error?: string }> {
  try {
    const toolLabel = getToolLabel(request.toolKey);

    const { data, error } = await renderClient.functions.invoke('generate-approvepro-pdf', {
      body: {
        toolName: toolLabel,
        views: request.views,
        vehicleInfo: request.vehicleInfo,
        manufacturer: request.manufacturer,
        filmName: request.filmName,
        productCode: request.productCode,
        finish: request.finish,
        customerName: request.customerName,
        shopName: request.shopName,
        shopLogoUrl: request.shopLogoUrl,
        includeTerms: request.includeTerms,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success || !data?.url) {
      return { success: false, error: data?.error || 'Failed to generate PDF' };
    }

    return { success: true, pdfUrl: data.url };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get proof by share token (for public access)
 */
export async function getProofByToken(token: string) {
  const { data: tokenRecord, error: tokenError } = await supabase
    .from('proof_access_tokens')
    .select(`
      *,
      proofs (*)
    `)
    .eq('token', token)
    .eq('revoked', false)
    .single();

  if (tokenError || !tokenRecord) {
    return { success: false, error: 'Invalid or expired token' };
  }

  // Check if token is expired
  if (new Date(tokenRecord.expires_at) < new Date()) {
    return { success: false, error: 'Token has expired' };
  }

  return { success: true, proof: tokenRecord.proofs };
}

/**
 * Load shop profile for current user
 */
export async function loadShopProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from('shop_profiles')
    .select('shop_name, shop_logo_url, default_include_disclaimer')
    .eq('user_id', user.id)
    .single();

  return data;
}
