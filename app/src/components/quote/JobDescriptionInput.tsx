/**
 * JobDescriptionInput — free-text + AI parse.
 *
 * Shop owner types a job description like
 *   "2023 Ford F-150, full gloss black color change, rush"
 * and we POST it to the parse-quote-job edge function. The function
 * returns a structured ParsedJobSpec (service type, vehicle, finish,
 * panels, tint, …) which the parent uses to pre-fill the rest of the
 * wizard.
 */

import { useCallback, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface ParsedJobSpec {
  service_type:
    | "color_change"
    | "print_wrap"
    | "partial_wrap"
    | "tint"
    | "ppf"
    | "chrome_delete"
    | "design_only"
    | "other";
  vehicle: { make: string | null; model: string | null; year: string | null };
  finish: string | null;
  color: string | null;
  panels: string[];
  tint?: { front?: string; rear?: string; windshield?: string };
  notes: string | null;
  confidence: number;
}

interface ParseResponse {
  spec: ParsedJobSpec;
  vehicle?: unknown | null;
}

interface JobDescriptionInputProps {
  value: string;
  onChange: (text: string) => void;
  onParsed: (result: ParseResponse) => void;
  placeholder?: string;
  className?: string;
}

export function JobDescriptionInput({
  value,
  onChange,
  onParsed,
  placeholder = "e.g. 2023 Ford F-150, full gloss black color change…",
  className,
}: JobDescriptionInputProps) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = useCallback(async () => {
    const text = value.trim();
    if (text.length < 3) return;
    setParsing(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<ParseResponse>(
        "parse-quote-job",
        { body: { text } },
      );
      if (fnErr) throw fnErr;
      if (!data?.spec) throw new Error("No spec returned");
      onParsed(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Parse failed";
      setError(msg);
    } finally {
      setParsing(false);
    }
  }, [value, onParsed]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="bg-black border-[#48484a] text-white placeholder:text-white/40"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={parse}
          disabled={parsing || value.trim().length < 3}
          className="bg-gradient-rp-pop text-white"
          size="sm"
        >
          {parsing ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Parsing…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-1" /> AI Parse</>
          )}
        </Button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
