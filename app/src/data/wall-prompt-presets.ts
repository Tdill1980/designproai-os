/**
 * WallPro Prompt Preset Library
 *
 * Curated prompts for batch generation of wall wrap designs.
 * 60 prompts across 6 categories matching WallPro's studio rooms.
 */

export interface WallPromptPreset {
  id: string;
  prompt: string;
  category: string;
  subcategory: string;
  tags: string[];
  name: string;
}

// ---------------------------------------------------------------------------
// OFFICE / CORPORATE (10)
// ---------------------------------------------------------------------------
const OFFICE: WallPromptPreset[] = [
  { id: "wall-off-01", category: "office", subcategory: "Corporate", tags: ["abstract", "modern"], name: "Fluid Dynamics", prompt: "Abstract fluid art mural — sweeping arcs of navy, silver, and white ink flowing across the entire wall, subtle metallic shimmer in the curves, negative space breathing room, sophisticated corporate energy" },
  { id: "wall-off-02", category: "office", subcategory: "Corporate", tags: ["geometric", "minimal"], name: "Hex Grid", prompt: "Geometric hexagon grid pattern — white and light gray hexagons with occasional deep teal accent fills, ultra-clean lines, architectural precision, modern tech office atmosphere" },
  { id: "wall-off-03", category: "office", subcategory: "Corporate", tags: ["cityscape", "skyline"], name: "City Horizon", prompt: "Abstract city skyline silhouette — dark charcoal buildings against a gradient sunset sky in coral, gold, and purple, reflected in water below, panoramic wide composition" },
  { id: "wall-off-04", category: "office", subcategory: "Corporate", tags: ["lines", "flow"], name: "Data Flow", prompt: "Flowing parallel lines creating a topographic landscape — thin lines in dark blue and cyan on white, subtle depth illusion, data visualization inspired, clean and intellectual" },
  { id: "wall-off-05", category: "office", subcategory: "Corporate", tags: ["marble", "luxury"], name: "Marble Vein", prompt: "Oversized marble texture — dramatic white marble with bold gray and gold veining, realistic stone grain, luxury material feel, polished surface appearance" },
  { id: "wall-off-06", category: "office", subcategory: "Corporate", tags: ["wave", "gradient"], name: "Gradient Wave", prompt: "Soft gradient wave layers — horizontal bands of color flowing left to right, dusty blue to sage green to warm gray, organic curved edges between layers, calm and professional" },
  { id: "wall-off-07", category: "office", subcategory: "Corporate", tags: ["dot", "halftone"], name: "Halftone Rise", prompt: "Large-scale halftone dot pattern — dots graduating from small to large creating a rising diagonal wave, navy blue on white, pop art meets corporate design" },
  { id: "wall-off-08", category: "office", subcategory: "Corporate", tags: ["nature", "forest"], name: "Birch Forest", prompt: "Stylized birch tree forest — vertical white trunks with black knot details against a misty sage green background, soft diffused light, nature-in-office biophilic design" },
  { id: "wall-off-09", category: "office", subcategory: "Corporate", tags: ["world", "map"], name: "World Connect", prompt: "Abstract world map — continents rendered as connected dot networks with thin lines between nodes, dark navy background, glowing cyan connection points, global business aesthetic" },
  { id: "wall-off-10", category: "office", subcategory: "Corporate", tags: ["mountains", "landscape"], name: "Peak Layers", prompt: "Layered mountain range silhouettes — five overlapping layers from dark navy foreground to light blue background, clean flat design, peaceful depth" },
];

