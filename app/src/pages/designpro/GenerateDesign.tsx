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
  displayRenderRoles,
  dpApi,
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type FlatAtlasRevision,
  type GenieDimensionPreview,
  type GenerationPipelineMode,
  GenerationRequestState,
  GenerationVehicle,
  GenerationView,
  RenderRole,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  SURFACE_LABEL,
} from "@/lib/designpro-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { FlatAtlasPanelSchedule } from "@/components/designpro/FlatAtlasPanelSchedule";
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
  regenerationDisabledReason,
}: {
  role: string;
  view?: GenerationView;
  regenerating: boolean;
  failure?: { reason: string | null };
  busy: boolean;
  onRegenerate: (instruction: string) => void;
  regenerationDisabledReason?: string;
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

        {regenerationDisabledReason ? (
          <p className="mt-auto rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
            {regenerationDisabledReason}
          </p>
        ) : open ? (
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
  const [atlasRevisions, setAtlasRevisions] = useState<FlatAtlasRevision[]>([]);
  const [atlasLoadError, setAtlasLoadError] = useState("");
  const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE;
  const [vehicleType, setVehicleType] = useState<GenerationVehicle["type"]>("truck");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [designPrep, setDesignPrep] = useState<GenieDimensionPreview | null>(null);
  const [designPrepVehicle, setDesignPrepVehicle] = useState("");
  const [designPrepBusy, setDesignPrepBusy] = useState(false);
  const [designPrepGenerationId, setDesignPrepGenerationId] = useState<string | null>(null);
  const [requestPipelineMode, setRequestPipelineMode] = useState<GenerationPipelineMode>(FLAT_FIRST_ATLAS_PIPELINE_MODE);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  const requestId = request?.requestId;
  const state = request?.state;
  const isAtlasRequest = requestPipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE;
  const latestAtlas = atlasRevisions[atlasRevisions.length - 1];
  const currentVehicleIdentity = [vehicleYear, vehicleMake, vehicleModel, vehicleType]
    .map((value) => value.trim().toLowerCase())
    .join("|");
  const designPrepIsCurrent = Boolean(designPrep && designPrepVehicle === currentVehicleIdentity);

  function changeVehicle(setter: (value: string) => void, value: string) {
    setter(value);
    setDesignPrep(null);
    setDesignPrepVehicle("");
    setDesignPrepGenerationId(null);
  }

  async function beginDesignPrep() {
    const vehicle = {
      year: vehicleYear.trim(),
      make: vehicleMake.trim(),
      model: vehicleModel.trim(),
      type: vehicleType,
    };
    if (!vehicle.year || !vehicle.make || !vehicle.model) {
      setError("Enter the vehicle year, make, and model before beginning Design Prep.");
      return;
    }
    setError("");
    setDesignPrepBusy(true);
    setProgress("Beginning Design Prep — pulling vehicle dimensions…");
    try {
      const generationId = designPrepGenerationId || crypto.randomUUID().toLowerCase();
      setDesignPrepGenerationId(generationId);
      const prepared = await dpApi.previewGenieDimensions(vehicle);
      setDesignPrep(prepared);
      setDesignPrepVehicle(currentVehicleIdentity);
    } catch (cause) {
      setDesignPrep(null);
      setDesignPrepVehicle("");
      setError(cause instanceof ApiError
        ? `Design Prep could not pull vehicle dimensions (${cause.code}).`
        : "Design Prep could not pull vehicle dimensions.");
    } finally {
      setDesignPrepBusy(false);
      setProgress("");
    }
  }

  const loadViews = useCallback(() => {
    if (!requestId) return;
    dpApi
      .listGenerationViews(requestId)
      .then(setViews)
      .catch(() => undefined);
  }, [requestId]);

  const loadAtlas = useCallback(() => {
    if (!requestId || !isAtlasRequest) return;
    dpApi
      .listFlatAtlasRevisions(requestId)
      .then((items) => {
        setAtlasRevisions(items);
        setAtlasLoadError("");
      })
      .catch((cause) => {
        setAtlasLoadError(
          cause instanceof ApiError
            ? `The A.T.L.A.S. record could not be loaded (${cause.code}).`
            : "The A.T.L.A.S. record could not be loaded.",
        );
      });
  }, [requestId, isAtlasRequest]);

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

  useEffect(() => {
    if (!requestId || !isAtlasRequest) return;
    loadAtlas();
    const timer = window.setInterval(loadAtlas, atlasRevisions.length ? 240000 : 5000);
    return () => window.clearInterval(timer);
  }, [requestId, isAtlasRequest, atlasRevisions.length, loadAtlas]);

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
    if (isAtlasRequest) {
      setError("An A.T.L.A.S. proof cannot be regenerated independently. Start a new A.T.L.A.S. run.");
      return;
    }
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
    if (!designPrepIsCurrent) {
      setError("Press “Enter vehicle — begin Design Prep” before generating the design.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      setRequestPipelineMode(pipelineMode);
      const resolvedDesignName = String(form.get("designName") || "").trim();
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

      setProgress(
        pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
          ? "Queueing the canonical A.T.L.A.S. master and seven proof views…"
          : "Queueing the seven-view generation…",
      );
      setRequest(
        await dpApi.createGenerationRequest({
          generationId: designPrepGenerationId || undefined,
          // Calls 1-7 are fulfillment-unbound. WrapBox customer/order data is
          // collected only after a Production Pack entitlement exists.
          designName: resolvedDesignName,
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
          pipelineMode,
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

  const displayRoles = displayRenderRoles(
    [...(request?.views || []), ...views, ...(request?.failedShots || [])],
    request?.regeneratingShots || [],
  );
  const shotsTotal = request?.shotsTotal ?? displayRoles.length;
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
          <Panel
            className="order-1"
            eyebrow="DesignProAI operating system"
            title="One A.T.L.A.S. artifact graph"
            description="One prepared vehicle manifest drives one canonical master, six extracted panels, seven matched 3D proofs, and the production handoff."
          />

          <Panel className="order-3" eyebrow="The design">
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
          <Panel className="order-4" eyebrow="Commercial identity">
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

          <Panel
            className="order-2"
            eyebrow="Vehicle identity"
            title="Enter the vehicle, then begin Design Prep"
            description="After Year, Make, and Model are complete, press Enter vehicle. DesignProAI immediately pulls GENIE dimensions and prepares the labeled A.T.L.A.S. topology while you continue the creative brief."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Year" name="year" required value={vehicleYear} onChange={(event) => changeVehicle(setVehicleYear, event.target.value)} />
              <Field label="Make" name="make" required value={vehicleMake} onChange={(event) => changeVehicle(setVehicleMake, event.target.value)} />
              <Field label="Model" name="model" required value={vehicleModel} onChange={(event) => changeVehicle(setVehicleModel, event.target.value)} />
              <div>
                <Label htmlFor="type" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vehicle type
                </Label>
                <select
                  id="type"
                  name="type"
                  value={vehicleType}
                  onChange={(event) => {
                    const next = event.target.value as GenerationVehicle["type"];
                    setVehicleType(next);
                    setDesignPrep(null);
                    setDesignPrepVehicle("");
                    setDesignPrepGenerationId(null);
                  }}
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
              <div className="sm:col-span-2 flex flex-col gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-4">
                <div>
                  <p className="text-sm font-semibold text-cyan-100">Required: press Enter to begin Design Prep</p>
                  <p className="mt-1 text-xs leading-5 text-cyan-100/80">
                    This sends the vehicle identity immediately. The final design is not generated until the creative prompt is submitted.
                  </p>
                </div>
                <div>
                  <Button type="button" onClick={beginDesignPrep} disabled={designPrepBusy}>
                    {designPrepBusy ? "Beginning Design Prep…" : "Enter vehicle — begin Design Prep"}
                  </Button>
                </div>
                {designPrepBusy && <Loading label="Beginning Design Prep — pulling vehicle dimensions…" />}
                {designPrepIsCurrent && designPrep && (
                  designPrep.surfaces.length === 6 ? (
                    <Notice tone="success">
                      Design Prep ready — six labeled surfaces are bound to GENIE manifest {designPrep.resolution.genieManifestHash?.slice(0, 16)}… You may continue the creative prompt.
                    </Notice>
                  ) : (
                    <Notice tone="warning">
                      Vehicle received. GENIE needs an exact configuration match; A.T.L.A.S. will keep this geometry provisional and production-locked until it is validated.
                    </Notice>
                  )
                )}
              </div>
            </div>
          </Panel>

          <Panel
            className="order-5"
            eyebrow="Design identity"
            description="This name stays bound to the A.T.L.A.S. master, six panels, seven proofs, and production artifacts."
          >
            <Field label="Design name" name="designName" maxLength={240} required wide />
          </Panel>

          {error && <div className="order-6"><Notice tone="error">{error}</Notice></div>}
          {progress && <div className="order-7"><Notice>{progress}</Notice></div>}

          <div className="order-8">
            <Button type="submit" size="lg" disabled={busy}>
              {busy
                ? "Working…"
                : pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
                  ? "Generate A.T.L.A.S. + seven proofs"
                  : "Generate seven views"}
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
              {isAtlasRequest && (
                <p className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3 text-cyan-100">
                  A.T.L.A.S. graph active: one master releases six panel nodes and their matched proof nodes, then hands the same artifact lineage to production.
                </p>
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

          {isAtlasRequest && (
            <Panel
              eyebrow="A.T.L.A.S. · immutable lineage"
              title={latestAtlas ? `Revision ${latestAtlas.revisionSequence}` : "Building the canonical master"}
              description="The guide is the deterministic before state. The master is Gemini's single painted A.T.L.A.S. and the only visual source passed into the seven proof calls."
              aside={
                <StatePill state={latestAtlas ? "ready" : request.state === "failed" ? "failed" : "running"} />
              }
            >
              {atlasLoadError ? (
                <Notice tone="error">{atlasLoadError} Nothing was handed to production.</Notice>
              ) : latestAtlas ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: "Before · deterministic guide", asset: latestAtlas.guide, signedUrl: latestAtlas.guideUrl },
                    { label: "After · canonical master", asset: latestAtlas.master, signedUrl: latestAtlas.masterUrl },
                  ].map(({ label, asset, signedUrl }) => (
                    <article key={label} className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="border-b border-border px-4 py-3 text-sm font-semibold">{label}</div>
                      {signedUrl ? (
                        <a href={signedUrl} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-white">
                          <img src={signedUrl} alt={label} className="h-full w-full object-contain" />
                        </a>
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-xs text-muted-foreground">
                          Stored and hash-locked; preview is not signed yet.
                        </div>
                      )}
                      <div className="space-y-1 p-4 text-xs text-muted-foreground">
                        <p>{asset.widthPx} × {asset.heightPx}px · {(asset.byteSize / 1_048_576).toFixed(2)} MiB</p>
                        <ContentHash value={asset.contentHash} chars={20} />
                      </div>
                    </article>
                  ))}
                  <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Canonical graph lineage.</span>{" "}
                    {atlasRevisions.length} immutable version{atlasRevisions.length === 1 ? "" : "s"} saved. Model {latestAtlas.model}; prompt {latestAtlas.promptVersion}; structural example conditioning {latestAtlas.exampleUsed ? "locked" : "not used"}; manifest sha256 {latestAtlas.manifest.contentHash.slice(0, 16)}…. Production eligibility: {latestAtlas.productionEligible ? "passed" : "awaiting geometry validation"}.
                  </div>
                  <FlatAtlasPanelSchedule panels={latestAtlas.panelMap} className="sm:col-span-2" />
                </div>
              ) : request.state === "failed" ? (
                <Notice tone="error">No A.T.L.A.S. master was promoted. Nothing was handed to production.</Notice>
              ) : (
                <Loading label="Waiting for the runtime to store and sign the guide and canonical master…" />
              )}
            </Panel>
          )}

          {error && <Notice tone="error">{error}</Notice>}

          <Panel
            eyebrow="Seven distinct source views"
            title="Every angle is its own generation"
            description="The passenger side is generated, not mirrored — a flip reverses lettering, logos and URLs. Regenerating an angle supersedes the old view; it never rewrites bytes another call already hashed."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayRoles.map((role) => (
                <ViewCard
                  key={role}
                  role={role}
                  view={views.find((item) => item.consumerRole === role)}
                  regenerating={regeneratingRoles.has(role)}
                  failure={failedByRole.get(role)}
                  busy={busy}
                  onRegenerate={(instruction) => regenerate(role, instruction)}
                  regenerationDisabledReason={
                    isAtlasRequest
                      ? "A.T.L.A.S. authority is locked. Start a new A.T.L.A.S. run to regenerate its master and seven-view proof set."
                      : role === "hero3d"
                        ? "This immutable historical Hero proof is read-only and cannot be regenerated."
                        : undefined
                  }
                />
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
