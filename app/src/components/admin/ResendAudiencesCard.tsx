import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Download, RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// WHITE UI (docs/WHITE_UI_STANDARD.md): white surface, dark text, blue→magenta
// gradient as accent only.
//
// Why this card exists: the contact lists in Resend were invisible to the rest
// of the stack — 30+ functions send through Resend, nothing read its Audiences.
// This surfaces them with real counts and gets a CSV out, which is what a Meta
// Custom Audience upload actually needs.

const GRADIENT = "bg-gradient-to-r from-[#3b82f6] to-[#ec4899]";

interface Audience {
  id: string;
  name: string | null;
  created_at: string | null;
  total?: number;
  subscribed?: number;
  unsubscribed?: number;
  error?: string;
}

interface Contact {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  created_at: string | null;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Meta's Customer List importer keys off these exact header names, so the
// export is built for that upload rather than as a generic dump.
function toCsv(contacts: Contact[]): string {
  const head = ["email", "fn", "ln"];
  const rows = contacts.map((c) => [c.email, c.first_name, c.last_name].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n");
}

export default function ResendAudiencesCard() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["resend-audiences"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-audiences", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { audiences: Audience[] };
    },
  });

  const download = useMutation({
    mutationFn: async (a: Audience) => {
      setDownloading(a.id);
      const { data, error } = await supabase.functions.invoke("resend-audiences", {
        body: { action: "contacts", audience_id: a.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const contacts: Contact[] = data?.contacts ?? [];
      if (!contacts.length) throw new Error("No subscribed contacts in this audience.");

      const blob = new Blob([toCsv(contacts)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `resend-${(a.name || a.id).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return { count: contacts.length, withheld: data?.withheld_unsubscribed ?? 0 };
    },
    onSuccess: (r) => {
      toast({
        title: `${r.count} contacts exported`,
        description: r.withheld
          ? `${r.withheld} unsubscribed contacts were left out on purpose.`
          : "Upload this CSV in Meta Ads Manager → Audiences → Customer List.",
      });
      setDownloading(null);
    },
    onError: (e: Error) => {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
      setDownloading(null);
    },
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">
            Resend <span className={cn("bg-clip-text text-transparent", GRADIENT)}>Lists</span>
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Contact lists living in Resend. Export a CSV to upload as a Meta Custom Audience —
            unsubscribed contacts are left out automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {isLoading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading Resend…
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {(error as Error).message}
        </p>
      )}

      {data && !data.audiences?.length && (
        <p className="mt-6 text-sm text-gray-500">No audiences exist in this Resend account.</p>
      )}

      {data?.audiences?.map((a) => (
        <div
          key={a.id}
          className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4"
        >
          <div className="min-w-0">
            <p className="truncate font-semibold text-gray-900">{a.name || a.id}</p>
            {a.error ? (
              <p className="mt-0.5 text-sm text-red-600">Couldn't read contacts ({a.error})</p>
            ) : (
              <p className="mt-0.5 text-sm text-gray-600">
                <Users className="mr-1 inline h-3.5 w-3.5" />
                <span className="font-semibold text-gray-900">{a.subscribed ?? 0}</span> subscribed
                {a.unsubscribed ? ` · ${a.unsubscribed} unsubscribed` : ""}
              </p>
            )}
          </div>
          <Button
            size="sm"
            className={cn(GRADIENT, "text-white")}
            disabled={!!a.error || !a.subscribed || downloading === a.id}
            onClick={() => download.mutate(a)}
          >
            {downloading === a.id ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            CSV for Meta
          </Button>
        </div>
      ))}
    </div>
  );
}
