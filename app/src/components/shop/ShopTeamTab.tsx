/**
 * ShopTeamTab — Team management UI for a shop's owner/admin.
 *
 * Shows:
 *   - Seat counter (members + pending invites vs effective seat limit)
 *   - Invite form (email + role)
 *   - Current members list (role, email, joined-at, remove button)
 *   - Pending invites list (email, role, expires, copy link, revoke)
 *
 * Talks to two edge functions:
 *   - invite-shop-member  (POST { shop_id, email, role })
 *   - accept-shop-invite  (POST { token })  — not called from here; used on /invite/:token
 *
 * Uses two RPCs:
 *   - shop_effective_seat_limit(_shop_id)
 *   - shop_members_with_emails(_shop_id)
 *
 * And two tables via the existing client (RLS-gated):
 *   - shop_invites (read / update to revoke)
 *   - shop_members (update role / delete)
 *
 * All writes only work for owner/admin of the shop — RLS policies plus the
 * edge function guard enforce that. The UI hides destructive actions if the
 * caller isn't an admin, but RLS is the source of truth.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Loader2,
  Mail,
  Plus,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

type InviteRole = "admin" | "member";

interface ShopMemberRow {
  member_id: string;
  user_id: string;
  email: string | null;
  role: "owner" | "admin" | "member";
  invited_by: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

interface ShopInviteRow {
  id: string;
  shop_id: string;
  invited_email: string;
  invited_by_user_id: string;
  role: "admin" | "member";
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
}

export function ShopTeamTab() {
  const queryClient = useQueryClient();
  const { currentShop, currentMembership, isShopAdmin } = useOrganization();
  const shopId = currentShop?.id ?? null;
  const callerRole = currentMembership?.role ?? null;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");

  // -----------------------------------------------------------------------
  // Effective seat limit (shop_effective_seat_limit RPC)
  // -----------------------------------------------------------------------
  const { data: seatLimit } = useQuery({
    queryKey: ["shop-seat-limit", shopId],
    enabled: shopId !== null,
    queryFn: async () => {
      if (!shopId) return 1;
      const { data, error } = await (supabase as any).rpc(
        "shop_effective_seat_limit",
        { _shop_id: shopId },
      );
      if (error) {
        console.warn("[ShopTeamTab] seat limit rpc error:", error);
        return 1;
      }
      return typeof data === "number" ? data : 1;
    },
  });

  // -----------------------------------------------------------------------
  // Members roster (shop_members_with_emails RPC)
  // -----------------------------------------------------------------------
  const {
    data: members,
    isLoading: membersLoading,
    error: membersError,
  } = useQuery<ShopMemberRow[]>({
    queryKey: ["shop-members", shopId],
    enabled: shopId !== null,
    queryFn: async () => {
      if (!shopId) return [];
      const { data, error } = await (supabase as any).rpc(
        "shop_members_with_emails",
        { _shop_id: shopId },
      );
      if (error) {
        console.error("[ShopTeamTab] shop_members_with_emails error:", error);
        throw error;
      }
      return (data ?? []) as ShopMemberRow[];
    },
  });

  // -----------------------------------------------------------------------
  // Pending invites (direct table read — RLS gates it to admins)
  // -----------------------------------------------------------------------
  const {
    data: pendingInvites,
    isLoading: invitesLoading,
  } = useQuery<ShopInviteRow[]>({
    queryKey: ["shop-invites", shopId],
    enabled: shopId !== null && isShopAdmin,
    queryFn: async () => {
      if (!shopId) return [];
      const { data, error } = await (supabase as any)
        .from("shop_invites")
        .select(
          "id, shop_id, invited_email, invited_by_user_id, role, token, status, created_at, expires_at",
        )
        .eq("shop_id", shopId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("[ShopTeamTab] pending invites error:", error);
        return [];
      }
      return (data ?? []) as ShopInviteRow[];
    },
  });

  const memberCount = members?.length ?? 0;
  const pendingCount = pendingInvites?.length ?? 0;
  const seatsUsed = memberCount + pendingCount;
  const seatsRemaining = Math.max(0, (seatLimit ?? 1) - seatsUsed);
  const atCapacity = seatsRemaining <= 0;

  // -----------------------------------------------------------------------
  // Invite mutation
  // -----------------------------------------------------------------------
  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: InviteRole }) => {
      if (!shopId) throw new Error("No shop selected");
      const { data, error } = await supabase.functions.invoke(
        "invite-shop-member",
        {
          body: { shop_id: shopId, email, role },
        },
      );
      if (error) {
        // supabase-js wraps non-2xx as FunctionsHttpError but still parses
        // the response body into `data`, so prefer the server-side message.
        const serverMsg = (data as { error?: string } | null)?.error;
        throw new Error(serverMsg || error.message || "Failed to create invite");
      }
      if (!data?.success) {
        throw new Error(data?.error || "Failed to create invite");
      }
      return data as {
        invite_id: string;
        token: string;
        invite_url: string;
        expires_at: string;
        shop_name: string;
        role: InviteRole;
        invited_email: string;
      };
    },
    onSuccess: async (result) => {
      // Best-effort clipboard copy so the owner can paste into their own
      // email / Slack / text message.
      try {
        await navigator.clipboard.writeText(result.invite_url);
        toast({
          title: "Invite created",
          description: `Link copied to clipboard. Send it to ${result.invited_email} to join ${result.shop_name}.`,
        });
      } catch {
        toast({
          title: "Invite created",
          description: `Share this link with ${result.invited_email}: ${result.invite_url}`,
        });
      }
      setInviteEmail("");
      setInviteRole("member");
      queryClient.invalidateQueries({ queryKey: ["shop-invites", shopId] });
      queryClient.invalidateQueries({ queryKey: ["shop-seat-limit", shopId] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Invite failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // -----------------------------------------------------------------------
  // Revoke invite mutation
  // -----------------------------------------------------------------------
  const revokeMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await (supabase as any)
        .from("shop_invites")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
        })
        .eq("id", inviteId)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Invite revoked" });
      queryClient.invalidateQueries({ queryKey: ["shop-invites", shopId] });
      queryClient.invalidateQueries({ queryKey: ["shop-seat-limit", shopId] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Revoke failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // -----------------------------------------------------------------------
  // Remove member mutation (RLS prevents removing the owner)
  // -----------------------------------------------------------------------
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await (supabase as any)
        .from("shop_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Member removed" });
      queryClient.invalidateQueries({ queryKey: ["shop-members", shopId] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    inviteMutation.mutate({ email, role: inviteRole });
  };

  const handleCopyLink = async (inviteUrl: string, email: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast({
        title: "Link copied",
        description: `Share it with ${email}`,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: inviteUrl,
        variant: "destructive",
      });
    }
  };

  // -----------------------------------------------------------------------
  // Render states
  // -----------------------------------------------------------------------
  if (!shopId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No shop selected.
        </CardContent>
      </Card>
    );
  }

  if (!isShopAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Team management is admin-only
          </CardTitle>
          <CardDescription>
            Only the shop owner or an admin can invite teammates or change roles.
            {callerRole ? ` Your current role is "${callerRole}".` : ""}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Seat counter card ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Team seats
              </CardTitle>
              <CardDescription>
                {seatsUsed} of {seatLimit ?? 1} used
                {atCapacity
                  ? " — at capacity. Revoke a pending invite or upgrade your plan to add more teammates."
                  : seatsRemaining === 1
                    ? " — 1 seat remaining."
                    : ` — ${seatsRemaining} seats remaining.`}
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {currentShop?.name}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Invite form ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Invite a teammate
          </CardTitle>
          <CardDescription>
            Send them a one-time join link. They'll sign up (or sign in) and
            land inside this shop automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleInviteSubmit}
            className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteMutation.isPending || atCapacity}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as InviteRole)}
                disabled={inviteMutation.isPending || atCapacity}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={inviteMutation.isPending || atCapacity || !inviteEmail}
            >
              {inviteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send invite
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ─── Members list ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Members ({memberCount})</CardTitle>
          <CardDescription>
            Everyone who can sign into this shop today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading team...
            </div>
          ) : membersError ? (
            <div className="text-sm text-destructive">
              Failed to load members.{" "}
              {membersError instanceof Error ? membersError.message : ""}
            </div>
          ) : memberCount === 0 ? (
            <div className="text-sm text-muted-foreground">No members yet.</div>
          ) : (
            <div className="space-y-2">
              {members?.map((m) => {
                const isOwner = m.role === "owner";
                const displayEmail = m.email ?? "(no email)";
                return (
                  <div
                    key={m.member_id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {displayEmail}
                        </span>
                        <Badge
                          variant={isOwner ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          {m.role}
                        </Badge>
                      </div>
                      {m.accepted_at ? (
                        <div className="text-xs text-muted-foreground">
                          Joined {new Date(m.accepted_at).toLocaleDateString()}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Added {new Date(m.created_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    {!isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${displayEmail} from ${currentShop?.name}? They'll lose access immediately.`,
                            )
                          ) {
                            removeMemberMutation.mutate(m.member_id);
                          }
                        }}
                        disabled={removeMemberMutation.isPending}
                        aria-label={`Remove ${displayEmail}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Pending invites list ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Pending invites ({pendingCount})
          </CardTitle>
          <CardDescription>
            Copy the link to re-share, or revoke if you need to free up a seat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitesLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading invites...
            </div>
          ) : pendingCount === 0 ? (
            <div className="text-sm text-muted-foreground">
              No pending invites.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingInvites?.map((inv) => {
                const inviteUrl = `${window.location.origin}/invite/${inv.token}`;
                const expires = new Date(inv.expires_at);
                const expired = expires.getTime() < Date.now();
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {inv.invited_email}
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {inv.role}
                        </Badge>
                        {expired && (
                          <Badge variant="destructive" className="shrink-0">
                            expired
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Expires {expires.toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleCopyLink(inviteUrl, inv.invited_email)
                        }
                        aria-label="Copy invite link"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (
                            confirm(
                              `Revoke the invite for ${inv.invited_email}?`,
                            )
                          ) {
                            revokeMutation.mutate(inv.id);
                          }
                        }}
                        disabled={revokeMutation.isPending}
                        aria-label="Revoke invite"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
