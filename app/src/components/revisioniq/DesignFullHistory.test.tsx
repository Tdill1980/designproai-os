import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/designpro-api", () => ({ dpApi: { getDesignArchiveHistory: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));

import { DesignFullHistory } from "./DesignFullHistory";
import { archiveTimeline, designIdForGeneration } from "@/lib/design-archive";
import type { DesignArchiveHistory } from "@/lib/designpro-api";

const generationId = "aaaaaaaa-0000-4000-8000-000000000001";
const base: DesignArchiveHistory = {
  contract: "designpro.design-history.v1", audience: "customer", designId: "DID-AAAAAAAA", generationId,
  designName: "Ridgeline", companyName: "Ridgeline Roofing", status: "ready", createdAt: "2026-09-25T20:00:00Z",
  vehicle: { year: 2022, make: "Ford", model: "F-250", type: "truck" }, templateRef: null,
  orders: [{ orderNumber: "30292", source: "intake", wooOrderId: null, boundAt: "2026-09-25T20:00:01Z" }],
  versions: [{ version: 1, revisionId: "r1", requestId: "q1", parentRevisionId: null, createdAt: "2026-09-25T20:05:00Z",
    productionEligible: false, effectivePpi: null, widthPx: null, heightPx: null, promptVersion: null, masterContentHash: null }],
  prompts: [
    { kind: "revision-instruction", version: 2, surface: null, prompt: "Make the phone number larger", state: "failed", requestId: "q2", createdAt: "2026-09-25T21:00:00Z" },
    { kind: "original-brief", version: 1, surface: null, prompt: "Bold teal roofing wrap", state: "outputs_ready", requestId: "q1", createdAt: "2026-09-25T20:00:00Z" },
    { kind: "view-regeneration", version: 1, surface: "rear", prompt: "Show the tailgate logo", state: "accepted", requestId: "q1", createdAt: "2026-09-25T20:07:00Z" },
  ],
  files: [
    { source: "view", kind: "view", surface: "side", version: 1, storagePath: null, contentHash: null, byteSize: 8_000_000,
      contentType: "image/jpeg", widthPx: null, heightPx: null, createdAt: "2026-09-25T20:06:00Z", superseded: false },
    { source: "artifact", kind: "panel", surface: "hood", version: null, storagePath: null, contentHash: null, byteSize: 3_000_000,
      contentType: "image/png", widthPx: 1262, heightPx: 918, createdAt: "2026-09-25T20:10:00Z", superseded: false },
  ],
};

function render(history: DesignArchiveHistory) {
  const client = new QueryClient();
  client.setQueryData(["design-archive-history", "DID-AAAAAAAA"], history);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}><DesignFullHistory generationId={generationId} /></QueryClientProvider>,
  );
}

describe("the full design history (archive flag)", () => {
  it("derives the same DesignID the gateway and runtime mint", () => {
    expect(designIdForGeneration(generationId)).toBe("DID-AAAAAAAA");
    expect(designIdForGeneration("not-a-uuid")).toBe("");
  });

  it("merges every prompt, version, file and order in the order it happened, cause before effect", () => {
    const order = archiveTimeline(base).map((e) => e.type === "prompt" ? `prompt:${e.prompt.kind}` : e.type === "file" ? `file:${e.file.kind}` : e.type);
    expect(order).toEqual([
      "prompt:original-brief", "order", "version", "file:view", "prompt:view-regeneration", "file:panel", "prompt:revision-instruction",
    ]);
  });

  it("shows the customer every prompt (incl. a failed revision), every asset, and the order — never a master", () => {
    const html = render(base);
    for (const text of ["Bold teal roofing wrap", "Show the tailgate logo", "Make the phone number larger", "failed",
      "Driver side", "Hood panel", "1262×918px", "Order #30292", "DID-AAAAAAAA"]) expect(html).toContain(text);
    expect(html).not.toContain("QC view");
    expect(html).not.toMatch(/master [0-9a-f]{12}/);
  });

  it("gives PanelPro QC the same prompts plus the production authority", () => {
    const html = render({
      ...base, audience: "staff",
      versions: [{ ...base.versions[0], widthPx: 4096, heightPx: 4096, effectivePpi: 15.7, masterContentHash: "a".repeat(64) }],
      files: [{ ...base.files[0], source: "revision", kind: "master", surface: null, storagePath: "m/1.png" }, ...base.files],
    });
    for (const text of ["QC view", "Make the phone number larger", "4096×4096px", "15.7 PPI", "not production-eligible", "master aaaaaaaaaaaa", "m/1.png"]) {
      expect(html).toContain(text);
    }
  });
});
