# Test 15 — from the pre-migration 3D hero to the flat field

Model `gemini-3-pro-image`. R: the one-field Call 1 with the hero as `exact_reference` ({"aspectRatio":"1:1","imageSize":"4K"}). E: the July edit request verbatim ({"aspectRatio":"21:9","imageSize":"2K"}).

| hero | arm | gates / size | output class | border ring std / near-median | time |
|---|---|---|---|---|---|
| flamingo | R | REFUSE (1 blocking) | flat_atlas — The image displays a logo and a scenic background, with no vehicles or vehicle parts depicted. | 79.3 / 2.3% | 55.0s |
| flamingo | E | 3168×1344 | flat_atlas — The image displays a single rectangular banner with a logo and a pool scene, with no depiction of a vehicle or vehicle parts. | 18.62 / 65.0% | 22.5s |
| harbor | R | pass | flat_atlas — The image displays a marine service logo and text on a wavy ocean background, with no vehicle depicted. | 51.58 / 7.3% | 53.3s |
| harbor | E | 3168×1344 | flat_atlas — The image displays a logo and text on a background of ocean waves, filling the entire rectangular canvas without any depiction of a vehicle. | 66.58 / 6.0% | 23.6s |
| dental | R | REFUSE (0 blocking) · 4 cut-out | flat_atlas — The image displays a single, flat graphic design with text and an image, without any depiction of a vehicle. | 18.91 / 16.1% | 50.6s |
| dental | E | 3168×1344 | flat_atlas — The image displays a flat graphic banner with text and a person, with no depiction of a vehicle or vehicle parts. | 104.23 / 53.4% | 23.9s |
| mclaren | R | pass | flat_atlas — The image displays multiple rectangular regions of flat 2D print artwork, each filled corner to corner with continuous graphics, and no vehicle or vehicle parts are depicted. | 63.11 / 4.3% | 50.0s |
| mclaren | E | 3168×1344 | flat_atlas — The image displays a continuous watercolor pattern of flowers and waves, which is a flat 2D graphic with no vehicle elements or vehicle-shaped boundaries. | 47.43 / 15.2% | 30.0s |

Heroes: flamingo (d0c43c25, 2022 Ford F250 Crew Cab) · harbor (3ff0a82a, 2022 Ford Transit) · dental (4fa058c2, 2024 Lamborghini Urus) · mclaren (f74255be, 2022 McLaren 720S)

## The July edit prompt (verbatim)

```text
Take the attached image and EDIT it — do NOT redraw, restyle, or reinvent anything. COMPLETELY remove every vehicle part: body, cab, windows and glass, wheels, tires, bumpers, mirrors, lights, the ground, and the studio background — 100% gone, zero remaining outline or shadow of any vehicle part. KEEP the ENTIRE wrap design EXACTLY as shown — identical colors, shards, gradients, and flow, AND every logo, company name, phone number, website, and line of text in its exact position, size, and style, fully opaque and legible. If it contains a flag, preserve that EXACT flag. The result must be flat, solid, and fully opaque everywhere the vehicle used to be — no ghosting, no partial transparency, no visible remnant of the vehicle. Fill and extend the real design seamlessly out to all four edges, so the result is ONE continuous flat rectangle of the COMPLETE branded artwork — no vehicle, no empty space, and nothing removed from the design itself.
```
