import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, FileDown, RefreshCw } from "lucide-react";

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function AdminSeoReports() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const [monthIso, setMonthIso] = useState(currentMonthIso());
  const [html, setHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const generate = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke("seo-monthly-report", {
        body: {
          action: "generate",
          shop_id: currentShop.id,
          month_iso: monthIso,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return (data as { html: string }).html;
    },
    onSuccess: (h) => setHtml(h),
    onError: (e: Error) =>
      toast({ title: "Report failed", description: e.message, variant: "destructive" }),
  });

  // Auto-load the first time the shop is ready.
  useEffect(() => {
    if (currentShop && !html && !generate.isPending) {
      generate.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShop?.id]);

  const monthLabel = useMemo(() => {
    const [y, m] = monthIso.split("-").map((n) => Number(n));
    if (!y || !m) return monthIso;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [monthIso]);

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) {
      toast({
        title: "Preview not ready",
        description: "Generate a report first.",
        variant: "destructive",
      });
      return;
    }
    win.focus();
    win.print();
  };

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to view monthly reports.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/seo">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Monthly client report</h1>
            <p className="text-zinc-400 text-sm mt-1">
              White-label SEO summary pulled from Search Console, GA4, audits,
              and published posts. Use Download PDF (browser print → Save as PDF)
              to send.
            </p>
          </div>
        </div>

        <Card className="bg-zinc-950 border-zinc-800 p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>Report month</Label>
            <Input
              type="month"
              value={monthIso}
              onChange={(e) => setMonthIso(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            {html ? "Regenerate" : "Generate"}
          </Button>
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={!html}
          >
            <FileDown className="h-4 w-4 mr-1" /> Download PDF
          </Button>
          <span className="text-xs text-zinc-500 ml-auto">
            Showing {monthLabel} for {currentShop.name}
          </span>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800 overflow-hidden">
          {generate.isPending && !html ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              Building report…
            </div>
          ) : !html ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              Pick a month and click Generate.
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              title="Monthly SEO report"
              srcDoc={html}
              className="w-full bg-white"
              style={{ height: "1100px", border: 0 }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
