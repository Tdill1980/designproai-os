/**
 * proof-team-access (shared, Deno) — server-side mirror of the proof_approvals
 * team RLS for edge functions that run as SERVICE ROLE (which bypasses RLS).
 *
 * A user may act on a proof when the proof's shop_id is in their TEAM set —
 * their own user id, plus the owner ids of shops they're an accepted member of.
 * This is exactly the proof_approvals UPDATE policy
 *   shop_id IN (SELECT public.proof_team_shop_ids(auth.uid()))
 * resolved here with an explicit user id (proof_team_shop_ids takes a uuid arg
 * and is SECURITY DEFINER, so it works under service role).
 *
 * Fails SAFE: if the team lookup errors or returns nothing usable, it falls back
 * to OWNER-ONLY (the previous shop_id === user.id behavior). A transient failure
 * can therefore never WIDEN access — at worst a teammate is told "not yours",
 * which matches the old behavior. Owners are always unaffected.
 */

/** The shop_ids a user may act on: own id ∪ owners of accepted shop_members. */
export async function userTeamShopIds(db: any, userId: string): Promise<string[]> {
  try {
    const { data, error } = await db.rpc("proof_team_shop_ids", { _user: userId });
    if (error || !Array.isArray(data)) return [userId];
    const ids = (data as any[])
      .map((r) => (typeof r === "string" ? r : r?.proof_team_shop_ids ?? r?.shop_id))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    return Array.from(new Set([userId, ...ids]));
  } catch {
    return [userId];
  }
}

/** True if `userId` may act on a proof owned by `proofShopId` (team-scoped). */
export async function userCanAccessProofShop(
  db: any,
  userId: string,
  proofShopId: string | null | undefined,
): Promise<boolean> {
  if (!proofShopId) return false;
  if (proofShopId === userId) return true; // fast path: owner
  const ids = await userTeamShopIds(db, userId);
  return ids.includes(proofShopId);
}
