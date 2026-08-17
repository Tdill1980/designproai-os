# CLAUDE.md — designproai-os

## ⛔ RULE 0 — OPTIMIZE FOR BEHAVIORAL PARITY, NOT ARCHITECTURE (Trish 2026-08-17)

**The screenshots in `docs/LAST-WORKING-STATE-2026-07-24.md` are the spec.**
The question is not "what is the elegant architecture?" — it is "how does the
app behave like the working product again?" Sessions burned weeks debating
design masters, surface masters, proof regions, synthetic masters and
view-vs-origin philosophy while the product behaviour stayed absent.

**Stop archaeology. Do not propose alternate manufacturing models. Do not
redesign the product.**

The operating invariant — for each of the six surfaces the system must produce
AND show: (1) an approved side proof, (2) a matched print panel, (3) a composed
2D proof sheet, (4) all six side outputs visible in the UI. The PRINT PANEL is
deterministically derived for **that same side** at GENIE dimensions with 5"
bleed — no AI re-render for manufacturing, no cross-side reuse, and passenger
mirror is an explicit operator action, never pipeline default.

Full spec, acceptance criteria, measured starting position, and the A/B session
split: **`docs/BEHAVIORAL-SPEC.md`.**

## ⛔ RULE 1 — RESTYLEPRO IS THE REFERENCE IMPLEMENTATION. RECOVER BEFORE YOU INVENT.

**Applies to every session in this repository.** If a capability worked in
`Tdill1980/restylepro-os`, find that implementation and reuse it. Do not design
a new one.

Use restylepro-os as the behavioural and code reference for the last working
per-side manufacturing path. For every post-approval stage you touch here,
**first locate the corresponding proven implementation in restylepro-os and
compare them side by side**, then port the smallest proven behaviour that
closes the gap.

**Do not redesign** — port as-is:
per-side source binding · `proofRegion` provenance · `brandedMaster` /
`cleanMaster` relationships · deterministic side identity · GENIE geometry ·
logo separation · PanelPro handoff.

**Adapt only what the standalone boundary actually changes:**
persistence · auth · CAS/hash storage · durable stage execution · droplet and
runtime plumbing.

**Before writing code**, name the exact RestylePro file and function you are
using as the reference. If the standalone version differs, explain the delta
before you change it. If no RestylePro counterpart exists, say so explicitly —
that is what licenses new design, and it should be rare in the post-approval
half.

**Do not restore old infrastructure wholesale. Do restore the working logic.**

The goal is **working restylepro-os production behaviour inside the new
designproai-os operating-system contracts** — not new manufacturing behaviour
invented again.

Per-stage reference map (`stage_key` → RestylePro file/function), the frozen
list, and the one documented exception:
**`docs/RESTYLEPRO-REFERENCE-RULE.md`. Read it before touching a
post-approval stage.**

## Where things are

| | |
|---|---|
| Required behaviour + acceptance criteria + session split | `docs/BEHAVIORAL-SPEC.md` |
| What the working system produced (the spec, in screenshots) | `docs/LAST-WORKING-STATE-2026-07-24.md` |
| Post-approval stage dispatch | `runtime/designpro-standalone-claimant.cjs` |
| Calls 1–7 port scope and the passenger-mirror exception | `docs/CALLS-1-7-PORT-SCOPE.md` |
| What ships first and what is unproven | `docs/GO-LIVE-READINESS.md` |
| Reference checkout | `restylepro-os` alongside this repo (clone it if absent) |
