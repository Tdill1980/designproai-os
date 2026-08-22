import { describe, expect, it } from "vitest";
import { isDesignProMarketingHost } from "./designpro-host-routing";

describe("DesignProAI host routing", () => {
  it("keeps the apex and www hosts on the selling landing page", () => {
    expect(isDesignProMarketingHost("designproai.com")).toBe(true);
    expect(isDesignProMarketingHost("www.designproai.com")).toBe(true);
    expect(isDesignProMarketingHost("DesignProAI.com.")).toBe(true);
  });

  it("does not treat the operating-system host as the marketing site", () => {
    expect(isDesignProMarketingHost("os.designproai.com")).toBe(false);
    expect(isDesignProMarketingHost("localhost")).toBe(false);
  });
});
