import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Vehicle360Viewer } from "@/components/visualize/Vehicle360Viewer";
import { Rotate3D } from "lucide-react";

interface Gallery360ViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  spinImages: string[];
  title: string;
}

export function Gallery360ViewerModal({
  isOpen,
  onClose,
  spinImages,
  title
}: Gallery360ViewerModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rotate3D className="w-5 h-5" />
            360° Spin View - {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <Vehicle360Viewer 
            images={spinImages}
            autoRotate={false}
            showAngleIndicator={true}
            dragSensitivity={2}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
