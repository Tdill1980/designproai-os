# Field recovery v2 (`field-thirds-v2`) — the plan, written BEFORE any provider call

Harness only. No production code change, no deploy, no blocking gate. This file is produced by the harness itself from the exact request it would send, so every string and number below is the one the model receives.

## 1. Exact model-facing parts

| index | kind | size | sha256 |
|---|---|---|---|
| 0 | text | 4052 chars | `37e4137e8ae8c8bb` |

1 part(s), 0 image(s) (0 verified customer reference(s)), 4294 request bytes. Model `gemini-3-pro-image`, `{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"1:1","imageSize":"4K"}}`, no temperature field. **No guide image, no teaching sheet, no labels, no topology text, no surface list.**

## 2. Exact creative prompt

Deployed prompt reproduced first: sha `dcb73e9eae229cd8`, 4587 chars. Creative assembly 2622 → 2698 chars via 7 exact-match swaps, reverse proof true. Tail 1354 chars (ceiling 1400). Full prompt 4052 chars, sha `37e4137e8ae8c8bb`. The complete text is `prompt-field-v2.txt`; the swaps are `swaps.json`.

```text
You are the senior vehicle-wrap designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph. This is the single design authority for the complete vehicle — one design, one composition. The design is built from layered elements — background color and texture flowing continuously across the whole field, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare vinyl. The company name reads clearly at a glance; how the branding is composed is your creative call.

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance.
Brand colors: deep blue, sunrise orange.
Style direction: modern commercial."
Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment ("stealth bomber" becomes angular faceted plates with sharp swept edges). What the client named should be obvious at a glance.

CLIENT BRIEF:
Identify the business name from the creative direction above. Spell it exactly as written in the brief. This business needs its own logo — decide its form from this brief alone.
No phone number was provided — show the company name only and add no contact information.
No website was supplied — invent no website, email address or street address, and display none anywhere on the design.
Industry: HVAC and climate control

When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.
Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements. The vinyl finish is gloss across the whole field — one consistent finish throughout.
The artwork fills the entire field edge to edge — solid printed vinyl, corner to corner.

OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.
Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact 2022 Ford F250 Crew Cab (truck) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.

Compose it in three equal horizontal thirds that read as one picture:
• THE UPPER THIRD — the primary hero passage: a complete, wide statement of the design, the company name whole and legible inside it, clear of the third's top and bottom edges. Forward energy sweeps left to right.
• THE MIDDLE THIRD — a second hero passage telling the brand story in full, composed afresh as its own arrangement, the company name whole and legible inside it too. Forward energy sweeps right to left.
• THE LOWER THIRD — the supporting register: the same ground, palette and motion at a calmer intensity, secondary motifs, finished artwork everywhere. The brand mark may appear here once, compact and whole; every other letter lives in the upper two thirds.

Lettering reads left to right throughout. Each focal element sits inside one third; the ground and its motion flow through all three continuously, so the transitions are invisible. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.
```

## 3. Source canvas

