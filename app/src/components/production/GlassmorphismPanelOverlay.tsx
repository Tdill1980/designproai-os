/**
 * GlassmorphismPanelOverlay - OS-level panel overlay system
 *
 * Uses the 4 standard panel size templates from panelizer-config.ts:
 *   1. Side (driver/passenger): 144–240" × 59.5"
 *   2. Hood / Rear:             72" × 59.5"  /  72.5" × 59"
 *   3. Roof:                    72–160" × 59.5"
 *   4. Bumper:                  120" × 38"
 *
 * Given a viewType, the component deploys the correct panel template
 * over the vehicle body area - NOT the entire image.
 *
 * Usage:
 *   <GlassmorphismPanelOverlay viewType="side" sidePanelSize="medium" />
 *   <GlassmorphismPanelOverlay viewType="side" sidePanelSize="large" twoPanel />
 *   <GlassmorphismPanelOverlay viewType="hood_detail" />
 *   <GlassmorphismPanelOverlay viewType="front" />
 */

import React from "react";
import {
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  formatDimension,
  type SidePanelSize,
} from "@/lib/panelizer-config";

// ── Deterministic panel overlay positioning ──────────────────────
//
// Side panel overlays span the FULL visible vehicle body (bumper to bumper).
// The panel must cover the entire side - if the selected size is correct,
// it covers the vehicle end-to-end. Dimensions labels show actual inches.
//
// For two-panel mode (vehicles taller than 59.5"), the overlay splits
// into upper + lower panels, each labeled with their own dimensions.

const MAX_BODY_WIDTH_PCT = 92;  // Full body coverage (bumper to bumper)
const BODY_CENTER_PCT = 50;     // Vehicle body is centered in the frame
const SIDE_TOP_PCT = 18;        // Roof line position
const SIDE_HEIGHT_PCT = 56;     // Roof-to-rocker height

// Two-panel split: upper and lower each get ~46% of the body height
// with a 4% visual gap between them showing the body-line break.
const TWO_PANEL_UPPER_TOP_PCT = 16;
const TWO_PANEL_UPPER_HEIGHT_PCT = 26;
const TWO_PANEL_LOWER_TOP_PCT = 46;
const TWO_PANEL_LOWER_HEIGHT_PCT = 28;

/**
 * Side panels always span bumper-to-bumper (full body width).
 * The selected panel size determines the DIMENSIONS shown, not overlay width.
 */
function computeSidePos(): React.CSSProperties {
  const widthPct = MAX_BODY_WIDTH_PCT;
  const leftPct = BODY_CENTER_PCT - widthPct / 2;
  return {
    top: `${SIDE_TOP_PCT}%`,
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    height: `${SIDE_HEIGHT_PCT}%`,
  };
}

/** Upper panel position for two-panel mode */
function computeUpperPos(): React.CSSProperties {
  const widthPct = MAX_BODY_WIDTH_PCT;
  const leftPct = BODY_CENTER_PCT - widthPct / 2;
  return {
    top: `${TWO_PANEL_UPPER_TOP_PCT}%`,
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    height: `${TWO_PANEL_UPPER_HEIGHT_PCT}%`,
  };
}

/** Lower panel position for two-panel mode */
function computeLowerPos(): React.CSSProperties {
  const widthPct = MAX_BODY_WIDTH_PCT;
  const leftPct = BODY_CENTER_PCT - widthPct / 2;
  return {
    top: `${TWO_PANEL_LOWER_TOP_PCT}%`,
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    height: `${TWO_PANEL_LOWER_HEIGHT_PCT}%`,
  };
}

interface PanelZone {
  id: string;
  label: string;
  widthInches: number;
  heightInches: number;
  /** CSS position within the image container - computed from panel dimensions */
  pos: React.CSSProperties;
  mirrored?: boolean;
  mirrorNote?: string;
  /**
   * True only when the server matched a validated panel to this zone, so
   * widthInches/heightInches are this vehicle's real GENIE-resolved size.
   * False/absent means they are generic tier placeholders used for layout,
   * and the label must not present them as a measurement.
   */
  resolved?: boolean;
  /** "upper" or "lower" for two-panel mode */
  section?: "upper" | "lower";
}

