# Cross-session interface freeze — the approved side-render seam

Owner directive, 2026-08-17. **The seam between Generation and
Manufacturing/UI is frozen.**

| Session | Owns |
|---|---|
| **Generation** | producing the approved per-side renders/artifacts |
| **Manufacturing / UI** | consuming those approved per-side artifacts and binding them to the production board and the downstream deterministic flow |

**Neither session may unilaterally change the shape, naming, identity, storage
contract, or semantics of the approved side-render interface.**

If either session concludes the seam must change: **stop and report the
proposed contract change to the owner for approval.** Do not coordinate a
silent change with the other session. Any seam change is an owner-level
decision.

- Manufacturing/UI **adapts to** the existing approved-side contract rather
  than reshaping generation output on its own.
- Generation **preserves** the existing approved-side contract rather than
  changing it for UI convenience.

## Where the seam actually lives

This is not an abstract boundary. It is enforced in three named places, and a
change to any of them is a seam change:

| | |
|---|---|
| Asset identity shape | `runtime/runtime-contract.cjs` → `normalizeSourceAsset` (line 48) |
| Seam enforcement | `runtime/designpro-standalone-claimant.cjs` → `source.verify` (line 815) |
| Executable acceptance gate | `scripts/calls-1-7-seam.mjs` |

## What is frozen, by its real name

**Canonical side identity.** `runtime/gemini-flat-surface.cjs:19` —
`SURFACE_KEYS = ["driver", "passenger", "hood", "roof", "front", "rear"]`,
frozen. Carried on rows as `surface_key`. No additions, no renames, no
aliasing.

**Artifact identity and storage contract.** `normalizeSourceAsset` returns a
frozen `{ bucket, storagePath, contentHash, byteSize, contentType }` and
rejects anything else. Specifically frozen:

- `bucket` must be the private `wrap-files` Storage bucket
- a public or expiring URL (`url`, `signedUrl`, `publicUrl`, `downloadUrl`) is
  a hard rejection — the seam passes identity, never a fetchable link
- `storagePath` must sit inside `users/{ownerId}/revisions/{revisionId}/inputs/`
  and be exactly 7 segments
- the filename must **be** the content hash — `filenameHash !== contentHash`
  throws

**Immutable content hash.** `contentHash` is sha256 (`HASH_RE`), and it is what
downstream compares against. `source.verify` refuses the run when a panel's
`content_hash` differs from the Call 9 receipt (`production_call9_receipt_mismatch`),
when the proof differs from the Call 8 receipt
(`production_call8_receipt_mismatch`), or when the flat wrap layout differs
(`production_call8_layout_mismatch`).

**Revision / generation identity.** `revisionId` is a canonical UUID and is
structurally embedded in the storage path, so an artifact cannot be
re-parented to a different revision without changing its address.

**Receipt reference.** Stage binding is by receipt kind and `receipt_hash`:
`call8.flat-proof`, `call9.surface-panels`, `call10.logo-inventory`. Logo rows
additionally carry `metadata.placementKey`, `metadata.identityKey` and
`metadata.targetSurfaceKey`, and `source.verify` compares the full sorted
placement set against the Call 10 receipt byte for byte
(`production_logo_evidence_mismatch`).

**Set completeness — no side substitution, no implicit mirroring.**
`source.verify` requires exactly two flat proofs (the customer proof at
`surface_key = ""` and the approved layout at `surface_key = "flat-wrap-layout"`)
and exactly `SURFACE_KEYS.length` panels with `SURFACE_KEYS.length` **distinct**
`surface_key` values. A duplicate side, a missing side, or a mirrored stand-in
fails the run as `production_source_set_incomplete` rather than proceeding.
This is the code-level guarantee behind "passenger mirror is an explicit
operator action, never pipeline default."

## One clarification — geometry is not on this seam

The directive lists "dimensions/geometry metadata required downstream." Those
do **not** travel on the generation seam and must not be added to it.

Geometry resolves at `manifest.resolve`
(`designpro-standalone-claimant.cjs:399`) via
`genie-universal-resolver.cjs` → `resolveOrQueueUniversalDimensions`, keyed
from the **vehicle**, and is bound to the run as `dimensionManifestId` +
`dimensionBasisHash`.

That separation is load-bearing and matches the measured evidence in
`docs/LAST-WORKING-STATE-2026-07-24.md`: two different designs on the same F250
crew cab produced identical dimensions, because dimensions come from the
vehicle, not the design. **Generation must not start emitting dimensions**, and
Manufacturing must keep reading them from the GENIE manifest. Moving geometry
onto the generation seam would be a seam change *and* would reintroduce
per-design dimension drift.

So the frozen list, precisely stated:

| Owner directive says | Where it actually lives |
|---|---|
| canonical side identity | `SURFACE_KEYS` / `surface_key` — on the seam |
| stable artifact identity / receipt reference | `storagePath` + receipt kind/hash — on the seam |
| immutable content hash | `contentHash` / `content_hash` — on the seam |
| revision / generation identity | `revisionId` in the path — on the seam |
| side label / role | `surface_key`, `metadata.targetSurfaceKey` — on the seam |
| no side substitution or implicit mirroring | `source.verify` set-completeness check — on the seam |
| dimensions / geometry metadata | GENIE manifest at `manifest.resolve` — **not** on the seam |

## How to tell you are about to break it

Any of these is a seam change and needs owner approval before the code is
written:

- adding, renaming or aliasing a `surface_key`
- changing the storage namespace, the content-addressed filename rule, or the
  bucket
- putting a URL of any kind into the asset identity
- changing what a receipt kind means, or which hash it carries
- relaxing the exactly-two-proofs / exactly-six-distinct-panels requirement
- letting a side be satisfied by another side's artifact, mirrored or otherwise
- adding dimensions to the generation output

`scripts/calls-1-7-seam.mjs` is the executable gate. Its existing assertions —
content-addressed path, stored hash verifies, "Calls 8 resolves driver and
passenger unmodified", replay makes zero provider calls — are the regression
test for this freeze. If a change makes that script fail, the change is the
problem.
