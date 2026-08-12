import { Badge } from "@/components/ui/badge";
import { Rotate3D } from "lucide-react";

interface Gallery360BadgeProps {
  onClick: () => void;
}

export function Gallery360Badge({ onClick }: Gallery360BadgeProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full 
                 bg-gradient-to-r from-blue-500 to-blue-400 text-white text-xs font-semibold
                 shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 
                 transition-all duration-300 hover:scale-105 border-0"
    >
      <Rotate3D className="w-3 h-3" />
      <span>360°</span>
    </button>
  );
}