// ---------------------------------------------------------------------------
// FITNESS / GYM (10)
// ---------------------------------------------------------------------------
const GYM: WallPromptPreset[] = [
  { id: "wall-gym-01", category: "gym", subcategory: "Fitness", tags: ["motivational", "bold"], name: "Beast Mode", prompt: "Aggressive grunge typography wall — massive BEAST MODE text with cracked concrete texture, splattered red and black paint, industrial metal rivets, raw power energy" },
  { id: "wall-gym-02", category: "gym", subcategory: "Fitness", tags: ["geometric", "sharp"], name: "Iron Angles", prompt: "Angular geometric pattern — sharp interlocking triangles and parallelograms in matte black, gunmetal gray, and electric red, industrial steel texture undertone" },
  { id: "wall-gym-03", category: "gym", subcategory: "Fitness", tags: ["smoke", "dark"], name: "Dark Energy", prompt: "Dramatic smoke and particle effect — swirling black and red smoke tendrils with floating ember particles, dark atmospheric intensity, fight night energy" },
  { id: "wall-gym-04", category: "gym", subcategory: "Fitness", tags: ["lion", "power"], name: "Lion Heart", prompt: "Roaring lion head illustration — hyper-detailed with geometric polygon facets, mane exploding into abstract shards, gold and black color scheme, fierce determination" },
  { id: "wall-gym-05", category: "gym", subcategory: "Fitness", tags: ["grunge", "crossfit"], name: "Chalk Dust", prompt: "Chalk and concrete texture wall — white chalk handprints and splash marks on raw dark concrete, barbell silhouette watermark, authentic gym atmosphere, gritty and real" },
  { id: "wall-gym-06", category: "gym", subcategory: "Fitness", tags: ["neon", "energy"], name: "Neon Pulse", prompt: "Neon light art on dark brick — glowing neon tubes forming a heartbeat pulse line that explodes into lightning bolts, electric blue and hot pink on dark charcoal brick texture" },
  { id: "wall-gym-07", category: "gym", subcategory: "Fitness", tags: ["spartan", "warrior"], name: "Spartan Shield", prompt: "Spartan warrior helmet and shield — detailed metallic illustration in bronze, gold, and aged steel, Greek key border pattern, battle-scarred texture, warrior spirit" },
  { id: "wall-gym-08", category: "gym", subcategory: "Fitness", tags: ["abstract", "movement"], name: "Motion Blur", prompt: "Abstract human forms in motion — multiple overlapping silhouettes of athletes running, jumping, lifting, rendered in streaked neon colors on black, kinetic energy captured" },
  { id: "wall-gym-09", category: "gym", subcategory: "Fitness", tags: ["urban", "street"], name: "Street Grit", prompt: "Urban street art collage — layered graffiti tags, stencil art, and wheat-paste poster style, industrial color palette of red, black, yellow, distressed and weathered" },
  { id: "wall-gym-10", category: "gym", subcategory: "Fitness", tags: ["flames", "fire"], name: "Fire Wall", prompt: "Realistic fire and flame wall — roaring flames rising from the bottom edge, intense orange and red with blue-white cores, ember particles floating upward, pure intensity" },
];

// ---------------------------------------------------------------------------
// RETAIL / SHOWROOM (10)
// ---------------------------------------------------------------------------
const RETAIL: WallPromptPreset[] = [
  { id: "wall-ret-01", category: "retail", subcategory: "Retail", tags: ["botanical", "elegant"], name: "Botanical Garden", prompt: "Lush tropical botanical illustration — oversized monstera, palm fronds, and bird of paradise in rich greens and emerald, hand-painted watercolor style on cream background" },
  { id: "wall-ret-02", category: "retail", subcategory: "Retail", tags: ["fashion", "minimal"], name: "Fashion Line", prompt: "Minimalist fashion illustration — continuous single-line drawings of elegant figures and clothing silhouettes, thin black ink on clean white, haute couture energy" },
  { id: "wall-ret-03", category: "retail", subcategory: "Retail", tags: ["terrazzo", "pattern"], name: "Terrazzo Pop", prompt: "Large-scale terrazzo pattern — oversized stone chips and fragments in pink, mint, mustard, and coral on warm white base, playful modern material design" },
  { id: "wall-ret-04", category: "retail", subcategory: "Retail", tags: ["gold", "art deco"], name: "Deco Gold", prompt: "Art Deco geometric pattern — repeating fan shapes and sunburst rays in gold leaf texture on deep emerald green, 1920s glamour, luxury retail atmosphere" },
  { id: "wall-ret-05", category: "retail", subcategory: "Retail", tags: ["color", "gradient"], name: "Spectrum Fade", prompt: "Full spectrum color gradient — smooth horizontal transition through all rainbow colors, soft pastel tones, joyful and welcoming, Instagram-worthy backdrop" },
  { id: "wall-ret-06", category: "retail", subcategory: "Retail", tags: ["cloud", "dreamy"], name: "Cloud Nine", prompt: "Dreamy cloud ceiling mural — realistic cumulus clouds in soft blue sky, photographed from below looking up, airy and spacious feeling, serene retail environment" },
  { id: "wall-ret-07", category: "retail", subcategory: "Retail", tags: ["abstract", "brush"], name: "Brush Stroke", prompt: "Oversized abstract brush strokes — bold sweeping gestures in dusty rose, sage, and gold on white, confident artistic expression, gallery-quality contemporary art" },
  { id: "wall-ret-08", category: "retail", subcategory: "Retail", tags: ["tile", "moroccan"], name: "Zellige Tile", prompt: "Moroccan zellige tile pattern — intricate geometric star and cross pattern in cobalt blue, white, and terracotta, handcrafted ceramic texture, artisan feel" },
  { id: "wall-ret-09", category: "retail", subcategory: "Retail", tags: ["pop", "comic"], name: "Pop Art Boom", prompt: "Pop art comic panel wall — Lichtenstein-style Ben-Day dots with bold outlines, speech bubbles, explosion shapes in primary red, yellow, blue on white, playful energy" },
  { id: "wall-ret-10", category: "retail", subcategory: "Retail", tags: ["neon", "sign"], name: "Neon Sign Wall", prompt: "Vintage neon sign collage — overlapping neon tube signs in various colors on dark brick wall, motel, diner, and arrow shapes, retro Americana glow" },
];

