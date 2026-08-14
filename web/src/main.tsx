import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  AssetIdentity,
  dpApi,
  FinalQc,
  GenerationRequestState,
  GenerationVehicle,
  GenieCandidate,
  GenieSurfaceKey,
  GenieValidatedSurfaces,
  PreflightQc,
  RenderRole,
  uploadRevisionAsset,
  WorkflowArtifact,
  WorkflowStatus,
  WrapboxPack,
} from "./api";
import "./styles.css";
import "./production.css";

const viewDefinitions: Array<{ key: RenderRole; label: string }> = [
  { key: "driver", label: "Driver side" },
  { key: "passenger", label: "Passenger side" },
  { key: "hood", label: "Hood" },
  { key: "roof", label: "Roof" },
  { key: "front", label: "Front" },
  { key: "rear", label: "Rear" },
  { key: "hero3d", label: "3D hero view" },
];

const stageLabel: Record<string, string> = {
  "revision.freeze": "Seven source views locked",
  "manifest.resolve": "GENIE dimensions and square footage",
  "proof.build": "Call 8 · Flat 2D proof",
  "panels.build": "Call 9 · Exact per-surface panels",
  "logos.extract": "Call 10 · Exact logo inventory",
  "pack.verify": "Production preview verification",
  "pack.activate": "Production preview active",
  "source.verify": "Production source verification",
  "await_panelpro_preflight_qc": "PanelPro preflight",
  "output.build": "Production output",
  "output.verify": "Output file verification",
  "await_final_human_qc": "Final production QC",
  "stamp.build": "Approval stamp",
  "zip.build": "Production ZIP",
  "wrapbox.deliver": "WrapBox delivery",
};

function redirectIfUnauthenticated(error: unknown) {
  if (error instanceof ApiError && error.status === 401) window.location.assign("/login");
}

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    dpApi.session().then(({ user }) => setEmail(user.email)).catch(redirectIfUnauthenticated);
  }, []);
  async function logout() {
    await dpApi.logout().catch(() => undefined);
    navigate("/login");
  }
  return <div className="shell">
    <header>
      <Link className="brand" to="/app">DesignPro<span>AI</span></Link>
      <nav><Link to="/app">Jobs</Link><Link to="/app/generate">Generate</Link><Link to="/app/revisions/new">New revision</Link><Link to="/app/genie-qc">GENIE QC</Link><Link to="/app/wrapbox">WrapBox</Link><span>{email}</span><button className="nav-button" onClick={logout}>Sign out</button></nav>
    </header>
    <main>{children}</main>
  </div>;
}

