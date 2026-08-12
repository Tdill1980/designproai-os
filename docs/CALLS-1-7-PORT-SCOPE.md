# Calls 1–7 port — measured scope

Source: `Tdill1980/restylepro-os` @ `ab0f0638`, blobs frozen by the engine
contract in `designpro-standalone-claimant.cjs`.

## The blobs

| Blob | Lines |
|---|---:|
| `generate-color-render` | 3,701 |
| `design-panel-ai-generate` | 1,833 |
| `edit-vehicle-photo` | 568 |
| `generate-pattern-render` | 484 |
| `design-on-vehicle-photo` | 403 |
| `_shared/view-angles-os.ts` | 243 |
| `_shared/studio-os.ts` | 123 |
| **Total** | **7,355** |

These carry a trade-secret header (© LoopMighty Software Development LLC).
Same owner, private target repository, so the port is internal — but the prompt
text must not surface in any published artifact, and the frozen blobs must be
ported under byte/behaviour locks rather than rewritten.

## Three findings that shape the work

**1. The port cannot be a copy — it is a persistence rewrite.**
`generate-color-render` writes to nine tables, and two of them are explicitly
prohibited by the standalone runtime contract:

```
color_visualizations   x6   PROHIBITED
vinyl_reference_images x3
vinyl_swatches         x2
render_templates       x2
vehicle_renders        x1
user_roles             x1   PROHIBITED
moderation_log         x1
manufacturer_colors    x1
blocked_users          x1
```

The generation logic ports; the storage layer must be rebuilt on `designpro_*`
objects. That is the bulk of the risk, not the model calls.

**2. Only six AI generations produce seven views.**
`view-angles-os.ts` locks the production order and marks passenger side as
`INSTANT_MIRROR` of driver side — `scaleX(-1)`, no AI call. The seven-view set
this repository already requires is satisfied by six generations plus one
deterministic mirror, and the mirror still yields a distinct byte hash, so the
existing "seven distinct views" contract holds unchanged.

```
side · passenger-side · hood_detail · front · rear · close-up · roof
```

That order already matches `CALLS_1_7_VIEW_PLAN` in the claimant exactly. The
adapter was built for this contract; nothing there needs to change.

**3. Three models and a key pool.**

```
gemini-3-pro-image-preview      primary image
gemini-3.1-flash-image-preview  fallback image
gemini-2.5-flash                text
_shared/gemini-key-pool.ts      rotation
```

This repository currently pins a single `GOOGLE_IMAGE_MODEL` and one key. The
port needs the pool and the fallback path, or it inherits a single point of
failure the source did not have.

## Proposed first slice

Not the whole 7,355 lines at once. The first executable PR:

1. Port `view-angles-os.ts` and `studio-os.ts` verbatim under byte locks — they
   are the camera/frame contract everything else reads, 366 lines, no database.
2. Add a `designpro_generation_*` persistence contract replacing
   `color_visualizations` and the eight other tables, with the same isolation
   rules the rest of the schema already enforces.
3. Port the driver-side generation path only, plus the `INSTANT_MIRROR`
   passenger derivation, and prove two views land as immutable revision sources
   the existing Call 8 can consume.

That is the smallest change that makes a prompt produce a real render inside
this system. Hood, front, rear, close-up and roof follow the same path once it
holds, and the DesignPro generation page goes on top of it.

**Gate:** none of this starts until the kernel canary passes and Calls 8–12 are
frozen.
