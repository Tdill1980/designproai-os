import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShoppingBag, Package, Pencil, Mail, ChevronRight, ChevronLeft, Loader2,
  CheckCircle2, Clock, Camera, Upload, Building2, Phone, Globe, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getIndustryTitle, getVehicleSubtitle, isCommercialListing,
  PRINT_READY_PRICE, VEHICLE_RENDER_ADDON_PRICE, FILE_DELIVERY_HOURS,
} from "./listing-display";

/** Universal vehicle size classes for the production team. */
const UNIVERSAL_SIZES = [
  { value: "compact", label: "Compact (Civic, Corolla, 3-Series)" },
  { value: "midsize", label: "Mid-Size (Camry, Accord, A4)" },
  { value: "fullsize", label: "Full-Size (Charger, Impala, 5-Series)" },
  { value: "suv-mid", label: "Mid-Size SUV (RAV4, CR-V, X3)" },
  { value: "suv-full", label: "Full-Size SUV (Tahoe, Expedition, X5)" },
  { value: "truck-mid", label: "Mid-Size Truck (Tacoma, Ranger, Colorado)" },
  { value: "truck-full", label: "Full-Size Truck (F-150, Silverado, RAM)" },
  { value: "van", label: "Van / Sprinter / Transit" },
  { value: "sports", label: "Sports Car (Mustang, Corvette, 911)" },
  { value: "exotic", label: "Exotic / Supercar" },
] as const;

interface BuyerPopupProps {
  listing: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName?: string;
}

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_TITLES: Record<Step, string> = {
  1: "Customize This Wrap Design",
  2: "Enter Your Vehicle",
  3: "Logo & Business Info",
  4: "Add Vehicle Render?",
  5: "Confirm & Pay",
};

const STEP_LABELS = ["Design", "Vehicle", "Business", "Add-On", "Confirm"];

