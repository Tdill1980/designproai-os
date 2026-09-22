import { useQuery } from "@tanstack/react-query";
import type { AtlasRefusal } from "@/lib/designpro-api";

const TOPOLOGY_LABEL: Record<AtlasRefusal["topology"], string> = {
  "six-surface": "Six-surface sheet",
  field: "One-field fail-over",
  "hero-driver": "Hero-driver cascade",
};

const CODE_LABEL: Record<string, string> = {
  flat_atlas_unrepaired_cutout: "Refused: vehicle shapes cut out of the panel",
  flat_atlas_master_deterministic_failed: "Refused: the design does not fill its panels",
  flat_atlas_master_output_class_invalid: "Refused: the inspector saw a vehicle, not a flat sheet",
};

function codeLabel(code: string): string {
  return CODE_LABEL[code] || `Refused: ${code.replace(/^flat_atlas_/, "").replace(/_/g, " ")}`;
}

/**
 * What the model actually drew, and why each candidate was refused. The
 * verdict text is the gate's own reason, verbatim: the point of this strip is
 * that a human can now compare the reason against the pixels and say whether
 * the gate was right.
 */
export function AtlasRefusedSheets({ refusals, status }: { refusals: AtlasRefusal[] | undefined; status: "pending" | "error" | "success" }) {
  if (status === "pending") {
    return <p className="text-xs text-gray-500 text-center">Loading the refused candidates…</p>;
  }
  if (status === "error" || !refusals) return null;
  if (refusals.length === 0) {
    return <p className="text-xs text-gray-500 text-center max-w-md">No candidate reached the acceptance gates on this run.</p>;
  }
  return (
    <section aria-label="Refused Call 1 candidates" className="mt-2 w-full max-w-4xl">
      <p className="text-sm text-gray-300 text-center mb-3">
        What the model drew on this run, and why each sheet was refused ({refusals.length})
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {refusals.map((refusal) => (
          <li key={refusal.id} className="rounded-lg border border-white/10 bg-black/40 p-3 flex flex-col gap-2">
            {refusal.signedUrl ? (
              <a href={refusal.signedUrl} target="_blank" rel="noreferrer" className="block">
                <img
                  src={refusal.signedUrl}
                  alt={`${TOPOLOGY_LABEL[refusal.topology]} — try ${refusal.attempt}`}
                  className="w-full max-h-64 object-contain bg-white/5 rounded"
                  loading="lazy"
                />
              </a>
            ) : (
              <div className="w-full h-24 flex items-center justify-center rounded bg-white/5 text-xs text-gray-500">
                Image not available to sign
              </div>
            )}
            <p className="text-xs text-gray-400">
              {TOPOLOGY_LABEL[refusal.topology]} · try {refusal.attempt}
              {refusal.model ? ` · ${refusal.model}` : ""}
            </p>
            <p className="text-xs font-semibold text-red-300">{codeLabel(refusal.code)}</p>
            <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{refusal.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AtlasRefusedSheetsLoader({ requestId }: { requestId: string }) {
  const query = useQuery({
    queryKey: ["designpro-atlas-refusals", requestId],
    // Loaded on demand: the API module builds the Supabase client at import
    // time, and this strip must stay mountable (and testable) without it.
    queryFn: async () => (await import("@/lib/designpro-api")).dpApi.listAtlasRefusals(requestId),
    staleTime: 60_000,
    retry: false,
  });
  return <AtlasRefusedSheets refusals={query.data} status={query.status} />;
}
