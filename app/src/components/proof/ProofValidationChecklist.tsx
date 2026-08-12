/**
 * ProofValidationChecklist
 *
 * Pre-send checklist that validates a proof is ready to be sent to the customer.
 * Shows required and recommended items with pass/fail indicators.
 * Blocks the Send button if required items fail.
 *
 * Light themed for ApprovePro.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, AlertTriangle, Shield,
} from "lucide-react";

interface ProofValidationChecklistProps {
  customerEmail: string;
  customerName: string | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  designName: string | null;
  hasRenderOrUpload: boolean;
  status: string;
}

interface CheckItem {
  label: string;
  passed: boolean;
  required: boolean;
  hint?: string;
}

export function getValidationItems(props: ProofValidationChecklistProps): CheckItem[] {
  const hasVehicle = !!(props.vehicleYear || props.vehicleMake || props.vehicleModel);

  return [
    {
      label: "Customer email",
      passed: !!props.customerEmail && props.customerEmail.includes("@"),
      required: true,
      hint: "Required to deliver the proof link",
    },
    {
      label: "Design render or uploaded file",
      passed: props.hasRenderOrUpload,
      required: true,
      hint: "Upload a 2D proof or generate a 3D render first",
    },
    {
      label: "Customer name",
      passed: !!props.customerName,
      required: false,
      hint: "Personalizes the email greeting",
    },
    {
      label: "Vehicle info",
      passed: hasVehicle,
      required: false,
      hint: "Year/Make/Model shown on the proof page",
    },
    {
      label: "Design name",
      passed: !!props.designName,
      required: false,
      hint: "Displayed as the proof title to the customer",
    },
  ];
}

export const ProofValidationChecklist = (props: ProofValidationChecklistProps) => {
  const items = getValidationItems(props);
  const requiredPassed = items.filter((i) => i.required).every((i) => i.passed);
  const allPassed = items.every((i) => i.passed);
  const isTerminal = ["approved", "declined", "revoked", "expired"].includes(props.status);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#3b82f6]" />
          <h3 className="text-sm font-semibold text-gray-900">Send Checklist</h3>
        </div>
        {isTerminal ? (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-gray-200 text-gray-700">
            Closed
          </Badge>
        ) : allPassed ? (
          <Badge className="text-[10px] h-5 px-1.5 bg-green-50 text-green-700 border border-green-200">
            Ready to send
          </Badge>
        ) : requiredPassed ? (
          <Badge className="text-[10px] h-5 px-1.5 bg-amber-50 text-amber-700 border border-amber-200">
            Can send (with warnings)
          </Badge>
        ) : (
          <Badge className="text-[10px] h-5 px-1.5 bg-red-50 text-red-700 border border-red-200">
            Not ready
          </Badge>
        )}
      </div>

      <ul className="space-y-1.5">
        {items.map((item) => {
          const Icon = item.passed ? CheckCircle2 : item.required ? XCircle : AlertTriangle;
          return (
            <li key={item.label} className="flex items-start gap-2 py-1">
              <Icon
                className={cn(
                  "w-4 h-4 mt-0.5 shrink-0",
                  item.passed
                    ? "text-green-500"
                    : item.required
                      ? "text-red-500"
                      : "text-amber-500",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-xs font-medium",
                    item.passed ? "text-gray-800" : "text-gray-800",
                  )}>
                    {item.label}
                  </span>
                  {item.required && !item.passed && (
                    <span className="text-[9px] text-red-500 font-semibold">REQUIRED</span>
                  )}
                </div>
                {!item.passed && item.hint && (
                  <p className="text-[10px] text-gray-700 mt-0.5">{item.hint}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
