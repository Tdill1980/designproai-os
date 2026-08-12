import { X, Trash2, ExternalLink } from 'lucide-react';
import { useAppCart } from '@/contexts/AppCartContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

interface AppCartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppCartDrawer = ({ isOpen, onClose }: AppCartDrawerProps) => {
  const { items, removeItem, clearCart } = useAppCart();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

  const handleCheckout = () => {
    if (items.length === 0) return;
    navigate(`/checkout?priceId=${encodeURIComponent(items[0].priceId)}`);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity touch-none"
          onClick={onClose}
          onTouchMove={(e) => e.preventDefault()}
        />
      )}

      {/* Drawer */}
      <div 
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-card border-l border-border z-50 transition-transform duration-300 overflow-hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground">App Cart</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-6">
            {items.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <p>Your app cart is empty</p>
              </div>
            ) : (
              <div className="space-y-4">
                {items.map(item => (
                  <div key={item.id} className="flex items-start justify-between p-4 bg-background rounded-lg border border-border">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{item.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{item.priceDisplay}</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="p-6 border-t border-border space-y-3">
              <Button 
                className="w-full" 
                onClick={handleCheckout}
              >
                Checkout with Stripe
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => {
                  navigate('/app-cart');
                  onClose();
                }}
              >
                View Cart Page
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                className="w-full text-muted-foreground"
                onClick={clearCart}
              >
                Clear Cart
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
