import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { panelImageUrl } = await req.json();
    
    if (!panelImageUrl) {
      return new Response(
        JSON.stringify({ error: 'Panel image URL required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    console.log('Analyzing panel design:', panelImageUrl);

    // Fetch panel image
    const imageResponse = await fetch(panelImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch panel image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);
    
    // Convert to base64 in chunks to avoid stack overflow
    let binaryString = '';
    const chunkSize = 0x8000; // 32KB chunks
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode(...chunk);
    }
    const base64Image = btoa(binaryString);

    const prompt = `You are a creative director naming premium automotive wrap designs for high-end marketing.

ANALYZE the design and create a BADASS, MEMORABLE name that sounds like a sports car model or fighter jet.

NAMING STYLE - Think like these:
- Car names: "Diablo", "Veneno", "Huracán", "Reventon", "Countach", "Senna", "Zonda"  
- Military/tech: "Raptor", "Viper", "Blackhawk", "Nightfall", "Apex Predator"
- Gaming/esports: "Havoc", "Wraith", "Phantom Strike", "Shadow Reign"

BANNED GENERIC WORDS:
Velocity, Flow, Stream, Wave, Rush, Burst, Strike, Speed, Motion, Dynamic, Neon, Storm, Jaws, Edge, Matrix

CREATE names like:
- Aggressive designs → "Venom", "Carnage", "Hellfire", "Annihilator"
- Sleek/tech → "Spectre", "Cipher", "Ronin", "Nexus"  
- Fire/heat → "Infernal", "Magma Core", "Solar Flare", "Pyroclasm"
- Electric/lightning → "Voltaic", "Arc Reactor", "Tesla Strike"
- Dark/stealth → "Nightshade", "Obsidian Ghost", "Void Walker"
- Geometric → "Tesseract", "Hex Protocol", "Quantum Grid"
- Nature/organic → "Leviathan", "Kraken", "Basilisk", "Hydra"
- Racing/speed → "Apex", "Redline", "Overdrive", "Turbo Phantom"

The name should make someone say "THAT'S SICK" - not "that's nice".

Return ONLY valid JSON:
{
  "name": "2-3 word BADASS name",
  "colors": "color1, color2",
  "style": "geometric/organic/abstract/etc",
  "description": "one sentence"
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: base64Image } }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    console.log('AI response:', aiResponse);

    // Parse JSON response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }
    
    const panelData = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(panelData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in analyze-panel-design:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
