import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Check } from "lucide-react";
import { Badge } from "./ui/badge";

interface PricingCardProps {
  title: string;
  price: number;
  features: string[];
  tagline?: string;
  isPopular?: boolean;
  onSubscribe?: () => void;
  isCurrentPlan?: boolean;
  loading?: boolean;
}

export const PricingCard = ({ 
  title, 
  price, 
  features,
  tagline,
  isPopular = false,
  onSubscribe,
  isCurrentPlan = false,
  loading = false
}: PricingCardProps) => {
  return (
    <div className="max-w-lg mx-auto">
      <Card className={`p-8 relative ${isPopular ? 'border-primary border-2 shadow-lg' : 'bg-card border-border'}`}>
        {isPopular && (
          <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-1">
            Most Popular
          </Badge>
        )}
        <div className="text-center mb-6">
          <h3 className="text-2xl font-bold mb-2">{title}</h3>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-5xl font-bold">${price}</span>
            <span className="text-muted-foreground">/month</span>
          </div>
        </div>
        
        <ul className="space-y-4 mb-8">
          {features.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-foreground">{feature}</span>
            </li>
          ))}
        </ul>
        
        {tagline && (
          <p className="text-xs text-muted-foreground italic border-t border-border pt-4 mb-4">
            {tagline}
          </p>
        )}
        
        <Button 
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={onSubscribe}
          disabled={loading || isCurrentPlan}
        >
          {isCurrentPlan ? 'Current Plan' : loading ? 'Loading...' : 'Subscribe Now'}
        </Button>
        {!isCurrentPlan && (
          <p className="text-xs text-center text-muted-foreground mt-2">
            Cancel anytime • No contracts
          </p>
        )}
      </Card>
    </div>
  );
};