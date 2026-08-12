/**
 * PatternPro / WBTY — Master Pattern Library
 *
 * Authoritative swatch list sourced from WePrintWraps.com WooCommerce store.
 * Used as fallback when the wbty_products DB table is empty or inaccessible.
 *
 * 5 Categories (matching WePrintWraps Wrap By The Yard collections):
 *   - Camo & Carbon   (26 swatches)  Woo ID: 1726
 *   - Metal & Marble  (20 swatches)  Woo ID: 39698
 *   - Wicked & Wild   (28 swatches)  Woo ID: 4181
 *   - Bape Camo       ( 8 swatches)  Woo ID: 42809
 *   - Modern & Trippy ( 9 swatches)  Woo ID: 52489
 *
 * Total: 91 swatches
 */
export interface StaticPattern {
  id: string;
  name: string;
  category: string;
  media_url: string;
  media_type: string;
  price: number;
  is_active: boolean;
  sort_order: number;
  /** Short AI-friendly description for render prompt context */
  description?: string;
}

let _sortOrder = 0;
const nextSort = () => ++_sortOrder;

const pat = (
  slug: string,
  name: string,
  category: string,
  description: string,
): StaticPattern => ({
  id: `wpw-${slug}`,
  name,
  category,
  media_url: `/panels/wpw/${slug}.jpg`,
  media_type: "image",
  price: 95.50,
  is_active: true,
  sort_order: nextSort(),
  description,
});

