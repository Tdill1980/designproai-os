# /public/orgs

Co-brand logos for the partner shops surfaced on the $25 popup,
sharing kit, and 4:5 social post.

Each file should be a **white-on-transparent PNG** (or a light logo
that reads on black) so it renders on the popup's black brand bar
and on the dark-bottom panel of the social post. Suggested dimensions:
~600×200 (or square if circular), trimmed of whitespace.

## Expected files

| Path | Reps it co-brands |
|---|---|
| `royaltywraps-logo.png` | Amanda, Xavier |
| `vinylvixenwraps-logo.png` | Jess |
| `weprintwraps-logo.png` | Troy, Lance, Brice, Jackson |
| `rjthewrapper-logo.png` | RJ |

Drop the actual logo PNGs at these paths. The code reads them via
`defaultOrgLogoPath(rep)` in `src/lib/wpw-reps.ts`. If a file is
missing, the rep's popup brand bar falls back to the org **text**
("RoyaltyWraps" / "VinylVixenWraps") and the 4:5 post quietly omits
the logo — nothing breaks.

To wire a new org logo for a rep, set `orgLogoUrl: "/orgs/<file>.png"`
on the rep entry in `wpw-reps.ts`.
