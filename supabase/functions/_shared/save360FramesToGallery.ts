// save360FramesToGallery.ts - Save 360° spin frames to color_visualizations

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface Vehicle {
  year: string | number;
  make: string;
  model: string;
}

interface SaveResult {
  id: string;
  heroUrl: string;
  frameCount: number;
}

export async function save360FramesToGallery(
  supabase: SupabaseClient,
  frames: string[],
  vehicle: Vehicle,
  mode: string,
  colorData?: {
    colorName?: string;
    colorHex?: string;
    finish?: string;
    manufacturer?: string;
  },
  userEmail: string = 'system@restylepro.com'
): Promise<SaveResult> {
  const heroUrl = frames[0];
  
  // Build spin_views object with angle keys
  const spinViews: Record<string, string> = {};
  const angleStep = 360 / frames.length;
  
  frames.forEach((url, index) => {
    const angleDegrees = Math.round(index * angleStep);
    spinViews[`angle_${angleDegrees}`] = url;
  });

  // Build render_urls with hero + spin views
  const renderUrls = {
    hero: heroUrl,
    spin_views: spinViews
  };

  const { data, error } = await supabase
    .from('color_visualizations')
    .insert({
      customer_email: userEmail,
      vehicle_year: typeof vehicle.year === 'string' ? parseInt(vehicle.year) : vehicle.year,
      vehicle_make: vehicle.make,
      vehicle_model: vehicle.model,
      color_name: colorData?.colorName || 'Custom Design',
      color_hex: colorData?.colorHex || '#000000',
      finish_type: colorData?.finish || 'gloss',
      mode_type: mode,
      render_urls: renderUrls,
      has_360_spin: true,
      spin_view_count: frames.length,
      generation_status: 'completed',
      is_saved: true,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving 360 frames to gallery:', error);
    throw new Error(`Failed to save 360 frames: ${error.message}`);
  }

  return {
    id: data.id,
    heroUrl,
    frameCount: frames.length
  };
}

export async function update360SpinViews(
  supabase: SupabaseClient,
  visualizationId: string,
  spinViews: Record<string, string>
): Promise<void> {
  // First get existing render_urls
  const { data: existing, error: fetchError } = await supabase
    .from('color_visualizations')
    .select('render_urls')
    .eq('id', visualizationId)
    .single();

  if (fetchError) {
    console.error('Error fetching existing visualization:', fetchError);
    throw new Error(`Failed to fetch visualization: ${fetchError.message}`);
  }

  // Merge spin_views into existing render_urls
  const updatedRenderUrls = {
    ...(existing?.render_urls || {}),
    spin_views: spinViews
  };

  const { error } = await supabase
    .from('color_visualizations')
    .update({
      render_urls: updatedRenderUrls,
      has_360_spin: true,
      spin_view_count: Object.keys(spinViews).length,
      updated_at: new Date().toISOString()
    })
    .eq('id', visualizationId);

  if (error) {
    console.error('Error updating 360 spin views:', error);
    throw new Error(`Failed to update spin views: ${error.message}`);
  }
}