/**
 * Build the panel zone(s) for a given view type.
 * Side panels use the customer-selected size - overlay spans full body.
 * Add-on panels (hood, bumpers, rear) are fixed universal sizes.
 */
function getPanelZones(
  viewType: string,
  sidePanelSize: SidePanelSize = "medium",
  twoPanel: boolean = false,
): PanelZone[] {
  const side = SIDE_PANELS[sidePanelSize];

  switch (viewType) {
    // ── Side views: overlay spans full body (bumper to bumper) ──
    // Two-panel mode splits into upper + lower for tall vehicles.
    case "side":
    case "driver-side":
      if (twoPanel) {
        return [
          {
            id: "driver-upper",
            label: "Driver Upper",
            widthInches: side.widthInches,
            heightInches: side.heightInches,
            pos: computeUpperPos(),
            mirrored: true,
            mirrorNote: "Passenger upper mirrored",
            section: "upper",
          },
          {
            id: "driver-lower",
            label: "Driver Lower",
            widthInches: side.widthInches,
            heightInches: side.heightInches,
            pos: computeLowerPos(),
            mirrored: true,
            mirrorNote: "Passenger lower mirrored",
            section: "lower",
          },
        ];
      }
      return [{
        id: "driver-side",
        label: "Driver Side",
        widthInches: side.widthInches,
        heightInches: side.heightInches,
        pos: computeSidePos(),
        mirrored: true,
        mirrorNote: "Passenger side mirrored",
      }];

    case "passenger-side":
      if (twoPanel) {
        return [
          {
            id: "passenger-upper",
            label: "Passenger Upper",
            widthInches: side.widthInches,
            heightInches: side.heightInches,
            pos: computeUpperPos(),
            mirrored: true,
            mirrorNote: "Driver upper mirrored",
            section: "upper",
          },
          {
            id: "passenger-lower",
            label: "Passenger Lower",
            widthInches: side.widthInches,
            heightInches: side.heightInches,
            pos: computeLowerPos(),
            mirrored: true,
            mirrorNote: "Driver lower mirrored",
            section: "lower",
          },
        ];
      }
      return [{
        id: "passenger-side",
        label: "Passenger Side",
        widthInches: side.widthInches,
        heightInches: side.heightInches,
        pos: computeSidePos(),
        mirrored: true,
        mirrorNote: "Driver side mirrored",
      }];

    // ── Hood view: single squarish panel ──
    case "hood_detail":
      return [{
        id: "hood",
        label: "Hood",
        widthInches: ADDON_PANELS.hood.widthInches,
        heightInches: ADDON_PANELS.hood.heightInches,
        pos: { top: "8%", left: "8%", width: "84%", height: "84%" },
      }];

    // ── Front view: hood + front bumper (stacked) ──
    case "front":
      return [
        {
          id: "hood-front",
          label: "Hood (Front View)",
          widthInches: ADDON_PANELS.hood.widthInches,
          heightInches: ADDON_PANELS.hood.heightInches,
          pos: { top: "6%", left: "15%", width: "70%", height: "42%" },
        },
        {
          id: "front-bumper",
          label: "Front Bumper",
          widthInches: ADDON_PANELS.frontBumper.widthInches,
          heightInches: ADDON_PANELS.frontBumper.heightInches,
          pos: { top: "52%", left: "10%", width: "80%", height: "40%" },
        },
      ];

    // ── Rear view: rear/trunk + rear bumper (stacked) ──
    case "rear":
      return [
        {
          id: "rear-trunk",
          label: "Rear / Trunk",
          widthInches: ADDON_PANELS.rear.widthInches,
          heightInches: ADDON_PANELS.rear.heightInches,
          pos: { top: "6%", left: "12%", width: "76%", height: "48%" },
        },
        {
          id: "rear-bumper",
          label: "Rear Bumper",
          widthInches: ADDON_PANELS.rearBumper.widthInches,
          heightInches: ADDON_PANELS.rearBumper.heightInches,
          pos: { top: "58%", left: "10%", width: "80%", height: "34%" },
        },
      ];

    // ── Close-up / Hero: full wrap coverage ──
    case "close-up":
      return [{
        id: "detail",
        label: "Detail Panel",
        widthInches: side.widthInches,
        heightInches: side.heightInches,
        pos: { top: "8%", left: "8%", width: "84%", height: "84%" },
      }];

    default:
      // Fallback: side panel - full body coverage
      return [{
        id: "driver-side",
        label: "Driver Side",
        widthInches: side.widthInches,
        heightInches: side.heightInches,
        pos: computeSidePos(),
      }];
  }
}

