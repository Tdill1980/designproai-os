import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Official 3M 2080 colors extracted from poster
const OFFICIAL_3M_COLORS = [
  // GLOSS
  { code: "2080-G253", name: "Cinder Spark Red", finish: "Gloss", hex: "#8B1E3F" },
  { code: "2080-G203", name: "Red Metallic", finish: "Gloss", hex: "#A52A2A" },
  { code: "2080-G363", name: "Dragon Fire Red", finish: "Gloss", hex: "#C41E3A" },
  { code: "2080-G83", name: "Dark Red", finish: "Gloss", hex: "#8B0000" },
  { code: "2080-G53", name: "Flame Red", finish: "Gloss", hex: "#E25822" },
  { code: "2080-G13", name: "Hot Rod Red", finish: "Gloss", hex: "#D2042D" },
  { code: "2080-G364", name: "Fiery Orange", finish: "Gloss", hex: "#FF4500" },
  { code: "2080-G344", name: "Liquid Copper", finish: "Gloss", hex: "#B87333" },
  { code: "2080-G84", name: "Burnt Orange", finish: "Gloss", hex: "#CC5500" },
  { code: "2080-G54", name: "Deep Orange", finish: "Gloss", hex: "#FF8C00" },
  { code: "2080-G14", name: "Bright Orange", finish: "Gloss", hex: "#FF6600" },
  { code: "2080-G25", name: "Sunflower", finish: "Gloss", hex: "#FFDA03" },
  { code: "2080-G235", name: "Lemon Sting", finish: "Gloss", hex: "#FFF44F" },
  { code: "2080-G15", name: "Bright Yellow", finish: "Gloss", hex: "#FFFF00" },
  { code: "2080-G55", name: "Lucid Yellow", finish: "Gloss", hex: "#FFD700" },
  { code: "2080-G336", name: "Green Envy", finish: "Gloss", hex: "#009B76" },
  { code: "2080-G46", name: "Kelly Green", finish: "Gloss", hex: "#4CBB17" },
  { code: "2080-G58", name: "Light Green", finish: "Gloss", hex: "#90EE90" },
  { code: "2080-G356", name: "Atomic Teal", finish: "Gloss", hex: "#008B8B" },
  { code: "2080-GP272", name: "Midnight Blue", finish: "Gloss", hex: "#191970" },
  { code: "2080-G127", name: "Boat Blue", finish: "Gloss", hex: "#1E90FF" },
  { code: "2080-G217", name: "Deep Blue Metallic", finish: "Gloss", hex: "#00008B" },
  { code: "2080-G227", name: "Blue Metallic", finish: "Gloss", hex: "#4169E1" },
  { code: "2080-G378", name: "Blue Raspberry", finish: "Gloss", hex: "#0CBFE9" },
  { code: "2080-G377", name: "Cosmic Blue", finish: "Gloss", hex: "#2E2D88" },
  { code: "2080-G47", name: "Intense Blue", finish: "Gloss", hex: "#0000CD" },
  { code: "2080-G337", name: "Blue Fire", finish: "Gloss", hex: "#1F75FE" },
  { code: "2080-G247", name: "Ice Blue", finish: "Gloss", hex: "#99FFFF" },
  { code: "2080-G77", name: "Sky Blue", finish: "Gloss", hex: "#87CEEB" },
  { code: "2080-G348", name: "Fierce Fuchsia", finish: "Gloss", hex: "#FF00FF" },
  { code: "2080-G103", name: "Hot Pink", finish: "Gloss", hex: "#FF69B4" },
  { code: "2080-GP99", name: "Black Rose", finish: "Gloss", hex: "#67032D" },
  { code: "2080-GP258", name: "Plum Explosion", finish: "Gloss", hex: "#8E4585" },
  { code: "2080-GP296", name: "Wicked", finish: "Gloss", hex: "#4B0082" },
  { code: "2080-GP282", name: "Ember Black", finish: "Gloss", hex: "#1C1C1C" },
  { code: "2080-GP292", name: "Galaxy Black", finish: "Gloss", hex: "#0D0D0D" },
  { code: "2080-G212", name: "Black Metallic", finish: "Gloss", hex: "#1C1C1C" },
  { code: "2080-G12", name: "Black", finish: "Gloss", hex: "#000000" },
  { code: "2080-G201", name: "Anthracite", finish: "Gloss", hex: "#383838" },
  { code: "2080-G211", name: "Charcoal Metallic", finish: "Gloss", hex: "#36454F" },
  { code: "2080-GP291", name: "Glacier Gray", finish: "Gloss", hex: "#9E9E9E" },
  { code: "2080-G120", name: "White Aluminum", finish: "Gloss", hex: "#D3D3D3" },
  { code: "2080-G231", name: "Sterling Silver", finish: "Gloss", hex: "#C0C0C0" },
  { code: "2080-G31", name: "Storm Gray", finish: "Gloss", hex: "#708090" },
  { code: "2080-GP240", name: "White Gold Sparkle", finish: "Gloss", hex: "#F5F5DC" },
  { code: "2080-G10", name: "White", finish: "Gloss", hex: "#FFFFFF" },
  { code: "2080-G79", name: "Light Ivory", finish: "Gloss", hex: "#FFFFF0" },
  { code: "2080-G241", name: "Gold Metallic", finish: "Gloss", hex: "#FFD700" },
  
  // SATIN
  { code: "2080-SP273", name: "Vampire Red", finish: "Satin", hex: "#660000" },
  { code: "2080-S363", name: "Smoldering Red", finish: "Satin", hex: "#9B111E" },
  { code: "2080-S344", name: "Canyon Copper", finish: "Satin", hex: "#B87333" },
  { code: "2080-S335", name: "Bitter Yellow", finish: "Satin", hex: "#E1AD01" },
  { code: "2080-S196", name: "Apple Green", finish: "Satin", hex: "#8DB600" },
  { code: "2080-S57", name: "Key West", finish: "Satin", hex: "#40E0D0" },
  { code: "2080-SP277", name: "Ocean Shimmer", finish: "Satin", hex: "#006994" },
  { code: "2080-S347", name: "Perfect Blue", finish: "Satin", hex: "#0066CC" },
  { code: "2080-SP271", name: "Thundercloud", finish: "Satin", hex: "#505050" },
  { code: "2080-S261", name: "Dark Gray", finish: "Satin", hex: "#4A4A4A" },
  { code: "2080-S12", name: "Black", finish: "Satin", hex: "#0A0A0A" },
  { code: "2080-SP242", name: "Gold Dust Black", finish: "Satin", hex: "#1A1A1A" },
  { code: "2080-S81", name: "Battleship Gray", finish: "Satin", hex: "#848482" },
  { code: "2080-S120", name: "White Aluminum", finish: "Satin", hex: "#E8E8E8" },
  { code: "2080-SP240", name: "Frozen Vanilla", finish: "Satin", hex: "#F3E5AB" },
  { code: "2080-S10", name: "White", finish: "Satin", hex: "#FAFAFA" },
  { code: "2080-SP10", name: "Pearl White", finish: "Satin", hex: "#F0EAD6" },
  { code: "2080-SP59", name: "Caramel Luster", finish: "Satin", hex: "#8B4513" },
  
  // MATTE
  { code: "2080-M203", name: "Red Metallic", finish: "Matte", hex: "#A52A2A" },
  { code: "2080-M13", name: "Red", finish: "Matte", hex: "#CC0000" },
  { code: "2080-M54", name: "Orange", finish: "Matte", hex: "#FF6600" },
  { code: "2080-M206", name: "Pine Green Metallic", finish: "Matte", hex: "#01796F" },
  { code: "2080-M26", name: "Military Green", finish: "Matte", hex: "#4B5320" },
  { code: "2080-M27", name: "Indigo", finish: "Matte", hex: "#4B0082" },
  { code: "2080-M217", name: "Slate Blue Metallic", finish: "Matte", hex: "#6A5ACD" },
  { code: "2080-M227", name: "Blue Metallic", finish: "Matte", hex: "#0000CD" },
  { code: "2080-M67", name: "Riviera Blue", finish: "Matte", hex: "#007FFF" },
  { code: "2080-M12", name: "Black", finish: "Matte", hex: "#0D0D0D" },
  { code: "2080-M211", name: "Black Metallic", finish: "Matte", hex: "#1C1C1C" },
  { code: "2080-M22", name: "Deep Black", finish: "Matte", hex: "#050505" },
  { code: "2080-DM10", name: "Dead Matte Black", finish: "Matte", hex: "#000000" },
  { code: "2080-M261", name: "Dark Gray", finish: "Matte", hex: "#4A4A4A" },
  { code: "2080-M230", name: "Gray Aluminum", finish: "Matte", hex: "#9E9E9E" },
  { code: "2080-M120", name: "Silver", finish: "Matte", hex: "#C0C0C0" },
  { code: "2080-M10", name: "White", finish: "Matte", hex: "#FFFFFF" },
  { code: "2080-M211", name: "Charcoal Metallic", finish: "Matte", hex: "#36454F" },
  { code: "2080-M209", name: "Brown Metallic", finish: "Matte", hex: "#8B4513" },
  { code: "2080-M229", name: "Copper Metallic", finish: "Matte", hex: "#B87333" },
  
  // TEXTURES
  { code: "2080-SB26", name: "Shadow Military Green", finish: "Brushed", hex: "#4B5320" },
  { code: "2080-SB12", name: "Shadow Black", finish: "Brushed", hex: "#1A1A1A" },
  { code: "2080-BR212", name: "Brushed Black Metallic", finish: "Brushed", hex: "#2C2C2C" },
  { code: "2080-MX12", name: "Matrix Black", finish: "Carbon Fiber", hex: "#1C1C1C" },
  { code: "2080-CFS12", name: "Carbon Fiber Black", finish: "Carbon Fiber", hex: "#1A1A1A" },
  { code: "2080-BR201", name: "Brushed Steel", finish: "Brushed", hex: "#808080" },
  { code: "2080-BR230", name: "Brushed Titanium", finish: "Brushed", hex: "#878787" },
  { code: "2080-BR120", name: "Brushed Aluminum", finish: "Brushed", hex: "#D3D3D3" },
  { code: "2080-CF201", name: "Carbon Fiber Anthracite", finish: "Carbon Fiber", hex: "#383838" },
  { code: "2080-CFS10", name: "Carbon Fiber White", finish: "Carbon Fiber", hex: "#E8E8E8" },
  
  // COLOR FLIPS
  { code: "2080-SP236", name: "Volcanic Flare", finish: "Color Flip", hex: "#FF4500" },
  { code: "2080-GP281", name: "Psychedelic", finish: "Color Flip", hex: "#9400D3" },
  { code: "2080-SP278", name: "Deep Space", finish: "Color Flip", hex: "#191970" },
  { code: "2080-GP287", name: "Electric Wave", finish: "Color Flip", hex: "#00CED1" },
  { code: "2080-SP277", name: "Glacial Frost", finish: "Color Flip", hex: "#E0FFFF" },
  { code: "2080-SP276", name: "Caribbean Shimmer", finish: "Color Flip", hex: "#00CED1" },
  { code: "2080-GP280", name: "Ghost Pearl", finish: "Color Flip", hex: "#F5F5F5" },
  { code: "2080-SP280", name: "Ghost Pearl", finish: "Color Flip", hex: "#F8F8F8" },
  
  // CHROME
  { code: "2080-GC451", name: "Gloss Silver Chrome", finish: "Chrome", hex: "#C0C0C0" },
];