export const STATIC_PATTERNS: StaticPattern[] = [
  // ═══════════════════════════════════════════════════════════════════
  // CAMO & CARBON  (WePrintWraps Woo ID: 1726, SKU: WBTY-CAMO-CARBON)
  // ═══════════════════════════════════════════════════════════════════
  // — Camo Swatches —
  pat("sand-camo", "Sand Camo", "Camo & Carbon",
    "Desert sand camouflage in tan, beige, and light brown organic shapes"),
  pat("black-camo", "Black Camo", "Camo & Carbon",
    "All-black camouflage with dark gray and black organic camo shapes"),
  pat("digital-gray-camo", "Digital Gray Camo", "Camo & Carbon",
    "Digital pixel camouflage in shades of gray — military MARPAT style"),
  pat("broken-gray-camo", "Broken Gray Camo", "Camo & Carbon",
    "Broken/fractured gray camouflage with angular torn shapes in light and dark gray"),
  pat("broken-red-camo", "Broken Red Camo", "Camo & Carbon",
    "Broken/fractured red camouflage with angular torn shapes in red, black, and dark gray"),
  pat("red-camo", "Red Camo", "Camo & Carbon",
    "Bold red camouflage pattern with red, black, and dark red organic camo shapes"),
  pat("orange-camo", "Orange Camo", "Camo & Carbon",
    "Orange camouflage pattern with orange, brown, and tan organic camo shapes"),
  pat("hex-camo", "Hex Camo", "Camo & Carbon",
    "Hexagonal camouflage in gray tones with hex tile mosaic pattern"),
  pat("vintage-camo", "Vintage Camo", "Camo & Carbon",
    "Classic vintage woodland camouflage with faded olive, brown, and tan tones"),
  pat("modern-camo", "Modern Camo", "Camo & Carbon",
    "Modern tactical camouflage with contemporary angular shapes in olive and gray"),
  pat("grunge-camo", "Grunge Camo", "Camo & Carbon",
    "Grunge-textured distressed camouflage with splatter and weathered effects"),
  pat("digi-lime-camo", "Digi Lime Camo", "Camo & Carbon",
    "Digital pixel camouflage in neon lime green and dark green squares"),
  pat("digi-camo", "Digi Camo", "Camo & Carbon",
    "Standard digital pixel camouflage in military green, tan, and brown squares"),
  pat("unicorn-camo", "Unicorn Camo", "Camo & Carbon",
    "Multi-color unicorn camouflage in pastel pink, purple, teal, and lavender"),
  // — Carbon Swatches —
  pat("gray-carbon", "Gray Carbon", "Camo & Carbon",
    "Gray carbon fiber twill weave texture — medium gray carbon fiber pattern"),
  pat("white-carbon", "White Carbon", "Camo & Carbon",
    "White carbon fiber twill weave texture — light white carbon fiber pattern"),
  pat("black-carbon-1", "Black Carbon 1", "Camo & Carbon",
    "Classic black carbon fiber 2x2 twill weave — standard glossy black carbon texture"),
  pat("black-carbon-2", "Black Carbon 2", "Camo & Carbon",
    "Matte black carbon fiber weave — darker flat black carbon texture variant"),
  pat("red-carbon", "Red Carbon", "Camo & Carbon",
    "Red and black carbon fiber hybrid twill weave — red aramid carbon pattern"),
  pat("blue-carbon", "Blue Carbon", "Camo & Carbon",
    "Blue-tinted carbon fiber twill weave — dark blue carbon fiber pattern"),
  pat("gold-carbon-1", "Gold Carbon 1", "Camo & Carbon",
    "Dark gold-tinted carbon fiber twill weave — warm gold carbon fiber"),
  pat("gold-carbon-2", "Gold Carbon 2", "Camo & Carbon",
    "Light gold carbon fiber weave with bright golden yellow diagonal twill pattern"),
  // — Specialty Skins —
  pat("riveted-tank", "Riveted Tank", "Camo & Carbon",
    "Military tank armor plate with rivets and bolt patterns in weathered gray steel"),
  pat("doomsday-rust", "Doomsday Rust", "Camo & Carbon",
    "Heavy rust and corrosion texture with orange-brown oxidized metal and teal patina"),
  pat("antique-patina", "Antique Patina", "Camo & Carbon",
    "Turquoise-green copper patina on aged metal — verdigris antique oxidized surface"),
  pat("rat-rod", "Rat Rod", "Camo & Carbon",
    "Weathered rat rod patina texture with rust, bare metal, and distressed brown oxidation"),

  // ═══════════════════════════════════════════════════════════════════
  // METAL & MARBLE  (WePrintWraps Woo ID: 39698, SKU: WBTY-METAL-MARBLE)
  // ═══════════════════════════════════════════════════════════════════
  // — Marble Swatches —
  pat("gray-marble", "Gray Marble", "Metal & Marble",
    "Light gray marble with subtle white veining — clean Carrara marble texture"),
  pat("azul-marble", "Azul Marble", "Metal & Marble",
    "Deep blue azul marble with dramatic white lightning-bolt veining on dark navy stone"),
  pat("smokey-marble", "Smokey Marble", "Metal & Marble",
    "White marble with soft gray smoky veining — elegant calacatta style"),
  pat("classic-marble", "Classic Marble", "Metal & Marble",
    "Classic white marble with delicate gray veining — timeless Italian marble look"),
  pat("solar-flare-marble", "Solar Flare Marble", "Metal & Marble",
    "Warm marble with gold and copper solar flare veining on cream stone base"),
  pat("reverse-marble", "Reverse Marble", "Metal & Marble",
    "Dark navy-black marble with bright white reversed veining — dramatic inverted marble"),
  pat("venetian-marble", "Venetian Marble", "Metal & Marble",
    "Purple-gray venetian marble with fine delicate white veining pattern"),
  pat("egyptian-marble", "Egyptian Marble", "Metal & Marble",
    "Rich dark marble with gold Egyptian-style veining on deep charcoal stone"),
  pat("ocean-marble", "Ocean Marble", "Metal & Marble",
    "Deep ocean blue marble with swirling white and gold veining"),
  pat("ghost-marble", "Ghost Marble", "Metal & Marble",
    "Dark black marble with ghostly white veining — dramatic noir marble texture"),
  pat("crackle-marble", "Crackle Marble", "Metal & Marble",
    "White crackle-effect marble with bold dark veining in dense cracked pattern"),
  pat("rose-marble", "Rose Marble", "Metal & Marble",
    "Soft pink rose marble with gentle white and blush veining — feminine elegant stone"),
  pat("grecian-marble", "Grecian Marble", "Metal & Marble",
    "Warm cream and gold Grecian marble with rich copper and rose gold veining"),
  // — Metal Swatches —
  pat("brushed-iron", "Brushed Iron", "Metal & Marble",
    "Dark brushed iron metal texture with fine horizontal brush lines in dark gunmetal"),
  pat("gold-foil", "Gold Foil", "Metal & Marble",
    "Bright metallic gold foil texture — shiny hammered gold leaf surface"),
  pat("silver-foil", "Silver Foil", "Metal & Marble",
    "Bright metallic silver foil texture — shiny brushed chrome silver leaf surface"),
  pat("rose-gold-foil", "Rose Gold Foil", "Metal & Marble",
    "Soft rose gold metallic foil texture with warm pink-gold hammered surface"),
  pat("battle-worn", "Battle Worn", "Metal & Marble",
    "Distressed battle-worn brushed metal texture in dark gray with scratch marks"),
  pat("aged-armor", "Aged Armor", "Metal & Marble",
    "Dark aged armor metal plate texture with weathered silver-gray patina"),
  pat("diamond-plate", "Diamond Plate", "Metal & Marble",
    "Industrial aluminum diamond plate tread pattern — raised diamond texture in metallic silver"),

  // ═══════════════════════════════════════════════════════════════════
  // WICKED & WILD  (WePrintWraps Woo ID: 4181, SKU: WBTY-WICKED-WILD)
  // ═══════════════════════════════════════════════════════════════════
  pat("lifes-a-trip", "Lifes A Trip", "Wicked & Wild",
    "Trippy smiley face pattern with melting retro acid art style on pink background"),
  pat("transformer", "Transformer", "Wicked & Wild",
    "Angular robotic transformer-inspired geometric pattern in orange, black, and white zigzag shapes"),
  pat("picasasso", "Picasasso", "Wicked & Wild",
    "Abstract Picasso-inspired colorful art pattern with bold brush strokes and vivid colors"),
  pat("abstract", "Abstract", "Wicked & Wild",
    "Dark abstract fluid art pattern with teal and deep blue organic flowing shapes"),
  pat("starry-night", "Starry Night", "Wicked & Wild",
    "Van Gogh Starry Night inspired swirling blue and gold night sky pattern"),
  pat("nebula-galaxy", "Nebula Galaxy", "Wicked & Wild",
    "Blue and purple cosmic nebula galaxy with bright stars and gas cloud formations"),
  pat("purple-nebula-galaxy", "Purple Nebula Galaxy", "Wicked & Wild",
    "Deep purple nebula galaxy with vivid magenta and violet cosmic gas clouds"),
  pat("dark-nebula-galaxy", "Dark Nebula Galaxy", "Wicked & Wild",
    "Dark nebula galaxy in deep magenta and black with distant star clusters"),
  pat("rick-morty-galaxy", "Rick & Morty Galaxy", "Wicked & Wild",
    "Space-themed pattern with cartoon planets, astronauts, and sci-fi elements on dark galaxy background"),
  pat("faux-triangle-holographic", "Faux Triangle Holographic", "Wicked & Wild",
    "Pastel holographic triangle mosaic pattern with pink, purple, teal, and green geometric triangles"),
  pat("enter-the-dragon", "Enter The Dragon", "Wicked & Wild",
    "Red and gold Chinese dragon illustration on cloud background — traditional Asian dragon art"),
  pat("electric-blue", "Electric Blue", "Wicked & Wild",
    "Electric blue lightning bolts on black background — vivid blue electrical discharge pattern"),
  pat("topography-heat-map", "Topography Heat Map", "Wicked & Wild",
    "Topographic contour lines in heat map colors — orange, yellow, and red gradient"),
  pat("topography-map", "Topography Map", "Wicked & Wild",
    "Clean topographic map contour lines in teal and gray — modern minimal topo pattern"),
  pat("hypnotic", "Hypnotic", "Wicked & Wild",
    "Hypnotic swirling purple and white optical illusion pattern with mesmerizing curves"),
  pat("block-chain", "Block Chain", "Wicked & Wild",
    "Digital blockchain-inspired geometric pattern with connected hexagonal blocks"),
  pat("the-matrix", "The Matrix", "Wicked & Wild",
    "Matrix-style green digital rain — falling code characters on black background"),
  pat("faux-holographic", "Faux Holographic", "Wicked & Wild",
    "Holographic rainbow iridescent fluid swirl pattern with oil-slick color shifts"),
  pat("torn-camo", "Torn Camo", "Wicked & Wild",
    "Torn and ripped camouflage pattern with exposed layers in dark gray and black"),
  pat("color-of-money-1", "Color of Money 1", "Wicked & Wild",
    "US dollar bills collage pattern — classic green money print with hundred dollar bills"),
  pat("color-of-money-2", "Color of Money 2", "Wicked & Wild",
    "US dollar bills collage pattern — colorful money print with stacked bills"),
  pat("chameleon-camo-red", "Chameleon Camo Red", "Wicked & Wild",
    "Red and black chameleon camouflage with organic flowing shapes and color-shift effect"),
  pat("chameleon-camo-tan", "Chameleon Camo Tan", "Wicked & Wild",
    "Tan and earth-tone chameleon camouflage with organic flowing shapes"),
  pat("chameleon-camo-blue", "Chameleon Camo Blue", "Wicked & Wild",
    "Blue and teal chameleon camouflage with organic flowing shapes"),
  pat("jagged-livery-blue", "Jagged Livery Blue", "Wicked & Wild",
    "Aggressive blue racing livery with jagged lightning-bolt shapes on dark background"),
  pat("extreme-livery-yellow", "Extreme Livery Yellow", "Wicked & Wild",
    "Bold yellow and black extreme racing livery with sharp angular graphics"),
  pat("extreme-livery-lime", "Extreme Livery Lime", "Wicked & Wild",
    "Neon lime green and black extreme racing livery with sharp angular graphics"),
  pat("extreme-livery-red", "Extreme Livery Red", "Wicked & Wild",
    "Bold red and black extreme racing livery with lightning bolt shapes"),

  // ═══════════════════════════════════════════════════════════════════
  // BAPE CAMO  (WePrintWraps Woo ID: 42809, SKU: WBTY-BAPE-CAMO)
  // ═══════════════════════════════════════════════════════════════════
  pat("red-bape-camo", "Red Bape Camo", "Bape Camo",
    "Bright red Bathing Ape camo pattern with iconic ape head silhouettes in shades of red"),
  pat("blue-bape-camo", "Blue Bape Camo", "Bape Camo",
    "Vivid blue Bathing Ape camo pattern with ape head silhouettes in shades of royal blue"),
  pat("purple-bape-camo", "Purple Bape Camo", "Bape Camo",
    "Purple Bathing Ape camo pattern with ape head silhouettes in deep purple and violet"),
  pat("pink-bape-camo", "Pink Bape Camo", "Bape Camo",
    "Hot pink Bathing Ape camo pattern with ape head silhouettes in magenta and pink"),
  pat("grey-bape-camo", "Grey Bape Camo", "Bape Camo",
    "Gray Bathing Ape camo pattern with ape head silhouettes in silver, gray, and charcoal"),
  pat("army-bape-camo", "Army Bape Camo", "Bape Camo",
    "Traditional army olive, brown, and tan Bathing Ape camo pattern"),
  pat("bubble-gum-bape-camo", "Bubble Gum Bape Camo", "Bape Camo",
    "Neon green, yellow, and blue Bathing Ape camo pattern with bubblegum-bright colors"),
  pat("psychedelic-bape-camo", "Psychedelic Bape Camo", "Bape Camo",
    "Psychedelic multi-color Bathing Ape camo in yellow, magenta, purple, and orange"),

  // ═══════════════════════════════════════════════════════════════════
  // MODERN & TRIPPY  (WePrintWraps Woo ID: 52489, SKU: WBTY-MODERN-TRIPPY)
  // ═══════════════════════════════════════════════════════════════════
  pat("modern-wave", "Modern Wave", "Modern & Trippy",
    "Flowing modern wave pattern with smooth gradient curves in vibrant colors"),
  pat("liquified-rainbow", "Liquified Rainbow", "Modern & Trippy",
    "Liquified rainbow swirl pattern with melting prismatic colors flowing together"),
  pat("chromatic-splash", "Chromatic Splash", "Modern & Trippy",
    "Vivid chromatic color splash pattern with bold paint splatter in rainbow hues"),
  pat("psychedelic-drip", "Psychedelic Drip", "Modern & Trippy",
    "Psychedelic dripping paint pattern with neon colors melting and flowing downward"),
  pat("digital-graffiti", "Digital Graffiti", "Modern & Trippy",
    "Urban digital graffiti pattern with street art tags, spray paint, and bold graphics"),
  pat("glitch-blast", "Glitch Blast", "Modern & Trippy",
    "Digital glitch effect pattern with pixel distortion, scan lines, and neon color bursts"),
  pat("abstract-pulse", "Abstract Pulse", "Modern & Trippy",
    "Abstract pulsing wave pattern with rhythmic lines and vibrant color gradients"),
  pat("neon-warp", "Neon Warp", "Modern & Trippy",
    "Neon warped light trails pattern with glowing streaks in electric colors on dark background"),
  pat("melting-lines", "Melting Lines", "Modern & Trippy",
    "Melting vertical lines pattern with dripping colors and organic flowing distortion"),
];

