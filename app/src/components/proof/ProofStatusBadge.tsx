import { CheckCircle2, Clock, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProofStatusBadgeProps {
  status: string | null;
}

export function ProofStatusBadge({ status }: ProofStatusBadgeProps) {
  switch (status) {
    case 'approved':
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/30 gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approved
        </Badge>
      );
    case 'revision_requested':
      return (
        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Revision Requested
        </Badge>
      );
    case 'pending':
    default:
      return (
        <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Awaiting Review
        </Badge>
      );
  }
}
