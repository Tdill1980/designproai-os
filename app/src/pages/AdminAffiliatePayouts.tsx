import { useState } from "react";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AffiliatePayoutTable } from "@/components/affiliate/AffiliatePayoutTable";
import { useAffiliatePayouts, useGeneratePayouts } from "@/hooks/useAffiliatePayouts";
import { useAffiliatePartners } from "@/hooks/useAffiliatePartners";
import { toast } from "sonner";
import { DollarSign, RefreshCw } from "lucide-react";

function buildPeriodOptions() {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push(label);
  }
  return options;
}

export default function AdminAffiliatePayouts() {
  const periodOptions = buildPeriodOptions();
  const [selectedPeriod, setSelectedPeriod] = useState(periodOptions[0]);

  const { data: payouts, isLoading } = useAffiliatePayouts({ period: selectedPeriod });
  const { data: partners } = useAffiliatePartners();
  const generatePayouts = useGeneratePayouts();

  // Build name lookup
  const partnerNames: Record<string, string> = {};
  (partners || []).forEach((p) => {
    partnerNames[p.id] = p.full_name;
  });

  const totalPending = (payouts || [])
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + p.total_amount_cents, 0);

  const totalPaid = (payouts || [])
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.total_amount_cents, 0);

  const handleGenerate = async () => {
    try {
      const count = await generatePayouts.mutateAsync(selectedPeriod);
      toast.success(`Generated payouts for ${count} affiliates`);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate payouts");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Affiliate Payouts</h1>
            <p className="text-muted-foreground">Generate and manage monthly affiliate payouts</p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Period:</span>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerate} disabled={generatePayouts.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${generatePayouts.isPending ? "animate-spin" : ""}`} />
              {generatePayouts.isPending ? "Generating..." : "Generate Payouts"}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pending for {selectedPeriod}
                </CardTitle>
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <DollarSign className="h-4 w-4 text-yellow-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-400">
                  ${(totalPending / 100).toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Paid for {selectedPeriod}
                </CardTitle>
                <div className="p-2 rounded-lg bg-green-500/10">
                  <DollarSign className="h-4 w-4 text-green-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-400">
                  ${(totalPaid / 100).toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>

          <AffiliatePayoutTable
            payouts={payouts || []}
            loading={isLoading}
            partnerNames={partnerNames}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
