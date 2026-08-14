import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Car, Landmark, PanelTop, Image, Loader2, Check, Trash2, LayoutDashboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ZoneMasker } from "./ZoneMasker";
import type {
  SurfaceSelections,
  SurfaceType,
  VinylZone,
  WallTexture,
  GlassType,
  VehicleArea,
  UploadedAngle,
} from "./types";

interface SurfaceSelectionProps {
  surface: SurfaceSelections;
  onChange: (updates: Partial<SurfaceSelections>) => void;
  makes: string[];
  models: string[];
  onMakeChange: (make: string) => void;
  onAreaToggle?: (area: string) => void;
  onLookupDimensions?: (make: string, model: string, year: string, area: string, zoneId: string) => void;
  isLookingUpDims?: boolean;
  vehiclePreviewUrl?: string | null;
  isGeneratingPreview?: boolean;
  onGeneratePreview?: () => void;
}

// Three customer-facing surfaces. Floor & signage use different vinyl film
// and a different markup model — they don't share this workflow. Window /
// storefront is intentionally renamed from "Glass" so customers searching
// for "window decals" actually recognize it.
const SURFACE_TYPES: {
  type: SurfaceType;
  label: string;
  icon: React.ReactNode;
  description: string;
  uploadCta: string;
}[] = [
  {
    type: 'vehicle',
    label: 'Vehicle Wrap',
    icon: <Car className="w-5 h-5" />,
    description: 'Truck, car, van, trailer',
    uploadCta: 'Upload a photo of the vehicle',
  },
  {
    type: 'wall',
    label: 'Walls',
    icon: <Landmark className="w-5 h-5" />,
    description: 'Indoor or outdoor wall mural',
    uploadCta: 'Upload a photo of the wall',
  },
  {
    type: 'glass',
    label: 'Windows / Storefront',
    icon: <PanelTop className="w-5 h-5" />,
    description: 'Storefront, office window, vehicle glass',
    uploadCta: 'Upload a photo of the storefront',
  },
  {
    type: 'studio',
    label: 'Studio (No Photo)',
    icon: <LayoutDashboard className="w-5 h-5" />,
    description: 'Flat white canvas — design only',
    uploadCta: 'Design on a blank studio canvas',
  },
];

const VEHICLE_AREAS: { value: VehicleArea; label: string }[] = [
  { value: 'door', label: 'Door' },
  { value: 'tailgate', label: 'Tailgate' },
  { value: 'hood', label: 'Hood' },
  { value: 'rear-window', label: 'Rear Window' },
  { value: 'side-panel', label: 'Side Panel' },
];

const WALL_TEXTURES: { value: WallTexture; label: string; description: string }[] = [
  { value: 'studio', label: 'Studio Wall', description: 'Clean, neutral, professional' },
  { value: 'smooth', label: 'Smooth', description: 'Flat drywall, painted smooth' },
  { value: 'semi-smooth', label: 'Semi-Smooth', description: 'Orange peel, light texture' },
  { value: 'textured', label: 'Textured', description: 'Brick, stucco, concrete, stone' },
];

const GLASS_TYPES: { value: GlassType; label: string }[] = [
  { value: 'storefront', label: 'Storefront Glass' },
  { value: 'office', label: 'Office Window' },
  { value: 'vehicle', label: 'Vehicle Window' },
];

const YEARS = Array.from({ length: 30 }, (_, i) => String(2026 - i));

/** Compact zone summary table — shows all zones with editable dimensions */
function ZoneSummaryTable({
  zones,
  onChange,
  isLookingUpDims,
}: {
  zones: VinylZone[];
  onChange: (zones: VinylZone[]) => void;
  isLookingUpDims?: boolean;
}) {
  if (zones.length === 0) return null;

  const updateZone = (idx: number, updates: Partial<VinylZone>) => {
    const updated = [...zones];
    updated[idx] = { ...updated[idx], ...updates };
    onChange(updated);
  };

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_65px_65px] sm:grid-cols-[1fr_70px_70px] gap-1 text-[10px] font-medium text-gray-500 px-1">
        <span>Zone</span>
        <span>W (in)</span>
        <span>H (in)</span>
      </div>
      {zones.map((zone, idx) => (
        <div key={zone.id} className="grid grid-cols-[1fr_65px_65px] sm:grid-cols-[1fr_70px_70px] gap-1 items-center">
          <span className="text-xs text-gray-900 truncate px-1">{zone.label}</span>
          <div className="relative">
            <Input
              type="number"
              value={zone.widthInches || ''}
              onChange={(e) => updateZone(idx, { widthInches: Number(e.target.value) || 0 })}
              placeholder="W"
              className="h-7 text-xs bg-white border-gray-200 pr-1"
            />
            {isLookingUpDims && zone.widthInches === 0 && (
              <Loader2 className="absolute right-1 top-1.5 w-3 h-3 animate-spin text-cyan-500" />
            )}
          </div>
          <div className="relative">
            <Input
              type="number"
              value={zone.heightInches || ''}
              onChange={(e) => updateZone(idx, { heightInches: Number(e.target.value) || 0 })}
              placeholder="H"
              className="h-7 text-xs bg-white border-gray-200 pr-1"
            />
          </div>
        </div>
      ))}
      {zones.some((z) => z.widthInches > 0 && z.heightInches > 0) && (
        <p className="text-[10px] text-blue-500 px-1 pt-1">Verify dimensions match your vehicle — adjust if needed</p>
      )}
      {zones.some((z) => z.widthInches === 0 || z.heightInches === 0) && !isLookingUpDims && (
        <p className="text-[10px] text-amber-600 px-1 pt-1">Enter dimensions for highlighted zones (inches)</p>
      )}
    </div>
  );
}

