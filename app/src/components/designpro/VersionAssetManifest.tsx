/**
 * EVERY FILE THIS VERSION PRODUCED, WITH ITS RECORD, INDIVIDUALLY DOWNLOADABLE.
 *
 * RULE 0.22 lists the complete asset set the design team must be able to take
 * off this board -- "each individually downloadable", and "do not hide files
 * behind only a final ZIP". The board already downloaded the master, the logos,
 * the per-surface print files and the stamp/ZIP. Three things it did not:
 *
 *   - the six Call-1 PANELS as files, with the dimensions that make them
 *     checkable (trim, print, bleed, square feet, effective PPI);
 *   - the seven 3D PROOFS, which were display-only;
 *   - the 2D Production Proof.
 *
 * A designer validating a panel against a real vehicle template needs the file
 * and the numbers together, so each row carries its own metadata rather than
 * making someone match a thumbnail to a table somewhere else.
 *
 * It binds to the SELECTED version, not the newest, because the same rule
 * requires V1/V2/V3 to stay inspectable and forbids silently replacing V1 when
 * V2 is created. Every row states the master it descends from, so a file taken
 * off this card can always be traced back to the sheet it was cut from.
 *
 * NOTHING HERE IS SYNTHESIZED. Every URL is a signed URL the server already
 * returned for an artifact it persisted; a missing artifact is reported missing
 * (RULE 0.27 §3: "neither UI may synthesize its own representation of a missing
 * canonical artifact").
 */
import { Download } from "lucide-react";
import type { FlatAtlasRevision } from "@/lib/designpro-api";
import type { PanelProStudioJob } from "@/lib/panelpro-studio-source";

/**
 * Supabase Storage honours `?download=<filename>` (Content-Disposition
 * attachment). The bare `download` attribute is IGNORED cross-origin, so
 * without this a click opens the file in a tab or saves it under its hash.
 */
function withDownloadName(url: string, name: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}

const shortHash = (hash?: string | null) => (hash ? String(hash).slice(0, 16) : "—");