/** Example PatternPro renders for hero + carousel display */
export const PATTERNPRO_EXAMPLE_RENDERS = [
  { id: "ex-1", image: "/panels/wpw/starry-night.jpg", title: "Starry Night", subtitle: "Wicked & Wild" },
  { id: "ex-2", image: "/panels/wpw/azul-marble.jpg", title: "Azul Marble", subtitle: "Metal & Marble" },
  { id: "ex-3", image: "/panels/wpw/red-bape-camo.jpg", title: "Red Bape Camo", subtitle: "Bape Camo" },
  { id: "ex-4", image: "/panels/wpw/gold-foil.jpg", title: "Gold Foil", subtitle: "Metal & Marble" },
  { id: "ex-5", image: "/panels/wpw/electric-blue.jpg", title: "Electric Blue", subtitle: "Wicked & Wild" },
  { id: "ex-6", image: "/panels/wpw/red-carbon.jpg", title: "Red Carbon", subtitle: "Camo & Carbon" },
  { id: "ex-7", image: "/panels/wpw/liquified-rainbow.jpg", title: "Liquified Rainbow", subtitle: "Modern & Trippy" },
  { id: "ex-8", image: "/panels/wpw/doomsday-rust.jpg", title: "Doomsday Rust", subtitle: "Camo & Carbon" },
];