/** Inline dimension inputs for non-vehicle surfaces */
function DimensionInputs({
  surface,
  onChange,
  label,
}: {
  surface: SurfaceSelections;
  onChange: (updates: Partial<SurfaceSelections>) => void;
  label: string;
}) {
  const zone = surface.vinylZones[0];
  const ensureZone = () => {
    if (surface.vinylZones.length === 0) {
      onChange({
        vinylZones: [{
          id: `zone-${Date.now()}`,
          label: `${label} graphic`,
          x: 10, y: 10, width: 80, height: 80,
          widthInches: 0,
          heightInches: 0,
          location: label,
          designPrompt: "",
        }],
      });
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-gray-200">
      <Label className="text-xs font-medium text-gray-700">Overall Dimensions (inches) *</Label>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-gray-500">Width</Label>
          <Input
            type="number"
            value={zone?.widthInches || ''}
            onFocus={ensureZone}
            onChange={(e) => {
              const val = Number(e.target.value) || 0;
              if (surface.vinylZones.length === 0) return;
              const updated = [...surface.vinylZones];
              updated[0] = { ...updated[0], widthInches: val };
              onChange({ vinylZones: updated });
            }}
            placeholder="e.g. 48"
            className="h-7 text-sm bg-white border-gray-200"
          />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Height</Label>
          <Input
            type="number"
            value={zone?.heightInches || ''}
            onFocus={ensureZone}
            onChange={(e) => {
              const val = Number(e.target.value) || 0;
              if (surface.vinylZones.length === 0) return;
              const updated = [...surface.vinylZones];
              updated[0] = { ...updated[0], heightInches: val };
              onChange({ vinylZones: updated });
            }}
            placeholder="e.g. 36"
            className="h-7 text-sm bg-white border-gray-200"
          />
        </div>
      </div>
    </div>
  );
}

// Heuristic: guess the vehicle angle from the file name. Falls back to ''
// (user picks from the dropdown).
function guessAngleFromName(name: string): VehicleArea | 'custom' | '' {
  const n = name.toLowerCase();
  if (n.includes('driver')) return 'side-panel';
  if (n.includes('passenger')) return 'side-panel';
  if (n.includes('front')) return 'hood';
  if (n.includes('hood')) return 'hood';
  if (n.includes('rear') || n.includes('back')) return 'tailgate';
  if (n.includes('tail')) return 'tailgate';
  if (n.includes('door')) return 'door';
  return '';
}

const ANGLE_LABELS: Record<string, string> = {
  'side-panel': 'Side',
  'door': 'Door',
  'hood': 'Front / Hood',
  'tailgate': 'Rear',
  'rear-window': 'Rear Window',
  'custom': 'Custom angle',
};

const ANGLE_OPTIONS: { value: VehicleArea | 'custom'; label: string }[] = [
  { value: 'side-panel', label: 'Side' },
  { value: 'door', label: 'Door' },
  { value: 'hood', label: 'Front / Hood' },
  { value: 'tailgate', label: 'Rear' },
  { value: 'rear-window', label: 'Rear Window' },
  { value: 'custom', label: 'Custom' },
];

export function SurfaceSelection({ surface, onChange, makes, models, onMakeChange, onAreaToggle, onLookupDimensions, isLookingUpDims, vehiclePreviewUrl, isGeneratingPreview, onGeneratePreview }: SurfaceSelectionProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallFileRef = useRef<HTMLInputElement>(null);
  const glassFileRef = useRef<HTMLInputElement>(null);
  // Default to Build Surface — RJ wanted customers steered to pick a
  // surface type first; the upload tab is a shortcut for when they
  // already have a real photo of the customer's rig / wall / storefront.
  const [activeTab, setActiveTab] = useState<string>(surface.source === 'upload' && surface.uploadedAngles.length > 0 ? 'upload' : 'build');
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [showWallUpload, setShowWallUpload] = useState<boolean>(!!surface.wallPhotoUrl);
  const [showGlassUpload, setShowGlassUpload] = useState<boolean>(!!surface.glassPhotoUrl);
  const [showVehicleUpload, setShowVehicleUpload] = useState<boolean>(
    surface.type === 'vehicle' && surface.source === 'upload' && surface.uploadedAngles.length > 0,
  );
  const [activeAngleId, setActiveAngleId] = useState<string | null>(
    surface.uploadedAngles[0]?.id ?? null,
  );

  // Which areas are currently selected (derived from zones)
  const selectedAreas = new Set(surface.vinylZones.map((z) => z.id.replace("zone-", "")));

  const updateAngles = useCallback((next: UploadedAngle[]) => {
    onChange({ uploadedAngles: next });
  }, [onChange]);

  const updateAngle = useCallback((id: string, patch: Partial<UploadedAngle>) => {
    const next = surface.uploadedAngles.map((a) => (a.id === id ? { ...a, ...patch } : a));
    updateAngles(next);
  }, [surface.uploadedAngles, updateAngles]);

  const removeAngle = useCallback((id: string) => {
    const next = surface.uploadedAngles.filter((a) => a.id !== id);
    updateAngles(next);
    if (activeAngleId === id) {
      setActiveAngleId(next[0]?.id ?? null);
    }
  }, [surface.uploadedAngles, updateAngles, activeAngleId]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    const accepted: UploadedAngle[] = [];
    let skipped = 0;
    Array.from(files).forEach((file) => {
      if (!validTypes.includes(file.type)) { skipped++; return; }
      if (file.size > 20 * 1024 * 1024) { skipped++; return; }
      const angle = guessAngleFromName(file.name);
      const angleLabel = angle ? (ANGLE_LABELS[angle] || file.name) : file.name;
      accepted.push({
        id: `angle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        angle,
        angleLabel,
        zones: [],
      });
    });

    if (skipped > 0) {
      toast({
        title: skipped === 1 ? "1 file skipped" : `${skipped} files skipped`,
        description: "Only JPG, PNG, WebP, or HEIC up to 20MB are accepted.",
        variant: "destructive",
      });
    }
    if (accepted.length === 0) return;

    const next = [...surface.uploadedAngles, ...accepted];
    // Preserve the current surface type so the vehicle / wall / glass card
    // stays open while ZoneMasker renders on the uploaded photo. The legacy
    // hidden "upload" tab used to null this out; that tab is no longer
    // surfaced, so each surface card now owns its own upload affordance.
    onChange({
      source: 'upload',
      uploadedAngles: next,
    });
    setActiveAngleId(accepted[0].id);
  }, [surface.uploadedAngles, onChange, toast]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addFiles(files);
    // Reset input so the same file can be re-selected if needed
    e.target.value = "";
  }, [addFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) addFiles(files);
  }, [addFiles]);

  const activeAngle = surface.uploadedAngles.find((a) => a.id === activeAngleId)
    ?? surface.uploadedAngles[0]
    ?? null;

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Single visible flow now: pick the surface type tile below,
            then upload OR let AI generate inside that type, then mask
            zones. The multi-angle upload that used to live in its own
            tab is still available — it auto-activates when you upload
            anything from the dropzone exposed inside the vehicle tile. */}

        {/* Hidden upload-photo content — kept for backward compatibility
            but no longer surfaced as a tab. The vehicle / wall / glass
            sub-options each have their own upload affordance now. */}
        <TabsContent value="upload" className="hidden">
          <div
            className={`border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-blue-500/50 transition-colors ${
              surface.uploadedAngles.length > 0 ? "border-gray-200 p-3" : "border-gray-200 p-6"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="flex items-center gap-3 justify-center">
              <Upload className="w-6 h-6 text-gray-300" />
              <div className="text-left">
                <p className="text-sm text-gray-700">
                  {surface.uploadedAngles.length > 0
                    ? `Add another angle — ${surface.uploadedAngles.length} uploaded`
                    : "Drag & drop one or more photos, or click to browse"}
                </p>
                <p className="text-xs text-gray-300">
                  Driver, passenger, front, rear — JPG, PNG, WebP, HEIC up to 20MB each
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Uploaded angle thumbnails — click to edit zones for that angle */}
          {surface.uploadedAngles.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {surface.uploadedAngles.map((a) => {
                const isActive = a.id === activeAngle?.id;
                return (
                  <div
                    key={a.id}
                    className={`relative rounded-md border cursor-pointer overflow-hidden transition-colors ${
                      isActive
                        ? "border-blue-500 ring-1 ring-blue-500/40"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setActiveAngleId(a.id)}
                  >
                    <img
                      src={a.previewUrl}
                      alt={a.angleLabel}
                      className="w-full h-24 object-cover"
                    />
                    <div className="absolute top-1 right-1 flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); removeAngle(a.id); }}
                        className="w-5 h-5 rounded-full bg-black/70 hover:bg-red-500 flex items-center justify-center"
                        title="Remove angle"
                      >
                        <Trash2 className="w-3 h-3 text-white" />
                      </button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-1">
                      <select
                        value={a.angle}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = e.target.value as VehicleArea | 'custom' | '';
                          updateAngle(a.id, {
                            angle: next,
                            angleLabel: next ? (ANGLE_LABELS[next] || a.angleLabel) : (a.file?.name || 'Photo'),
                          });
                        }}
                        className="w-full text-[10px] bg-transparent text-gray-900 border-0 focus:outline-none"
                      >
                        <option value="" className="text-black">Pick angle…</option>
                        {ANGLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} className="text-black">{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    {a.zones.length > 0 && (
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-blue-600/80 text-[9px] font-bold text-white">
                        {a.zones.length} zone{a.zones.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Vehicle info + dimensions (shared across angles) */}
          {surface.uploadedAngles.length > 0 && (
            <Card className="mt-4 p-4 space-y-3 bg-white border-gray-200">
              <h4 className="text-sm font-medium text-gray-900">Vehicle Info (for accurate dimensions)</h4>
              {(!surface.year || !surface.make || !surface.model) ? (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">
                    ⚠ Year, Make &amp; Model are required — you must enter all three so every studio angle and the production proofs generate.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Enter make &amp; model so we can look up exact panel sizes for production files.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-gray-500">Year</Label>
                  <select
                    value={surface.year}
                    onChange={(e) => onChange({ year: e.target.value })}
                    className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Make</Label>
                  <select
                    value={surface.make}
                    onChange={(e) => { onChange({ make: e.target.value, model: '' }); onMakeChange(e.target.value); setIsCustomModel(false); }}
                    className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">Make</option>
                    {makes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Model</Label>
                  {models.length > 0 && !isCustomModel ? (
                    <select
                      value={surface.model}
                      onChange={(e) => {
                        if (e.target.value === "__custom") {
                          setIsCustomModel(true);
                          onChange({ model: '' });
                        } else {
                          onChange({ model: e.target.value });
                        }
                      }}
                      className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                    >
                      <option value="">Model</option>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom">Other...</option>
                    </select>
                  ) : (
                    <div className="flex gap-1 mt-1">
                      <Input
                        value={surface.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="Type model"
                        className="h-8 text-sm bg-white border-gray-200"
                      />
                      {models.length > 0 && (
                        <button
                          onClick={() => { setIsCustomModel(false); onChange({ model: '' }); }}
                          className="text-xs text-blue-500 hover:text-blue-600 whitespace-nowrap px-1"
                        >
                          List
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Zone dimension table for the active angle's zones */}
              {activeAngle && activeAngle.zones.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500">Dimensions for zones on <span className="text-blue-400">{activeAngle.angleLabel}</span></p>
                  {activeAngle.zones.map((zone, idx) => (
                    <div key={zone.id} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_70px_70px] gap-1 items-center">
                      <select
                        value={zone.location || ''}
                        onChange={(e) => {
                          const area = e.target.value;
                          const updated = [...activeAngle.zones];
                          updated[idx] = { ...updated[idx], location: area, label: VEHICLE_AREAS.find(a => a.value === area)?.label || zone.label };
                          updateAngle(activeAngle.id, { zones: updated });
                          if (area && surface.make && surface.model && onLookupDimensions) {
                            onLookupDimensions(surface.make, surface.model, surface.year, area, zone.id);
                          }
                        }}
                        className="h-7 text-xs bg-white border border-gray-200 rounded-md px-1 text-gray-900"
                      >
                        <option value="">Area...</option>
                        {VEHICLE_AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <span className="text-[10px] text-gray-500 truncate px-1 hidden sm:block">{zone.label}</span>
                      <div className="relative">
                        <Input
                          type="number"
                          value={zone.widthInches || ''}
                          onChange={(e) => {
                            const updated = [...activeAngle.zones];
                            updated[idx] = { ...updated[idx], widthInches: Number(e.target.value) || 0 };
                            updateAngle(activeAngle.id, { zones: updated });
                          }}
                          placeholder="W (in)"
                          className="h-7 text-xs bg-white border-gray-200 pr-1"
                        />
                        {isLookingUpDims && zone.widthInches === 0 && (
                          <Loader2 className="absolute right-1 top-1.5 w-3 h-3 animate-spin text-cyan-500" />
                        )}
                      </div>
                      <Input
                        type="number"
                        value={zone.heightInches || ''}
                        onChange={(e) => {
                          const updated = [...activeAngle.zones];
                          updated[idx] = { ...updated[idx], heightInches: Number(e.target.value) || 0 };
                          updateAngle(activeAngle.id, { zones: updated });
                        }}
                        placeholder="H (in)"
                        className="h-7 text-xs bg-white border-gray-200 pr-1"
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Zone Masker — one per uploaded angle. Each side view we
              upload gets its own glassmorphism marker so the AI knows
              placement on every angle (driver, passenger, front, rear,
              hood, …). Previously we only rendered the active angle's
              masker, so customers thought it "only worked on one view". */}
          {surface.uploadedAngles.length > 0 && (
            <div className="mt-4 space-y-5">
              <p className="text-xs text-gray-500">
                Draw the glassmorphic placement boxes on every angle below.
                Each photo keeps its own zones so the AI sees exactly where
                vinyl applies on every side of the vehicle.
              </p>
              {surface.uploadedAngles.map((a) => {
                const isActive = a.id === activeAngle?.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => setActiveAngleId(a.id)}
                    className={`rounded-lg border p-3 transition-colors ${
                      isActive
                        ? "border-cyan-400/60 bg-cyan-400/5 ring-1 ring-cyan-400/30"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-gray-900">
                        <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span><sup className="text-blue-600/80 text-[8px] ml-0.5">TM</sup> — Mark vinyl zones on <span className="text-blue-600">{a.angleLabel}</span>
                      </h4>
                      <span className="text-[10px] text-gray-500">
                        {a.zones.length} zone{a.zones.length === 1 ? "" : "s"} marked
                      </span>
                    </div>
                    <ZoneMasker
                      key={a.id}
                      imageUrl={a.previewUrl}
                      zones={a.zones}
                      onChange={(zones: VinylZone[]) => updateAngle(a.id, { zones })}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Build Surface Tab */}
        <TabsContent value="build" className="mt-4 space-y-4">
          {/* Production Method — first decision the customer makes. Drives
              everything downstream: artwork pipeline (full-color print vs
              single-color plotter cut), pricing model, and the cut files
              that get shipped to production. Surfacing this up front means
              the rest of the form (finish picker, layer films, bleed) can
              hide or show options that don't apply to the chosen method. */}
          <div>
            <Label className="text-xs text-gray-700 font-medium">Production Method</Label>
            <p className="text-[11px] text-gray-500 mb-1.5">How will this graphic be produced?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange({ vinylSubstrate: 'printed' })}
                className={`text-left rounded-lg border p-3 transition-all ${
                  surface.vinylSubstrate === 'printed'
                    ? 'border-[#ec4899] bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 ring-1 ring-[#ec4899]'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="text-sm font-bold text-gray-900 mb-0.5">Print &amp; Cut</div>
                <p className="text-[11px] text-gray-600 leading-snug">
                  Full-color printed graphic with a contour cut line. Photo-real
                  artwork, gradients, multi-color in a single piece.
                </p>
              </button>
              <button
                type="button"
                onClick={() => onChange({ vinylSubstrate: 'cut' })}
                className={`text-left rounded-lg border p-3 transition-all ${
                  surface.vinylSubstrate === 'cut'
                    ? 'border-[#ec4899] bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 ring-1 ring-[#ec4899]'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="text-sm font-bold text-gray-900 mb-0.5">Manufacture Film Cut</div>
                <p className="text-[11px] text-gray-600 leading-snug">
                  Solid-color film cut from manufactured sheets and layered. Each
                  layer is one Pantone — classic sign-shop multi-color decals.
                </p>
              </button>
            </div>
          </div>

          {/* USP banner — same Draw-Zone workflow on all three surfaces.
              This is the GraphicsPro pitch: customers upload a real photo
              (vehicle, wall, or storefront), draw glassmorphic boxes where
              vinyl goes, and the AI lays the design exactly there. */}
          <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-[#3b82f6]/10 to-[#ec4899]/10 px-3.5 py-3 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 text-sm">
              <span className="text-blue-600 font-bold uppercase tracking-wide text-xs whitespace-nowrap">
                Powered by <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span><sup className="text-blue-500 text-[8px] ml-0.5">TM</sup>
              </span>
              <span className="text-gray-900 leading-snug">Draw your vinyl zones on vehicles, walls, or storefront windows — same workflow, same cut files.</span>
            </div>
          </div>

          {/* Surface Type Grid — three customer surfaces, one tile each. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SURFACE_TYPES.map((st) => {
              const selected = surface.type === st.type;
              return (
                <button
                  key={st.type}
                  onClick={() => {
                    // Studio mode (no photo) auto-seeds Zone 1 on a flat
                    // white canvas so the customer can start typing into
                    // the zone textarea immediately — same UX as Adobe
                    // Illustrator: pick the artboard size, get a blank
                    // canvas, draw cut shapes, write copy in each.
                    if (st.type === 'studio' && surface.vinylZones.length === 0) {
                      onChange({
                        type: st.type,
                        source: 'generated',
                        uploadedAngles: [],
                        // Print & Cut is the more common 'I just need a
                        // cool cut graphic' default. Customer can flip
                        // to 'cut' (layered vinyl) inside the studio
                        // sub-options card.
                        vinylSubstrate: 'printed',
                        vinylZones: [{
                          id: `zone-${Date.now()}`,
                          label: 'Zone 1',
                          x: 15, y: 25, width: 70, height: 50,
                          widthInches: 0,
                          heightInches: 0,
                          location: 'Studio canvas',
                          designPrompt: '',
                        }],
                      });
                    } else {
                      onChange({ type: st.type, source: 'generated', uploadedAngles: [] });
                    }
                  }}
                  className={`text-left rounded-xl border p-3 sm:p-4 transition-all ${
                    selected
                      ? 'bg-gradient-to-br from-[#3b82f6]/15 to-[#ec4899]/15 border-[#ec4899] shadow-md'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={selected ? 'text-[#ec4899]' : 'text-gray-600'}>
                      {st.icon}
                    </span>
                    <span className="text-sm font-bold text-gray-900">{st.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2 leading-snug">
                    {st.description}
                  </p>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${
                    selected ? 'text-[#ec4899]' : 'text-blue-600'
                  }`}>
                    <Upload className="w-3.5 h-3.5" />
                    {st.uploadCta}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Vehicle Sub-Options */}
          {surface.type === 'vehicle' && (
            <Card className="p-4 space-y-3 bg-white border-gray-200">
              {/* Source toggle — mirrors Wall / Glass. AI-generated vehicle
                  is the default; "I have a photo" lets the customer upload
                  one or more real angles of their actual rig and draw
                  glassmorphic ZoneMasker zones on each angle. */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowVehicleUpload(false);
                    if (surface.uploadedAngles.length > 0) {
                      onChange({ source: 'generated', uploadedAngles: [] });
                    } else {
                      onChange({ source: 'generated' });
                    }
                  }}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    !showVehicleUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  Let AI generate the vehicle
                </button>
                <button
                  onClick={() => {
                    setShowVehicleUpload(true);
                    onChange({ source: 'upload' });
                  }}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    showVehicleUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  I have photo(s) of the vehicle
                </button>
              </div>

              {/* Upload dropzone — multi-angle. Each photo becomes its own
                  UploadedAngle with an independent ZoneMasker so the AI sees
                  driver, passenger, hood, rear as separate placements. */}
              {showVehicleUpload && (
                <div>
                  <Label className="text-xs text-gray-700 font-medium">Upload Your Vehicle Photo(s)</Label>
                  <p className="text-[10px] text-gray-400 mb-2">
                    Driver, passenger, front, rear — JPG, PNG, WebP, HEIC up to 20MB each
                  </p>
                  <div
                    className={`border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-blue-500/50 transition-colors ${
                      surface.uploadedAngles.length > 0 ? "border-green-500/30 p-2" : "border-gray-200 p-4"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                  >
                    {surface.uploadedAngles.length > 0 ? (
                      <div className="flex items-center gap-2 justify-center">
                        <Upload className="w-4 h-4 text-green-500" />
                        <span className="text-xs text-green-600 font-medium">
                          {surface.uploadedAngles.length} angle{surface.uploadedAngles.length === 1 ? "" : "s"} uploaded — click to add more
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 justify-center">
                        <Upload className="w-4 h-4 text-gray-300" />
                        <span className="text-xs text-gray-500">Drop vehicle photo(s) here or click to browse</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      multiple
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>
                </div>
              )}

              {/* Uploaded angle thumbnails — click to set active, edit angle tag, remove */}
              {showVehicleUpload && surface.uploadedAngles.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {surface.uploadedAngles.map((a) => {
                    const isActive = a.id === activeAngle?.id;
                    return (
                      <div
                        key={a.id}
                        className={`relative rounded-md border cursor-pointer overflow-hidden transition-colors ${
                          isActive
                            ? "border-blue-500 ring-1 ring-blue-500/40"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                        onClick={() => setActiveAngleId(a.id)}
                      >
                        <img
                          src={a.previewUrl}
                          alt={a.angleLabel}
                          className="w-full h-24 object-cover"
                        />
                        <div className="absolute top-1 right-1 flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); removeAngle(a.id); }}
                            className="w-5 h-5 rounded-full bg-black/70 hover:bg-red-500 flex items-center justify-center"
                            title="Remove angle"
                          >
                            <Trash2 className="w-3 h-3 text-white" />
                          </button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-1">
                          <select
                            value={a.angle}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const next = e.target.value as VehicleArea | 'custom' | '';
                              updateAngle(a.id, {
                                angle: next,
                                angleLabel: next ? (ANGLE_LABELS[next] || a.angleLabel) : (a.file?.name || 'Photo'),
                              });
                            }}
                            className="w-full text-[10px] bg-transparent text-white border-0 focus:outline-none"
                          >
                            <option value="" className="text-black">Pick angle…</option>
                            {ANGLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value} className="text-black">{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        {a.zones.length > 0 && (
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-blue-600/80 text-[9px] font-bold text-white">
                            {a.zones.length} zone{a.zones.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-gray-500">Year</Label>
                  <select
                    value={surface.year}
                    onChange={(e) => onChange({ year: e.target.value })}
                    className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Make</Label>
                  <select
                    value={surface.make}
                    onChange={(e) => { onChange({ make: e.target.value, model: '' }); onMakeChange(e.target.value); setIsCustomModel(false); }}
                    className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">Make</option>
                    {makes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Model</Label>
                  {models.length > 0 && !isCustomModel ? (
                    <select
                      value={surface.model}
                      onChange={(e) => {
                        if (e.target.value === "__custom") {
                          setIsCustomModel(true);
                          onChange({ model: '' });
                        } else {
                          onChange({ model: e.target.value });
                        }
                      }}
                      className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
                    >
                      <option value="">Model</option>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom">Other...</option>
                    </select>
                  ) : (
                    <div className="flex gap-1 mt-1">
                      <Input
                        value={surface.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="Type model name"
                        className="h-8 text-sm bg-white border-gray-200"
                      />
                      {models.length > 0 && (
                        <button
                          onClick={() => { setIsCustomModel(false); onChange({ model: '' }); }}
                          className="text-xs text-blue-500 hover:text-blue-600 whitespace-nowrap px-1"
                        >
                          List
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Area toggles — multi-select. Only used by the AI-generated
                  preview path. Upload mode uses per-angle ZoneMasker zones
                  instead, so we hide this block in that flow. */}
              {!showVehicleUpload && surface.make && surface.model && (
                <div>
                  <Label className="text-xs text-gray-500">Select areas for vinyl (tap to toggle)</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {VEHICLE_AREAS.map((a) => {
                      const isSelected = selectedAreas.has(a.value);
                      return (
                        <button
                          key={a.value}
                          onClick={() => onAreaToggle?.(a.value)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Compact zone dimensions table — AI-generated path only */}
              {!showVehicleUpload && surface.vinylZones.length > 0 && (
                <ZoneSummaryTable
                  zones={surface.vinylZones}
                  onChange={(zones) => onChange({ vinylZones: zones })}
                  isLookingUpDims={isLookingUpDims}
                />
              )}

              {/* Preview Vehicle — generate photo + draw/adjust zone boxes */}
              {!showVehicleUpload && surface.vinylZones.length > 0 && !vehiclePreviewUrl && (
                <button
                  onClick={onGeneratePreview}
                  disabled={isGeneratingPreview}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium border border-dashed border-blue-500/30 text-blue-500 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                >
                  {isGeneratingPreview ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating vehicle photo...
                    </>
                  ) : (
                    <>
                      <Image className="w-3.5 h-3.5" />
                      Preview Vehicle — draw & adjust zone boxes
                    </>
                  )}
                </button>
              )}

              {/* ZoneMasker on generated vehicle preview — AI path only */}
              {!showVehicleUpload && vehiclePreviewUrl && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-900">Adjust Zone Placement</h4>
                  <p className="text-[10px] text-gray-500">
                    Drag to move zones, drag corners to resize. Dimensions stay from database — this is for visual placement.
                  </p>
                  <ZoneMasker
                    imageUrl={vehiclePreviewUrl}
                    zones={surface.vinylZones}
                    onChange={(zones: VinylZone[]) => onChange({ vinylZones: zones })}
                  />
                </div>
              )}

              {/* Per-angle ZoneMasker — Upload path. One glassmorphic masker
                  per uploaded vehicle photo so the AI sees exactly where
                  vinyl applies on every side. */}
              {showVehicleUpload && surface.uploadedAngles.length > 0 && (
                <div className="space-y-4">
                  <p className="text-[10px] text-gray-500">
                    Draw the glassmorphic placement boxes on every angle below.
                    Each photo keeps its own zones so the AI sees exactly where
                    vinyl applies on every side of the vehicle.
                  </p>
                  {surface.uploadedAngles.map((a) => {
                    const isActive = a.id === activeAngle?.id;
                    return (
                      <div
                        key={a.id}
                        onClick={() => setActiveAngleId(a.id)}
                        className={`rounded-lg border p-3 transition-colors ${
                          isActive
                            ? "border-cyan-400/60 bg-cyan-400/5 ring-1 ring-cyan-400/30"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-gray-900">
                            <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span><sup className="text-blue-600/80 text-[8px] ml-0.5">TM</sup> — Mark vinyl zones on <span className="text-blue-600">{a.angleLabel}</span>
                          </h4>
                          <span className="text-[10px] text-gray-500">
                            {a.zones.length} zone{a.zones.length === 1 ? "" : "s"} marked
                          </span>
                        </div>
                        <ZoneMasker
                          key={a.id}
                          imageUrl={a.previewUrl}
                          zones={a.zones}
                          onChange={(zones: VinylZone[]) => updateAngle(a.id, { zones })}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-zone dimension table for the active uploaded angle */}
              {showVehicleUpload && activeAngle && activeAngle.zones.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500">Dimensions for zones on <span className="text-blue-500">{activeAngle.angleLabel}</span></p>
                  {activeAngle.zones.map((zone, idx) => (
                    <div key={zone.id} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_70px_70px] gap-1 items-center">
                      <select
                        value={zone.location || ''}
                        onChange={(e) => {
                          const area = e.target.value;
                          const updated = [...activeAngle.zones];
                          updated[idx] = { ...updated[idx], location: area, label: VEHICLE_AREAS.find(a => a.value === area)?.label || zone.label };
                          updateAngle(activeAngle.id, { zones: updated });
                          if (area && surface.make && surface.model && onLookupDimensions) {
                            onLookupDimensions(surface.make, surface.model, surface.year, area, zone.id);
                          }
                        }}
                        className="h-7 text-xs bg-white border border-gray-200 rounded-md px-1 text-gray-900"
                      >
                        <option value="">Area...</option>
                        {VEHICLE_AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <span className="text-[10px] text-gray-500 truncate px-1 hidden sm:block">{zone.label}</span>
                      <div className="relative">
                        <Input
                          type="number"
                          value={zone.widthInches || ''}
                          onChange={(e) => {
                            const updated = [...activeAngle.zones];
                            updated[idx] = { ...updated[idx], widthInches: Number(e.target.value) || 0 };
                            updateAngle(activeAngle.id, { zones: updated });
                          }}
                          placeholder="W (in)"
                          className="h-7 text-xs bg-white border-gray-200 pr-1"
                        />
                        {isLookingUpDims && zone.widthInches === 0 && (
                          <Loader2 className="absolute right-1 top-1.5 w-3 h-3 animate-spin text-cyan-500" />
                        )}
                      </div>
                      <Input
                        type="number"
                        value={zone.heightInches || ''}
                        onChange={(e) => {
                          const updated = [...activeAngle.zones];
                          updated[idx] = { ...updated[idx], heightInches: Number(e.target.value) || 0 };
                          updateAngle(activeAngle.id, { zones: updated });
                        }}
                        placeholder="H (in)"
                        className="h-7 text-xs bg-white border-gray-200 pr-1"
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Wall Sub-Options */}
          {surface.type === 'wall' && (
            <Card className="p-4 space-y-3 bg-white border-gray-200">
              {/* Source toggle — AI generation is the default; upload is opt-in */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowWallUpload(false);
                    if (surface.wallPhotoUrl) onChange({ wallPhotoFile: null, wallPhotoUrl: null });
                  }}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    !showWallUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  Let AI generate the wall
                </button>
                <button
                  onClick={() => setShowWallUpload(true)}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    showWallUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  I have a photo of the wall
                </button>
              </div>

              {showWallUpload && (
                <div>
                  <Label className="text-xs text-gray-700 font-medium">Upload Your Wall Photo</Label>
                  <p className="text-[10px] text-gray-400 mb-2">Upload a photo of the actual wall to see your graphic applied to it</p>
                  <div
                    className={`border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-blue-500/50 transition-colors ${
                      surface.wallPhotoUrl ? "border-green-500/30 p-2" : "border-gray-200 p-4"
                    }`}
                    onClick={() => wallFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith("image/")) {
                        const previewUrl = URL.createObjectURL(file);
                        onChange({ wallPhotoFile: file, wallPhotoUrl: previewUrl });
                      }
                    }}
                  >
                    {surface.wallPhotoUrl ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={surface.wallPhotoUrl}
                          alt="Wall photo"
                          className="h-14 w-20 rounded object-cover border border-green-500/30"
                        />
                        <div className="text-left flex-1">
                          <p className="text-xs font-medium text-green-400">Wall photo uploaded</p>
                          <p className="text-[10px] text-gray-400">Click to change</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); onChange({ wallPhotoFile: null, wallPhotoUrl: null }); }}
                          className="text-xs text-red-400 hover:text-red-300 px-2"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 justify-center">
                        <Upload className="w-4 h-4 text-gray-300" />
                        <span className="text-xs text-gray-500">Drop wall photo here or click to browse</span>
                      </div>
                    )}
                    <input
                      ref={wallFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const previewUrl = URL.createObjectURL(file);
                          onChange({ wallPhotoFile: file, wallPhotoUrl: previewUrl });
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Glassmorphism placement marker on the uploaded wall —
                  same idea as the vehicle angles: AI needs to know WHERE on
                  the wall the graphic goes, not just the wall texture. */}
              {showWallUpload && surface.wallPhotoUrl && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-900">
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span><sup className="text-blue-600/80 text-[8px] ml-0.5">TM</sup> — Mark graphic placement on <span className="text-blue-600">Wall</span>
                  </h4>
                  <p className="text-[10px] text-gray-500">
                    Draw the glassmorphic zone where the graphic should
                    apply. The AI uses this box as the placement target so
                    the mockup lands exactly where you marked.
                  </p>
                  <ZoneMasker
                    key={surface.wallPhotoUrl}
                    imageUrl={surface.wallPhotoUrl}
                    zones={surface.vinylZones}
                    onChange={(zones: VinylZone[]) => onChange({ vinylZones: zones })}
                  />
                </div>
              )}

              {!showWallUpload && (
                <p className="text-[10px] text-gray-500">
                  Pick the wall type below and GraphicsPro will generate a photorealistic wall for you. No photo needed.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => onChange({ indoor: true })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                    surface.indoor ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Indoor
                </button>
                <button
                  onClick={() => onChange({ indoor: false })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                    !surface.indoor ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Outdoor
                </button>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Texture</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {WALL_TEXTURES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => onChange({ wallTexture: t.value })}
                      className={`p-2 rounded-md text-left border transition-colors ${
                        surface.wallTexture === t.value
                          ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className={`text-xs font-medium ${surface.wallTexture === t.value ? 'text-blue-600' : 'text-gray-700'}`}>{t.label}</span>
                      <span className="block text-xs text-gray-500/60">{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <DimensionInputs surface={surface} onChange={onChange} label="Wall" />
            </Card>
          )}

          {/* Glass Sub-Options */}
          {surface.type === 'glass' && (
            <Card className="p-4 space-y-3 bg-white border-gray-200">
              {/* Source toggle — mirrors Wall. AI-generated storefront is the
                  default; "I have a photo" lets RJ upload an actual storefront
                  picture and draw glassmorphic zones where vinyl goes. */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowGlassUpload(false);
                    if (surface.glassPhotoUrl) onChange({ glassPhotoFile: null, glassPhotoUrl: null });
                  }}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    !showGlassUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  Let AI generate the storefront
                </button>
                <button
                  onClick={() => setShowGlassUpload(true)}
                  className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                    showGlassUpload
                      ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  I have a photo of the storefront
                </button>
              </div>

              {showGlassUpload && (
                <div>
                  <Label className="text-xs text-gray-700 font-medium">Upload Your Storefront Photo</Label>
                  <p className="text-[10px] text-gray-400 mb-2">Upload a photo of the actual storefront / window so you can mark the glass panels that get vinyl</p>
                  <div
                    className={`border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-blue-500/50 transition-colors ${
                      surface.glassPhotoUrl ? "border-green-500/30 p-2" : "border-gray-200 p-4"
                    }`}
                    onClick={() => glassFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith("image/")) {
                        const previewUrl = URL.createObjectURL(file);
                        onChange({ glassPhotoFile: file, glassPhotoUrl: previewUrl });
                      }
                    }}
                  >
                    {surface.glassPhotoUrl ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={surface.glassPhotoUrl}
                          alt="Storefront photo"
                          className="h-14 w-20 rounded object-cover border border-green-500/30"
                        />
                        <div className="text-left flex-1">
                          <p className="text-xs font-medium text-green-400">Storefront photo uploaded</p>
                          <p className="text-[10px] text-gray-400">Click to change</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); onChange({ glassPhotoFile: null, glassPhotoUrl: null }); }}
                          className="text-xs text-red-400 hover:text-red-300 px-2"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 justify-center">
                        <Upload className="w-4 h-4 text-gray-300" />
                        <span className="text-xs text-gray-500">Drop storefront photo here or click to browse</span>
                      </div>
                    )}
                    <input
                      ref={glassFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const previewUrl = URL.createObjectURL(file);
                          onChange({ glassPhotoFile: file, glassPhotoUrl: previewUrl });
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Zone masker on uploaded storefront — same as the wall flow.
                  Each rectangle is a glass panel that gets vinyl. The AI
                  reads these zones as the placement targets. */}
              {showGlassUpload && surface.glassPhotoUrl && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-900">
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span><sup className="text-blue-600/80 text-[8px] ml-0.5">TM</sup> — Mark vinyl zones on <span className="text-blue-600">Storefront</span>
                  </h4>
                  <p className="text-[10px] text-gray-500">
                    Draw a glassmorphic box around each window panel that gets vinyl. Each zone can have its own dimensions and content (logo, hours, phone, etc.).
                  </p>
                  <ZoneMasker
                    key={surface.glassPhotoUrl}
                    imageUrl={surface.glassPhotoUrl}
                    zones={surface.vinylZones}
                    onChange={(zones: VinylZone[]) => onChange({ vinylZones: zones })}
                  />
                </div>
              )}

              {!showGlassUpload && (
                <p className="text-[10px] text-gray-500">
                  Pick the glass type below and GraphicsPro will generate a photorealistic storefront for you. No photo needed.
                </p>
              )}

              <div>
                <Label className="text-xs text-gray-500">Type</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {GLASS_TYPES.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => onChange({ glassType: g.value })}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        surface.glassType === g.value
                          ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => onChange({ glassMount: 'exterior' })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                    surface.glassMount === 'exterior' ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Exterior Mount
                </button>
                <button
                  onClick={() => onChange({ glassMount: 'interior' })}
                  className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                    surface.glassMount === 'interior' ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Interior Mount
                </button>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Tint</Label>
                <div className="flex gap-2 mt-1">
                  {(['clear', 'light', 'dark'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => onChange({ glassTint: t })}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                        surface.glassTint === t
                          ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                          : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {/* Render mode — picks one mockup style at a time. Single-
                  select instead of multi so each click runs ONE Gemini call.
                  Re-generate to try a different mode. Headlights mode is
                  only enabled when the vinyl finish is reflective (it's
                  the demo for reflective vinyl glowing back at car lights). */}
              <div>
                <Label className="text-xs text-gray-500">Render Mode</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <button
                    onClick={() => onChange({ glassRenderMode: 'day' })}
                    className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                      surface.glassRenderMode === 'day'
                        ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    ☀ Day
                  </button>
                  <button
                    onClick={() => onChange({ glassRenderMode: 'night' })}
                    className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                      surface.glassRenderMode === 'night'
                        ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    🌙 Night
                  </button>
                  <button
                    onClick={() => onChange({ glassRenderMode: 'headlights' })}
                    disabled={surface.paintFinish !== 'reflective'}
                    title={surface.paintFinish !== 'reflective' ? 'Pick reflective vinyl to enable the headlight demo' : ''}
                    className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                      surface.glassRenderMode === 'headlights'
                        ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                        : surface.paintFinish === 'reflective'
                          ? 'border-gray-200 text-gray-500 hover:border-gray-300'
                          : 'border-gray-100 text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    💡 Headlights
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  {surface.glassRenderMode === 'day' && 'Bright daylight, saturated colors, soft shadows.'}
                  {surface.glassRenderMode === 'night' && 'Realistic 9pm shot — interior store glow, streetlight, dark sky.'}
                  {surface.glassRenderMode === 'headlights' && 'Reflective vinyl glowing back at simulated car headlights. Killer demo for safety/visibility customers.'}
                </p>
              </div>

              {/* Reflective substrate selector — only shown when reflective
                  vinyl is the chosen finish. Cut letters and printed wraps
                  glow differently under headlights. */}
              {surface.paintFinish === 'reflective' && (
                <div>
                  <Label className="text-xs text-gray-500">Reflective Substrate</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      onClick={() => onChange({ vinylSubstrate: 'cut' })}
                      className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                        surface.vinylSubstrate === 'cut'
                          ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      Cut Vinyl
                    </button>
                    <button
                      onClick={() => onChange({ vinylSubstrate: 'printed' })}
                      className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                        surface.vinylSubstrate === 'printed'
                          ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      Printed Wrap
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {surface.vinylSubstrate === 'cut'
                      ? 'Plotter-cut letters in reflective sheet (Oracal 5750 RA). Letters glow as solid white-yellow shapes at night.'
                      : 'Full-color print on reflective base (3M 780mC, Avery RR1100). Printed colors stay visible AND the substrate glows back.'}
                  </p>
                </div>
              )}

              <DimensionInputs surface={surface} onChange={onChange} label="Glass" />
            </Card>
          )}

          {/* Studio Sub-Options — flat canvas mode, no customer photo.
              Mimics Adobe Illustrator: white artboard, zones become
              cut-path rectangles (rendered pink to match the cut-vinyl
              brand color), and the customer types per-zone copy that
              the AI uses verbatim. */}
          {surface.type === 'studio' && (
            <Card className="p-4 space-y-3 bg-white border-gray-200">
              <div className="flex items-start gap-2">
                <LayoutDashboard className="w-4 h-4 text-[#ec4899] mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-900">Studio Canvas</h4>
                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    Adobe Illustrator-style artboard. Draw zones, type what
                    each zone says, and the AI uses your exact copy + design
                    prompt. Cut paths show in pink so you can preview the
                    plotter cut line before sending to production.
                  </p>
                </div>
              </div>

              {/* Print bleed picker — only relevant for Print & Cut mode
                  since Layered Cut Vinyl is solid color, no print, no
                  bleed needed. Default 1/8" = vehicle-decal standard. */}
              {surface.vinylSubstrate === 'printed' && (
                <div>
                  <Label className="text-xs text-gray-700 font-medium">Print Bleed</Label>
                  <p className="text-[11px] text-gray-500 mb-1.5">
                    Print extends past the cut line so a tiny misalignment doesn't show white edges.
                  </p>
                  <div className="flex gap-2">
                    {[
                      { val: 0.125, label: '1/8"', sub: 'Vehicle decals' },
                      { val: 0.25, label: '1/4"', sub: 'Window vinyl' },
                      { val: 0, label: 'None', sub: 'Cut exact' },
                    ].map((opt) => {
                      const active = (surface.bleedInches ?? 0.125) === opt.val;
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => onChange({ bleedInches: opt.val })}
                          className={`flex-1 rounded-md border px-2.5 py-1.5 text-left transition-all ${
                            active
                              ? 'border-[#ec4899] bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 ring-1 ring-[#ec4899]'
                              : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold text-gray-900">{opt.label}</div>
                          <div className="text-[10px] text-gray-500">{opt.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    Cut path is exported with a <span className="font-semibold">CutContour</span> spot color (Roland / Graphtec / Summa standard), with the bleed offset baked into the print layer.
                  </p>
                </div>
              )}

              {/* Cut style toggle — the AI prompt changes based on this:
                  - 'printed' = full-color printed graphic with a contour
                    cut line around it (think band stickers, decals)
                  - 'cut' = solid vinyl pieces cut from colored film and
                    layered on top of each other (think old-school sign
                    shop multi-color decals — one color per layer, no
                    print). The mockup style and the cut files differ. */}
              <div>
                <Label className="text-xs text-gray-700 font-medium">Cut Style</Label>
                <p className="text-[11px] text-gray-500 mb-1.5">How should the final piece be produced?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ vinylSubstrate: 'printed' })}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      surface.vinylSubstrate === 'printed'
                        ? 'border-[#ec4899] bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 ring-1 ring-[#ec4899]'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="text-sm font-bold text-gray-900 mb-0.5">Print &amp; Cut</div>
                    <p className="text-[11px] text-gray-600 leading-snug">
                      Full-color printed graphic with a contour cut line.
                      Photo-real artwork, gradients, multi-color in a
                      single piece.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ vinylSubstrate: 'cut' })}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      surface.vinylSubstrate === 'cut'
                        ? 'border-[#ec4899] bg-gradient-to-br from-[#3b82f6]/10 to-[#ec4899]/10 ring-1 ring-[#ec4899]'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="text-sm font-bold text-gray-900 mb-0.5">Layered Cut Vinyl</div>
                    <p className="text-[11px] text-gray-600 leading-snug">
                      Solid-color film cut from sheets and stacked. Each
                      layer is one Pantone — like classic sign-shop multi-
                      color decals.
                    </p>
                  </button>
                </div>
              </div>

              <ZoneMasker
                imageUrl="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201600%20900%22%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22%23ffffff%22%2F%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2240%22%20height%3D%2240%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%2040%200%20L%200%200%200%2040%22%20fill%3D%22none%22%20stroke%3D%22%23f1f5f9%22%20stroke-width%3D%221%22%2F%3E%3C%2Fpattern%3E%3C%2Fdefs%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22url%28%23g%29%22%2F%3E%3C%2Fsvg%3E"
                zones={surface.vinylZones}
                onChange={(zones: VinylZone[]) => onChange({ vinylZones: zones })}
              />

              {/* Layer Films — only shown when 'Layered Cut Vinyl' is the
                  selected cut style. One layer per zone, each layer is a
                  single Pantone / film, customer picks the actual film for
                  each so the AI mockup and the production cut files use
                  the right color. Pre-set list covers the 90% case;
                  'Custom...' lets them type any film name. */}
              {surface.vinylSubstrate === 'cut' && surface.vinylZones.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                  <div className="flex items-baseline justify-between mb-2">
                    <Label className="text-xs font-semibold text-gray-900">
                      Layer Films
                    </Label>
                    <span className="text-[11px] text-gray-500">
                      {surface.vinylZones.length} layer{surface.vinylZones.length === 1 ? '' : 's'} · one per zone
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {surface.vinylZones.map((zone, i) => (
                      <div key={zone.id} className="grid grid-cols-[auto_1fr] items-center gap-2">
                        <span className="text-xs font-medium text-gray-700 min-w-[60px]">
                          {zone.label}
                        </span>
                        <select
                          value={zone.filmColor || ''}
                          onChange={(e) => {
                            const updated = surface.vinylZones.map((z) =>
                              z.id === zone.id ? { ...z, filmColor: e.target.value } : z
                            );
                            onChange({ vinylZones: updated });
                          }}
                          className="h-8 text-xs bg-white border border-gray-200 rounded-md px-2 text-gray-900"
                        >
                          <option value="">Pick a film…</option>
                          <optgroup label="Solid Gloss">
                            <option>Gloss White</option>
                            <option>Gloss Black</option>
                            <option>Gloss Red</option>
                            <option>Gloss Blue</option>
                            <option>Gloss Yellow</option>
                            <option>Gloss Green</option>
                            <option>Gloss Orange</option>
                          </optgroup>
                          <optgroup label="Matte">
                            <option>Matte White</option>
                            <option>Matte Black</option>
                            <option>Matte Silver</option>
                          </optgroup>
                          <optgroup label="Metallic / Chrome">
                            <option>Chrome (Mirror)</option>
                            <option>Brushed Chrome</option>
                            <option>Brushed Aluminum</option>
                            <option>Metallic Silver</option>
                            <option>Gold Foil</option>
                            <option>Rose Gold</option>
                          </optgroup>
                          <optgroup label="Specialty">
                            <option>Carbon Fiber Black</option>
                            <option>Holographic Silver</option>
                            <option>Reflective Silver</option>
                            <option>Reflective Yellow</option>
                            <option>Glow-in-the-Dark</option>
                          </optgroup>
                          <option value="__custom__">Custom — type below</option>
                        </select>
                        {zone.filmColor === '__custom__' && (
                          <Input
                            placeholder="e.g. Avery SW900-101 Gloss Carmine Red"
                            value=""
                            onChange={(e) => {
                              const updated = surface.vinylZones.map((z) =>
                                z.id === zone.id ? { ...z, filmColor: e.target.value } : z
                              );
                              onChange({ vinylZones: updated });
                            }}
                            className="col-start-2 h-8 text-xs bg-white border-gray-200 text-gray-900"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {surface.vinylZones.some((z) => !z.filmColor) && (
                    <p className="text-[11px] text-amber-600 mt-2">
                      ⚠ Pick a film for every layer — the AI mockup uses these to render the right color stack.
                    </p>
                  )}
                </div>
              )}

              <DimensionInputs surface={surface} onChange={onChange} label="Studio" />
            </Card>
          )}

          {/* Floor & signage paths intentionally removed — different vinyl
              film, different markup, different prep workflow. */}
        </TabsContent>
      </Tabs>
    </div>
  );
}