// ── Glassmorphism styles ────────────────────────────────────────

const PANEL_STYLE_LIT: React.CSSProperties = {
  border: "2px solid rgba(0, 200, 255, 1)",
  borderRadius: 6,
  background: "rgba(0, 120, 220, 0.08)",
  boxShadow: "0 0 10px rgba(0, 180, 255, 0.7), 0 0 20px rgba(0, 160, 240, 0.4), inset 0 0 8px rgba(0, 200, 255, 0.15)",
  transition: "all 1.5s ease-in-out",
  animation: "panelBorderGlow 2.5s ease-in-out infinite",
};

const PANEL_STYLE_UNLIT: React.CSSProperties = {
  border: "1px solid rgba(0, 100, 180, 0.3)",
  borderRadius: 6,
  background: "rgba(0, 80, 180, 0.04)",
  boxShadow: "none",
  transition: "all 1.5s ease-in-out",
};

// ── Component ───────────────────────────────────────────────────

interface GlassmorphismPanelOverlayProps {
  /** Which camera angle / view type */
  viewType: string;
  /** Customer-selected side panel size (drives dimension labels) */
  sidePanelSize?: SidePanelSize;
  /** Is this panel "lit" (QC passed)? Default true for non-production contexts */
  lit?: boolean;
  /** Show the Universal Panelizer badge? Default true */
  showBadge?: boolean;
  /** Show dimension labels along edges? Default true */
  showDimensions?: boolean;
  /** Two-panel mode for tall vehicles (body height > 59.5"). Shows upper + lower panels */
  twoPanel?: boolean;
  /** Real validated panels from panelizer_jobs.panels - overrides generic tier dimensions */
  realPanels?: Array<{ id?: string; panelKey?: string; label?: string; widthInches: number; heightInches: number; mirrored?: boolean; panelType?: string }>;
  /** Total sq ft from validate step */
  totalSqFt?: number;
  /**
   * Bleed per edge, in inches, as the SERVER resolved it. Optional and
   * deliberately un-defaulted: this label used to carry a half-inch bleed
   * figure as a string literal while the deterministic slicer trimmed to a
   * five-inch mirror bleed, so the page stated a number ten times off the file
   * being built. No value means the label says nothing about bleed rather than
   * inventing one.
   */
  bleedInches?: number;
}

