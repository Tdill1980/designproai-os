import * as React from "react";
import { cn } from "@/lib/utils";

const PrintProCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-[0_0_20px_rgba(255,255,255,0.25)] hover:shadow-[0_0_30px_rgba(255,255,255,0.35)] transition-all hover:border-primary/30", 
        className
      )} 
      {...props} 
    />
  )
);
PrintProCard.displayName = "PrintProCard";

const PrintProCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
PrintProCardHeader.displayName = "PrintProCardHeader";

const PrintProCardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
PrintProCardTitle.displayName = "PrintProCardTitle";

const PrintProCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
PrintProCardDescription.displayName = "PrintProCardDescription";

const PrintProCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
);
PrintProCardContent.displayName = "PrintProCardContent";

const PrintProCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
PrintProCardFooter.displayName = "PrintProCardFooter";

export { 
  PrintProCard, 
  PrintProCardHeader, 
  PrintProCardFooter, 
  PrintProCardTitle, 
  PrintProCardDescription, 
  PrintProCardContent 
};
