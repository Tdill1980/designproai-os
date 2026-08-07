# Universal GENIE catalog contract

`genie-candidate-catalog.schema.json` imports provenance-preserving candidates,
not production print geometry. Legacy side/hood/roof/back measurements and
estimated panel square feet remain evidence only. In particular, a legacy
`back` value is never copied into both front and rear.

The production sequence is fail-closed:

1. Import the catalog with `designpro_private.import_genie_candidate_catalog`.
2. `manifest.resolve` links its leased stage to a candidate through
   `request_designpro_universal_dimension_validation` and enters `waiting`.
3. An authenticated member with `can_preflight` reviews source evidence and
   validates exactly six distinct surfaces using this shape:

```json
{
  "contractVersion": "designpro.genie-validated-surfaces.v1",
  "surfaces": {
    "driver": { "widthInches": 1, "heightInches": 1 },
    "passenger": { "widthInches": 1, "heightInches": 1 },
    "hood": { "widthInches": 1, "heightInches": 1 },
    "roof": { "widthInches": 1, "heightInches": 1 },
    "front": { "widthInches": 1, "heightInches": 1 },
    "rear": { "widthInches": 1, "heightInches": 1 }
  }
}
```

The values above document the JSON shape only; they are not seed geometry. The
validation RPC also requires source review, source-URL review, operator
attestation, and notes. It then requeues only the exact waiting stage so the
server resumes without a browser or chat session.