function bytesLabel(byteSize?: number | null): string {
  const size = Number(byteSize);
  if (!Number.isFinite(size) || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetRow({
  label, detail, hash, meta, href, filename,
}: {
  label: string;
  detail: string;
  hash?: string | null;
  meta?: string;
  href?: string | null;
  filename: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-gray-900">{label}</div>
        <div className="truncate text-[10px] text-gray-500" title={detail}>{detail}</div>
        {meta && <div className="truncate text-[10px] text-gray-400" title={meta}>{meta}</div>}
        <div className="font-mono text-[10px] text-gray-400">{shortHash(hash)}</div>
      </div>
      {href ? (
        <a
          href={withDownloadName(href, filename)}
          download
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"
          title={`Download ${filename}`}
        >
          <Download className="h-3 w-3" /> Download
        </a>
      ) : (
        // Reported missing, never invented. A row with no file says so.
        <span className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-400">
          not produced yet
        </span>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{title}</span>
        <span className="text-[10px] font-medium text-gray-400">{count}</span>
      </div>
      {children}
    </div>
  );
}

/** The seven cameras, in their frozen display order, with the label a person reads. */
const PROOF_LABELS: Array<[string, string]> = [
  ["side", "Driver"],
  ["passenger-side", "Passenger"],
  ["hood_detail", "Hood"],
  ["front", "Front"],
  ["rear", "Rear"],
  ["close-up", "Close-Up"],
  ["roof", "Roof"],
];

export function VersionAssetManifest({
  job, atlas,
}: {
  job: PanelProStudioJob;
  atlas: FlatAtlasRevision | null;
}) {
  const version = atlas ? `v${atlas.revisionSequence}` : "v?";
  const order = job.order_number || job.design_id || job.generation_id;
  const slug = String(order).replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();

  const panels = [...(atlas?.callOnePanels || [])]
    .sort((left, right) => String(left.surfaceKey).localeCompare(String(right.surfaceKey)));
  const viewByCamera = new Map(
    (job.raw_views || []).map((view) => [String(view.sourceViewType), view]),
  );
  const productionProof = job.concept_json?.flat_proof_url || "";

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
          Design assets · {version}
        </span>
        <span className="text-[10px] text-gray-400">
          {atlas ? `master ${shortHash(atlas.master?.contentHash)}` : "no accepted master"}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-gray-500">
        Every file this version produced, each downloadable on its own. A row with no file
        says so rather than showing a substitute.
      </p>

      <Section title="Master sheet" count={atlas ? "1" : "0"}>
        <AssetRow
          label="Flattened master"
          detail={atlas?.master
            ? `${atlas.master.widthPx}×${atlas.master.heightPx} px · ${atlas.master.effectivePpi} PPI · ${bytesLabel(atlas.master.byteSize)}`
            : "Call 1 has not produced an accepted master yet"}
          hash={atlas?.master?.contentHash}
          meta={atlas ? `${atlas.model} · ${atlas.promptVersion}` : undefined}
          href={atlas?.masterUrl}
          filename={`atlas-master-${version}-${shortHash(atlas?.master?.contentHash)}.png`}
        />
        <AssetRow
          label="Authoring guide"
          detail={atlas?.guide
            ? `${atlas.guide.widthPx}×${atlas.guide.heightPx} px · the labeled containers the design was painted into`
            : "no guide on this revision"}
          hash={atlas?.guide?.contentHash}
          href={atlas?.guideUrl}
          filename={`atlas-guide-${version}-${shortHash(atlas?.guide?.contentHash)}.png`}
        />
      </Section>

      <Section title="Print panels · GENIE dimensions + 5″ bleed" count={`${panels.length}/6`}>
        {panels.length === 0 && (
          <div className="py-2 text-[10px] text-gray-400">
            No panels cut from this master yet.
          </div>
        )}
        {panels.map((panel) => (
          <AssetRow
            key={panel.surfaceKey}
            label={String(panel.surfaceKey)}
            detail={`${panel.trimWidthIn}″ × ${panel.trimHeightIn}″ trim · ${panel.printWidthIn}″ × ${panel.printHeightIn}″ print · ${panel.bleedInches}″ bleed`}
            meta={`${panel.pixelWidth}×${panel.pixelHeight} px · ${panel.effectivePpi} PPI · ${panel.surfaceSqFt} sq ft · ${bytesLabel(panel.byteSize)} · from master ${shortHash(panel.sourceMasterHash)}`}
            hash={panel.contentHash}
            href={panel.signedUrl}
            filename={`${slug}_${panel.surfaceKey}_${version}_${Math.round(Number(panel.printWidthIn))}x${Math.round(Number(panel.printHeightIn))}in.png`}
          />
        ))}
      </Section>

      <Section title="3D proofs" count={`${viewByCamera.size}/7`}>
        {PROOF_LABELS.map(([camera, label]) => {
          const view = viewByCamera.get(camera);
          const binding = view?.atlasBinding;
          return (
            <AssetRow
              key={camera}
              label={label}
              detail={view
                ? `camera ${camera} · ${bytesLabel(view.byteSize)}`
                : `camera ${camera} — not rendered yet`}
              meta={binding
                ? `artwork authority: ${binding.zoneSurfaceKey || "—"} panel ${shortHash(binding.zoneContentHash)}${binding.deterministicMirror ? " · deterministic mirror" : ""}`
                : undefined}
              hash={view?.contentHash}
              href={view?.signedUrl}
              filename={`${slug}_proof_${label.toLowerCase()}_${version}.png`}
            />
          );
        })}
      </Section>

      <Section title="2D Production Proof" count={productionProof ? "1" : "0"}>
        <AssetRow
          label="Production proof"
          detail={productionProof
            ? "The dimensioned sheet the customer approves"
            : "Call 8 has not produced it for this version"}
          href={productionProof || null}
          filename={`${slug}_production-proof_${version}.png`}
        />
      </Section>
    </div>
  );
}

export default VersionAssetManifest;
