/**
 * WallPro natural-language brief presets — RULE 1 port of RestylePro's
 * `src/data/wall-prompt-presets.ts` (the library behind the batch app whose
 * every design the owner rated "fantastic", 2026-09-14).
 *
 * The pattern that made those batches work: each preset is ONE customer brief
 * written in plain language — subject, named colours, technique, mood — the
 * way a real client talks to a designer. The two personas (consultant, then
 * designer) do the rest, exactly as they do for a live customer. The old
 * WallPro library instead fed the personas a spec sheet ("Concept: … Visual
 * language: … Palette: … Visual intensity: …") followed by 800 characters of
 * production boilerplate, and the persona averaged it into house style.
 *
 * The 111 RestylePro presets are carried verbatim (IDs re-keyed to the
 * catalog's `WPB-` DesignID contract). The RESIDENTIAL ETSY sets are new,
 * written in the same voice for the three rendering families the owner
 * supplied as references on 2026-09-14: flat bold print (2–4 solid colours),
 * fine-line engraving (toile / lattice, 1–2 inks) and photoreal faux material
 * (chevron and herringbone wood, tile, marble).
 */
import type { WallPromptEntry } from '@/lib/wallpro-catalog';

export type WallPresetMode = 'repeat' | 'mural';
export type WallPresetRendering = 'flat-bold' | 'fine-line' | 'faux-material' | 'painted-mural' | 'photographic';

export interface WallPromptPreset {
  /** Catalog DesignID (`WPB-…`); the same regex the table CHECKs. */
  id: string;
  prompt: string;
  category: WallCategory;
  subcategory: string;
  tags: string[];
  name: string;
  /** Tiling repeat or one continuous mural. RestylePro's presets carried no mode; every one is classified here. */
  mode: WallPresetMode;
  rendering?: WallPresetRendering;
}

export const WALL_CATEGORIES = ['office', 'gym', 'retail', 'restaurant', 'lobby', 'living', 'shop', 'garage', 'graffiti', 'supercars', 'designer', 'bedroom', 'nursery', 'dining', 'powder', 'entry', 'kitchen', 'homeoffice'] as const;
export type WallCategory = typeof WALL_CATEGORIES[number];

export const WALL_CATEGORY_LABELS: Record<WallCategory, string> = {
  office: 'Office / Corporate',
  gym: 'Fitness / Gym',
  retail: 'Retail Showroom',
  restaurant: 'Restaurant / Bar',
  lobby: 'Corporate Lobby',
  living: 'Residential Living',
  shop: 'Shop Walls',
  garage: 'Garage Wall Wraps',
  graffiti: 'Graffiti Wall',
  supercars: 'SuperCars',
  designer: 'Designer Walls',
  bedroom: 'Bedroom',
  nursery: 'Nursery / Kids',
  dining: 'Dining Room',
  powder: 'Powder Room / Bath',
  entry: 'Entry / Hallway',
  kitchen: 'Kitchen / Breakfast',
  homeoffice: 'Home Office',
};

/** Which categories are a home. Everything else is a business space. */
export const RESIDENTIAL_CATEGORIES: readonly WallCategory[] = ['living', 'garage', 'designer', 'bedroom', 'nursery', 'dining', 'powder', 'entry', 'kitchen', 'homeoffice'];
export const WALL_CATEGORY_ROOM: Partial<Record<WallCategory, string>> = {
  living: 'Living Room', garage: 'Garage', designer: 'Living Room', bedroom: 'Bedroom', nursery: 'Nursery', dining: 'Dining Room', powder: 'Powder Room', entry: 'Entryway', kitchen: 'Kitchen', homeoffice: 'Home Office',
  office: 'Open Office', gym: 'Training Floor', retail: 'Sales Floor', restaurant: 'Dining Room', lobby: 'Lobby', shop: 'Shop Floor', graffiti: 'Feature Wall', supercars: 'Garage',
};

// ---------------------------------------------------------------------------
// OFFICE / CORPORATE (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const OFFICE: WallPromptPreset[] = [
  { id: 'WPB-OFF-01', category: 'office', subcategory: 'Corporate', tags: ['abstract', 'modern'], name: 'Fluid Dynamics', mode: 'mural', rendering: 'painted-mural', prompt: 'Abstract fluid art mural — sweeping arcs of navy, silver, and white ink flowing across the entire wall, subtle metallic shimmer in the curves, negative space breathing room, sophisticated corporate energy' },
  { id: 'WPB-OFF-02', category: 'office', subcategory: 'Corporate', tags: ['geometric', 'minimal'], name: 'Hex Grid', mode: 'repeat', rendering: 'flat-bold', prompt: 'Geometric hexagon grid pattern — white and light gray hexagons with occasional deep teal accent fills, ultra-clean lines, architectural precision, modern tech office atmosphere' },
  { id: 'WPB-OFF-03', category: 'office', subcategory: 'Corporate', tags: ['cityscape', 'skyline'], name: 'City Horizon', mode: 'mural', rendering: 'painted-mural', prompt: 'Abstract city skyline silhouette — dark charcoal buildings against a gradient sunset sky in coral, gold, and purple, reflected in water below, panoramic wide composition' },
  { id: 'WPB-OFF-04', category: 'office', subcategory: 'Corporate', tags: ['lines', 'flow'], name: 'Data Flow', mode: 'mural', rendering: 'fine-line', prompt: 'Flowing parallel lines creating a topographic landscape — thin lines in dark blue and cyan on white, subtle depth illusion, data visualization inspired, clean and intellectual' },
  { id: 'WPB-OFF-05', category: 'office', subcategory: 'Corporate', tags: ['marble', 'luxury'], name: 'Marble Vein', mode: 'mural', rendering: 'faux-material', prompt: 'Oversized marble texture — dramatic white marble with bold gray and gold veining, realistic stone grain, luxury material feel, polished surface appearance' },
  { id: 'WPB-OFF-06', category: 'office', subcategory: 'Corporate', tags: ['wave', 'gradient'], name: 'Gradient Wave', mode: 'mural', rendering: 'painted-mural', prompt: 'Soft gradient wave layers — horizontal bands of color flowing left to right, dusty blue to sage green to warm gray, organic curved edges between layers, calm and professional' },
  { id: 'WPB-OFF-07', category: 'office', subcategory: 'Corporate', tags: ['dot', 'halftone'], name: 'Halftone Rise', mode: 'mural', rendering: 'flat-bold', prompt: 'Large-scale halftone dot pattern — dots graduating from small to large creating a rising diagonal wave, navy blue on white, pop art meets corporate design' },
  { id: 'WPB-OFF-08', category: 'office', subcategory: 'Corporate', tags: ['nature', 'forest'], name: 'Birch Forest', mode: 'mural', rendering: 'painted-mural', prompt: 'Stylized birch tree forest — vertical white trunks with black knot details against a misty sage green background, soft diffused light, nature-in-office biophilic design' },
  { id: 'WPB-OFF-09', category: 'office', subcategory: 'Corporate', tags: ['world', 'map'], name: 'World Connect', mode: 'mural', rendering: 'fine-line', prompt: 'Abstract world map — continents rendered as connected dot networks with thin lines between nodes, dark navy background, glowing cyan connection points, global business aesthetic' },
  { id: 'WPB-OFF-10', category: 'office', subcategory: 'Corporate', tags: ['mountains', 'landscape'], name: 'Peak Layers', mode: 'mural', rendering: 'flat-bold', prompt: 'Layered mountain range silhouettes — five overlapping layers from dark navy foreground to light blue background, clean flat design, peaceful depth' },
];

