import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasRefusedSheets } from "./AtlasRefusedSheets";
import type { AtlasRefusal } from "@/lib/designpro-api";

const refusals: AtlasRefusal[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    topology: "six-surface",
    attempt: 2,
    code: "flat_atlas_unrepaired_cutout",
    reason: "unrepaired cutouts on rear: one wheel/glass/bed shape cut out of the panel",
    sha256: "a".repeat(64),
    byteSize: 8339320,
    contentType: "image/jpeg",
    model: "gemini-3-pro-image",
    createdAt: "2026-09-14T16:32:24Z",
    signedUrl: "https://dp-project.supabase.co/storage/v1/object/sign/wrap-files/sheet?token=one",
    expiresIn: 300,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    topology: "field",
    attempt: 1,
    code: "flat_atlas_master_output_class_invalid",
    reason: "output class vehicle_depiction (confidence 1): The image contains a side profile of a race car.",
    sha256: "b".repeat(64),
    byteSize: 11331524,
    contentType: "image/jpeg",
    model: "gemini-3-pro-image",
    createdAt: "2026-09-14T16:33:14Z",
  },
];

describe("refused ATLAS candidates on the failure screen", () => {
  it("shows every refused sheet with the gate's own verdict, signed when the owner may see it", () => {
    const html = renderToStaticMarkup(<AtlasRefusedSheets refusals={refusals} status="success" />);
    expect(html).toContain("why each sheet was refused (2)");
    expect(html).toContain('src="https://dp-project.supabase.co/storage/v1/object/sign/wrap-files/sheet?token=one"');
    expect(html).toContain("Six-surface sheet · try 2");
    expect(html).toContain("vehicle shapes cut out of the panel");
    expect(html).toContain("one wheel/glass/bed shape cut out of the panel");
    // The field candidate had no signed URL: listed with its verdict, no <img>.
    expect(html).toContain("One-field fail-over · try 1");
    expect(html).toContain("the inspector saw a vehicle, not a flat sheet");
    expect(html).toContain("side profile of a race car");
    expect(html).toContain("Image not available to sign");
    expect(html.match(/<img /g)?.length).toBe(1);
    // Storage identity never renders: the sha256 is data for the API, not the customer.
    expect(html).not.toContain("a".repeat(64));
  });

  it("names the three-zone route in product words, never as undefined", () => {
    // The runtime records a refused three-zone candidate under `panel-proof`;
    // before this label existed the strip printed "undefined · try 1".
    const html = renderToStaticMarkup(<AtlasRefusedSheets status="success" refusals={[{
      ...refusals[1], id: "50000000-0000-4000-8000-000000000003", topology: "panel-proof",
    }]} />);
    expect(html).toContain("Production panel proof · try 1");
    expect(html).not.toContain("undefined");
    expect(html).not.toMatch(/topolog/i);
  });

  it("says so when no candidate reached the gates, and renders nothing on a read error", () => {
    expect(renderToStaticMarkup(<AtlasRefusedSheets refusals={[]} status="success" />))
      .toContain("No candidate reached the acceptance gates");
    expect(renderToStaticMarkup(<AtlasRefusedSheets refusals={undefined} status="error" />)).toBe("");
    expect(renderToStaticMarkup(<AtlasRefusedSheets refusals={undefined} status="pending" />))
      .toContain("Loading the refused candidates");
  });
});
