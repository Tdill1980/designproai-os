/**
 * Calls 1–7 — the surface that makes the seven immutable source views.
 *
 * The other entry point (New revision source) requires the operator to already
 * own seven renders. This one produces them: a brief and a vehicle go in, the
 * runtime generation worker produces seven distinct photoreal views, and the
 * production handoff into Calls 8–12 fires automatically once the database
 * confirms the handoff is valid.
 *
 * Two behaviours are preserved from the proven DesignPro UI and are the reason
 * this page polls rather than orchestrates:
 *
 *  - Per-view regeneration ("generate this angle again") and failed-shot retry.
 *    Both are executed by the fenced worker; the browser only asks. The old
 *    view is superseded, never mutated, so anything Calls 8+ already hashed
 *    stays trustworthy.
 *  - Seven views means seven generations. The passenger side is never a mirror
 *    of the driver side — mirroring reverses lettering, logos and URLs.
 *
 * prompt, model, seed and camera angle are server-owned. This page does not
 * send them and the gateway rejects them if it did.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import {
  ApiError,
  AssetIdentity,
  dpApi,
  GenerationRequestState,
  GenerationVehicle,
  GenerationView,
  RenderRole,
  RENDER_ROLES,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  SURFACE_LABEL,
} from "@/lib/designpro-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  ContentHash,
  Loading,
  Notice,
  PageHead,
  Panel,
  StatePill,
} from "@/components/designpro/surface";

const VEHICLE_TYPES: Array<{ value: GenerationVehicle["type"]; label: string }> = [
  { value: "car", label: "Car" },
  { value: "truck", label: "Truck / box truck" },
  { value: "suv", label: "SUV" },
  { value: "van", label: "Van" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "boat", label: "Boat" },
  { value: "bus", label: "Bus" },
  { value: "rv", label: "RV" },
  { value: "trailer", label: "Trailer" },
  { value: "aircraft", label: "Aircraft" },
  { value: "heavy_equipment", label: "Heavy equipment" },
];

const TERMINAL_STATES = ["outputs_ready", "failed", "cancelled"];

function Field({
  label,
  name,
  hint,
  wide,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={name} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input id={name} name={name} className="mt-1.5" {...rest} />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * One of the seven views. Renders whatever the server currently owns for this
 * role: the generated image, an in-flight regeneration, a failed shot with the
 * reason, or nothing yet.
 */
