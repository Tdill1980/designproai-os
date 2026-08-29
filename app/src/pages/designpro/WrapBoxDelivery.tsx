/**
 * WrapBox — private delivery of completed customer production packs.
 *
 * A pack appears here only after final QC, stamp and ZIP verification. The
 * download links are five-minute signed URLs minted for this session; the ZIP
 * and manifest hashes are the durable identity and are shown next to them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { dpApi, WrapboxPack } from "@/lib/designpro-api";
import { JobWorkflowHeader } from "@/components/designpro/JobWorkflowHeader";
import { useDesignProJob } from "@/hooks/useDesignProJob";
import { Button } from "@/components/ui/button";
import {
  ContentHash,
  EmptyState,
  Loading,
  Notice,
  PageHead,
  Panel,
  StatePill,
} from "@/components/designpro/surface";

export function WrapBoxList() {
  const [packs, setPacks] = useState<WrapboxPack[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // ARRIVING FROM QC, THE JOB COMES WITH YOU. (Trish 2026-08-29.)
  //
  // `?job=<generationId>` is how the QC pass hands this page its identity, so
  // the owner is not dropped into an undifferentiated list to find their own
  // pack by eye. A pack carries `designId` but no generationId, and designId is
  // derived canonically from the generation -- so it is the correct join, and
  // it needs no server change.
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const job = useDesignProJob(jobId);

  useEffect(() => {
    dpApi
      .listWrapbox()
      .then(setPacks)
      .catch(() => setError("WrapBox packs could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const jobPack = useMemo(
    () => (job.designId ? packs.find((pack) => pack.designId === job.designId) || null : null),
    [packs, job.designId],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      {jobId && (
        <JobWorkflowHeader
          generationId={jobId}
          current="wrapbox"
          qcPassed
          className="-mx-4 -mt-8 mb-2 md:-mx-6"
        />
      )}
      <PageHead
        eyebrow="Private delivery"
        title="WrapBox"
        description="Completed customer production packs with immutable ZIP and manifest hashes."
        backTo="/designpro/jobs"
        backLabel="Production jobs"
      />
      {/* THIS JOB, FIRST AND BY NAME -- and honest when its pack does not exist
          yet. A delivered pack is built after the PAID production run reaches
          final QC, stamp and ZIP verification, so a free design legitimately has
          none. Saying that is the whole point; inventing a preview would be the
          entitlement gate leaking. */}
      {jobId && !loading && (
        jobPack ? (
          <Panel eyebrow="This job" title={job.designId || "Production pack"}>
            <Link
              to={`/designpro/wrapbox/${jobPack.id}`}
              className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-card p-4 transition hover:border-primary"
            >
              <strong className="text-sm">{jobPack.designName}</strong>
              <span className="text-sm text-muted-foreground">
                Order # {jobPack.orderNumber} · {new Date(jobPack.readyAt).toLocaleString()}
              </span>
              <ContentHash value={jobPack.zip.contentHash} chars={12} />
            </Link>
          </Panel>
        ) : (
          <Panel eyebrow="This job" title={job.designId || "This design"}>
            <p className="text-sm text-muted-foreground">
              No delivered pack yet for this design. The panels and proofs are inspectable in{" "}
              <Link className="underline" to={`/designpro/jobs/${encodeURIComponent(jobId)}/panelpro/surfaces`}>
                PanelPro Studio
              </Link>
              . A WrapBox pack is published after the ordered production run passes final QC,
              stamping and ZIP verification.
            </p>
          </Panel>
        )
      )}
      {loading && <Loading label="Loading delivered packs…" />}
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && !error && packs.length === 0 && (
        <EmptyState
          title="No delivered packs yet"
          description="The automatic pipeline publishes packs here only after final QC, stamp and ZIP verification."
        />
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <Link
            key={pack.id}
            to={`/designpro/wrapbox/${pack.id}`}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition hover:border-primary/60"
          >
            <div className="flex items-start justify-between gap-2">
              <strong className="truncate text-sm">{pack.designId}</strong>
              <StatePill state="ready" />
            </div>
            <h2 className="text-base font-semibold leading-snug">{pack.designName}</h2>
            <p className="text-sm text-muted-foreground">
              Order # {pack.orderNumber} · {new Date(pack.readyAt).toLocaleString()}
            </p>
            <ContentHash value={pack.zip.contentHash} chars={12} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function WrapBoxPackDetail() {
  const { packId = "" } = useParams();
  const [pack, setPack] = useState<WrapboxPack>();
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      dpApi
        .getWrapboxPack(packId)
        .then((value) => {
          setPack(value);
          setError("");
        })
        .catch(() =>
          setError("This WrapBox pack is unavailable or you are not authorized to view it."),
        ),
    [packId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!pack) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <Loading label="Minting five-minute download links…" />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="Exact verified delivery"
        title={pack.designId}
        description={`${pack.designName} · Order # ${pack.orderNumber} · Delivered ${new Date(pack.readyAt).toLocaleString()}`}
        backTo="/designpro/wrapbox"
        backLabel="WrapBox"
        aside={
          <Button variant="outline" onClick={load}>
            Refresh five-minute links
          </Button>
        }
      />

      <Panel eyebrow="Production ZIP" title={`Order # ${pack.orderNumber}`}>
        <ContentHash value={pack.zip.contentHash} chars={64} />
        <p className="mt-2 text-sm text-muted-foreground">
          {pack.zip.byteSize.toLocaleString()} bytes
        </p>
        {pack.zip.signedUrl && (
          <Button className="mt-4" asChild>
            <a href={pack.zip.signedUrl}>Download production ZIP</a>
          </Button>
        )}
      </Panel>

      <Panel eyebrow="Manifest" title="Exact pack manifest">
        <ContentHash value={pack.manifest.contentHash} chars={64} />
        <p className="mt-2 text-sm text-muted-foreground">
          {pack.manifest.byteSize.toLocaleString()} bytes
        </p>
        {pack.manifest.signedUrl && (
          <Button className="mt-4" variant="outline" asChild>
            <a href={pack.manifest.signedUrl}>Open exact manifest</a>
          </Button>
        )}
      </Panel>

      {pack.logoInventory.length > 0 && (
        <Panel
          eyebrow="Call 10 · Logo inventory"
          title={`${pack.logoInventory.length} frozen placements`}
          description="The exact logo set this pack was verified against."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pack.logoInventory.map((logo, index) => (
              <div key={index} className="rounded-lg border border-border bg-background p-3 text-sm">
                <strong className="block truncate">
                  {String(logo.displayName || logo.identityKey || `Logo ${index + 1}`)}
                </strong>
                {logo.surfaceKey != null && (
                  <span className="text-xs text-muted-foreground">{String(logo.surfaceKey)}</span>
                )}
                {typeof logo.contentHash === "string" && (
                  <div className="mt-2">
                    <ContentHash value={logo.contentHash} chars={12} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