// ---------------------------------------------------------------------------
// FITNESS / GYM (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const GYM: WallPromptPreset[] = [
  { id: 'WPB-GYM-01', category: 'gym', subcategory: 'Fitness', tags: ['motivational', 'bold'], name: 'Beast Mode', mode: 'mural', rendering: 'painted-mural', prompt: 'Aggressive grunge typography wall — massive BEAST MODE text with cracked concrete texture, splattered red and black paint, industrial metal rivets, raw power energy' },
  { id: 'WPB-GYM-02', category: 'gym', subcategory: 'Fitness', tags: ['geometric', 'sharp'], name: 'Iron Angles', mode: 'mural', rendering: 'flat-bold', prompt: 'Angular geometric pattern — sharp interlocking triangles and parallelograms in matte black, gunmetal gray, and electric red, industrial steel texture undertone' },
  { id: 'WPB-GYM-03', category: 'gym', subcategory: 'Fitness', tags: ['smoke', 'dark'], name: 'Dark Energy', mode: 'mural', rendering: 'painted-mural', prompt: 'Dramatic smoke and particle effect — swirling black and red smoke tendrils with floating ember particles, dark atmospheric intensity, fight night energy' },
  { id: 'WPB-GYM-04', category: 'gym', subcategory: 'Fitness', tags: ['lion', 'power'], name: 'Lion Heart', mode: 'mural', rendering: 'painted-mural', prompt: 'Roaring lion head illustration — hyper-detailed with geometric polygon facets, mane exploding into abstract shards, gold and black color scheme, fierce determination' },
  { id: 'WPB-GYM-05', category: 'gym', subcategory: 'Fitness', tags: ['grunge', 'crossfit'], name: 'Chalk Dust', mode: 'mural', rendering: 'photographic', prompt: 'Chalk and concrete texture wall — white chalk handprints and splash marks on raw dark concrete, barbell silhouette watermark, authentic gym atmosphere, gritty and real' },
  { id: 'WPB-GYM-06', category: 'gym', subcategory: 'Fitness', tags: ['neon', 'energy'], name: 'Neon Pulse', mode: 'mural', rendering: 'painted-mural', prompt: 'Neon light art on dark brick — glowing neon tubes forming a heartbeat pulse line that explodes into lightning bolts, electric blue and hot pink on dark charcoal brick texture' },
  { id: 'WPB-GYM-07', category: 'gym', subcategory: 'Fitness', tags: ['spartan', 'warrior'], name: 'Spartan Shield', mode: 'mural', rendering: 'painted-mural', prompt: 'Spartan warrior helmet and shield — detailed metallic illustration in bronze, gold, and aged steel, Greek key border pattern, battle-scarred texture, warrior spirit' },
  { id: 'WPB-GYM-08', category: 'gym', subcategory: 'Fitness', tags: ['abstract', 'movement'], name: 'Motion Blur', mode: 'mural', rendering: 'painted-mural', prompt: 'Abstract human forms in motion — multiple overlapping silhouettes of athletes running, jumping, lifting, rendered in streaked neon colors on black, kinetic energy captured' },
  { id: 'WPB-GYM-09', category: 'gym', subcategory: 'Fitness', tags: ['urban', 'street'], name: 'Street Grit', mode: 'mural', rendering: 'painted-mural', prompt: 'Urban street art collage — layered graffiti tags, stencil art, and wheat-paste poster style, industrial color palette of red, black, yellow, distressed and weathered' },
  { id: 'WPB-GYM-10', category: 'gym', subcategory: 'Fitness', tags: ['flames', 'fire'], name: 'Fire Wall', mode: 'mural', rendering: 'photographic', prompt: 'Realistic fire and flame wall — roaring flames rising from the bottom edge, intense orange and red with blue-white cores, ember particles floating upward, pure intensity' },
];

// ---------------------------------------------------------------------------
// RETAIL / SHOWROOM (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const RETAIL: WallPromptPreset[] = [
  { id: 'WPB-RET-01', category: 'retail', subcategory: 'Retail', tags: ['botanical', 'elegant'], name: 'Botanical Garden', mode: 'mural', rendering: 'painted-mural', prompt: 'Lush tropical botanical illustration — oversized monstera, palm fronds, and bird of paradise in rich greens and emerald, hand-painted watercolor style on cream background' },
  { id: 'WPB-RET-02', category: 'retail', subcategory: 'Retail', tags: ['fashion', 'minimal'], name: 'Fashion Line', mode: 'repeat', rendering: 'fine-line', prompt: 'Minimalist fashion illustration — continuous single-line drawings of elegant figures and clothing silhouettes, thin black ink on clean white, haute couture energy' },
  { id: 'WPB-RET-03', category: 'retail', subcategory: 'Retail', tags: ['terrazzo', 'pattern'], name: 'Terrazzo Pop', mode: 'repeat', rendering: 'flat-bold', prompt: 'Large-scale terrazzo pattern — oversized stone chips and fragments in pink, mint, mustard, and coral on warm white base, playful modern material design' },
  { id: 'WPB-RET-04', category: 'retail', subcategory: 'Retail', tags: ['gold', 'art deco'], name: 'Deco Gold', mode: 'repeat', rendering: 'flat-bold', prompt: 'Art Deco geometric pattern — repeating fan shapes and sunburst rays in gold leaf texture on deep emerald green, 1920s glamour, luxury retail atmosphere' },
  { id: 'WPB-RET-05', category: 'retail', subcategory: 'Retail', tags: ['color', 'gradient'], name: 'Spectrum Fade', mode: 'mural', rendering: 'painted-mural', prompt: 'Full spectrum color gradient — smooth horizontal transition through all rainbow colors, soft pastel tones, joyful and welcoming, Instagram-worthy backdrop' },
  { id: 'WPB-RET-06', category: 'retail', subcategory: 'Retail', tags: ['cloud', 'dreamy'], name: 'Cloud Nine', mode: 'mural', rendering: 'photographic', prompt: 'Dreamy cloud ceiling mural — realistic cumulus clouds in soft blue sky, photographed from below looking up, airy and spacious feeling, serene retail environment' },
  { id: 'WPB-RET-07', category: 'retail', subcategory: 'Retail', tags: ['abstract', 'brush'], name: 'Brush Stroke', mode: 'mural', rendering: 'painted-mural', prompt: 'Oversized abstract brush strokes — bold sweeping gestures in dusty rose, sage, and gold on white, confident artistic expression, gallery-quality contemporary art' },
  { id: 'WPB-RET-08', category: 'retail', subcategory: 'Retail', tags: ['tile', 'moroccan'], name: 'Zellige Tile', mode: 'repeat', rendering: 'flat-bold', prompt: 'Moroccan zellige tile pattern — intricate geometric star and cross pattern in cobalt blue, white, and terracotta, handcrafted ceramic texture, artisan feel' },
  { id: 'WPB-RET-09', category: 'retail', subcategory: 'Retail', tags: ['pop', 'comic'], name: 'Pop Art Boom', mode: 'mural', rendering: 'flat-bold', prompt: 'Pop art comic panel wall — Lichtenstein-style Ben-Day dots with bold outlines, speech bubbles, explosion shapes in primary red, yellow, blue on white, playful energy' },
  { id: 'WPB-RET-10', category: 'retail', subcategory: 'Retail', tags: ['neon', 'sign'], name: 'Neon Sign Wall', mode: 'mural', rendering: 'painted-mural', prompt: 'Vintage neon sign collage — overlapping neon tube signs in various colors on dark brick wall, motel, diner, and arrow shapes, retro Americana glow' },
];

// ---------------------------------------------------------------------------
// RESTAURANT / BAR (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const RESTAURANT: WallPromptPreset[] = [
  { id: 'WPB-REST-01', category: 'restaurant', subcategory: 'Restaurant', tags: ['mural', 'food'], name: 'Harvest Table', mode: 'mural', rendering: 'painted-mural', prompt: 'Abundant harvest mural — overflowing cornucopia of fruits, vegetables, herbs, bread, and cheese painted in rich oil painting style, warm earth tones, Italian trattoria atmosphere' },
  { id: 'WPB-REST-02', category: 'restaurant', subcategory: 'Restaurant', tags: ['wine', 'vineyard'], name: 'Wine Country', mode: 'mural', rendering: 'painted-mural', prompt: 'Vineyard landscape mural — rolling hills of grapevines in golden afternoon light, Tuscan villa in the distance, wine barrel and glass vignette, warm romantic atmosphere' },
  { id: 'WPB-REST-03', category: 'restaurant', subcategory: 'Restaurant', tags: ['japanese', 'wave'], name: 'Great Wave', mode: 'mural', rendering: 'flat-bold', prompt: 'Japanese ukiyo-e inspired wave — dramatic ocean wave in the style of Hokusai with modern color twist in deep indigo and gold, foam details, powerful natural beauty' },
  { id: 'WPB-REST-04', category: 'restaurant', subcategory: 'Restaurant', tags: ['coffee', 'chalk'], name: 'Coffee Chalk', mode: 'mural', rendering: 'fine-line', prompt: 'Chalkboard-style coffee menu art — hand-drawn chalk illustrations of coffee drinks, beans, grinders, and cups on deep black background, warm white and sepia chalk lines' },
  { id: 'WPB-REST-05', category: 'restaurant', subcategory: 'Restaurant', tags: ['tropical', 'tiki'], name: 'Tiki Paradise', mode: 'mural', rendering: 'flat-bold', prompt: 'Tropical tiki bar mural — palm trees, hibiscus flowers, tiki masks, surfboards, and sunset beach scene in vibrant retro poster colors, island paradise escape' },
  { id: 'WPB-REST-06', category: 'restaurant', subcategory: 'Restaurant', tags: ['brick', 'industrial'], name: 'Exposed Brick', mode: 'mural', rendering: 'faux-material', prompt: 'Photorealistic exposed brick wall — weathered red and brown bricks with aged mortar, some bricks crumbling to reveal darker layer beneath, industrial loft authenticity' },
  { id: 'WPB-REST-07', category: 'restaurant', subcategory: 'Restaurant', tags: ['mexican', 'folk'], name: 'Papel Picado', mode: 'mural', rendering: 'flat-bold', prompt: 'Mexican papel picado banner art — intricate cut paper patterns in vibrant pink, orange, yellow, green, and purple, overlapping layers with traditional folk motifs, festive celebration' },
  { id: 'WPB-REST-08', category: 'restaurant', subcategory: 'Restaurant', tags: ['bbq', 'smoke'], name: 'Smoke House', mode: 'mural', rendering: 'painted-mural', prompt: 'BBQ smokehouse atmosphere — dark wood plank texture with branded hot iron marks, curling smoke wisps, vintage butcher diagram illustrations, rustic Americana' },
  { id: 'WPB-REST-09', category: 'restaurant', subcategory: 'Restaurant', tags: ['sushi', 'minimal'], name: 'Zen Garden', mode: 'mural', rendering: 'painted-mural', prompt: 'Japanese zen garden — raked sand circles and lines in light gray, arranged river stones, single cherry blossom branch, minimal and meditative, sushi bar elegance' },
  { id: 'WPB-REST-10', category: 'restaurant', subcategory: 'Restaurant', tags: ['beer', 'vintage'], name: 'Craft Brew Wall', mode: 'mural', rendering: 'painted-mural', prompt: 'Vintage brewery poster collage — overlapping retro beer advertisements and hop illustrations in aged sepia, amber, and forest green, craft brewery nostalgia' },
];

