import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PrintProThumbnailProps {
  imageUrl: string;
  title: string;
  subtitle?: string;
  selected?: boolean;
  onClick?: () => void;
}

export const PrintProThumbnail = ({ 
  imageUrl, 
  title, 
  subtitle,
  selected = false,
  onClick 
}: PrintProThumbnailProps) => {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:scale-105 overflow-hidden",
        selected && "ring-2 ring-primary shadow-lg"
      )}
      onClick={onClick}
    >
      <div className="relative" style={{ aspectRatio: '3.32 / 1' }}>
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-full object-contain bg-background"
        />
      </div>
      <div className="p-2 bg-background">
        <p className="text-xs font-medium truncate">{title}</p>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </Card>
  );
};
