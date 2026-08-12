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
text must not surface in any published artifact.

**Byte locks are for provenance and behavioural comparison, not for
resurrecting defects.** The source is the behavioural baseline where it is
correct. Where it is demonstrably wrong — as with the passenger mirror below —
the correct behaviour wins and the divergence is recorded. Freezing prompts,
models, seeds and view angles is the point; freezing bugs is not.

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

**2. Seven views means seven generations. The mirror is a defect, not a feature.**

An earlier revision of this document claimed passenger side is an
`INSTANT_MIRROR` of driver side — `scaleX(-1)`, no AI call — and argued the
contract still held because a flip yields a distinct byte hash. That was wrong
twice over.

It was wrong on the merits. A distinct hash proves nothing about whether the
passenger view is valid, which is the exact assumption removed from Calls 8–9
this week. A horizontal flip reverses logos, phone numbers and URLs, breaks
directional graphics, and asserts a symmetry vehicles do not have — fuel doors,
sliding doors, trim and hardware are side-specific. A passenger design need not
be the mathematical mirror of the driver design at all.

It was also wrong on the facts. The source disabled this behaviour already, for
that reason:

```js
// DISABLED: Passenger side now gets its own AI render.
// Mirroring caused backwards text on wraps with lettering/URLs.
export function isInstantMirrorView(_viewType: string): boolean { return false; }
```

The claim came from a stale header comment at the top of the same file, not
from the function twenty lines below it. Read the code, not the docstring.

The behaviour is still inconsistent upstream: `view-angles-os.ts` and
`useDesignProLogic.ts` disable it, the branch in `generate-color-render:2926`
is unreachable, but `RevisionStudioIQ.tsx:5298` and `useColorProLogic.ts:297`
still flip the driver hero. Those are live instances of the backwards-text bug
in the source system. They are not ported.

**Acceptance for passenger side is semantic, not byte-level.** It gets its own
generation, and the test is that readable branding and text orientation survive
— not that the hash differs.

**3. Three models and a key pool — to be formalised, not copied.**

```
gemini-3-pro-image-preview      primary image
gemini-3.1-flash-image-preview  fallback image
gemini-2.5-flash                text
_shared/gemini-key-pool.ts      rotation
```

This repository currently pins a single `GOOGLE_IMAGE_MODEL` and one key, which
would be a single point of failure the source does not have. Provider
resilience is preserved, but behind one DesignPro-owned provider module rather
than by copying the legacy pool: explicit primary/fallback ordering, per-key
health and cooldown, and no provider credential ever reaching the browser.

## Proposed first slice

Not the whole 7,355 lines at once. The first executable PR:

1. Port `view-angles-os.ts` and `studio-os.ts` verbatim under byte locks — they
   are the camera/frame contract everything else reads, 366 lines, no database.
2. Add a `designpro_generation_*` persistence contract replacing
   `color_visualizations` and the eight other tables, with the same isolation
   rules the rest of the schema already enforces.
3. Port the driver-side generation path, then the passenger path as its own
   generation, and prove both land as immutable revision sources the existing
   Call 8 can consume. Passenger passes on readable text orientation and
   branding, not on a hash comparison.

That is the smallest change that makes a prompt produce a real render inside
this system. Hood, front, rear, close-up and roof follow the same path once it
holds, and the DesignPro generation page goes on top of it.

The remaining five views follow incrementally once driver and passenger hold —
not a seven-blob big bang.

**Contract boundary.** Calls 1–7 own generation, Calls 8–12 own production, and
the seven immutable source slots are the only thing between them. The port
targets those existing slots exactly, so nothing in Calls 8+ changes. Neither
side reaches through the contract into the other.

**Sequencing.** This runs in parallel with the kernel canary rather than behind
it. The two tracks touch opposite sides of that contract, so neither blocks the
other.