// ---------------------------------------------------------------------------
// CORPORATE LOBBY (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const LOBBY: WallPromptPreset[] = [
  { id: 'WPB-LOB-01', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['abstract', 'premium'], name: 'Liquid Metal', mode: 'mural', rendering: 'painted-mural', prompt: 'Liquid metallic abstract — flowing mercury and gold streams on deep charcoal, reflective surface simulation, movement frozen in time, high-end executive presence' },
  { id: 'WPB-LOB-02', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['photography', 'aerial'], name: 'Earth From Above', mode: 'mural', rendering: 'photographic', prompt: 'Aerial earth photography — dramatic satellite view of coastline where turquoise ocean meets golden sand and deep green forest, natural beauty at planetary scale' },
  { id: 'WPB-LOB-03', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['concrete', 'modern'], name: 'Raw Concrete', mode: 'mural', rendering: 'faux-material', prompt: 'Architectural raw concrete texture — board-formed concrete wall with wood grain impressions, exposed tie holes, brutalist architecture, industrial sophistication' },
  { id: 'WPB-LOB-04', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['light', 'rays'], name: 'Light Prism', mode: 'mural', rendering: 'painted-mural', prompt: 'Light refraction prism effect — white light splitting into rainbow spectrum rays fanning across dark space, physics-inspired, innovation and discovery theme' },
  { id: 'WPB-LOB-05', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['wood', 'panel'], name: 'Timber Slat', mode: 'repeat', rendering: 'faux-material', prompt: 'Vertical timber slat wall texture — alternating light oak and dark walnut vertical planks with subtle shadow gaps between, warm natural material, architect-designed' },
  { id: 'WPB-LOB-06', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['galaxy', 'space'], name: 'Deep Space', mode: 'mural', rendering: 'photographic', prompt: 'Deep space nebula — swirling gas clouds in deep purple, blue, and magenta with thousands of tiny stars, cosmic scale and wonder, Hubble telescope quality' },
  { id: 'WPB-LOB-07', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['watercolor', 'soft'], name: 'Watercolor Wash', mode: 'mural', rendering: 'painted-mural', prompt: 'Oversized watercolor wash — soft wet-on-wet technique in navy, blush, and gold, pigment pooling and feathering at edges, organic and artistic, gallery-quality abstract' },
  { id: 'WPB-LOB-08', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['circuit', 'tech'], name: 'Circuit Board', mode: 'repeat', rendering: 'fine-line', prompt: 'Macro circuit board pattern — gold traces and pathways on deep emerald PCB green, surface-mount components as design elements, tech company identity, precision engineering' },
  { id: 'WPB-LOB-09', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['forest', 'mist'], name: 'Misty Pines', mode: 'mural', rendering: 'photographic', prompt: 'Misty pine forest panorama — layers of evergreen trees fading into fog, morning light filtering through, pacific northwest atmosphere, biophilic calming presence' },
  { id: 'WPB-LOB-10', category: 'lobby', subcategory: 'Corporate Lobby', tags: ['geometric', '3d'], name: 'Parametric Surface', mode: 'mural', rendering: 'faux-material', prompt: 'Parametric architectural surface — undulating 3D geometric panels casting natural shadows, white on white with depth variation, Zaha Hadid inspired, cutting-edge design' },
];

// ---------------------------------------------------------------------------
// RESIDENTIAL / LIVING (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const RESIDENTIAL: WallPromptPreset[] = [
  { id: 'WPB-RES-01', category: 'living', subcategory: 'Residential', tags: ['floral', 'vintage'], name: 'Vintage Bloom', mode: 'mural', rendering: 'painted-mural', prompt: 'Vintage botanical floral — oversized peony, rose, and dahlia blooms in soft watercolor pinks, creams, and sage greens on warm linen background, romantic cottage charm' },
  { id: 'WPB-RES-02', category: 'living', subcategory: 'Residential', tags: ['jungle', 'tropical'], name: 'Jungle Canopy', mode: 'mural', rendering: 'painted-mural', prompt: 'Dense tropical jungle canopy — overlapping banana leaves, monstera, ferns, and palm fronds in rich deep greens, exotic birds peeking through, lush maximalist botanical' },
  { id: 'WPB-RES-03', category: 'living', subcategory: 'Residential', tags: ['mountain', 'photo'], name: 'Mountain Morning', mode: 'mural', rendering: 'photographic', prompt: 'Panoramic mountain landscape — snow-capped peaks reflected in a perfectly still alpine lake at sunrise, golden light on peaks, deep blue water, breathtaking nature photography' },
  { id: 'WPB-RES-04', category: 'living', subcategory: 'Residential', tags: ['abstract', 'warm'], name: 'Warm Abstract', mode: 'mural', rendering: 'flat-bold', prompt: 'Warm toned abstract composition — overlapping organic shapes in terracotta, burnt sienna, warm cream, and dusty rose, modern boho aesthetic, cozy living room energy' },
  { id: 'WPB-RES-05', category: 'living', subcategory: 'Residential', tags: ['stars', 'night'], name: 'Starry Night', mode: 'mural', rendering: 'photographic', prompt: 'Starry night sky — thousands of stars and Milky Way band stretching across deep navy to black gradient, subtle aurora borealis green and purple at horizon, bedroom ceiling mural' },
  { id: 'WPB-RES-06', category: 'living', subcategory: 'Residential', tags: ['ocean', 'beach'], name: 'Ocean Calm', mode: 'mural', rendering: 'photographic', prompt: 'Calm ocean shore — gentle turquoise waves meeting white sand beach from aerial view, foam patterns and crystal clear shallow water, tropical paradise serenity' },
  { id: 'WPB-RES-07', category: 'living', subcategory: 'Residential', tags: ['kids', 'playful'], name: 'Doodle World', mode: 'repeat', rendering: 'flat-bold', prompt: 'Whimsical hand-drawn doodle world — rockets, dinosaurs, rainbows, clouds, planets, and friendly monsters in colorful crayon style on white, children\'s playroom imagination' },
  { id: 'WPB-RES-08', category: 'living', subcategory: 'Residential', tags: ['sunset', 'ombre'], name: 'Sunset Ombre', mode: 'mural', rendering: 'painted-mural', prompt: 'Smooth sunset ombre gradient — horizontal transition from deep coral at bottom through peach, blush pink, lavender, to soft blue at top, dreamy twilight atmosphere' },
  { id: 'WPB-RES-09', category: 'living', subcategory: 'Residential', tags: ['chinoiserie', 'asian'], name: 'Chinoiserie Garden', mode: 'mural', rendering: 'painted-mural', prompt: 'Chinoiserie garden scene — exotic birds perched on flowering branches, peonies and chrysanthemums, hand-painted style in blue, green, and gold on cream silk texture' },
  { id: 'WPB-RES-10', category: 'living', subcategory: 'Residential', tags: ['geometric', 'mid-century'], name: 'Mid-Century Mod', mode: 'repeat', rendering: 'flat-bold', prompt: 'Mid-century modern pattern — atomic starburst shapes, boomerang curves, and diamond grids in mustard yellow, olive green, burnt orange, and teal on warm white, retro 1960s sophistication' },
];

