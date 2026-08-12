import { ShoppingCart } from 'lucide-react';
import { useAppCart } from '@/contexts/AppCartContext';
import { Badge } from '@/components/ui/badge';

interface AppCartBubbleProps {
  onClick: () => void;
}

export const AppCartBubble = ({ onClick }: AppCartBubbleProps) => {
  const { totalItems } = useAppCart();

  if (totalItems === 0) return null;

  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-card text-foreground shadow-lg transition-transform hover:scale-110 border border-border"
      aria-label="Open app cart"
    >
      <ShoppingCart className="h-6 w-6" />
      {totalItems > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-1 -right-1 h-6 w-6 rounded-full p-0 flex items-center justify-center text-xs"
        >
          {totalItems}
        </Badge>
      )}
    </button>
  );
};
