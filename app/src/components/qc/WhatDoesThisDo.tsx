/**
 * WhatDoesThisDo — small (?) icon button next to a tool that opens a
 * structured popover explaining the action in plain English.
 *
 * QC Artboard has a wall of similar-looking cut/vector/proof buttons.
 * Native HTML title="..." tooltips work but are walls of text and only
 * appear on hover. This gives operators a click-to-read summary card
 * with consistent structure: WHAT · OUTPUT · USE WHEN · DON'T USE WHEN.
 *
 * Drop next to any button:
 *   <WhatDoesThisDo
 *     title="CutPath Vector"
 *     does="Pure vinyl cut-path trace on the saved artboard."
 *     output="SVG + EPS curve-fit vector paths"
 *     useWhen="Wrap is pure graphics / text / logos with NO photographs."
 *     dontUseWhen="Artboard has photo content — use Production Prep instead."
 *   />
 */
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";

interface Props {
  title: string;
  does: string;
  output?: string;
  useWhen?: string;
  dontUseWhen?: string;
  outputs?: string[];
}

export default function WhatDoesThisDo({ title, does, output, outputs, useWhen, dontUseWhen }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does ${title} do?`}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs space-y-2.5 p-4">
        <div className="font-semibold text-sm border-b border-border pb-1.5">{title}</div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">What it does</div>
          <p className="leading-snug">{does}</p>
        </div>
        {(output || (outputs && outputs.length > 0)) && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Output</div>
            {outputs && outputs.length > 0 ? (
              <ul className="leading-snug list-disc list-inside space-y-0.5">
                {outputs.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            ) : (
              <p className="leading-snug">{output}</p>
            )}
          </div>
        )}
        {useWhen && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-500 font-semibold mb-0.5">Use when</div>
            <p className="leading-snug">{useWhen}</p>
          </div>
        )}
        {dontUseWhen && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-amber-500 font-semibold mb-0.5">Don't use when</div>
            <p className="leading-snug">{dontUseWhen}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
