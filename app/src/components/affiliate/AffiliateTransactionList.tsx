import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AffiliateTransaction } from "@/types/affiliate";

interface AffiliateTransactionListProps {
  transactions: AffiliateTransaction[];
  loading?: boolean;
}

export function AffiliateTransactionList({ transactions, loading }: AffiliateTransactionListProps) {
  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading transactions...</div>;
  }

  if (!transactions.length) {
    return <div className="text-center py-8 text-muted-foreground">No transactions found</div>;
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-400";
      case "included_in_payout": return "bg-blue-500/20 text-blue-400";
      case "paid": return "bg-green-500/20 text-green-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Invoice Amount</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Commission</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => (
            <TableRow key={tx.id}>
              <TableCell className="text-sm">
                {new Date(tx.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-sm">{tx.customer_email || "-"}</TableCell>
              <TableCell className="text-sm">${(tx.invoice_amount_cents / 100).toFixed(2)}</TableCell>
              <TableCell className="text-sm">{tx.commission_rate}%</TableCell>
              <TableCell className="text-sm font-medium">${(tx.commission_amount_cents / 100).toFixed(2)}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {tx.is_initial_payment ? "Initial" : "Renewal"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{tx.payout_period || "-"}</TableCell>
              <TableCell>
                <Badge className={statusColor(tx.payout_status)}>
                  {tx.payout_status.replace("_", " ")}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
