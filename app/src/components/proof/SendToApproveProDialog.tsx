/**
 * SendToApproveProDialog — push a design made in a tool (GraphicsPro /
 * RecreatePro / etc.) INTO ApprovePro.
 *
 * Two paths:
 *  1. "Load into an existing order" — the shop types an ApprovePro order /
 *     job number (the WePrintWraps order number, the PROOF-xxxx code, or the
 *     full order id). We resolve the proof_approvals row and attach the current
 *     design to it (proof-save-version + source_visualization_id) — exactly how
 *     the in-ApprovePro "Attach a design" works, just driven from the tool side.
 *  2. "Create a new order" — no number yet, so we mint one. proof-create makes
 *     the proof_approvals row; its number is the existing PROOF-<id8> code.
 *
 * Reuses the deployed proof-save-version + proof-create edge functions — no
 * new backend, no migration.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Link2, FilePlus2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SendToApproveProContext {
  visualizationId?: string | null;
  renderUrls: Record<string, string>;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleType?: string | null;
  designName?: string | null;
  finishType?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: SendToApproveProContext;
}

/** Short, shop-facing order code for a DesignProAI-only order (matches ApprovePro). */
const proofCode = (id: string) => `PROOF-${id.slice(0, 8).toUpperCase()}`;

export function SendToApproveProDialog({ open, onOpenChange, context }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [orderInput, setOrderInput] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneCode, setDoneCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setOrderInput(""); setDoneCode(null); }
  }, [open]);

  const hasRenders = !!context.renderUrls && Object.values(context.renderUrls).some(Boolean);

  /** Find the proof_approvals order the shop typed: WPW order number, full id, or PROOF-xxxx code. */
  const resolveExistingOrder = async (raw: string): Promise<{ id: string } | null> => {
    const input = raw.trim();
    if (!input) return null;

    // 1. WePrintWraps order number (stored in metadata).
    const byWpw = await supabase
      .from("proof_approvals" as any)
      .select("id")
      .eq("metadata->>wpw_order_number", input)
      .limit(1)
      .maybeSingle();
    if ((byWpw.data as any)?.id) return { id: (byWpw.data as any).id };

    // 2. Full order id (uuid) pasted directly.
    if (/^[0-9a-f-]{32,36}$/i.test(input)) {
      const byId = await supabase
        .from("proof_approvals" as any)
        .select("id")
        .eq("id", input)
        .limit(1)
        .maybeSingle();
      if ((byId.data as any)?.id) return { id: (byId.data as any).id };
    }

    // 3. PROOF-xxxxxxxx code → match the order id prefix (client-side, bounded).
    const codeMatch = input.toUpperCase().replace(/^PROOF-/, "");
    if (/^[0-9A-F]{4,8}$/.test(codeMatch)) {
      const recent = await supabase
        .from("proof_approvals" as any)
        .select("id")
        .order("created_at", { ascending: false })
        .limit(500);
      const hit = ((recent.data as any[]) || []).find(
        (r) => String(r.id).slice(0, codeMatch.length).toUpperCase() === codeMatch,
      );
      if (hit?.id) return { id: hit.id };
    }
    return null;
  };

  /** Attach the current design to an existing proof as its active version + link it. */
  const attachToOrder = async (proofId: string) => {
    const { data, error } = await supabase.functions.invoke("proof-save-version", {
      body: { proof_id: proofId, render_urls: context.renderUrls, shop_message: "Design sent from RP tools" },
      headers: { "Idempotency-Key": `sendto-${proofId}-${context.visualizationId || "x"}-${Date.now()}` },
    });
    if (error || !(data as any)?.success) {
      let msg = (data as any)?.error || error?.message || "Attach failed";
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.json === "function") {
        try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
      }
      throw new Error(msg);
    }
    if (context.visualizationId) {
      await supabase
        .from("proof_approvals" as any)
        .update({ source_visualization_id: context.visualizationId })
        .eq("id", proofId);
    }
  };

  const handleLoadIntoExisting = async () => {
    if (!hasRenders) { toast({ title: "No design to send", description: "Generate a design first.", variant: "destructive" }); return; }
    if (!orderInput.trim()) { toast({ title: "Enter the order number", description: "Type the ApprovePro / WePrintWraps order number (or PROOF-xxxx code).", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const order = await resolveExistingOrder(orderInput);
      if (!order) {
        toast({ title: "Order not found", description: `No ApprovePro order matched "${orderInput.trim()}". Check the number, or create a new order.`, variant: "destructive" });
        return;
      }
      await attachToOrder(order.id);
      setDoneCode(orderInput.trim());
      toast({ title: "Design loaded into the order", description: "It's now the proof's version — open ApprovePro to send or revise." });
    } catch (e: any) {
      toast({ title: "Couldn't load the design", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNew = async () => {
    if (!hasRenders) { toast({ title: "No design to send", description: "Generate a design first.", variant: "destructive" }); return; }
    if (!customerEmail.trim()) { toast({ title: "Customer email required", description: "ApprovePro needs an email to create the order.", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("proof-create", {
        body: {
          customer_email: customerEmail.trim(),
          mode: "revision_loop",
          source_visualization_id: context.visualizationId || null,
          render_urls: context.renderUrls,
          vehicle_year: context.vehicleYear ? String(context.vehicleYear) : null,
          vehicle_make: context.vehicleMake || null,
          vehicle_model: context.vehicleModel || null,
          vehicle_type: context.vehicleType || null,
          design_name: context.designName || null,
          finish_type: context.finishType || null,
        },
      });
      const newId = (data as any)?.proof_id || (data as any)?.id;
      if (error || !newId) {
        let msg = (data as any)?.error || error?.message || "Could not create the order";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") { try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep */ } }
        throw new Error(msg);
      }
      // proof-create stores source_visualization_id; ensure the renders are the active version too.
      try { await attachToOrder(newId); } catch { /* proof-create may already seed a version */ }
      setDoneCode(proofCode(newId));
      toast({ title: "Order created", description: `New ApprovePro order ${proofCode(newId)} — your design is loaded in.` });
    } catch (e: any) {
      toast({ title: "Couldn't create the order", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Send to ApprovePro</DialogTitle>
          <DialogDescription className="text-gray-600">
            Load this design into an ApprovePro order so you can proof + approve it.
          </DialogDescription>
        </DialogHeader>

        {doneCode ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm text-gray-800 font-semibold">Loaded into order {doneCode}</p>
            <a href="/approvepro" className="text-sm font-semibold text-blue-600 hover:underline">Open ApprovePro →</a>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "existing" | "new")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="existing" className="gap-1.5"><Link2 className="w-3.5 h-3.5" /> Existing order</TabsTrigger>
              <TabsTrigger value="new" className="gap-1.5"><FilePlus2 className="w-3.5 h-3.5" /> New order</TabsTrigger>
            </TabsList>

            <TabsContent value="existing" className="space-y-3 pt-3">
              <div>
                <Label className="text-xs text-gray-600">ApprovePro / WePrintWraps order number</Label>
                <Input
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value)}
                  placeholder="e.g. 10482  or  PROOF-1A2B3C4D"
                  className="mt-1 border-gray-200 bg-white text-gray-900"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Accepts the WePrintWraps order number, the PROOF-xxxx code, or the order id.
                </p>
              </div>
              <Button onClick={handleLoadIntoExisting} disabled={busy} className="w-full gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Load design into this order
              </Button>
            </TabsContent>

            <TabsContent value="new" className="space-y-3 pt-3">
              <div>
                <Label className="text-xs text-gray-600">Customer email</Label>
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@email.com"
                  className="mt-1 border-gray-200 bg-white text-gray-900"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Creates a new ApprovePro order (number {context.visualizationId ? proofCode(context.visualizationId) : "PROOF-xxxx"}) with this design loaded in.
                </p>
              </div>
              <Button onClick={handleCreateNew} disabled={busy} className="w-full gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
                Create order + load design
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