/** All WePrintWraps category names */
export const WPW_CATEGORIES = [
  "Camo & Carbon",
  "Metal & Marble",
  "Wicked & Wild",
  "Bape Camo",
  "Modern & Trippy",
] as const;

/** WePrintWraps product page URLs by category */
export const WPW_PRODUCT_URLS: Record<string, string> = {
  "Camo & Carbon": "https://weprintwraps.com/our-products/camo-carbon-wrap-by-the-yard/",
  "Metal & Marble": "https://weprintwraps.com/our-products/wrap-by-the-yard-metal-marble/",
  "Wicked & Wild": "https://weprintwraps.com/our-products/wrap-by-the-yard-wicked-wild-wrap-prints/",
  "Bape Camo": "https://weprintwraps.com/our-products/wrap-by-the-yard-bape-camo/",
  "Modern & Trippy": "https://weprintwraps.com/our-products/wrap-by-the-yard-modern-trippy/",
};

/** WooCommerce product IDs by category — AUTHORITATIVE */
export const WPW_WOOCOMMERCE_IDS: Record<string, number> = {
  "Camo & Carbon": 1726,
  "Metal & Marble": 39698,
  "Wicked & Wild": 4181,
  "Bape Camo": 42809,
  "Modern & Trippy": 52489,
};