// ---------------------------------------------------------------------------
// SHOP WALLS — wrap shops, detail shops, mechanic bays (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const SHOP_WALLS: WallPromptPreset[] = [
  { id: 'WPB-SHOP-01', category: 'shop', subcategory: 'Wrap Shop', tags: ['tools', 'industrial'], name: 'Tool Wall Blueprint', mode: 'mural', rendering: 'fine-line', prompt: 'Technical blueprint wall — white line drawings of heat guns, squeegees, wrap tools, and vehicle outlines on deep navy blueprint paper, engineering precision, authentic wrap shop identity' },
  { id: 'WPB-SHOP-02', category: 'shop', subcategory: 'Wrap Shop', tags: ['vinyl', 'color'], name: 'Vinyl Swatch Wall', mode: 'mural', rendering: 'photographic', prompt: 'Massive color swatch wall — hundreds of vinyl wrap color samples arranged in gradient rainbow order from warm to cool, each swatch with subtle texture showing gloss, satin, matte finishes, professional installer showroom' },
  { id: 'WPB-SHOP-03', category: 'shop', subcategory: 'Wrap Shop', tags: ['carbon', 'texture'], name: 'Carbon Weave XL', mode: 'repeat', rendering: 'faux-material', prompt: 'Oversized carbon fiber weave pattern — hyper-detailed 3K twill weave in glossy black with subtle blue and purple iridescent reflections, automotive performance material, detail shop prestige' },
  { id: 'WPB-SHOP-04', category: 'shop', subcategory: 'Detail Shop', tags: ['ceramic', 'shine'], name: 'Ceramic Shield', mode: 'mural', rendering: 'photographic', prompt: 'Ceramic coating visualization — liquid glass droplets beading on a deep black gloss surface, rainbow light refraction in each bead, hydrophobic perfection, premium detail shop atmosphere' },
  { id: 'WPB-SHOP-05', category: 'shop', subcategory: 'Wrap Shop', tags: ['before-after', 'showcase'], name: 'Transform Strip', mode: 'mural', rendering: 'photographic', prompt: 'Split transformation showcase — dramatic diagonal split showing raw primer car on left transforming to stunning wrapped finish on right, metallic teal wrap with flake, the power of a wrap' },
  { id: 'WPB-SHOP-06', category: 'shop', subcategory: 'Mechanic Bay', tags: ['industrial', 'steel'], name: 'Diamond Plate', mode: 'repeat', rendering: 'faux-material', prompt: 'Industrial diamond plate steel texture — worn and polished aluminum tread plate with oil stains and boot scuffs, overhead fluorescent light reflections, authentic mechanic bay grit' },
  { id: 'WPB-SHOP-07', category: 'shop', subcategory: 'Wrap Shop', tags: ['neon', 'retro'], name: 'Neon Garage Sign', mode: 'mural', rendering: 'painted-mural', prompt: 'Retro neon garage signage — glowing neon tube outlines of wrenches, cars, and speed lines on dark exposed brick, hot pink and electric blue glow, custom auto shop nightlife energy' },
  { id: 'WPB-SHOP-08', category: 'shop', subcategory: 'Detail Shop', tags: ['water', 'foam'], name: 'Foam Cascade', mode: 'mural', rendering: 'photographic', prompt: 'Luxury car wash foam cascade — thick white foam flowing down a glossy black surface revealing deep mirror shine underneath, satisfying clean reveal, premium detail studio' },
  { id: 'WPB-SHOP-09', category: 'shop', subcategory: 'Wrap Shop', tags: ['film', 'layers'], name: 'Film Peel', mode: 'mural', rendering: 'photographic', prompt: 'Vinyl film being peeled away — dramatic close-up of color-shift chameleon wrap film being pulled back to reveal chrome underneath, adhesive strings stretching, the craft of wrapping' },
  { id: 'WPB-SHOP-10', category: 'shop', subcategory: 'Mechanic Bay', tags: ['gauge', 'retro'], name: 'Gauge Cluster', mode: 'mural', rendering: 'painted-mural', prompt: 'Vintage gauge cluster wall — oversized speedometers, tachometers, oil pressure and boost gauges in chrome bezels with white faces and red needles, all pinned to redline, performance shop energy' },
];

// ---------------------------------------------------------------------------
// GARAGE WALL WRAPS — man cave, car enthusiast garages (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const GARAGE: WallPromptPreset[] = [
  { id: 'WPB-GAR-01', category: 'garage', subcategory: 'Man Cave', tags: ['racing', 'livery'], name: 'Gulf Heritage', mode: 'mural', rendering: 'flat-bold', prompt: 'Iconic Gulf racing livery wall — powder blue and orange racing stripes with circle-number roundel, vintage Le Mans endurance racing heritage, authentic motorsport patina' },
  { id: 'WPB-GAR-02', category: 'garage', subcategory: 'Man Cave', tags: ['neon', 'beer'], name: 'Cold Beer Neon', mode: 'mural', rendering: 'painted-mural', prompt: 'Neon beer sign collection wall — overlapping vintage neon signs for classic beer brands, pool table glow, dart board, dark wood paneling background, ultimate man cave atmosphere' },
  { id: 'WPB-GAR-03', category: 'garage', subcategory: 'Car Enthusiast', tags: ['blueprint', 'engine'], name: 'Engine Blueprint', mode: 'mural', rendering: 'fine-line', prompt: 'Detailed engine blueprint — full cross-section of a twin-turbo V8 engine with every component labeled, white lines on dark blue engineering paper, pistons, cams, turbo plumbing, gearhead obsession' },
  { id: 'WPB-GAR-04', category: 'garage', subcategory: 'Car Enthusiast', tags: ['tire', 'rubber'], name: 'Tire Wall', mode: 'mural', rendering: 'photographic', prompt: 'Stacked racing tire wall — cross-section view of performance tires showing tread patterns, sidewall markings, and rubber compound layers, Michelin Pilot Sport aesthetic, track day energy' },
  { id: 'WPB-GAR-05', category: 'garage', subcategory: 'Man Cave', tags: ['vintage', 'gas'], name: 'Route 66 Garage', mode: 'mural', rendering: 'painted-mural', prompt: 'Vintage Route 66 gas station mural — weathered Texaco pumps, rusty Coca-Cola signs, classic Corvette parked outside, desert sunset, Americana road trip nostalgia' },
  { id: 'WPB-GAR-06', category: 'garage', subcategory: 'Car Enthusiast', tags: ['wheel', 'rim'], name: 'Rim Gallery', mode: 'mural', rendering: 'photographic', prompt: 'Luxury wheel showcase wall — rows of premium forged wheels displayed like art, BBS, HRE, Vossen styles in brushed titanium and polished aluminum, dramatic spotlight lighting on each' },
  { id: 'WPB-GAR-07', category: 'garage', subcategory: 'Man Cave', tags: ['movie', 'cars'], name: 'Cinema Garage', mode: 'mural', rendering: 'flat-bold', prompt: 'Iconic movie car collage — artistic illustrations of famous film cars: muscle car chases, spy car gadgets, time-traveling machines, ghostbusting rigs, all in stylized noir comic book style' },
  { id: 'WPB-GAR-08', category: 'garage', subcategory: 'Car Enthusiast', tags: ['track', 'aerial'], name: 'Track Map', mode: 'mural', rendering: 'fine-line', prompt: 'Famous race track aerial map — Nürburgring Nordschleife full circuit layout in white on dark asphalt texture background, elevation changes shown with contour shading, every corner named, pilgrimage wall' },
  { id: 'WPB-GAR-09', category: 'garage', subcategory: 'Man Cave', tags: ['pinup', 'retro'], name: 'Retro Garage Pin-Up', mode: 'mural', rendering: 'flat-bold', prompt: 'Vintage hot rod poster art — classic 1950s style illustration of a chopped and channeled hot rod with flame paint job, checkered flag border, nostalgic Rat Fink era garage art' },
  { id: 'WPB-GAR-10', category: 'garage', subcategory: 'Car Enthusiast', tags: ['JDM', 'drift'], name: 'JDM Legends', mode: 'mural', rendering: 'flat-bold', prompt: 'Japanese drift car collection — stylized illustrations of legendary JDM cars: Skyline GT-R, Supra, RX-7, 240Z in Vaporwave color palette with Japanese kanji text, neon Tokyo night background' },
];

