import { describe, expect, it } from "vitest";
import { customerDesignIdentity, formatDid, shortGenerationId } from "./designId";

// THE ID LADDER (owner ruling): the Generation ID is minted at Call 1; the
// Design ID (`DID-` + first 8 hex of the generation id) and the Order ID are
// minted when the Production Pack is purchased. A customer surface therefore
// shows the Generation ID until a purchase exists, and never derives a DID.
const generationId = "e9babe2d-043e-4ce4-9b7f-5e93b2739b09";

describe("customer design identity", () => {
  it("is the Generation ID, and never a DID, before a purchase", () => {
    const identity = customerDesignIdentity({ generationId });
    expect(identity).toEqual({ label: "Generation ID", value: "E9BABE2D" });
    expect(JSON.stringify(identity)).not.toContain("DID-");
    expect(shortGenerationId(generationId)).toBe("E9BABE2D");
  });

  it("is the purchase-minted Design ID once one exists", () => {
    expect(customerDesignIdentity({ generationId, purchasedDesignId: "DID-E9BABE2D" }))
      .toEqual({ label: "Design ID", value: "DID-E9BABE2D" });
    // The DID a purchase mints is the same derivation the post-purchase
    // surfaces use, so the two never disagree about one design.
    expect(formatDid(generationId)).toBe("DID-E9BABE2D");
  });

  it("does not accept a value that is not a minted DID as a purchase signal", () => {
    // The generation id itself, or a blank, is not evidence of a purchase.
    expect(customerDesignIdentity({ generationId, purchasedDesignId: generationId }))
      .toEqual({ label: "Generation ID", value: "E9BABE2D" });
    expect(customerDesignIdentity({ generationId, purchasedDesignId: "" }))
      .toEqual({ label: "Generation ID", value: "E9BABE2D" });
  });

  it("has nothing to show when there is no generation yet", () => {
    expect(customerDesignIdentity({})).toBeNull();
    expect(customerDesignIdentity({ generationId: "abc" })).toBeNull();
    expect(shortGenerationId(null)).toBeNull();
  });

  it("leaves the post-purchase DID derivation intact", () => {
    expect(formatDid("8f4a2c1e-0000-4000-8000-000000000000")).toBe("DID-8F4A2C1E");
    expect(formatDid(null)).toBeNull();
  });
});
