/**
 * HIDDEN FROM NAVIGATION — not deleted (owner 2026-08-04).
 *
 * These 18 routes were pulled out of every nav menu because a usage audit
 * against live production data showed no activity for 6+ weeks. The ROUTES
 * still exist in App.tsx and still work: bookmarks, existing links and direct
 * URLs are all unaffected. Only the menu entries were removed.
 *
 * This file is documentation, not wiring — nothing imports it at runtime. It
 * exists so the next session can see that the absence was DELIBERATE and
 * evidence-based, rather than "a nav entry someone forgot", and quietly add
 * them back.
 *
 * Evidence is the row count and last-activity date of the table each page
 * reads, queried on 2026-08-04:
 *
 *   affiliate_partners        17 rows, last 2026-05-20
 *   affiliate_coupons         15 rows, last 2026-06-06
 *   carwrappro_runs            4 rows, last 2026-06-11   (4 runs, ever)
 *   scheduled_sms              1 row,  last 2026-05-19
 *   campaign_settings          8 rows, last 2026-05-03
 *   engineroom_reports         1 row,  last 2026-06-13
 *   blog_posts                14 rows, last 2026-04-16
 *   marketplace_listings      80 rows, last 2026-05-15
 *
 * To un-hide one: add its <Link> back to the nav surfaces in Header.tsx /
 * AppTopBar.tsx and delete the entry here.
 */
export const HIDDEN_NAV_ROUTES: { path: string; why: string }[] = [
  // Affiliate program — 11 nav entries (25 link instances in Header alone)
  // for 17 partners with nothing since May. NOTE: /affiliate/login and
  // /affiliate/join are the program's front door — existing affiliates now
  // need the direct URL. Both still resolve.
  { path: "/affiliate", why: "affiliate_partners: 17 rows, idle since 2026-05-20" },
  { path: "/affiliate/join", why: "affiliate program idle; route still live" },
  // NOT hidden any more: /affiliate/login was restored to the Footer on
  // 2026-08-04 as the program's one remaining front door, so existing
  // affiliates are not left needing a remembered URL to sign in.
  { path: "/affiliate/onboarding", why: "affiliate program idle" },
  { path: "/affiliate/dashboard", why: "affiliate program idle" },
  { path: "/affiliate/sharing-kit", why: "affiliate program idle" },
  { path: "/affiliate/settings", why: "affiliate program idle" },
  { path: "/affiliate/admin", why: "affiliate program idle" },
  { path: "/admin/affiliates", why: "affiliate_partners: 17 rows, idle since 2026-05-20" },
  { path: "/admin/affiliate-content", why: "affiliate program idle" },
  { path: "/admin/affiliate-payouts", why: "affiliate_coupons: 15 rows, idle since 2026-06-06" },

  // CarWrapPro — 4 runs in its entire history
  { path: "/carwrappro", why: "carwrappro_runs: 4 rows ever, last 2026-06-11" },
  { path: "/admin/carwrappro", why: "carwrappro_runs: 4 rows ever, last 2026-06-11" },

  // One-off marketing surfaces
  { path: "/admin/sms-campaigns", why: "scheduled_sms: 1 row, last 2026-05-19" },
  { path: "/admin/campaign-videos", why: "campaign_settings: 8 rows, last 2026-05-03" },
  { path: "/admin/engineroom-reports", why: "engineroom_reports: 1 row, last 2026-06-13" },
  { path: "/admin/blog", why: "blog_posts: 14 rows, last 2026-04-16" },
  { path: "/admin/marketplace-inventory", why: "marketplace_listings: 80 rows, last 2026-05-15" },

  // ── Added 2026-08-04, second pass ────────────────────────────────────────
  // BROKEN, not merely idle: this page queries try_landing_config and
  // try_landing_examples, and NEITHER TABLE EXISTS in production (verified
  // twice). Every load throws. Hidden rather than fixed, because creating
  // those tables would be inventing a feature nobody asked for.
  { path: "/admin/try-landing", why: "BROKEN — backing tables do not exist in production" },

  // Legacy panel pipeline — designpanelpro_patterns idle since 2026-07-01,
  // and designpanelpro-manager also reads vehicle_render_images, which has
  // ZERO rows. AdminDesignPanelBatch is also a caller of the dead
  // generate-artboard-from-proof (CLAUDE.md roadmap #5).
  { path: "/admin/panel-batch", why: "designpanelpro_patterns idle since 2026-07-01; dead-pipeline caller" },
  { path: "/admin/design-file-batch", why: "designpanelpro_patterns idle since 2026-07-01" },
  { path: "/admin/designpanelpro-manager", why: "designpanelpro_patterns idle; vehicle_render_images has 0 rows" },
  { path: "/admin/wrap-panel-studio", why: "no backing table of its own; superseded by the sanctioned chain" },
];

/**
 * DELIBERATELY *NOT* HIDDEN, though they were candidates — recorded so the
 * next session does not 'finish the job' and pull a live tool:
 *
 *   /admin/content-studio  — its tables are ACTIVE (agent_social_posts last
 *     2026-08-05, content_hooks 2026-08-04). CLAUDE.md sequences its
 *     retirement explicitly: "grow the Composer to parity, THEN retire the
 *     monolith". Composer (/admin/composer) is not even in the nav yet, so
 *     hiding Content Studio now would remove a working tool before its
 *     replacement exists.
 *
 *   /admin/production-files, /admin/panel-artboard — legacy-pipeline callers,
 *     but panel_artboard_jobs was still written 2026-07-23, ~2 weeks ago, not
 *     the 6+ weeks that justified the others. Left visible pending the owner's
 *     call rather than removed on a weaker standard than the rest.
 */

