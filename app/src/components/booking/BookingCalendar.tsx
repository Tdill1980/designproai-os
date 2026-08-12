/**
 * BookingCalendar — buyer-facing service + slot picker.
 *
 * Collects: service, date/time, vehicle info, reference photos, notes.
 * On submit, uploads images to Supabase Storage then calls
 * submit-public-booking with attachment URLs.
 */

import { useMemo, useRef, useState } from "react";
import { Calendar, Clock, DollarSign, Loader2, CheckCircle2, AlertTriangle, Upload, X, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  useShopServices,
  useShopAvailability,
  computeAvailableSlots,
  groupSlotsByDate,
  type ServiceCatalogRow,
} from "@/hooks/useShopBooking";

interface Props {
  shopId: string;
  shopSlug: string;
  shopName: string;
  customer: { name?: string; email?: string; phone?: string };
  vehicle: { year?: string; make?: string; model?: string };
  quoteId?: string | null;
  onVehicleChange?: (v: { year: string; make: string; model: string }) => void;
}

const formatDateLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const MAX_UPLOADS = 5;
const MAX_FILE_MB = 10;

export const BookingCalendar = ({ shopId, shopSlug, shopName, customer, vehicle, quoteId, onVehicleChange }: Props) => {
  const { toast } = useToast();
  const { data: services = [], isLoading: servicesLoading } = useShopServices(shopId);
  const { data: availability = [] } = useShopAvailability(shopId);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ when: string; service: string } | null>(null);

  // Vehicle state (editable if onVehicleChange provided, otherwise uses props)
  const [localYear, setLocalYear] = useState(vehicle.year || "");
  const [localMake, setLocalMake] = useState(vehicle.make || "");
  const [localModel, setLocalModel] = useState(vehicle.model || "");

  // Image upload state
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; url: string; preview: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveVehicle = onVehicleChange
    ? { year: localYear, make: localMake, model: localModel }
    : vehicle;

  const selectedService: ServiceCatalogRow | null =
    services.find((s) => s.slug === selectedSlug) || services[0] || null;

  if (!selectedSlug && services.length > 0) {
    setSelectedSlug(services[0].slug);
  }

  const slots = useMemo(() => {
    if (!selectedService || availability.length === 0) return [];
    return computeAvailableSlots(availability, selectedService.duration_minutes, 14);
  }, [selectedService, availability]);

  const grouped = useMemo(() => groupSlotsByDate(slots), [slots]);
  const dateKeys = useMemo(() => Array.from(grouped.keys()).slice(0, 10), [grouped]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_UPLOADS - uploadedFiles.length;
    if (remaining <= 0) {
      toast({ variant: "destructive", title: `Max ${MAX_UPLOADS} photos allowed` });
      return;
    }

    const toUpload = files.slice(0, remaining);
    const oversized = toUpload.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversized.length > 0) {
      toast({ variant: "destructive", title: `Photos must be under ${MAX_FILE_MB}MB` });
      return;
    }

    setUploading(true);
    try {
      const newFiles: typeof uploadedFiles = [];

      for (const file of toUpload) {
        const ext = file.name.split(".").pop() || "jpg";
        const ts = Date.now() + Math.random().toString(36).slice(2, 6);
        const path = `booking-attachments/${shopSlug}/${ts}.${ext}`;

        const { error } = await supabase.storage
          .from("patterns")
          .upload(path, file, { cacheControl: "3600", upsert: false });

        if (error) {
          console.error("Upload error:", error);
          toast({ variant: "destructive", title: "Upload failed", description: error.message });
          continue;
        }

        const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(path);

        newFiles.push({
          name: file.name,
          url: publicUrl,
          preview: URL.createObjectURL(file),
        });
      }

      setUploadedFiles((prev) => [...prev, ...newFiles]);
      if (newFiles.length > 0) {
        toast({ title: `${newFiles.length} photo${newFiles.length > 1 ? "s" : ""} uploaded` });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!selectedService || !selectedSlot) {
      toast({ variant: "destructive", title: "Pick a service and a time" });
      return;
    }
    if (!customer.email && !customer.phone) {
      toast({
        variant: "destructive",
        title: "Contact info missing",
        description: "Add an email or phone above so the shop can reach you.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-public-booking", {
        body: {
          shopSlug,
          serviceSlug: selectedService.slug,
          scheduledAt: selectedSlot,
          customer,
          vehicle: effectiveVehicle,
          quoteId: quoteId || undefined,
          notes: notes || undefined,
          attachmentUrls: uploadedFiles.map((f) => f.url),
        },
      });
      if (error || !data?.ok) {
        toast({
          variant: "destructive",
          title: "Booking failed",
          description: data?.error || error?.message || "Please try another slot.",
        });
        return;
      }
      const when = new Date(data.scheduledAt).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      setConfirmation({ when, service: data.serviceName });
      toast({ title: "Booked", description: `${data.serviceName} at ${when}.` });
    } finally {
      setSubmitting(false);
    }
  };

  if (servicesLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#00C7FF]" />
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-8 text-center text-white/60">
        <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
        {shopName} hasn't set up bookable services yet.
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="rounded-2xl border border-[#22c55e]/30 bg-[#22c55e]/5 p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-[#22c55e] mx-auto mb-3" />
        <div className="text-xl font-bold mb-1">You're booked.</div>
        <p className="text-white/70">
          <span className="text-[#22c55e] font-semibold">{confirmation.service}</span>
          <br />
          {confirmation.when}
        </p>
        <p className="text-xs text-white/40 mt-4">
          {shopName} will confirm and follow up at the contact you provided.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Calendar className="w-5 h-5 text-[#00C7FF]" />
        <h2 className="text-lg font-semibold">Book a slot</h2>
      </div>

      {/* Service tabs */}
      <div className="grid grid-cols-2 gap-2">
        {services.map((s) => {
          const isSelected = s.slug === selectedSlug;
          return (
            <button
              key={s.slug}
              onClick={() => { setSelectedSlug(s.slug); setSelectedSlot(null); }}
              className={[
                "rounded-lg border px-3 py-3 text-left transition-colors",
                isSelected ? "border-[#00C7FF] bg-[#00C7FF]/10" : "border-white/10 bg-[#1a1a1a] hover:border-white/20",
              ].join(" ")}
            >
              <div className="text-sm font-semibold text-white">{s.name}</div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-white/50">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {s.duration_minutes < 60 ? `${s.duration_minutes}m` : `${Math.round(s.duration_minutes / 60)}h`}
                </span>
                {s.base_price > 0 && (
                  <span className="flex items-center gap-1 text-[#22c55e] font-semibold">
                    <DollarSign className="w-3 h-3" />{s.base_price.toFixed(0)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedService?.description && (
        <p className="text-xs text-white/50 leading-relaxed">{selectedService.description}</p>
      )}

      {/* Vehicle info */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-2">Vehicle</div>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Year"
            value={onVehicleChange ? localYear : vehicle.year || ""}
            onChange={(e) => { setLocalYear(e.target.value); onVehicleChange?.({ year: e.target.value, make: localMake, model: localModel }); }}
            readOnly={!onVehicleChange}
            className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm ${!onVehicleChange ? "text-white/50" : ""}`}
          />
          <input
            type="text"
            placeholder="Make"
            value={onVehicleChange ? localMake : vehicle.make || ""}
            onChange={(e) => { setLocalMake(e.target.value); onVehicleChange?.({ year: localYear, make: e.target.value, model: localModel }); }}
            readOnly={!onVehicleChange}
            className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm ${!onVehicleChange ? "text-white/50" : ""}`}
          />
          <input
            type="text"
            placeholder="Model"
            value={onVehicleChange ? localModel : vehicle.model || ""}
            onChange={(e) => { setLocalModel(e.target.value); onVehicleChange?.({ year: localYear, make: localMake, model: e.target.value }); }}
            readOnly={!onVehicleChange}
            className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm ${!onVehicleChange ? "text-white/50" : ""}`}
          />
        </div>
      </div>

      {/* Calendar grid */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-2">Pick a date & time</div>
        {dateKeys.length === 0 ? (
          <div className="text-sm text-white/50 px-2 py-6 text-center border border-dashed border-white/10 rounded-lg">
            No availability published yet for this service.
          </div>
        ) : (
          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {dateKeys.map((key) => {
              const daySlots = grouped.get(key) || [];
              return (
                <div key={key}>
                  <div className="text-xs font-semibold text-white/70 mb-1">{formatDateLabel(key)}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {daySlots.map((slot) => {
                      const isSel = slot.iso === selectedSlot;
                      return (
                        <button
                          key={slot.iso}
                          onClick={() => setSelectedSlot(slot.iso)}
                          className={[
                            "rounded-md border px-2.5 py-1 text-xs transition-colors",
                            isSel ? "border-[#00C7FF] bg-[#00C7FF] text-black font-semibold" : "border-white/10 bg-[#1a1a1a] text-white/80 hover:border-white/30",
                          ].join(" ")}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reference photo upload */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-2">
          Reference Photos <span className="normal-case text-white/25">(optional · up to {MAX_UPLOADS})</span>
        </div>

        {uploadedFiles.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            {uploadedFiles.map((f, i) => (
              <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 shrink-0 group">
                <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeFile(i)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {uploadedFiles.length < MAX_UPLOADS && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border border-dashed border-white/15 rounded-lg py-3 flex items-center justify-center gap-2 text-xs text-white/50 hover:border-white/30 hover:text-white/70 transition-colors"
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
            ) : (
              <><ImageIcon className="w-4 h-4" /> Add photos — tint darkness, design ideas, vehicle condition</>
            )}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <textarea
        placeholder="Notes for the shop (e.g. how dark you want the tint, design references, drop-off preference)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm resize-none"
      />

      <button
        disabled={!selectedSlot || submitting}
        onClick={handleSubmit}
        className={[
          "w-full rounded-lg py-3 font-semibold transition-colors",
          !selectedSlot || submitting
            ? "bg-white/10 text-white/40 cursor-not-allowed"
            : "bg-[#00C7FF] text-black hover:bg-[#33d4ff]",
        ].join(" ")}
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Booking...
          </span>
        ) : selectedSlot ? (
          `Book ${selectedService?.name}`
        ) : (
          "Pick a time to continue"
        )}
      </button>
    </div>
  );
};
