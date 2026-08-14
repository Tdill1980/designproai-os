/**
 * ProofManage — /approve/manage/:token
 *
 * Folded into ApprovePro. This page used to host a separate (and weaker)
 * "paste a hero render URL" revision form — a second place a designer could
 * push a revision. The full revision toolkit (Pull from QC Artboard, Attach a
 * DesignPro design, upload files, then Send) now lives in the ApprovePro
 * workbench's "Send & Replies" tab, which is the single place a designer ever
 * uploads a revision.
 *
 * The shop still receives /approve/manage/:token links in revision emails, so
 * this page keeps working — it just resolves the manage_token to the proof and
 * redirects into the workbench scoped to that job. Auth is still required
 * (RLS: shop_id = auth.uid()), so the login bounce for email-link clicks is
 * preserved.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";

type State =
  | { kind: "loading" }
  | { kind: "unauthed" }
  | { kind: "error"; message: string }
  | { kind: "redirect"; proofId: string };

export default function ProofManage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setState({ kind: "error", message: "Missing manage token." });
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setState({ kind: "unauthed" });
        return;
      }
      // Shop can read their own proof by manage_token (RLS: shop_id = auth.uid()).
      const { data: proof, error } = await supabase
        .from("proof_approvals" as any)
        .select("id")
        .eq("manage_token", token)
        .eq("shop_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState({ kind: "error", message: error.message || "Failed to load proof" });
        return;
      }
      if (!proof) {
        setState({ kind: "error", message: "Proof not found or you don't have access." });
        return;
      }
      setState({ kind: "redirect", proofId: (proof as any).id });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Resolved — drop the designer into the unified workbench, scoped to this
  // proof. The Send & Replies tab is where revisions are uploaded + sent.
  if (state.kind === "redirect") {
    return <Navigate to={`/approvepro?id=${state.proofId}`} replace />;
  }

  if (state.kind === "unauthed") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold">Log in to open this proof</h1>
          <p className="text-sm text-zinc-600">
            Only the shop that created this proof can manage it.
          </p>
          <Button
            onClick={() => navigate(`/login?redirect=/approve/manage/${token}`)}
            className="w-full"
          >
            Log in
          </Button>
        </Card>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold">Can't open this proof</h1>
          <p className="text-sm text-zinc-600">{state.message}</p>
          <Button variant="outline" onClick={() => navigate("/approvepro")}>
            Go to ApprovePro
          </Button>
        </Card>
      </div>
    );
  }

  // loading
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
    </div>
  );
}
