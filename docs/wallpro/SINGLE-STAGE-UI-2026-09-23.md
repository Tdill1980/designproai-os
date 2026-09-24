# WallPro single-stage walkthrough — September 23, 2026

## Scope

Replace the repeated five-photo instruction grid with one large, read-only interactive example. Preserve the five steps, original photo edges, corner illustration, curtain protection toggles, final floral preview, and flat-artwork panel example. Keep captions and controls outside the photo. The existing page still owns the gym comparison, customer inputs, editor, purchase flow and branding.

Both light WPW and dark DesignPro surfaces use the same component. The new stylesheet is scoped to `.wallpro-magic`; it does not modify global cards, page theme tokens, PatternPro or the customer editor. The walkthrough performs no API calls, project writes, generation, purchases or exports. Its masks are illustrations tied to the supplied example photograph, not claims of a detector result. The print example uses the existing case-study artwork and `planWallPrint` without changing print constants.

## Approved media

The new `studio-original.jpg` and `studio-floral-preview.jpg` are the owner's complete supplied JPEGs, not crops of the older 1400×803 website assets. They are 1253×1122 and 1254×1254 respectively.

The gym before/after pair is the owner's supplied matching 1536×1024 pair, exported as JPEG at full dimensions. The after frame is the supplied BUILT TO MOVE mural. Equipment labels are preserved as supplied. The older retouched image's pixel-coordinate tests do not describe these new files; exact file hashes now prevent the retired image or a thumbnail from silently returning.

- Gym before SHA-256: `df146b1887d0efb69e39c3ef784115c6430dbe4080bc85dbf12031c578df8cf2`
- Gym after SHA-256: `eeaeb2c42be347a82c32b23052f3a8147d548bd561868c13c31daa98b6a5c287`

## Verification evidence

Reviewed code tree: `1841bc8e86800aab4953ea8c9350c48262a9b913`.

GitHub Actions run `35943513011`, job `107456352637`, completed successfully. It checked out the review branch, removed the temporary QA workflow, printed the above final commit, and then tested that tree.

- 70 tests passed in 5 files: studio walkthrough, existing masthead, existing hero/approved gym images, case studies, and step-board placement.
- 50 actual React/Chrome rendering cases passed: 5 walkthrough stages × 5 viewport widths (1440, 1024, 768, 390, 320) × 2 themes.
- Curtain toggles, keyboard End navigation, reduced-motion state, no horizontal overflow, no stage clipping and no browser exceptions passed.
- Full `npm run build --prefix app` passed.
- Browser screenshots are retained in artifact `10785713721` (`wallpro-studio-final-visual-check`).

The earlier run `35942974808` additionally passed the strict TypeScript check for the changed component dependency graph; no component source changed after that run.

## Boundaries

No changes to customer generation, masking algorithms, dimensions, bleed/overlap constants, auth, billing, checkout, Supabase, routes, dependencies or protected deployment controls are included. Temporary import/QA workflows remove themselves and are absent from the final PR diff. Production deployment must use the normal exact-main release process; these UI checks are not proof of production deployment.