// ---------------------------------------------------------------------------
// GRAFFITI WALL — street art, urban art, wildstyle (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const GRAFFITI: WallPromptPreset[] = [
  { id: 'WPB-GRAF-01', category: 'graffiti', subcategory: 'Wildstyle', tags: ['wildstyle', 'letters'], name: 'Wildstyle Burner', mode: 'mural', rendering: 'painted-mural', prompt: 'Full wildstyle graffiti burner — interlocking 3D block letters with arrows, connections, and extensions in electric blue, magenta, and chrome, dripping highlights, New York subway era masterpiece' },
  { id: 'WPB-GRAF-02', category: 'graffiti', subcategory: 'Street Art', tags: ['portrait', 'stencil'], name: 'Stencil Portrait', mode: 'mural', rendering: 'flat-bold', prompt: 'Multi-layer stencil portrait — photorealistic face rendered in 5 spray paint layers, each a different color from red to blue, drips running down from each layer, Banksy-meets-Shepard-Fairey precision' },
  { id: 'WPB-GRAF-03', category: 'graffiti', subcategory: 'Urban Art', tags: ['abstract', 'splatter'], name: 'Paint Bomb', mode: 'mural', rendering: 'painted-mural', prompt: 'Explosive paint splatter composition — massive paint-filled balloon burst captured mid-explosion, neon pink, electric yellow, and turquoise splatters on raw concrete, chaotic beautiful energy' },
  { id: 'WPB-GRAF-04', category: 'graffiti', subcategory: 'Wildstyle', tags: ['chrome', '3d'], name: 'Chrome Letters', mode: 'mural', rendering: 'painted-mural', prompt: 'Chrome bubble letter graffiti — massive 3D chrome letters with perfect mirror reflections, each letter a different metallic hue (gold, copper, silver), floating on black void, West Coast style' },
  { id: 'WPB-GRAF-05', category: 'graffiti', subcategory: 'Street Art', tags: ['mural', 'community'], name: 'Community Mural', mode: 'mural', rendering: 'painted-mural', prompt: 'Vibrant community mural — mosaic of diverse faces, hands, and cultural symbols woven together with flowing ribbons and vines, warm earth tones mixed with bright accents, unity and pride' },
  { id: 'WPB-GRAF-06', category: 'graffiti', subcategory: 'Urban Art', tags: ['skull', 'dark'], name: 'Sugar Skull', mode: 'mural', rendering: 'flat-bold', prompt: 'Day of the Dead sugar skull — oversized calavera with intricate floral and geometric decorations in vivid marigold, magenta, turquoise, and white, surrounded by papel picado and marigold garlands' },
  { id: 'WPB-GRAF-07', category: 'graffiti', subcategory: 'Wildstyle', tags: ['throw-up', 'classic'], name: 'Double Throw-Up', mode: 'mural', rendering: 'painted-mural', prompt: 'Classic two-color throw-up — fat rounded bubble letters in silver fill with thick black outlines, drips running down, brick wall texture showing through, authentic street bombing style' },
  { id: 'WPB-GRAF-08', category: 'graffiti', subcategory: 'Street Art', tags: ['wheat-paste', 'poster'], name: 'Wheat Paste Layers', mode: 'mural', rendering: 'painted-mural', prompt: 'Layered wheat-paste poster wall — torn and weathered band posters, political art, and illustrated faces overlapping in layers, rain-washed edges, urban archaeology of a living wall' },
  { id: 'WPB-GRAF-09', category: 'graffiti', subcategory: 'Urban Art', tags: ['geometric', 'abstract'], name: 'Geo Mural', mode: 'mural', rendering: 'flat-bold', prompt: 'Geometric abstract street mural — bold triangles, circles, and trapezoids in flat colors of coral, teal, mustard, and black, crisp tape-edge lines, modern outdoor gallery wall' },
  { id: 'WPB-GRAF-10', category: 'graffiti', subcategory: 'Wildstyle', tags: ['blackbook', 'sketch'], name: 'Blackbook Page', mode: 'mural', rendering: 'fine-line', prompt: 'Giant blackbook sketch page — pencil and marker graffiti letter studies filling an entire wall, construction lines visible, color tests in margins, the artist\'s planning process blown up to wall scale' },
];

// ---------------------------------------------------------------------------
// SUPERCARS — exotic car posters/art for garage walls (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const SUPERCARS: WallPromptPreset[] = [
  { id: 'WPB-SC-01', category: 'supercars', subcategory: 'Exotic', tags: ['lamborghini', 'neon'], name: 'Aventador Neon', mode: 'mural', rendering: 'photographic', prompt: 'Lamborghini Aventador SVJ in neon-lit underground parking garage — matte black body reflecting pink and blue neon strips, dramatic low angle, exhaust heat shimmer, midnight supercar fantasy' },
  { id: 'WPB-SC-02', category: 'supercars', subcategory: 'Exotic', tags: ['ferrari', 'red'], name: 'Ferrari Rosso', mode: 'mural', rendering: 'photographic', prompt: 'Ferrari 488 Pista in Rosso Corsa — side profile on a rain-soaked Monaco street at golden hour, water reflections stretching the car\'s silhouette, Italian racing perfection' },
  { id: 'WPB-SC-03', category: 'supercars', subcategory: 'Exotic', tags: ['porsche', 'classic'], name: '911 RS Heritage', mode: 'mural', rendering: 'photographic', prompt: 'Porsche 911 Carrera RS 2.7 — classic ducktail in Gulf Orange with black graphics, parked on cobblestone European village street, morning fog, vintage motorsport purity' },
  { id: 'WPB-SC-04', category: 'supercars', subcategory: 'Exotic', tags: ['mclaren', 'track'], name: 'McLaren Track Day', mode: 'mural', rendering: 'photographic', prompt: 'McLaren 720S GT3 at full attack on circuit — papaya orange livery, brake rotors glowing red, tire smoke billowing, track barriers blurred in background, pure racing aggression' },
  { id: 'WPB-SC-05', category: 'supercars', subcategory: 'Exotic', tags: ['bugatti', 'speed'], name: 'Bugatti Hyperspeed', mode: 'mural', rendering: 'photographic', prompt: 'Bugatti Chiron Super Sport in motion blur — Atlantic Blue and black two-tone, speed streaks, salt flat desert setting, the absolute pinnacle of automotive velocity, record-breaking legend' },
  { id: 'WPB-SC-06', category: 'supercars', subcategory: 'Exotic', tags: ['pagani', 'art'], name: 'Pagani Sculpture', mode: 'mural', rendering: 'photographic', prompt: 'Pagani Huayra Roadster as art sculpture — exposed titanium components, leather and carbon fiber interior visible, rotating museum display platform, automotive haute couture' },
  { id: 'WPB-SC-07', category: 'supercars', subcategory: 'Exotic', tags: ['collection', 'showroom'], name: 'Dream Garage', mode: 'mural', rendering: 'photographic', prompt: 'Ultimate dream garage collection — row of exotic supercars lined up in a pristine white showroom: Ferrari, Lamborghini, Porsche, McLaren, all perfectly lit under museum spotlights, collector\'s paradise' },
  { id: 'WPB-SC-08', category: 'supercars', subcategory: 'Exotic', tags: ['gt', 'endurance'], name: 'Le Mans Night', mode: 'mural', rendering: 'photographic', prompt: 'Le Mans 24 Hours night racing — Porsche 911 RSR under the Dunlop Bridge at midnight, headlights cutting through rain, pit crew silhouettes in background, endurance racing drama' },
  { id: 'WPB-SC-09', category: 'supercars', subcategory: 'Exotic', tags: ['engine', 'detail'], name: 'V12 Heart', mode: 'mural', rendering: 'photographic', prompt: 'Exposed Ferrari V12 engine bay — gleaming red cam covers, carbon fiber intake trumpets, braided steel lines, every bolt and hose visible in hyper-detailed glory, the mechanical heart' },
  { id: 'WPB-SC-10', category: 'supercars', subcategory: 'Exotic', tags: ['poster', 'retro'], name: 'Countach Poster', mode: 'mural', rendering: 'flat-bold', prompt: '1980s Lamborghini Countach poster art — white Countach with massive rear wing against Miami Vice sunset gradient in pink and purple, palm tree silhouettes, retro grid floor, peak 80s automotive fantasy' },
];

