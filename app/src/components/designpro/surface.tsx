/**
 * Shared chrome for the server-owned DesignProAI surfaces.
 *
 * These pages report state the server owns; they never orchestrate it. Every
 * piece here is deliberately presentational so a page cannot accidentally grow
 * a second source of truth for a job's state.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHead({
  eyebrow,
  title,
  description,
  backTo,
  backLabel = "Back",
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  backTo?: string;
  backLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {backTo && (
          <Link
            to={backTo}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
        )}
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 truncate text-2xl font-bold md:text-3xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

export function Panel({
  eyebrow,
  title,
  description,
  aside,
  children,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5 md:p-6", className)}>
      {(eyebrow || title || aside) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </div>
            )}
            {title && <h2 className="mt-1 text-lg font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
            )}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive-foreground",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
        tone === "info" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {tone === "error" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

const STATE_STYLES: Record<string, string> = {
  complete: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  outputs_ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  running: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  leased: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  queued: "bg-muted text-muted-foreground border-border",
  pending: "bg-muted text-muted-foreground border-border",
  retryable: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  waiting_for_preflight: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  waiting_for_final_qc: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  failed: "bg-destructive/15 text-destructive-foreground border-destructive/40",
  cancelled: "bg-destructive/15 text-destructive-foreground border-destructive/40",
};

export function StatePill({ state, className }: { state: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        STATE_STYLES[state] || STATE_STYLES.queued,
        className,
      )}
    >
      {state.split("_").join(" ")}
    </span>
  );
}

/**
 * The durable identity of every artifact in this system is its SHA-256, not a
 * storage path or a URL. Showing a truncated hash next to each file is what
 * lets an operator tell a verified production file from a look-alike.
 */
export function ContentHash({ value, chars = 16 }: { value: string; chars?: number }) {
  return (
    <code
      title={value}
      className="block truncate rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground"
    >
      SHA-256 {value.slice(0, chars)}…
    </code>
  );
}

export function SaveLink({ url, name }: { url: string; name: string }) {
  return (
    <a
      href={url}
      download={name}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-semibold text-primary hover:underline"
    >
      ↓ Save
    </a>
  );
}
