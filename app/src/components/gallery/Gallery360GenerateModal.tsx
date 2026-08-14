import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { use360SpinLogic } from "@/hooks/use360SpinLogic";
import { Vehicle360LoadingState } from "@/components/visualize/Vehicle360LoadingState";
import { Vehicle360Viewer } from "@/components/visualize/Vehicle360Viewer";
import { useState } from "react";
import { Rotate3D } from "lucide-react";

interface Gallery360GenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  visualizationId: string;
  vehicleData: {
    year: string;
    make: string;
    model: string;
    type?: string;
  };
  colorData: {
    colorName: string;
    colorHex: string;
    finish: string;
    manufacturer?: string;
    colorLibrary?: string;
    mode_type?: string;
  };
  onComplete: () => void;
}

export function Gallery360GenerateModal({
  isOpen,
  onClose,
  visualizationId,
  vehicleData,
  colorData,
  onComplete
}: Gallery360GenerateModalProps) {
  const [hasStarted, setHasStarted] = useState(false);
  
  const {
    isGenerating,
    currentAngle,
    currentAngleLabel,
    generatedPreviews,
    has360Spin,
    totalAngles,
    generate360Spin,
    getSpinImagesArray
  } = use360SpinLogic({
    visualizationId,
    vehicleData,
    colorData
  });

  const handleGenerate = async () => {
    setHasStarted(true);
    await generate360Spin();
    onComplete();
  };

  const handleClose = () => {
    if (!isGenerating) {
      setHasStarted(false);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rotate3D className="w-5 h-5" />
            Generate 360° Spin View
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {!hasStarted && !isGenerating && (
            <div className="space-y-4 py-4">
              <div className="text-center space-y-3">
                <p className="text-muted-foreground">
                  Create an interactive 360° spin view of this design with {totalAngles} angles
                </p>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <p className="font-medium">
                    {vehicleData.year} {vehicleData.make} {vehicleData.model}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {colorData.colorName} • {colorData.finish}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Estimated time: ~2 minutes
                </p>
              </div>

              <Button 
                onClick={handleGenerate}
                size="lg"
                className="w-full"
              >
                <Rotate3D className="w-4 h-4 mr-2" />
                Start Generation
              </Button>
            </div>
          )}

          {isGenerating && (
            <Vehicle360LoadingState
              totalAngles={totalAngles}
              currentAngle={currentAngle}
              currentAngleLabel={currentAngleLabel}
              generatedPreviews={generatedPreviews}
              estimatedTimePerAngle={10}
            />
          )}

          {has360Spin && !isGenerating && (
            <div className="space-y-4">
              <p className="text-center text-muted-foreground">
                360° spin view generated successfully! View it in the gallery.
              </p>
              <Vehicle360Viewer 
                images={getSpinImagesArray()}
                autoRotate={true}
              />
              <Button 
                onClick={handleClose}
                className="w-full"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
