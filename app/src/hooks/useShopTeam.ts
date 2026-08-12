/**
 * useShopTeam — every member who can see / claim a proof on this shop.
 *
 * Walks shop_members for every shop the current user is on (their own
 * franchise + any shops they're an accepted member of) and returns a
 * de-duplicated roster.  The hook is the single source of truth for:
 *
 *   • the assignee dropdown on the workbench detail pane
 *   • the assignee filter chips on the workbench left rail
 *   • the avatar badges on the dashboard card's recent-jobs list
 *
 * Falls back gracefully when the user has no shop_members rows yet —
 * solo shops still see themselves in the roster so they can claim their
 * own proofs.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TeamMember {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  shop_id: string;
}

// Emails that are shop members but should NOT appear in the ApprovePro
// designer roster (assignee dropdown, filter chips, dashboard avatars).
// Wyatt is the CTO/admin, not a designer, so he was cluttering the
// assignable-designer list.
const EXCLUDED_FROM_PROOF_TEAM = new Set<string>([
  "wyatt-cto@weprintwraps.com",
]);

function isExcludedFromProofTeam(email: string | null | undefined): boolean {
  return !!email && EXCLUDED_FROM_PROOF_TEAM.has(email.trim().toLowerCase());
}

function nameFromEmail(email: string | null | undefined): string {
  if (!email) return "Teammate";
  const local = email.split("@")[0] || "";
  const first = local.split(/[._-]/)[0] || local;
  if (!first) return "Teammate";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "??";
  const local = email.split("@")[0] || "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 0) return local.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Deterministic avatar tint per user — initials look the same in dropdown
// and in the list rail so the eye can lock onto Lance / Troy / Carley fast.
const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-indigo-500",
] as const;

function colorFromId(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export interface TeamMemberDisplay extends TeamMember {
  displayName: string;
  initials: string;
  colorClass: string;
  isCurrentUser: boolean;
}

async function fetchTeam(): Promise<{
  currentUserId: string | null;
  shopIds: string[];
  members: TeamMember[];
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { currentUserId: null, shopIds: [], members: [] };

  // Get every shop the current user is on the team for.
  const { data: shopIdRows, error: shopErr } = await (supabase as any).rpc(
    "proof_team_shop_ids",
    { _user: user.id },
  );

  if (shopErr) {
    console.warn("[useShopTeam] proof_team_shop_ids failed:", shopErr);
  }

  // RPC returns SETOF uuid so rows are `{ proof_team_shop_ids: uuid }` OR
  // a plain array of strings depending on PostgREST. Normalize.
  const shopIds: string[] = (shopIdRows || []).map((row: any) =>
    typeof row === "string" ? row : row?.proof_team_shop_ids ?? row?.shop_id ?? "",
  ).filter(Boolean);

  if (shopIds.length === 0) {
    // No shop memberships at all — solo user still claims their own proofs.
    return {
      currentUserId: user.id,
      shopIds: [user.id],
      members: [{
        user_id: user.id,
        email: user.email || "",
        role: "owner",
        shop_id: user.id,
      }],
    };
  }

  // Pull the member roster for each shop_id and merge.
  const rosters = await Promise.all(
    shopIds.map(async (shopId) => {
      const { data, error } = await (supabase as any).rpc(
        "shop_members_with_emails",
        { _shop_id: shopId },
      );
      if (error) {
        // Probably the shop_id is just the user's own user_id (legacy solo
        // proofs) and they don't have a shop row at all. Skip.
        return [];
      }
      return ((data ?? []) as Array<{
        user_id: string;
        email: string | null;
        role: "owner" | "admin" | "member";
        accepted_at: string | null;
      }>).map((m) => ({
        user_id: m.user_id,
        email: m.email || "",
        role: m.role,
        shop_id: shopId,
      }));
    }),
  );

  // De-dupe by user_id (a designer on multiple shops only shows once).
  const seen = new Set<string>();
  const merged: TeamMember[] = [];
  for (const roster of rosters) {
    for (const m of roster) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      merged.push(m);
    }
  }

  // Always include the current user, even if they aren't in any roster
  // (e.g., shop_members RPC silently returned empty for permission reasons).
  if (!seen.has(user.id)) {
    merged.unshift({
      user_id: user.id,
      email: user.email || "",
      role: "owner",
      shop_id: user.id,
    });
  }

  return { currentUserId: user.id, shopIds, members: merged };
}

export function useShopTeam() {
  const query = useQuery({
    queryKey: ["shop-team-for-proofs"],
    queryFn: fetchTeam,
    staleTime: 5 * 60 * 1000,
  });

  const currentUserId = query.data?.currentUserId ?? null;
  const shopIds = query.data?.shopIds ?? [];
  const members: TeamMemberDisplay[] = (query.data?.members ?? [])
    .filter((m) => m.user_id === currentUserId || !isExcludedFromProofTeam(m.email))
    .map((m) => ({
    ...m,
    displayName: nameFromEmail(m.email),
    initials: initialsFromEmail(m.email),
    colorClass: colorFromId(m.user_id),
    isCurrentUser: m.user_id === currentUserId,
  }));

  const byId = new Map<string, TeamMemberDisplay>();
  for (const m of members) byId.set(m.user_id, m);

  const lookup = (userId: string | null | undefined): TeamMemberDisplay | null =>
    userId ? byId.get(userId) ?? null : null;

  return {
    isLoading: query.isLoading,
    currentUserId,
    shopIds,
    members,
    lookup,
  };
}
