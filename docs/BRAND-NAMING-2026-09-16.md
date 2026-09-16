# Customer-facing naming and positioning (owner ruling, Trish 2026-09-16)

This is a BRAND / UI COPY change. No design engine, Atlas logic, production
pipeline, database schema, API, authentication, file-generation logic or
existing project data changed to accommodate it.

## The hierarchy the customer reads

```
DESIGNPROAI
Prompt-Based Design + Production-Ready File Output

  VehiclePro   Vehicle graphics
  WallPro      Wall and environmental graphics
  CutPro       Cut graphics

Powered by Atlas
```

- **DesignProAI** is the master product and operating system. It is in the
  persistent header on every page, with the positioning line under it. Hero:
  *The Design-to-Production OS Built for Wide Format.* It is never positioned
  as an AI image generator or as a single design tool.
- **VehiclePro** is the vehicle-graphics environment. It was the tool that
  read "DesignPro / Vehicle Wrap Design System" under a header that also read
  "Vehicle Wrap Design System" (owner: *"its a double name, we need this tool
  called VehiclePro"*). "VehicleWrapPro" is not used in new customer-facing UI.
- **WallPro** keeps its name; its DesignProAI-side tagline is now the
  hierarchy line. The WePrintWraps partner page keeps its own words.
- **CutPro** replaces "GraphicsPro" everywhere a customer reads it.
- **Atlas** is not a fourth product. Wherever the customer used to see
  "A.T.L.A.S. graph active" they now see "Powered by Atlas" and, where there is
  room, "The intelligence layer behind DesignProAI."

## Where the words live

`app/src/lib/os-brand.ts` is the single source: names, wordmark splits,
taglines, descriptions, the Atlas lines, the active-tool resolver the header
uses, and the compatibility aliases. Every surface below reads from it or
states the same string.

| surface | what changed |
|---|---|
| `components/Header.tsx` | lockup subtitle → OS positioning line; the "DesignPro™" quick link → VehiclePro · WallPro · CutPro; an active-tool strip names the tool BENEATH the DesignProAI lockup inside a tool |
| `hooks/useHeaderHeight.ts`, `components/layout/AppSidebar.tsx` | the fixed sidebar's top follows the measured header height (the strip adds a row inside a tool); the mobile drawer title is the DesignProAI wordmark instead of the raw `restylepro` key |
| `lib/dashboard-nav.ts` | labels/descriptions from os-brand; order VehiclePro, WallPro, CutPro, PatternPro, RevisionStudioIQ, Gallery |
| `components/dashboard/ToolWordmark.tsx` | `designpro` → Vehicle/Pro, `graphicspro` → Cut/Pro, new `designproai` entry |
| `components/layout/AppBottomTabs.tsx`, `DesktopToolNav.tsx`, `MobileToolNav.tsx` | "Design" / "DesignProAI™" rail entries → VehiclePro |
| `pages/DesignPanelProPremium.tsx` | left panel wordmark + subtitle → VehiclePro + tagline; page title; "Powered by Atlas" |
| `pages/DesignProAIHome.tsx` | hero → VehiclePro + tagline + description; "Powered by Atlas" |
| `pages/GraphicsProV1.tsx`, `GraphicsProWall.tsx`, `GraphicsProWindow.tsx` | headings, taglines and titles → CutPro |
| `components/FAQ.tsx`, `graphicspro-v1/SurfaceSelection.tsx`, `PricingTiersSection.tsx`, `SubscriptionGate.tsx`, `data/faqData.ts`, `lib/tool-registry.ts` | rendered "GraphicsPro" → "CutPro" (proof sheets and PDFs read the registry label) |
| `lib/wallpro-brand.ts` | DesignProAI-side WallPro tagline → hierarchy line |
| `app/index.html`, `pages/Index.tsx`, `Login.tsx`, `Signup.tsx` | titles, meta and hero → OS positioning; the landing FAQ's "What is DesignProAI?" |
| `App.tsx` | alias redirects (below) |

## Legacy identifiers retained (deliberately)

These are read by routes, tier gates, analytics, stored rows, storage paths,
edge functions or deployed configuration. Renaming them buys nothing the
customer can see and risks everything they can open.

- Navigation / access keys: `designpro`, `graphicspro`, `wallpro`
  (`dashboard-nav.ts`, `useToolAccess.ts`, `ToolWordmark.tsx`).
- Routes: `/designpro/create` and the rest of `/designpro/*`, `/graphics-pro`,
  `/graphics-pro-wall`, `/graphics-pro-window`, `/graphicspro` (redirect),
  `/printpro/wallpro`, `/wallpro` (redirect).
- Storage bucket `graphicspro-files`; edge functions
  `generate-graphics-pro`, `graphicspro-on-vehicle-photo`; migration
  `20260911210000_graphicspro_cut_contour.sql`; the `homepage_showcase` row
  `section:graphicspro-hero`.
- Logic keys that select behaviour, not words: `<FAQ productName="GraphicsPro">`
  (picks the cut tool's FAQ set), `toolSource === "GraphicsPro"` in
  MyVehiclePro (picks the edge function and the mockup contract), the
  `graphicspro` key in `tool-registry.ts` (stored proofs are keyed by it; only
  its label changed), `queryKey: ["graphicspro_hero"]`.
- Component, hook, page and file names (`GraphicsProV1ToolUI`,
  `useGraphicsProV1Logic`, `DesignPanelProPremium.tsx`, `DesignProAIHome.tsx`).
- The A.T.L.A.S. engineering vocabulary in the runtime, gateway, tests, admin
  and QC surfaces, and in `CLAUDE.md`. Those are operator and engineering
  surfaces, and the Atlas rules in this repository are written in that name.
- Marketing-data and admin files that still say "VehicleWrapPro" or
  "GraphicsPro" (`data/wpwOfferCampaign.ts`, `data/faqPricing.ts`,
  `lib/content-tags.ts`, `lib/mightymail-*.ts`, `pages/Admin*.tsx`): they are
  content tags, campaign copy for a retired offer, or admin tooling, not the
  customer path. Renaming a content tag re-keys stored rows.

## Compatibility aliases added

`OS_TOOL_ALIASES` in `os-brand.ts`, mounted in `App.tsx`:

| alias | resolves to |
|---|---|
| `/vehiclepro`, `/vehicle-pro` | `/designpro/create` |
| `/cutpro`, `/cut-pro` | `/graphics-pro` |
| `/cut-pro-wall` | `/graphics-pro-wall` |
| `/cut-pro-window` | `/graphics-pro-window` |

Nothing redirects OUT of a legacy route; existing links, bookmarks, emails and
stored project references keep resolving.

## Locks

`tests/os-brand-naming.test.mjs` asserts the hierarchy strings, the header
contract, the nav labels on the legacy keys, the absence of the retired names
on customer surfaces, the Atlas line, and that every retained identifier is
still in place. `tests/atlas-fail-fast.test.mjs` was updated to expect
"Powered by Atlas" on the customer page.
