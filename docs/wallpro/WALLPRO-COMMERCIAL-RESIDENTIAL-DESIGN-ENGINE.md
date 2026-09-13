# WallPro Batch Generator — Commercial + Residential Design Engine

Owner spec, 2026-09-13. This is a surgical extension of the existing WallPro
Batch Generator and its canonical two-persona design engine
(`supabase/functions/generate-wall-design/prompt.ts` + `handler.ts`). It does
**not** create a second generator, a second batch-only image model, or a
second copy of persona logic — see "How this stays one engine" below.

## 1. Files changed

| File | What changed |
|---|---|
| `supabase/functions/generate-wall-design/domain.ts` | **New.** The commercial/residential taxonomy and the deterministic `classifyWallDomain` classifier. Pure, dependency-free TypeScript — no I/O, no AI call. |
| `supabase/functions/generate-wall-design/prompt.ts` | Extends `WallDesignContract` with four optional fields; adds `RESIDENTIAL_DESIGNER` (Persona 2, residential branch) alongside the existing `WALL_DESIGNER` (now the commercial branch, byte-for-byte unchanged); adds `designerPersonaFor(domain)`; wires domain classification into `wallDesignPrompt` and `contractDirective`; extends `wallComplianceCheckPrompt` with domain-specific quality-floor questions and an AI-slop checklist. |
| `supabase/functions/generate-wall-design/handler.ts` | `parseWallInput` accepts optional advisory hints (`libraryIndustry`, `libraryRoom`, `libraryStyle`, `designDomain`, `commercialSpaceType`, `residentialSpaceType`); the consultant call re-classifies domain using its own `businessContext` output; the response now carries `design_domain`, `commercial_space_type`, `residential_space_type`, `design_style`, and `design_contract` for curator/customer visibility. |
| `app/src/lib/wallpro-catalog.ts` | Adds `libraryEntryDomain`, `catalogRowDomain` (both call the same classifier the edge function uses — see below), `batchDiversitySummary`; extends `WallBatchFilter`/`selectLibraryEntries` with a `domain` filter. |
| `app/src/pages/AdminWallProBatch.tsx` | Sends library hints on every batch job; shows a domain/space-type chip on job and gallery cards; adds a Domain filter on both the generator and gallery tabs; adds a batch-diversity readout; adds a "Details" drawer per job showing the full `WallDesignContract` and (if run) the advisory compliance receipt. |
| `app/src/lib/__tests__/wallpro-domain.test.ts` | **New.** Classifier correctness, persona selection, contract-directive wiring, compliance-prompt wiring, catalog helpers. |
| `app/src/lib/__tests__/wallpro-acceptance-batch.test.ts` | **New.** The 15-job acceptance batch from section 10 below, verified for routing (see section 11 — what this does and does not prove). |

**Not changed:** the 500-prompt library JSON, `wallpro-scale.ts`, `wallpro-seamless.ts`'s seam contract, `wallpro-render.ts`, PanelPro vehicle QC, GENIE vehicle logic, production/QC architecture, DesignID/GenerationID/master-hash provenance, or any table schema. No migration was written for this change.

## 2. New/updated metadata — and a deliberate simplification

The spec asked for `designDomain`/`spaceType`/`designStyle` to be metadata
"each entry can carry." I did **not** physically add those fields to the
500-row `wallpro-prompt-library.json`, and did not add new columns to the
`wallpro_designs` table either. Instead, both are **computed on demand** from
fields that already exist and are already the source of truth:

- Library entries already carry `industry`, `room`, `style` — `libraryEntryDomain(entry)` derives `designDomain`/`commercialSpaceType`/`residentialSpaceType`/`designStyle` from those, live, every time it's called.
- Published catalog rows already persist `industry`, `room`, `style` (existing DB columns) — `catalogRowDomain(row)` does the same.

