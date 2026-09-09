import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { panelOutputApi, PanelOutputApiError } from "@/lib/panelpro-file-output-api";
import { Button } from "@/components/ui/button";

type AccessState = "loading" | "allowed" | "denied" | "unavailable";
export function PanelOutputAccessView({ state, children, onRetry }: { state: AccessState; children: ReactNode; onRetry?: () => void }) {
  if (state === "allowed") return <>{children}</>;
  return <main className="mx-auto max-w-xl space-y-4 px-5 py-16">
    <h1 className="text-xl font-semibold">Internal production review</h1>
    <p role={state === "denied" ? "alert" : "status"} className="text-sm text-muted-foreground">
      {state === "loading" ? "Checking your production review access…"
        : state === "denied" ? "This account does not have the production preflight permission required to prepare or approve templates and output sources."
          : "Your production review access could not be verified. Retry after reconnecting."}
    </p>
    {state === "unavailable" && <Button onClick={onRetry}>Check access again</Button>}
    {state !== "loading" && <Button variant="outline" asChild><Link to="/panelpro-file-output">Return to saved output work</Link></Button>}
  </main>;
}

/** Existing can_preflight permission is authoritative for these two new pages. */
export function RequirePanelOutputReviewer({ capability, children }: { capability: "canPrepare" | "canReview"; children: ReactNode }) {
  const [state, setState] = useState<AccessState>("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setState("loading");
      setRevision((value) => value + 1);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setState("loading");
    panelOutputApi.capabilities(controller.signal).then((result) => {
      if (live) setState(result[capability] === true ? "allowed" : "denied");
    }).catch((error) => {
      if (live) setState(error instanceof PanelOutputApiError && error.status === 403 ? "denied" : "unavailable");
    }).finally(() => window.clearTimeout(timeout));
    return () => { live = false; controller.abort(); window.clearTimeout(timeout); };
  }, [capability, revision]);
  return <PanelOutputAccessView state={state} onRetry={() => setRevision((value) => value + 1)}>{children}</PanelOutputAccessView>;
}
