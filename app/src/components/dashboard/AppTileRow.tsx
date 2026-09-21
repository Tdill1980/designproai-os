/**
 * THE TACTILE APP TILES — a name in a rectangle, the work at the end.
 *
 * Owner, 2026-09-16, pointing at the WePrintWraps homepage: "see how wpw has
 * tactile button for cars on this ... except obviously I need the app name in a
 * rectangle button with car at end", with the wrapped Raptor for PatternPro and
 * the gym wall for WallPro.
 *
 * ── WHAT THE WPW TILE ACTUALLY DOES, AND WHY IT WORKS ──────────────────────
 *
 * Each WPW tile is a hard SPLIT: a solid black panel carrying the product name
 * in flat caps, butted straight against a photograph of the finished job. No
 * rounded corner between them, no gradient, no overlap. That hard edge is the
 * whole effect — it reads as a physical label stuck to a print, which is why it
 * feels tactile where a photo with text floated over it feels like a banner.
 *
 * So this is not "a card with an image". The rules, each load-bearing:
 *
 *   the name is on the BLACK, never over the photo    a name over a photograph
 *                                                     needs a scrim, and a scrim
 *                                                     is what makes it a banner
 *   the split is a straight vertical edge             no radius, no feather
 *   the photo is CROPPED, not fitted                  a whole vehicle floating on
 *                                                     white is a product shot; a
 *                                                     crop is a texture
 *   one line of promise under the name                what the app does, in the
 *                                                     owner's words, not a pitch
 *
 * ── WHY A COMPONENT, AND WHY THE TILES ARE DATA ────────────────────────────
 *
 * The next app gets a tile by adding a row to APP_TILES. That is the same shape
 * WALL_BRANDS and the GraphicsPro header already use in this codebase, and it
 * is what stops the fourth tile being a copy of the third with two words
 * changed.
 *
 * ── THE IMAGES ─────────────────────────────────────────────────────────────
 *
 * PatternPro's is the owner's own render — Chameleon Camo Tan on a 2022 Raptor
 * — already served through the storage image transform for the PatternPro hero,
 * so the tile costs no new asset and cannot show a pattern the product cannot
 * make.
 *
 * WallPro's is the gym wall from the proof band. ONE WRINKLE, stated because it
 * drives the crop: that file has "Designed with WallPro" callout badges baked
 * into its pixels, roughly centred. `objectPosition` pushes the crop to the
 * right of the frame, onto the mural itself, which is both the better picture
 * and the one without a caption printed on it. Drop a clean export at the same
 * path and the crop simply gets better.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export type AppTile = {
  /** The app, as it is spelled everywhere else in the product. */
  name: string;
  /** What it does — one line, no adjectives that could describe any tool. */
  promise: string;
  href: string;
  /** The finished work, cropped. */
  image: string;
  alt: string;
  /**
   * Which part of the photograph survives the crop. CSS `object-position`.
   * It exists because a tile is a shallow strip and the centre of a photograph
   * is rarely the part worth showing.
   */
  objectPosition?: string;
};

export const APP_TILES: AppTile[] = [
  {
    name: 'WallPro',
    promise: 'Wall wraps, designed and panelised to your wall',
    href: '/printpro/wallpro',
    image: '/wallpro/landing-corporate.webp',
    // Hard right: the mural and the lettering, clear of the baked-in callouts.
    objectPosition: '85% 35%',
    alt: 'A gym training wall covered in a full-height athletic mural',
  },
  {
    name: 'PatternPro',
    promise: 'Pick a pattern, see it on any vehicle, order it by the yard',
    href: '/printpro/patternpro',
    // The owner's own render, through the same storage transform the PatternPro
    // hero uses — so a 9 MB original never ships to a phone.
    image: 'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/render/image/public/wrap-files/renders/anonymous/patternpro/1789445607140_Ford_Raptor_side.jpg?width=900&height=560&resize=cover&quality=78',
    // The vehicle sits centred on white with air above and below; pulling the
    // crop down puts the body across the strip instead of the empty sky.
    objectPosition: '55% 60%',
    alt: 'A Ford Raptor wrapped in the Chameleon Camo Tan pattern',
  },
  {
    name: 'GraphicsPro',
    promise: 'Cut-contour graphics for vehicles, walls and storefronts',
    href: '/graphics-pro',
    // The timber-slat frames this tile used were the OWNER'S OWN HOME, and she
    // asked twice for her house off the product surfaces; 6cbfc5ff took the pair
    // out of the WallPro proof band and the files are now deleted with it. This
    // component is not currently mounted by anything, so nothing on screen
    // changed -- but a dead reference to a deleted file is a broken image
    // waiting for whoever mounts it, so it points at a WallPro install that
    // still ships.
    image: '/wallpro/landing-corporate.webp',
    objectPosition: '50% 50%',
    alt: 'A gym wall finished in a full-wall printed graphic',
  },
];

function Tile({ tile }: { tile: AppTile }) {
  return (
    <Link
      to={tile.href}
      className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-xl border border-white/10 bg-black transition hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
    >
      {/* THE LABEL PANEL. Solid black, flat caps, and the name is on the panel
          rather than over the photograph — see the header for why that is the
          difference between a tile and a banner. */}
      <div className="flex min-h-[116px] flex-col justify-between p-4">
        <div>
          <p className="text-lg font-extrabold uppercase leading-[1.05] tracking-tight text-white sm:text-xl">
            {tile.name}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-white/70">{tile.promise}</p>
        </div>
        <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-white/80 transition group-hover:text-white">
          Open
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
      </div>
      {/* THE WORK. Cropped hard against the label with no radius and no gap:
          the straight butt edge is what makes the pair read as one object. */}
      <img
        src={tile.image}
        alt={tile.alt}
        loading="lazy"
        className="h-full w-full object-cover"
        style={{ objectPosition: tile.objectPosition }}
      />
    </Link>
  );
}

/**
 * The row. Three across on a wide screen, one per row on a phone — a tile whose
 * label column is narrower than its own wordmark is worse than a stacked list.
 */
export function AppTileRow({ tiles = APP_TILES }: { tiles?: AppTile[] } = {}) {
  if (!tiles.length) return null;
  return (
    <section aria-label="Design apps" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map(tile => <Tile key={tile.name} tile={tile} />)}
    </section>
  );
}
