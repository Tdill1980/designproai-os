/**
 * GENIE universal panelizer — exact geometry validation.
 *
 * A production job stalls here rather than guessing a vehicle's dimensions.
 * Only grounded six-surface measurements, attested by a human, release the
 * automatic 2D proof and panel build.
 */
import { FormEvent, Fragment, useEffect, useState } from "react";
import {
  ApiError,
  dpApi,
  GenieCandidate,
  GenieValidatedSurfaces,
  PRODUCTION_SURFACES,
  SURFACE_LABEL,
} from "@/lib/designpro-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Loading, Notice, PageHead, Panel } from "@/components/designpro/surface";

function CandidateForm({
  candidate,
  onValidated,
}: {
  candidate: GenieCandidate;
  onValidated: (id: string) => void;
}) {
  const [evidence, setEvidence] = useState({
    sourceReviewed: false,
    sourceUrlsReviewed: false,
    operatorAttestation: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const complete =
    evidence.sourceReviewed && evidence.sourceUrlsReviewed && evidence.operatorAttestation;

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const surfaces = {} as GenieValidatedSurfaces;
    for (const key of PRODUCTION_SURFACES) {
      surfaces[key] = {
        widthInches: Number(form.get(`${key}.widthInches`)),
        heightInches: Number(form.get(`${key}.heightInches`)),
      };
    }
    try {
      await dpApi.validateGenieCandidate(
        candidate.id,
        surfaces,
        { sourceReviewed: true, sourceUrlsReviewed: true, operatorAttestation: true },
        String(form.get("notes") || "").trim(),
      );
      onValidated(candidate.id);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `GENIE validation failed (${cause.code}).`
          : "GENIE validation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={validate}>
      <Panel
        eyebrow="Pending exact geometry"
        title={`${candidate.year || "Year pending"} ${candidate.make} ${candidate.model}`}
        description={candidate.subType || candidate.vehicleClass || "Vehicle"}
        aside={
          candidate.confidence != null ? (
            <Badge variant="secondary">Candidate {Math.round(candidate.confidence * 100)}%</Badge>
          ) : undefined
        }
      >
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <strong className="block text-xs uppercase tracking-wide text-muted-foreground">
            Candidate source: {candidate.source}
          </strong>
          {candidate.sourceUrls.length ? (
            <div className="mt-2 flex flex-wrap gap-3">
              {candidate.sourceUrls.map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Open source {index + 1} ↗
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No source URL supplied; verify against an independent authoritative source.
            </p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {[
              ["Overall length", candidate.overallDimensions.lengthInches],
              ["Overall width", candidate.overallDimensions.widthInches],
              ["Overall height", candidate.overallDimensions.heightInches],
              ["Wheelbase", candidate.overallDimensions.wheelbaseInches],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded border border-border/70 bg-background/70 px-3 py-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <strong>{typeof value === "number" ? `${value}\u2033` : "Not grounded"}</strong>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            GENIE uses these Google-grounded OEM dimensions, including wheelbase, to calculate and store the provisional six-panel A.T.L.A.S. layout with 5-inch bleed. Exact production fields below still require operator validation.
          </p>
        </div>

        {candidate.requestedRuns.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Waiting jobs: {candidate.requestedRuns.map((run) => run.generationId || run.runId).join(", ")}
          </p>
        )}

        <div className="mt-6 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Surface
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Exact width (in)
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Exact height (in)
          </div>
          {PRODUCTION_SURFACES.map((key) => (
            <Fragment key={key}>
              <strong className="text-sm">{SURFACE_LABEL[key]}</strong>
              <Input
                className="w-28"
                name={`${key}.widthInches`}
                type="number"
                min="1"
                max="1000"
                step="0.01"
                required
              />
              <Input
                className="w-28"
                name={`${key}.heightInches`}
                type="number"
                min="1"
                max="1000"
                step="0.01"
                required
              />
            </Fragment>
          ))}
        </div>

        <Textarea
          className="mt-6"
          name="notes"
          rows={3}
          minLength={10}
          maxLength={2000}
          required
          placeholder="Validation notes and measurement provenance — the template, OEM reference or measurement sheet used."
        />

        <div className="mt-4 space-y-3">
          {(
            [
              ["sourceReviewed", "I reviewed the candidate's source and vehicle identity."],
              [
                "sourceUrlsReviewed",
                "I checked the linked evidence or an independent authoritative source.",
              ],
              [
                "operatorAttestation",
                "I attest that all six width/height pairs are exact production measurements.",
              ],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={evidence[key]}
                onCheckedChange={(value) =>
                  setEvidence((current) => ({ ...current, [key]: value === true }))
                }
              />
              <span className="leading-6">{label}</span>
            </label>
          ))}
        </div>

        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <Button className="mt-5" type="submit" disabled={!complete || busy}>
          {busy ? "Recording exact geometry…" : "Validate GENIE geometry and resume jobs"}
        </Button>
      </Panel>
    </form>
  );
}

export default function GenieQc() {
  const [candidates, setCandidates] = useState<GenieCandidate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dpApi
      .listGenieCandidates()
      .then(setCandidates)
      .catch((cause) =>
        setError(
          cause instanceof ApiError && cause.status === 403
            ? "Your account is not authorized for GENIE validation."
            : "Pending GENIE candidates could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="GENIE universal panelizer"
        title="Exact geometry validation"
        description="Only grounded six-surface dimensions can release the automatic 2D proof and panel build."
        backTo="/designpro/jobs"
        backLabel="Production jobs"
        aside={<Badge variant="secondary">Human authority</Badge>}
      />
      {loading && <Loading label="Loading pending candidates…" />}
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && !error && candidates.length === 0 && (
        <EmptyState
          title="No candidates need validation"
          description="GENIE has no production jobs waiting for exact vehicle geometry."
        />
      )}
      {candidates.map((candidate) => (
        <CandidateForm
          key={candidate.id}
          candidate={candidate}
          onValidated={(id) => setCandidates((current) => current.filter((item) => item.id !== id))}
        />
      ))}
    </div>
  );
}
