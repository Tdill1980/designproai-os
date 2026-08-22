import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { displayRenderRoles, RENDER_ROLES } from "./designpro-api";

const closeup = { sourceViewType: "close-up", consumerRole: "closeup" };
const hero = { sourceViewType: "hero-3d", consumerRole: "hero3d" };

describe("displayRenderRoles", () => {
  it("keeps historical Hero as the pre-migration authoring default", () => {
    expect(displayRenderRoles([])).toEqual(RENDER_ROLES);
  });

  it("displays a returned or failed Close-Up in its own slot", () => {
    expect(displayRenderRoles([closeup])).toEqual([
      "driver", "passenger", "hood", "front", "rear", "closeup", "roof",
    ]);
    expect(displayRenderRoles([{ ...closeup, reason: "provider_failed" }])).toEqual([
      "driver", "passenger", "hood", "front", "rear", "closeup", "roof",
    ]);
    expect(displayRenderRoles([], ["close-up"])).toEqual([
      "driver", "passenger", "hood", "front", "rear", "closeup", "roof",
    ]);
  });

  it("preserves a historical Hero response", () => {
    expect(displayRenderRoles([hero])).toEqual(RENDER_ROLES);
  });

  it("never relabels a mismatched seventh-slot identity", () => {
    expect(displayRenderRoles([
      { sourceViewType: "hero-3d", consumerRole: "closeup" },
    ])).toEqual(RENDER_ROLES);
  });

  it("exposes both conflicting identities rather than hiding either one", () => {
    expect(displayRenderRoles([closeup, hero])).toEqual([
      "driver", "passenger", "hood", "front", "rear", "closeup", "roof", "hero3d",
    ]);
  });
});
