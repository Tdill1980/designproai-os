import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Avery SW900 registry data
const averyColors = [
  { product_code: "SW900-190-O", official_name: "Black", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-832-O", official_name: "Grey", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-180-O", official_name: "White", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-416-O", official_name: "Blaze Orange", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-371-O", official_name: "Red", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-474-O", official_name: "Cherry Red", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-436-O", official_name: "Soft Pink", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-587-O", official_name: "Powder Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-672-O", official_name: "Smoky Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-681-O", official_name: "Dark Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-612-O", official_name: "Bright Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-734-O", official_name: "Moss Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-792-O", official_name: "Khaki Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-726-O", official_name: "Lime Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-757-O", official_name: "Emerald Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-216-O", official_name: "Yellow", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-917-O", official_name: "Sand", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-960-O", official_name: "Bronze", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-978-O", official_name: "Cacao Brown", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-507-O", official_name: "Passion Purple", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  // Gloss Metallic
  { product_code: "SW900-193-M", official_name: "Gloss Metallic Black", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-834-M", official_name: "Gloss Metallic Grey", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-835-M", official_name: "Gloss Metallic Silver", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-336-M", official_name: "Gloss Metallic Fun Purple", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-321-M", official_name: "Gloss Metallic Spark", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-618-M", official_name: "Gloss Metallic Bright Blue", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-637-M", official_name: "Gloss Metallic Passion Blue", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-653-M", official_name: "Gloss Metallic Night Blue", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-717-M", official_name: "Gloss Metallic Hope Green", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-768-M", official_name: "Gloss Metallic Dark Green", category: "Gloss Metallic", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  // Matte
  { product_code: "SW900-180-M", official_name: "Matte White", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-190-M", official_name: "Matte Black", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-840-M", official_name: "Matte Grey", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-850-M", official_name: "Matte Charcoal", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-646-M", official_name: "Matte Blue", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-758-M", official_name: "Matte Green", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-372-M", official_name: "Matte Red", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-428-M", official_name: "Matte Orange", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  // Matte Metallic
  { product_code: "SW900-193-X", official_name: "Matte Metallic Black", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-805-X", official_name: "Matte Metallic Grey", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-802-X", official_name: "Matte Metallic Silver", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-618-X", official_name: "Matte Metallic Blue", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-717-X", official_name: "Matte Metallic Green", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "SW900-321-X", official_name: "Matte Metallic Red", category: "Matte Metallic", finish: "Matte", metallic: true, pearl: false, chrome: false },
  // Satin
  { product_code: "SW900-180-S", official_name: "Satin White", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-190-S", official_name: "Satin Black", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-840-S", official_name: "Satin Grey", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-646-S", official_name: "Satin Blue", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-372-S", official_name: "Satin Red", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "SW900-758-S", official_name: "Satin Green", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  // ColorFlow
  { product_code: "SW900-552-S", official_name: "ColorFlow Gloss Roaring Thunder", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "SW900-553-S", official_name: "ColorFlow Gloss Rising Sun", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "SW900-554-S", official_name: "ColorFlow Gloss Urban Jungle", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "SW900-555-S", official_name: "ColorFlow Gloss Lightning Ridge", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "SW900-556-S", official_name: "ColorFlow Gloss Fresh Spring", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "SW900-557-S", official_name: "ColorFlow Gloss Rushing Riptide", category: "ColorFlow", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  // Diamond
  { product_code: "SW900-801-D", official_name: "Diamond Black", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#0A0A0F" },
  { product_code: "SW900-201-D", official_name: "Diamond White", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#F0EDE8" },
  { product_code: "SW900-404-D", official_name: "Diamond Red", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#9B1B30" },
  { product_code: "SW900-604-D", official_name: "Diamond Blue", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#1B3A6B" },
  { product_code: "SW900-504-D", official_name: "Diamond Purple", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#3B1861" },
  { product_code: "SW900-301-D", official_name: "Diamond Green", category: "Diamond", finish: "Gloss", metallic: true, pearl: true, chrome: false, hex: "#1A5B3A" },
  // Conform Chrome
  { product_code: "SF100-10-S", official_name: "Conform Chrome Silver", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
  { product_code: "SF100-12-S", official_name: "Conform Chrome Gold", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
  { product_code: "SF100-15-S", official_name: "Conform Chrome Black", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
  { product_code: "SF100-21-S", official_name: "Conform Chrome Blue", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
  { product_code: "SF100-23-S", official_name: "Conform Chrome Red", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
  { product_code: "SF100-256-S", official_name: "Conform Chrome Rose Gold", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
];

// 3M 2080 registry data
const threeMColors = [
  // Gloss
  { product_code: "G12", official_name: "Black", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G10", official_name: "White", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G120", official_name: "White Aluminum", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G211", official_name: "Gloss Charcoal Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G212", official_name: "Black Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G251", official_name: "Sterling Silver Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G241", official_name: "Gold Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G13", official_name: "Hot Rod Red", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G53", official_name: "Flame Red", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G83", official_name: "Dark Red", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G363", official_name: "Dragon Fire Red", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G14", official_name: "Burnt Orange", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G54", official_name: "Bright Orange", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G24", official_name: "Deep Orange", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G15", official_name: "Bright Yellow", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G25", official_name: "Sunflower Yellow", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G335", official_name: "Lemon Sting", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G16", official_name: "Light Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G336", official_name: "Apple Green", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G46", official_name: "Kelly Green", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G226", official_name: "Green Envy", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G17", official_name: "Sky Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G47", official_name: "Intense Blue", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G227", official_name: "Blue Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G217", official_name: "Steel Blue Metallic", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G317", official_name: "Cosmic Blue", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G377", official_name: "Atlantis Blue", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G18", official_name: "Plum Explosion", category: "Gloss", finish: "Gloss", metallic: false, pearl: false, chrome: false },
  { product_code: "G348", official_name: "Fierce Fuchsia", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  { product_code: "G378", official_name: "Gloss Raspberry Fizz", category: "Gloss", finish: "Gloss", metallic: true, pearl: false, chrome: false },
  // Gloss Flip
  { product_code: "GP281", official_name: "Gloss Flip Ghost Pearl", category: "Gloss Flip", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "GP278", official_name: "Gloss Flip Psychedelic", category: "Gloss Flip", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "GP272", official_name: "Gloss Flip Electric Wave", category: "Gloss Flip", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "GP287", official_name: "Gloss Flip Deep Space", category: "Gloss Flip", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  { product_code: "GP295", official_name: "Gloss Flip Glacial Frost", category: "Gloss Flip", finish: "Gloss", metallic: false, pearl: true, chrome: false },
  // Satin
  { product_code: "S12", official_name: "Satin Black", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "S10", official_name: "Satin White", category: "Satin", finish: "Satin", metallic: false, pearl: false, chrome: false },
  { product_code: "S120", official_name: "Satin White Aluminum", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "S211", official_name: "Satin Charcoal Metallic", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "S251", official_name: "Satin Sterling Silver", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "S344", official_name: "Satin Canyon Copper", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "S347", official_name: "Satin Frozen Vanilla", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "S351", official_name: "Satin Thundercloud", category: "Satin", finish: "Satin", metallic: true, pearl: false, chrome: false },
  { product_code: "SP236", official_name: "Satin Flip Volcanic Flare", category: "Satin Flip", finish: "Satin", metallic: false, pearl: true, chrome: false },
  { product_code: "SP277", official_name: "Satin Flip Caribbean Shimmer", category: "Satin Flip", finish: "Satin", metallic: false, pearl: true, chrome: false },
  { product_code: "SP276", official_name: "Satin Flip Ghost Pearl", category: "Satin Flip", finish: "Satin", metallic: false, pearl: true, chrome: false },
  // Matte
  { product_code: "M12", official_name: "Matte Black", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "M10", official_name: "Matte White", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "M21", official_name: "Matte Silver", category: "Matte", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "M22", official_name: "Matte Dark Gray", category: "Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  { product_code: "M203", official_name: "Matte Red Metallic", category: "Matte", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "M206", official_name: "Matte Pine Green Metallic", category: "Matte", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "M227", official_name: "Matte Blue Metallic", category: "Matte", finish: "Matte", metallic: true, pearl: false, chrome: false },
  { product_code: "M211", official_name: "Matte Charcoal Metallic", category: "Matte", finish: "Matte", metallic: true, pearl: false, chrome: false },
  // Dead Matte
  { product_code: "DM12", official_name: "Dead Matte Black", category: "Dead Matte", finish: "Matte", metallic: false, pearl: false, chrome: false },
  // Chrome
  { product_code: "GC451", official_name: "Gloss Silver Chrome", category: "Chrome", finish: "Gloss", metallic: false, pearl: false, chrome: true },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    const { manufacturer } = await req.json().catch(() => ({ manufacturer: 'all' }));

    let colorsToImport: Array<{
      manufacturer: string;
      series: string;
      product_code: string;
      official_name: string;
      finish: string;
      category: string;
      is_verified: boolean;
      hex_source: string;
      hex_confidence: number;
      registry_version: string;
      source_file: string;
    }> = [];

    // Process Avery colors
    if (manufacturer === 'all' || manufacturer === 'avery') {
      const averyData = averyColors.map(c => ({
        manufacturer: 'Avery Dennison',
        series: 'SW900',
        product_code: c.product_code,
        official_name: c.official_name,
        finish: c.finish,
        category: c.category,
        is_verified: false,
        hex_source: 'registry_imported',
        hex_confidence: 0,
        registry_version: '2025-11',
        source_file: 'supreme-wrapping-film-color-swatch.pdf'
      }));
      colorsToImport = [...colorsToImport, ...averyData];
    }

    // Process 3M colors
    if (manufacturer === 'all' || manufacturer === '3m') {
      const threeMData = threeMColors.map(c => ({
        manufacturer: '3M',
        series: '2080',
        product_code: c.product_code,
        official_name: c.official_name,
        finish: c.finish,
        category: c.category,
        is_verified: false,
        hex_source: 'registry_imported',
        hex_confidence: 0,
        registry_version: '2018-10',
        source_file: '3MVinylFilmColorsPoster.pdf'
      }));
      colorsToImport = [...colorsToImport, ...threeMData];
    }

    let inserted = 0;
    let updated = 0;
    let errors: string[] = [];

    for (const color of colorsToImport) {
      // Check if exists
      const { data: existing } = await supabase
        .from('manufacturer_colors')
        .select('id')
        .eq('manufacturer', color.manufacturer)
        .eq('product_code', color.product_code)
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('manufacturer_colors')
          .update({
            official_name: color.official_name,
            finish: color.finish,
            hex_source: color.hex_source,
            registry_version: color.registry_version,
            source_file: color.source_file
          })
          .eq('id', existing.id);

        if (error) {
          errors.push(`Update ${color.product_code}: ${error.message}`);
        } else {
          updated++;
        }
      } else {
        // Insert new - use provided hex or placeholder
        const { error } = await supabase
          .from('manufacturer_colors')
          .insert({
            manufacturer: color.manufacturer,
            series: color.series,
            product_code: color.product_code,
            official_name: color.official_name,
            official_hex: (color as any).hex || '#808080',
            finish: color.finish,
            is_verified: false,
            hex_source: (color as any).hex ? 'registry_imported' : 'placeholder',
            hex_confidence: (color as any).hex ? 60 : 0,
            registry_version: color.registry_version,
            source_file: color.source_file
          });

        if (error) {
          errors.push(`Insert ${color.product_code}: ${error.message}`);
        } else {
          inserted++;
        }
      }
    }

    console.log(`Import complete: ${inserted} inserted, ${updated} updated, ${errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      inserted,
      updated,
      total: colorsToImport.length,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
