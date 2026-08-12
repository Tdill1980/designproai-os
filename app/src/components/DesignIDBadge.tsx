import { cn } from "@/lib/utils";

/**
 * DESIGNID BADGE OVERLAY — Neon blue glassmorphic render overlay
 *
 * Upper Left  → Tool name pill with neon dot (Rajdhani 700, uppercase)
 * Bottom Right → Design name (white) + DID chip (palette icon) + PT chip (thumbprint icon)
 *
 * All elements use #00c8ff neon blue. This is a UI preview overlay only.
 */

interface DesignIDBadgeProps {
  /** Tool name displayed in upper-left (e.g., "DesignProAI™") */
  toolName: string;
  /** AI-generated human-readable name (e.g., "Crimson Ronin Edge") */
  designName?: string;
  /** Tamper-proof render identifier (e.g., "DID-8F4A2C1E") */
  did?: string;
  /** PromptThumbprint — cryptographic hash of creative brief (e.g., "PT-7B3E9D1FA4C2") */
  pt?: string;
  /** Whether to show PT chip (true for prompt-based tools only) */
  showPT?: boolean;
  /** Hide the upper-left tool-name pill (keeps the bottom-right DID/PT chips). */
  hideToolName?: boolean;
  /** Additional CSS classes for the wrapper */
  className?: string;
}

/** Palette icon SVG — 11x11, neon blue #00c8ff */
const PaletteIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <circle cx="8" cy="8" r="1.8" fill="#00c8ff" />
    <circle cx="14" cy="5" r="1.8" fill="#00c8ff" />
    <circle cx="18" cy="10" r="1.8" fill="#00c8ff" />
    <circle cx="16" cy="16" r="1.8" fill="#00c8ff" />
    <path
      d="M12 22c-5.5 0-10-4.5-10-10S6.5 2 12 2"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M12 22c1.5 0 3-1.5 3-3s-1.5-3-3-3H9c-1 0-2-.5-2-1.5"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

/** Thumbprint icon SVG — 11x11, neon blue #00c8ff */
const ThumbprintIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2C8.13 2 5 5.13 5 9c0 1.74.56 3.35 1.5 4.66"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M19 9c0-1.74-.56-3.35-1.5-4.66"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M8 9c0-2.21 1.79-4 4-4s4 1.79 4 4"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M12 9c0 3.5-1.5 6-3 8"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M16 9c0 2.5-.5 4.5-1.5 6.5"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M12 9v4"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M9 22c1-2 2-4.5 2-7"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M15 22c-0.5-1.5-1-3.5-1-5.5"
      stroke="#00c8ff"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

export const DesignIDBadge = ({
  toolName,
  designName,
  did,
  pt,
  showPT = false,
  hideToolName = false,
  className,
}: DesignIDBadgeProps) => {
  const hasIdentity = !!(designName || did);

  return (
    <div className={cn("absolute inset-0 pointer-events-none select-none z-10", className)}>
      {/* Upper Left — Tool name pill with neon dot */}
      {!hideToolName && (
      <div
        className="absolute top-3 left-3"
        style={{
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(0,200,255,0.18)",
          borderRadius: 6,
          padding: "5px 10px",
          backdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* Neon dot */}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#00c8ff",
            boxShadow: "0 0 6px #00c8ff",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: 12,
            color: "#00c8ff",
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
            lineHeight: 1,
          }}
        >
          {toolName}
        </span>
      </div>
      )}

      {/* Bottom Right — Design identity stack */}
      {hasIdentity && (
        <div
          className="absolute bottom-3 right-3 text-right"
          style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}
        >
          {/* Design Name */}
          {designName && (
            <span
              style={{
                fontFamily: "'Rajdhani', sans-serif",
                fontWeight: 700,
                fontSize: 17,
                color: "#ffffff",
                textShadow: "0 0 18px rgba(0,200,255,0.35)",
                lineHeight: 1.2,
              }}
            >
              {designName}
            </span>
          )}

          {/* DID + PT chips row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* DID chip */}
            {did && (
              <span
                style={{
                  background: "rgba(0,200,255,0.07)",
                  border: "1px solid rgba(0,200,255,0.22)",
                  borderRadius: 4,
                  padding: "3px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <PaletteIcon />
                <span
                  style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: 9.5,
                    color: "#00c8ff",
                    textShadow: "0 0 6px rgba(0,200,255,0.5)",
                    lineHeight: 1,
                  }}
                >
                  {did}
                </span>
              </span>
            )}

            {/* PT chip — only for prompt-based tools */}
            {showPT && pt && (
              <span
                style={{
                  background: "rgba(0,200,255,0.07)",
                  border: "1px solid rgba(0,200,255,0.22)",
                  borderRadius: 4,
                  padding: "3px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <ThumbprintIcon />
                <span
                  style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: 9.5,
                    color: "#00c8ff",
                    textShadow: "0 0 6px rgba(0,200,255,0.5)",
                    lineHeight: 1,
                  }}
                >
                  {pt}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Exported icons for use in DesignVault cards and other surfaces */
export { PaletteIcon, ThumbprintIcon };
