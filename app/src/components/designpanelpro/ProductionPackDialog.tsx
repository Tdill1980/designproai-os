import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Package, Loader2, Sparkles, AlertTriangle, Car, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useQuickProductionPack } from "@/hooks/useQuickProductionPack";
import { supabase } from "@/integrations/supabase/client";
import {
  PRODUCTION_PACK_PRICE_CENTS,
  type PanelSelection,
} from "@/lib/panelizer-config";

interface ProductionPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  render: {
    id: string;
    render_urls?: Record<string, string> | null;
    vehicle_year?: number | string;
    vehicle_make?: string;
    vehicle_model?: string;
    vehicle_type?: string;
    vehicleType?: string;
    body_text?: string;
    design_file_name?: string;
    color_name?: string;
    finish_type?: string;
    custom_design_url?: string;
    // Optional quote linkage: when present, the production run reuses the
    // order's RP-XXXXXX so all downstream pack files share the same number.
    quote_id?: string | null;
  } | null;
  onGenerationStarted?: () => void;
  onPackReady?: (packUrl: string, packId: string | null) => void;
}

export function ProductionPackDialog({ open, onOpenChange, render, onGenerationStarted }: ProductionPackDialogProps) {
  const navigate = useNavigate();
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [detectedInfo, setDetectedInfo] = useState<string | null>(null);
  const [totalSqFt, setTotalSqFt] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemed, setRedeemed] = useState(false);

  const { isGenerating, handleGenerate } = useQuickProductionPack();
  const declaredVehicleType = String(render?.vehicle_type || render?.vehicleType || "").trim().toLowerCase();
  const legacyVehicleText = [
    vehicleMake,
    vehicleModel,
    render?.body_text,
    render?.design_file_name,
  ].filter(Boolean).join(" ");
  const isTrailer = declaredVehicleType === "trailer"
    || (!declaredVehicleType && /\btrailers?\b/i.test(legacyVehicleText));

  // Print production is admin-side only. Customers/members REQUEST print-ready
  // files (ungated — no tier/credit gate); the design team generates them.
  // Admins keep the direct-generate path (they ARE the production team).
  const [isAdmin, setIsAdmin] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"])
        .maybeSingle();
      if (alive) setIsAdmin(!!data);
    })();
    return () => { alive = false; };
  }, []);

  // Customer path: create an unpaid Print Production Request that lands in the
  // admin queue. The browser may request work, but it cannot declare payment,
  // attach production pins, or start the workflow.
  const onRequestPrintFiles = async () => {
    if (!render || !vehicleMake.trim() || !vehicleModel.trim()) return;
    setRequesting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in to request print-ready files.");

      const proofUrl =
        render.custom_design_url ||
        (render.render_urls ? Object.values(render.render_urls)[0] : null) ||
        null;
      const { error } = await supabase.from("print_production_requests" as any).insert({
        user_id: user.id,
        design_id: render.id,
        order_number: render.quote_id || null,
        vehicle_year: render.vehicle_year ? String(render.vehicle_year) : null,
        vehicle_make: vehicleMake.trim(),
        vehicle_model: vehicleModel.trim(),
        approved_proof_url: proofUrl,
        requested_output_type: "full_wrap_panels",
        payment_status: "awaiting_payment",
        amount_cents: PRODUCTION_PACK_PRICE_CENTS,
        production_status: "awaiting_payment",
        final_files: [],
      });
      if (error) throw error;
      setRequested(true);
      toast.success("Print-ready files requested. Payment and production status will update here.");
    } catch (e: any) {
      toast.error(e.message || "Could not submit request");
    } finally {
      setRequesting(false);
    }
  };

  const onRedeem = async () => {
    const code = redeemCode.trim();
    if (!code) return;
    setRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_pack_code" as any, { p_code: code } as any);
    setRedeeming(false);
    if (error) {
      toast.error(error.message || "Could not redeem that code.");
      return;
    }
    const packs = Number(data) || 0;
    setRedeemed(true);
    setRedeemCode("");
    toast.success(`Code redeemed — ${packs} free production pack${packs === 1 ? "" : "s"} added. Hit Generate.`);
  };

  // Pre-fill make/model from render data when dialog opens
  useEffect(() => {
    if (open && render) {
      setVehicleMake(render.vehicle_make || "");
      setVehicleModel(render.vehicle_model || "");
      setRedeemCode("");
      setRedeemed(false);
    }
  }, [open, render]);

  // Auto-detect real vehicle dimensions when make/model changes
  useEffect(() => {
    if (!vehicleMake || !vehicleModel) {
      setDetectedInfo(null);
      setTotalSqFt(null);
      return;
    }

    const timer = setTimeout(async () => {
      setDetecting(true);
      try {
        const { data, error } = await supabase.functions.invoke("panelizer-step-validate", {
          body: {
            vehicleMake: vehicleMake.trim(),
            vehicleModel: vehicleModel.trim(),
            vehicleYear: render?.vehicle_year ? String(render.vehicle_year) : undefined,
            vehicleType: isTrailer ? "trailer" : (declaredVehicleType || undefined),
            bodyText: [render?.body_text, isTrailer ? "trailer" : ""].filter(Boolean).join(" "),
            estimateOnly: true,
          },
        });
        if (!error && data?.found && data.estimatedDimensions) {
          const src = data.source === "database" ? "vehicle database" : data.source === "google_search" ? "manufacturer specs" : data.source || "lookup";
          const sqFt = data.totalSqFt || data.estimatedDimensions?.totalSqFt;
          const sideW = data.estimatedDimensions?.bodyLengthInches || data.estimatedSideWidth;
          setDetectedInfo(
            sideW
              ? `${Math.round(sideW)}" side panels - ${sqFt ? `${Math.round(sqFt)} sq ft` : src}`
              : `Sized from ${src}`
          );
          setTotalSqFt(sqFt || null);
        } else {
          // found:false = GENIE couldn't verify this vehicle. Never imply a
          // generic size will be used — the order will refuse to build.
          setDetectedInfo('Vehicle not verified — check make/model spelling (e.g. "Infiniti", not "Infinity")');
          setTotalSqFt(null);
        }
      } catch {
        setDetectedInfo("Will calculate from vehicle specs");
      } finally {
        setDetecting(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [vehicleMake, vehicleModel, render?.vehicle_year, render?.body_text, isTrailer]);

  const priceDisplay = `$${(PRODUCTION_PACK_PRICE_CENTS / 100).toFixed(0)}`;

  const onGenerate = async () => {
    if (!render) return;
    if (!vehicleMake.trim() || !vehicleModel.trim()) return;

    // No more preset sizes - orchestrator will call validate to get real dims
    const selection: PanelSelection = {
      sideSize: "medium", // legacy field, orchestrator overrides with real dims
      addHood: !isTrailer,
      addFrontBumper: !isTrailer,
      addRearBumper: !isTrailer,
      roofSize: isTrailer ? "none" : "medium",
    };

    // Update render with confirmed make/model
    const updatedRender = {
      ...render,
      vehicle_make: vehicleMake.trim(),
      vehicle_model: vehicleModel.trim(),
    };

    onGenerationStarted?.();
    const jobId = await handleGenerate(updatedRender, selection);
    if (jobId) {
      onOpenChange(false);
      navigate(`/productionflow/${jobId}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-500" />
            <span className="text-gradient-designiq">GENIE Production Panelizer OS™</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Vehicle Make */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-blue-400" />
              Vehicle Make
            </Label>
            <Input
              value={vehicleMake}
              onChange={(e) => setVehicleMake(e.target.value)}
              placeholder="e.g. Ford, Toyota, Porsche"
              className="bg-secondary border-border/50 h-10"
            />
          </div>

          {/* Vehicle Model */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Vehicle Model</Label>
            <Input
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              placeholder="e.g. F-250, Camry, 911"
              className="bg-secondary border-border/50 h-10"
            />
          </div>

          {/* Auto-detected vehicle dimensions */}
          {(detectedInfo || detecting) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              {detecting ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              )}
              <span className="text-xs text-blue-300">
                {detecting ? "Looking up vehicle dimensions..." : (
                  <>Vehicle sized: <span className="font-semibold text-blue-200">{detectedInfo}</span>{totalSqFt ? <span className="ml-1 text-blue-400">({Math.round(totalSqFt)} sq ft total)</span> : null}</>
                )}
              </span>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            All panels are auto-sized from real vehicle dimensions. If not in our database, AI estimates from manufacturer specs.
          </p>

          {/* Price */}
          <div className="flex items-center justify-between py-2 border-t border-zinc-800">
            <span className="text-sm text-muted-foreground">Production Pack</span>
            <span className="text-xl font-bold text-blue-400">{priceDisplay}</span>
          </div>

          {/* Warning if no render */}
          {!render && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Generate a render first, then open this dialog.</span>
            </div>
          )}

          {/* Redeem a comp code → unlocks free packs that bypass the tier gate.
              Generation is admin-only, so customers never see this. */}
          {isAdmin && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
              <Ticket className="w-3.5 h-3.5 text-cyan-400" />
              Have a code?
            </Label>
            {redeemed ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/25 text-green-400 text-xs">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>Code redeemed — your free packs are ready. Hit Generate below.</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  placeholder="Enter code"
                  className="bg-secondary border-border/50 h-10 font-mono uppercase"
                  onKeyDown={(e) => { if (e.key === "Enter") onRedeem(); }}
                />
                <Button
                  variant="outline"
                  onClick={onRedeem}
                  disabled={redeeming || !redeemCode.trim()}
                  className="h-10 shrink-0"
                >
                  {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
                </Button>
              </div>
            )}
          </div>
          )}

          {requested ? (
            /* Customer request submitted → status only, no payment or generation. */
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Request submitted. Track payment and production status on your dashboard.</span>
            </div>
          ) : isAdmin ? (
            /* Admin/design team: generate the pack directly → ProductionFlow. */
            <Button
              onClick={onGenerate}
              disabled={isGenerating || !render || !vehicleMake.trim() || !vehicleModel.trim()}
              className={cn("w-full gap-2 font-semibold h-12 text-base", !isGenerating && render && "btn-designiq text-white border-0")}
              size="lg"
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating Job...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Order Production Pack</>
              )}
            </Button>
          ) : (
            /* Customer: request print-ready files (admin team produces them). */
            <Button
              onClick={onRequestPrintFiles}
              disabled={requesting || !render || !vehicleMake.trim() || !vehicleModel.trim()}
              className={cn("w-full gap-2 font-semibold h-12 text-base", !requesting && render && "btn-designiq text-white border-0")}
              size="lg"
            >
              {requesting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              ) : (
                <><Package className="w-4 h-4" /> Request Print-Ready Files</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
