/**
 * RETRACTED 2026-09-21 — the gym "after" frame is withdrawn from every slot.
 *
 * It was an AI-generated design in an athletic style, and the model wrote a
 * real company's trademark into the artwork (owner: "its supposed to be
 * inspired style of model wrote les mills than it needs retracting asap"). It
 * was the Commercial hero slide and the poster on both video slots, so it was
 * the most visible image on this page. Those three now point at
 * landing-corporate.webp, which is a clean commercial example already shipping
 * for the Corporate slide, and the copy that called it a training floor is
 * corrected with it.
 *
 * The gym BEFORE frame stays: it is a photograph of a bare grey wall and
 * carries no mark. Only the generated "after" is the problem.
 */
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
  { key: 'commercial', label: 'Commercial example', kind: 'image', ratio: '16:9', help: 'The Commercial hero slide and thumbnail.', defaults: { slot: 'commercial', src: '/wallpro/landing-corporate.webp', poster: '', title: 'Commercial', caption: 'Fitness & gyms', alt: 'A commercial interior with a full-height printed wall graphic', enabled: true } },
  { key: 'hospitality', label: 'Hospitality example', kind: 'image', ratio: '16:9', help: 'The Hospitality hero slide and thumbnail.', defaults: { slot: 'hospitality', src: '/wallpro/landing-hospitality.webp', poster: '', title: 'Hospitality', caption: 'Hotels & restaurants', alt: 'Illustrative hotel lounge with a floral wall wrap', enabled: true } },
  { key: 'corporate', label: 'Corporate example', kind: 'image', ratio: '16:9', help: 'The Corporate hero slide and thumbnail.', defaults: { slot: 'corporate', src: '/wallpro/landing-corporate.webp', poster: '', title: 'Corporate', caption: 'Offices & workspaces', alt: 'Illustrative office reception with a wood-effect feature wall', enabled: true } },
  { key: 'retail', label: 'Retail example', kind: 'image', ratio: '16:9', help: 'The Retail hero slide and thumbnail.', defaults: { slot: 'retail', src: '/wallpro/landing-retail.webp', poster: '', title: 'Retail', caption: 'Stores & showrooms', alt: 'Illustrative eyewear store with a photographic wall wrap', enabled: true } },
  /**
   * THE LANDING SHOWS THE COMMERCIAL ROOMS, NOT THE OWNER'S OWN (owner,
   * 2026-09-17: "it must be the other images the fitness, etc not my photo").
   *
   * Every default below pointed at `proof-spa-*` — the home spa Trish
   * photographed in her own house. That room is this product's measured scale
   * reference and the subject of the case study, both of which are evidence;
   * it is not what the landing page should be selling. The gym pair is the
   * same kind of asset (a real before AND a real after of one room, already
   * normalised to one canvas) so nothing here is a crop or a stand-in.
   *
   * These are DEFAULTS. The media admin still overrides any of them per row,
   * and the spa files are untouched on disk for the case study and the FAQ
   * figure that measures against them.
   */
  { key: 'before', label: 'Workflow / before photo', kind: 'image', ratio: '4:3', help: 'The photo shown in Upload and Mark in the five-step workflow.', defaults: { slot: 'before', src: '/wallpro/proof-gym-before.jpg', poster: '', title: 'Your starting point', caption: '', alt: 'A gym training floor with a plain grey wall behind the squat racks, before the wall wrap', enabled: true } },
  { key: 'process', label: 'Horizontal design / printing video', kind: 'video', ratio: '16:9', help: 'Show designing, scaling, production files, or the wrap printing. Recommended: 1920 × 1080.', defaults: { slot: 'process', src: '', poster: '/wallpro/landing-corporate.webp', title: 'A real commercial wall. Designed in WallPro.', caption: 'Follow the project from a room photo to a custom wall design, measured artwork, and production-ready files.', alt: 'A commercial interior with a full-height printed wall graphic', enabled: true } },
  { key: 'install', label: 'Vertical final-install reel', kind: 'video', ratio: '9:16', help: 'Show the installation and the finished wall. Recommended: 1080 × 1920. The full video stays visible without cropping.', defaults: { slot: 'install', src: '', poster: '/wallpro/landing-corporate.webp', title: 'The final reveal.', caption: 'From a design on screen to a wall you can walk into.', alt: 'A commercial interior with a full-height printed wall graphic', enabled: true } },
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
