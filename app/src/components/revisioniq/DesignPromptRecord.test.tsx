import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/designpro-api", () => ({ dpApi: {} }));
import { DesignPromptRecordView } from "./DesignPromptRecord";

describe("the shared studio prompt record", () => {
  it("shows V1 and the exact customer prompt beside a failed revision with every identifier", () => {
    const html = renderToStaticMarkup(<DesignPromptRecordView record={{
      generationId: "generation-42", designId: "DID-42", originalRequestId: "request-1",
      originalPrompt: "  Copper Finch Coffee\nCopper linework.  ", createdAt: "2026-09-20T10:00:00Z",
      versions: [
        {version:1,requestId:"request-1",revisionId:"revision-1",prompt:"original",createdAt:"2026-09-20T10:00:00Z",authoredAt:"2026-09-20T10:01:00Z",completedAt:null,state:"outputs_ready",errorCode:null},
        {version:2,requestId:"request-2",revisionId:null,prompt:"Enlarge the leaf emblem.",createdAt:"2026-09-20T10:02:00Z",authoredAt:null,completedAt:null,state:"failed",errorCode:"provider_refused"},
      ],
    }} />);
    for (const text of ["Copper Finch Coffee\nCopper linework.","Enlarge the leaf emblem.","generation-42","DID-42","request-1","request-2","revision-1","provider_refused","2026-09-20 10:02:00Z"]) expect(html).toContain(text);
    expect(html).toContain("V1"); expect(html).toContain("V2");
  });
});
