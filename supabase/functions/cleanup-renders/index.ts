import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    // Get auth header and verify admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - no auth header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user is an admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has admin role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Forbidden - admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin verified, starting cleanup...');

    const { action } = await req.json();
    
    if (action === 'stats') {
      // Return statistics only
      const stats = await getCleanupStats(supabase);
      return new Response(
        JSON.stringify({ success: true, stats }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'clean') {
      // Perform cleanup
      const results = await performCleanup(supabase);
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "stats" or "clean"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Cleanup error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getCleanupStats(supabase: any) {
  // Count problematic vehicle_renders
  const { data: vrCustom } = await supabase
    .from('vehicle_renders')
    .select('id', { count: 'exact' })
    .or('color_data->>colorName.ilike.%custom%,color_data->>colorName.ilike.%unknown%');
  
  const { data: vrPipe } = await supabase
    .from('vehicle_renders')
    .select('id', { count: 'exact' })
    .like('color_data->>colorName', '%|%');
  
  const { data: vrGraphics } = await supabase
    .from('vehicle_renders')
    .select('id', { count: 'exact' })
    .in('mode_type', ['GraphicsPro', 'graphicspro', 'CustomStyling']);

  // Count problematic color_visualizations
  const { data: cvCustom } = await supabase
    .from('color_visualizations')
    .select('id', { count: 'exact' })
    .or('color_name.ilike.%custom%,color_name.ilike.%unknown%');
  
  const { data: cvPipe } = await supabase
    .from('color_visualizations')
    .select('id', { count: 'exact' })
    .like('color_name', '%|%');

  return {
    vehicle_renders: {
      custom_labels: vrCustom?.length || 0,
      pipe_labels: vrPipe?.length || 0,
      graphicspro_mode: vrGraphics?.length || 0,
      total: (vrCustom?.length || 0) + (vrPipe?.length || 0) + (vrGraphics?.length || 0)
    },
    color_visualizations: {
      custom_labels: cvCustom?.length || 0,
      pipe_labels: cvPipe?.length || 0,
      total: (cvCustom?.length || 0) + (cvPipe?.length || 0)
    }
  };
}

async function performCleanup(supabase: any) {
  const deleted = {
    vehicle_renders: 0,
    color_visualizations: 0
  };

  // Delete from vehicle_renders - custom/unknown labels
  const { data: vr1, error: vrErr1 } = await supabase
    .from('vehicle_renders')
    .delete()
    .or('color_data->>colorName.ilike.%custom%,color_data->>colorName.ilike.%unknown%')
    .select('id');
  
  if (!vrErr1) deleted.vehicle_renders += vr1?.length || 0;
  console.log(`Deleted ${vr1?.length || 0} vehicle_renders with custom/unknown labels`);

  // Delete from vehicle_renders - pipe character
  const { data: vr2, error: vrErr2 } = await supabase
    .from('vehicle_renders')
    .delete()
    .like('color_data->>colorName', '%|%')
    .select('id');
  
  if (!vrErr2) deleted.vehicle_renders += vr2?.length || 0;
  console.log(`Deleted ${vr2?.length || 0} vehicle_renders with pipe character`);

  // Delete from vehicle_renders - GraphicsPro mode
  const { data: vr3, error: vrErr3 } = await supabase
    .from('vehicle_renders')
    .delete()
    .in('mode_type', ['GraphicsPro', 'graphicspro', 'CustomStyling'])
    .select('id');
  
  if (!vrErr3) deleted.vehicle_renders += vr3?.length || 0;
  console.log(`Deleted ${vr3?.length || 0} vehicle_renders with GraphicsPro mode`);

  // Delete from color_visualizations - custom/unknown
  const { data: cv1, error: cvErr1 } = await supabase
    .from('color_visualizations')
    .delete()
    .or('color_name.ilike.%custom%,color_name.ilike.%unknown%')
    .select('id');
  
  if (!cvErr1) deleted.color_visualizations += cv1?.length || 0;
  console.log(`Deleted ${cv1?.length || 0} color_visualizations with custom/unknown`);

  // Delete from color_visualizations - pipe character
  const { data: cv2, error: cvErr2 } = await supabase
    .from('color_visualizations')
    .delete()
    .like('color_name', '%|%')
    .select('id');
  
  if (!cvErr2) deleted.color_visualizations += cv2?.length || 0;
  console.log(`Deleted ${cv2?.length || 0} color_visualizations with pipe character`);

  return deleted;
}
