import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMarkPayoutPaid } from "@/hooks/useAffiliatePayouts";
import { toast } from "sonner";
import type { AffiliatePayout } from "@/types/affiliate";
import { CheckCircle } from "lucide-react";

interface AffiliatePayoutTableProps {
  payouts: AffiliatePayout[];
  loading?: boolean;
  partnerNames?: Record<string, string>;
}

export function AffiliatePayoutTable({ payouts, loading, partnerNames }: AffiliatePayoutTableProps) {
  const markPaid = useMarkPayoutPaid();
  const [payDialog, setPayDialog] = useState<AffiliatePayout | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const handleMarkPaid = async () => {
    if (!payDialog) return;
    try {
      await markPaid.mutateAsync({
        payoutId: payDialog.id,
        paymentReference: paymentRef || undefined,
        adminNotes: adminNotes || undefined,
      });
      toast.success("Payout marked as paid");
      setPayDialog(null);
      setPaymentRef("");
      setAdminNotes("");
    } catch (err: any) {
      toast.error(err.message || "Failed to mark payout as paid");
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-400";
      case "processing": return "bg-blue-500/20 text-blue-400";
      case "paid": return "bg-green-500/20 text-green-400";
      case "cancelled": return "bg-red-500/20 text-red-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading payouts...</div>;
  }

  if (!payouts.length) {
    return <div className="text-center py-8 text-muted-foreground">No payouts found for this period</div>;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Affiliate</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Transactions</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment Ref</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell className="text-sm font-medium">
                  {partnerNames?.[payout.partner_id] || payout.partner_id.slice(0, 8)}
                </TableCell>
                <TableCell className="text-sm">{payout.period_label}</TableCell>
                <TableCell className="text-sm">{payout.transaction_count}</TableCell>
                <TableCell className="text-sm font-medium">
                  ${(payout.total_amount_cents / 100).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Badge className={statusColor(payout.status)}>{payout.status}</Badge>
                </TableCell>
                <TableCell className="text-sm">{payout.payment_reference || "-"}</TableCell>
                <TableCell>
                  {payout.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => setPayDialog(payout)}>
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Mark Paid
                    </Button>
                  )}
                  {payout.status === "paid" && (
                    <span className="text-xs text-green-400">
                      Paid {payout.paid_at ? new Date(payout.paid_at).toLocaleDateString() : ""}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!payDialog} onOpenChange={() => setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Payout as Paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-sm">Amount: <span className="font-bold">${((payDialog?.total_amount_cents || 0) / 100).toFixed(2)}</span></p>
              <p className="text-sm">Transactions: {payDialog?.transaction_count}</p>
            </div>
            <div className="space-y-2">
              <Label>Payment Reference (e.g. PayPal transaction ID)</Label>
              <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Admin Notes</Label>
              <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Optional" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={markPaid.isPending}>
              {markPaid.isPending ? "Processing..." : "Confirm Paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
