import { Button } from '@/components/ui/button';
import { useAppCart } from '@/contexts/AppCartContext';
import { ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AddToAppCartButtonProps {
  id: string;
  title: string;
  priceId: string;
  priceDisplay: string;
  className?: string;
}

export const AddToAppCartButton = ({ 
  id, 
  title, 
  priceId, 
  priceDisplay,
  className 
}: AddToAppCartButtonProps) => {
  const { addItem } = useAppCart();
  const { toast } = useToast();

  const handleClick = () => {
    addItem({ id, title, priceId, priceDisplay });
    toast({
      title: 'Added to cart',
      description: `${title} has been added to your app cart`
    });
  };

  return (
    <Button onClick={handleClick} className={className}>
      <ShoppingCart className="mr-2 h-4 w-4" />
      Add to Cart
    </Button>
  );
};
