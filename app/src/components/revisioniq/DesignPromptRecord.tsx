import { useQuery } from "@tanstack/react-query";
import { dpApi, type DesignPromptRecord as PromptRecord } from "@/lib/designpro-api";
import { exactTimestamp } from "@/lib/design-version-history";
import { DESIGN_ARCHIVE_UI_ENABLED } from "@/lib/design-archive";
import { DesignFullHistory } from "@/components/revisioniq/DesignFullHistory";

export function DesignPromptRecordView({ record }: { record: PromptRecord }) {
  return (
    <section aria-label="Design prompt and version history" className="rounded-lg border border-border bg-card p-4 text-card-foreground space-y-3">
      <h3 className="text-sm font-semibold">Original prompt &amp; version history</h3>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Generation ID</dt><dd className="break-all font-mono">{record.generationId}</dd></div>
        <div><dt className="text-muted-foreground">Design ID</dt><dd className="break-all font-mono">{record.designId}</dd></div>
      </dl>
      <div className="rounded-md border border-border p-3">
        <h4 className="text-xs font-semibold">Original customer prompt · V1</h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{record.originalPrompt ?? "Original prompt was not recorded."}</p>
        <p className="mt-2 text-xs text-muted-foreground">{exactTimestamp(record.createdAt)}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">Request ID: {record.originalRequestId}</p>
      </div>
      <ol className="space-y-2" aria-label="Version history">
        {record.versions.map((version) => (
          <li key={`${version.requestId}:${version.revisionId ?? version.version}`} className="rounded-md border border-border p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>V{version.version}{version.version === 1 ? " · Original" : " · Revision"}</strong>
              <span className="text-muted-foreground">{version.state}</span>
            </div>
            {version.version > 1 && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{version.prompt ?? "Revision prompt was not recorded."}</p>}
            <p className="mt-2 text-muted-foreground">Requested: {exactTimestamp(version.createdAt)}</p>
            {version.authoredAt && <p className="text-muted-foreground">Design saved: {exactTimestamp(version.authoredAt)}</p>}
            <p className="mt-1 break-all font-mono text-muted-foreground">Request ID: {version.requestId}</p>
            {version.revisionId && <p className="break-all font-mono text-muted-foreground">Revision ID: {version.revisionId}</p>}
            {version.errorCode && <p className="mt-1 text-destructive">Error: {version.errorCode}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DesignPromptRecord({ generationId }: { generationId: string | null | undefined }) {
  // Behind the archive flag, all three surfaces that mount this record show the
  // FULL history (every version, prompt, file and order) instead, and fall back
  // to this record when the archive cannot answer.
  if (DESIGN_ARCHIVE_UI_ENABLED && generationId) {
    return <DesignFullHistory generationId={generationId} fallback={<LegacyDesignPromptRecord generationId={generationId} />} />;
  }
  return <LegacyDesignPromptRecord generationId={generationId} />;
}

function LegacyDesignPromptRecord({ generationId }: { generationId: string | null | undefined }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["design-prompt-record", generationId],
    queryFn: () => dpApi.getDesignPromptRecord(generationId!),
    enabled: Boolean(generationId),
    refetchInterval: 15_000,
  });
  if (!generationId) return null;
  if (isPending) return <p className="p-3 text-xs text-muted-foreground">Loading saved prompt and versions…</p>;
  if (isError || !data) return (
    <div role="status" className="rounded-lg border border-border p-3 text-xs">
      The saved prompt record could not be loaded. <button type="button" className="underline" onClick={() => void refetch()}>Try again</button>
    </div>
  );
  return <DesignPromptRecordView record={data} />;
}
