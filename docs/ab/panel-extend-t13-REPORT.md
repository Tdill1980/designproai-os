# Test 13 — panel extend from the design layout (2021 Porsche 911 turbo)

Design layout `atlas-call1/737dcc5b-365f-4cba-98c5-306fcaa5f7e9.jpg` (4096×4096). Model `gemini-3-pro-image`, one edit turn per surface, 2K.

| surface | aspect | returned | gate | edgeHole | largest dark shape | colour-blind non-artwork (whole / trim) | border artwork | output class | time |
|---|---|---|---|---|---|---|---|---|---|
| driver | | FAILED | panel extend driver failed on every key: gemini-3-pro-image/3bd4c4c8ea5a:400 {
  "error": {
    "code": 400,
    "message": "Aspect ratio 4:1 is not supported for this model",
    "status": "INVALID_ARGUMENT"
  }
}
 | | | | | | |
| hood | 4:3 | 2400×1792 | pass | 0 | 0.0001 | 67.3% / 60.2% | 0.0% | flat_atlas | 31.2s |

Owner acceptance: a flattened-topology design of a flattened vehicle, meaning no body lines. The eye decides; the numbers are telemetry.

## Edit-turn text (driver)

```text
The provided image is this wrap design pressed flat onto the 2021 Porsche 911 turbo: the design layout.
From it, produce the DRIVER SIDE print panel: one flat rectangle of printed vinyl, 179.6 by 48.99 inches, carrying exactly the artwork that covers the driver side in the design layout, at the same placement, colours, lettering and wear.
The rectangle is the artwork alone, the way the vinyl looks on the roll before installation: the stripes, textures, lettering and colours continue without interruption across the whole rectangle and run off all four edges. Wherever the pressed design shows a gap or an outline, the surrounding artwork continues straight through it, so the rectangle is solid printed artwork corner to corner with no outline, no gap and no background.
Keep everything about the design exactly as in the provided image; change nothing else. Straight-on, flat, full bleed.
```
