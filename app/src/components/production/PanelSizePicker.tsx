/**
 * PanelSizePicker - Auto-determines panel size from vehicle make/model.
 *
 * No manual picker - the sq ft spreadsheet decides the correct size.
 * Displays the auto-determined size as a read-only badge.
 *
 * 4 sizes from WePrintWraps production specs:
 *   Small  - 144" × 59.5" - Sedans, coupes
 *   Medium - 172" × 59.5" - Midsize SUVs, crossovers
 *   Large  - 200" × 59.5" - Full-size trucks, vans
 *   XL     - 240" × 59.5" - Box trucks, extended vans
 */

import { useEffect, useRef } from "react";
import { SIDE_PANELS, type SidePanelSize } from "@/lib/panelizer-config";
import { getRecommendedSize } from "@/lib/vehicle-size-validator";

interface PanelSizePickerProps {
  value: SidePanelSize;
  onChange: (size: SidePanelSize) => void;
  /** Vehicle make for auto-recommendation */
  vehicleMake?: string;
  /** Vehicle model for auto-recommendation */
  vehicleModel?: string;
  /** Vehicle year for auto-recommendation */
  vehicleYear?: string;
}

export default function PanelSizePicker({
  value,
  onChange,
  vehicleMake,
  vehicleModel,
  vehicleYear,
}: PanelSizePickerProps) {
  const didAutoSelect = useRef(false);

  // Auto-select the recommended size from vehicle measurement database
  useEffect(() => {
    if (!vehicleMake || !vehicleModel) return;
    if (didAutoSelect.current) return;

    const rec = getRecommendedSize(vehicleMake, vehicleModel, vehicleYear);
    if (rec) {
      didAutoSelect.current = true;
      onChange(rec.sideSize);
    }
  }, [vehicleMake, vehicleModel, vehicleYear, onChange]);

  // Re-fire auto-select when vehicle changes
  useEffect(() => {
    if (!vehicleMake || !vehicleModel) return;
    const rec = getRecommendedSize(vehicleMake, vehicleModel, vehicleYear);
    if (rec && rec.sideSize !== value) {
      onChange(rec.sideSize);
    }
  }, [vehicleMake, vehicleModel, vehicleYear, onChange, value]);

  // Get recommended size for display
  const recommended = vehicleMake && vehicleModel
    ? getRecommendedSize(vehicleMake, vehicleModel, vehicleYear)
    : null;

  const panel = SIDE_PANELS[value];

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 4 }}>
        Panel Size
      </h3>
      <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
        {recommended
          ? `Auto-determined: ${panel.label} (${panel.widthInches}" × ${panel.heightInches}") based on ${vehicleMake} ${vehicleModel} measurements.`
          : "Enter vehicle make and model above to auto-determine panel size."
        }
      </p>
      {/* Read-only display of auto-determined size */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        border: "2px solid #0090dd",
        background: "rgba(0, 144, 221, 0.08)",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0090dd" }}>
            {panel.label}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#0090dd", marginTop: 2 }}>
            {panel.widthInches}" × {panel.heightInches}"
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {panel.hint}
          </div>
        </div>
        {recommended && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#fff", background: "#0090dd",
            padding: "2px 10px", borderRadius: 6, whiteSpace: "nowrap",
            letterSpacing: 0.5,
          }}>
            Auto from Spreadsheet
          </span>
        )}
      </div>
    </div>
  );
}