export default function GlassmorphismPanelOverlay({
  viewType,
  sidePanelSize = "medium",
  lit = true,
  showBadge = true,
  showDimensions = true,
  twoPanel = false,
  realPanels,
  totalSqFt,
  bleedInches,
}: GlassmorphismPanelOverlayProps) {
  const bleedNote =
    typeof bleedInches === "number" && bleedInches > 0
      ? ` + ${bleedInches}" bleed`
      : "";
  // If real validated panels exist, override the generic tier dimensions
  let zones = getPanelZones(viewType, sidePanelSize, twoPanel);
  if (realPanels && realPanels.length > 0) {
    zones = zones.map(zone => {
      const zoneId = (zone.id || "").toLowerCase();
      const zoneLabelLower = (zone.label || "").toLowerCase();

      // Find the best matching real panel from the server (panelizer-step-validate)
      const realPanel = realPanels.find(p => {
        const pKey = (p.panelKey || p.id || "").toLowerCase();
        const pLabel = (p.label || "").toLowerCase();

        // Exact key match (e.g., zone.id="driver-side" matches panelKey="driver-side")
        if (pKey === zoneId) return true;

        // Driver side zones match any driver panel (including "driver-side-panel1", "driver-side-panel2")
        if ((zoneId.includes("driver") || zoneLabelLower.includes("driver")) &&
            (pKey.includes("driver") || pLabel.includes("driver"))) return true;

        // Passenger side zones match any passenger panel
        if ((zoneId.includes("passenger") || zoneLabelLower.includes("passenger")) &&
            (pKey.includes("passenger") || pLabel.includes("passenger"))) return true;

        // Hood
        if ((zoneId === "hood" || zoneId === "hood-front" || zoneLabelLower.includes("hood")) &&
            (pKey.includes("hood") || pLabel.includes("hood"))) return true;

        // Rear bumper (check before "rear" to avoid false match)
        if ((zoneId === "rear-bumper" || zoneLabelLower.includes("rear bumper")) &&
            (pKey.includes("rear-bumper") || pLabel.includes("rear bumper"))) return true;

        // Rear / trunk
        if ((zoneId === "rear-trunk" || zoneId === "rear" || (zoneLabelLower.includes("rear") && !zoneLabelLower.includes("bumper"))) &&
            (pKey === "rear" || pLabel.includes("rear")) && !pKey.includes("bumper")) return true;

        // Front bumper
        if ((zoneId === "front-bumper" || zoneLabelLower.includes("front bumper")) &&
            (pKey.includes("front-bumper") || pLabel.includes("front bumper"))) return true;

        // Roof
        if ((zoneId === "roof" || zoneLabelLower.includes("roof")) &&
            (pKey.includes("roof") || pLabel.includes("roof"))) return true;

        return false;
      });

      if (realPanel) {
        return {
          ...zone,
          widthInches: realPanel.widthInches,
          heightInches: realPanel.heightInches,
          // Only a panel matched from the server carries GENIE-resolved
          // dimensions. Everything else is the generic tier table and must
          // never be printed as though it were this vehicle's real size.
          resolved: true,
        };
      }
      return zone;
    });
  }

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      {/* GENIE Production Panelizer OS badge - neon blue glass */}
      {showBadge && (
        <div className="gpo-badge" style={{
          position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
          display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 2,
          background: "rgba(0, 80, 180, 0.25)",
          borderRadius: 10,
          border: "1px solid rgba(0, 180, 255, 0.6)",
          boxShadow: "0 0 12px rgba(0, 160, 255, 0.4), inset 0 0 8px rgba(0, 140, 255, 0.1)",
          zIndex: 20, maxWidth: "90%",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00c8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span className="gpo-badge-title" style={{ fontWeight: 800, color: "#00d4ff", textShadow: "0 0 10px rgba(0, 180, 255, 0.9), 0 1px 4px rgba(0,0,0,0.8)", fontFamily: "Inter, sans-serif", textTransform: "uppercase" as const }}>
              GENIE Production Panelizer OS
            </span>
          </div>
          <span className="gpo-badge-tagline" style={{ fontWeight: 700, color: "rgba(0, 220, 255, 0.9)", fontFamily: "Inter, sans-serif", textTransform: "uppercase" as const, textShadow: "0 0 8px rgba(0, 180, 255, 0.7), 0 1px 3px rgba(0,0,0,0.8)" }}>
            When All Panels Glow, It's a Go
          </span>
          {totalSqFt && totalSqFt > 0 && (
            <span className="gpo-badge-sqft" style={{ fontWeight: 700, letterSpacing: 0.5, color: "#4ade80", fontFamily: "Inter, sans-serif", textShadow: "0 0 6px rgba(74, 222, 128, 0.6), 0 1px 3px rgba(0,0,0,0.8)" }}>
              {Math.round(totalSqFt)} sq ft total wrap area
            </span>
          )}
        </div>
      )}

      {/* Panel zone overlays */}
      {zones.map((zone) => {
        // A zone only shows a measurement when the SERVER resolved one for this
        // vehicle. Unresolved zones fall back to the generic tier table
        // (SIDE_PANELS/ADDON_PANELS/ROOF_PANELS), which is a placeholder for
        // laying out the overlay — not a size anyone may print or approve
        // against. Live 2026-08-03: an F-250 Super Duty's panelizer job carried
        // `panels: []`, so this page displayed the "medium" tier — 172" x 59.5",
        // hinted "Midsize SUVs, crossovers" — beside a 2D proof that read
        // 214" x 56". Two numbers for one truck, and the fake one looked
        // confident. An unresolved dimension is now an HONEST GAP, the same rule
        // the panel pipeline already follows.
        const dims = zone.resolved
          ? formatDimension(zone.widthInches, zone.heightInches)
          : null;
        const style = lit ? PANEL_STYLE_LIT : PANEL_STYLE_UNLIT;

        return (
          <React.Fragment key={zone.id}>
            {/* The glassmorphism panel */}
            <div style={{ position: "absolute", ...zone.pos, ...style }}>
              {/* Panel label - top-left, neon blue glass */}
              <span className="gpo-panel-label" style={{
                position: "absolute", top: 8, left: 10, fontWeight: 800,
                color: lit ? "#00d4ff" : "rgba(0, 160, 240, 0.7)",
                textShadow: lit ? "0 0 8px rgba(0, 180, 255, 0.9), 0 1px 4px rgba(0,0,0,0.9)" : "0 1px 3px rgba(0,0,0,0.8)",
                fontFamily: "Inter, sans-serif", textTransform: "uppercase" as const,
                background: "rgba(0, 80, 180, 0.25)",
                borderRadius: 4,
                border: "1px solid rgba(0, 180, 255, 0.35)",
                boxShadow: lit ? "0 0 6px rgba(0, 160, 255, 0.3), inset 0 0 4px rgba(0, 140, 255, 0.1)" : "none",
                transition: "all 1.5s ease-in-out",
              }}>
                {zone.label}
              </span>

              {/* Dimensions + mirror note - bottom-left, neon blue glass */}
              <span className="gpo-panel-dims" style={{
                position: "absolute", bottom: 8, left: 10, fontWeight: 700,
                color: lit ? "#00d4ff" : "rgba(0, 160, 240, 0.7)",
                textShadow: lit ? "0 0 8px rgba(0, 180, 255, 0.9), 0 1px 4px rgba(0,0,0,0.9)" : "0 1px 3px rgba(0,0,0,0.8)",
                fontFamily: "Inter, sans-serif",
                background: "rgba(0, 80, 180, 0.25)",
                borderRadius: 4,
                border: "1px solid rgba(0, 180, 255, 0.35)",
                boxShadow: lit ? "0 0 6px rgba(0, 160, 255, 0.3), inset 0 0 4px rgba(0, 140, 255, 0.1)" : "none",
                whiteSpace: "nowrap" as const, transition: "all 1.5s ease-in-out",
                maxWidth: "calc(100% - 20px)", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {dims
                  ? `${dims}${bleedNote}${zone.mirrorNote ? ` - ${zone.mirrorNote}` : ""}`
                  : `Sizing…${zone.mirrorNote ? ` - ${zone.mirrorNote}` : ""}`}
              </span>

              {/* Section indicator for two-panel mode */}
              {zone.section && (
                <span className="gpo-section-label" style={{
                  position: "absolute", top: 8, right: 40, fontWeight: 700,
                  color: lit ? "#00d4ff" : "rgba(0, 160, 240, 0.6)",
                  textShadow: lit ? "0 0 8px rgba(0, 180, 255, 0.9), 0 1px 3px rgba(0,0,0,0.8)" : "0 1px 3px rgba(0,0,0,0.8)",
                  fontFamily: "Inter, sans-serif", letterSpacing: 1,
                  textTransform: "uppercase" as const,
                  background: "rgba(0, 80, 180, 0.25)",
                  borderRadius: 4,
                  border: "1px solid rgba(0, 180, 255, 0.3)",
                  boxShadow: lit ? "0 0 6px rgba(0, 160, 255, 0.25)" : "none",
                }}>
                  {zone.section === "upper" ? "Section 1 of 2" : "Section 2 of 2"}
                </span>
              )}

              {/* Checkmark when lit */}
              {lit && (
                <div style={{
                  position: "absolute", top: -6, right: -6, width: 20, height: 20,
                  background: "#00c8ff", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 8px rgba(0, 200, 255, 0.8), 0 0 16px rgba(0, 160, 255, 0.4)", zIndex: 11,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </div>

            {/* Dimension labels along edges.
                Gated on `resolved` for the same reason as the panel label: the
                edge rulers state a measurement in inches, and the width ruler
                is what rendered "172"" beside an F-250 whose proof said 214".
                An unresolved zone draws its glass panel and no ruler. */}
            {showDimensions && zone.resolved && (
              <>
                {/* Height dimension - left edge */}
                <div className="gpo-dim-edge-wrap" style={{
                  position: "absolute",
                  top: zone.pos.top,
                  left: "1%",
                  height: zone.pos.height as string,
                  display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center",
                  zIndex: 20,
                }}>
                  <div style={{ width: 2, flex: 1, background: "rgba(0, 200, 255, 0.8)" }} />
                  <span className="gpo-dim-edge" style={{
                    fontWeight: 800, color: "#00d4ff",
                    textShadow: "0 0 10px rgba(0, 180, 255, 0.9), 0 1px 4px rgba(0,0,0,0.9)",
                    fontFamily: "Inter, sans-serif", padding: "4px 0",
                    whiteSpace: "nowrap" as const,
                    writingMode: "vertical-lr" as const, transform: "rotate(180deg)",
                    background: "rgba(0, 80, 180, 0.2)",
                    borderRadius: 3,
                  }}>
                    {zone.heightInches}"
                  </span>
                  <div style={{ width: 2, flex: 1, background: "rgba(0, 200, 255, 0.8)" }} />
                </div>

                {/* Width dimension - bottom edge */}
                <div className="gpo-dim-edge-wrap" style={{
                  position: "absolute",
                  bottom: `calc(100% - ${zone.pos.top as string} - ${zone.pos.height as string} - 3%)`,
                  left: zone.pos.left,
                  width: zone.pos.width as string,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 20,
                }}>
                  <div style={{ height: 2, flex: 1, background: "rgba(0, 200, 255, 0.7)" }} />
                  <span className="gpo-dim-edge" style={{
                    fontWeight: 800, color: "#00d4ff",
                    textShadow: "0 0 10px rgba(0, 180, 255, 0.9), 0 1px 4px rgba(0,0,0,0.9)",
                    fontFamily: "Inter, sans-serif", padding: "0 8px",
                    whiteSpace: "nowrap" as const,
                    background: "rgba(0, 80, 180, 0.2)",
                    borderRadius: 3,
                  }}>
                    {zone.widthInches}"
                  </span>
                  <div style={{ height: 2, flex: 1, background: "rgba(0, 200, 255, 0.7)" }} />
                </div>
              </>
            )}
          </React.Fragment>
        );
      })}

      {/* Keyframe animations for panel glow + mobile overlay fixes */}
      <style>{`
        @keyframes panelBorderGlow {
          0%, 100% { border-color: rgba(0, 180, 255, 0.8); box-shadow: 0 0 8px rgba(0, 180, 255, 0.5), 0 0 16px rgba(0, 160, 240, 0.3), inset 0 0 6px rgba(0, 200, 255, 0.1); }
          50% { border-color: rgba(0, 220, 255, 1); box-shadow: 0 0 14px rgba(0, 200, 255, 0.8), 0 0 28px rgba(0, 180, 255, 0.4), inset 0 0 10px rgba(0, 220, 255, 0.2); }
        }
        @media (max-width: 640px) {
          .gpo-badge { display: none !important; }
          .gpo-dim-edge-wrap { display: none !important; }
          .gpo-panel-label { font-size: 8px !important; padding: 2px 5px !important; top: 4px !important; left: 4px !important; letter-spacing: 0.5px !important; }
          .gpo-panel-dims { font-size: 7px !important; padding: 1px 5px !important; bottom: 4px !important; left: 4px !important; }
          .gpo-section-label { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Re-export for convenience - the 4 standard sizes from the config.
 * Components can show a size picker using these.
 */
export { SIDE_PANELS, ADDON_PANELS, ROOF_PANELS } from "@/lib/panelizer-config";
export type { SidePanelSize } from "@/lib/panelizer-config";
