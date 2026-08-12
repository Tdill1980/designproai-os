/**
 * ProofVersionTimeline
 *
 * Vertical list showing every version of a proof with a badge indicating
 * who created it. The active version is highlighted. Customer/shop/support
 * badges use the same colors as the design brief.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { User, Wrench, Sparkles, Clock, Undo2, Loader2 } from "lucide-react";

type Role = "shop" | "customer" | "support" | "system_upload";

interface Version {
  id: string;
  version_number: number;
  created_by_role: string;
  is_active: boolean;
  created_at: string;
  /** Optional preview image for this version (render or uploaded file). */
  thumbnail_url?: string | null;
  /** The exact change request that produced this version (customer's words). */
  prompt_text?: string | null;
}

interface ProofVersionTimelineProps {
  versions: Version[];
  onRevert?: (versionId: string) => Promise<void>;
}

const ROLE_CONFIG: Record<Role, { label: string; color: string; icon: typeof User }> = {
  shop: {
    label: "Shop designer",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: Wrench,
  },
  customer: {
    label: "You (AI revision)",
    color: "bg-purple-100 text-purple-700 border-purple-200",
    icon: Sparkles,
  },
  support: {
    label: "RestylePro support",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    icon: User,
  },
  system_upload: {
    label: "Shop uploaded",
    color: "bg-zinc-100 text-zinc-700 border-zinc-200",
    icon: User,
  },
};

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const ProofVersionTimeline = ({ versions, onRevert }: ProofVersionTimelineProps) => {
  const [revertingId, setRevertingId] = useState<string | null>(null);

  // Defensive sort — most recent first
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);

  const handleRevert = async (id: string) => {
    if (!onRevert) return;
    setRevertingId(id);
    try {
      await onRevert(id);
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <ol className="space-y-2">
      {sorted.map((v) => {
        const role = (v.created_by_role as Role) in ROLE_CONFIG
          ? (v.created_by_role as Role)
          : "shop";
        const cfg = ROLE_CONFIG[role];
        const Icon = cfg.icon;
        const showRevert = !!onRevert && !v.is_active;
        const isReverting = revertingId === v.id;
        return (
          <li
            key={v.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors",
              v.is_active
                ? "bg-blue-50/60 border-blue-200"
                : "bg-white border-zinc-200",
            )}
          >
            {v.thumbnail_url ? (
              <img
                src={v.thumbnail_url}
                alt={`v${v.version_number} preview`}
                loading="lazy"
                className={cn(
                  "w-10 h-10 rounded-lg object-cover bg-zinc-100 shrink-0 border",
                  v.is_active ? "border-blue-300" : "border-zinc-200",
                )}
              />
            ) : (
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  v.is_active ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-500",
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-zinc-900">
                  v{v.version_number}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-[10px] font-medium h-5 px-1.5", cfg.color)}
                >
                  {cfg.label}
                </Badge>
                {v.is_active && (
                  <Badge className="bg-blue-600 text-white text-[10px] h-5 px-1.5 border-0">
                    Active
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="text-zinc-700 font-medium">{formatAbsolute(v.created_at)}</span>
                <span className="text-zinc-400">· {formatRelative(v.created_at)}</span>
              </div>
              {v.prompt_text && v.prompt_text.trim() && (
                <p className="text-[12px] text-zinc-700 mt-1 bg-zinc-50 border border-zinc-200 rounded px-2 py-1 leading-snug whitespace-pre-wrap">
                  <span className="text-zinc-400">“</span>{v.prompt_text.trim()}<span className="text-zinc-400">”</span>
                </p>
              )}
            </div>
            {showRevert && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleRevert(v.id)}
                disabled={isReverting}
                className="h-7 px-2 text-xs text-zinc-600 hover:text-blue-700 hover:bg-blue-50 shrink-0"
              >
                {isReverting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <><Undo2 className="w-3.5 h-3.5 mr-1" /> Revert</>
                )}
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
};
