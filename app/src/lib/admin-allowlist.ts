/**
 * Admin allowlist — frontend fallback.
 *
 * The source of truth for admin access is the `user_roles` table
 * (maintained by the auto_assign_tester_role trigger, see
 * supabase/migrations/*_add_*_admin.sql).
 *
 * This in-code list is a frontend belt-and-suspenders check used by
 * RequireAdmin, RenderBrowser, and Content Studio access guards so
 * newly added operators get access immediately even before their
 * user_roles row is synced (or if they sign in before the migration
 * has been applied to the DB).
 *
 * To add someone permanently:
 *   1. Add their email here (lowercased)
 *   2. Add them to the `auto_assign_tester_role` DB function via a
 *      new migration, and insert a direct user_roles row for any
 *      account that already exists.
 */
export const ADMIN_ALLOWLIST: string[] = [
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "brice@weprintwraps.com",
  "jackson@weprintwraps.com",
  "lance@weprintwraps.com",
  "troy@weprintwraps.com",
  "wyatt-cto@weprintwraps.com",
  // Carley — operator access for Content Studio
  "carley@restyleproai.com",
  // Amanda — R&D / sales. Both addresses on record: restylepro team
  // email plus the gmail auto-assigned the tester role in migrations.
  "amanda@restyleproai.com",
  "amandakinz1111@gmail.com",
].map(e => e.toLowerCase());

/**
 * WPW Engine Room tenant allowlist.
 *
 * Scoped access to /wpw/engine-room and /wpw/content-calendar
 * — the WPW-only mirror of the Marketing Hub. Owner (Trish / tdill)
 * is included so she can see what the WPW internal team sees.
 *
 * Once this moves to a paid tier, swap this check for an
 * organization/subscription-tier lookup.
 */
export const WPW_TENANT_ALLOWLIST: string[] = [
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "lance@weprintwraps.com",
  "brice@weprintwraps.com",
  "jackson@weprintwraps.com",
  "troy@weprintwraps.com",
  "amanda@restyleproai.com",
  "amandakinz1111@gmail.com",
].map(e => e.toLowerCase());

export function isWpwTenantMember(email: string | null | undefined): boolean {
  if (!email) return false;
  return WPW_TENANT_ALLOWLIST.includes(email.toLowerCase());
}

/**
 * WPW Internal Staff allowlist — STRICTLY internal RestylePro/WPW team only.
 *
 * Distinct from WPW_TENANT_ALLOWLIST and from any onboarded WPW shop tenant.
 * Used to gate "admin-wide" analytics views (all-customer aggregate revenue,
 * all-orders status board) so onboarded WPW shop tenants only see their own
 * data — not other shops' data.
 *
 * Rule of thumb: if an email belongs to a person on payroll at RestylePro
 * or WePrintWraps internally, list it here. Outside WPW shop tenants
 * (paying or free) must NEVER appear here.
 */
export const WPW_INTERNAL_STAFF_ALLOWLIST: string[] = [
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "lance@weprintwraps.com",
  "brice@weprintwraps.com",
  "jackson@weprintwraps.com",
  "troy@weprintwraps.com",
  "carley@restyleproai.com",
  "wyatt-cto@weprintwraps.com",
  "amanda@restyleproai.com",
  "amandakinz1111@gmail.com",
].map(e => e.toLowerCase());

export function isWpwInternalStaffMember(email: string | null | undefined): boolean {
  if (!email) return false;
  return WPW_INTERNAL_STAFF_ALLOWLIST.includes(email.toLowerCase());
}

/**
 * Owner-only check — Trish + tdill.
 *
 * Used to show cross-tenant nav (e.g., "Switch to WPW View" button) to
 * the owners without exposing it to tenant team members like Lance,
 * Brice, or Jackson — they should never land on the RP Engine Room
 * by accident.
 */
export const OWNER_ALLOWLIST: string[] = [
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
].map(e => e.toLowerCase());

export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_ALLOWLIST.includes(email.toLowerCase());
}

export function isAllowlistedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_ALLOWLIST.includes(email.toLowerCase());
}

/**
 * Single Flat Panel access — Trish, Jackson, Carley only.
 *
 * Gates the "Single Flat Panel" admin nav entry that points to
 * /admin/panel-batch.
 */
export const SINGLE_FLAT_PANEL_ALLOWLIST: string[] = [
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "jackson@weprintwraps.com",
  "carley@restyleproai.com",
].map(e => e.toLowerCase());

export function canSeeSingleFlatPanel(email: string | null | undefined): boolean {
  if (!email) return false;
  return SINGLE_FLAT_PANEL_ALLOWLIST.includes(email.toLowerCase());
}
