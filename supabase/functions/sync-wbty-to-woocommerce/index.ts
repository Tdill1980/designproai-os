import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Product ID mapping — AUTHORITATIVE WooCommerce IDs
const CATEGORY_TO_PRODUCT_ID: Record<string, number> = {
  'Camo & Carbon': 1726,
  'Metal & Marble': 39698,
  'Wicked & Wild': 4181,
  'Bape Camo': 42809,
  'Modern & Trippy': 52489,
};

interface WBTYProduct {
  id: string;
  name: string;
  category: string;
  media_url: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting WBTY to WooCommerce sync...');

    // Initialize Supabase client
    const supabase = createExternalClient();

    // Get WooCommerce credentials
    const wooCommerceUrl = Deno.env.get('WOOCOMMERCE_URL');
    const consumerKey = Deno.env.get('WOOCOMMERCE_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('WOOCOMMERCE_CONSUMER_SECRET');

    if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
      throw new Error('WooCommerce credentials not configured');
    }

    // Fetch all active WBTY products
    const { data: products, error: fetchError } = await supabase
      .from('wbty_products')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch WBTY products: ${fetchError.message}`);
    }

    console.log(`Found ${products?.length || 0} WBTY products to sync`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      details: [] as any[],
    };

    // Group products by category
    const productsByCategory = products?.reduce((acc, product) => {
      const category = product.category || 'Uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(product);
      return acc;
    }, {} as Record<string, WBTYProduct[]>) || {};

    // Process each category
    for (const [category, categoryProducts] of Object.entries(productsByCategory)) {
      const wooProductId = CATEGORY_TO_PRODUCT_ID[category];
      
      if (!wooProductId) {
        console.log(`Skipping category "${category}" - no WooCommerce product ID mapped`);
        results.skipped += (categoryProducts as WBTYProduct[]).length;
        continue;
      }

      console.log(`Processing category "${category}" -> WooCommerce Product ID ${wooProductId}`);

      // Upload each swatch image to WooCommerce
      for (const product of (categoryProducts as WBTYProduct[])) {
        try {
          console.log(`Processing: ${product.name} (${category})`);

          // Download swatch image from Supabase Storage
          const imageResponse = await fetch(product.media_url);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download image: ${imageResponse.statusText}`);
          }

          const imageBlob = await imageResponse.blob();
          const imageBuffer = await imageBlob.arrayBuffer();

          // Upload to WooCommerce Media Library
          const filename = `wbty-${category.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${product.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.jpg`;
          
          const uploadResponse = await fetch(`${wooCommerceUrl}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${consumerKey}:${consumerSecret}`),
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Content-Type': 'image/jpeg',
            },
            body: imageBuffer,
          });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Failed to upload to WooCommerce: ${uploadResponse.statusText} - ${errorText}`);
          }

          const mediaData = await uploadResponse.json();
          console.log(`✓ Uploaded media ID: ${mediaData.id} for ${product.name}`);

          // Add image to product gallery
          const productResponse = await fetch(`${wooCommerceUrl}/wp-json/wc/v3/products/${wooProductId}`, {
            method: 'GET',
            headers: {
              'Authorization': 'Basic ' + btoa(`${consumerKey}:${consumerSecret}`),
            },
          });

          if (!productResponse.ok) {
            throw new Error(`Failed to fetch WooCommerce product: ${productResponse.statusText}`);
          }

          const productData = await productResponse.json();
          const existingGallery = productData.images || [];
          
          // Check if image already exists in gallery
          const imageExists = existingGallery.some((img: any) => img.id === mediaData.id);
          
          if (!imageExists) {
            const updatedGallery = [...existingGallery, { id: mediaData.id }];

            const updateResponse = await fetch(`${wooCommerceUrl}/wp-json/wc/v3/products/${wooProductId}`, {
              method: 'PUT',
              headers: {
                'Authorization': 'Basic ' + btoa(`${consumerKey}:${consumerSecret}`),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                images: updatedGallery,
              }),
            });

            if (!updateResponse.ok) {
              throw new Error(`Failed to update product gallery: ${updateResponse.statusText}`);
            }

            console.log(`✓ Added to gallery for product ${wooProductId}`);
          } else {
            console.log(`- Image already in gallery for product ${wooProductId}`);
          }

          results.success++;
          results.details.push({
            product: product.name,
            category,
            wooProductId,
            mediaId: mediaData.id,
            status: 'success',
          });

        } catch (error) {
          console.error(`✗ Failed to process ${product.name}:`, error);
          results.failed++;
          results.details.push({
            product: product.name,
            category,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    console.log('Sync complete:', results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      success: 0,
      failed: 0,
      skipped: 0,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