/** Pricing engine copy-paste map */
export const WBTY_PRODUCT_IDS = {
  camo_carbon: 1726,
  metal_marble: 39698,
  wicked_wild: 4181,
  bape_camo: 42809,
  modern_trippy: 52489,
};

/** Full swatch name list per internal category key */
export const WBTY_SWATCH_MAP: Record<string, string[]> = {
  camo_carbon: [
    "Sand Camo","Black Camo","Digital Gray Camo","Broken Gray Camo","Broken Red Camo",
    "Red Camo","Orange Camo","Hex Camo","Vintage Camo","Modern Camo","Grunge Camo",
    "Digi Lime Camo","Digi Camo","Unicorn Camo",
    "Gray Carbon","White Carbon","Black Carbon 1","Black Carbon 2","Red Carbon",
    "Blue Carbon","Gold Carbon 1","Gold Carbon 2",
    "Riveted Tank","Doomsday Rust","Antique Patina","Rat Rod",
  ],
  metal_marble: [
    "Gray Marble","Azul Marble","Smokey Marble","Classic Marble","Solar Flare Marble",
    "Reverse Marble","Venetian Marble","Egyptian Marble","Ocean Marble","Ghost Marble",
    "Crackle Marble","Rose Marble","Grecian Marble",
    "Brushed Iron","Gold Foil","Silver Foil","Rose Gold Foil","Battle Worn",
    "Aged Armor","Diamond Plate",
  ],
  wicked_wild: [
    "Lifes A Trip","Transformer","Picasasso","Abstract","Starry Night",
    "Nebula Galaxy","Purple Nebula Galaxy","Dark Nebula Galaxy",
    "Rick & Morty Galaxy","Faux Triangle Holographic","Enter The Dragon","Electric Blue",
    "Topography Heat Map","Topography Map","Hypnotic","Block Chain","The Matrix",
    "Faux Holographic","Torn Camo","Color of Money 1","Color of Money 2",
    "Chameleon Camo Red","Chameleon Camo Tan","Chameleon Camo Blue",
    "Jagged Livery Blue","Extreme Livery Yellow","Extreme Livery Lime","Extreme Livery Red",
  ],
  bape_camo: [
    "Red Bape Camo","Blue Bape Camo","Purple Bape Camo","Pink Bape Camo","Grey Bape Camo",
    "Army Bape Camo","Bubble Gum Bape Camo","Psychedelic Bape Camo",
  ],
  modern_trippy: [
    "Modern Wave","Liquified Rainbow","Chromatic Splash","Psychedelic Drip",
    "Digital Graffiti","Glitch Blast","Abstract Pulse","Neon Warp","Melting Lines",
  ],
};
