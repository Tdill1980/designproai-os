import { useAppCart } from '@/contexts/AppCartContext';
import { AffiliateCoupon } from '@/components/AffiliateCoupon';
import { useAffiliateCoupon } from '@/hooks/useAffiliateCoupon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, ShoppingCart } from 'lucide-react';

const AppCart = () => {
  const { items, removeItem, clearCart } = useAppCart();
  const { coupon } = useAffiliateCoupon();

  const handleCheckout = () => {
    if (items.length === 0) return;
    const params = new URLSearchParams({ priceId: items[0].priceId });
    if (coupon?.code) params.set("coupon", coupon.code);
    window.location.assign(`/checkout?${params.toString()}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-8 text-foreground">Your App Cart</h1>

          {items.length === 0 ? (
            <Card className="p-12 text-center bg-card border-border">
              <ShoppingCart className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-2xl font-semibold mb-2 text-foreground">Your cart is empty</h2>
              <p className="text-muted-foreground mb-6">
                Add digital products, modules, or AI features to get started
              </p>
              <Button onClick={() => window.location.href = '/tools'}>
                Browse Tools
              </Button>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Items List */}
              <Card className="p-6 bg-card border-border">
                <h2 className="text-xl font-semibold mb-4 text-foreground">Items ({items.length})</h2>
                <div className="space-y-4">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 bg-background rounded-lg border border-border"
                    >
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
              </Card>

              {/* Affiliate Coupon */}
              <AffiliateCoupon />

              {/* Actions */}
              <Card className="p-6 bg-card border-border">
                <div className="space-y-3">
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleCheckout}
                  >
                    {coupon
                      ? `Checkout with ${coupon.discount_percent}% Off`
                      : "Checkout with Stripe"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={clearCart}
                  >
                    Clear Cart
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>

    </div>
  );
};

export default AppCart;
