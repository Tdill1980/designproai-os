/**
 * THE THREE APPS, DEFINED ONCE (owner, 2026-09-18, on a phone before a
 * partner demo: "please just get WPW WallPro live on ShopFlow").
 *
 * WHY THIS CONSTANT EXISTS, MEASURED. The rail that carried these is
 * `hidden ... lg:flex` -- it only renders at desktop width. On a phone,
 * ShopFlow drew NO product navigation at all, so the two apps this dashboard
 * exists to open were unreachable from it. The links were correct the whole
 * time; there was simply nothing on screen to tap. That is why "the rail
 * points at the right route" kept reading as fixed while the owner, on her
 * phone, kept not finding WallPro.
 *
 * The desktop rail and the phone strip now read the SAME three rows. A second
 * list is how the WallPro href came to be wrong twice in opposite directions
 * (`/wallpro`, the DesignProAI landing; then `/wall-wrap`, which had just
 * BECOME a landing) -- one definition is the fix for that class, not just for
 * this instance.
 *
 * Every href opens an APP, never a marketing page: this customer is signed in
 * and already sold, and a landing page is a step backwards from where they
 * are standing. `/wallwrap-design` is the WePrintWraps WallPro TOOL and
 * `/pattern-wrap` is the real PatternPro tool under a white skin.
 *
 * Apps first, in the order a phone visitor wants them. Each thumbnail is a
 * REAL WePrintWraps image, never an illustration.
 */
export const SHOPFLOW_APPS = [
  {
    key: "wallpro" as const,
    href: "/wallwrap-design",
    label: "WallPro",
    blurb: "Design a wall, get print-ready panels",
    thumb: "/assets/commercialpro/wallpro-thumb.webp",
  },
  {
    key: "patternpro" as const,
    href: "/pattern-wrap",
    label: "PatternPro",
    blurb: "Pick a pattern, see it on any vehicle",
    thumb: "/assets/commercialpro/patternpro-thumb.webp",
  },
  {
    key: "commercialpro" as const,
    href: "https://weprintwraps.com/commercialpro/",
    label: "CommercialPro",
    blurb: "Fleet pricing and Pro perks",
    thumb: "/assets/commercialpro/commercialpro-thumb.webp",
    external: true,
  },
];
export const shopflowApp = (key: (typeof SHOPFLOW_APPS)[number]["key"]) => SHOPFLOW_APPS.find(a => a.key === key)!;
