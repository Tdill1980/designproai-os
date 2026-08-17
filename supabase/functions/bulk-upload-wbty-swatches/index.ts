import { createExternalClient } from "../_shared/external-db.ts";
import JSZip from 'https://esm.sh/jszip@3.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadResult {
  productName: string;
  status: 'success' | 'failed' | 'not_found';
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Bulk upload request received');

    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    // Get the ZIP file from the request
    const formData = await req.formData();
    const zipFile = formData.get('file') as File;

    if (!zipFile) {
      throw new Error('No ZIP file provided');
    }

    console.log('ZIP file received:', zipFile.name, 'Size:', zipFile.size);

    // Load ZIP file
    const zipBuffer = await zipFile.arrayBuffer();
    const zip = await JSZip.loadAsync(zipBuffer);

    console.log('ZIP loaded successfully');

    // Get all products from database
    const { data: products, error: dbError } = await supabase
      .from('wbty_products')
      .select('id, name, category');

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    console.log(`Found ${products.length} products in database`);

    const results: UploadResult[] = [];

    // Process each file in the ZIP
    const filePromises: Promise<void>[] = [];
    
    zip.forEach((relativePath, zipEntry) => {
      // Skip directories and non-image files
      if (zipEntry.dir || !/\.(jpg|jpeg|png|webp)$/i.test(relativePath)) {
        return;
      }

      const filePromise = (async () => {
        const fileName = relativePath.split('/').pop() || '';
        
        // Normalize filename for matching (remove extension, handle spaces/hyphens)
        const nameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
        const normalizedFileName = nameWithoutExt
          .toLowerCase()
          .replace(/[-_]/g, ' ')
          .trim();

        // Find matching product
        const matchingProduct = products.find(p => {
          const normalizedProductName = p.name
            .toLowerCase()
            .replace(/[-_]/g, ' ')
            .trim();
          return normalizedProductName === normalizedFileName;
        });

        if (!matchingProduct) {
          console.log(`No match found for: ${fileName}`);
          results.push({
            productName: fileName,
            status: 'not_found',
            message: 'No matching product in database'
          });
          return;
        }

        try {
          // Extract file as Uint8Array
          const fileData = await zipEntry.async('uint8array');
          const fileExt = fileName.split('.').pop();
          const storagePath = `wbty/${matchingProduct.id}-${Date.now()}.${fileExt}`;

          // Upload to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('products')
            .upload(storagePath, fileData, {
              contentType: `image/${fileExt}`,
              upsert: true
            });

          if (uploadError) {
            throw uploadError;
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('products')
            .getPublicUrl(storagePath);

          // Update database
          const { error: updateError } = await supabase
            .from('wbty_products')
            .update({ media_url: publicUrl })
            .eq('id', matchingProduct.id);

          if (updateError) {
            throw updateError;
          }

          console.log(`Successfully uploaded: ${fileName} -> ${matchingProduct.name}`);
          results.push({
            productName: matchingProduct.name,
            status: 'success',
            message: `Uploaded successfully`
          });

        } catch (err) {
          const error = err as Error;
          console.error(`Failed to upload ${fileName}:`, error);
          results.push({
            productName: matchingProduct.name,
            status: 'failed',
            message: error.message
          });
        }
      })();

      filePromises.push(filePromise);
    });

    // Wait for all files to be processed
    await Promise.all(filePromises);

    console.log(`Processed ${results.length} files from ZIP`);

    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const notFoundCount = results.filter(r => r.status === 'not_found').length;

    console.log(`Bulk upload complete: ${successCount} success, ${failedCount} failed, ${notFoundCount} not found`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failedCount,
          notFound: notFoundCount
        },
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (err) {
    const error = err as Error;
    console.error('Bulk upload error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
