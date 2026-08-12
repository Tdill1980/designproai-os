/**
 * AdminNarrativeArcs — /admin/narrative-arcs
 *
 * The page that mounts `NarrativeArcBoard`. Deliberately its own route rather
 * than another tab bolted onto Marketing Hub: an arc is reviewed in one sitting,
 * beat by beat against its footage, and that does not fit beside a dozen other
 * cards competing for the same screen.
 *
 * Reachable from the Admin Dashboard (Marketing Hub / Engine Room group) — a
 * screen nobody can navigate to is a screen nobody uses, which is how four
 * finished modules in this codebase ended up with no callers.
 */

import { useState } from "react";
import NarrativeArcBoard from "@/components/admin/NarrativeArcBoard";
import { cn } from "@/lib/utils";

/**
 * The brands that have both a narrative and footage. `all` is the honest
 * default — brand tags on `media_sources` are hand-entered and 133 of 375 video
 * clips carry none, so filtering by default would hide most of the library.
 */
const BRANDS = ["all", "restylepro", "weprintwraps", "wraptvworld", "designproai", "inkandedge"];

export default function AdminNarrativeArcs() {
  const [brand, setBrand] = useState("all");

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                b === brand
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
              )}
            >
              {b}
            </button>
          ))}
        </div>
        <NarrativeArcBoard brand={brand} />
      </div>
    </div>
  );
}
