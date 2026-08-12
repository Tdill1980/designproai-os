import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AffiliateStatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  approved: { label: 'Approved', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  active: { label: 'Active', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  suspended: { label: 'Suspended', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  clicked: { label: 'Clicked', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  signed_up: { label: 'Signed Up', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  subscribed: { label: 'Subscribed', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  churned: { label: 'Churned', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  paid: { label: 'Paid', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  cancelled: { label: 'Cancelled', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  processing: { label: 'Processing', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  scheduled: { label: 'Scheduled', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

export function AffiliateStatusBadge({ status, className }: AffiliateStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
