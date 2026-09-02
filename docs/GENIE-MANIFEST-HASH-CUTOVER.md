# GENIE manifest hash — v1 → v2 cutover (owner ruling, Trish 2026-09-02)

**Do not rewrite historical hashes.** Rows written before this cutover carry v1 semantics; rows written after
carry v2. Both are valid provenance for their era, and the row says which it is.

## The defect (v1)

`stampGeometryResolution` (`runtime/genie-universal-resolver.cjs`) built its hash material as

```js
surfaces[surfaceKey] = expectedSurfacesFromRow(row)?.[surfaceKey] || null;   // an ARRAY indexed by name → always null
material = { contract: "designpro.genie-manifest.v1", state, sourceRowId, derivationContract, surfaces }
```

so `genieManifestHash` varied only with `state`, `geometrySourceRowId` and `derivationContract` — never with
the inches. Two different vehicles resolved through the same source row and state produced the same
manifest identity, contradicting the contract comment above the function ("any change of dimension,
source row or authority produces a different one"). Every harness draw of 2026-09-02 reported
`879291d3a9120666…` for that reason. Found by the lifecycle trace (`docs/GENIE-LIFECYCLE-TRACE-2026-09-02.md`).

## The contract (v2)

| field | value |
|---|---|
| `geometryResolution.contract` | `designpro.genie-manifest.v2` (was `…v1`) |
| `geometryResolution.hashContract` | `designpro.genie-manifest-hash.v2` (new, explicit) |
| hash material | `{ contract, hashContract, state, sourceRowId, derivationContract, surfaces }` where `surfaces` is `{driver, passenger, hood, roof, front, rear}` each `{widthInches, heightInches, bleed{top,right,bottom,left}}` as numbers (a missing surface is `null`) |

Fixtures (`tests/genie-manifest-hash.test.mjs`): identical canonical geometry → identical hash; any one
surface inch changed → a different hash, no collisions across the eleven single-inch changes; state / source
row / derivation still change the hash; the reproduced v1 material collides on two different trucks where
v2 does not.

## Where the hash is consumed (verified, no cross-generation comparison)

- `runtime/flat-first-atlas.cjs` `cutCallOnePanels`: presence/shape check only
  (`flat_atlas_geometry_manifest_identity_missing`); copies the hash onto each panel record.
- Revision metadata `callOnePanels[].genieManifestHash` and `manifest.geometryResolution`: written per
  generation; read back as provenance, never recomputed against a stored value.
- UI (`DesignPanelProPremium.tsx`, `GenerateDesign.tsx`): displays a 16-char prefix in the Design Prep copy.
- GENIE prep rows (`designpro_genie_preps.genie_contract_version`): the prep contract string folds in the
  manifest contract (`designpro.genie-prep.v1+designpro.genie-manifest.v2`), so any prep row prepared under
  v1 is simply never matched after cutover and the worker runs the inline resolver — no stale identity is
  consumed, nothing is rewritten.

## Reading a row

| `geometryResolution.contract` | `hashContract` | meaning |
|---|---|---|
| `designpro.genie-manifest.v1` | absent | pre-cutover; hash covers state + source row + derivation only |
| `designpro.genie-manifest.v2` | `designpro.genie-manifest-hash.v2` | post-cutover; hash covers the inches |

Cutover commit: the one that introduces this file (branch `claude/dca-phase-1-execution-47019t`); not deployed
until the owner says so.