export function BuyerPopup({ listing, open, onOpenChange, businessName: initialBusinessName }: BuyerPopupProps) {
  const [step, setStep] = useState<Step>(1);
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [universalSize, setUniversalSize] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState(initialBusinessName || "");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessWebsite, setBusinessWebsite] = useState("");
  const [businessColors, setBusinessColors] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploadUrl, setLogoUploadUrl] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [wantsVehicleRender, setWantsVehicleRender] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Pre-fill email from auth + reset when listing changes
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setVehicleYear("");
    setVehicleMake("");
    setVehicleModel("");
    setUniversalSize("");
    setBusinessName(initialBusinessName || "");
    setBusinessPhone("");
    setBusinessWebsite("");
    setBusinessColors("");
    setLogoFile(null);
    setLogoUploadUrl("");
    // Honour the `_addon_vehicle_render` flag set by the secondary
    // card CTA — that button means the buyer already opted in, so we
    // pre-check the step-4 add-on for them.
    setWantsVehicleRender(!!(listing as { _addon_vehicle_render?: boolean })?._addon_vehicle_render);
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user?.email) setEmail(data.session.user.email);
    });
  }, [listing?.id, open, initialBusinessName]);

  if (!listing) return null;

  const commercial = isCommercialListing(listing);
  const industryTitle = getIndustryTitle(listing);
  const vehicleShown = getVehicleSubtitle(listing);
  const basePrice = listing.price || PRINT_READY_PRICE;
  const addonPrice = wantsVehicleRender ? VEHICLE_RENDER_ADDON_PRICE : 0;
  const total = basePrice + addonPrice;

  const canGoNext = (): boolean => {
    if (step === 1) return true;
    if (step === 2) return !!(vehicleMake.trim() && vehicleModel.trim() && universalSize);
    // Step 3 is required for commercial cards (business name); for
    // creative cards we let people skip ahead without filling anything.
    if (step === 3) return commercial ? businessName.trim().length > 0 : true;
    if (step === 4) return true;
    return false;
  };

  const goNext = () => {
    if (step < 5 && canGoNext()) setStep((s) => (Math.min(s + 1, 5) as Step));
  };

  const goBack = () => {
    if (step > 1) setStep((s) => (Math.max(s - 1, 1) as Step));
  };

  // Logo upload — stored in the wrap-files bucket under
  // marketplace-logos/<listingId>-<timestamp>.<ext>. The public URL
  // travels to checkout metadata so the design team can pull it.
  const handleLogoUpload = async (file: File) => {
    if (!file) return;
    setLogoFile(file);
    setLogoUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `marketplace-logos/${listing.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("wrap-files")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("wrap-files").getPublicUrl(path);
      setLogoUploadUrl(pub.publicUrl);
      toast.success("Logo uploaded");
    } catch (err) {
      toast.error(`Logo upload failed — ${(err as Error).message}`);
      setLogoFile(null);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleCheckout = async () => {
    if (!email) { toast.error("Email is required to send your files"); return; }
    setIsCheckingOut(true);
    try {
      // Best-effort retargeting capture
      try {
        await supabase.from("email_subscribers" as any).upsert(
          { email, source: "marketplace_checkout", updated_at: new Date().toISOString() },
          { onConflict: "email" },
        );
      } catch { /* silent */ }

      const purchaseMode =
        (listing as { _purchase_mode?: string })?._purchase_mode === "design_plus_wrap"
          ? "design_plus_wrap"
          : "design_only";
      const { data, error } = await supabase.functions.invoke("creator-market-checkout", {
        body: {
          listing_id: listing.id,
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          universal_size: universalSize,
          email,
          business_name: businessName.trim() || undefined,
          business_phone: businessPhone.trim() || undefined,
          business_website: businessWebsite.trim() || undefined,
          business_colors: businessColors.trim() || undefined,
          logo_url: logoUploadUrl || undefined,
          // Branded designs include name/colors swap as part of the
          // base $350 fee — no separate upcharge.
          wants_name_change: commercial,
          wants_logo_pack: false,
          wants_vehicle_render: wantsVehicleRender,
          return_url: window.location.origin + "/creatormarket",
          purchase_mode: purchaseMode,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error("Failed to create checkout session");
      }
    } catch (err: any) {
      console.error("Checkout error:", err);
      toast.error(err.message || "Checkout failed");
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white border border-zinc-200 text-zinc-900">
        <DialogHeader>
          <DialogTitle className="text-xl sm:text-2xl font-bold text-zinc-900">
            {STEP_TITLES[step]}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            ${PRINT_READY_PRICE} Print-Ready File Package · Delivered in {FILE_DELIVERY_HOURS} hours
          </DialogDescription>
        </DialogHeader>

        {/* Stepper rail */}
        <ol className="flex items-center gap-1 sm:gap-2 mt-1 mb-3">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as Step;
            const done = step > n;
            const current = step === n;
            return (
              <li key={label} className="flex-1 flex items-center gap-1.5">
                <span className={cn(
                  "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                  done && "bg-emerald-500 text-white border-emerald-500",
                  current && "bg-zinc-900 text-white border-zinc-900",
                  !done && !current && "bg-white text-zinc-400 border-zinc-200",
                )}>
                  {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
                </span>
                <span className={cn(
                  "text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide truncate",
                  current ? "text-zinc-900" : "text-zinc-400",
                )}>
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <span className="hidden sm:block flex-1 h-px bg-zinc-200" />
                )}
              </li>
            );
          })}
        </ol>

        <div className="space-y-4">
          {/* ── Step 1 — Design preview ── */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50">
                {listing.thumbnail_url ? (
                  <img src={listing.thumbnail_url} alt={industryTitle} className="w-full aspect-video object-cover" />
                ) : (
                  <div className="aspect-video flex items-center justify-center"><Package className="w-12 h-12 text-zinc-300" /></div>
                )}
              </div>
              <div>
                <h3 className="text-xl font-bold text-zinc-900">{industryTitle}</h3>
                {vehicleShown && <p className="text-sm text-zinc-500">{vehicleShown}</p>}
              </div>
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4 space-y-2.5">
                <p className="text-sm font-bold text-zinc-900">What's included with ${PRINT_READY_PRICE}:</p>
                <ul className="space-y-2 text-sm text-zinc-700">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Print-ready production files</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Sized to your vehicle year / make / model</li>
                  {commercial && (
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Commercial branding edits included — name, logo, phone, website, colors</li>
                  )}
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Delivered in {FILE_DELIVERY_HOURS} hours</li>
                </ul>
              </div>
              <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3 flex gap-3">
                <Camera className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
                <div className="text-sm text-cyan-900">
                  <span className="font-bold">Optional add-on (+${VEHICLE_RENDER_ADDON_PRICE}): </span>
                  Want to see this design on your actual vehicle before we make the print files? You can add a custom render in step 4.
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2 — Vehicle Y/M/M + size ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600">
                Tell us about the vehicle we're sizing your files to. This is the vehicle the wrap will be installed on.
              </p>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 block">Vehicle size class</Label>
                <Select value={universalSize} onValueChange={setUniversalSize}>
                  <SelectTrigger className="bg-white border-zinc-300 text-zinc-900 h-11">
                    <SelectValue placeholder="Select vehicle size…" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIVERSAL_SIZES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 block">Year</Label>
                  <Input value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} placeholder="2024" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 block">Make</Label>
                  <Input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} placeholder="Ford" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 block">Model</Label>
                  <Input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="Transit" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3 — Logo & business info ── */}
          {step === 3 && (
            <div className="space-y-4">
              {commercial ? (
                <p className="text-sm text-zinc-600">
                  This commercial template includes editable branding. Replace the business name, logo, phone, website, and colors with yours — all included in the ${PRINT_READY_PRICE} price.
                </p>
              ) : (
                <p className="text-sm text-zinc-600">
                  Optional — only fill this in if you want a custom business name added to this design. You can skip ahead.
                </p>
              )}
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Business name {commercial && <span className="text-rose-500">*</span>}</Label>
                  <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Joe's Plumbing" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                    <Input value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} placeholder="(555) 123-4567" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Website</Label>
                    <Input value={businessWebsite} onChange={(e) => setBusinessWebsite(e.target.value)} placeholder="yourbusiness.com" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Brand colors</Label>
                  <Input value={businessColors} onChange={(e) => setBusinessColors(e.target.value)} placeholder="#0066FF, #FFFFFF — or describe in words" className="bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Logo (PNG or SVG)</Label>
                  <label className={cn(
                    "flex items-center justify-center gap-2 w-full h-11 rounded-md border-2 border-dashed cursor-pointer text-sm transition",
                    logoFile ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-zinc-300 text-zinc-600 hover:border-zinc-400",
                  )}>
                    {logoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {logoFile ? logoFile.name : "Click to upload your logo"}
                    <input type="file" accept="image/png,image/svg+xml,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                  </label>
                  <p className="text-[11px] text-zinc-500 mt-1">High-resolution preferred. We'll convert to print-ready vector if needed.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4 — Optional vehicle preview ── */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">
                Your ${PRINT_READY_PRICE} already covers the print-ready file pack.
                The optional <strong>${VEHICLE_RENDER_ADDON_PRICE}</strong> add-on is only if you want to see this
                design on your actual vehicle before we produce the print files.
              </p>
              <button
                type="button"
                onClick={() => setWantsVehicleRender(true)}
                className={cn(
                  "w-full text-left rounded-xl border p-4 transition",
                  wantsVehicleRender ? "border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-cyan-600" />
                  <div className="flex-1">
                    <div className="font-bold text-zinc-900">Yes — preview on my vehicle first</div>
                    <div className="text-xs text-zinc-500">Custom render in {FILE_DELIVERY_HOURS}h. After you approve, print-ready files ship within {FILE_DELIVERY_HOURS} more hours.</div>
                  </div>
                  <span className="text-lg font-bold text-zinc-900">+${VEHICLE_RENDER_ADDON_PRICE}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setWantsVehicleRender(false)}
                className={cn(
                  "w-full text-left rounded-xl border p-4 transition",
                  !wantsVehicleRender ? "border-zinc-900 ring-2 ring-zinc-200 bg-zinc-50" : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-zinc-600" />
                  <div className="flex-1">
                    <div className="font-bold text-zinc-900">No thanks — just send the files</div>
                    <div className="text-xs text-zinc-500">Print-ready files emailed in {FILE_DELIVERY_HOURS} hours. No add-on charge.</div>
                  </div>
                  <span className="text-sm font-semibold text-zinc-500">${PRINT_READY_PRICE}</span>
                </div>
              </button>
            </div>
          )}

          {/* ── Step 5 — Email + confirm ── */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1.5 block">Email for delivery</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="pl-10 bg-white border-zinc-300 text-zinc-900 h-11" />
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 divide-y divide-zinc-200">
                <div className="flex justify-between items-center px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{industryTitle}</div>
                    <div className="text-[11px] text-zinc-500">Print-ready file package</div>
                  </div>
                  <span className="text-sm font-bold text-zinc-900">${basePrice}</span>
                </div>
                {wantsVehicleRender && (
                  <div className="flex justify-between items-center px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">Custom Vehicle Render</div>
                      <div className="text-[11px] text-zinc-500">Approve before we produce files</div>
                    </div>
                    <span className="text-sm font-bold text-zinc-900">+${VEHICLE_RENDER_ADDON_PRICE}</span>
                  </div>
                )}
                <div className="flex justify-between items-center px-4 py-3 bg-zinc-100">
                  <span className="text-sm font-bold text-zinc-900">Total</span>
                  <span className="text-xl font-bold text-zinc-900">${total}</span>
                </div>
              </div>
              <div className="rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-2.5 flex items-center gap-2 text-sm text-cyan-900">
                <Clock className="w-4 h-4 shrink-0" />
                {wantsVehicleRender
                  ? `Vehicle render in ${FILE_DELIVERY_HOURS}h, then production files within ${FILE_DELIVERY_HOURS}h of your approval.`
                  : `Production files emailed within ${FILE_DELIVERY_HOURS} hours.`}
              </div>
            </div>
          )}

          {/* Step navigation */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={step === 1}
              className="border-zinc-300 text-zinc-700 hover:bg-zinc-100 gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            {step < 5 ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={!canGoNext()}
                className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-white gap-1.5 h-11"
              >
                {step === 1 ? "Customize & Buy" : "Next"} <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleCheckout}
                disabled={!email || isCheckingOut}
                className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white gap-2 h-11 font-bold"
              >
                {isCheckingOut ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ShoppingBag className="w-5 h-5" /> Pay ${total} & Receive Files</>}
              </Button>
            )}
            {step === 3 && !commercial && (
              <Button
                type="button"
                variant="ghost"
                onClick={goNext}
                className="text-zinc-500 hover:text-zinc-900"
              >
                Skip
              </Button>
            )}
          </div>
          <p className="text-[10px] text-center text-zinc-400">
            Secure checkout via Stripe. Files delivered to {email || "your email"} within {FILE_DELIVERY_HOURS} hours.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
