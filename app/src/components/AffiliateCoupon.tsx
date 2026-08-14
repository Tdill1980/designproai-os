import { useState } from "react";
import { useAffiliateCoupon } from "@/hooks/useAffiliateCoupon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tag, Check, X, Loader2, Percent } from "lucide-react";
import { cn } from "@/lib/utils";

interface AffiliateCouponProps {
  className?: string;
  onCouponApplied?: (discountPercent: number) => void;
  onCouponRemoved?: () => void;
}

export const AffiliateCoupon = ({
  className,
  onCouponApplied,
  onCouponRemoved,
}: AffiliateCouponProps) => {
  const { coupon, loading, error, validateCoupon, clearCoupon } =
    useAffiliateCoupon();
  const [inputCode, setInputCode] = useState("");

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await validateCoupon(inputCode);
    if (success) {
      setInputCode("");
      onCouponApplied?.(10);
    }
  };

  const handleRemove = () => {
    clearCoupon();
    onCouponRemoved?.();
  };

  // Coupon is already applied - show success state
  if (coupon) {
    return (
      <Card
        className={cn(
          "p-4 border-primary/30 bg-primary/5",
          className
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Percent className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="default"
                  className="bg-primary/20 text-primary border-primary/30 font-mono"
                >
                  {coupon.code}
                </Badge>
                <span className="flex items-center gap-1 text-sm text-green-400 font-semibold">
                  <Check className="w-3.5 h-3.5" />
                  {coupon.discount_percent}% OFF Applied
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                Referred by {coupon.affiliate_name}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemove}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    );
  }

  // Coupon input form
  return (
    <Card className={cn("p-4 border-border bg-card", className)}>
      <form onSubmit={handleApply} className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Tag className="w-4 h-4 text-primary" />
          Have a coupon code?
        </div>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter coupon code"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
            className="flex-1 font-mono uppercase"
            disabled={loading}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={loading || !inputCode.trim()}
            className="border-primary/30 hover:bg-primary/10"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Apply"
            )}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <X className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </p>
        )}
      </form>
    </Card>
  );
};
