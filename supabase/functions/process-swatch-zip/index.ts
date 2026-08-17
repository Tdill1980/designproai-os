import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { zipUrl, manufacturer } = await req.json();

    if (!zipUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing zipUrl parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ZIP from: ${zipUrl}`);
    console.log(`Manufacturer filter: ${manufacturer || 'auto-detect'}`);

    // Fetch the ZIP file
    const zipResponse = await fetch(zipUrl);
    if (!zipResponse.ok) {
      throw new Error(`Failed to fetch ZIP: ${zipResponse.statusText}`);
    }

    const zipBuffer = await zipResponse.arrayBuffer();
    console.log(`ZIP size: ${zipBuffer.byteLength} bytes`);

    // Parse the ZIP
    const zip = await JSZip.loadAsync(zipBuffer);
    
    const results: { productCode: string; status: string; url?: string; error?: string }[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each file in the ZIP
    for (const [path, zipEntry] of Object.entries(zip.files)) {
      // Skip directories
      if (zipEntry.dir) continue;
      
      // Skip non-image files
      const lowerPath = path.toLowerCase();
      if (!lowerPath.endsWith('.png') && !lowerPath.endsWith('.jpg') && !lowerPath.endsWith('.jpeg')) {
        console.log(`Skipping non-image: ${path}`);
        continue;
      }

      // Parse path to get manufacturer and product code
      const parts = path.split('/').filter(p => p.length > 0);
      let detectedManufacturer: string;
      let fileName: string;
      
      if (parts.length >= 2) {
        detectedManufacturer = parts[parts.length - 2].toLowerCase();
        fileName = parts[parts.length - 1];
      } else if (parts.length === 1) {
        fileName = parts[0];
        // Auto-detect from filename
        if (fileName.startsWith('2080-') || fileName.startsWith('1080-')) {
          detectedManufacturer = '3m';
        } else if (fileName.startsWith('SW900-') || fileName.startsWith('SW')) {
          detectedManufacturer = 'avery';
        } else {
          detectedManufacturer = manufacturer?.toLowerCase() || '3m'; // Default to 3m
        }
      } else {
        continue;
      }

      // Override with provided manufacturer if specified
      const finalManufacturer = manufacturer?.toLowerCase() || detectedManufacturer;
      
      // Extract product code from filename
      const productCode = fileName.replace(/\.(png|jpg|jpeg)$/i, '');
      
      console.log(`Processing: ${productCode} (${finalManufacturer})`);

      try {
        // Get blob content
        const blob = await zipEntry.async('blob');
        
        // Upload to Supabase Storage
        const storagePath = `official/${finalManufacturer}/${productCode}.png`;
        
        const { error: uploadError } = await supabase.storage
          .from('swatches')
          .upload(storagePath, blob, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('swatches')
          .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        // Map manufacturer key to database name
        const dbManufacturer = finalManufacturer === '3m' ? '3M' : 
                               finalManufacturer === 'avery' ? 'Avery Dennison' : 
                               finalManufacturer;

        // Update manufacturer_colors table
        const { data: updateData, error: dbError } = await supabase
          .from('manufacturer_colors')
          .update({
            official_swatch_url: publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('product_code', productCode)
          .eq('manufacturer', dbManufacturer)
          .select();

        if (dbError) {
          console.warn(`DB update warning for ${productCode}:`, dbError.message);
        }

        const linked = updateData && updateData.length > 0;
        
        results.push({
          productCode,
          status: linked ? 'uploaded_and_linked' : 'uploaded_only',
          url: publicUrl,
        });

        successCount++;
        console.log(`✓ ${productCode}: ${linked ? 'linked' : 'uploaded (no DB match)'}`);
        
      } catch (err: any) {
        console.error(`✗ ${productCode}: ${err.message}`);
        results.push({
          productCode,
          status: 'error',
          error: err.message,
        });
        errorCount++;
      }
    }

    const summary = {
      total: results.length,
      success: successCount,
      errors: errorCount,
      linked: results.filter(r => r.status === 'uploaded_and_linked').length,
      uploadedOnly: results.filter(r => r.status === 'uploaded_only').length,
    };

    console.log('Processing complete:', JSON.stringify(summary));

    return new Response(
      JSON.stringify({ 
        success: true, 
        summary,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error processing ZIP:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
