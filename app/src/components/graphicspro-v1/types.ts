// GraphicsPro V1 shared types

// Three customer surfaces. Floor & signage were removed — different vinyl
// film, different markup, different prep — they don't share a workflow with
// vehicle wraps / wall murals / window decals.
export type SurfaceType = 'vehicle' | 'wall' | 'glass' | 'studio';
export type SurfaceSource = 'upload' | 'generated';
export type VinylFinish = 'glossy' | 'matte' | 'satin' | 'reflective';
export type GraphicMode = 'design' | 'commercial' | 'upload' | 'restyle' | 'logo';

export type WallTexture = 'studio' | 'smooth' | 'semi-smooth' | 'textured';
export type GlassType = 'storefront' | 'office' | 'vehicle';
export type VehicleArea = 'door' | 'tailgate' | 'hood' | 'rear-window' | 'side-panel';

// Kept for transitional compatibility — no UI surfaces these any more, but
// existing rows in storage may still reference the old enums.
export type FloorType = 'concrete' | 'tile' | 'carpet' | 'wood' | 'tradeshow';
export type SignageType = 'a-frame' | 'monument' | 'banner' | 'awning' | 'yard-sign';

// Zone masking — percentage-based rectangles drawn on the surface photo
export interface VinylZone {
  id: string;
  label: string;
  x: number;           // percent 0-100 (position on canvas)
  y: number;            // percent 0-100
  width: number;        // percent 0-100
  height: number;       // percent 0-100
  widthInches: number;  // real dimension in inches
  heightInches: number; // real dimension in inches
  location: string;     // where on the vehicle/surface (e.g. "Driver door", "Hood center")
  designPrompt: string; // what the cut vinyl design should look like
  // Layered Cut Vinyl mode only — the film color / finish for this layer.
  // Free text so customers can specify exact brand colors (e.g. "Avery
  // SW900 Gloss White" or "Oracal 970 Chrome"). Empty otherwise.
  filmColor?: string;
}

// One uploaded vehicle photo + its angle tag + the zones drawn on it.
// Multiple angles let the user mark the glassmorphic zone overlay on
// driver, passenger, front, rear, hood, etc. — and get a mockup back
// for each angle.
export interface UploadedAngle {
  id: string;
  file: File | null;
  previewUrl: string;          // local blob: URL or remote URL
  storageUrl?: string;         // public URL after upload
  angle: VehicleArea | 'custom' | '';
  angleLabel: string;
  zones: VinylZone[];
}

export interface SurfaceSelections {
  type: SurfaceType | null;
  source: SurfaceSource | null;
  // Upload — one entry per uploaded angle (driver, passenger, front, rear, hood, …)
  uploadedAngles: UploadedAngle[];
  // Vehicle
  year: string;
  make: string;
  model: string;
  area: VehicleArea | '';
  paintFinish: string;
  // Wall
  indoor: boolean;
  wallTexture: WallTexture | '';
  wallColor: string;
  wallPhotoFile: File | null;
  wallPhotoUrl: string | null;
  // Glass
  glassType: GlassType | '';
  glassMount: 'interior' | 'exterior';
  glassTint: 'clear' | 'light' | 'dark';
  // Optional storefront/window photo (mirrors wallPhoto*) — when present,
  // the customer uploads their actual storefront and draws zones on it
  // instead of letting AI generate a generic window scene.
  glassPhotoFile: File | null;
  glassPhotoUrl: string | null;
  // Window / Storefront render mode. 'day' = bright daylight (default),
  // 'night' = realistic night with interior glow + streetlight,
  // 'headlights' = reflective vinyl demo lit by simulated headlight beam.
  glassRenderMode: 'day' | 'night' | 'headlights';
  // Reflective vinyl substrate. 'cut' = solid plotter-cut letters on
  // reflective sheet (Oracal 5750 RA). 'printed' = full-color print on
  // reflective base (3M 780mC, Avery RR1100). Both glow under headlights
  // but the printed version keeps colors visible inside the glow.
  vinylSubstrate: 'cut' | 'printed';
  // Surface
  surfaceCategory: 'floor' | 'signage' | '';
  floorType: FloorType | '';
  signageType: SignageType | '';
  signageMaterial: string;
  // Zone masking
  vinylZones: VinylZone[];
  // Print-and-cut bleed in inches. Standard sign-shop values:
  // 0.125" (1/8") for vehicle decals, 0.25" (1/4") for storefront /
  // window vinyl. Only matters when vinylSubstrate === 'printed'.
  bleedInches?: number;
}

export interface GraphicInput {
  mode: GraphicMode;
  // Design mode
  designPrompt: string;
  designStyle: string;
  designColors: string[];
  // Commercial mode
  businessName: string;
  businessPhone: string;
  businessWebsite: string;
  businessIndustry: string;
  businessTagline: string;
  businessLogoUrl: string | null;
  businessLogoFile: File | null;
  generateLogo: boolean;
  businessFont: string;
  businessCopyText: string;
  // Upload mode
  uploadedArtworkUrls: string[];
  uploadedArtworkFiles: File[];
  restyleEnabled: boolean;
  // Restyle mode
  restylePrompt: string;
  restyleSourceUrl: string | null;
  restyleSourceFile: File | null;
  // Logo recreation mode
  logoSourceFile: File | null;
  logoSourceUrl: string | null;
  logoRecreatePrompt: string;
  logoTargetWidth: number;   // inches — for enlarge/scale
  logoTargetHeight: number;  // inches — 0 = auto (maintain aspect ratio)
  logoVisualizeEnabled: boolean;
  logoExampleFiles: File[];
  logoExampleUrls: string[];
  // VisionBoardIQ — reference/inspiration images (uses same format as DesignPro)
  visionBoardImages: Array<{ slotLabel: string; storageUrl: string }>;
  // '' = the customer hasn't chosen yet. GraphicsPro forces an explicit pick
  // between matching the upload exactly and using it as inspiration — there is
  // no silent default — so the toggle starts unselected and Generate is blocked
  // until they choose.
  visionBoardIntent: 'style_inspiration' | 'exact_reference' | '';
}

