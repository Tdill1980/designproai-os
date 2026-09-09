import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import { PanelOutputAccessView } from "./RequirePanelOutputReviewer";
const render = (state: "loading" | "allowed" | "denied" | "unavailable") => renderToStaticMarkup(<StaticRouter location="/panelpro-file-output/templates"><PanelOutputAccessView state={state}><div>Measured template approval form</div></PanelOutputAccessView></StaticRouter>);
describe("new output app pages use existing production permissions", () => {
  it("shows the internal form only after the server confirms review access", () => {
    expect(render("allowed")).toContain("Measured template approval form");
    for (const state of ["loading", "denied", "unavailable"] as const) expect(render(state)).not.toContain("Measured template approval form");
  });
  it("distinguishes denied access from a retryable connection failure", () => {
    expect(render("denied")).toContain("does not have the production preflight permission");
    expect(render("unavailable")).toContain("Check access again");
    expect(render("unavailable")).not.toContain("does not have");
  });
});
