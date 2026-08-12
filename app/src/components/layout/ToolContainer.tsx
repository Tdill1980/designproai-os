import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToolContainerProps {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
}

export function ToolContainer({ children, className, fullWidth = false }: ToolContainerProps) {
  return (
    <div 
      className={cn(
        "w-full px-4 sm:px-6 py-6 sm:py-10",
        !fullWidth && "max-w-7xl mx-auto",
        className
      )}
    >
      {children}
    </div>
  );
}
