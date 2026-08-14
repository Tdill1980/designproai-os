/**
 * Calls 8–12 — every production job this operator owns.
 *
 * The list is read from the gateway, which resolves it from the workflow runs
 * the server owns. Nothing here starts, advances or retries a job.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dpApi, WorkflowStatus } from "@/lib/designpro-api";
import { STAGE_LABEL } from "@/lib/designpro-stages";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading, Notice, PageHead, StatePill } from "@/components/designpro/surface";

export default function ProductionJobs() {
  const [jobs, setJobs] = useState<WorkflowStatus[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dpApi
      .listJobs()
      .then(setJobs)
      .catch(() => setError("Jobs could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="Operations"
        title="Production jobs"
        description="Every DesignProAI job, from the seven frozen source views through the verified production ZIP."
        aside={
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/designpro/generate">Generate a design</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/designpro/revisions/new">Upload seven views</Link>
            </Button>
          </div>
        }
      />

      {loading && <Loading label="Loading server status…" />}
      {error && <Notice tone="error">{error}</Notice>}

      {!loading && !error && jobs.length === 0 && (
        <EmptyState
          title="No DesignPro jobs yet"
          description="Describe a wrap and let the server generate the seven views, or upload seven you already have."
        >
          <Button asChild>
            <Link to="/designpro/generate">Generate a design</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/designpro/revisions/new">Upload seven views</Link>
          </Button>
        </EmptyState>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <Link
            key={job.generationId}
            to={`/designpro/jobs/${job.generationId}`}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition hover:border-primary/60"
          >
            <div className="flex items-start justify-between gap-2">
              <strong className="truncate text-sm">{job.designId}</strong>
              <StatePill state={job.state} />
            </div>
            <h2 className="text-base font-semibold leading-snug">
              {STAGE_LABEL[job.currentStage] || job.currentStage}
            </h2>
            <p className="text-sm text-muted-foreground">
              Order # {job.orderNumber} · Revision {job.revision}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
