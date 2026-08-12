/**
 * WpwTriButtonCTA — 3-button CTA cluster used on WPW homepage sliders
 * and as a popup on restyleproai.com.
 *
 * Buttons:
 *   1. "Talk to a rep" — opens a lead-capture modal (form submit creates
 *      a row in public.inbound_leads; round-robin assignment to an active
 *      affiliate happens server-side in a follow-up edge function).
 *   2. "Buy a subscription" — links to /pricing.
 *   3. "Try DesignPro for $25" — links to /designpro?try=1.
 *
 * Drop-in. Props let the caller change variant (compact for sliders,
 * standalone for popups) without forking the component.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Sparkles, ShoppingCart, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface WpwTriButtonCTAProps {
  variant?: "compact" | "standalone";
  source?: string;
  className?: string;
}

const db = supabase as never as { from: (t: string) => any };

export function WpwTriButtonCTA({
  variant = "standalone",
  source = "unknown",
  className = "",
}: WpwTriButtonCTAProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", question: "" });

  const compact = variant === "compact";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name || (!form.email && !form.phone)) {
      toast.error("Please add your name and at least an email or phone.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await db.from("inbound_leads").insert({
        full_name: form.full_name,
        email: form.email || null,
        phone: form.phone || null,
        question: form.question || null,
        source,
        page_url: typeof window !== "undefined" ? window.location.href : null,
        status: "new",
      });
      if (error) throw error;
      toast.success("Got it — a rep will reach out within one business day.");
      setForm({ full_name: "", email: "", phone: "", question: "" });
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Couldn't submit — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className={[
          "grid gap-2 sm:gap-3 w-full",
          compact
            ? "grid-cols-1 sm:grid-cols-3 max-w-2xl"
            : "grid-cols-1 sm:grid-cols-3 max-w-3xl mx-auto",
          className,
        ].join(" ")}
      >
        <Button
          onClick={() => setOpen(true)}
          size={compact ? "sm" : "lg"}
          className="bg-white text-gray-900 hover:bg-gray-100 border border-gray-200 font-bold shadow-sm"
        >
          <Phone className={compact ? "w-3.5 h-3.5 mr-1.5" : "w-4 h-4 mr-2"} />
          Talk to a Rep
        </Button>

        <Button
          asChild
          size={compact ? "sm" : "lg"}
          className="bg-gradient-to-r from-blue-500 via-purple-500 to-fuchsia-500 hover:opacity-90 text-white font-bold shadow-sm"
        >
          <Link to="/pricing">
            <ShoppingCart className={compact ? "w-3.5 h-3.5 mr-1.5" : "w-4 h-4 mr-2"} />
            Buy a Subscription
          </Link>
        </Button>

        <Button
          asChild
          size={compact ? "sm" : "lg"}
          className="bg-[#FF5A1F] hover:bg-[#ff7039] text-white font-bold shadow-sm"
        >
          <Link to="/designpro?try=1">
            <Sparkles className={compact ? "w-3.5 h-3.5 mr-1.5" : "w-4 h-4 mr-2"} />
            Try DesignPro — $250
          </Link>
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Talk to a Rep</DialogTitle>
            <p className="text-sm text-gray-600 mt-1">
              Drop your details — one of our reps (real human, not a bot) will reach out
              within one business day to answer system questions and walk you through it.
            </p>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="full_name">Your name *</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@email.com"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 -mt-1">Email or phone required.</p>
            <div>
              <Label htmlFor="question">What can we help with?</Label>
              <Textarea
                id="question"
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="Pricing, custom wraps, fleet, anything…"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:opacity-90 text-white font-bold"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Request a Call"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default WpwTriButtonCTA;
