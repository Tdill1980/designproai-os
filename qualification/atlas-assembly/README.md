# Offline qualification — deterministic A.T.L.A.S. assembly

Proves, with no provider call, no database access and no deployment, that the
six surfaces / canonical flattened master / six canonical panels chain works
end to end when the flattened master is **constructed** rather than requested.

    node acceptance.mjs      # 15 Phase-1 gates, writes out/acceptance.json
    node determinism.mjs A   # one clean-process render, hashes as JSON
    node contact-sheet.mjs   # out/contact-sheet.png

`out/` and `assets/` are regenerated on every run and are deliberately not
committed; `out/acceptance.json` is the receipt and is.

The fixture is the recorded Precision Climate Solutions 2022 Ford F-250 Crew
Cab geometry: driver/passenger 153x56, hood 71.5x56, roof 74.3x54.8,
front 129x34, rear 76x54, with 5" of bleed on every edge.

Creative material is seeded procedural artwork, not model output. What is under
test is the ASSEMBLY of creative material into canonical surfaces — the half
that has to be deterministic. The equivalent chain driven through the real
production entry points (`authorCreativeInput` -> `authorRunMaster` ->
`renderProductionSurfaces` -> `composeAtlasFromSurfaces` -> `cutCallOnePanels`)
is locked by `source-tests/runtime/atlas-deterministic-assembly.test.mjs`.