// ---------------------------------------------------------------------------
// RESTAURANT / BAR (10)
// ---------------------------------------------------------------------------
const RESTAURANT: WallPromptPreset[] = [
  { id: "wall-rest-01", category: "restaurant", subcategory: "Restaurant", tags: ["mural", "food"], name: "Harvest Table", prompt: "Abundant harvest mural — overflowing cornucopia of fruits, vegetables, herbs, bread, and cheese painted in rich oil painting style, warm earth tones, Italian trattoria atmosphere" },
  { id: "wall-rest-02", category: "restaurant", subcategory: "Restaurant", tags: ["wine", "vineyard"], name: "Wine Country", prompt: "Vineyard landscape mural — rolling hills of grapevines in golden afternoon light, Tuscan villa in the distance, wine barrel and glass vignette, warm romantic atmosphere" },
  { id: "wall-rest-03", category: "restaurant", subcategory: "Restaurant", tags: ["japanese", "wave"], name: "Great Wave", prompt: "Japanese ukiyo-e inspired wave — dramatic ocean wave in the style of Hokusai with modern color twist in deep indigo and gold, foam details, powerful natural beauty" },
  { id: "wall-rest-04", category: "restaurant", subcategory: "Restaurant", tags: ["coffee", "chalk"], name: "Coffee Chalk", prompt: "Chalkboard-style coffee menu art — hand-drawn chalk illustrations of coffee drinks, beans, grinders, and cups on deep black background, warm white and sepia chalk lines" },
  { id: "wall-rest-05", category: "restaurant", subcategory: "Restaurant", tags: ["tropical", "tiki"], name: "Tiki Paradise", prompt: "Tropical tiki bar mural — palm trees, hibiscus flowers, tiki masks, surfboards, and sunset beach scene in vibrant retro poster colors, island paradise escape" },
  { id: "wall-rest-06", category: "restaurant", subcategory: "Restaurant", tags: ["brick", "industrial"], name: "Exposed Brick", prompt: "Photorealistic exposed brick wall — weathered red and brown bricks with aged mortar, some bricks crumbling to reveal darker layer beneath, industrial loft authenticity" },
  { id: "wall-rest-07", category: "restaurant", subcategory: "Restaurant", tags: ["mexican", "folk"], name: "Papel Picado", prompt: "Mexican papel picado banner art — intricate cut paper patterns in vibrant pink, orange, yellow, green, and purple, overlapping layers with traditional folk motifs, festive celebration" },
  { id: "wall-rest-08", category: "restaurant", subcategory: "Restaurant", tags: ["bbq", "smoke"], name: "Smoke House", prompt: "BBQ smokehouse atmosphere — dark wood plank texture with branded hot iron marks, curling smoke wisps, vintage butcher diagram illustrations, rustic Americana" },
  { id: "wall-rest-09", category: "restaurant", subcategory: "Restaurant", tags: ["sushi", "minimal"], name: "Zen Garden", prompt: "Japanese zen garden — raked sand circles and lines in light gray, arranged river stones, single cherry blossom branch, minimal and meditative, sushi bar elegance" },
  { id: "wall-rest-10", category: "restaurant", subcategory: "Restaurant", tags: ["beer", "vintage"], name: "Craft Brew Wall", prompt: "Vintage brewery poster collage — overlapping retro beer advertisements and hop illustrations in aged sepia, amber, and forest green, craft brewery nostalgia" },
];