function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      if (signup) {
        const created = await dpApi.signup(email, password);
        if (created.confirmationRequired) {
          setNotice("Account created. Open the confirmation email, then return here to sign in.");
          setSignup(false);
          return;
        }
      } else {
        await dpApi.login(email, password);
      }
      navigate("/app");
    } catch {
      setError(signup ? "Account creation failed." : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="login"><section><div className="eyebrow">DESIGN TO PRODUCTION</div><h1>DesignPro<span>AI</span></h1><p>Your server-owned wide-format production operating system.</p><form onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" minLength={signup ? 12 : undefined} autoComplete={signup ? "new-password" : "current-password"} required /></label>{signup && <small>Use at least 12 characters with uppercase, lowercase, a number and a symbol.</small>}{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<button disabled={busy}>{busy ? "Working…" : signup ? "Create account" : "Sign in"}</button><button className="text-button" type="button" onClick={() => { setSignup((value) => !value); setError(""); setNotice(""); }}>{signup ? "Already have an account? Sign in" : "Need an account? Create one"}</button></form></section></div>;
}

function Dashboard() {
  const [jobs, setJobs] = useState<WorkflowStatus[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    dpApi.listJobs().then(setJobs).catch((cause) => { redirectIfUnauthenticated(cause); setError("Jobs could not be loaded."); });
  }, []);
  return <Shell>
    <div className="page-head"><div><div className="eyebrow">OPERATIONS</div><h1>Production jobs</h1></div><span className="status-chip">Server owned</span></div>
    {error && <div className="notice error">{error}</div>}
    {!error && jobs.length === 0 && <div className="empty"><h2>No DesignPro jobs yet</h2><p>Describe a wrap and let the server generate the seven views, or upload seven you already have.</p><Link className="button-link" to="/app/generate">Generate a design</Link><Link className="button-link secondary" to="/app/revisions/new">Upload seven views</Link></div>}
    <div className="grid">{jobs.map((job) => <Link className="card" key={job.generationId} to={`/app/revisions/${job.generationId}`}><div className="card-top"><strong>{job.designId}</strong><span className={`state ${job.state}`}>{job.state.replaceAll("_", " ")}</span></div><h2>{stageLabel[job.currentStage] || job.currentStage}</h2><p>Order # {job.orderNumber} · Revision {job.revision}</p></Link>)}</div>
  </Shell>;
}

function NewRevision() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Partial<Record<RenderRole, File>>>({});
  const [logoMode, setLogoMode] = useState<"" | "none" | "listed">("");
  const [logos, setLogos] = useState<Array<{ id: string; displayName: string; surfaceKey: GenieSurfaceKey; file?: File }>>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const allFiles = viewDefinitions.every(({ key }) => files[key]);
  const logoInventoryComplete = logoMode === "none" || logoMode === "listed" && logos.length > 0 && logos.every((logo) => logo.displayName.trim() && logo.file);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allFiles) return setError("All seven distinct source views are required.");
    if (!logoInventoryComplete) return setError("Explicitly confirm no logos or list and upload every expected logo.");
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const revisionId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const visualizationId = crypto.randomUUID();
    const renderAssets = {} as Record<RenderRole, AssetIdentity>;
    try {
      setProgress("Registering the confirmed WrapBox recipient…");
      const { delivery } = await dpApi.registerDeliveryRecipient({
        customerEmail: String(form.get("customerEmail") || "").trim().toLowerCase(),
        customerReference: String(form.get("customerReference") || "").trim(),
        verificationReference: String(form.get("verificationReference") || "").trim(),
        orderNumber: String(form.get("orderNumber") || "").trim(),
        designName: String(form.get("designName") || "").trim(),
      });
      for (const [index, definition] of viewDefinitions.entries()) {
        setProgress(`Hashing and storing ${definition.label} (${index + 1} of 7)…`);
        renderAssets[definition.key] = await uploadRevisionAsset(revisionId, definition.key, files[definition.key]!);
      }
      if (new Set(Object.values(renderAssets).map((asset) => asset.contentHash)).size !== 7) throw new Error("Every source view must be a different file.");
      const expectedLogoInventory = [] as Array<{ placementKey: string; identityKey: string; displayName: string; surfaceKey: GenieSurfaceKey; storagePath: string; contentHash: string; byteSize: number; contentType: string }>;
      if (logoMode === "listed") {
        for (const [index, logo] of logos.entries()) {
          setProgress(`Hashing and storing logo ${index + 1} of ${logos.length}…`);
          const asset = await uploadRevisionAsset(revisionId, "logo", logo.file!);
          const identityKey = `logo-${asset.contentHash.slice(0, 32)}`;
          expectedLogoInventory.push({ placementKey: `${identityKey}@${logo.surfaceKey}`, identityKey, displayName: logo.displayName.trim(), surfaceKey: logo.surfaceKey, ...asset });
        }
        if (new Set(expectedLogoInventory.map((logo) => logo.placementKey)).size !== expectedLogoInventory.length) throw new Error("The same logo can appear on several surfaces, but each logo/surface placement must be unique.");
      }
      setProgress("Freezing the revision and starting the automatic build…");
      await dpApi.submitRevision({
        revisionId,
        generationId,
        visualizationId,
        expectedUpdatedAt: new Date().toISOString(),
        renderAssets,
        view: "all",
        instruction: String(form.get("instruction") || ""),
        idempotencyKey: `revision:${revisionId}`,
        revisionSnapshot: {
          contractVersion: "designpro.revision-snapshot.v1",
          vehicle: {
            year: String(form.get("year") || ""),
            make: String(form.get("make") || ""),
            model: String(form.get("model") || ""),
            type: String(form.get("type") || "car"),
          },
          surfaceOptions: { required: ["driver", "passenger", "hood", "roof", "front", "rear"] },
          finish: String(form.get("finish") || "standard"),
          bodyText: String(form.get("bodyText") || ""),
          orderNumber: delivery.orderNumber,
          logoInventoryAttestation: { mode: logoMode, attested: true },
          expectedLogoInventory,
          delivery,
        },
      });
      navigate(`/app/revisions/${generationId}`);
    } catch (cause) {
      redirectIfUnauthenticated(cause);
      setError(cause instanceof Error ? cause.message : "The revision could not be submitted.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return <Shell>
    <div className="page-head"><div><Link className="back" to="/app">← Jobs</Link><h1>New revision source</h1><p>These seven files become immutable inputs. The server builds the 2D proof and panels automatically.</p></div></div>
    <form className="revision-form" onSubmit={submit}>
      <section className="panel"><div className="eyebrow">VEHICLE IDENTITY</div><div className="form-grid"><label>Year<input name="year" required /></label><label>Make<input name="make" required /></label><label>Model<input name="model" required /></label><label>Vehicle type<select name="type" defaultValue="car" required><option value="car">Car</option><option value="truck">Truck / box truck</option><option value="suv">SUV</option><option value="van">Van</option><option value="motorcycle">Motorcycle</option><option value="boat">Boat</option><option value="bus">Bus</option><option value="rv">RV</option><option value="trailer">Trailer</option><option value="aircraft">Aircraft</option><option value="heavy_equipment">Heavy equipment</option></select></label><label>Finish<input name="finish" defaultValue="standard" required /></label><label className="wide">Required body text<textarea name="bodyText" rows={3} /></label><label className="wide">Revision instruction<textarea name="instruction" rows={3} /></label></div></section>
      <section className="panel"><div className="eyebrow">IMMUTABLE ORDER + WRAPBOX RECIPIENT</div><h2>Freeze the business order and confirmed customer account</h2><p className="muted">Enter normal business information—never database IDs or hashes. The server normalizes the email, requires its confirmed DesignPro account, creates or reuses the private customer identity, and hashes the order/payment reference without storing or returning the original. Order # is never derived from a workflow UUID.</p><div className="form-grid"><label>Order #<input name="orderNumber" pattern="[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}" maxLength={120} required /></label><label>Confirmed customer email<input name="customerEmail" type="email" autoComplete="email" maxLength={320} required /></label><label>Customer reference / name<input name="customerReference" minLength={1} maxLength={160} required /></label><label className="wide">Order or payment verification reference<input name="verificationReference" minLength={3} maxLength={256} autoComplete="off" spellCheck={false} required /></label><label className="wide">Design name<input name="designName" maxLength={240} required /></label></div></section>
      <section className="panel"><div className="eyebrow">SEVEN DISTINCT SOURCE VIEWS</div><h2>Upload each actual view</h2><p className="muted">PNG, JPEG or WebP. Maximum 25 MiB per file. The server verifies every byte hash before the job is created.</p><div className="upload-grid">{viewDefinitions.map(({ key, label }) => <label className={`upload ${files[key] ? "ready" : ""}`} key={key}><span>{label}</span><input type="file" accept="image/png,image/jpeg,image/webp" required onChange={(event) => setFiles((current) => ({ ...current, [key]: event.target.files?.[0] }))} /><small>{files[key]?.name || "Choose file"}</small></label>)}</div></section>
      <section className="panel logo-inventory"><div className="eyebrow">EXPECTED LOGO INVENTORY · CALL 10</div><h2>Freeze the exact logo set</h2><p className="muted">A zero-logo inventory is valid only when you explicitly attest that this design contains no logos.</p><div className="logo-mode"><label className="qc-check"><input type="radio" name="logoMode" checked={logoMode === "none"} onChange={() => { setLogoMode("none"); setLogos([]); }} /><span>This design has no logos.</span></label><label className="qc-check"><input type="radio" name="logoMode" checked={logoMode === "listed"} onChange={() => { setLogoMode("listed"); if (!logos.length) setLogos([{ id: crypto.randomUUID(), displayName: "", surfaceKey: "driver" }]); }} /><span>This design contains logos; I will list every required logo and surface.</span></label></div>{logoMode === "listed" && <div className="logo-list">{logos.map((logo, index) => <div className="logo-row" key={logo.id}><label>Logo identity / name<input value={logo.displayName} required onChange={(event) => setLogos((current) => current.map((item) => item.id === logo.id ? { ...item, displayName: event.target.value } : item))} placeholder="Example: Porsche wordmark" /></label><label>Required surface<select value={logo.surfaceKey} onChange={(event) => setLogos((current) => current.map((item) => item.id === logo.id ? { ...item, surfaceKey: event.target.value as GenieSurfaceKey } : item))}>{viewDefinitions.filter(({ key }) => key !== "hero3d").map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label><label>Exact stored logo file<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf" required onChange={(event) => setLogos((current) => current.map((item) => item.id === logo.id ? { ...item, file: event.target.files?.[0] } : item))} /><small>{logo.file?.name || "Choose file"}</small></label><button className="remove-button" type="button" onClick={() => setLogos((current) => current.filter((item) => item.id !== logo.id))}>Remove logo {index + 1}</button></div>)}<button className="secondary add-logo" type="button" onClick={() => setLogos((current) => [...current, { id: crypto.randomUUID(), displayName: "", surfaceKey: "driver" }])}>Add another logo placement</button></div>}</section>
      {error && <div className="notice error">{error}</div>}
      {progress && <div className="notice">{progress}</div>}
      <button className="submit-button" disabled={busy || !allFiles || !logoInventoryComplete}>{busy ? "Starting automatic build…" : "Freeze sources and start automatic build"}</button>
    </form>
  </Shell>;
}

const genieSurfaces: Array<{ key: GenieSurfaceKey; label: string }> = [
  { key: "driver", label: "Driver side" },
  { key: "passenger", label: "Passenger side" },
  { key: "hood", label: "Hood" },
  { key: "roof", label: "Roof" },
  { key: "front", label: "Front" },
  { key: "rear", label: "Rear" },
];

function GenieCandidateForm({ candidate, onValidated }: { candidate: GenieCandidate; onValidated: (id: string) => void }) {
  const [evidence, setEvidence] = useState({ sourceReviewed: false, sourceUrlsReviewed: false, operatorAttestation: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const surfaces = {} as GenieValidatedSurfaces;
    for (const { key } of genieSurfaces) surfaces[key] = { widthInches: Number(form.get(`${key}.widthInches`)), heightInches: Number(form.get(`${key}.heightInches`)) };
    const notes = String(form.get("notes") || "").trim();
    try {
      await dpApi.validateGenieCandidate(candidate.id, surfaces, {
        sourceReviewed: true,
        sourceUrlsReviewed: true,
        operatorAttestation: true,
      }, notes);
      onValidated(candidate.id);
    } catch (cause) {
      redirectIfUnauthenticated(cause);
      setError(cause instanceof Error ? cause.message : "GENIE validation failed.");
    } finally {
      setBusy(false);
    }
  }
  const evidenceComplete = evidence.sourceReviewed && evidence.sourceUrlsReviewed && evidence.operatorAttestation;
  return <form className="panel genie-candidate" onSubmit={validate}>
    <div className="candidate-head"><div><div className="eyebrow">PENDING EXACT GEOMETRY</div><h2>{candidate.year || "Year pending"} {candidate.make} {candidate.model}</h2><p>{candidate.subType || candidate.vehicleClass || "Vehicle"}</p></div>{candidate.confidence != null && <span className="status-chip">Candidate {Math.round(candidate.confidence * 100)}%</span>}</div>
    <div className="provenance"><strong>Candidate source: {candidate.source}</strong>{candidate.sourceUrls.length ? candidate.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Open source {index + 1}</a>) : <span>No source URL supplied; verify against an independent authoritative source.</span>}</div>
    {candidate.requestedRuns.length > 0 && <p className="muted">Waiting jobs: {candidate.requestedRuns.map((run) => run.generationId || run.runId).join(", ")}</p>}
    <div className="dimension-grid"><div className="dimension-head">Surface</div><div className="dimension-head">Exact width (in)</div><div className="dimension-head">Exact height (in)</div>{genieSurfaces.map(({ key, label }) => <React.Fragment key={key}><strong>{label}</strong><input name={`${key}.widthInches`} type="number" min="1" max="1000" step="0.01" required /><input name={`${key}.heightInches`} type="number" min="1" max="1000" step="0.01" required /></React.Fragment>)}</div>
    <label>Validation notes and measurement provenance<textarea name="notes" minLength={10} maxLength={2000} rows={3} required placeholder="Record the template, OEM reference, measurement sheet or other evidence used." /></label>
    <fieldset className="evidence-list"><label className="qc-check"><input type="checkbox" checked={evidence.sourceReviewed} onChange={(event) => setEvidence((current) => ({ ...current, sourceReviewed: event.target.checked }))} /><span>I reviewed the candidate’s source and vehicle identity.</span></label><label className="qc-check"><input type="checkbox" checked={evidence.sourceUrlsReviewed} onChange={(event) => setEvidence((current) => ({ ...current, sourceUrlsReviewed: event.target.checked }))} /><span>I checked the linked evidence or an independent authoritative source.</span></label><label className="qc-check"><input type="checkbox" checked={evidence.operatorAttestation} onChange={(event) => setEvidence((current) => ({ ...current, operatorAttestation: event.target.checked }))} /><span>I attest that all six width/height pairs are exact production measurements.</span></label></fieldset>
    {error && <div className="notice error">{error}</div>}
    <button disabled={!evidenceComplete || busy}>{busy ? "Recording exact geometry…" : "Validate GENIE geometry and resume jobs"}</button>
  </form>;
}

function GenieQc() {
  const [candidates, setCandidates] = useState<GenieCandidate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dpApi.listGenieCandidates().then(setCandidates).catch((cause) => { redirectIfUnauthenticated(cause); setError(cause instanceof ApiError && cause.status === 403 ? "Your account is not authorized for GENIE validation." : "Pending GENIE candidates could not be loaded."); }).finally(() => setLoading(false));
  }, []);
  return <Shell><div className="page-head"><div><div className="eyebrow">GENIE UNIVERSAL PANELIZER</div><h1>Exact geometry validation</h1><p>Only grounded six-surface dimensions can release the automatic 2D proof and panel build.</p></div><span className="status-chip">Human authority</span></div>{error && <div className="notice error">{error}</div>}{loading && <div className="notice">Loading pending candidates…</div>}{!loading && !error && candidates.length === 0 && <div className="empty"><h2>No candidates need validation</h2><p>GENIE has no production jobs waiting for exact vehicle geometry.</p></div>}<div className="candidate-list">{candidates.map((candidate) => <GenieCandidateForm key={candidate.id} candidate={candidate} onValidated={(id) => setCandidates((current) => current.filter((item) => item.id !== id))} />)}</div></Shell>;
}

const preflightItems = [
  ["dimensionsVerified", "GENIE trim dimensions and total square footage match the approved vehicle record"],
  ["sourceRegionsVerified", "Driver, passenger, hood, roof, front and rear each come from their own Call 8 proof region"],
  ["fiveInchBleed", "Every production surface contains exactly 5 inches of bleed on all four edges"],
  ["panelHashesVerified", "Every panel hash matches its frozen Call 9 artifact"],
  ["logoInventoryVerified", "Call 10 logo count, identity and surface assignment exactly match the frozen inventory"],
  ["textLockVerified", "Every required body-text character matches the frozen revision text lock"],
] as const;

const finalItems = [
  ["outputHashesVerified", "Every PNG, TIFF and EPS output hash matches the verified output receipt"],
  ["printDimensionsVerified", "Final print dimensions, resolution and bleed match GENIE"],
  ["colorModeVerified", "Final production color-mode requirements are verified"],
] as const;

function QcGate({ gate, onApprove }: { gate: "preflight" | "final"; onApprove: (qc: PreflightQc | FinalQc, notes: string) => Promise<void> }) {
  const items = gate === "preflight" ? preflightItems : finalItems;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const complete = items.every(([key]) => checks[key] === true);
  const title = gate === "preflight" ? "PanelPro preflight QC" : "Final production QC";
  const action = gate === "preflight" ? "Approve and release output build" : "Approve and release stamp + ZIP";
  async function approve() {
    if (!complete) return;
    setBusy(true);
    setError("");
    try {
      await onApprove(Object.fromEntries(items.map(([key]) => [key, true])) as unknown as PreflightQc | FinalQc, notes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="gate qc-gate"><div className="eyebrow">HUMAN RELEASE GATE</div><h2>{title}</h2><p>Approval is blocked until every required check is explicitly confirmed.</p><fieldset>{items.map(([key, label]) => <label className="qc-check" key={key}><input type="checkbox" checked={checks[key] === true} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}</fieldset><label>Operator notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></label>{error && <div className="notice error">{error}</div>}<button disabled={!complete || busy} onClick={approve}>{busy ? "Recording verified approval…" : action}</button></section>;
}

function artifactCanPreview(artifact: WorkflowArtifact) {
  const path = artifact.storagePath.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((extension) => path.endsWith(extension));
}

function artifactDimension(artifact: WorkflowArtifact) {
  const width = artifact.metadata.widthInches ?? artifact.metadata.widthPx ?? artifact.metadata.width;
  const height = artifact.metadata.heightInches ?? artifact.metadata.heightPx ?? artifact.metadata.height;
  if (width == null || height == null) return null;
  const unit = artifact.metadata.widthInches != null || artifact.metadata.heightInches != null ? "in" : "px";
  return `${String(width)} × ${String(height)} ${unit}`;
}

function ArtifactReview({ artifacts, loading, error, onRefresh }: { artifacts: WorkflowArtifact[]; loading: boolean; error: string; onRefresh: () => void }) {
  return <section className="panel artifact-review">
    <div className="artifact-head"><div><div className="eyebrow">PRIVATE VERIFIED ARTIFACTS</div><h2>Review the actual production files</h2><p>These five-minute links are minted only for your authenticated session. Storage paths and hashes remain the durable identity.</p></div><button className="secondary" type="button" onClick={onRefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh artifacts"}</button></div>
    {error && <div className="notice error">{error}</div>}
    {!loading && !error && artifacts.length === 0 && <div className="notice">No reviewable artifacts have been published for this job yet.</div>}
    <div className="artifact-grid">{artifacts.map((artifact) => <article className="artifact-card" key={artifact.id}>
      {artifactCanPreview(artifact) ? <a className="artifact-preview" href={artifact.signedUrl} target="_blank" rel="noreferrer"><img src={artifact.signedUrl} alt={`${artifact.kind} ${artifact.surfaceKey || "artifact"}`} /></a> : <a className="artifact-file" href={artifact.signedUrl} target="_blank" rel="noreferrer">Open verified file</a>}
      <div className="artifact-copy"><strong>{artifact.kind.replaceAll("_", " ")}</strong>{artifact.surfaceKey && <span>{artifact.surfaceKey}</span>}{artifactDimension(artifact) && <span>{artifactDimension(artifact)}</span>}<code title={artifact.contentHash}>SHA-256 {artifact.contentHash.slice(0, 12)}…</code><a href={artifact.signedUrl} target="_blank" rel="noreferrer">Open full artifact ↗</a></div>
    </article>)}</div>
  </section>;
}

const panelOrder: GenieSurfaceKey[] = ["driver", "passenger", "hood", "roof", "front", "rear"];
const panelLabel: Record<string, string> = {
  driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", hood: "HOOD",
  roof: "ROOF", front: "FRONT", rear: "REAR",
};

function num(value: unknown) {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : null;
}

function inchLabel(value: unknown) {
  const parsed = num(value);
  if (parsed == null || Number.isNaN(parsed)) return null;
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 100) / 100);
}

function SaveLink({ url, name }: { url: string; name: string }) {
  return <a className="save-link" href={url} download={name} target="_blank" rel="noreferrer">↓ Save</a>;
}

/**
 * Revision Studio. The customer-facing 2D Production Proof, and under it every
 * print-ready panel that was cut out of the approved flat wrap layout. Each row
 * carries the GENIE trim size, the print size at five-inch bleed, and the cut
 * rectangle and hash the panel came from, so a panel that is not a cut of the
 * approved design cannot look like one here.
 */
function RevisionStudio({ artifacts, loading }: { artifacts: WorkflowArtifact[]; loading: boolean }) {
  const proof = artifacts.find((item) => item.kind === "flat-proof" && !item.surfaceKey);
  const layout = artifacts.find((item) => item.kind === "flat-proof" && item.surfaceKey === "flat-wrap-layout");
  const panels = panelOrder
    .map((key) => artifacts.find((item) => item.kind === "panel" && item.surfaceKey === key))
    .filter((item): item is WorkflowArtifact => Boolean(item));
  if (loading && !proof && panels.length === 0) return <section className="panel"><div className="notice">Loading Revision Studio…</div></section>;
  if (!proof && panels.length === 0) return null;
  const totalSqFt = num(proof?.metadata?.totalSqFt);

  return <section className="panel revision-studio">
    <div className="artifact-head">
      <div>
        <div className="eyebrow">REVISION STUDIO</div>
        <h2>2D Production Proof</h2>
        <p>The approved proof and every print-ready panel cut from it. Deterministic per-side crops of the approved flat wrap layout — no re-render.</p>
      </div>
      {totalSqFt != null && <span className="status-chip">{totalSqFt.toFixed(2)} sq ft</span>}
    </div>

    {proof
      ? <figure className="proof-figure">
          <a href={proof.signedUrl} target="_blank" rel="noreferrer"><img src={proof.signedUrl} alt="2D Production Proof" /></a>
          <figcaption><span>DesignProAI™ — 2D Production Proof</span><SaveLink url={proof.signedUrl} name="2d-production-proof.png" /></figcaption>
        </figure>
      : <div className="notice">The 2D production proof has not been published for this job yet.</div>}

    <div className="studio-head">
      <h3>Production Layers — {panels.length} {panels.length === 1 ? "side" : "sides"}</h3>
      {layout && <a className="layout-link" href={layout.signedUrl} target="_blank" rel="noreferrer">Open approved flat wrap layout ↗</a>}
    </div>

    {panels.length === 0 && <div className="notice">No panels have been cut yet. They appear here once Call 9 completes.</div>}

    <div className="studio-panels">{panels.map((panel) => {
      const width = inchLabel(panel.metadata.trimWidthInches);
      const height = inchLabel(panel.metadata.trimHeightInches);
      const printWidth = inchLabel(panel.metadata.printWidthInches);
      const printHeight = inchLabel(panel.metadata.printHeightInches);
      const sqFt = num(panel.metadata.surfaceSqFt);
      const rect = panel.metadata.cutRect as { x: number; y: number; w: number; h: number } | undefined;
      return <article className="studio-row" key={panel.id}>
        <header>
          <strong>{panelLabel[panel.surfaceKey] || panel.surfaceKey.toUpperCase()}</strong>
          {width && height && <span>{width}" × {height}"</span>}
        </header>
        <a className="studio-thumb" href={panel.signedUrl} target="_blank" rel="noreferrer">
          <img src={panel.signedUrl} alt={`${panel.surfaceKey} print-ready panel`} />
        </a>
        <div className="studio-meta">
          <div className="studio-line"><span>Print-ready panel</span><SaveLink url={panel.signedUrl} name={`${panel.surfaceKey}-print-panel.png`} /></div>
          {printWidth && printHeight && <small>{printWidth}" × {printHeight}" printed · 5" bleed on all four edges{sqFt != null ? ` · ${sqFt.toFixed(2)} sq ft` : ""}</small>}
          {rect && <small className="studio-provenance">Cut {rect.w}×{rect.h} px at ({rect.x}, {rect.y}) of the approved layout</small>}
          <code title={panel.contentHash}>SHA-256 {panel.contentHash.slice(0, 16)}…</code>
          <small className="muted">The panel is the print-ready base; your branding prints on top.</small>
        </div>
      </article>;
    })}</div>
  </section>;
}

function Workflow() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [artifactsError, setArtifactsError] = useState("");
  const [error, setError] = useState("");
  const load = () => dpApi.getStatus(generationId).then((status) => { setJob(status); setError(""); }).catch((cause) => { redirectIfUnauthenticated(cause); setError("Status unavailable."); });
  const loadArtifacts = () => {
    setArtifactsLoading(true);
    return dpApi.listArtifacts(generationId).then((result) => { setArtifacts(result); setArtifactsError(""); }).catch((cause) => { redirectIfUnauthenticated(cause); setArtifactsError("Verified artifacts could not be loaded."); }).finally(() => setArtifactsLoading(false));
  };
  useEffect(() => { load(); const id = window.setInterval(load, 5000); return () => clearInterval(id); }, [generationId]);
  useEffect(() => { loadArtifacts(); const id = window.setInterval(loadArtifacts, 240000); return () => clearInterval(id); }, [generationId]);
  const completeCount = useMemo(() => job?.stages.filter((stage) => stage.state === "complete").length || 0, [job]);
  if (!job) return <Shell><div className="notice">{error || "Loading server status…"}</div></Shell>;
  return <Shell>
    <div className="page-head"><div><Link className="back" to="/app">← Jobs</Link><h1>{job.designId}</h1><p>Order # {job.orderNumber} · Revision {job.revision} · {completeCount} of {job.stages.length} stages verified</p></div><span className={`state ${job.state}`}>{job.state.replaceAll("_", " ")}</span></div>
    {job.failure && <div className="notice error"><strong>{job.failure.stage}</strong><span>{job.failure.message}</span>{job.failure.retryable && <button className="secondary" onClick={() => dpApi.requestResume(generationId).then(load)}>Request server resume</button>}</div>}
    <section className="panel"><h2>Automatic workflow</h2><div className="timeline">{job.stages.map((stage) => <div className={`stage ${stage.state}`} key={stage.key}><i/><div><strong>{stageLabel[stage.key] || stage.label}</strong><small>{stage.state}</small>{stage.artifactPath && <code>{stage.artifactPath}</code>}</div></div>)}</div></section>
    <RevisionStudio artifacts={artifacts} loading={artifactsLoading} />
    <ArtifactReview artifacts={artifacts} loading={artifactsLoading} error={artifactsError} onRefresh={loadArtifacts} />
    {job.state === "waiting_for_preflight" && <QcGate gate="preflight" onApprove={async (qc, notes) => { await dpApi.approvePreflight(generationId, qc as PreflightQc, notes); await load(); }} />}
    {job.state === "waiting_for_final_qc" && <QcGate gate="final" onApprove={async (qc, notes) => { await dpApi.approveFinalQc(generationId, qc as FinalQc, notes); await load(); }} />}
  </Shell>;
}

function Wrapbox() {
  const [packs, setPacks] = useState<WrapboxPack[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    dpApi.listWrapbox().then(setPacks).catch((cause) => {
      redirectIfUnauthenticated(cause);
      setError("WrapBox packs could not be loaded.");
    });
  }, []);
  return <Shell><div className="page-head"><div><div className="eyebrow">PRIVATE DELIVERY</div><h1>WrapBox</h1><p>Completed customer production packs with immutable ZIP and manifest hashes.</p></div></div>{error && <div className="notice error">{error}</div>}{!error && packs.length === 0 && <div className="empty"><h2>No delivered packs yet</h2><p>The automatic pipeline publishes packs here only after final QC, stamp and ZIP verification.</p></div>}<div className="grid">{packs.map((pack) => <Link className="card" key={pack.id} to={`/app/wrapbox/${pack.id}`}><div className="card-top"><strong>{pack.designId}</strong><span className="state complete">ready</span></div><h2>{pack.designName}</h2><p>Order # {pack.orderNumber} · {new Date(pack.readyAt).toLocaleString()}</p><code>ZIP {pack.zip.contentHash.slice(0, 12)}…</code></Link>)}</div></Shell>;
}

function WrapboxDetail() {
  const { packId = "" } = useParams();
  const [pack, setPack] = useState<WrapboxPack>();
  const [error, setError] = useState("");
  const load = () => dpApi.getWrapboxPack(packId).then((value) => { setPack(value); setError(""); }).catch((cause) => {
    redirectIfUnauthenticated(cause);
    setError("This WrapBox pack is unavailable or you are not authorized to view it.");
  });
  useEffect(() => { void load(); }, [packId]);
  if (!pack) return <Shell><div className={`notice ${error ? "error" : ""}`}>{error || "Minting five-minute download links…"}</div></Shell>;
  return <Shell><div className="page-head"><div><Link className="back" to="/app/wrapbox">← WrapBox</Link><h1>{pack.designId}</h1><p>{pack.designName} · Order # {pack.orderNumber} · Delivered {new Date(pack.readyAt).toLocaleString()}</p></div><button className="secondary" onClick={load}>Refresh five-minute links</button></div><section className="panel"><div className="eyebrow">EXACT VERIFIED DELIVERY</div><h2>Production ZIP</h2><p><strong>{pack.designId}</strong> · Order # {pack.orderNumber}</p><code>SHA-256 {pack.zip.contentHash}</code><p>{pack.zip.byteSize.toLocaleString()} bytes</p>{pack.zip.signedUrl && <a className="button-link" href={pack.zip.signedUrl}>Download production ZIP</a>}</section><section className="panel"><h2>Manifest</h2><code>SHA-256 {pack.manifest.contentHash}</code><p>{pack.manifest.byteSize.toLocaleString()} bytes</p>{pack.manifest.signedUrl && <a className="button-link" href={pack.manifest.signedUrl}>Open exact manifest</a>}</section></Shell>;
}

/**
 * Calls 1-7. The other entry point, NewRevision, requires the operator to
 * already own seven renders. This is the one that makes them: a brief and a
 * vehicle go in, the runtime generation worker produces the seven immutable
 * source views, and the same WrapBox recipient binding both paths use is
 * registered first because the generation request is refused without it.
 */
function GenerateDesign() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<GenerationRequestState>();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  // The seven views are only half the job. As soon as the database confirms the
  // handoff is valid, advance into the existing Calls 8-12 workflow — the
  // operator should not have to re-enter anything to get a production pack.
  useEffect(() => {
    if (request?.state !== "outputs_ready" || request.handoffReady !== true || handingOff) return;
    setHandingOff(true);
    dpApi.handoffGeneration(request.requestId)
      .then((result) => navigate(`/app/revisions/${result.generationId || request.generationId}`))
      .catch((cause) => {
        redirectIfUnauthenticated(cause);
        setHandingOff(false);
        setError(cause instanceof ApiError ? `The production handoff was refused (${cause.code}).` : "The production handoff failed.");
      });
  }, [request?.state, request?.handoffReady, request?.requestId]);

  // Poll while the worker runs. The request is durable, so a browser refresh
  // resumes reporting rather than losing the job.
  useEffect(() => {
    if (!request || ["outputs_ready", "failed", "cancelled"].includes(request.state)) return;
    const timer = setInterval(() => {
      dpApi.getGenerationRequest(request.requestId)
        .then(setRequest)
        .catch((cause) => redirectIfUnauthenticated(cause));
    }, 5000);
    return () => clearInterval(timer);
  }, [request?.requestId, request?.state]);

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
      setProgress("Queueing the seven-view generation…");
      const created = await dpApi.createGenerationRequest({
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
          colors: String(form.get("colors") || "").split(",").map((value) => value.trim()).filter(Boolean),
        },
      });
      setRequest(created);
    } catch (cause) {
      redirectIfUnauthenticated(cause);
      setError(cause instanceof ApiError ? `The generation request was refused (${cause.code}).` : cause instanceof Error ? cause.message : "The design could not be generated.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const views = request?.views || [];
  return <Shell>
    <div className="page-head"><div><Link className="back" to="/app">← Jobs</Link><h1>Generate a design</h1><p>Describe the wrap and the vehicle. The server generates seven distinct photoreal views — it never mirrors one side to make another.</p></div><span className="status-chip">Calls 1–7</span></div>
    {!request && <form className="revision-form" onSubmit={submit}>
      <section className="panel"><div className="eyebrow">THE DESIGN</div><div className="form-grid">
        <label className="wide">Design brief<textarea name="brief" rows={3} required maxLength={2000} placeholder="Bold commercial wrap, clean geometric shapes, large legible phone number" /></label>
        <label>Business name<input name="businessName" maxLength={160} /></label>
        <label>Industry<input name="industry" maxLength={160} placeholder="HVAC services" /></label>
        <label>Colors<input name="colors" maxLength={240} placeholder="dark blue, ice blue, white" /></label>
        <label>Style<input name="style" maxLength={160} placeholder="bold modern commercial" /></label>
      </div></section>
      <section className="panel"><div className="eyebrow">VEHICLE IDENTITY</div><div className="form-grid">
        <label>Year<input name="year" required /></label>
        <label>Make<input name="make" required /></label>
        <label>Model<input name="model" required /></label>
        <label>Vehicle type<select name="type" defaultValue="van" required><option value="car">Car</option><option value="truck">Truck / box truck</option><option value="suv">SUV</option><option value="van">Van</option><option value="motorcycle">Motorcycle</option><option value="boat">Boat</option><option value="bus">Bus</option><option value="rv">RV</option><option value="trailer">Trailer</option><option value="aircraft">Aircraft</option><option value="heavy_equipment">Heavy equipment</option></select></label>
      </div></section>
      <section className="panel"><div className="eyebrow">IMMUTABLE ORDER + WRAPBOX RECIPIENT</div><p className="muted">Enter normal business information — never database IDs or hashes. The order/payment reference is hashed at the gateway and never stored in its original form.</p><div className="form-grid">
        <label>Order #<input name="orderNumber" pattern="[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}" maxLength={120} required /></label>
        <label>Confirmed customer email<input name="customerEmail" type="email" autoComplete="email" maxLength={320} required /></label>
        <label>Customer reference / name<input name="customerReference" minLength={1} maxLength={160} required /></label>
        <label className="wide">Order or payment verification reference<input name="verificationReference" minLength={3} maxLength={256} autoComplete="off" spellCheck={false} required /></label>
        <label className="wide">Design name<input name="designName" maxLength={240} required /></label>
      </div></section>
      {error && <div className="notice error">{error}</div>}
      {progress && <div className="notice">{progress}</div>}
      <button disabled={busy}>{busy ? "Working…" : "Generate seven views"}</button>
    </form>}
    {request && <>
      <section className="panel"><div className="eyebrow">GENERATION STATE</div><h2>{request.state.replaceAll("_", " ")}</h2><p className="muted">Request {request.requestId}</p>
        {request.state === "queued" && <p>Waiting for a production runtime to claim this request.</p>}
        {request.state === "leased" && <p>A runtime is generating the seven views now. This page keeps reporting if you refresh or close it.</p>}
        {request.state === "retryable" && <p>A view failed and will be retried.</p>}
        {request.state === "failed" && <div className="notice error">{request.failureCode || "Generation failed."}</div>}
        {request.state === "outputs_ready" && <p className="success">All seven views are generated and byte-verified.</p>}
        {request.state === "outputs_ready" && handingOff && <p>Freezing the revision and starting the production workflow…</p>}
        {request.state === "outputs_ready" && request.handoffReady === false && <div className="notice error">Production handoff blocked: {request.handoffBlocker || "unknown"}</div>}
      </section>
      <section className="panel"><div className="eyebrow">SEVEN DISTINCT SOURCE VIEWS</div><div className="grid">
        {viewDefinitions.map(({ key, label }) => {
          const view = views.find((item) => item.consumerRole === key);
          return <div className={`card ${view ? "" : "pending"}`} key={key}><div className="card-top"><strong>{label}</strong><span className={`state ${view ? "outputs_ready" : "queued"}`}>{view ? "ready" : "pending"}</span></div>{view && <code>SHA-256 {view.contentHash.slice(0, 32)}…</code>}</div>;
        })}
      </div></section>
    </>}
  </Shell>;
}

function App() {
  return <BrowserRouter><Routes><Route path="/login" element={<Login/>}/><Route path="/app" element={<Dashboard/>}/><Route path="/app/generate" element={<GenerateDesign/>}/><Route path="/app/revisions/new" element={<NewRevision/>}/><Route path="/app/revisions/:generationId" element={<Workflow/>}/><Route path="/app/genie-qc" element={<GenieQc/>}/><Route path="/app/wrapbox" element={<Wrapbox/>}/><Route path="/app/wrapbox/:packId" element={<WrapboxDetail/>}/><Route path="*" element={<Navigate to="/app" replace/>}/></Routes></BrowserRouter>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
