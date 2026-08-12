/**
 * PreciseEditDialog — Modal wrapper around PreciseEditCanvas.
 *
 * Opens a large centered dialog containing the click/box-select canvas.
 * Caller supplies imageUrl (the current view render) and onSave (persist
 * the returned new URL to the DB + update local state).
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PreciseEditCanvas } from "./PreciseEditCanvas";
import type { LogoLayer } from "@/types/revision-logo";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  onSave: (newRenderUrl: string) => void | Promise<void>;
  viewLabel?: string;
  // Source render context — forwarded to revise-render-masked so the wrap-aware
  // prompt builder can tell Flux Fill which material/finish to paint instead
  // of leaving it to guess from pixels alone.
  finish?: string | null;
  colorName?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  // Enables the self-healing removal + draggable lifted-element flow.
  userId?: string | null;
  onElementLifted?: (layer: LogoLayer, healedBgUrl: string) => void;
  // Which sub-tool the editor opens on: "box" (default) or "markup" to land
  // directly on the MarkupIQ draw tools (CutLine / Delete / Move / Pen).
  defaultMode?: "click" | "box" | "markup";
}

export function PreciseEditDialog({
  open,
  onOpenChange,
  imageUrl,
  onSave,
  viewLabel,
  finish,
  colorName,
  vehicleMake,
  vehicleModel,
  userId,
  onElementLifted,
  defaultMode = "box",
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl h-[90vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {defaultMode === "markup" ? "MarkupIQ — draw on the render" : "Precise Edit"}
            {viewLabel && <span className="text-sm font-normal text-zinc-400">— {viewLabel}</span>}
          </DialogTitle>
        </DialogHeader>
        {imageUrl ? (
          <div className="flex-1 min-h-0">
            <PreciseEditCanvas
              imageUrl={imageUrl}
              onSave={onSave}
              onClose={() => onOpenChange(false)}
              finish={finish}
              colorName={colorName}
              vehicleMake={vehicleMake}
              vehicleModel={vehicleModel}
              userId={userId}
              onElementLifted={onElementLifted}
              defaultMode={defaultMode}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            No image selected
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
