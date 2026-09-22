import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortGenerationId } from "@/lib/designId";
import { toUuidOrNull } from "@/lib/utils";
import {
  ATLAS_UNCONFIRMED_OUTCOME_CODE,
  ATLAS_UNCONFIRMED_OUTCOME_MESSAGE,
  GENERATION_ACTIVE_LIMIT_CODE,
  GENERATION_ACTIVE_LIMIT_MESSAGE,
  customerFacingGenerationMessage,
  isUnconfirmedProviderOutcome,
} from "@/lib/designpro-generation-error";

import { AtlasRefusedSheetsLoader } from "./AtlasRefusedSheets";
import { PROOF_BRAND } from "@/lib/os-brand";

type Props = {
  isAtlas: boolean;
  error: string | null;
  errorCode: string | null;
  generationId?: string | null;
  /** The failed request: when known, the refused Call-1 candidates are shown under the retry. */
  requestId?: string | null;
  onStartNew: () => void;
  onReturnToBrief?: () => void;
};

/** Only navigation is available when a paid image request has an unknown outcome. */
export function DesignGenerationFailure({ isAtlas, error, errorCode, generationId, requestId, onStartNew, onReturnToBrief }: Props) {
  const waitingForCapacity = errorCode === GENERATION_ACTIVE_LIMIT_CODE || error === GENERATION_ACTIVE_LIMIT_CODE;
  const unconfirmed = isAtlas && isUnconfirmedProviderOutcome(errorCode);
  const savedGenerationId = toUuidOrNull(generationId);
  const refusalRequestId = isAtlas && !unconfirmed ? toUuidOrNull(requestId) : null;
  return (
    <div role="alert" className="absolute inset-0 flex flex-col overflow-y-auto bg-gradient-to-br from-red-500/5 via-background to-red-500/10 p-6">
      <div className="my-auto flex shrink-0 flex-col items-center gap-4">
        <img src="/characters/ace-v2.png" alt="ACE" className="w-20 h-20 rounded-full border-2 border-red-400/50 object-cover" />
        {/* ⛔ `isAtlas` NO LONGER DRIVES CUSTOMER COPY. Owner, 2026-09-21:
            "It should never say this ever." The customer's Call 1 is the
            Production Panel Proof; ATLAS is internal vocabulary for panel
            assembly and has no place on this screen. `isAtlas` still selects
            the refused-candidate loader below, which is diagnostics. */}
        <p className="text-white text-base font-semibold text-center">
          {waitingForCapacity ? "Another design is still generating" : `Your ${PROOF_BRAND.full} didn't finish.`}
        </p>
        {(error || unconfirmed) && (
          <p className="text-sm text-red-300 text-center max-w-md">
            {/* Never the raw `error`: that is how
                `flat_atlas_edge_topology_contract_mismatch` reached a customer. */}
            {waitingForCapacity ? GENERATION_ACTIVE_LIMIT_MESSAGE : unconfirmed && (!error || isUnconfirmedProviderOutcome(error))
              ? ATLAS_UNCONFIRMED_OUTCOME_MESSAGE : customerFacingGenerationMessage(errorCode, error)}
          </p>
        )}
        {waitingForCapacity ? (
          <>
            {onReturnToBrief && <Button onClick={onReturnToBrief} size="sm">Return to your brief</Button>}
            <Link className="text-sm text-cyan-300 underline underline-offset-4" to="/revision-studio">View your designs</Link>
          </>
        ) : unconfirmed ? (
          <>
            <p className="text-sm text-gray-400 text-center max-w-md">
              Opening the saved record does not start another generation.
            </p>
            {savedGenerationId && (
              <>
                {/* A failed generation was never purchased, so it has no Design ID
                    yet — only the Generation ID minted at Call 1 (the ID ladder). */}
                <p className="text-xs text-gray-300 font-mono">Generation ID {shortGenerationId(savedGenerationId)}</p>
                <Button asChild size="sm" className="bg-gradient-to-r from-cyan-500 to-purple-500 text-white">
                  <Link to={`/designpro/studio-board?order=${savedGenerationId}`}>Open saved record</Link>
                </Button>
              </>
            )}
            <Link className="text-sm text-cyan-300 underline underline-offset-4" to={savedGenerationId
              ? `/revision-studio?generationId=${savedGenerationId}` : "/revision-studio"}>
              Open RevisionStudioIQ
            </Link>
            <p className="text-xs text-gray-500">Reference: {ATLAS_UNCONFIRMED_OUTCOME_CODE}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-400 text-center">Let&apos;s try that again.</p>
            <Button onClick={onStartNew} size="sm" className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white gap-2">
              <RefreshCw className="w-4 h-4" />
              {isAtlas ? "Start a new design" : "Relaunch"}
            </Button>
            {refusalRequestId && <AtlasRefusedSheetsLoader requestId={refusalRequestId} />}
          </>
        )}
      </div>
    </div>
  );
}
