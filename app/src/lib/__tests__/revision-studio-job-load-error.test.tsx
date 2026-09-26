/**
 * REVISION STUDIO: A FAILED FULL-JOB READ IS NEVER SWALLOWED (owner, 2026-09-25).
 *
 * When `readRevisionStudioDesign` fails for the open design the studio shows a
 * small inline error with a Retry that refetches the job, and offers neither
 * the missing-views banner nor any Generate action while that error stands.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/designpro-api", () => ({
  dpApi: {},
  SOURCE_VIEW_TYPE_FOR_ROLE: {},
  ROLE_FOR_SOURCE_VIEW_TYPE: {},
}));
import { jobLoadErrorFor, jobLoadFailedFor, missingViewsUnlessJobLoadFailed } from "../revisionstudio-source";
import { JobLoadErrorNotice } from "@/components/revisionstudio/JobLoadErrorNotice";

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(fileURLToPath(new URL("../../pages/RevisionStudioIQ.tsx", import.meta.url)), "utf8"));

function findByTestId(node: ReactNode, id: string): ReactElement<any> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<any>;
  if (el.props?.["data-testid"] === id) return el;
  const kids = el.props?.children;
  for (const child of Array.isArray(kids) ? kids : [kids]) {
    const hit = findByTestId(child, id);
    if (hit) return hit;
  }
  return null;
}

describe("full-job load outcome", () => {
  it("a thrown read becomes a visible error for that design", () => {
    expect(jobLoadErrorFor("g1", { error: new Error("HTTP 502 from gateway") }))
      .toEqual({ id: "g1", message: "HTTP 502 from gateway" });
    expect(jobLoadErrorFor("g1", { error: undefined })?.message).toMatch(/could not be loaded/);
  });

  it("an empty read (no job for this account) is an error too; a row clears it", () => {
    expect(jobLoadErrorFor("g1", { row: null })?.id).toBe("g1");
    expect(jobLoadErrorFor("g1", { row: { id: "g1" } })).toBeNull();
  });

  it("the error applies only to the design it was raised for", () => {
    const error = { id: "g1", message: "x" };
    expect(jobLoadFailedFor(error, "g1")).toBe(true);
    expect(jobLoadFailedFor(error, "g2")).toBe(false);
    expect(jobLoadFailedFor(null, "g1")).toBe(false);
    expect(jobLoadFailedFor(error, undefined)).toBe(false);
  });

  it("no missing views are offered while the job load has failed", () => {
    expect(missingViewsUnlessJobLoadFailed(["front", "rear"], true)).toEqual([]);
    expect(missingViewsUnlessJobLoadFailed(["front", "rear"], false)).toEqual(["front", "rear"]);
  });
});

describe("inline error notice", () => {
  it("renders a small alert with the reason and a Retry button", () => {
    const html = renderToStaticMarkup(<JobLoadErrorNotice message="HTTP 502 from gateway" onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("full job");
    expect(html).toContain("HTTP 502 from gateway");
    expect(html).toMatch(/<button[^>]*data-testid="revision-studio-job-load-retry"[^>]*>[\s\S]*Retry/);
    expect(html).not.toMatch(/Missing View|Generate/);
  });

  it("Retry calls the refetch, and is disabled while a retry is in flight", () => {
    const onRetry = vi.fn();
    const button = findByTestId(JobLoadErrorNotice({ message: "x", onRetry }), "revision-studio-job-load-retry");
    expect(button).not.toBeNull();
    button!.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const busy = findByTestId(JobLoadErrorNotice({ message: "x", onRetry, retrying: true }), "revision-studio-job-load-retry");
    expect(busy!.props.disabled).toBe(true);
  });
});

describe("RevisionStudioIQ wiring", () => {
  it("records a failed hydrate read instead of swallowing it, and clears it on success", () => {
    expect(page).toMatch(/catch \(error\) \{[\s\S]{0,200}setJobLoadError\(jobLoadErrorFor\(String\(id\), \{ error \}\)\)/);
    expect(page).toContain("setJobLoadError(jobLoadErrorFor(String(id), { row: fresh }))");
  });

  it("Retry re-runs the hydrate effect immediately", () => {
    expect(page).toContain("setJobLoadAttempt((n) => n + 1)");
    expect(page).toMatch(/queryClient, jobLoadAttempt\]\);/);
    expect(page).toContain("<JobLoadErrorNotice message={jobLoadError.message} retrying={jobLoadRetrying} onRetry={retryJobLoad} />");
  });

  it("the missing-views banner, its Generate button and production counts are suppressed while failed", () => {
    expect(page).toContain("missingViewsUnlessJobLoadFailed(getMissingViews(selectedRender), jobLoadFailed)");
    expect(page).toContain("missingViewsUnlessJobLoadFailed(getMissingViews(selectedInspectionRender), jobLoadFailed)");
    expect(page).toContain("!isReadOnlyProof && !jobLoadFailed && missingViews.length > 0");
    expect(page).toMatch(/productionProofsReady = [\s\S]{0,300}&& !jobLoadFailed;/);
  });

  it("no path generates views for a design whose job did not load", () => {
    expect(page).toMatch(/const generateMissingViews = async \(render: any\) => \{\s*if \(jobLoadFailedFor\(jobLoadError, render\?\.id\)\) \{[\s\S]{0,200}return;/);
    expect(page).toContain("if (!r?.id || isGeneratingMissing || jobLoadFailed) return;");
  });
});
