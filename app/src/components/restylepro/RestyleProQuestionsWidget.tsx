import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircleQuestion, Send, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

/**
 * Site-wide "Questions / Instant Answers" widget for DesignProAI customers.
 *
 * - A floating button on every customer-facing page opens the dialog.
 * - The same dialog also opens when any element dispatches the
 *   `restylepro:open-questions` window event — that's how the above-the-fold
 *   entry on the marketing landing page (Index.tsx) opens it without prop
 *   drilling across the lazy route boundary.
 * - Hidden on admin tooling and embedded/iframe proof pages.
 *
 * Submissions go to the submit-restylepro-contact edge function, which stores
 * them and emails the owner with Reply-To set to the customer.
 */

export const RESTYLEPRO_QUESTIONS_EVENT = "restylepro:open-questions";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is DesignProAI?",
    a: "An AI vehicle-wrap design platform. Describe your wrap (or upload a reference) and get photorealistic, print-ready designs — with 7 view angles and a 3D proof — in minutes.",
  },
  {
    q: "How much is a single custom design?",
    a: "$250 one-time gets you one custom full-vehicle wrap design with 3 revisions, 7 view angles, and a 3D proof. No subscription and no recurring charges.",
  },
  {
    q: "Do I need a subscription?",
    a: "No. You can buy a single design, or subscribe to a monthly plan (Starter, DesignPro Lite, Studio, or Plus) for a monthly allotment of renders if you design often.",
  },
  {
    q: "Can I make changes to my design?",
    a: "Yes — revisions are included so you can refine your design until it's exactly what you want before you take it to print.",
  },
  {
    q: "How do I get print-ready files?",
    a: "When your design is ready, order a production pack: print-ready panel files at the correct DPI with bleed and crop marks, ready for your installer or printer.",
  },
  {
    q: "Which plan is right for me?",
    a: "Tell us your volume below and choose “Not sure — help me choose.” We'll follow up with a recommendation.",
  },
];

const TIERS = [
  { value: "starter", label: "Starter" },
  { value: "designpro_lite", label: "DesignPro Lite" },
  { value: "designpro_studio", label: "DesignPro Studio" },
  { value: "designpro_plus", label: "DesignPro Plus" },
  { value: "not_sure", label: "Not sure — help me choose" },
];

const NONE = "__none__";

export function RestyleProQuestionsWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [tier, setTier] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(RESTYLEPRO_QUESTIONS_EVENT, handler);
    return () => window.removeEventListener(RESTYLEPRO_QUESTIONS_EVENT, handler);
  }, []);

  // Hide on admin tooling and embedded proof pages.
  const path = location.pathname.toLowerCase();
  const hidden =
    path.startsWith("/admin") ||
    path.startsWith("/engineroom") ||
    path.startsWith("/proof") ||
    path.startsWith("/wpw-proof");
  if (hidden) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const hasTier = tier !== NONE;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (!message.trim() && !hasTier) {
      toast.error("Add a question or pick a tier you'd like to hear about.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-restylepro-contact", {
        body: {
          name: name.trim(),
          email: trimmedEmail,
          message: message.trim(),
          topic: hasTier ? "tier_inquiry" : "question",
          tierInterest: hasTier ? tier : null,
          pagePath: location.pathname,
        },
      });
      if (error || (data && (data as any).ok === false)) {
        throw new Error((data as any)?.error || error?.message || "Submission failed");
      }
      toast.success("Got it! We'll get back to you by email shortly.");
      setName("");
      setEmail("");
      setMessage("");
      setTier(NONE);
      setOpen(false);
    } catch (err) {
      console.error("[RestyleProQuestionsWidget] submit failed:", err);
      toast.error("Sorry — that didn't go through. Please try again or email trish@weprintwraps.com.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Questions? Get instant answers"
        className={cn(
          "fixed z-40 bottom-20 left-4 md:bottom-6 md:left-6",
          "inline-flex items-center gap-2 rounded-full px-4 py-3 shadow-lg",
          "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-semibold text-sm",
          "hover:opacity-90 transition-opacity",
        )}
      >
        <MessageCircleQuestion className="h-5 w-5" />
        <span className="hidden sm:inline">Questions?</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white text-gray-900 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Sparkles className="h-5 w-5 text-[#ec4899]" />
              Instant Answers
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              Quick answers below — still stuck? Send us a note and we'll reply by email.
            </DialogDescription>
          </DialogHeader>

          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-sm font-semibold text-gray-900">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-gray-600">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-2 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Still have a question?</h3>
            <p className="text-xs text-gray-500 mb-3">
              Ask us anything, or choose a plan you'd like us to walk you through.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="rpq-name" className="text-xs text-gray-600">Name</Label>
                  <Input
                    id="rpq-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rpq-email" className="text-xs text-gray-600">Email *</Label>
                  <Input
                    id="rpq-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="rpq-tier" className="text-xs text-gray-600">
                  Contact me about a tier level (optional)
                </Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger id="rpq-tier" className="bg-white border-gray-300 text-gray-900">
                    <SelectValue placeholder="Select a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No thanks — just a question</SelectItem>
                    {TIERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="rpq-message" className="text-xs text-gray-600">Message</Label>
                <Textarea
                  id="rpq-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What can we help you with?"
                  rows={3}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:opacity-90"
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" /> Send</>
                )}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RestyleProQuestionsWidget;
