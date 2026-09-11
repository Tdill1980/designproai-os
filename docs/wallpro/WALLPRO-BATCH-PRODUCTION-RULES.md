# WallProBatch production rules

Source of truth: `docs/wallpro/WallProBatch_500_Industry_Prompt_Library.xlsx`, sheet "Production Rules" (owner, 2026-09-11).
The 500-prompt library on the first sheet is compiled into `app/src/data/wallpro-prompt-library.json` by `app/scripts/build-wallpro-prompt-library.py`; the Prompt ID column IS the permanent DesignID.

| rule | requirement |
|---|---|
| Canonical Master | Generate one canonical master per catalog design. Every preview, revision, enhancement and production panel must derive from that same master/GenerationID. |
| Do Not Generate Panels Separately | Never prompt the image model to create Panel 1, Panel 2, etc. Independent panel generation will create seam drift, scale drift, texture mismatch and object discontinuity. |
| 4K Source | Batch source master should be at least 4K at generation/enhancement intake. 4K alone is not sufficient proof of final print resolution. |
| Final Resolution | Final raster dimensions must be computed from actual physical wall dimensions at >=150 effective PPI. Pixel width = wall inches × 150; pixel height = wall inches × 150. |
| 54-inch Media | Treat 54 inches as nominal media width unless the printer profile explicitly confirms 54 inches of printable image area. Store media_width and printer_max_printable_width separately. |
| Panel Width | Panelization must use printer_max_printable_width, not a hard-coded 54-inch image width. Printer margins and model-specific limits can reduce actual printable width. |
| Overlap | Default overlap = 1.0 inch duplicated image content. Adjacent panel overlap regions must contain identical pixels from the canonical master. |
| Coverage Math | After the first panel, net wall coverage per panel = configured printable panel width − overlap. Compute this dynamically. |
| Upscaling | Enhance/upscale the complete canonical master before panelization. Do not upscale or generatively redraw panels independently. |
| Seam QC | Automatically compare neighboring overlap strips. They should match pixel-for-pixel except for intentional output-profile/RIP transforms applied identically. |
| Safe Focal Zones | Composition engine should keep faces, eyes, small focal details, logos and later-added typography away from seam zones where practical. |
| Typography | Do not rely on the image model for business names, slogans, pricing or mission statements. Composite production typography deterministically after image generation. |
| Color Management | Separate generative design from color-management/RIP conversion. Preserve a canonical color-managed master and apply printer/output profile consistently at production export. |
| Repeat Patterns | Pattern products require mathematical edge continuity on all four sides and a stored repeat tile size; validate repeat seams before catalog approval. |
| Catalog Metadata | Store Segment, Industry, Room, Design Type, Style, Palette, Intensity and tags independently from the prompt for storefront filtering and future regeneration. |
| Versioning | Save prompt_version, model_version, seed/reference identifiers, master checksum and generation timestamp for every approved catalog design. |

## Identity model

- DesignID `WPB-0001`: permanent commercial identity from the library; never changes.
- GenerationID: the `wallpro_generations` row whose master was approved for that DesignID; a regenerate mints a new one and bumps `master_version`.
- SynthID: Google pixel provenance, recorded as expected on every master; never used as a key.
- Canonical truth: DesignID + GenerationID + master SHA-256 + the `wallpro_designs` row.

## Engines

| design type | engine | batch request | seam gate |
|---|---|---|---|
| Seamless Repeat Pattern | repeat | square tile, placement repeat | measured; verified or mirror; export refuses unverified |
| every other type, Architectural Surface included | mural | 144 x 96 in accent wall, placement cover | not applicable: one continuous master sliced with duplicated overlap. Surface prompts are written to this contract ("flat photorealistic architectural surface texture ... continuous when deterministically panelized"). |

Panel output today: 59.5-inch printable width (`WALLPRO_PRINT_WIDTH`, owner 2026-09-11), 1-inch bleed, 0.5-inch overlap by default (`wallpro-print-plan.ts`). The rules ask for media width and printable width stored separately with a 1-inch duplicated overlap; that is a print-plan setting change, tracked separately from the catalog.
