/**
 * AssigneeAvatar — tiny circular badge that surfaces who's working a proof.
 * Used in the workbench list rows and on the dashboard's recent-jobs list.
 * Renders an "Unassigned" pill when assignee is null so the eye can lock
 * onto un-claimed work fast.
 */
import { cn } from "@/lib/utils";
import { UserPlus } from "lucide-react";
import type { TeamMemberDisplay } from "@/hooks/useShopTeam";

interface AssigneeAvatarProps {
  member: TeamMemberDisplay | null;
  size?: "xs" | "sm" | "md";
  showName?: boolean;
  className?: string;
}

const SIZES = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-7 h-7 text-xs",
} as const;

export const AssigneeAvatar = ({
  member,
  size = "sm",
  showName = false,
  className,
}: AssigneeAvatarProps) => {
  if (!member) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-amber-700 font-semibold",
          size === "xs" ? "h-5 text-[9px]" : size === "sm" ? "h-6 text-[10px]" : "h-7 text-xs",
          className,
        )}
      >
        <UserPlus className={cn(size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3")} />
        Unassigned
      </span>
    );
  }

  const dot = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-bold",
        SIZES[size],
        member.colorClass,
        member.isCurrentUser && "ring-2 ring-offset-1 ring-offset-white ring-blue-400",
      )}
      title={`${member.displayName}${member.isCurrentUser ? " (you)" : ""} · ${member.email}`}
    >
      {member.initials}
    </span>
  );

  if (!showName) return <span className={className}>{dot}</span>;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {dot}
      <span className="text-xs font-semibold text-gray-700">
        {member.isCurrentUser ? "You" : member.displayName}
      </span>
    </span>
  );
};