function ViewCard({
  role,
  view,
  regenerating,
  failure,
  busy,
  onRegenerate,
}: {
  role: string;
  view?: GenerationView;
  regenerating: boolean;
  failure?: { reason: string | null };
  busy: boolean;
  onRegenerate: (instruction: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const state = failure ? "failed" : regenerating ? "running" : view ? "ready" : "queued";

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <strong className="truncate text-sm">{SURFACE_LABEL[role] || role}</strong>
        <StatePill state={state} />
      </div>

      <div className="relative flex aspect-[4/3] items-center justify-center bg-muted/30">
        {view?.signedUrl ? (
          <a href={view.signedUrl} target="_blank" rel="noreferrer" className="block h-full w-full">
            <img
              src={view.signedUrl}
              alt={`${SURFACE_LABEL[role] || role} generated view`}
              className="h-full w-full object-cover"
            />
          </a>
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            {regenerating
              ? "Regenerating this angle…"
              : failure
                ? "This shot failed and can be retried."
                : "Waiting for the runtime to generate this angle."}
          </span>
        )}
        {regenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {view && <ContentHash value={view.contentHash} chars={20} />}
        {failure?.reason && <p className="text-xs text-destructive">{failure.reason}</p>}

        {open ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={2}
              maxLength={2000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Optional: what should change on this angle?"
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || regenerating}
                onClick={() => {
                  onRegenerate(instruction.trim());
                  setOpen(false);
                  setInstruction("");
                }}
              >
                {failure ? "Retry this shot" : "Generate again"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant={failure ? "default" : "outline"}
            className="mt-auto"
            disabled={busy || regenerating}
            onClick={() => setOpen(true)}
          >
            {failure ? (
              <>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Retry this shot
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Generate this angle again
              </>
            )}
          </Button>
        )}
      </div>
    </article>
  );
}

export default function GenerateDesign() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<GenerationRequestState>();
  const [views, setViews] = useState<GenerationView[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  const requestId = request?.requestId;
  const state = request?.state;

  const loadViews = useCallback(() => {
    if (!requestId) return;
    dpApi
      .listGenerationViews(requestId)
      .then(setViews)
      .catch(() => undefined);
  }, [requestId]);

  // Poll while the worker runs. The request is durable, so a browser refresh
  // resumes reporting rather than losing the job.
  useEffect(() => {
    if (!requestId || (state && TERMINAL_STATES.includes(state))) return;
    const timer = window.setInterval(() => {
      dpApi.getGenerationRequest(requestId).then(setRequest).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [requestId, state]);

  // Signed URLs expire in five minutes, and a regeneration supersedes a view
  // rather than replacing its bytes, so re-read the signing route on every
  // status change and on a slow timer while the job is live.
  useEffect(() => {
    if (!requestId) return;
    loadViews();
    if (state && TERMINAL_STATES.includes(state) && state !== "outputs_ready") return;
    const timer = window.setInterval(loadViews, 60000);
    return () => window.clearInterval(timer);
  }, [requestId, state, request?.views?.length, loadViews]);

  // The seven views are only half the job. As soon as the database confirms the
  // handoff is valid, advance into the existing Calls 8–12 workflow — the
  // operator should not have to re-enter anything to get a production pack.
  useEffect(() => {
    if (!request || request.state !== "outputs_ready" || request.handoffReady !== true) return;
    if (handingOff) return;
    setHandingOff(true);
    dpApi
      .handoffGeneration(request.requestId)
      .then((result) => navigate(`/designpro/jobs/${result.generationId || request.generationId}`))
      .catch((cause) => {
        setHandingOff(false);
        setError(
          cause instanceof ApiError
            ? `The production handoff was refused (${cause.code}).`
            : "The production handoff failed.",
        );
      });
  }, [request, handingOff, navigate]);

  // The regenerate route is keyed by the camera the frozen view contract names,
  // not by the role that consumes it.
  async function regenerate(role: RenderRole, instruction: string) {
    if (!requestId) return;
    setBusy(true);
    setError("");
    try {
      await dpApi.regenerateView(requestId, SOURCE_VIEW_TYPE_FOR_ROLE[role], instruction || null);
      setRequest(await dpApi.getGenerationRequest(requestId));
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `That angle could not be regenerated (${cause.code}).`
          : "That angle could not be regenerated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      setProgress("Registering the confirmed WrapBox recipient…");
      const { delivery } = await dpApi.registerDeliveryRecipient({
        customerEmail: String(form.get("customerEmail") || "").trim().toLowerCase(),
        customerReference: String(form.get("customerReference") || "").trim(),
        verificationReference: String(form.get("verificationReference") || "").trim(),
        orderNumber: String(form.get("orderNumber") || "").trim(),
        designName: String(form.get("designName") || "").trim(),
      });
      const companyName = String(form.get("companyName") || "").trim();
      const phone = String(form.get("phone") || "").trim();
      const website = String(form.get("website") || "").trim();

      // The logo is uploaded and VERIFIED before the request is queued, so the
      // generation request carries a real storage path and content hash rather
      // than a promise of a file. The upload namespace is keyed by a revision id
      // and the production revision does not exist yet -- Calls 1-7 mint it --
      // so an intake id is minted here. Provenance is the content hash, which is
      // what the runtime re-checks before compositing, so the folder the bytes
      // were staged under does not confer authority.
      const logoFile = form.get("logo");
      let logoAsset: AssetIdentity | undefined;
      if (logoFile instanceof File && logoFile.size > 0) {
        setProgress("Uploading and verifying the logo…");
        logoAsset = await dpApi.uploadRevisionAsset(crypto.randomUUID().toLowerCase(), "logo", logoFile);
      }

      setProgress("Queueing the seven-view generation…");
      setRequest(
        await dpApi.createGenerationRequest({
          delivery,
          vehicle: {
            year: String(form.get("year") || "").trim(),
            make: String(form.get("make") || "").trim(),
            model: String(form.get("model") || "").trim(),
            type: String(form.get("type") || "van") as GenerationVehicle["type"],
          },
          brief: {
            brief: String(form.get("brief") || "").trim(),
            businessName: String(form.get("businessName") || "").trim() || undefined,
            industry: String(form.get("industry") || "").trim() || undefined,
            style: String(form.get("style") || "").trim() || undefined,
            colors: String(form.get("colors") || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            // A company name means commercial, whatever else was selected --
            // the same rule the proven intake applies.
            mode: companyName ? "commercial" : "restyle",
            companyName: companyName || undefined,
            phone: phone || undefined,
            website: website || undefined,
            logoAsset,
          },
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `The generation request was refused (${cause.code}).`
          : cause instanceof Error
            ? cause.message
            : "The design could not be generated.",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const shotsTotal = request?.shotsTotal ?? RENDER_ROLES.length;
  const shotsComplete = request?.shotsComplete ?? 0;
  // Both arrive keyed by camera; every surface below is keyed by role.
  const regeneratingRoles = new Set(
    (request?.regeneratingShots || []).map((type) => ROLE_FOR_SOURCE_VIEW_TYPE[type]).filter(Boolean),
  );
  const failedByRole = new Map((request?.failedShots || []).map((shot) => [shot.consumerRole, shot]));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="Calls 1–7 · DesignProAI"
        title="Generate a design"
        description="Describe the wrap and the vehicle. The server generates seven distinct photoreal views — it never mirrors one side to make another."
        backTo="/designpro/jobs"
        backLabel="Production jobs"
        aside={request ? <StatePill state={request.state} /> : undefined}
      />

      {!request && (
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Panel eyebrow="The design">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="brief" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Design brief
                </Label>
                <Textarea
                  id="brief"
                  name="brief"
                  rows={3}
                  required
                  maxLength={2000}
                  className="mt-1.5"
                  placeholder="Bold commercial wrap, clean geometric shapes, large legible phone number"
                />
              </div>
              <Field label="Business name" name="businessName" maxLength={160} />
              <Field label="Industry" name="industry" maxLength={160} placeholder="HVAC services" />
              <Field label="Colors" name="colors" maxLength={240} placeholder="dark blue, ice blue, white" />
              <Field label="Style" name="style" maxLength={160} placeholder="bold modern commercial" />
            </div>
          </Panel>

          {/*
            THE COMMERCIAL IDENTITY. Separate from the brief on purpose: the
            brief is creative direction A.C.E. interprets, while these are the
            customer's own strings and the customer's own file. They are frozen
            into the revision snapshot verbatim and rendered deterministically --
            vector type for the strings, the uploaded bytes for the logo -- so no
            image model ever spells the company name or redraws the mark.
          */}
          <Panel eyebrow="Commercial identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Company name"
                name="companyName"
                maxLength={160}
                placeholder="Precision Climate Solutions"
                hint="Typed exactly as it should print. Never re-spelled by the design model."
              />
              <Field label="Phone" name="phone" maxLength={40} placeholder="(520) 555-0192" />
              <Field label="Website" name="website" maxLength={200} placeholder="precisionclimate.com" />
              <div>
                <Label htmlFor="logo" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Logo file
                </Label>
                <Input
                  id="logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional. Uploaded as-is and placed as its own layer — never generated or traced.
                </p>
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Vehicle identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Year" name="year" required />
              <Field label="Make" name="make" required />
              <Field label="Model" name="model" required />
              <div>
                <Label htmlFor="type" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vehicle type
                </Label>
                <select
                  id="type"
                  name="type"
                  defaultValue="van"
                  required
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {VEHICLE_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Panel>

          <Panel
            eyebrow="Immutable order + WrapBox recipient"
            description="Enter normal business information — never database IDs or hashes. The order or payment reference is hashed at the gateway and never stored in its original form."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Order #"
                name="orderNumber"
                pattern="[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}"
                maxLength={120}
                required
              />
              <Field
                label="Confirmed customer email"
                name="customerEmail"
                type="email"
                autoComplete="email"
                maxLength={320}
                required
              />
              <Field label="Customer reference / name" name="customerReference" minLength={1} maxLength={160} required />
              <Field
                label="Order or payment verification reference"
                name="verificationReference"
                minLength={3}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                required
                wide
              />
              <Field label="Design name" name="designName" maxLength={240} required wide />
            </div>
          </Panel>

          {error && <Notice tone="error">{error}</Notice>}
          {progress && <Notice>{progress}</Notice>}

          <div>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Working…" : "Generate seven views"}
            </Button>
          </div>
        </form>
      )}

      {request && (
        <>
          <Panel
            eyebrow="Generation state"
            title={request.state.split("_").join(" ")}
            description={
              request.designName ? `${request.designName} · request ${request.requestId}` : `Request ${request.requestId}`
            }
            aside={
              <div className="text-right text-sm text-muted-foreground">
                {shotsComplete} of {shotsTotal} shots
              </div>
            }
          >
            <Progress value={(shotsComplete / Math.max(shotsTotal, 1)) * 100} className="h-2" />
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              {request.phase === "designer" && <p>The designer stage is composing the wrap before any camera is set.</p>}
              {request.phase === "photographer" && <p>The photographer stage is shooting each frozen camera angle.</p>}
              {request.state === "queued" && <p>Waiting for a production runtime to claim this request.</p>}
              {request.state === "leased" && (
                <p>A runtime is generating the seven views now. This page keeps reporting if you refresh or close it.</p>
              )}
              {request.state === "retryable" && <p>A view failed and will be retried.</p>}
              {request.state === "outputs_ready" && !handingOff && (
                <p className="text-emerald-300">All seven views are generated and byte-verified.</p>
              )}
              {handingOff && <Loading label="Freezing the revision and starting the production workflow…" />}
            </div>
            {request.designAnchor && (
              <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide">Design anchor</span>
                <br />
                {request.designAnchor}
              </p>
            )}
            {request.state === "failed" && <div className="mt-4"><Notice tone="error">{request.failureCode || "Generation failed."}</Notice></div>}
            {request.state === "outputs_ready" && request.handoffReady === false && (
              <div className="mt-4">
                <Notice tone="error">
                  Production handoff blocked: {request.handoffBlocker || "unknown"}
                </Notice>
              </div>
            )}
          </Panel>

          {error && <Notice tone="error">{error}</Notice>}

          <Panel
            eyebrow="Seven distinct source views"
            title="Every angle is its own generation"
            description="The passenger side is generated, not mirrored — a flip reverses lettering, logos and URLs. Regenerating an angle supersedes the old view; it never rewrites bytes another call already hashed."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RENDER_ROLES.map((role) => (
                <ViewCard
                  key={role}
                  role={role}
                  view={views.find((item) => item.consumerRole === role)}
                  regenerating={regeneratingRoles.has(role)}
                  failure={failedByRole.get(role)}
                  busy={busy}
                  onRegenerate={(instruction) => regenerate(role, instruction)}
                />
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