// ---------------------------------------------------------------------------
// DESIGNER WALLS — William Morris, Boho, Modern Architectural (10) — RestylePro verbatim
// ---------------------------------------------------------------------------
const DESIGNER: WallPromptPreset[] = [
  { id: 'WPB-DES-01', category: 'designer', subcategory: 'William Morris', tags: ['morris', 'arts-crafts'], name: 'Strawberry Thief', mode: 'repeat', rendering: 'flat-bold', prompt: 'William Morris Strawberry Thief pattern — thrushes stealing strawberries amid scrolling acanthus and indigo vines, hand block-printed texture in original indigo, red, and green on natural linen, Arts & Crafts movement masterpiece' },
  { id: 'WPB-DES-02', category: 'designer', subcategory: 'William Morris', tags: ['morris', 'botanical'], name: 'Golden Lily', mode: 'repeat', rendering: 'flat-bold', prompt: 'William Morris Golden Lily wallpaper — intertwining lily stems with large blooms and curling leaves in warm gold, olive green, and deep crimson on aged parchment, dense hand-drawn botanical intricacy, Victorian parlor grandeur' },
  { id: 'WPB-DES-03', category: 'designer', subcategory: 'William Morris', tags: ['morris', 'willow'], name: 'Willow Bough', mode: 'repeat', rendering: 'flat-bold', prompt: 'William Morris Willow Bough — graceful drooping willow branches with slender leaves in sage green and seafoam on cream ground, gentle repeating flow, quiet English country house elegance, Pre-Raphaelite calm' },
  { id: 'WPB-DES-04', category: 'designer', subcategory: 'Boho', tags: ['boho', 'macrame'], name: 'Macrame Cascade', mode: 'mural', rendering: 'photographic', prompt: 'Oversized macrame wall hanging — hand-knotted natural cotton rope in intricate geometric diamond and chevron patterns, long flowing fringe, woven with dried eucalyptus and pampas grass accents, warm bohemian sanctuary' },
  { id: 'WPB-DES-05', category: 'designer', subcategory: 'Boho', tags: ['boho', 'mandala'], name: 'Mandala Sun', mode: 'mural', rendering: 'fine-line', prompt: 'Giant mandala wall art — intricate concentric rings of paisley, lotus petals, and geometric patterns radiating from center, hand-drawn line work in terracotta, burnt sienna, dusty rose, and gold on warm cream, meditation room energy' },
  { id: 'WPB-DES-06', category: 'designer', subcategory: 'Boho', tags: ['boho', 'textile'], name: 'Kilim Patchwork', mode: 'repeat', rendering: 'flat-bold', prompt: 'Patchwork kilim textile wall — stitched-together vintage Turkish kilim rug fragments in faded coral, indigo, saffron, and sage, each patch with different tribal geometric motifs, well-traveled bohemian collector aesthetic' },
  { id: 'WPB-DES-07', category: 'designer', subcategory: 'Boho', tags: ['boho', 'dreamcatcher'], name: 'Desert Dreamscape', mode: 'mural', rendering: 'flat-bold', prompt: 'Bohemian desert dreamscape — layered sunset gradient in terracotta and dusty mauve behind silhouetted saguaro cacti, crescent moon with dangling feathers and beads, dried flower garlands, desert boho romance' },
  { id: 'WPB-DES-08', category: 'designer', subcategory: 'Modern Architectural', tags: ['architectural', 'concrete'], name: 'Folded Concrete', mode: 'mural', rendering: 'faux-material', prompt: 'Parametric folded concrete wall — angular origami-inspired concrete panels casting deep geometric shadows, each facet a slightly different shade of warm gray, dramatic side lighting revealing texture, Tadao Ando meets Zaha Hadid' },
  { id: 'WPB-DES-09', category: 'designer', subcategory: 'Modern Architectural', tags: ['architectural', 'glass'], name: 'Glass Brick Grid', mode: 'repeat', rendering: 'faux-material', prompt: 'Modern glass brick wall — translucent frosted glass blocks in a precise grid with thin mortar lines, soft diffused light glowing through each block, subtle blue-green tint, contemporary spa-like architectural serenity' },
  { id: 'WPB-DES-10', category: 'designer', subcategory: 'Modern Architectural', tags: ['architectural', 'metal'], name: 'Corten Steel', mode: 'mural', rendering: 'faux-material', prompt: 'Corten weathering steel feature wall — laser-cut geometric perforations in oxidized rust-brown steel panels revealing warm ambient light behind, patina texture ranging from deep brown to burnt orange, modern industrial sculpture' },
];

// ---------------------------------------------------------------------------
// RESIDENTIAL ETSY — the three rendering families the owner supplied as
// references (2026-09-14). Written in the RestylePro voice: one subject,
// named colours with the ground named, the technique, the repeat structure
// and the motif size in inches, and the room it is for.
// ---------------------------------------------------------------------------
const BEDROOM: WallPromptPreset[] = [
  { id: 'WPB-BED-01', category: 'bedroom', subcategory: 'Flat Bold Print', tags: ['botanical', 'block print', 'two color'], name: 'Indigo Fern Block Print', mode: 'repeat', rendering: 'flat-bold', prompt: 'Hand-cut block print of fern fronds and seed heads in one deep indigo on an unbleached linen-white ground, tossed half-drop repeat with the fronds about ten inches tall, dry-brushed ink edges where the block lifted, calm and hand-made, bedroom wallpaper' },
  { id: 'WPB-BED-02', category: 'bedroom', subcategory: 'Flat Bold Print', tags: ['floral', 'silhouette', 'dark ground'], name: 'Midnight Magnolia', mode: 'repeat', rendering: 'flat-bold', prompt: 'Oversized magnolia blooms and leaves as flat silhouettes in blush, dusty rose and sage on a near-black charcoal ground, no shading at all, screen-print feel with crisp edges, half-drop repeat with each bloom about twelve inches across, moody and romantic, master bedroom feature wall' },
  { id: 'WPB-BED-03', category: 'bedroom', subcategory: 'Fine-Line Engraving', tags: ['toile', 'birds', 'one ink'], name: 'Hummingbird Toile', mode: 'repeat', rendering: 'fine-line', prompt: 'Toile de Jouy of hummingbirds hovering at honeysuckle and trumpet vine, engraved hatched line work in a single sepia-brown ink on a warm cream ground, every feather and petal built from fine parallel lines, scattered straight repeat with each bird about five inches, quiet and classic, guest bedroom' },
  { id: 'WPB-BED-04', category: 'bedroom', subcategory: 'Fine-Line Engraving', tags: ['lattice', 'ogee', 'gold'], name: 'Navy Ogee Lattice', mode: 'repeat', rendering: 'fine-line', prompt: 'Ogee lattice drawn as fine hatched line work in antique gold on a deep navy ground, the ogee cells about nine inches tall, each cell holding a small stylized leaf sprig in the same gold line, crisp and tailored, straight repeat, bedroom accent wall' },
  { id: 'WPB-BED-05', category: 'bedroom', subcategory: 'Faux Material', tags: ['wood', 'chevron', 'photoreal'], name: 'Whitewashed Chevron Oak', mode: 'repeat', rendering: 'faux-material', prompt: 'Photoreal whitewashed white-oak planks laid in a wide chevron, each plank about five inches wide with soft grain and knots showing through the wash, pale driftwood greys and warm sand tones, straight-on with no perspective and no lighting hot spots, coastal bedroom headboard wall' },
  { id: 'WPB-BED-06', category: 'bedroom', subcategory: 'Flat Bold Print', tags: ['celestial', 'two color', 'linework'], name: 'Sun and Moon Linocut', mode: 'repeat', rendering: 'flat-bold', prompt: 'Linocut suns, crescent moons and small stars in one terracotta ink on a soft oat ground, chunky carved edges, tossed repeat with each sun about six inches, warm and folk-inspired, small bedroom or reading nook' },
];

