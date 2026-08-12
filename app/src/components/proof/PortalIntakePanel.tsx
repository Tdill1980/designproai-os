/**
 * PortalIntakePanel — the branded ApprovePro × WePrintWraps customer portal
 * panel shown when an order has no design yet (the intake stage), OR as the
 * always-available "track + add details" zone.
 *
 * Branding: blue→magenta gradient, ApprovePro™ × WePrintWraps.com wordmark,
 * "Vehicle Wrap Design & Approval System" tagline, Ace ("your graphic
 * designer") + Sprocket (the helper). A live status tracker so the customer can
 * track at any time, plus the intake form: type your brief + upload examples →
 * proof-intake-submit (no login).
 */

import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ImagePlus, X, Check, Send } from "lucide-react";

const ACE_IMG = "/characters/ace-desk-branded.png";
const SPROCKET_IMG = "/characters/sproket/sproket-clipboard.png";

type Step = { key: string; label: string };
const STEPS: Step[] = [
  { key: "received", label: "Order received" },
  { key: "designing", label: "Ace is designing" },
  { key: "proof", label: "Proof ready" },
  { key: "approved", label: "Approved" },
];

function currentStepIndex(status: string, hasDesign: boolean): number {
  if (status === "approved") return 3;
  if (hasDesign && ["sent", "viewed", "revising", "declined"].includes(status)) return 2;
  if (hasDesign) return 2;
  return 1; // received → designing
}

interface PendingRef { path: string; previewUrl: string | null; }

const MAX_REFS = 12;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

interface Props {
  token: string;
  status: string;
  hasDesign: boolean;
  shopName?: string | null;
  onSubmitted: () => void;
}

export function PortalIntakePanel({ token, status, hasDesign, shopName, onSubmitted }: Props) {
  const { toast } = useToast();
  const [instructions, setInstructions] = useState("");
  const [refs, setRefs] = useState<PendingRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepIdx = currentStepIndex(status, hasDesign);

  const pickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files).slice(0, MAX_REFS - refs.length)) {
      if (!ALLOWED.has(file.type)) { toast({ title: "Use JPEG, PNG, WebP or HEIC", variant: "destructive" }); continue; }
      if (file.size > MAX_BYTES) { toast({ title: `${file.name} is over 8MB`, variant: "destructive" }); continue; }
      setUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const { data, error } = await supabase.functions.invoke("proof-upload-revision-ref", {
          body: { token, filename: file.name, content_type: file.type, data_base64: base64 },
        });
        if (error || !data?.success) { toast({ title: `${file.name} upload failed`, variant: "destructive" }); continue; }
        setRefs((p) => [...p, { path: data.path, previewUrl: data.preview_url || null }]);
      } finally { setUploading(false); }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (instructions.trim().length < 3 && refs.length === 0) {
      toast({ title: "Add a description or an example image", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("proof-intake-submit", {
        body: { token, instructions: instructions.trim(), reference_image_paths: refs.map((r) => r.path) },
      });
      if (error || !data?.success) {
        toast({ title: "Couldn't submit", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      setDone(true);
      onSubmitted();
    } finally { setSubmitting(false); }
  };

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="p-5 space-y-5">
        {done ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
            <img src={SPROCKET_IMG} alt="Sprocket" className="w-10 h-10 object-contain shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-900">Thank you — your portal is updated! 🙌</p>
              <p className="text-[13px] text-emerald-800 mt-0.5">Ace is on it. Expect your design proof within <strong>about one business day</strong> — we'll email &amp; text you the moment it's ready. When it lands you'll <strong>revise it right here</strong> and see the new version in about <strong>2 minutes</strong>.</p>
            </div>
          </div>
        ) : (
          <>
            {/* What to expect */}
            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-fuchsia-50 border border-blue-100 p-4 flex gap-3">
              <img src={SPROCKET_IMG} alt="Sprocket" className="w-12 h-12 object-contain shrink-0" />
              <div className="text-[15px] text-gray-800 leading-relaxed">
                {hasDesign ? (
                  <><span className="font-bold text-gray-900">Want changes?</span> Describe what to tweak and <strong>upload any logos, photos, or references</strong> — we'll revise your design and save a new version for you to approve, right here.</>
                ) : (
                  <><span className="font-bold text-gray-900">Here's what to expect:</span> type what you want below <strong>and/or upload screenshots of any past emails</strong>, examples, logos, or inspiration — drop in as many as you like. We design your wrap, then you <strong>revise it</strong> and <strong>approve</strong> — right here, anytime, from any device.</>
                )}
              </div>
            </div>

            {/* Intake form */}
            <div className="space-y-3">
              <label className="block text-lg font-bold text-gray-900">{hasDesign ? "Request a change — and upload any references" : "Tell us what you want — and upload your examples"}</label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Matte black base, neon-green geometric stripes down the sides, my logo on the hood. Vehicle: 2024 Ford F-150."
                className="min-h-[140px] text-[16px] border-gray-300 bg-white text-gray-900"
                maxLength={4000}
                disabled={submitting}
              />
              {refs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refs.map((r, i) => (
                    <div key={i} className="relative">
                      {r.previewUrl
                        ? <img src={r.previewUrl} alt="" className="w-16 h-16 rounded-md object-cover border border-gray-200" />
                        : <div className="w-16 h-16 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center"><ImagePlus className="w-5 h-5 text-gray-400" /></div>}
                      <button type="button" onClick={() => setRefs((p) => p.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickFiles} />
                <Button type="button" variant="outline" className="h-12 px-4 text-[15px] border-2 border-blue-300 text-blue-700 hover:bg-blue-50 font-bold"
                  disabled={submitting || uploading || refs.length >= MAX_REFS}
                  onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="w-5 h-5 mr-1.5 animate-spin" /> : <ImagePlus className="w-5 h-5 mr-1.5" />}
                  Add screenshots / logos / examples
                </Button>
                <Button type="button" onClick={submit}
                  disabled={submitting || uploading || (instructions.trim().length < 3 && refs.length === 0)}
                  className="h-12 flex-1 text-white text-[16px] font-extrabold" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
                  {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Send to Ace</>}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