4096×4096 px, aspect 1:1, requested as `imageSize: "4K"`. Unchanged from every measured draw so far (20+ draws delivered exactly 4096×4096); it is the one canvas `normalizeAtlasMaster` accepts without resampling. A portrait 4:5 canvas would waste less of the field (a third of it is 2.4:1, close to the flank's 2.47:1) — recorded as a later single variable, not pulled here.

## 4. Code-only six-territory map (the model never sees this)

Contract `designpro.atlas-field-territories.v2`, topology `field-thirds-v2`, GENIE manifest `879291d3a9120666dda28205807fdee7e6cce8e7caabf116aa7b4b078327008b` (measured). Thirds: third 1 y 0–1365 (1365px) = driver · third 2 y 1365–2730 (1365px) = passenger · third 3 y 2730–4096 (1366px) = roof/hood/front/rear. Rear sits under the front. Centre scale 12.65 px/in.

| surface | placement | territory (x, y, w, h) | trim (x, y, w, h) | trim in | print in (+5″ bleed) | native px/in |
|---|---|---|---|---|---|---|
| driver | third-1 | (362, 0, 3371, 1365) | (465, 103, 3165, 1159) | 153×56 | 163×66 | 20.68 |
| passenger | third-2 | (362, 1365, 3371, 1365) | (465, 1468, 3165, 1159) | 153×56 | 163×66 | 20.68 |
| hood | third-3-row-1 | (1186, 2730, 1031, 835) | (1249, 2793, 905, 709) | 71.5×56 | 81.5×66 | 12.65 |
| roof | third-3-row-1 | (120, 2730, 1066, 820) | (183, 2793, 940, 694) | 74.3×54.8 | 84.3×64.8 | 12.65 |
| front | third-3-row-1 | (2217, 2730, 1758, 557) | (2280, 2793, 1632, 431) | 129×34 | 139×44 | 12.65 |
| rear | third-3-row-2 | (2217, 3287, 1088, 809) | (2280, 3350, 962, 683) | 76×54 | 86×64 | 12.64 |

Extracted 76.3% of the canvas; painted-not-extracted 23.7% (discarded by the zone mask — a resolution cost, not a defect). Inches, square feet and bleed are lifted from the production `buildAtlasManifest` zones (legacy topology `rectangular-preview-v1`), never re-derived.

## 5. How Driver and Passenger remain distinct

- Two different territories on the field: Driver is the whole upper third, Passenger the whole middle third. Each file is a `sharp.extract` of its own pixels; nothing is flipped, copied or mirrored anywhere in the path.
- The composition brief asks for two hero passages composed afresh, with opposite forward sweep (Driver left→right, Passenger right→left, from the code-owned nose edges), lettering left-to-right in both.
- Recorded, not gated: `passengerMirrorMae` from the production checks (v1 measured 0.091 — distinct bytes) and the two files' distinct sha256.

## 6. How commercial hierarchy and hero imagery survive deterministic serialization

- **Flanks, by construction.** The Driver territory IS the upper third and the Passenger territory IS the middle third, and the brief puts a complete hero passage with the company name whole inside each third, clear of its top and bottom edges. A name inside the third is inside the file; the trim inset (5″) is inside the territory, so it also survives the print trim.
- **Centre four, by continuation.** Hood, roof, front and rear are crops of the lower third — the supporting register of the SAME ground, palette and motion. They are usable continuous artwork, not intentionally composed statements. This is the honest weak point carried over from v1 and the first thing to judge on Draw 1.
- **Brand mark on the centre surfaces is NOT guaranteed here.** The brief allows the mark once in the lower third; whether it lands inside one territory is a Draw-1 measurement. Placing marks where the OS wants them without showing the model the territories is the deterministic logo-placement step the proven RestylePro path owned (lifted logo asset placed per surface by code, RULE 0.25 Call 10). That is a separate, later owner decision; it is not simulated in this harness.
- **Recorded per file (record only):** one `gemini-2.5-flash` question per file at temperature 0 — is the company name complete / partial / absent, is a brand mark complete / partial / absent, is anything sliced by the file edge — bound to each file's own sha256. Six inspections. The owner's eye on `contact-sheet.png` decides; the record never overrules it.

## 7. Exact deterministic extraction path (production code, unchanged)

1. `runtime/flat-first-atlas.cjs` → `normalizeAtlasMaster(rawBytes, fieldManifest)`: refuses a non-square return (±8%), resizes the delivered image to 4096×4096 (`fit: fill`, lanczos3), then masks everything outside the six territories to transparent (`activeZoneMaskSvg`, `dest-in`). Delivered size is recorded (`nativelyFourK`).
2. `cutCallOnePanels(masterBytes, fieldManifest, masterHash)`: for each surface in `PANEL_EXTRACTION_ORDER` (driver, passenger, hood, front, rear, roof), `sharp.extract({left: x, top: y, width: w, height: h})` on the territory, `rotate(0)`, flatten to white, sRGB, PNG. Each file carries its own sha256, `sourceMasterHash` = the master hash, `method: deterministic_atlas_crop`, `deterministic: true`, the GENIE manifest hash, trim/print inches and `effectivePpi`.
3. No AI, no fill, no mirror, no crop chosen by content. The harness then measures colour-blind full-bleed on bleed and trim rects, continuity across territory borders, the legacy near-black gate and the output class — all record only.

## 8. Expected native PPI of all six files

| surface | file px | print in | native px/in |
|---|---|---|---|
| driver | 3371×1365 | 163×66 | 20.68 |
| passenger | 3371×1365 | 163×66 | 20.68 |
| hood | 1031×835 | 81.5×66 | 12.65 |
| roof | 1066×820 | 84.3×64.8 | 12.65 |
| front | 1758×557 | 139×44 | 12.65 |
| rear | 1088×809 | 86×64 | 12.64 |

Minimum 12.64 px/in (v1 field-bands: flanks 22.34, centre 8.81; production six-region: driver 17.47). No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.

## STOP

Capture-only makes zero provider calls. The one draw runs only after the owner approves this plan; no second draw until the owner reviews Draw 1.
