import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { panelOutputApi, PanelOutputApiError, type TemplateCandidate, type TemplateGeometryPiece, type TemplateRegion } from "@/lib/panelpro-file-output-api";

const HASH = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_COPY: Record<string, string> = {
  "template.import": "Measured source and original assets verified",
  "template.recreate": "Create branded template preview",
  "template.overlay-review": "Review geometry and installation areas",
  "template.bank": "Save the approved template",
};
const STATES: Record<string, string> = { queued: "Queued", pending: "Queued", running: "Creating", waiting: "Waiting for review", waiting_review: "Waiting for review", completed: "Complete", approved: "Approved and saved", blocked: "Needs attention", failed: "Needs attention" };
const stateLabel = (state: string) => Object.prototype.hasOwnProperty.call(STATES, state) ? STATES[state] : "Waiting";
const errorText = (error: unknown) => {
  const code = error instanceof PanelOutputApiError ? error.code : "";
  if (["template_qc_permission_required", "template_review_permission_required"].includes(code)) return "This account needs the internal template review permission.";
  if (["template_recreate_not_enabled", "template_provider_credentials_missing"].includes(code)) return "Template recreation is not enabled on this server yet.";
  if (["template_candidate_identity_invalid", "template_source_identity_changed", "template_review_identity_changed"].includes(code)) return "The saved source or candidate changed. Refresh and inspect the current version before approving.";
  if (["template_display_region_invalid", "template_display_regions_required"].includes(code)) return "Mark one valid pixel region for every measured piece, below the brand header and inside the image.";
  if (["template_measured_source_review_required", "template_geometry_review_required"].includes(code)) return "The source needs measured dimensions, exact vehicle identity, cut-area review, fit tolerance and a physical measurement reference.";
  return "The action was not completed. Check the saved source, current review state and your access.";
};

export function validTemplateRegions(candidate: TemplateCandidate, regions: Record<string, TemplateRegion>): boolean {
  const meta = candidate.displayMetadata;
  const pieces = candidate.geometry?.pieces || [];
  return Boolean(meta && pieces.length > 0 && Object.keys(regions).length === pieces.length && pieces.every((piece) => {
    const region = regions[piece.pieceId];
    return region && [region.x, region.y, region.width, region.height].every(Number.isInteger)
      && region.x >= 0 && region.y >= meta.headerHeight && region.width > 0 && region.height > 0
      && region.x + region.width <= meta.width && region.y + region.height <= meta.height;
  }));
}

function points(pointsInches: number[][], piece: TemplateGeometryPiece, region: TemplateRegion) {
  return pointsInches.map(([x, y]) => `${region.x + x * region.width / piece.widthInches},${region.y + y * region.height / piece.heightInches}`).join(" ");
}