// Official Avery SW900 colors extracted from PDF
const OFFICIAL_AVERY_COLORS = [
  // GLOSS
  { code: "SW900-190-O", name: "Black", finish: "Gloss", hex: "#000000" },
  { code: "SW900-832-O", name: "Grey", finish: "Gloss", hex: "#808080" },
  { code: "SW900-433-O", name: "Cardinal Red", finish: "Gloss", hex: "#C41E3A" },
  { code: "SW900-681-O", name: "Dark Blue", finish: "Gloss", hex: "#00008B" },
  { code: "SW900-6329-O", name: "Turquoise Ocean", finish: "Gloss", hex: "#40E0D0" },
  { code: "SW900-703-O", name: "Park Avenue Blue", finish: "Gloss", hex: "#1E3A5F" },
  { code: "SW900-729-O", name: "Smooth Sage", finish: "Gloss", hex: "#9DC183" },
  { code: "SW900-235-O", name: "Yellow", finish: "Gloss", hex: "#FFFF00" },
  { code: "SW900-191-O", name: "Obsidian Black", finish: "Gloss", hex: "#0B1304" },
  { code: "SW900-8221-O", name: "Misty Grey", finish: "Gloss", hex: "#B4B4B4" },
  { code: "SW900-436-O", name: "Carmine Red", finish: "Gloss", hex: "#960018" },
  { code: "SW900-677-O", name: "Blue", finish: "Gloss", hex: "#0000FF" },
  { code: "SW900-636-O", name: "Aqua Blue", finish: "Gloss", hex: "#00FFFF" },
  { code: "SW900-728-O", name: "Light Pistachio", finish: "Gloss", hex: "#93C572" },
  { code: "SW900-701-O", name: "Tropical", finish: "Gloss", hex: "#00FF7F" },
  { code: "SW900-236-O", name: "Ambulance Yellow", finish: "Gloss", hex: "#FFBF00" },
  { code: "SW900-865-O", name: "Dark Grey", finish: "Gloss", hex: "#4A4A4A" },
  { code: "SW900-415-O", name: "Red", finish: "Gloss", hex: "#FF0000" },
  { code: "SW900-475-O", name: "Burgundy", finish: "Gloss", hex: "#800020" },
  { code: "SW900-667-O", name: "Intense Blue", finish: "Gloss", hex: "#0047AB" },
  { code: "SW900-648-O", name: "Sea Breeze Blue", finish: "Gloss", hex: "#5F9EA0" },
  { code: "SW900-771-O", name: "Emerald Green", finish: "Gloss", hex: "#50C878" },
  { code: "SW900-731-O", name: "Lime Green", finish: "Gloss", hex: "#32CD32" },
  { code: "SW900-517-O", name: "Pool Party Pink", finish: "Gloss", hex: "#FFB6C1" },
  { code: "SW900-821-O", name: "Rock Grey", finish: "Gloss", hex: "#696969" },
  { code: "SW900-427-O", name: "Soft Red", finish: "Gloss", hex: "#E25822" },
  { code: "SW900-699-O", name: "Indigo Blue", finish: "Gloss", hex: "#4B0082" },
  { code: "SW900-632-O", name: "Light Blue", finish: "Gloss", hex: "#ADD8E6" },
  { code: "SW900-612-O", name: "Smoky Blue", finish: "Gloss", hex: "#5D8AA8" },
  { code: "SW900-792-O", name: "Dark Green", finish: "Gloss", hex: "#013220" },
  { code: "SW900-373-O", name: "Orange", finish: "Gloss", hex: "#FFA500" },
  { code: "SW900-101-O", name: "White", finish: "Gloss", hex: "#FFFFFF" },
  { code: "SW900-656-O", name: "Cloudy Blue", finish: "Gloss", hex: "#ACC8DC" },
  { code: "SW900-758-O", name: "Grass Green", finish: "Gloss", hex: "#7CFC00" },
  { code: "SW900-249-O", name: "Dark Yellow", finish: "Gloss", hex: "#E8B923" },
  { code: "SW900-110-S", name: "White Snow", finish: "Satin", hex: "#FFFAFA" },
  
  // GLOSS METALLIC
  { code: "SW900-192-M", name: "Black", finish: "Gloss Metallic", hex: "#1C1C1C" },
  { code: "SW900-401-M", name: "Pure Red", finish: "Gloss Metallic", hex: "#CC0000" },
  { code: "SW900-700-M", name: "Mysterious Indigo", finish: "Gloss Metallic", hex: "#4B0082" },
  { code: "SW900-215-M", name: "Gold", finish: "Gloss Metallic", hex: "#FFD700" },
  
  // MATTE METALLIC
  { code: "SW900-807-M", name: "Grey", finish: "Matte Metallic", hex: "#808080" },
  { code: "SW900-419-M", name: "Spark", finish: "Matte Metallic", hex: "#FF4040" },
  { code: "SW900-679-M", name: "Magnetic Burst", finish: "Matte Metallic", hex: "#4169E1" },
  { code: "SW900-255-M", name: "Sand Sparkle", finish: "Matte Metallic", hex: "#C2B280" },
  { code: "SW900-840-M", name: "Gunmetal", finish: "Matte Metallic", hex: "#536878" },
  { code: "SW900-444-M", name: "Cherry", finish: "Matte Metallic", hex: "#DE3163" },
  { code: "SW900-643-M", name: "Frosty Blue", finish: "Matte Metallic", hex: "#A7D8DE" },
  { code: "SW900-180-O", name: "Black", finish: "Matte", hex: "#0D0D0D" },
  { code: "SW900-199-M", name: "Eclipse", finish: "Matte Metallic", hex: "#343434" },
  { code: "SW900-521-M", name: "Popstar Concert", finish: "Matte Metallic", hex: "#FF1493" },
  { code: "SW900-184-M", name: "Mystery Black", finish: "Matte Metallic", hex: "#1A1A1A" },
  { code: "SW900-929-M", name: "Brown", finish: "Matte Metallic", hex: "#8B4513" },
  { code: "SW900-845-M", name: "Charcoal", finish: "Matte Metallic", hex: "#36454F" },
  { code: "SW900-565-M", name: "Purple", finish: "Matte Metallic", hex: "#800080" },
  { code: "SW900-737-M", name: "Moss Green", finish: "Matte Metallic", hex: "#8A9A5B" },
  { code: "SW900-856-O", name: "Dark Grey", finish: "Gloss", hex: "#3A3A3A" },
  { code: "SW900-803-M", name: "Silver", finish: "Matte Metallic", hex: "#C0C0C0" },
  { code: "SW900-522-M", name: "Vibrant Violet", finish: "Matte Metallic", hex: "#9400D3" },
  { code: "SW900-653-M", name: "Dark Blue", finish: "Matte Metallic", hex: "#00008B" },
  { code: "SW900-858-M", name: "Pride", finish: "Matte Metallic", hex: "#FF69B4" },
  { code: "SW900-623-M", name: "Anthracite", finish: "Matte Metallic", hex: "#383838" },
  { code: "SW900-745-M", name: "Night Blue", finish: "Matte Metallic", hex: "#191970" },
  { code: "SW900-616-O", name: "Apple Green", finish: "Gloss", hex: "#8DB600" },
  { code: "SW900-879-M", name: "Dreamline Blue", finish: "Matte Metallic", hex: "#4169E1" },
  { code: "SW900-816-M", name: "Quick Silver", finish: "Matte Metallic", hex: "#A6A6A6" },
  { code: "SW900-526-M", name: "Cosmic Rose", finish: "Matte Metallic", hex: "#FFD1DC" },
  { code: "SW900-762-M", name: "Radioactive", finish: "Matte Metallic", hex: "#39FF14" },
  { code: "SW900-857-M", name: "Silver", finish: "Matte Metallic", hex: "#AAA9AD" },
  { code: "SW900-671-M", name: "Brilliant Blue", finish: "Matte Metallic", hex: "#3399FF" },
  { code: "SW900-520-M", name: "Pink", finish: "Matte Metallic", hex: "#FFC0CB" },
  { code: "SW900-732-O", name: "Olive Green", finish: "Gloss", hex: "#808000" },
  
  // SATIN
  { code: "SW900-472-M", name: "Garnet Red", finish: "Satin", hex: "#733635" },
  { code: "SW900-615-M", name: "Blue", finish: "Satin", hex: "#0000CD" },
  { code: "SW900-711-O", name: "Khaki Green", finish: "Satin", hex: "#8B8B00" },
  { code: "SW900-197-O", name: "Black", finish: "Satin", hex: "#0A0A0A" },
  { code: "SW900-702-O", name: "Jade", finish: "Satin", hex: "#00A86B" },
  { code: "SW900-823-M", name: "Black Rock Grey", finish: "Satin", hex: "#2F4F4F" },
  { code: "SW900-805-M", name: "Silver", finish: "Satin", hex: "#C0C0C0" },
  { code: "SW900-321-O", name: "Orange", finish: "Satin", hex: "#FF7F50" },
  { code: "SW900-833-O", name: "Grey", finish: "Satin", hex: "#909090" },
  { code: "SW900-712-O", name: "Khaki Green", finish: "Satin", hex: "#C3B091" },
  { code: "SW900-854-M", name: "Dark Grey", finish: "Satin", hex: "#555555" },
  { code: "SW900-566-M", name: "Purple", finish: "Satin", hex: "#800080" },
  
  // CONFORM CHROME
  { code: "SW900-351-O", name: "Conform Chrome Silver", finish: "Chrome", hex: "#C0C0C0" },
  { code: "SW900-352-O", name: "Conform Chrome Gold", finish: "Chrome", hex: "#FFD700" },
  { code: "SW900-353-O", name: "Conform Chrome Black", finish: "Chrome", hex: "#1A1A1A" },
  { code: "SW900-354-O", name: "Conform Chrome Rose Gold", finish: "Chrome", hex: "#B76E79" },
  
  // COLORFLOW
  { code: "SW900-501-O", name: "ColorFlow Fresh Spring", finish: "ColorFlow", hex: "#00FF7F" },
  { code: "SW900-502-O", name: "ColorFlow Roaring Thunder", finish: "ColorFlow", hex: "#483D8B" },
  { code: "SW900-503-O", name: "ColorFlow Rising Sun", finish: "ColorFlow", hex: "#FF4500" },
  { code: "SW900-504-O", name: "ColorFlow Lightning Ridge", finish: "ColorFlow", hex: "#6495ED" },
  { code: "SW900-505-O", name: "ColorFlow Urban Jungle", finish: "ColorFlow", hex: "#228B22" },
  { code: "SW900-506-O", name: "ColorFlow Rushing Riptide", finish: "ColorFlow", hex: "#00CED1" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { manufacturer, batchSize = 10, startIndex = 0, specificCode } = await req.json();

    if (!hasGeminiKey()) {
      throw new Error("No Gemini API key configured");
    }

    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    const allColors = manufacturer === "3M" ? OFFICIAL_3M_COLORS : OFFICIAL_AVERY_COLORS;
    
    // Support targeting specific color by code
    let batch;
    if (specificCode) {
      const targetColor = allColors.find(c => c.code === specificCode);
      batch = targetColor ? [targetColor] : [];
    } else {
      batch = allColors.slice(startIndex, startIndex + batchSize);
    }
    
    const results = [];
    
    for (const color of batch) {
      console.log(`Generating swatch for ${manufacturer} ${color.code} - ${color.name}`);
      
      // Generate a clean swatch image using AI
      const prompt = `Generate a single 256x256 pixel vinyl wrap material swatch sample. 
The color is ${color.name} (${color.hex}) with a ${color.finish} finish.
Show realistic vinyl wrap texture with appropriate:
- Surface reflection for ${color.finish} finish
- Material grain/texture
- Slight edge shadow for depth
- Professional product photography lighting
The swatch should look like an official manufacturer color chip.
NO text, labels, or watermarks. Just the pure color swatch.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            responseMimeType: "text/plain"
          }
        }),
      });

      if (!response.ok) {
        console.error(`Failed to generate swatch for ${color.code}: ${response.status}`);
        results.push({ code: color.code, success: false, error: `API error: ${response.status}` });
        continue;
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts;
      let imageBase64: string | null = null;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData) {
            const mimeType = part.inlineData.mimeType || 'image/png';
            imageBase64 = `data:${mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!imageBase64) {
        console.error(`No image returned for ${color.code}`);
        results.push({ code: color.code, success: false, error: "No image in response" });
        continue;
      }

      // Extract base64 data (remove data:image/png;base64, prefix)
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      // Upload to Supabase storage
      const fileName = `${manufacturer.toLowerCase().replace(" ", "-")}/${color.code.toLowerCase()}.png`;
      
      const { error: uploadError } = await supabase.storage
        .from("swatches")
        .upload(fileName, imageBuffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Failed to upload ${color.code}: ${uploadError.message}`);
        results.push({ code: color.code, success: false, error: uploadError.message });
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage.from("swatches").getPublicUrl(fileName);
      const mediaUrl = urlData.publicUrl;

      // Update manufacturer_colors table with official swatch URL
      const { error: updateError } = await supabase
        .from("manufacturer_colors")
        .update({ 
          official_swatch_url: mediaUrl,
        })
        .eq("manufacturer", manufacturer === "3M" ? "3M" : "Avery Dennison")
        .eq("product_code", color.code);

      if (updateError) {
        console.error(`Failed to update DB for ${color.code}: ${updateError.message}`);
        results.push({ code: color.code, success: false, error: updateError.message, mediaUrl });
      } else {
        console.log(`Successfully processed ${color.code}`);
        results.push({ code: color.code, success: true, mediaUrl });
      }
    }

    return new Response(
      JSON.stringify({
        processed: batch.length,
        total: allColors.length,
        nextIndex: startIndex + batchSize,
        hasMore: !specificCode && startIndex + batchSize < allColors.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in extract-official-swatches:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
