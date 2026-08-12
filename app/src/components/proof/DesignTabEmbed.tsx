/**
 * DesignTabEmbed — the "Design" tab inside the ApprovePro workbench.
 *
 * Goal (per WPW): design a WePrintWraps job WITHOUT leaving the approval
 * workbench. The branded 2D proof comes FIRST, the DesignPro tool second.
 * The main DesignPro tool is untouched — we just frame it here.
 *
 * Why the iframes used to "shake": the embedded app booted its own
 * DeployVersionWatcher, which reloaded the frame on a timer / on focus,
 * yanking the tool out from under the designer. That watcher now no-ops
 * inside an iframe (see DeployVersionWatcher.tsx), and the inner Radix tabs
 * keep only ONE iframe mounted at a time, so nothing re-mounts on a click.
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ExternalLink } from "lucide-react";

export function DesignTabEmbed({ proofId }: { proofId: string }) {
  // Defer mounting the heavy DesignPro iframe until the designer asks for it,
  // so opening the Design tab only ever loads the lightweight proof sheet.
  const [toolLoaded, setToolLoaded] = useState(false);

  const proofSrc = `/wpw-proof/${proofId}?embed=1`;
  const designSrc = `/designpro?embed=1`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-700">
          Build the branded 2D proof first, then design in DesignPro. The main
          DesignPro tool is unchanged.
        </p>
        <div className="flex gap-2">
          <a
            href={`/wpw-proof/${proofId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-9 px-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Proof full screen
          </a>
          <a
            href="/designpro"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-9 px-3 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" /> DesignPro full screen
          </a>
        </div>
      </div>

      {/* 2D branded proof FIRST, design tool second. Only the active tab's
          iframe is mounted (Radix unmounts inactive TabsContent), so clicking
          between them never double-loads the app. */}
      <Tabs defaultValue="proof" onValueChange={(v) => v === "tool" && setToolLoaded(true)}>
        <TabsList className="grid w-full grid-cols-2 bg-gray-100">
          <TabsTrigger
            value="proof"
            className="data-[state=active]:bg-white data-[state=active]:text-gray-900 font-semibold text-[11px] sm:text-sm"
          >
            2D Proof (branded)
          </TabsTrigger>
          <TabsTrigger
            value="tool"
            className="data-[state=active]:bg-white data-[state=active]:text-gray-900 font-semibold text-[11px] sm:text-sm"
          >
            Design tool
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proof" className="mt-3 focus-visible:outline-none">
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
            <iframe
              title="WePrintWraps 2D Proof"
              src={proofSrc}
              className="w-full bg-white"
              style={{ height: "70vh", border: "0" }}
            />
          </div>
        </TabsContent>

        <TabsContent value="tool" className="mt-3 focus-visible:outline-none">
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {toolLoaded ? (
              <iframe
                title="DesignPro"
                src={designSrc}
                className="w-full bg-white"
                style={{ height: "75vh", border: "0" }}
              />
            ) : (
              <div className="h-[75vh] flex items-center justify-center text-sm text-gray-500">
                Loading DesignPro…
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