// ---------------------------------------------------------------------------
// CORPORATE LOBBY (10)
// ---------------------------------------------------------------------------
const LOBBY: WallPromptPreset[] = [
  { id: "wall-lob-01", category: "lobby", subcategory: "Corporate Lobby", tags: ["abstract", "premium"], name: "Liquid Metal", prompt: "Liquid metallic abstract — flowing mercury and gold streams on deep charcoal, reflective surface simulation, movement frozen in time, high-end executive presence" },
  { id: "wall-lob-02", category: "lobby", subcategory: "Corporate Lobby", tags: ["photography", "aerial"], name: "Earth From Above", prompt: "Aerial earth photography — dramatic satellite view of coastline where turquoise ocean meets golden sand and deep green forest, natural beauty at planetary scale" },
  { id: "wall-lob-03", category: "lobby", subcategory: "Corporate Lobby", tags: ["concrete", "modern"], name: "Raw Concrete", prompt: "Architectural raw concrete texture — board-formed concrete wall with wood grain impressions, exposed tie holes, brutalist architecture, industrial sophistication" },
  { id: "wall-lob-04", category: "lobby", subcategory: "Corporate Lobby", tags: ["light", "rays"], name: "Light Prism", prompt: "Light refraction prism effect — white light splitting into rainbow spectrum rays fanning across dark space, physics-inspired, innovation and discovery theme" },
  { id: "wall-lob-05", category: "lobby", subcategory: "Corporate Lobby", tags: ["wood", "panel"], name: "Timber Slat", prompt: "Vertical timber slat wall texture — alternating light oak and dark walnut vertical planks with subtle shadow gaps between, warm natural material, architect-designed" },
  { id: "wall-lob-06", category: "lobby", subcategory: "Corporate Lobby", tags: ["galaxy", "space"], name: "Deep Space", prompt: "Deep space nebula — swirling gas clouds in deep purple, blue, and magenta with thousands of tiny stars, cosmic scale and wonder, Hubble telescope quality" },
  { id: "wall-lob-07", category: "lobby", subcategory: "Corporate Lobby", tags: ["watercolor", "soft"], name: "Watercolor Wash", prompt: "Oversized watercolor wash — soft wet-on-wet technique in navy, blush, and gold, pigment pooling and feathering at edges, organic and artistic, gallery-quality abstract" },
  { id: "wall-lob-08", category: "lobby", subcategory: "Corporate Lobby", tags: ["circuit", "tech"], name: "Circuit Board", prompt: "Macro circuit board pattern — gold traces and pathways on deep emerald PCB green, surface-mount components as design elements, tech company identity, precision engineering" },
  { id: "wall-lob-09", category: "lobby", subcategory: "Corporate Lobby", tags: ["forest", "mist"], name: "Misty Pines", prompt: "Misty pine forest panorama — layers of evergreen trees fading into fog, morning light filtering through, pacific northwest atmosphere, biophilic calming presence" },
  { id: "wall-lob-10", category: "lobby", subcategory: "Corporate Lobby", tags: ["geometric", "3d"], name: "Parametric Surface", prompt: "Parametric architectural surface — undulating 3D geometric panels casting natural shadows, white on white with depth variation, Zaha Hadid inspired, cutting-edge design" },
];

// ---------------------------------------------------------------------------
// RESIDENTIAL / LIVING (10)
// ---------------------------------------------------------------------------
const RESIDENTIAL: WallPromptPreset[] = [
  { id: "wall-res-01", category: "living", subcategory: "Residential", tags: ["floral", "vintage"], name: "Vintage Bloom", prompt: "Vintage botanical floral — oversized peony, rose, and dahlia blooms in soft watercolor pinks, creams, and sage greens on warm linen background, romantic cottage charm" },
  { id: "wall-res-02", category: "living", subcategory: "Residential", tags: ["jungle", "tropical"], name: "Jungle Canopy", prompt: "Dense tropical jungle canopy — overlapping banana leaves, monstera, ferns, and palm fronds in rich deep greens, exotic birds peeking through, lush maximalist botanical" },
  { id: "wall-res-03", category: "living", subcategory: "Residential", tags: ["mountain", "photo"], name: "Mountain Morning", prompt: "Panoramic mountain landscape — snow-capped peaks reflected in a perfectly still alpine lake at sunrise, golden light on peaks, deep blue water, breathtaking nature photography" },
  { id: "wall-res-04", category: "living", subcategory: "Residential", tags: ["abstract", "warm"], name: "Warm Abstract", prompt: "Warm toned abstract composition — overlapping organic shapes in terracotta, burnt sienna, warm cream, and dusty rose, modern boho aesthetic, cozy living room energy" },
  { id: "wall-res-05", category: "living", subcategory: "Residential", tags: ["stars", "night"], name: "Starry Night", prompt: "Starry night sky — thousands of stars and Milky Way band stretching across deep navy to black gradient, subtle aurora borealis green and purple at horizon, bedroom ceiling mural" },
  { id: "wall-res-06", category: "living", subcategory: "Residential", tags: ["ocean", "beach"], name: "Ocean Calm", prompt: "Calm ocean shore — gentle turquoise waves meeting white sand beach from aerial view, foam patterns and crystal clear shallow water, tropical paradise serenity" },
  { id: "wall-res-07", category: "living", subcategory: "Residential", tags: ["kids", "playful"], name: "Doodle World", prompt: "Whimsical hand-drawn doodle world — rockets, dinosaurs, rainbows, clouds, planets, and friendly monsters in colorful crayon style on white, children's playroom imagination" },
  { id: "wall-res-08", category: "living", subcategory: "Residential", tags: ["sunset", "ombre"], name: "Sunset Ombre", prompt: "Smooth sunset ombre gradient — horizontal transition from deep coral at bottom through peach, blush pink, lavender, to soft blue at top, dreamy twilight atmosphere" },
  { id: "wall-res-09", category: "living", subcategory: "Residential", tags: ["chinoiserie", "asian"], name: "Chinoiserie Garden", prompt: "Chinoiserie garden scene — exotic birds perched on flowering branches, peonies and chrysanthemums, hand-painted style in blue, green, and gold on cream silk texture" },
  { id: "wall-res-10", category: "living", subcategory: "Residential", tags: ["geometric", "mid-century"], name: "Mid-Century Mod", prompt: "Mid-century modern pattern — atomic starburst shapes, boomerang curves, and diamond grids in mustard yellow, olive green, burnt orange, and teal on warm white, retro 1960s sophistication" },
];

