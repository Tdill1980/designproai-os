export type BrandBoardShowUiAction =
  | "behind_the_install"
  | "behind_the_brand"
  | "wpw_content";

export interface BrandBoardShowUiOutput {
  key: "longform" | "reel";
  label: string;
  aspect: "16:9" | "9:16";
}

export interface BrandBoardShowUiSpec {
  action: BrandBoardShowUiAction;
  brand: "wraptvworld" | "weprintwraps";
  label: string;
  showFormat: "behind_the_install" | "behind_the_brand" | null;
  angle: string;
  outputs: readonly BrandBoardShowUiOutput[];
}

/**
 * Display copy for the three real BrandBoard production actions.
 *
 * This is deliberately a CLOSED table. An unknown/aliased brand gets no
 * action instead of inheriting another brand's renderer. The production
 * helper validates the same fields again against the render job before it
 * queues anything; this table only controls what the operator can see.
 */
export const BRAND_BOARD_SHOW_UI: Record<BrandBoardShowUiAction, BrandBoardShowUiSpec> = {
  behind_the_install: {
    action: "behind_the_install",
    brand: "wraptvworld",
    label: "Behind the Install",
    showFormat: "behind_the_install",
    angle: "music-led install story",
    outputs: [
      { key: "longform", label: "Longform", aspect: "16:9" },
      { key: "reel", label: "Reel / Short", aspect: "9:16" },
    ],
  },
  behind_the_brand: {
    action: "behind_the_brand",
    brand: "wraptvworld",
    label: "Behind the Brand",
    showFormat: "behind_the_brand",
    angle: "documentary-style brand story",
    outputs: [
      { key: "longform", label: "Longform", aspect: "16:9" },
      { key: "reel", label: "Reel / Short", aspect: "9:16" },
    ],
  },
  wpw_content: {
    action: "wpw_content",
    brand: "weprintwraps",
    label: "WPW Content",
    // WPW Content is a brand-locked production lane, not a SHOW_FORMATS key.
    showFormat: null,
    angle: "WePrintWraps product-and-shop content",
    outputs: [
      { key: "longform", label: "Video", aspect: "16:9" },
      { key: "reel", label: "Reel / Short", aspect: "9:16" },
    ],
  },
};

const ACTIONS_BY_BRAND: Record<string, readonly BrandBoardShowUiAction[]> = {
  wraptvworld: ["behind_the_install", "behind_the_brand"],
  weprintwraps: ["wpw_content"],
};

/** Exact canonical brand only. Never fall back to a site or neighbouring brand. */
export function showActionsForBrand(brand: string | null | undefined): readonly BrandBoardShowUiAction[] {
  return ACTIONS_BY_BRAND[String(brand || "")] || [];
}

export function normalizedInstallerCredit(handle: string, location: string): {
  handle: string;
  location: string;
} {
  return { handle: handle.trim(), location: location.trim() };
}

/**
 * Human-entered credit validation. Presence/shape is all a browser can prove;
 * the UI explicitly asks for the real account and never manufactures one.
 */
export function installerCreditIssue(handle: string, location: string): string | null {
  const credit = normalizedInstallerCredit(handle, location);
  if (!credit.handle && !credit.location) {
    return "Add the featured installer/shop @Instagram handle and location.";
  }
  if (!credit.handle) return "Add the featured installer/shop @Instagram handle.";
  if (!credit.handle.startsWith("@")) return "Instagram handle must start with @.";
  if (!/^@[A-Za-z0-9._]{1,30}$/.test(credit.handle)) {
    return "Use one Instagram handle with no spaces (letters, numbers, periods, or underscores).";
  }
  if (!credit.location) return "Add the shop location: city + state, or country.";
  return null;
}

export function musicTrackIssue(value: string): string | null {
  const track = value.trim();
  // Blank means "use the next original song in the rotation". The database
  // ledger chooses and reserves it only when the output is queued.
  if (!track) return null;
  try {
    const url = new URL(track);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    return "Music track must be a valid http(s) URL.";
  }
  return null;
}

/** Human-entered display title for the BTI moving ticker. Never infer it from a URL. */
export function musicTitleIssue(value: string): string | null {
  return value.trim() ? null : "Add the real song title for the ticker.";
}

/** Blank+blank is automatic rotation; either human override field needs both. */
export function musicOverrideIssue(title: string, url: string): string | null {
  const cleanTitle = title.trim();
  const cleanUrl = url.trim();
  if (!cleanTitle && !cleanUrl) return null;
  if (!cleanTitle) return musicTitleIssue(title);
  if (!cleanUrl) return "Add the selected song's real track URL.";
  return musicTrackIssue(url);
}
