import { Card } from '@/components/ui/card';
import { AddToAppCartButton } from './AddToAppCartButton';
import { Sparkles } from 'lucide-react';

interface AppUpsellBannerProps {
  id: string;
  title: string;
  description: string;
  priceId: string;
  priceDisplay: string;
}

export const AppUpsellBanner = ({ 
  id, 
  title, 
  description, 
  priceId, 
  priceDisplay 
}: AppUpsellBannerProps) => {
  return (
    <Card className="p-6 bg-gradient-to-r from-card to-card/50 border-border">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          <p className="text-sm font-semibold text-foreground mb-3">{priceDisplay}</p>
          <AddToAppCartButton 
            id={id}
            title={title}
            priceId={priceId}
            priceDisplay={priceDisplay}
          />
        </div>
      </div>
    </Card>
  );
};