/** Measured vectors are drawn only inside regions explicitly supplied by the operator. */
export function TemplateCandidateOverlay({ candidate, regions }: { candidate: TemplateCandidate; regions: Record<string, TemplateRegion> }) {
  const preview = candidate.previews.find((item) => item.role === "branded-template-candidate" && item.customerVisible === false
    && item.contentHash === candidate.displayContentHash && HASH.test(item.contentHash) && /^https:\/\/[^\s]+$/.test(item.signedUrl));
  const meta = candidate.displayMetadata;
  if (!preview || !meta) return <p className="text-sm text-slate-400">The saved branded candidate will appear after recreation finishes.</p>;
  return <figure className="overflow-auto rounded-xl border border-slate-700 bg-white">
    <svg viewBox={`0 0 ${meta.width} ${meta.height}`} role="img" aria-label="Branded candidate with operator-positioned measured outlines and installation areas" className="w-full min-w-[420px]">
      <image href={preview.signedUrl} x="0" y="0" width={meta.width} height={meta.height} />
      {(candidate.geometry?.pieces || []).map((piece) => {
        const region = regions[piece.pieceId];
        if (!region || ![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.width <= 0 || region.height <= 0) return null;
        return <g key={piece.pieceId}>
          <rect {...region} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 5" />
          <polygon points={points(piece.outlineInches, piece, region)} fill="none" stroke="#0891b2" strokeWidth="2" />
          {piece.cutAreas.map((area) => <polygon key={area.areaId} points={points(area.pointsInches, piece, region)} fill="#ef444433" stroke="#dc2626" strokeWidth="2" />)}
          <text x={region.x + 4} y={region.y + 16} fill="#0f172a" fontSize="14">{piece.pieceId}</text>
        </g>;
      })}
    </svg>
    <figcaption className="bg-slate-950 p-3 text-xs text-slate-300">Cyan: measured outline. Red: installation areas. Purple: the region you entered. These marks are inspection overlays.</figcaption>
  </figure>;
}

type RegionDraft = Record<string, Record<keyof TemplateRegion, string>>;
export function TemplateCandidateReview({ candidate, onUpdated }: { candidate: TemplateCandidate; onUpdated?: (candidate: TemplateCandidate) => void }) {
  const [draft, setDraft] = useState<RegionDraft>({});
  const [reviewId, setReviewId] = useState("");
  const [cutReviewed, setCutReviewed] = useState(false);
  const [alignmentReviewed, setAlignmentReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const regions = useMemo(() => Object.fromEntries(Object.entries(draft).flatMap(([pieceId, entry]) => {
    if (!["x", "y", "width", "height"].every((key) => /^\d+$/.test(entry[key as keyof TemplateRegion] || ""))) return [];
    return [[pieceId, Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, Number(value)])) as TemplateRegion]];
  })), [draft]);
  const canApprove = candidate.canReview && candidate.status === "waiting_review" && !busy && cutReviewed && alignmentReviewed
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(reviewId) && HASH.test(candidate.candidateHash || "")
    && HASH.test(candidate.geometryHash || "") && HASH.test(candidate.displayContentHash || "") && validTemplateRegions(candidate, regions);
  const approve = async () => {
    if (!canApprove || !candidate.candidateHash || !candidate.geometryHash || !candidate.displayContentHash) return;
    setBusy(true); setError("");
    try {
      const result = await panelOutputApi.approveTemplateCandidate(candidate.candidateId, { candidateHash: candidate.candidateHash, review: {
        reviewId, approved: true, displayContentHash: candidate.displayContentHash, geometryHash: candidate.geometryHash,
        cutGeometryReviewed: true, displayAlignmentReviewed: true,
        displayRegions: (candidate.geometry?.pieces || []).map((piece) => ({ pieceId: piece.pieceId, displayRegionPixels: regions[piece.pieceId] })),
      } });
      if (result.status !== "approved" || result.candidateHash !== candidate.candidateHash || !result.template) throw new Error("Template not approved");
      onUpdated?.(result);
    } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); }
  };
  const recover = async () => {
    setBusy(true); setError("");
    try { onUpdated?.(await panelOutputApi.recoverTemplateCandidate(candidate.candidateId)); }
    catch (issue) { setError(errorText(issue)); } finally { setBusy(false); }
  };
  const download = () => {
    if (candidate.status !== "approved" || !candidate.template) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(candidate.template, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `approved-template-${candidate.templateId}-${candidate.version}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950 p-5">
    <div><h2 className="text-xl font-semibold">{candidate.templateId} · {candidate.version}</h2><p className="mt-1 text-sm text-slate-400">{stateLabel(candidate.status)} · Internal preview</p></div>
    <ol className="grid gap-2 sm:grid-cols-2">{candidate.stages.map((stage) => <li key={stage.key} className="rounded-lg border border-slate-800 p-3"><p className="text-sm">{Object.prototype.hasOwnProperty.call(STAGE_COPY, stage.key) ? STAGE_COPY[stage.key] : "Template preparation"}</p><p className="mt-1 text-xs text-slate-400">{stateLabel(stage.state)}</p></li>)}</ol>
    <div className="grid gap-3 sm:grid-cols-2">{candidate.previews.filter((item) => ["source-raster", "brand-original"].includes(item.role) && item.customerVisible === false && HASH.test(item.contentHash) && /^https:\/\/[^\s]+$/.test(item.signedUrl)).map((item) => <figure key={item.role} className="overflow-hidden rounded-lg border border-slate-800"><img src={item.signedUrl} alt={item.role === "source-raster" ? "Reviewed source template raster" : "Original brand asset"} className="max-h-64 w-full bg-white object-contain" /><figcaption className="p-2 text-xs">{item.role === "source-raster" ? "Reviewed source raster; original vector is preserved" : "Original brand asset"}</figcaption></figure>)}</div>
    <TemplateCandidateOverlay candidate={candidate} regions={regions} />
    {candidate.status === "approved" && candidate.template ? <div className="space-y-3"><p className="text-sm text-emerald-300">The reviewed template is saved in the template bank.</p><Button onClick={download}>Download approved template JSON</Button></div> : candidate.geometry && <>
      <div><h3 className="font-semibold">Mark each measured piece on the candidate</h3><p className="mt-1 text-sm text-slate-400">Enter pixel bounds from the saved image. Geometry stays in inches. Fit tolerance: {candidate.fitToleranceInches}″. The header ends at pixel {candidate.displayMetadata?.headerHeight ?? "—"}; review regions must start below it.</p></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Measured piece</th>{["x", "y", "width", "height"].map((field) => <th key={field} className="p-2">{field} px</th>)}</tr></thead><tbody>{candidate.geometry.pieces.map((piece) => <tr key={piece.pieceId}><td className="p-2">{piece.pieceId}<span className="block text-xs text-slate-400">{piece.widthInches}″ × {piece.heightInches}″ · {piece.cutAreas.length} cut areas</span></td>{(["x", "y", "width", "height"] as const).map((field) => <td key={field} className="p-2"><Input type="number" min={0} step={1} aria-label={`${piece.pieceId} ${field} pixels`} value={draft[piece.pieceId]?.[field] || ""} onChange={(event) => setDraft((current) => ({ ...current, [piece.pieceId]: { ...current[piece.pieceId], [field]: event.target.value } }))} disabled={!candidate.canReview || busy} className="min-w-20 border-slate-700" /></td>)}</tr>)}</tbody></table></div>
      <fieldset disabled={!candidate.canReview || busy} className="space-y-3">
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={cutReviewed} onChange={(event) => setCutReviewed(event.target.checked)} />I checked all measured outlines and installation cut areas against this exact candidate.</label>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={alignmentReviewed} onChange={(event) => setAlignmentReviewed(event.target.checked)} />I inspected the geometry overlay, scale and alignment within the required fit tolerance.</label>
        <label className="block text-sm">Review reference<Input value={reviewId} maxLength={160} onChange={(event) => setReviewId(event.target.value)} placeholder="Inspection-reference-2026" className="mt-2 border-slate-700" /></label>
      </fieldset>
      <Button disabled={!canApprove} onClick={() => void approve()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve and bank this exact template</Button>
    </>}
    {candidate.error && <p role="status" className="text-sm text-amber-200">This candidate needs attention before it can be approved. Existing source assets remain saved.</p>}
    {["blocked", "failed"].includes(candidate.status) && <Button variant="outline" disabled={busy} onClick={() => void recover()}>Resume eligible template work</Button>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
  </section>;
}

/** Route is internal-only; every API read/sign/review independently checks can_preflight. */
export default function PanelProTemplateReview() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const candidateId = search.get("candidateId");
  const [candidate, setCandidate] = useState<TemplateCandidate | null>(null);
  const [candidates, setCandidates] = useState<TemplateCandidate[]>([]);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [sourceId, setSourceId] = useState(search.get("sourceId") || "");
  const [sourceChecks, setSourceChecks] = useState({ measuredDimensions: false, cutAreasReviewed: false, rasterMatchesVector: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true; let timer: number | undefined;
    const controller = new AbortController();
    setCandidate(null); setReadFailed(false);
    const load = async () => {
      try {
        if (candidateId) {
          const next = await panelOutputApi.getTemplateCandidate(candidateId, controller.signal);
          if (live) setCandidate(next);
        } else {
          const next = await panelOutputApi.listTemplateCandidates(search.get("sourceId") || undefined, controller.signal);
          if (live) setCandidates(next);
        }
        if (live) setReadFailed(false);
      } catch { if (live) setReadFailed(true); }
      finally { if (live) timer = window.setTimeout(load, 5000); }
    };
    void load();
    return () => { live = false; controller.abort(); window.clearTimeout(timer); };
  }, [candidateId, search, refresh]);
  const readSource = async (file?: File) => {
    setSource(null); setError(""); setSourceChecks({ measuredDimensions: false, cutAreasReviewed: false, rasterMatchesVector: false });
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("size");
      const value = JSON.parse(await file.text());
      if (!value || typeof value !== "object" || Array.isArray(value) || !value.review || typeof value.review !== "object") throw new Error("shape");
      setSource(value);
    } catch { setError("Choose a source JSON object up to 1 MB, including its recorded measurement review."); }
  };
  const importSource = async () => {
    if (!source || !Object.values(sourceChecks).every(Boolean) || busy) return;
    setBusy(true); setError("");
    try {
      const result = await panelOutputApi.importTemplateSource({ ...source, review: { ...(source.review as Record<string, unknown>), ...sourceChecks } });
      if (result.status !== "measured_source_reviewed" || !UUID.test(result.sourceId)) throw new Error("Registration not recorded");
      setSourceId(result.sourceId); setSource(null);
    } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); }
  };
  const create = async () => {
    if (!UUID.test(sourceId) || busy) return;
    setBusy(true); setError("");
    try {
      const next = await panelOutputApi.createTemplateCandidate(sourceId);
      navigate(`/panelpro-file-output/templates?candidateId=${encodeURIComponent(next.candidateId)}`);
      setCandidate(next);
    } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-[#080d18] px-4 py-8 text-slate-100"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-cyan-300">Internal design team</p><h1 className="mt-2 text-2xl font-bold">Vehicle template preparation and review</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Recreate the branded display, check it against measured vector geometry, then bank the reviewed version for future output jobs.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link to="/panelpro-file-output/prepare">Output source preparation</Link></Button><Button variant="outline" onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div></header>
    {readFailed && <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-200">Template progress could not be refreshed. Existing previews remain available while access reconnects.</p>}
    {candidate ? <TemplateCandidateReview key={`${candidate.candidateId}:${candidate.candidateHash || "pending"}`} candidate={candidate} onUpdated={setCandidate} /> : candidateId ? <p className="text-sm text-slate-400">Waiting for the saved candidate.</p> : <>
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-5"><h2 className="text-lg font-semibold">Import a measured source</h2><p className="text-sm text-slate-400">The JSON must reference the existing owner-scoped vector, reviewed raster derivative, original brand and measured geometry files. Include exact make, model, year and variant, fit tolerance, and the physical measurement reference.</p><Input type="file" accept="application/json,.json" aria-label="Measured template source JSON" onChange={(event) => void readSource(event.target.files?.[0])} />
        {source && <><p className="text-sm">Source selected: {String(source.templateId || "")} · {String(source.version || "")}</p><fieldset disabled={busy} className="space-y-2">{(["measuredDimensions", "cutAreasReviewed", "rasterMatchesVector"] as const).map((key) => <label key={key} className="flex gap-3 text-sm"><input type="checkbox" checked={sourceChecks[key]} onChange={(event) => setSourceChecks((current) => ({ ...current, [key]: event.target.checked }))} />{({ measuredDimensions: "I reviewed measured dimensions and the exact vehicle variant.", cutAreasReviewed: "I checked installation cut areas in the source geometry.", rasterMatchesVector: "I compared the raster derivative with the preserved original vector." })[key]}</label>)}</fieldset><Button disabled={busy || !Object.values(sourceChecks).every(Boolean)} onClick={() => void importSource()}>Register reviewed source</Button></>}
      </section>
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-5"><h2 className="text-lg font-semibold">Create a branded candidate</h2><label className="block text-sm">Registered source ID<Input value={sourceId} onChange={(event) => setSourceId(event.target.value.trim())} placeholder="Source ID returned after verification" className="mt-2 border-slate-700" /></label><Button disabled={busy || !UUID.test(sourceId)} onClick={() => void create()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create branded template</Button></section>
      <section className="space-y-3"><h2 className="font-semibold">Saved candidates</h2>{candidates.length ? candidates.map((item) => <Link key={item.candidateId} className="block rounded-xl border border-slate-800 bg-slate-950 p-4" to={`/panelpro-file-output/templates?candidateId=${encodeURIComponent(item.candidateId)}`}><span className="font-semibold">{item.templateId} · {item.version}</span><span className="ml-3 text-sm text-slate-400">{stateLabel(item.status)}</span></Link>) : <p className="text-sm text-slate-400">No saved candidates are available for this selection.</p>}</section>
    </>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {candidateId && <Button asChild variant="outline"><Link to="/panelpro-file-output/templates">Back to saved templates</Link></Button>}
  </div></main>;
}