// ---------------------------------------------------------------------------
// SHOP WALLS — wrap shops, detail shops, mechanic bays (10)
// ---------------------------------------------------------------------------
const SHOP_WALLS: WallPromptPreset[] = [
  { id: "wall-shop-01", category: "shop", subcategory: "Wrap Shop", tags: ["tools", "industrial"], name: "Tool Wall Blueprint", prompt: "Technical blueprint wall — white line drawings of heat guns, squeegees, wrap tools, and vehicle outlines on deep navy blueprint paper, engineering precision, authentic wrap shop identity" },
  { id: "wall-shop-02", category: "shop", subcategory: "Wrap Shop", tags: ["vinyl", "color"], name: "Vinyl Swatch Wall", prompt: "Massive color swatch wall — hundreds of vinyl wrap color samples arranged in gradient rainbow order from warm to cool, each swatch with subtle texture showing gloss, satin, matte finishes, professional installer showroom" },
  { id: "wall-shop-03", category: "shop", subcategory: "Wrap Shop", tags: ["carbon", "texture"], name: "Carbon Weave XL", prompt: "Oversized carbon fiber weave pattern — hyper-detailed 3K twill weave in glossy black with subtle blue and purple iridescent reflections, automotive performance material, detail shop prestige" },
  { id: "wall-shop-04", category: "shop", subcategory: "Detail Shop", tags: ["ceramic", "shine"], name: "Ceramic Shield", prompt: "Ceramic coating visualization — liquid glass droplets beading on a deep black gloss surface, rainbow light refraction in each bead, hydrophobic perfection, premium detail shop atmosphere" },
  { id: "wall-shop-05", category: "shop", subcategory: "Wrap Shop", tags: ["before-after", "showcase"], name: "Transform Strip", prompt: "Split transformation showcase — dramatic diagonal split showing raw primer car on left transforming to stunning wrapped finish on right, metallic teal wrap with flake, the power of a wrap" },
  { id: "wall-shop-06", category: "shop", subcategory: "Mechanic Bay", tags: ["industrial", "steel"], name: "Diamond Plate", prompt: "Industrial diamond plate steel texture — worn and polished aluminum tread plate with oil stains and boot scuffs, overhead fluorescent light reflections, authentic mechanic bay grit" },
  { id: "wall-shop-07", category: "shop", subcategory: "Wrap Shop", tags: ["neon", "retro"], name: "Neon Garage Sign", prompt: "Retro neon garage signage — glowing neon tube outlines of wrenches, cars, and speed lines on dark exposed brick, hot pink and electric blue glow, custom auto shop nightlife energy" },
  { id: "wall-shop-08", category: "shop", subcategory: "Detail Shop", tags: ["water", "foam"], name: "Foam Cascade", prompt: "Luxury car wash foam cascade — thick white foam flowing down a glossy black surface revealing deep mirror shine underneath, satisfying clean reveal, premium detail studio" },
  { id: "wall-shop-09", category: "shop", subcategory: "Wrap Shop", tags: ["film", "layers"], name: "Film Peel", prompt: "Vinyl film being peeled away — dramatic close-up of color-shift chameleon wrap film being pulled back to reveal chrome underneath, adhesive strings stretching, the craft of wrapping" },
  { id: "wall-shop-10", category: "shop", subcategory: "Mechanic Bay", tags: ["gauge", "retro"], name: "Gauge Cluster", prompt: "Vintage gauge cluster wall — oversized speedometers, tachometers, oil pressure and boost gauges in chrome bezels with white faces and red needles, all pinned to redline, performance shop energy" },
];

