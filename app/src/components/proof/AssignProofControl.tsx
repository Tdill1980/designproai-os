/**
 * AssignProofControl — claim / assign / unassign a proof.
 *
 * Sits in the workbench detail pane. Renders:
 *   • Avatar + name of the current assignee (or "Unassigned" pill)
 *   • "Claim this job" button when unassigned
 *   • Dropdown of every team member to reassign
 *   • "Unassign" item at the bottom
 *
 * Calls the proof_assign() SQL function via supabase.rpc — that function
 * handles authorization, activity logging, and team-membership checks
 * server-side, so this component just needs to render and dispatch.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useShopTeam, type TeamMemberDisplay } from "@/hooks/useShopTeam";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Loader2, UserCheck, ChevronDown, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AssignProofControlProps {
  proofId: string;
  assignedTo: string | null;
  onChange: (newAssignee: string | null) => void;
}

export const AssignProofControl = ({
  proofId,
  assignedTo,
  onChange,
}: AssignProofControlProps) => {
  const { members, lookup, currentUserId } = useShopTeam();
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const current = lookup(assignedTo);

  const assign = async (assignee: string | null) => {
    setPending(true);
    try {
      const { error } = await (supabase as any).rpc("proof_assign", {
        _proof_id: proofId,
        _assignee: assignee,
      });
      if (error) throw error;
      onChange(assignee);
      const target = assignee ? lookup(assignee) : null;
      toast({
        title: assignee === null
          ? "Unassigned"
          : assignee === currentUserId
          ? "Claimed"
          : `Assigned to ${target?.displayName ?? "teammate"}`,
        description: assignee === null
          ? "This proof is back in the unassigned queue."
          : assignee === currentUserId
          ? "You're now the designer on this proof."
          : `${target?.displayName ?? "Teammate"} can pick this up from their queue.`,
      });
    } catch (err: any) {
      const reasonMap: Record<string, string> = {
        not_authenticated: "Your session expired — sign in again.",
        proof_not_found: "This proof no longer exists.",
        not_authorized: "You don't have access to this proof.",
        assignee_not_on_team: "That person isn't on this shop's team.",
      };
      const raw = err?.message || err?.details || "";
      const msg = reasonMap[raw] || raw || "Failed to assign";
      toast({ title: "Assignment failed", description: msg, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  // Solo shop with only the current user — show a simpler claim/release pair.
  const isSolo = members.length <= 1;

  return (
    <div className="flex items-center gap-2">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold shrink-0">
        Designer
      </div>
      <AssigneeAvatar member={current} size="sm" showName />

      {!current && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => currentUserId && assign(currentUserId)}
          disabled={pending}
          className="h-7 px-2 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
          Claim
        </Button>
      )}

      {!isSolo && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              className="h-7 px-1.5 text-xs gap-0.5 text-gray-500 hover:text-gray-900"
            >
              {current ? "Reassign" : "Assign"}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-500">
              Team
            </DropdownMenuLabel>
            {members.map((m) => (
              <DropdownMenuItem
                key={m.user_id}
                onClick={() => assign(m.user_id)}
                disabled={m.user_id === assignedTo}
                className="gap-2 cursor-pointer"
              >
                <AssigneeAvatar member={m} size="xs" />
                <span className="text-xs flex-1">
                  {m.isCurrentUser ? `${m.displayName} (you)` : m.displayName}
                </span>
                {m.user_id === assignedTo && (
                  <span className="text-[10px] text-gray-400">current</span>
                )}
              </DropdownMenuItem>
            ))}
            {current && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => assign(null)} className="gap-2 cursor-pointer text-amber-700">
                  <UserX className="w-3.5 h-3.5" />
                  <span className="text-xs">Unassign</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isSolo && current && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => assign(null)}
          disabled={pending}
          className="h-7 px-1.5 text-xs text-amber-700 hover:bg-amber-50"
        >
          Release
        </Button>
      )}
    </div>
  );
};

// Helper export used by chips in the list rail.
export const memberDisplayName = (m: TeamMemberDisplay | null) =>
  m?.displayName ?? "Unassigned";
