import { useState } from "react";
import { Camera, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { MyVehicleToolCore } from "@/components/colorpro/MyVehicleToolCore";

interface MyVehicleTabWrapperProps {
  /** The existing tool UI component to render in "Studio" mode */
  children: React.ReactNode;
  /** Label for the studio mode tab (e.g., "Studio Render", "Fade Design") */
  studioLabel?: string;
  /** Label for the My Vehicle tab */
  myVehicleLabel?: string;
}

/**
 * Wraps any tool page with a Studio / My Vehicle tab toggle.
 * When "My Vehicle" is selected, shows the photo editing interface.
 * When "Studio" is selected, shows the original tool UI.
 */
export const MyVehicleTabWrapper = ({
  children,
  studioLabel = "Studio Render",
  myVehicleLabel = "MyVehiclePro™",
}: MyVehicleTabWrapperProps) => {
  const [activeTab, setActiveTab] = useState<"studio" | "myvehicle">("studio");

  return (
    <div>
      {/* Tab Toggle */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <button
          onClick={() => setActiveTab("studio")}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
            activeTab === "studio"
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
              : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Palette className="h-4 w-4" />
          {studioLabel}
        </button>
        <button
          onClick={() => setActiveTab("myvehicle")}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
            activeTab === "myvehicle"
              ? "bg-gradient-to-r from-blue-600 to-blue-600 text-white shadow-lg shadow-blue-500/30"
              : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Camera className="h-4 w-4" />
          {myVehicleLabel}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "studio" ? (
        <>{children}</>
      ) : (
        <MyVehicleToolCore />
      )}
    </div>
  );
};