// ---------------------------------------------------------------------------
// GARAGE WALL WRAPS — man cave, car enthusiast garages (10)
// ---------------------------------------------------------------------------
const GARAGE: WallPromptPreset[] = [
  { id: "wall-gar-01", category: "garage", subcategory: "Man Cave", tags: ["racing", "livery"], name: "Gulf Heritage", prompt: "Iconic Gulf racing livery wall — powder blue and orange racing stripes with circle-number roundel, vintage Le Mans endurance racing heritage, authentic motorsport patina" },
  { id: "wall-gar-02", category: "garage", subcategory: "Man Cave", tags: ["neon", "beer"], name: "Cold Beer Neon", prompt: "Neon beer sign collection wall — overlapping vintage neon signs for classic beer brands, pool table glow, dart board, dark wood paneling background, ultimate man cave atmosphere" },
  { id: "wall-gar-03", category: "garage", subcategory: "Car Enthusiast", tags: ["blueprint", "engine"], name: "Engine Blueprint", prompt: "Detailed engine blueprint — full cross-section of a twin-turbo V8 engine with every component labeled, white lines on dark blue engineering paper, pistons, cams, turbo plumbing, gearhead obsession" },
  { id: "wall-gar-04", category: "garage", subcategory: "Car Enthusiast", tags: ["tire", "rubber"], name: "Tire Wall", prompt: "Stacked racing tire wall — cross-section view of performance tires showing tread patterns, sidewall markings, and rubber compound layers, Michelin Pilot Sport aesthetic, track day energy" },
  { id: "wall-gar-05", category: "garage", subcategory: "Man Cave", tags: ["vintage", "gas"], name: "Route 66 Garage", prompt: "Vintage Route 66 gas station mural — weathered Texaco pumps, rusty Coca-Cola signs, classic Corvette parked outside, desert sunset, Americana road trip nostalgia" },
  { id: "wall-gar-06", category: "garage", subcategory: "Car Enthusiast", tags: ["wheel", "rim"], name: "Rim Gallery", prompt: "Luxury wheel showcase wall — rows of premium forged wheels displayed like art, BBS, HRE, Vossen styles in brushed titanium and polished aluminum, dramatic spotlight lighting on each" },
  { id: "wall-gar-07", category: "garage", subcategory: "Man Cave", tags: ["movie", "cars"], name: "Cinema Garage", prompt: "Iconic movie car collage — artistic illustrations of famous film cars: muscle car chases, spy car gadgets, time-traveling machines, ghostbusting rigs, all in stylized noir comic book style" },
  { id: "wall-gar-08", category: "garage", subcategory: "Car Enthusiast", tags: ["track", "aerial"], name: "Track Map", prompt: "Famous race track aerial map — Nürburgring Nordschleife full circuit layout in white on dark asphalt texture background, elevation changes shown with contour shading, every corner named, pilgrimage wall" },
  { id: "wall-gar-09", category: "garage", subcategory: "Man Cave", tags: ["pinup", "retro"], name: "Retro Garage Pin-Up", prompt: "Vintage hot rod poster art — classic 1950s style illustration of a chopped and channeled hot rod with flame paint job, checkered flag border, nostalgic Rat Fink era garage art" },
  { id: "wall-gar-10", category: "garage", subcategory: "Car Enthusiast", tags: ["JDM", "drift"], name: "JDM Legends", prompt: "Japanese drift car collection — stylized illustrations of legendary JDM cars: Skyline GT-R, Supra, RX-7, 240Z in Vaporwave color palette with Japanese kanji text, neon Tokyo night background" },
];

// ---------------------------------------------------------------------------
// GRAFFITI WALL — street art, urban art, wildstyle (10)
// ---------------------------------------------------------------------------
const GRAFFITI: WallPromptPreset[] = [
  { id: "wall-graf-01", category: "graffiti", subcategory: "Wildstyle", tags: ["wildstyle", "letters"], name: "Wildstyle Burner", prompt: "Full wildstyle graffiti burner — interlocking 3D block letters with arrows, connections, and extensions in electric blue, magenta, and chrome, dripping highlights, New York subway era masterpiece" },
  { id: "wall-graf-02", category: "graffiti", subcategory: "Street Art", tags: ["portrait", "stencil"], name: "Stencil Portrait", prompt: "Multi-layer stencil portrait — photorealistic face rendered in 5 spray paint layers, each a different color from red to blue, drips running down from each layer, Banksy-meets-Shepard-Fairey precision" },
  { id: "wall-graf-03", category: "graffiti", subcategory: "Urban Art", tags: ["abstract", "splatter"], name: "Paint Bomb", prompt: "Explosive paint splatter composition — massive paint-filled balloon burst captured mid-explosion, neon pink, electric yellow, and turquoise splatters on raw concrete, chaotic beautiful energy" },
  { id: "wall-graf-04", category: "graffiti", subcategory: "Wildstyle", tags: ["chrome", "3d"], name: "Chrome Letters", prompt: "Chrome bubble letter graffiti — massive 3D chrome letters with perfect mirror reflections, each letter a different metallic hue (gold, copper, silver), floating on black void, West Coast style" },
  { id: "wall-graf-05", category: "graffiti", subcategory: "Street Art", tags: ["mural", "community"], name: "Community Mural", prompt: "Vibrant community mural — mosaic of diverse faces, hands, and cultural symbols woven together with flowing ribbons and vines, warm earth tones mixed with bright accents, unity and pride" },
  { id: "wall-graf-06", category: "graffiti", subcategory: "Urban Art", tags: ["skull", "dark"], name: "Sugar Skull", prompt: "Day of the Dead sugar skull — oversized calavera with intricate floral and geometric decorations in vivid marigold, magenta, turquoise, and white, surrounded by papel picado and marigold garlands" },
  { id: "wall-graf-07", category: "graffiti", subcategory: "Wildstyle", tags: ["throw-up", "classic"], name: "Double Throw-Up", prompt: "Classic two-color throw-up — fat rounded bubble letters in silver fill with thick black outlines, drips running down, brick wall texture showing through, authentic street bombing style" },
  { id: "wall-graf-08", category: "graffiti", subcategory: "Street Art", tags: ["wheat-paste", "poster"], name: "Wheat Paste Layers", prompt: "Layered wheat-paste poster wall — torn and weathered band posters, political art, and illustrated faces overlapping in layers, rain-washed edges, urban archaeology of a living wall" },
  { id: "wall-graf-09", category: "graffiti", subcategory: "Urban Art", tags: ["geometric", "abstract"], name: "Geo Mural", prompt: "Geometric abstract street mural — bold triangles, circles, and trapezoids in flat colors of coral, teal, mustard, and black, crisp tape-edge lines, modern outdoor gallery wall" },
  { id: "wall-graf-10", category: "graffiti", subcategory: "Wildstyle", tags: ["blackbook", "sketch"], name: "Blackbook Page", prompt: "Giant blackbook sketch page — pencil and marker graffiti letter studies filling an entire wall, construction lines visible, color tests in margins, the artist's planning process blown up to wall scale" },
];