const NURSERY: WallPromptPreset[] = [
  { id: 'WPB-NUR-01', category: 'nursery', subcategory: 'Flat Bold Print', tags: ['animals', 'safari', 'gender neutral'], name: 'Savanna Friends', mode: 'repeat', rendering: 'flat-bold', prompt: 'Flat cut-paper giraffes, elephants and acacia trees in mustard, sage and warm sand on a cream ground, no outlines, soft rounded shapes, half-drop repeat with each giraffe about eight inches tall, gentle and gender-neutral, nursery' },
  { id: 'WPB-NUR-02', category: 'nursery', subcategory: 'Flat Bold Print', tags: ['rainbows', 'boho', 'muted'], name: 'Boho Rainbow Arches', mode: 'repeat', rendering: 'flat-bold', prompt: 'Flat boho rainbow arches in three bands of dusty pink, clay and muted mustard on an ivory ground, tiny hand-drawn dots between them, no shading, straight repeat with each arch about seven inches wide, soft and calm, baby girl nursery' },
  { id: 'WPB-NUR-03', category: 'nursery', subcategory: 'Fine-Line Engraving', tags: ['woodland', 'one ink', 'storybook'], name: 'Woodland Storybook', mode: 'repeat', rendering: 'fine-line', prompt: 'Storybook woodland of foxes, rabbits, mushrooms and pine sprigs in fine single-line pen work, one charcoal ink on a pale sage ground, no fills, scattered repeat with each animal about four inches, whimsical and quiet, nursery' },
  { id: 'WPB-NUR-04', category: 'nursery', subcategory: 'Flat Bold Print', tags: ['clouds', 'stars', 'blue'], name: 'Sleepy Sky', mode: 'repeat', rendering: 'flat-bold', prompt: 'Puffy flat clouds, tiny stars and a sleeping crescent moon in white and pale butter on a powder-blue ground, no gradients, half-drop repeat with each cloud about six inches wide, soothing and simple, baby boy nursery' },
  { id: 'WPB-NUR-05', category: 'nursery', subcategory: 'Flat Bold Print', tags: ['dinosaurs', 'kids', 'bold'], name: 'Dino Parade', mode: 'repeat', rendering: 'flat-bold', prompt: 'Friendly flat dinosaurs — stegosaurus, triceratops, long-neck — in olive, rust and slate blue on a warm white ground with little flat ferns between, bold silhouettes and no shading, tossed repeat with each dinosaur about seven inches long, playful, toddler bedroom' },
];

const LIVING_ETSY: WallPromptPreset[] = [
  { id: 'WPB-LIV-11', category: 'living', subcategory: 'Flat Bold Print', tags: ['leaves', 'copper', 'navy'], name: 'Copper Leaves on Navy', mode: 'repeat', rendering: 'flat-bold', prompt: 'Trailing eucalyptus and olive branches drawn as flat copper-metallic line and leaf shapes on a deep navy ground, two colours only, leaves about three inches, gently climbing half-drop repeat, elegant and modern, living room' },
  { id: 'WPB-LIV-12', category: 'living', subcategory: 'Flat Bold Print', tags: ['arches', 'terracotta', 'minimal'], name: 'Terracotta Arches', mode: 'repeat', rendering: 'flat-bold', prompt: 'Overlapping half-circle arches in terracotta, clay and warm beige on a sand ground, flat colour with a faint paper grain, arches about ten inches wide in a straight brick repeat, mid-century calm, living room feature wall' },
  { id: 'WPB-LIV-13', category: 'living', subcategory: 'Fine-Line Engraving', tags: ['cranes', 'pines', 'black ground'], name: 'Cranes and Pines', mode: 'repeat', rendering: 'fine-line', prompt: 'Japanese cranes in flight among pine boughs, fine engraved line work in ivory and a touch of gold on a matte black ground, feathers and needles all in hatched lines, half-drop repeat with each crane about eleven inches across, dramatic and serene, dining or living room' },
  { id: 'WPB-LIV-14', category: 'living', subcategory: 'Faux Material', tags: ['herringbone', 'wood', 'walnut'], name: 'Walnut Herringbone', mode: 'repeat', rendering: 'faux-material', prompt: 'Photoreal herringbone of narrow walnut planks about three inches wide with natural grain variation from honey to deep chocolate, tight seams, straight-on with no perspective, matte finish with no lighting hot spots, warm accent wall behind a sofa' },
  { id: 'WPB-LIV-15', category: 'living', subcategory: 'Flat Bold Print', tags: ['woodblock', 'waves', 'blue'], name: 'Woodblock Waves', mode: 'repeat', rendering: 'flat-bold', prompt: 'Woodblock ocean waves in three flat blues — indigo, cobalt and pale sky — with white foam curls, carved edge texture, straight repeat with each wave crest about eight inches, bold and graphic, coastal living room' },
  { id: 'WPB-LIV-16', category: 'living', subcategory: 'Flat Bold Print', tags: ['terrazzo', 'neutral'], name: 'Soft Terrazzo', mode: 'repeat', rendering: 'flat-bold', prompt: 'Terrazzo chips in oat, taupe, dusty rose and charcoal scattered on a warm white ground, flat shapes with no gloss or shading, chips one to three inches, tossed repeat, quiet and modern, living room' },
];

const DINING: WallPromptPreset[] = [
  { id: 'WPB-DIN-01', category: 'dining', subcategory: 'Fine-Line Engraving', tags: ['chinoiserie', 'toile', 'blue'], name: 'Blue Willow Toile', mode: 'repeat', rendering: 'fine-line', prompt: 'Chinoiserie toile of pagodas, footbridges, willow trees and pairs of birds in engraved hatched line work, one Delft blue ink on a soft white ground, scattered straight repeat with each scene about nine inches, classic and airy, dining room' },
  { id: 'WPB-DIN-02', category: 'dining', subcategory: 'Flat Bold Print', tags: ['citrus', 'lemons', 'bold'], name: 'Lemon Grove', mode: 'repeat', rendering: 'flat-bold', prompt: 'Lemons, blossoms and glossy leaves as flat block-print shapes in lemon yellow, two greens and white on a deep teal ground, bold and crisp with no shading, half-drop repeat with each lemon about four inches, fresh and joyful, dining room or breakfast nook' },
  { id: 'WPB-DIN-03', category: 'dining', subcategory: 'Fine-Line Engraving', tags: ['damask', 'gold', 'formal'], name: 'Charcoal Damask', mode: 'repeat', rendering: 'fine-line', prompt: 'Formal damask of acanthus scrolls and stylized pomegranates in fine gold line on a charcoal ground, hatched line texture inside every leaf, ogee repeat about fourteen inches tall, tailored and quietly grand, formal dining room' },
  { id: 'WPB-DIN-04', category: 'dining', subcategory: 'Flat Bold Print', tags: ['botanical', 'dark', 'moody'], name: 'Dark Botanical Garden', mode: 'repeat', rendering: 'flat-bold', prompt: 'Peonies, dahlias and trailing foliage as flat layered silhouettes in dusty pink, mauve, olive and forest green on a black ground, no gradients, each bloom about seven inches, dense half-drop repeat, moody maximalist, dining room' },
];

const POWDER: WallPromptPreset[] = [
  { id: 'WPB-POW-01', category: 'powder', subcategory: 'Flat Bold Print', tags: ['palms', 'green', 'bold'], name: 'Palm Frond Bold', mode: 'repeat', rendering: 'flat-bold', prompt: 'Big flat palm fronds in three greens — emerald, jade and dark pine — on a crisp white ground, no shading, fronds about fourteen inches long in a tossed half-drop repeat, bold Palm Springs energy, powder room' },
  { id: 'WPB-POW-02', category: 'powder', subcategory: 'Fine-Line Engraving', tags: ['shells', 'coastal', 'one ink'], name: 'Seashell Engravings', mode: 'repeat', rendering: 'fine-line', prompt: 'Antique engravings of scallops, conches and coral sprigs in fine hatched line work, one slate-blue ink on an ivory ground, scattered straight repeat with each shell about four inches, natural-history calm, powder room or bath' },
  { id: 'WPB-POW-03', category: 'powder', subcategory: 'Faux Material', tags: ['tile', 'zellige', 'photoreal'], name: 'Sage Zellige Tile', mode: 'repeat', rendering: 'faux-material', prompt: 'Photoreal hand-glazed zellige tiles in sage green with natural glaze variation and slightly irregular edges, each tile four inches square with thin off-white grout, straight-on with no perspective or reflections, powder room' },
  { id: 'WPB-POW-04', category: 'powder', subcategory: 'Flat Bold Print', tags: ['leopard', 'animal print', 'neutral'], name: 'Sand Leopard', mode: 'repeat', rendering: 'flat-bold', prompt: 'Abstract leopard spots as flat hand-drawn shapes in camel and dark chocolate on a warm sand ground, spots one to two inches, dense tossed repeat, chic and playful, powder room' },
  { id: 'WPB-POW-05', category: 'powder', subcategory: 'Flat Bold Print', tags: ['checker', 'wavy', 'retro'], name: 'Wavy Checkerboard', mode: 'repeat', rendering: 'flat-bold', prompt: 'Wavy checkerboard in cream and sage where every grid line bends like ripples, flat colour with crisp edges, squares about three inches, straight repeat, fun retro-modern, powder room or laundry' },
];

