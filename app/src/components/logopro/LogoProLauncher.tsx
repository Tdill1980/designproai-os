import { useState } from "react";
import { Stamp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LogoProCore } from "./LogoProCore";

interface LogoProLauncherProps {
  /** Optional DesignPro project id to record on the LogoPro project */
  designProProjectId?: string;
  /** Pre-fill the company name if DesignPro already collected it */
  initialCompanyName?: string;
  initialBrandColors?: string[];
  /** Called when a logo is finalized while the dialog is open */
  onLogoFinalized?: (urls: { png: string; svg: string; eps: string }) => void;
  /** Compact card variant (for tight sidebars) */
  variant?: "card" | "inline";
}

export const LogoProLauncher = ({
  designProProjectId,
  initialCompanyName,
  initialBrandColors,
  onLogoFinalized,
  variant = "card",
}: LogoProLauncherProps) => {
  const [open, setOpen] = useState(false);

  const trigger =
    variant === "inline" ? (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Sparkles className="h-4 w-4" />
        Create one with LogoPro
      </Button>
    ) : (
      <Card className="border-dashed border-primary/30 bg-primary/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Stamp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Don't have a logo yet?</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Generate professional logo concepts in minutes. Designed by AI, finished by real
          designers.
        </p>
        <Button size="sm" className="w-full gap-2" onClick={() => setOpen(true)}>
          <Sparkles className="h-4 w-4" />
          Create one with LogoPro
        </Button>
      </Card>
    );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stamp className="h-5 w-5 text-primary" />
              LogoPro
            </DialogTitle>
            <DialogDescription>
              Create a logo for this wrap project. We'll save it to your brand kit when it's
              finished.
            </DialogDescription>
          </DialogHeader>
          <LogoProCore
            mode="embedded"
            returnToDesignProProjectId={designProProjectId}
            initialCompanyName={initialCompanyName}
            initialBrandColors={initialBrandColors}
            onLogoFinalized={(urls) => {
              onLogoFinalized?.(urls);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LogoProLauncher;