// ---------------------------------------------------------------------------
// SUPERCARS — exotic car posters/art for garage walls (10)
// ---------------------------------------------------------------------------
const SUPERCARS: WallPromptPreset[] = [
  { id: "wall-sc-01", category: "supercars", subcategory: "Exotic", tags: ["lamborghini", "neon"], name: "Aventador Neon", prompt: "Lamborghini Aventador SVJ in neon-lit underground parking garage — matte black body reflecting pink and blue neon strips, dramatic low angle, exhaust heat shimmer, midnight supercar fantasy" },
  { id: "wall-sc-02", category: "supercars", subcategory: "Exotic", tags: ["ferrari", "red"], name: "Ferrari Rosso", prompt: "Ferrari 488 Pista in Rosso Corsa — side profile on a rain-soaked Monaco street at golden hour, water reflections stretching the car's silhouette, Italian racing perfection" },
  { id: "wall-sc-03", category: "supercars", subcategory: "Exotic", tags: ["porsche", "classic"], name: "911 RS Heritage", prompt: "Porsche 911 Carrera RS 2.7 — classic ducktail in Gulf Orange with black graphics, parked on cobblestone European village street, morning fog, vintage motorsport purity" },
  { id: "wall-sc-04", category: "supercars", subcategory: "Exotic", tags: ["mclaren", "track"], name: "McLaren Track Day", prompt: "McLaren 720S GT3 at full attack on circuit — papaya orange livery, brake rotors glowing red, tire smoke billowing, track barriers blurred in background, pure racing aggression" },
  { id: "wall-sc-05", category: "supercars", subcategory: "Exotic", tags: ["bugatti", "speed"], name: "Bugatti Hyperspeed", prompt: "Bugatti Chiron Super Sport in motion blur — Atlantic Blue and black two-tone, speed streaks, salt flat desert setting, the absolute pinnacle of automotive velocity, record-breaking legend" },
  { id: "wall-sc-06", category: "supercars", subcategory: "Exotic", tags: ["pagani", "art"], name: "Pagani Sculpture", prompt: "Pagani Huayra Roadster as art sculpture — exposed titanium components, leather and carbon fiber interior visible, rotating museum display platform, automotive haute couture" },
  { id: "wall-sc-07", category: "supercars", subcategory: "Exotic", tags: ["collection", "showroom"], name: "Dream Garage", prompt: "Ultimate dream garage collection — row of exotic supercars lined up in a pristine white showroom: Ferrari, Lamborghini, Porsche, McLaren, all perfectly lit under museum spotlights, collector's paradise" },
  { id: "wall-sc-08", category: "supercars", subcategory: "Exotic", tags: ["gt", "endurance"], name: "Le Mans Night", prompt: "Le Mans 24 Hours night racing — Porsche 911 RSR under the Dunlop Bridge at midnight, headlights cutting through rain, pit crew silhouettes in background, endurance racing drama" },
  { id: "wall-sc-09", category: "supercars", subcategory: "Exotic", tags: ["engine", "detail"], name: "V12 Heart", prompt: "Exposed Ferrari V12 engine bay — gleaming red cam covers, carbon fiber intake trumpets, braided steel lines, every bolt and hose visible in hyper-detailed glory, the mechanical heart" },
  { id: "wall-sc-10", category: "supercars", subcategory: "Exotic", tags: ["poster", "retro"], name: "Countach Poster", prompt: "1980s Lamborghini Countach poster art — white Countach with massive rear wing against Miami Vice sunset gradient in pink and purple, palm tree silhouettes, retro grid floor, peak 80s automotive fantasy" },
];

