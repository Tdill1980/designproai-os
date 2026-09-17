export type LandingSlotKey = 'residential' | 'commercial' | 'hospitality' | 'corporate' | 'retail' | 'before' | 'process' | 'install';
export type LandingMedia = {
  slot: LandingSlotKey;
  src: string;
  poster: string;
  title: string;
  caption: string;
  alt: string;
  enabled: boolean;
  updated_at?: string;
};

export const LANDING_BUCKET = 'wallpro-landing';
export const LANDING_QUERY_KEY = ['wallpro-landing-media'];
export const EXAMPLE_KEYS: LandingSlotKey[] = ['residential', 'commercial', 'hospitality', 'corporate', 'retail'];
export const LANDING_SLOTS: { key: LandingSlotKey; label: string; kind: 'image' | 'video'; ratio: string; help: string; defaults: LandingMedia }[] = [
  { key: 'residential', label: 'Residential / opening hero', kind: 'image', ratio: '16:9', help: 'The first hero image and Residential thumbnail.', defaults: { slot: 'residential', src: '/wallpro/proof-spa-after.jpg', poster: '', title: 'Residential', caption: 'Home spa', alt: 'Tropical botanical wall design in a home spa', enabled: true } },
  { key: 'commercial', label: 'Commercial example', kind: 'image', ratio: '16:9', help: 'The Commercial hero slide and thumbnail.', defaults: { slot: 'commercial', src: '/wallpro/proof-gym-after.jpg', poster: '', title: 'Commercial', caption: 'Fitness & gyms', alt: 'Modern gym with a large wall graphic', enabled: true } },
  { key: 'hospitality', label: 'Hospitality example', kind: 'image', ratio: '16:9', help: 'The Hospitality hero slide and thumbnail.', defaults: { slot: 'hospitality', src: '/wallpro/landing-hospitality.webp', poster: '', title: 'Hospitality', caption: 'Hotels & restaurants', alt: 'Illustrative hotel lounge with a floral wall wrap', enabled: true } },
  { key: 'corporate', label: 'Corporate example', kind: 'image', ratio: '16:9', help: 'The Corporate hero slide and thumbnail.', defaults: { slot: 'corporate', src: '/wallpro/landing-corporate.webp', poster: '', title: 'Corporate', caption: 'Offices & workspaces', alt: 'Illustrative office reception with a wood-effect feature wall', enabled: true } },
  { key: 'retail', label: 'Retail example', kind: 'image', ratio: '16:9', help: 'The Retail hero slide and thumbnail.', defaults: { slot: 'retail', src: '/wallpro/landing-retail.webp', poster: '', title: 'Retail', caption: 'Stores & showrooms', alt: 'Illustrative eyewear store with a photographic wall wrap', enabled: true } },
  { key: 'before', label: 'Workflow / before photo', kind: 'image', ratio: '4:3', help: 'The photo shown in Upload and Mark in the five-step workflow.', defaults: { slot: 'before', src: '/wallpro/proof-spa-before.jpg', poster: '', title: 'Your starting point', caption: '', alt: 'The room before adding the wall wrap', enabled: true } },
  { key: 'process', label: 'Horizontal design / printing video', kind: 'video', ratio: '16:9', help: 'Show designing, scaling, production files, or the wrap printing. Recommended: 1920 × 1080.', defaults: { slot: 'process', src: '', poster: '/wallpro/proof-spa-after.jpg', title: 'A real home spa. Designed in WallPro.', caption: 'Follow the project from a room photo to a custom wall design, measured artwork, and production-ready files.', alt: 'Home spa wall design', enabled: true } },
  { key: 'install', label: 'Vertical final-install reel', kind: 'video', ratio: '9:16', help: 'Show the installation and the finished wall. Recommended: 1080 × 1920. The full video stays visible without cropping.', defaults: { slot: 'install', src: '', poster: '/wallpro/proof-spa-after.jpg', title: 'The final reveal.', caption: 'From a design on screen to a wall you can walk into.', alt: 'Botanical home spa wall design', enabled: true } },
];

export function validLandingUrl(value: string): boolean {
  if (!value) return true;
  if (/^\/wallpro\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..')) return true;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}

export function resolveLandingMedia(rows: LandingMedia[] = []): Record<LandingSlotKey, LandingMedia> {
  return Object.fromEntries(LANDING_SLOTS.map(slot => {
    const row = rows.find(r => r.slot === slot.key);
    return [slot.key, row && validLandingUrl(row.src) && validLandingUrl(row.poster) ? { ...slot.defaults, ...row } : { ...slot.defaults }];
  })) as Record<LandingSlotKey, LandingMedia>;
}

export function validateLandingMedia(value: LandingMedia): string | null {
  const slot = LANDING_SLOTS.find(s => s.key === value.slot);
  if (!slot) return 'Unknown media space.';
  if (!validLandingUrl(value.src) || !validLandingUrl(value.poster)) return 'Use a secure HTTPS media URL, or upload a file.';
  if (!value.title.trim()) return 'Add a title.';
  if (value.enabled && slot.kind === 'image' && !value.src) return 'Choose an image or hide this space.';
  if (value.enabled && (slot.kind === 'image' || value.poster) && !value.alt.trim()) return 'Add a short image description.';
  return null;
}
