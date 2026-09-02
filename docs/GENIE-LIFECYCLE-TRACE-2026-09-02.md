# GENIE lifecycle trace — 2026-09-02 (report that located the early-lifecycle defect)

Owner question: does the production lifecycle start GENIE vehicle/dimension work at the Year/Make/Model
Enter boundary? **No.** Findings, with the code as it stood at `194b6fb6`:

1. **On Enter: nothing.** The two customer surfaces (`app/src/pages/DesignProAIHome.tsx`,
   `app/src/pages/DesignPanelProPremium.tsx`) had `onChange` only and no form; Enter was inert.
   `/designpro/generate` (`GenerateDesign.tsx`) was a form, so Enter inside a vehicle field submitted the
   whole Generate request. A 700 ms debounce after YMM completion called
   `POST /api/genie/dimensions/preview` → `previewGenieDimensionsFromCatalog` — catalog-only, never
   grounds, never writes, no GenerationID; result held in React state only.
2. **GenerationID minted in the browser** (`crypto.randomUUID()`), validated at the gateway
   (`gateway/src/server.mjs` `validatedGenerationRequest`), first reaching the server inside the Generate
   POST with the brief; no request row existed before Generate.
3. **GENIE did not start on Enter.** `resolveFlatAtlasPreviewDimensions` ran only inside the worker
   after claim (`runtime/generation-worker.cjs`, the flat-first block).
4. **Persistence against the GenerationID only after Call 1** (`manifest.geometryResolution` on
   `designpro_flat_atlas_revisions`). Vehicle-identity caches existed and were reused across generations:
   `vehicle_dimensions` (catalog) and `designpro_vehicle_specs_universal` (grounded candidates).
5. **Generate re-resolved from scratch**; the prep result was not sent (correctly — browser geometry is
   never authority).
6. **Call 1 waited on geometry** as a hard data dependency (resolver → `buildAtlasManifest` → guide
   renders → request body → edge POST), nothing in parallel, GENIE untimed (`callOneTimings` started
   after it).
7. **Latency:** catalog/candidate hit sub-second; miss 25 s measured live (the DCA that died before
   Call 1, `genie-universal-resolver.cjs` grounding comment) up to 2 × 45 s timeout ≈ 90 s; guide renders
   1.3–3.0 s + 0.7–2.0 s locally; Gemini Call 1 35–45 s.

**Production defect found:** `stampGeometryResolution` hashed `null` surfaces (array indexed by name), so
`genieManifestHash` never varied with the inches — corrected separately under the manifest-hash v2
contract with a cutover note.

Correction implemented: `docs/GENIE-PREP-LIFECYCLE.md`.