// ---------------------------------------------------------------------------
// DESIGNER WALLS — William Morris, Boho, Modern Architectural (10)
// ---------------------------------------------------------------------------
const DESIGNER: WallPromptPreset[] = [
  { id: "wall-des-01", category: "designer", subcategory: "William Morris", tags: ["morris", "arts-crafts"], name: "Strawberry Thief", prompt: "William Morris Strawberry Thief pattern — thrushes stealing strawberries amid scrolling acanthus and indigo vines, hand block-printed texture in original indigo, red, and green on natural linen, Arts & Crafts movement masterpiece" },
  { id: "wall-des-02", category: "designer", subcategory: "William Morris", tags: ["morris", "botanical"], name: "Golden Lily", prompt: "William Morris Golden Lily wallpaper — intertwining lily stems with large blooms and curling leaves in warm gold, olive green, and deep crimson on aged parchment, dense hand-drawn botanical intricacy, Victorian parlor grandeur" },
  { id: "wall-des-03", category: "designer", subcategory: "William Morris", tags: ["morris", "willow"], name: "Willow Bough", prompt: "William Morris Willow Bough — graceful drooping willow branches with slender leaves in sage green and seafoam on cream ground, gentle repeating flow, quiet English country house elegance, Pre-Raphaelite calm" },
  { id: "wall-des-04", category: "designer", subcategory: "Boho", tags: ["boho", "macrame"], name: "Macrame Cascade", prompt: "Oversized macrame wall hanging — hand-knotted natural cotton rope in intricate geometric diamond and chevron patterns, long flowing fringe, woven with dried eucalyptus and pampas grass accents, warm bohemian sanctuary" },
  { id: "wall-des-05", category: "designer", subcategory: "Boho", tags: ["boho", "mandala"], name: "Mandala Sun", prompt: "Giant mandala wall art — intricate concentric rings of paisley, lotus petals, and geometric patterns radiating from center, hand-drawn line work in terracotta, burnt sienna, dusty rose, and gold on warm cream, meditation room energy" },
  { id: "wall-des-06", category: "designer", subcategory: "Boho", tags: ["boho", "textile"], name: "Kilim Patchwork", prompt: "Patchwork kilim textile wall — stitched-together vintage Turkish kilim rug fragments in faded coral, indigo, saffron, and sage, each patch with different tribal geometric motifs, well-traveled bohemian collector aesthetic" },
  { id: "wall-des-07", category: "designer", subcategory: "Boho", tags: ["boho", "dreamcatcher"], name: "Desert Dreamscape", prompt: "Bohemian desert dreamscape — layered sunset gradient in terracotta and dusty mauve behind silhouetted saguaro cacti, crescent moon with dangling feathers and beads, dried flower garlands, desert boho romance" },
  { id: "wall-des-08", category: "designer", subcategory: "Modern Architectural", tags: ["architectural", "concrete"], name: "Folded Concrete", prompt: "Parametric folded concrete wall — angular origami-inspired concrete panels casting deep geometric shadows, each facet a slightly different shade of warm gray, dramatic side lighting revealing texture, Tadao Ando meets Zaha Hadid" },
  { id: "wall-des-09", category: "designer", subcategory: "Modern Architectural", tags: ["architectural", "glass"], name: "Glass Brick Grid", prompt: "Modern glass brick wall — translucent frosted glass blocks in a precise grid with thin mortar lines, soft diffused light glowing through each block, subtle blue-green tint, contemporary spa-like architectural serenity" },
  { id: "wall-des-10", category: "designer", subcategory: "Modern Architectural", tags: ["architectural", "metal"], name: "Corten Steel", prompt: "Corten weathering steel feature wall — laser-cut geometric perforations in oxidized rust-brown steel panels revealing warm ambient light behind, patina texture ranging from deep brown to burnt orange, modern industrial sculpture" },
];

// ---------------------------------------------------------------------------
// ALL PRESETS + HELPERS
// ---------------------------------------------------------------------------

export const WALL_PRESETS: WallPromptPreset[] = [
  ...OFFICE, ...GYM, ...RETAIL, ...RESTAURANT, ...LOBBY, ...RESIDENTIAL,
  ...SHOP_WALLS, ...GARAGE, ...GRAFFITI, ...SUPERCARS, ...DESIGNER,
];

export const WALL_CATEGORIES = ["office", "gym", "retail", "restaurant", "lobby", "living", "shop", "garage", "graffiti", "supercars", "designer"] as const;
export type WallCategory = typeof WALL_CATEGORIES[number];

export const WALL_CATEGORY_LABELS: Record<WallCategory, string> = {
  office: "Office / Corporate",
  gym: "Fitness / Gym",
  retail: "Retail Showroom",
  restaurant: "Restaurant / Bar",
  lobby: "Corporate Lobby",
  living: "Residential Living",
  shop: "Shop Walls",
  garage: "Garage Wall Wraps",
  graffiti: "Graffiti Wall",
  supercars: "SuperCars",
  designer: "Designer Walls",
};

export function getRandomWallPresets(count: number, category?: WallCategory): WallPromptPreset[] {
  const pool = category ? WALL_PRESETS.filter(p => p.category === category) : [...WALL_PRESETS];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
