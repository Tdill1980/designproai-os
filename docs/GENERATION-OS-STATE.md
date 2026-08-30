# Generation OS derived phases

The server execution graph remains authoritative. `designpro_private.designpro_generation_phase(generation_id)` is a read projection only, used so every UI surface describes the same job consistently.

Possible projected phases include request state before an A.T.L.A.S. revision exists, `design_ready`, `building_preview`, `production_preview_ready`, `await_purchase`, `production_preflight`, `panelpro_qc`, `enhancing`, `output`, `final_qc`, `packaging`, and `complete`.

A phase never authorizes a transition. Stage dependencies, receipts, human gates, entitlement and existing server invariants continue to decide what is runnable.