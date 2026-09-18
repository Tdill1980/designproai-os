/**
 * FadeWraps product specification shared by BOTH PatternPro surfaces.
 *
 * Commerce authority: WePrintWraps WooCommerce product 58391.
 * Rendering authority: PatternPro's proven generate-pattern-render + 7-view proof graph.
 *
 * Do not import the legacy FadeWrap renderer here. FadeWraps is a product mode
 * inside PatternPro; the same configuration must drive /pattern-wrap and
 * /printpro/patternpro so the two surfaces cannot drift.
 */
export const WPW_FADEWRAPS_WOO_PRODUCT_ID = 58391;

export const WPW_FADEWRAP_COLORS = [
  { key: "beige", name: "Beige", hex: "#D8C3A5" },
  { key: "blue", name: "Blue", hex: "#0066FF" },
  { key: "green", name: "Green", hex: "#00A651" },
  { key: "light-blue", name: "Light Blue", hex: "#58B9FF" },
  { key: "lime", name: "Lime", hex: "#CCFF00" },
  { key: "orange", name: "Orange", hex: "#FF6600" },
  { key: "pink", name: "Pink", hex: "#FF4FA3" },
  { key: "purple", name: "Purple", hex: "#8B00FF" },
  { key: "red", name: "Red", hex: "#E10600" },
  { key: "yellow", name: "Yellow", hex: "#FFD400" },
] as const;

export type FadeWrapColorKey = typeof WPW_FADEWRAP_COLORS[number]["key"] | "custom";

export const WPW_FADEWRAP_SIDES = {
  small: { label: "Small", widthIn: 144, heightIn: 59.5, price: 600 },
  medium: { label: "Medium", widthIn: 180, heightIn: 59.5, price: 710 },
  large: { label: "Large", widthIn: 216, heightIn: 59.5, price: 825 },
  xl: { label: "XL", widthIn: 252, heightIn: 59.5, price: 990 },
} as const;

export const WPW_FADEWRAP_ADDONS = {
  hood: { label: "Hood", widthIn: 72, heightIn: 59.5, price: 160 },
  frontBumper: { label: "Front Bumper", widthIn: 120.5, heightIn: 38, price: 200 },
  rear: {
    label: "Rear Including Bumper",
    price: 395,
    panels: [
      { label: "Rear Hatch / Trunk", widthIn: 72, heightIn: 59 },
      { label: "Rear Bumper", widthIn: 120, heightIn: 38 },
    ],
  },
} as const;

export const WPW_FADEWRAP_ROOFS = {
  none: { label: "No Roof", price: 0, widthIn: 0, heightIn: 0 },
  small: { label: "Small Roof", price: 160, widthIn: 72, heightIn: 59.5 },
  medium: { label: "Medium Roof", price: 225, widthIn: 110, heightIn: 59.5 },
  large: { label: "Large Roof", price: 330, widthIn: 160, heightIn: 59.5 },
} as const;

export type FadeWrapSideSize = keyof typeof WPW_FADEWRAP_SIDES;
export type FadeWrapRoofSize = keyof typeof WPW_FADEWRAP_ROOFS;
export type FadeWrapFinish = "gloss" | "satin" | "matte";

export interface PatternProFadeWrapConfig {
  colorKey: FadeWrapColorKey;
  /** Required when colorKey === custom. Six-digit CSS hex. */
  customHex?: string;
  sideSize: FadeWrapSideSize;
  hood: boolean;
  frontBumper: boolean;
  rear: boolean;
  roofSize: FadeWrapRoofSize;
  finish: FadeWrapFinish;
}

export function fadeWrapHex(config: Pick<PatternProFadeWrapConfig, "colorKey" | "customHex">): string {
  if (config.colorKey === "custom") {
    if (!config.customHex || !/^#[0-9a-f]{6}$/i.test(config.customHex)) {
      throw new Error("Choose a custom FadeWrap color before generating.");
    }
    return config.customHex.toUpperCase();
  }
  const color = WPW_FADEWRAP_COLORS.find((c) => c.key === config.colorKey);
  if (!color) throw new Error("Unknown FadeWrap color.");
  return color.hex;
}

export function fadeWrapTotal(config: PatternProFadeWrapConfig): number {
  let total = WPW_FADEWRAP_SIDES[config.sideSize].price;
  if (config.hood) total += WPW_FADEWRAP_ADDONS.hood.price;
  if (config.frontBumper) total += WPW_FADEWRAP_ADDONS.frontBumper.price;
  if (config.rear) total += WPW_FADEWRAP_ADDONS.rear.price;
  total += WPW_FADEWRAP_ROOFS[config.roofSize].price;
  return total;
}

/**
 * Customer-facing production explanation. These are rectangular printed
 * panels sized for the selected vehicle areas; they are not pre-cut vehicle
 * template pieces.
 */
export const WPW_FADEWRAP_PRINT_NOTE =
  "Your FadeWrap is printed as rectangular install panels for the selected vehicle areas: two sides plus any Hood, Front Bumper, Rear Hatch/Trunk + Rear Bumper, and Roof options you add. Panels are not pre-cut to the vehicle outline; the installer positions and trims them during installation.";

export const DEFAULT_FADEWRAP_CONFIG: PatternProFadeWrapConfig = {
  colorKey: "purple",
  sideSize: "small",
  hood: false,
  frontBumper: false,
  rear: false,
  roofSize: "none",
  finish: "gloss",
};
