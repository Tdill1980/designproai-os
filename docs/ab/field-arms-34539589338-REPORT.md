# Test 14 — three arms on the one-field Call 1 (12 draws)

Model `gemini-3-pro-image`, generationConfig `{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"1:1","imageSize":"4K"}}`. Territories `field-thirds-v2`.

| arm | what varies | parts | images | prompt chars | prompt sha |
|---|---|---|---|---|---|
| A | v3 field tail, no image (baseline) | 1 | 0 | 4146 | `4031400c2efdc1af` |
| B | v3 field tail + Houdini Huracán design layout as the only image (1320×784 jpg, sha aa5d811b529d) | 3 | 1 | 4146 | `4031400c2efdc1af` |
| C | v4 pressed-skin tail, no image | 1 | 0 | 4213 | `3ac13ce3701c3273` |

The creative assembly is byte-identical across all three arms (asserted before any call). Every column below is telemetry; the owner's eye on the raw masters and the cut Driver/Passenger panels decides.

| draw | arm | deterministic gates | output class | centre min-MAD | near-white | neutral grey | border ring std / near-median | raw sha | time |
|---|---|---|---|---|---|---|---|---|---|
| A1 | A | pass | flat_atlas — The image displays multiple rectangular regions filled with continuous spa-themed artwork, with no depiction of a vehicle or vehicle parts. | 0.1704 | 1.2% | 2.0% | 62.57 / 4.2% | `a904157119ae` | 50.8s |
| B1 | B | REFUSE (0 blocking) · 1 cut-out | flat_atlas — The image displays a flat, rectangular print artwork for a spa, with no depiction of a vehicle or vehicle parts. | 0.1797 | 1.2% | 14.4% | 13.96 / 13.6% | `b7b1ec6784ca` | 44.6s |
| C1 | C | pass | flat_atlas — The image displays rectangular regions filled with continuous artwork for a spa advertisement, with no depiction of a vehicle or vehicle parts. | 0.137 | 0.9% | 9.1% | 52.27 / 7.9% | `02ecf38d56d5` | 50.9s |
| A2 | A | pass | flat_atlas — The image displays multiple rectangular panels of continuous artwork, laid out side by side, with no vehicle depicted. | 0.1212 | 1.5% | 5.2% | 28.56 / 17.9% | `787bac4d279e` | 44.3s |
| B2 | B | pass | flat_atlas — The image shows a flat printed sheet with continuous graphics for a spa, filling the rectangular regions without any vehicle depiction. | 0.0894 | 0.6% | 11.0% | 20.75 / 36.0% | `b7ebf72dd913` | 48.0s |
| C2 | C | pass | flat_atlas — The image displays a flat banner design with text, a logo, and a spa scene, with no depiction of a vehicle or vehicle parts. | 0.2112 | 1.0% | 1.8% | 48.13 / 9.0% | `aac75f330191` | 42.7s |
| A3 | A | pass | flat_atlas — The image displays a single, custom-shaped flat print artwork for a spa, with no vehicle depicted. | 0.1587 | 1.0% | 1.2% | 1.15 / 100.0% | `6cfee0205215` | 59.3s |
| B3 | B | pass | vehicle_depiction — The image clearly depicts a vehicle, showing its body contours, front grille, and doors with branding applied. | 0.0691 | 0.4% | 9.5% | 8.27 / 84.6% | `3d8a7873c0ac` | 49.7s |
| C3 | C | pass | flat_atlas — The image displays multiple rectangular print artworks laid out side by side, each filled corner to corner with continuous graphics, and no vehicle parts or shapes are present. | 0.155 | 8.0% | 3.2% | 55.29 / 3.5% | `953f6b4f6031` | 48.4s |
| A4 | A | pass | flat_atlas — The image displays multiple rectangular regions of flat 2D print artwork laid out side by side, with pure graphics filling each rectangle and no vehicle body depicted. | 0.1609 | 1.5% | 0.3% | 55.62 / 6.2% | `98c4e4af97b8` | 50.0s |
| B4 | B | pass | vehicle_depiction — The image depicts a curved display stand with applied graphics, which is not a flat layout of multiple print panels. | 0.175 | 0.3% | 2.7% | 1.64 / 99.3% | `ab42cadb24d8` | 75.5s |
| C4 | C | pass | flat_atlas — The image displays multiple rectangular panels laid out side by side, each filled corner to corner with continuous artwork, and no vehicle or vehicle-shaped elements are present. | 0.1741 | 1.2% | 5.0% | 0.97 / 100.0% | `95b14ca27084` | 47.3s |

## Arm B reference sentence

```text
REFERENCE IMAGE — one complete wrap design pressed flat into printed vinyl. Learn only how a whole wrap reads when it is pressed flat; create an original design for the customer described above.
```

## Arm C tail (v4 pressed skin)

```text
OUTPUT — THE WRAP'S PRINTED SKIN, PRESSED FLAT, on one square 4K image.
This wrap was designed across the whole 2021 Llamborghini Urus (suv) as one continuous piece of artwork. The image shows that artwork pressed perfectly flat into a single continuous print, seen straight on. Pressing it flat leaves only the print: one uninterrupted field of colour, texture, imagery and motion filling the entire square, edge to edge on all four sides.

The print is the artwork alone, at full size. The design runs off all four edges: the outermost pixels on every side are artwork in mid-motion, and the print continues beyond the image in every direction. There is no margin, border, frame, mount or backdrop around it; the artwork reaches every corner.

Every part of the print, corner to corner, is finished, intentional, commercially valuable artwork — real subject matter, real depth, real movement, worth what the customer paid — with no empty backdrop, filler or quiet leftover anywhere. The focal subject may span as much of the print as the concept calls for, and the ground, palette, texture, lighting and motion run continuously through the whole print.

Lettering reads left to right throughout; the company name appears whole and legible, and the only lettering in the image is the company name and the wording the brief calls for.

Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.
```

## Arm A / B tail (v3)

```text
OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.
Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact 2021 Llamborghini Urus (suv) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.

The image is the printed artwork itself, at full size, seen straight on, and nothing else. The design runs off all four edges: the outermost pixels on every side are artwork in mid-motion, and the print continues beyond the image in every direction. There is no margin, border, frame, mount or backdrop around it; the artwork reaches every corner.

Every part of the image, corner to corner, is finished, intentional, commercially valuable artwork — real subject matter, real depth, real movement, worth what the customer paid — with no empty backdrop, filler or quiet leftover anywhere. The focal subject may span as much of the image as the concept calls for, and the ground, palette, texture, lighting and motion run continuously through the whole picture.

Lettering reads left to right throughout; the company name appears whole and legible, and the only lettering in the image is the company name and the wording the brief calls for.

Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.
```