export interface GraphicsProV1State {
  step: 1 | 2 | 3;
  surface: SurfaceSelections;
  graphic: GraphicInput;
  vinylFinish: VinylFinish;
  jobId: string | null;
  isGenerating: boolean;
  error: string | null;
}

export const DEFAULT_SURFACE: SurfaceSelections = {
  type: null,
  source: null,
  uploadedAngles: [],
  year: '',
  make: '',
  model: '',
  area: '',
  paintFinish: 'glossy',
  indoor: true,
  wallTexture: '',
  wallColor: '#ffffff',
  wallPhotoFile: null,
  wallPhotoUrl: null,
  glassType: '',
  glassMount: 'exterior',
  glassTint: 'clear',
  glassPhotoFile: null,
  glassPhotoUrl: null,
  glassRenderMode: 'day',
  vinylSubstrate: 'cut',
  surfaceCategory: '',
  floorType: '',
  signageType: '',
  signageMaterial: 'aluminum',
  vinylZones: [],
  bleedInches: 0.125,
};

export const DEFAULT_GRAPHIC: GraphicInput = {
  mode: 'design',
  designPrompt: '',
  designStyle: 'modern',
  designColors: [],
  businessName: '',
  businessPhone: '',
  businessWebsite: '',
  businessIndustry: '',
  businessTagline: '',
  businessLogoUrl: null,
  businessLogoFile: null,
  generateLogo: false,
  businessFont: '',
  businessCopyText: '',
  uploadedArtworkUrls: [],
  uploadedArtworkFiles: [],
  restyleEnabled: false,
  restylePrompt: '',
  restyleSourceUrl: null,
  restyleSourceFile: null,
  logoSourceFile: null,
  logoSourceUrl: null,
  logoRecreatePrompt: '',
  logoTargetWidth: 0,
  logoTargetHeight: 0,
  logoVisualizeEnabled: false,
  logoExampleFiles: [],
  logoExampleUrls: [],
  visionBoardImages: [],
  // Unselected on purpose — the customer chooses per job whether to match the
  // upload exactly ("Recreate Exactly") or use it as inspiration. Generation is
  // blocked until they pick, so neither behavior is silently assumed.
  visionBoardIntent: '',
};

export const DESIGN_STYLES = [
  { value: 'modern', label: 'Modern' },
  { value: 'classic', label: 'Classic' },
  { value: 'bold', label: 'Bold' },
  { value: 'elegant', label: 'Elegant' },
  { value: 'playful', label: 'Playful' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'retro', label: 'Retro' },
] as const;

export const BUSINESS_INDUSTRIES = [
  'Automotive',
  'Construction',
  'Food & Beverage',
  'Healthcare',
  'Landscaping',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Real Estate',
  'Fitness',
  'Pet Services',
  'Cleaning Services',
  'Delivery & Logistics',
  'Photography',
  'Salon & Beauty',
  'Other',
] as const;

export const FONT_PRESETS: { category: string; fonts: string[] }[] = [
  {
    category: 'Sans-Serif',
    fonts: [
      'Helvetica', 'Arial', 'Futura', 'Gotham', 'Montserrat', 'Roboto',
      'Open Sans', 'Poppins', 'Raleway', 'Lato', 'Oswald', 'Nunito',
      'Inter', 'DM Sans', 'Source Sans Pro', 'Proxima Nova', 'Avenir',
      'Century Gothic', 'Gill Sans', 'Trade Gothic',
    ],
  },
  {
    category: 'Serif',
    fonts: [
      'Times New Roman', 'Georgia', 'Garamond', 'Playfair Display',
      'Merriweather', 'Libre Baskerville', 'Crimson Text', 'Lora',
      'Bodoni', 'Caslon',
    ],
  },
  {
    category: 'Display / Bold',
    fonts: [
      'Impact', 'Bebas Neue', 'Anton', 'Black Ops One', 'Teko',
      'Bungee', 'Righteous', 'Passion One', 'Racing Sans One',
      'Russo One', 'Orbitron', 'Audiowide', 'Coda', 'Bangers',
      'Changa One', 'Alfa Slab One', 'Ultra', 'Bowlby One SC',
    ],
  },
  {
    category: 'Script / Handwritten',
    fonts: [
      'Pacifico', 'Dancing Script', 'Lobster', 'Great Vibes',
      'Sacramento', 'Satisfy', 'Allura', 'Yellowtail', 'Caveat',
      'Kalam', 'Patrick Hand',
    ],
  },
  {
    category: 'Monospace / Technical',
    fonts: [
      'Courier New', 'Fira Code', 'Space Mono', 'JetBrains Mono',
      'IBM Plex Mono', 'Roboto Mono', 'Source Code Pro',
    ],
  },
];

export const VINYL_FINISHES: { value: VinylFinish; label: string; description: string }[] = [
  { value: 'glossy', label: 'Glossy', description: 'High-shine reflective finish' },
  { value: 'matte', label: 'Matte', description: 'Flat non-reflective finish' },
  { value: 'satin', label: 'Satin', description: 'Semi-gloss subtle sheen' },
  { value: 'reflective', label: 'Reflective', description: 'High-visibility reflective material' },
];
