import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Complete 3M 2080 Series color mapping (111 colors)
const threeM2080Colors = [
  // === HIGH GLOSS (20 colors) ===
  { code: "2080-HG10", name: "White", finish: "High Gloss" },
  { code: "2080-HG12", name: "Black", finish: "High Gloss" },
  { code: "2080-HG13", name: "Hot Rod Red", finish: "High Gloss" },
  { code: "2080-HG14", name: "Burnt Orange", finish: "High Gloss" },
  { code: "2080-HG15", name: "Bright Yellow", finish: "High Gloss" },
  { code: "2080-HG26", name: "Military Green", finish: "High Gloss" },
  { code: "2080-HG31", name: "Storm Gray", finish: "High Gloss" },
  { code: "2080-HG36", name: "Mantis Green", finish: "High Gloss" },
  { code: "2080-HG61", name: "Nardo Gray", finish: "High Gloss" },
  { code: "2080-HG65", name: "Citric Acid", finish: "High Gloss" },
  { code: "2080-HG73", name: "Ruby Rosso", finish: "High Gloss" },
  { code: "2080-HG77", name: "Sky Blue", finish: "High Gloss" },
  { code: "2080-HG81", name: "Meteor Gray", finish: "High Gloss" },
  { code: "2080-HG120", name: "White Aluminum", finish: "High Gloss" },
  { code: "2080-HG212", name: "Black Metallic", finish: "High Gloss" },
  { code: "2080-HG336", name: "Green Envy", finish: "High Gloss" },
  { code: "2080-HG378", name: "Blue Raspberry", finish: "High Gloss" },
  { code: "2080-HGP221", name: "Flip Black Psychedelic", finish: "High Gloss" },
  { code: "2080-HGP258", name: "Plum Explosion 2.0", finish: "High Gloss" },
  { code: "2080-HGP278", name: "Flip Deep Space", finish: "High Gloss" },

  // === GLOSS (39 colors) ===
  { code: "2080-G10", name: "Gloss White", finish: "Gloss" },
  { code: "2080-G12", name: "Gloss Black", finish: "Gloss" },
  { code: "2080-G13", name: "Hot Rod Red", finish: "Gloss" },
  { code: "2080-G14", name: "Burnt Orange", finish: "Gloss" },
  { code: "2080-G15", name: "Bright Yellow", finish: "Gloss" },
  { code: "2080-G16", name: "Light Green", finish: "Gloss" },
  { code: "2080-G24", name: "Deep Orange", finish: "Gloss" },
  { code: "2080-G25", name: "Sunflower", finish: "Gloss" },
  { code: "2080-G31", name: "Storm Gray", finish: "Gloss" },
  { code: "2080-G46", name: "Kelly Green", finish: "Gloss" },
  { code: "2080-G47", name: "Intense Blue", finish: "Gloss" },
  { code: "2080-G53", name: "Flame Red", finish: "Gloss" },
  { code: "2080-G54", name: "Bright Orange", finish: "Gloss" },
  { code: "2080-G55", name: "Lucid Yellow", finish: "Gloss" },
  { code: "2080-G77", name: "Sky Blue", finish: "Gloss" },
  { code: "2080-G79", name: "Light Ivory", finish: "Gloss" },
  { code: "2080-G120", name: "White Aluminum", finish: "Gloss" },
  { code: "2080-G127", name: "Boat Blue", finish: "Gloss" },
  { code: "2080-G201", name: "Anthracite", finish: "Gloss" },
  { code: "2080-G203", name: "Red Metallic", finish: "Gloss" },
  { code: "2080-G211", name: "Charcoal Metallic", finish: "Gloss" },
  { code: "2080-G212", name: "Black Metallic", finish: "Gloss" },
  { code: "2080-G217", name: "Deep Blue Metallic", finish: "Gloss" },
  { code: "2080-G227", name: "Blue Metallic", finish: "Gloss" },
  { code: "2080-G336", name: "Green Envy", finish: "Gloss" },
  { code: "2080-G337", name: "Blue Fire", finish: "Gloss" },
  { code: "2080-G344", name: "Liquid Copper", finish: "Gloss" },
  { code: "2080-G348", name: "Fierce Fuchsia", finish: "Gloss" },
  { code: "2080-G356", name: "Atomic Teal", finish: "Gloss" },
  { code: "2080-G363", name: "Dragon Fire Red", finish: "Gloss" },
  { code: "2080-G364", name: "Fiery Orange", finish: "Gloss" },
  { code: "2080-G377", name: "Cosmic Blue", finish: "Gloss" },
  { code: "2080-G378", name: "Blue Raspberry", finish: "Gloss" },
  { code: "2080-GP240", name: "White Gold Sparkle", finish: "Gloss" },
  { code: "2080-GP251", name: "Sterling Silver", finish: "Gloss" },
  { code: "2080-GP272", name: "Midnight Blue", finish: "Gloss" },
  { code: "2080-GP278", name: "Flip Deep Space", finish: "Gloss" },
  { code: "2080-GP281", name: "Flip Psychedelic", finish: "Gloss" },
  { code: "2080-GP282", name: "Ember Black", finish: "Gloss" },

  // === SATIN (26 colors) ===
  { code: "2080-S10", name: "Satin White", finish: "Satin" },
  { code: "2080-S12", name: "Satin Black", finish: "Satin" },
  { code: "2080-S23", name: "Velvet Rose", finish: "Satin" },
  { code: "2080-S51", name: "Battleship Gray", finish: "Satin" },
  { code: "2080-S56", name: "Komodo Green", finish: "Satin" },
  { code: "2080-S57", name: "Key West", finish: "Satin" },
  { code: "2080-S120", name: "White Aluminum", finish: "Satin" },
  { code: "2080-S196", name: "Apple Green", finish: "Satin" },
  { code: "2080-S261", name: "Dark Gray", finish: "Satin" },
  { code: "2080-S271", name: "Thundercloud", finish: "Satin" },
  { code: "2080-S327", name: "Ocean Shimmer", finish: "Satin" },
  { code: "2080-S335", name: "Bitter Yellow", finish: "Satin" },
  { code: "2080-S347", name: "Perfect Blue", finish: "Satin" },
  { code: "2080-S363", name: "Smoldering Red", finish: "Satin" },
  { code: "2080-SB12", name: "Shadow Black", finish: "Satin" },
  { code: "2080-SB26", name: "Shadow Military Green", finish: "Satin" },
  { code: "2080-SP10", name: "Pearl White", finish: "Satin" },
  { code: "2080-SP211", name: "Flip Electric Coral", finish: "Satin" },
  { code: "2080-SP236", name: "Flip Volcanic Flare", finish: "Satin" },
  { code: "2080-SP238", name: "Frozen Berry Metallic", finish: "Satin" },
  { code: "2080-SP240", name: "Frozen Vanilla", finish: "Satin" },
  { code: "2080-SP242", name: "Gold Dust Black", finish: "Satin" },
  { code: "2080-SP273", name: "Vampire Red", finish: "Satin" },
  { code: "2080-SP277", name: "Flip Glacial Frost", finish: "Satin" },
  { code: "2080-SP280", name: "Satin Flip Ghost Pearl", finish: "Satin" },
  { code: "2080-SP281", name: "Flip Psychedelic", finish: "Satin" },

  // === MATTE (18 colors) ===
  { code: "2080-M10", name: "Matte White", finish: "Matte" },
  { code: "2080-M12", name: "Matte Black", finish: "Matte" },
  { code: "2080-M13", name: "Matte Red", finish: "Matte" },
  { code: "2080-M21", name: "Silver", finish: "Matte" },
  { code: "2080-M22", name: "Deep Black", finish: "Matte" },
  { code: "2080-M26", name: "Military Green", finish: "Matte" },
  { code: "2080-M27", name: "Indigo", finish: "Matte" },
  { code: "2080-M33", name: "Strawberry Red", finish: "Matte" },
  { code: "2080-M203", name: "Red Metallic", finish: "Matte" },
  { code: "2080-M206", name: "Pine Green Metallic", finish: "Matte" },
  { code: "2080-M209", name: "Brown Metallic", finish: "Matte" },
  { code: "2080-M211", name: "Charcoal Metallic", finish: "Matte" },
  { code: "2080-M212", name: "Black Metallic", finish: "Matte" },
  { code: "2080-M217", name: "Slate Blue Metallic", finish: "Matte" },
  { code: "2080-M227", name: "Blue Metallic", finish: "Matte" },
  { code: "2080-M230", name: "Gray Aluminum", finish: "Matte" },
  { code: "2080-M261", name: "Dark Gray", finish: "Matte" },
  { code: "2080-DM12", name: "Dead Matte Black", finish: "Matte" },

  // === TEXTURES (8 colors) ===
  { code: "2080-BR120", name: "Brushed Aluminum", finish: "Brushed" },
  { code: "2080-BR201", name: "Brushed Steel", finish: "Brushed" },
  { code: "2080-BR212", name: "Brushed Black Metallic", finish: "Brushed" },
  { code: "2080-BR230", name: "Brushed Titanium", finish: "Brushed" },
  { code: "2080-CFS12", name: "Carbon Fiber Black", finish: "Carbon Fiber" },
  { code: "2080-CFS201", name: "Carbon Fiber Anthracite", finish: "Carbon Fiber" },
  { code: "2080-MX12", name: "Matrix Black", finish: "Matrix" },
  { code: "2080-GC451", name: "Gloss Silver Chrome", finish: "Chrome" },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dryRun = false } = await req.json().catch(() => ({}));

    console.log(`[upsert-3m-colors] Starting upsert of ${threeM2080Colors.length} 3M colors (dryRun: ${dryRun})`);

    // Build upsert records
    const records = threeM2080Colors.map(color => ({
      manufacturer: '3M',
      series: '2080',
      product_code: color.code,
      official_name: color.name,
      official_hex: '#PENDING', // Placeholder - to be extracted from swatches
      official_swatch_url: `https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/swatches/official/3m/${color.code}.png`,
      finish: color.finish,
      is_ppf: false,
      is_verified: true,
    }));

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          totalColors: records.length,
          preview: records.slice(0, 10),
          message: "Dry run - no database writes performed"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createExternalClient();

    // First, delete all existing 3M records
    console.log('[upsert-3m-colors] Deleting existing 3M records...');
    const { error: deleteError, count: deleteCount } = await supabase
      .from('manufacturer_colors')
      .delete()
      .eq('manufacturer', '3M')
      .select('*', { count: 'exact', head: true });

    if (deleteError) {
      console.error('[upsert-3m-colors] Delete error:', deleteError);
      throw new Error(`Failed to delete existing 3M records: ${deleteError.message}`);
    }

    console.log(`[upsert-3m-colors] Deleted ${deleteCount || 0} existing 3M records`);

    // Insert all new records
    console.log('[upsert-3m-colors] Inserting new 3M records...');
    const { data: insertedData, error: insertError } = await supabase
      .from('manufacturer_colors')
      .insert(records)
      .select('id, product_code, official_name');

    if (insertError) {
      console.error('[upsert-3m-colors] Insert error:', insertError);
      throw new Error(`Failed to insert 3M records: ${insertError.message}`);
    }

    const insertedCount = insertedData?.length || 0;
    console.log(`[upsert-3m-colors] Successfully inserted ${insertedCount} 3M records`);

    return new Response(
      JSON.stringify({
        success: true,
        deleted: deleteCount || 0,
        inserted: insertedCount,
        totalColors: threeM2080Colors.length,
        message: `Successfully upserted ${insertedCount} 3M colors`,
        sample: insertedData?.slice(0, 5)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[upsert-3m-colors] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
