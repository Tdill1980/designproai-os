# Calls 8–11 implementation note

This branch changes only the production-output invariants requested by the product owner:

1. Call 9 now treats the verified flattened Call 8 2D Production Proof as the pixel source and extracts each canonical surface by exact named proof-region coordinates. Missing/mismatched regions fail closed. No model call is used in Call 9.
2. Call 10 persists six byte-identical `panel-duplicate` working copies after the six branded Call 9 panels are saved and hash-verified.
3. Call 11 consumes those persisted Call 10 duplicates, writes separate `qc-panel` derivatives, and re-hashes both the branded Call 9 originals and the Call 10 duplicates afterward to prove neither was mutated in place.
4. `panel`, `panel-duplicate`, and `qc-panel` remain distinct artifact classes. Only `panel` is authoritative production artwork.

No deployment is authorized by this branch. Product proof requires a real run and physical inspection of the Call 8 proof, all six Call 9 panels, the six Call 10 duplicates before cleaning, and the six Call 11 clean derivatives.
