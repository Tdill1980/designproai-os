/**
 * ProofProgressStepper
 *
 * Horizontal stepper showing the lifecycle of a proof:
 *   Order Received → 2D Uploaded → 3D Generated → Proof Built → Sent to Customer
 *
 * Each step is derived from the proof's current state + version data.
 * Light themed with blue→magenta gradient for active/completed steps.
 */

import { cn } from "@/lib/utils";
import {
  ShoppingBag, Upload, Sparkles, FileCheck, Send, Check,
} from "lucide-react";

type ProofStatus =
  | "draft" | "sent" | "viewed" | "revising" | "approved" | "declined"
  | "revoked" | "expired" | "delivery_failed" | "escalated_shop" | "escalated_support";

interface StepDef {
  key: string;
  label: string;
  icon: typeof ShoppingBag;
}

const STEPS: StepDef[] = [
  { key: "order_received",  label: "Order Received",    icon: ShoppingBag },
  { key: "2d_uploaded",     label: "2D Uploaded",        icon: Upload },
  { key: "3d_generated",    label: "3D Generated",       icon: Sparkles },
  { key: "proof_built",     label: "Proof Built",        icon: FileCheck },
  { key: "sent_to_customer", label: "Sent to Customer",  icon: Send },
];

interface ProofProgressStepperProps {
  status: ProofStatus;
  hasUploadedFiles: boolean;
  hasRenderUrls: boolean;
  hasSentAt: boolean;
}

function getCompletedSteps(props: ProofProgressStepperProps): Set<string> {
  const completed = new Set<string>();
  completed.add("order_received");
  if (props.hasUploadedFiles) completed.add("2d_uploaded");
  if (props.hasRenderUrls) completed.add("3d_generated");
  if (props.hasUploadedFiles || props.hasRenderUrls) completed.add("proof_built");
  if (props.hasSentAt) completed.add("sent_to_customer");
  return completed;
}

function getCurrentStepIndex(completed: Set<string>): number {
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (completed.has(STEPS[i].key)) return i;
  }
  return 0;
}

export const ProofProgressStepper = (props: ProofProgressStepperProps) => {
  const completed = getCompletedSteps(props);
  const currentIdx = getCurrentStepIndex(completed);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between relative">
        <div className="absolute top-5 left-8 right-8 h-0.5 bg-gray-200" />
        <div
          className="absolute top-5 left-8 h-0.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] transition-all duration-500"
          style={{ width: `calc(${(currentIdx / (STEPS.length - 1)) * 100}% - 64px + ${currentIdx === STEPS.length - 1 ? '64px' : '0px'})` }}
        />

        {STEPS.map((step, i) => {
          const isCompleted = completed.has(step.key);
          const isCurrent = i === currentIdx && !completed.has(STEPS[STEPS.length - 1].key);
          const Icon = step.icon;

          return (
            <div key={step.key} className="relative flex flex-col items-center z-10" style={{ flex: 1 }}>
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                  isCompleted
                    ? "bg-gradient-to-br from-[#3b82f6] to-[#ec4899] border-transparent text-white"
                    : isCurrent
                      ? "bg-white border-[#3b82f6] text-[#3b82f6]"
                      : "bg-gray-50 border-gray-200 text-gray-300",
                )}
              >
                {isCompleted ? (
                  <Check className="w-4.5 h-4.5" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-1.5 text-center font-medium leading-tight",
                  isCompleted
                    ? "text-gray-900"
                    : isCurrent
                      ? "text-[#3b82f6]"
                      : "text-gray-400",
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
