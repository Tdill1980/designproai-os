/**
 * PanelPrintReadyButton — per-panel "Create Print-Ready File" action.
 *
 * Calls the upscale-panel-to-print edge function (Real-ESRGAN 4x + 150 DPI
 * TIFF metadata) for a single panel using its width_inches/height_inches,
 * then surfaces three actions:
 *   - Download high-res PNG
 *   - Download print-ready TIFF (150 DPI tagged)
 *   - Push the upscaled PNG into the user's WrapBox pack for this job
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { addUpscaledElementToWrapBox } from "@/lib/wrapboxElements";
import { showPaywall } from "@/lib/paywall";

type PanelLike = {
  name: string;
  label?: string;
  width_inches?: number;
  height_inches?: number;
  pngPath?: string;
  storage_path?: string;
  signed_url?: string;
  preview_url?: string;
};

interface Props {
  panel: PanelLike;
  jobId: string;
  orderNumber: string;
  shopId: string | null | undefined;
  vehicleInfo?: { year?: string; make?: string; model?: string } | null;
  finishType?: string | null;
}

type Phase = "idle" | "running" | "done" | "error";

export default function PanelPrintReadyButton({
  panel,
  jobId,
  orderNumber,
  shopId,
  vehicleInfo,
  finishType,
}: Props) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [tiffUrl, setTiffUrl] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);

  const inputPath = panel.pngPath || panel.storage_path;
  const widthInches = panel.width_inches;
  const heightInches = panel.height_inches;

  const canRun =
    !!inputPath && !!widthInches && !!heightInches && phase !== "running";

  const run = async () => {
    if (!canRun) {
      toast({
        title: "Missing panel data",
        description:
          "This panel doesn't have a storage path or dimensions yet — re-run the panelizer step.",
        variant: "destructive",
      });
      return;
    }

    setPhase("running");
    setPngUrl(null);
    setTiffUrl(null);
    setPushed(false);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke(
        "upscale-panel-to-print",
        {
          body: {
            inputPath,
            panelKey: panel.name,
            widthInches,
            heightInches,
            userId: user.id,
            jobId,
            targetDpi: 150,
          },
        },
      );
      if (error) {
        // Production-pack paywall: the export gate returns 402 { code:
        // "pack_required", generation_id } when this design hasn't been paid
        // for. Read the 402 body (supabase-js puts it on error.context) and
        // fire the global paywall scoped to THIS generation instead of a
        // generic failure toast. Admin/tester never hit this (server bypass).
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            if (ctx.status === 402 || body?.code === "pack_required") {
              showPaywall(body);
              setPhase("idle");
              return;
            }
          } catch { /* body wasn't JSON — fall through to the generic error */ }
        }
        throw new Error(error.message || "Upscale failed");
      }

      const png = (data as any)?.pngSignedUrl as string | undefined;
      const tiff = (data as any)?.tiffSignedUrl as string | undefined;
      if (!png && !tiff) throw new Error("Edge function returned no output URLs");

      setPngUrl(png ?? null);
      setTiffUrl(tiff ?? null);
      setPhase("done");
      toast({
        title: "Print-ready file created",
        description: `${panel.label || panel.name} upscaled to 150 DPI at ${widthInches}" × ${heightInches}"`,
      });
    } catch (err: any) {
      console.error("[PanelPrintReady] failed", err);
      setPhase("error");
      toast({
        title: "Upscale failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const pushToWrapBox = async () => {
    if (!pngUrl || !shopId) {
      toast({
        title: "Cannot push to WrapBox",
        description: !shopId
          ? "No active shop selected for your account."
          : "Upscale the panel first.",
        variant: "destructive",
      });
      return;
    }
    setPushing(true);
    try {
      await addUpscaledElementToWrapBox({
        job: {
          jobId,
          orderNumber,
          vehicleInfo: vehicleInfo ?? null,
          finishType: finishType ?? null,
        },
        shopId,
        imageUrl: pngUrl,
        label: `${panel.label || panel.name} (150 DPI)`,
        kind: "element",
        width: widthInches,
        height: heightInches,
      });
      setPushed(true);
      toast({
        title: "Pushed to WrapBox",
        description: `${panel.label || panel.name} added to this job's WrapBox pack.`,
      });
    } catch (err: any) {
      toast({
        title: "WrapBox push failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  };

  const baseBtn: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid transparent",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };

  if (phase === "done" && (pngUrl || tiffUrl)) {
    return (
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {pngUrl && (
          <a
            href={pngUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            style={{ ...baseBtn, background: "#0ea5e9", color: "#fff" }}
          >
            ⬇ PNG
          </a>
        )}
        {tiffUrl && (
          <a
            href={tiffUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            style={{ ...baseBtn, background: "#8b5cf6", color: "#fff" }}
          >
            ⬇ TIFF
          </a>
        )}
        <button
          type="button"
          onClick={pushToWrapBox}
          disabled={pushing || pushed || !pngUrl}
          style={{
            ...baseBtn,
            background: pushed ? "#16a34a" : "#111",
            color: "#fff",
            opacity: pushing ? 0.6 : 1,
          }}
        >
          {pushed ? "✓ In WrapBox" : pushing ? "Pushing…" : "→ WrapBox"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={!canRun}
      style={{
        ...baseBtn,
        marginTop: 10,
        width: "100%",
        justifyContent: "center",
        background: canRun ? "linear-gradient(135deg, #0ea5e9, #8b5cf6)" : "#e5e7eb",
        color: canRun ? "#fff" : "#9ca3af",
        opacity: phase === "running" ? 0.7 : 1,
      }}
    >
      {phase === "running"
        ? "Upscaling… (~30s)"
        : phase === "error"
          ? "Retry — Create Print-Ready File"
          : "Create Print-Ready File (150 DPI)"}
    </button>
  );
}
