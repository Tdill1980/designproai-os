/**
 * THE GLASS THE WALL EDITOR DRAWS WITH — one definition, every surface.
 *
 * Owner, 2026-09-16: "I need to also show the geometry on the FAQ page where it
 * shows the glass morphism on the corners."
 *
 * The moment a second page draws that geometry, the colours have two homes, and
 * a page whose whole job is to show the customer what the tool looks like is the
 * worst possible place for a stale copy: it would be teaching them to look for a
 * violet handle that the editor now paints blue. This repository has paid that
 * bill before — the print card that said 51" while the press said 53" — and the
 * case-study page exists precisely because computed beats screenshotted.
 *
 * So the values live here and BOTH renderers read them: WallPhotoEditor, which
 * is the real interactive surface, and WallProFaq, which explains it.
 *
 * ── WHY TWO COLOUR FAMILIES, AND WHY THEY MUST STAY APART ──────────────────
 *
 * The two overlays mean opposite things and a customer has to tell them apart
 * at a glance, on a photograph, on a phone:
 *
 *   WALL AREA (violet)     the region that WILL be painted with the design.
 *                          Four corners, dragged. Faint fill: the wall
 *                          underneath has to stay readable while it is marked.
 *
 *   PROTECTED (cyan)       a region that will NOT be painted — a window, a
 *                          radiator, a sofa. Brighter, with a halo and a
 *                          numbered chip, because it is an exception the
 *                          customer added deliberately and must be able to find
 *                          again to delete.
 *
 * Do not "harmonise" them into one palette. The contrast between them is the
 * information.
 *
 * The gradient ids are global to the document; they are unchanged from the
 * editor's originals so nothing that references them by name breaks.
 */

/** Every colour the wall overlays draw with. Hex only — SVG attributes, not classes. */
export const WALL_GLASS = {
  /** The wall area: the region the design lands on. */
  area: {
    /** The quad's outline. */
    stroke: '#8b5cf6',
    /** The draggable corner handle. */
    handle: '#7c3aed',
    /** The 1–4 numeral beside each handle. */
    label: '#6d28d9',
    gradientId: 'wall-area-glass',
    from: '#ddd6fe',
    to: '#8b5cf6',
  },
  /** A protected region: masked out of the preview, never out of the print. */
  protected: {
    stroke: '#22d3ee',
    /** The blurred outer glow that makes a mask findable over a busy photo. */
    halo: '#00dcff',
    /** The "Protected n" chip. */
    chip: '#0e7490',
    /** A mask's own editable vertex. */
    vertex: '#0891b2',
    gradientId: 'wall-protected-glass',
    haloFilterId: 'wall-mask-halo',
    from: '#b9f6ff',
    mid: '#38bdf8',
    to: '#0e7490',
  },
  /** Where two printed panels meet, drawn on the preview only. */
  seam: '#06b6d4',
} as const;

/**
 * The gradients and the halo filter, as an SVG `<defs>`.
 *
 * Rendered by every surface that draws wall geometry. Two surfaces rendering it
 * into one document is harmless: the definitions are identical by construction,
 * because they are this one function.
 */
export function WallGlassDefs() {
  const { area, protected: shield } = WALL_GLASS;
  return (
    <defs>
      <linearGradient id={shield.gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={shield.from} stopOpacity=".4" />
        <stop offset=".45" stopColor={shield.mid} stopOpacity=".13" />
        <stop offset="1" stopColor={shield.to} stopOpacity=".28" />
      </linearGradient>
      <linearGradient id={area.gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={area.from} stopOpacity=".22" />
        <stop offset="1" stopColor={area.to} stopOpacity=".07" />
      </linearGradient>
      <filter id={shield.haloFilterId} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation=".35" />
      </filter>
    </defs>
  );
}

/** `url(#wall-area-glass)` — the fill string, so no call site retypes the id. */
export const WALL_AREA_FILL = `url(#${WALL_GLASS.area.gradientId})`;
export const WALL_PROTECTED_FILL = `url(#${WALL_GLASS.protected.gradientId})`;
export const WALL_HALO_FILTER = `url(#${WALL_GLASS.protected.haloFilterId})`;
