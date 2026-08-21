import { describe, expect, it } from "vitest";
import { classifyDesignIqCombinedContact } from "@/lib/designpro-input-normalization";

describe("classifyDesignIqCombinedContact", () => {
  it("keeps phone numbers in the phone field", () => {
    expect(classifyDesignIqCombinedContact("  (480) 555-0182  ")).toEqual({
      phone: "(480) 555-0182",
    });
  });

  it.each([
    "https://example.com/quote",
    "www.example.com",
    "example.com/contact",
  ])("puts %s in the website field", (website) => {
    expect(classifyDesignIqCombinedContact(`  ${website}  `)).toEqual({ website });
  });

  it("omits an empty combined contact", () => {
    expect(classifyDesignIqCombinedContact("   ")).toEqual({});
  });
});
