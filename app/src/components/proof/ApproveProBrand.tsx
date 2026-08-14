/**
 * ApproveProBrand
 *
 * Compact wordmark + gradient logo used as the header chrome of every
 * dialog/modal that opens on top of /approvepro. Keeps brand identity
 * consistent across the workbench so a designer never loses context when
 * a popup steals focus (Send for Approval, Pull from QC, Escalate to
 * Support, AI Revise, Request Revision, etc.).
 */

import { ClipboardSignature } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApproveProBrandProps {
  /** Optional sub-label printed under the wordmark, e.g. "Send for client approval". */
  subtitle?: string;
  /** Right-side content (badges, status pills) rendered opposite the wordmark. */
  rightSlot?: React.ReactNode;
  className?: string;
}

export const ApproveProBrand = ({
  subtitle,
  rightSlot,
  className,
}: ApproveProBrandProps) => {
  return (
    <div className={cn("flex flex-col", className)}>
      {/* Gradient hairline — same #3b82f6 → #ec4899 strip used at the top of
          ApproveProPage. Anchors the brand identity even when this header
          sits inside a small modal. */}
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
      <div className="flex items-start justify-between gap-3 px-6 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm shrink-0">
            <ClipboardSignature className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold leading-none">
              <span className="text-gray-900">Approve</span>
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
              <span className="text-gray-400 text-[10px] ml-0.5 align-top">™</span>
            </div>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-gray-500 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </div>
  );
};
