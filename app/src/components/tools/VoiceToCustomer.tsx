/**
 * VoiceToCustomer — Per-field mic buttons for customer info.
 *
 * Each field (name, email, phone, company) gets its own mic button.
 * Tap the mic next to a field, speak, and it fills JUST that field.
 * No parsing ambiguity — single-field dictation at ~90% accuracy, free.
 *
 * Works in Chrome, Edge, Safari. Zero cost, no API calls.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Mail, Phone, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MicInput } from "./MicInput";

export interface VoiceToCustomerResult {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  raw: string;
}

interface VoiceToCustomerProps {
  /** Current field values (controlled). */
  name: string;
  email: string;
  phone: string;
  company: string;
  /** Setters for each field. */
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  /** Optional legacy callback — fires when ANY field is voice-filled. */
  onResult?: (result: VoiceToCustomerResult) => void;
  className?: string;
}

/** Format a spoken phone number: strip non-digits, format as (xxx) xxx-xxxx. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw; // return as-is if we can't format
}

/** Clean a spoken email: "john at gmail dot com" → "john@gmail.com". */
function cleanEmail(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+dash\s+/g, "-")
    .replace(/\s+/g, "");
}

const inputCls =
  "h-9 text-xs bg-black border-[#48484a] text-white placeholder:text-white/40 focus-visible:ring-[#60A5FA]/40";
const labelCls =
  "text-[10px] font-semibold text-white/75 mb-1 flex items-center gap-1";

export const VoiceToCustomer = ({
  name,
  email,
  phone,
  company,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onCompanyChange,
  onResult,
  className,
}: VoiceToCustomerProps) => {
  const fireResult = (field: string, value: string) => {
    if (!onResult) return;
    onResult({
      name: field === "name" ? value : name || null,
      email: field === "email" ? value : email || null,
      phone: field === "phone" ? value : phone || null,
      company: field === "company" ? value : company || null,
      raw: value,
    });
  };

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", className)}>
      {/* Name */}
      <div>
        <Label className={labelCls}>
          <User className="w-3 h-3" /> Name
        </Label>
        <div className="flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="John Smith"
            className={cn(inputCls, "flex-1")}
          />
          <MicInput
            label="Speak customer name"
            onTranscript={(t) => {
              onNameChange(t);
              fireResult("name", t);
            }}
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <Label className={labelCls}>
          <Mail className="w-3 h-3" /> Email
        </Label>
        <div className="flex items-center gap-1">
          <Input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="john@example.com"
            className={cn(inputCls, "flex-1")}
          />
          <MicInput
            label="Speak customer email"
            onTranscript={(t) => {
              const cleaned = cleanEmail(t);
              onEmailChange(cleaned);
              fireResult("email", cleaned);
            }}
          />
        </div>
      </div>

      {/* Phone */}
      <div>
        <Label className={labelCls}>
          <Phone className="w-3 h-3" /> Phone
        </Label>
        <div className="flex items-center gap-1">
          <Input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="(555) 123-4567"
            className={cn(inputCls, "flex-1")}
          />
          <MicInput
            label="Speak phone number"
            onTranscript={(t) => {
              const formatted = formatPhone(t);
              onPhoneChange(formatted);
              fireResult("phone", formatted);
            }}
          />
        </div>
      </div>

      {/* Company */}
      <div>
        <Label className={labelCls}>
          <Building2 className="w-3 h-3" /> Company / Shop
        </Label>
        <div className="flex items-center gap-1">
          <Input
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder="ABC Wraps LLC"
            className={cn(inputCls, "flex-1")}
          />
          <MicInput
            label="Speak company name"
            onTranscript={(t) => {
              onCompanyChange(t);
              fireResult("company", t);
            }}
          />
        </div>
      </div>
    </div>
  );
};