const ENTRY: WallPromptPreset[] = [
  { id: 'WPB-ENT-01', category: 'entry', subcategory: 'Fine-Line Engraving', tags: ['trellis', 'garden', 'green'], name: 'Garden Trellis', mode: 'repeat', rendering: 'fine-line', prompt: 'Diamond garden trellis drawn as fine double lines in olive green on a chalk-white ground, small climbing jasmine sprigs in the same green line at each crossing, diamonds about seven inches tall, straight repeat, fresh and classic, entry hall' },
  { id: 'WPB-ENT-02', category: 'entry', subcategory: 'Flat Bold Print', tags: ['stripe', 'hand painted', 'neutral'], name: 'Brushed Stripe', mode: 'repeat', rendering: 'flat-bold', prompt: 'Hand-painted vertical stripes in warm greige on a cream ground, dry-brushed edges with visible bristle texture, stripes about three inches wide with two-inch gaps, straight repeat, quiet and timeless, entryway or hallway' },
  { id: 'WPB-ENT-03', category: 'entry', subcategory: 'Faux Material', tags: ['marble', 'stone', 'photoreal'], name: 'Calacatta Slab', mode: 'mural', rendering: 'faux-material', prompt: 'Photoreal bookmatched Calacatta marble slab, bright white with bold grey and soft gold veins mirrored down the centre, honed matte finish, straight-on with no perspective or reflections, one continuous slab across the whole entry wall' },
  { id: 'WPB-ENT-04', category: 'entry', subcategory: 'Flat Bold Print', tags: ['geometric', 'art deco', 'black white'], name: 'Deco Fan Steps', mode: 'repeat', rendering: 'flat-bold', prompt: 'Art deco stepped fans in flat black and warm white with a thin brass line at each edge, crisp geometry, fans about eight inches wide in a straight repeat, tailored and graphic, entry hall' },
];

const KITCHEN: WallPromptPreset[] = [
  { id: 'WPB-KIT-01', category: 'kitchen', subcategory: 'Flat Bold Print', tags: ['fruit', 'folk', 'red'], name: 'Folk Fruit Bowl', mode: 'repeat', rendering: 'flat-bold', prompt: 'Scandinavian folk-art apples, pears and cherries with little leaves, flat shapes in brick red, mustard and forest green on a warm white ground, tossed repeat with each fruit about three inches, cheerful and hand-made, kitchen or breakfast room' },
  { id: 'WPB-KIT-02', category: 'kitchen', subcategory: 'Fine-Line Engraving', tags: ['herbs', 'botanical', 'one ink'], name: 'Kitchen Herbs', mode: 'repeat', rendering: 'fine-line', prompt: 'Botanical engravings of rosemary, thyme, sage and dill, fine hatched line work in one deep olive ink on a pale linen ground, each sprig about six inches in a scattered straight repeat, calm and studied, kitchen' },
  { id: 'WPB-KIT-03', category: 'kitchen', subcategory: 'Faux Material', tags: ['tile', 'subway', 'photoreal'], name: 'Cream Subway Tile', mode: 'repeat', rendering: 'faux-material', prompt: 'Photoreal glossy cream subway tiles three by six inches in a running bond with warm grey grout, subtle glaze ripple with no reflections of a room, straight-on and perfectly flat, kitchen backsplash wall' },
  { id: 'WPB-KIT-04', category: 'kitchen', subcategory: 'Flat Bold Print', tags: ['gingham', 'blue', 'cottage'], name: 'Painted Gingham', mode: 'repeat', rendering: 'flat-bold', prompt: 'Loose hand-painted gingham check in French blue on white with the overlaps a deeper blue, visible brush texture, checks about two inches, straight repeat, cottage kitchen' },
];

const HOME_OFFICE: WallPromptPreset[] = [
  { id: 'WPB-HOF-01', category: 'homeoffice', subcategory: 'Flat Bold Print', tags: ['geometric', 'ochre', 'grid'], name: 'Bauhaus Grid', mode: 'repeat', rendering: 'flat-bold', prompt: 'Bauhaus-style grid of half circles, quarter circles and squares in ochre, rust, navy and cream, flat colour with crisp edges, tiles about six inches, straight repeat, focused and modern, home office' },
  { id: 'WPB-HOF-02', category: 'homeoffice', subcategory: 'Fine-Line Engraving', tags: ['maps', 'topographic', 'one ink'], name: 'Contour Lines', mode: 'repeat', rendering: 'fine-line', prompt: 'Topographic contour lines in fine warm-grey ink on an off-white ground, lines about a quarter inch apart that flow continuously across the repeat with no breaks, calm and cartographic, home office' },
  { id: 'WPB-HOF-03', category: 'homeoffice', subcategory: 'Flat Bold Print', tags: ['leaves', 'olive', 'minimal'], name: 'Olive Branch Stripe', mode: 'repeat', rendering: 'flat-bold', prompt: 'Vertical rows of olive branches with small flat leaves in olive and sage on an oat ground, two greens only, branches about twelve inches tall in an evenly spaced straight repeat, quiet and tidy, home office' },
  { id: 'WPB-HOF-04', category: 'homeoffice', subcategory: 'Faux Material', tags: ['wood', 'slat', 'photoreal'], name: 'Oak Slat Wall', mode: 'repeat', rendering: 'faux-material', prompt: 'Photoreal vertical white-oak slats two inches wide with one-inch black felt gaps, straight grain and soft satin finish, straight-on with no perspective or shadows, acoustic-panel look, home office or media room' },
];

// ---------------------------------------------------------------------------
// ALL PRESETS + HELPERS
// ---------------------------------------------------------------------------

export const WALL_PRESETS: WallPromptPreset[] = [
  ...OFFICE, ...GYM, ...RETAIL, ...RESTAURANT, ...LOBBY, ...RESIDENTIAL,
  ...SHOP_WALLS, ...GARAGE, ...GRAFFITI, ...SUPERCARS, ...DESIGNER,
  ...BEDROOM, ...NURSERY, ...LIVING_ETSY, ...DINING, ...POWDER, ...ENTRY, ...KITCHEN, ...HOME_OFFICE,
];

export function presetDomain(category: WallCategory): 'commercial' | 'residential' {
  return RESIDENTIAL_CATEGORIES.includes(category) ? 'residential' : 'commercial';
}

/** RestylePro's `getRandomWallPresets`, unchanged in intent; sorted shuffle. */
export function getRandomWallPresets(count: number, category?: WallCategory): WallPromptPreset[] {
  const pool = category ? WALL_PRESETS.filter(p => p.category === category) : [...WALL_PRESETS];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/** A preset as the batch's job/row shape. `brief: 'natural'` is the contract
 * that sends the prompt to the consultant VERBATIM, as a customer's own words. */
export function presetAsEntry(p: WallPromptPreset): WallPromptEntry {
  const domain = presetDomain(p.category);
  return {
    id: p.id,
    segment: domain === 'residential' ? 'B2C' : 'B2B',
    industry: WALL_CATEGORY_LABELS[p.category],
    room: WALL_CATEGORY_ROOM[p.category] || '',
    title: p.name,
    designType: p.mode === 'repeat' ? 'Seamless Repeat Pattern' : presetMuralType(p.rendering),
    style: p.subcategory,
    palette: '',
    intensity: 'Balanced',
    prompt: p.prompt,
    tags: [...p.tags, p.category, p.mode, ...(p.rendering ? [p.rendering] : [])],
    brief: 'natural',
    domain,
    rendering: p.rendering,
  };
}

/** A brief the AI brief writer returned, as the same job/row shape. */
export function generatedBriefAsEntry(b: { id: string; name: string; subcategory: string; prompt: string; tags: string[]; mode: WallPresetMode; rendering: WallPresetRendering; domain: 'commercial' | 'residential' }): WallPromptEntry {
  return {
    id: b.id,
    segment: b.domain === 'residential' ? 'B2C' : 'B2B',
    industry: b.domain === 'residential' ? 'Residential' : b.subcategory,
    room: b.subcategory,
    title: b.name,
    designType: b.mode === 'repeat' ? 'Seamless Repeat Pattern' : presetMuralType(b.rendering),
    style: b.rendering,
    palette: '',
    intensity: 'Balanced',
    prompt: b.prompt,
    tags: [...b.tags, b.domain, b.mode, b.rendering, 'ai-brief'],
    brief: 'natural',
    domain: b.domain,
    rendering: b.rendering,
  };
}

function presetMuralType(rendering?: WallPresetRendering): string {
  switch (rendering) {
    case 'faux-material': return 'Architectural Surface';
    case 'photographic': return 'Photographic Fine Art';
    case 'fine-line': return 'Illustrative Mural';
    case 'flat-bold': return 'Feature Wall Art';
    default: return 'Painterly Mural';
  }
}
