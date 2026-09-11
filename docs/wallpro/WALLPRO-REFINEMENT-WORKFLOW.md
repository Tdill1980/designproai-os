# WallPro design sessions: CREATE → REFINE* → APPROVE → PRODUCTION_MASTER → PANELIZE/QC

Owner directive, 2026-09-11. This is the active contract for customer-facing
iterative refinement in WallPro. It is implemented; the status table at the
end says what is live and what is not.

## The rule

A generated or uploaded design must remain editable through natural-language
prompts without restarting the project. Each refinement operates on the
current DesignID/version and creates a new immutable version. Composition and
unaffected regions are preserved by default. Masked/local edits are allowed.
Undo and version history exist and any prior version can be restored.
Refinement happens BEFORE final production upscale/panelization, so expensive
production processing never runs while the customer is still designing.
No refinement is routed through a fresh unrelated generation.

## REFINE_DESIGN

| input | how it is carried |
|---|---|
| design_id | the project (`wallpro_projects.id`); catalog picks also carry the library `WPB` DesignID |
| current_version_id | `wallpro_design_versions.id` of the version being refined; its `artwork_path` is the `sourcePath` sent to the generator |
| user_refinement_prompt | `prompt`, required |
| mask_optional | `maskPath`: a white-on-black PNG the customer drew on the design; white = may change |
| reference_image_optional | `referencePath`: a colour or object to match |
| preserve_composition, preserve_style | always true: the refine prompt edits the existing artwork and names what may change; everything else is stated as fixed |
| wall_geometry | `width`, `height`, `placement`, `repeatWidth` travel with every call; the refinement keeps the framing of the source pixels |

Generator: `supabase/functions/generate-wall-design`, `intent: 'refine'`.
The source is the first image part ("Current design (the version being
refined)"), the mask and reference follow. The requested aspect ratio comes
from the source pixels, not the wall, so the next version has the same
framing as the one it edits. Requested `imageSize` is 4K; returned width and
height are logged and returned.

**Preservation outside a mask is deterministic.** When a mask is used, the
page restores every pixel outside the mask from the parent version and
records the result as a `composite` version. The model is asked to respect
the mask; the OS guarantees it.

## Versions

`wallpro_design_versions` (migration `20260911150000`): one row per version,
`version_no` per project, `parent_version_id`, `kind`
(`create` | `refine` | `upload` | `catalog` | `composite`), the intent and
prompt that produced it, mask and reference paths, `artwork_path`, pixel size,
SHA-256, the `generation_id` for AI versions, the library `design_id` for
catalog picks, placement and tile width, `status` (`draft` | `approved`).
Identity fields are frozen by trigger; only approval and the note change.
Exactly one version per project may be approved (partial unique index).

```
Project  My wall design
V1  create     "Dark botanical, anthuriums on charcoal"
V2  refine     "Change the background to charcoal"
V3  refine     "Make the flowers smaller"
V4  composite  "Remove the gold leaves"  (masked, outside mask restored from V3)
V5  approved
```

Restore switches the project's current version pointer
(`config.currentVersionId`) to an earlier row; nothing is deleted. Approve
marks exactly one version approved; production reads only that version.

## Customer UI

"Describe what you want changed", quick actions (Change colours · Remove
object · Add object · Make busier · Make simpler · Match reference · Extend
design), optional "Only change this area" rectangle mask on the Design only
view, optional reference image, a version history strip with Restore, and
Approve on the current version. Prepare print files is enabled only for the
approved version.

## Status

| piece | state |
|---|---|
| refine intent in the generator, source/mask/reference parts, source-framed aspect | live |
| versions table, immutability trigger, one approved per project | live (migration applied) |
| customer refine panel, quick actions, rectangle mask, history, restore, approve | live |
| deterministic outside-mask restoration (composite version) | live |
| production runs only on the approved version | live for the print export (Prepare print files) |
| production master (whole-master upscale or tiled reconstruction to 150 PPI) | NOT built; server work. Repeat tiles up to ~27 in print now from a 4K tile; murals need the production master stage |