**Why this is the right call, not a shortcut:** a derived field stored
redundantly can drift from the field it was derived from the moment either
is edited by hand — and this library gets edited by hand. Computing it live
means there is exactly one source of truth (`industry`/`room`/`style`) and
zero risk of a stale classification sitting next to a corrected industry
name. It also means this ships with **no database migration** — a real risk
reduction on a live Supabase project, and consistent with this repo's own
hard-won lessons about migrations (`CLAUDE.md`'s PL/pgSQL and RLS sections).
If you want the classification physically stored later (e.g. for a SQL
`WHERE design_domain = ...` query instead of a client-side filter), that's a
clean follow-up migration, not something this task should have smuggled in.

The generation request/response DID gain new fields (`libraryIndustry` etc.
on request; `design_domain`, `design_contract` etc. on response) — additive
only, nothing existing was renamed or removed.

## 3. How domain classification works

`classifyWallDomain` (`domain.ts`) is **deterministic code, not a second AI
call** — the same principle this codebase already applies to medium
selection ("Medium selection is deterministic and local... Do NOT add an LLM
classification or persona-selection stage"). It resolves, in order:

1. **Explicit override** (`designDomain` + space type on the request) — a curator or a future UI control can force it.
2. **Library metadata** (`libraryIndustry`/`libraryRoom`/`libraryStyle`) — a lookup table maps all 28 B2B industries to a commercial space type (with a handful of room-level overrides, e.g. "Cowork Lounge" → `coworking` inside "Corporate Offices & Coworking"), and the two B2C industries to a residential room type from the `room` field.
3. **The customer's own prompt text** (used when there's no library metadata, i.e. a live "Describe a design" or "Design for my wall" request) — a coarse keyword scan, same style as the existing `FINE_MATERIAL_WORDS` pattern in `wallpro-scale.ts`.
4. **Default: commercial.** This is a compatibility decision: `WALL_DESIGNER` has always been commercial-flavored, and every existing prompt with no domain signal must keep producing the exact prompt it produced before this feature existed. (Verified by test: `wallDesignPrompt({ prompt: 'A mountain mural', ... })` with no hints still returns the identical persona text as before.)

In `handler.ts`, classification runs once before the consultant call (for
response visibility on every path, including match/refine) and once more
after the consultant returns, folding in its own `businessContext` (a
stronger signal than raw prompt text — e.g. a brief that only says "the
reception area" gets a businessContext of "corporate office lobby"). Never a
second AI call: same one text-model call this architecture has run since the
9-12 two-persona change.

## 4. How the commercial persona mode works

`WALL_DESIGNER` — unchanged text, unchanged identity ("Senior Environmental
Graphic Designer and Large-Format Wrap Designer working inside a commercial
sign company and interior design studio"). This branch is what already
shipped 2026-09-12; nothing about its wording changed. It is selected
whenever `classifyWallDomain` resolves `commercial` (including every
pre-existing request that has no domain signal at all).

## 5. How the residential persona mode works

`RESIDENTIAL_DESIGNER` — new, same length discipline as the commercial
persona (the file's own header states why: "Prompt length = quality killer").
Identity: "Senior Residential Interior Designer and Wallcovering Designer
specializing in custom murals, wallpaper, feature walls and high-end
residential interiors." It names the current wallcovering/interior-design
vocabulary once as a source to draw from, rather than listing all 50+ styles
inline (that would burn hundreds of characters the brief needs). Selected
whenever the classifier resolves `residential`.

## 6. Current residential style taxonomy

`RESIDENTIAL_STYLE_TAXONOMY` in `domain.ts` — the full list from the owner
spec (Boho, Contemporary Boho, Organic Modern, Japandi, Scandinavian, Soft
Minimalism, Quiet Luxury, Modern Luxe, ... through Marble, Travertine).
`classifyWallDomain` matches the **longest, most specific entry first**, so
"Contemporary Boho" wins over "Boho" when both are present in the text —
verified by test against every entry in the list.

## 7. How literal user/library intent remains immutable

Domain/space-type/style are **guidance, never the design** (owner spec,
section 4). Three places enforce this:

- `classifyWallDomain` never touches `requiredSubjects`/`requiredElements`/`requiredColors`/`mustPreserve` — those come only from Persona 1's own extraction (`wallConsultantPrompt`/`enrichWallBrief`), which was already immutable before this change and is untouched here.
- `contractDirective` prints style/space-type guidance as its own labeled lines, explicitly stated as informing "composition, material treatment and palette — never replaces the required subjects/elements/colors above," and prints them **after** the REQUIRED lines, never in place of them.
- A residential classification never invents subjects: the med-spa test case (`large sage green leaves, soft neutral background, woman reclining getting a facial`) is verified to classify as `commercial`/`spa` and never surfaces a residential style label at all — the residential taxonomy is guidance for the residential persona specifically, not a generic "style" bucket applied everywhere.

## 8. How creative compliance changed

`wallComplianceCheckPrompt` (still advisory-only, still **off by default**,
still never blocks generation — unchanged from the 2026-09-12 architecture)
now asks two additional things, kept **separate** from the existing hard
fact-check:

- **Domain-specific quality-floor questions** (`qualityFloorQuestions`): the commercial branch asks the section-6 sign/environmental-graphics questions; the residential branch asks the section-6 boutique-wallpaper-studio questions.
- **AI-slop flags** (`AI_SLOP_CHECKLIST`, section 7 of the spec verbatim): meaningless swirls, random floating motifs, fake gold effects, generic spa-leaf-for-every-wellness-prompt, warped anatomy, invented logos, etc.

The response schema adds `professionalQualityFloor` (boolean) and
`aiSlopFlags` (array), both explicitly labeled ADVISORY in the prompt text
itself, kept apart from `compliant` (the pre-existing HARD fact check on
required subjects/elements/colors/forbidden inventions). This matches the
spec's own instruction: "Material contract violations remain HARD FAIL.
Subjective taste remains advisory unless it falls below the professional
quality floor." **This check is still off by default in production** for
the same reason it was turned off on 2026-09-12: a second vision call on the
response path caused a completed generation to read as a timeout in the
browser. Nothing in this change re-enables it.

## 9. How curator UI changed

In Admin WallPro Batch (`/admin/wallpro-batch`):

- **Domain filter** on the Generator tab (alongside segment/industry/design type/intensity) and on the Gallery tab.
- **Domain/space-type chip** on every job card and every gallery card (e.g. "Commercial · restaurant" / "Residential · bedroom"), computed live, not stored.
- **Batch-diversity readout** under the batch-settings panel once a queue exists: domain/style/palette-family counts across the built queue, with a highlighted warning line when a batch is converging on one domain, one style, or one palette family (owner spec, section 8 — "record ... so curators can see when a batch is becoming repetitive").
- **Details drawer** per finished job: the full `WallDesignContract` persona 1 produced (client intent, required subjects/elements/colors, business context, forbidden inventions, the resolved domain/space-type/style), and — if the advisory compliance check was explicitly run — its receipt. The main card stays uncluttered; the drawer is opt-in (owner spec, section 9: "Do not clutter the main card with internal JSON... A detail drawer/modal may show the full contract").

## 10. Test batch — 15 jobs, exactly as specified

Defined in `app/src/lib/__tests__/wallpro-acceptance-batch.test.ts`:

**Commercial:** 1. Modern restaurant · 2. Corporate office · 3. Apartment leasing/clubhouse · 4. Church/worship space · 5. Med spa · 6. Retail boutique

**Residential:** 7. Boho living room · 8. Organic Modern bedroom · 9. Quiet Luxury dining room · 10. Japandi home office · 11. Modern Luxe bedroom · 12. Vintage Botanical powder room · 13. Contemporary Classic living room · 14. Nursery · 15. Modern tropical residential mural

Each job's exact prompt text, dimensions, and library hints are in the test
file. **To run these for real**, open `/admin/wallpro-batch`, and either:
(a) paste each prompt into a one-off job via the existing library-entry flow with matching industry/room/style, or
(b) ask a follow-up session to wire a one-click "run the acceptance batch" button that posts these 15 exact jobs — not built here, since it's test-only scaffolding for a one-time visual review, not a product feature.

## 11. What was actually verified, and what was not — read this before trusting section 10

**Verified by automated test, on real code, right now:**
- All 15 jobs classify to the correct domain, and (with library hints) the correct space type and — where named — the correct style label.
- All 15 jobs select the correct persona identity string (commercial vs. residential), with a negative assertion that the *other* persona's identity string never appears.
- Every assembled prompt for all 15 jobs stays under the 4,000-character ceiling this codebase measured as the point where persona boilerplate started drowning the brief (2026-09-12 postmortem).
- The full existing WallPro test suite (343 tests, 40 files) still passes unchanged. `tsc --noEmit` shows zero new errors (138 pre-existing errors in unrelated files, none in anything this task touched). `vite build` succeeds.

**NOT verified, and I want to be direct about this rather than claim success I can't back up:** no image was generated. I have no Gemini API credentials or authorization to spend real generation credits in this session, and this task explicitly said "Do not declare success just because tests pass. Show representative output quality." I cannot show that — the routing is provably correct; whether the *designs* look like a real environmental-graphics studio or a real boutique wallpaper studio produced them is a question only an actual generation, reviewed by a human, can answer.

**What I'd do next, in order:** run the 15-job batch for real in `/admin/wallpro-batch` (each job now sends library hints, so the persona and space type will route exactly as tested above) → open each job's new Details drawer to read the Design Contract that shaped it → judge the 15 images against section 10's own question: do they look like different professional disciplines and styles, or the same AI aesthetic in different colors. If everything looks like one house style, the persona split isn't earning its keep and the RESIDENTIAL_DESIGNER text likely needs another pass — that's a creative-quality question, not a wiring question, and it's the one this document can't answer for you.

## 12. Remaining quality risk

- **The commercial→space-type industry map is approximate**, not exhaustive per-room (documented in `domain.ts`'s own comments — e.g. every "Construction, Trades & Architecture" room maps to `showroom` regardless of whether it's actually a "Paint Showroom" or a "Construction Office"). A curator override always wins; nothing here blocks a manual correction.
- **The residential style matcher is a substring match**, not semantic — a brief that says "not boho, the opposite of boho" would still match "Boho." Low risk in practice (nobody writes design briefs that way) but worth knowing.
- **The AI-slop/quality-floor check is off by default**, same as the compliance check it extends — so nothing in production is currently gated on it. Turning it on is a separate, deliberate decision with its own latency cost (see section 8), not something this task should flip silently.
- **The 500-prompt library's existing `style` field only uses 17 distinct values** today (Modern Organic, Quiet Luxury, Japandi, etc.) — a small subset of the 50+-entry residential taxonomy. The taxonomy is fully wired for customer-typed and curator-typed styles; growing the library's own style variety is a content task (editing the XLSX / JSON), not a code task, and out of scope here.
