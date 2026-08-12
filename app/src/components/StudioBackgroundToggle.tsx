import { useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * StudioBackgroundToggle - A small pill button that toggles the
 * parent render card's background between dark and light.
 *
 * Usage: Place inside a relative-positioned container alongside the render image.
 * Pass `onToggle` to receive the current bg class, or let the parent
 * read `isDark` from the callback.
 */

interface StudioBackgroundToggleProps {
  /** Current background state - parent controls the state */
  isDark: boolean;
  /** Callback when toggled */
  onToggle: () => void;
  /** Position override */
  className?: string;
}

export function StudioBackgroundToggle({ isDark, onToggle, className = "" }: StudioBackgroundToggleProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      className={`
        z-30 flex items-center gap-1 px-2 py-1 rounded-full
        backdrop-blur-sm transition-all duration-200
        ${isDark
          ? "bg-white/15 hover:bg-white/25 text-white"
          : "bg-black/15 hover:bg-black/25 text-black"
        }
        active:scale-90 touch-manipulation
        ${className}
      `}
      title={isDark ? "Switch to light studio" : "Switch to dark studio"}
      aria-label={isDark ? "Switch to light studio" : "Switch to dark studio"}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        {isDark ? "Light" : "Dark"}
      </span>
    </button>
  );
}

/**
 * Hook to manage studio background state per-card.
 * Returns [isDark, toggle, bgClass] - use bgClass on the image wrapper.
 */
export function useStudioBackground(defaultDark = true) {
  const [isDark, setIsDark] = useState(defaultDark);
  const toggle = () => setIsDark((prev) => !prev);
  const bgClass = isDark ? "bg-[#1a1a1a]" : "bg-[#f0f0f0]";
  return { isDark, toggle, bgClass } as const;
}

/**
 * Wrapper component - wraps a render image with toggleable background.
 * Drop-in replacement for image containers.
 */
interface StudioBackgroundWrapperProps {
  children: React.ReactNode;
  className?: string;
  /** Position of the toggle button */
  buttonPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

const POSITION_CLASSES = {
  "top-left": "absolute top-2 left-2",
  "top-right": "absolute top-2 right-2",
  "bottom-left": "absolute bottom-2 left-2",
  "bottom-right": "absolute bottom-2 right-2",
};

export function StudioBackgroundWrapper({
  children,
  className = "",
  buttonPosition = "bottom-left"
}: StudioBackgroundWrapperProps) {
  const { isDark, toggle, bgClass } = useStudioBackground();

  return (
    <div className={`relative ${bgClass} transition-colors duration-300 ${className}`}>
      {children}
      <StudioBackgroundToggle
        isDark={isDark}
        onToggle={toggle}
        className={POSITION_CLASSES[buttonPosition]}
      />
    </div>
  );
}
