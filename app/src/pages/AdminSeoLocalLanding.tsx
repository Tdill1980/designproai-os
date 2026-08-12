import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  MapPin,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface ResultRow {
  id?: string;
  title: string;
  slug: string;
  city: string;
  vehicle_type: string | null;
  word_count: number;
  error?: string;
}

interface BatchResponse {
  generated: number;
  failed: number;
  results: ResultRow[];
}

const CHUNK = 10; // generate 10 combos per edge call (function caps at 25)

function parseLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function AdminSeoLocalLanding() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();

  const [service, setService] = useState("Vehicle Wraps");
  const [citiesText, setCitiesText] = useState("");
  const [vehiclesText, setVehiclesText] = useState("");
  const [tone, setTone] = useState("expert, no-fluff, locally rooted");
  const [minWords, setMinWords] = useState(700);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const cities = useMemo(() => parseLines(citiesText), [citiesText]);
  const vehicles = useMemo(() => parseLines(vehiclesText), [vehiclesText]);

  const totalCombos = cities.length * Math.max(vehicles.length, 1);

  const run = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      if (!service.trim()) throw new Error("Service is required");
      if (cities.length === 0) throw new Error("Add at least one city");

      // Build combo plan, then chunk so each edge call stays under the
      // server-side cap of 25.
      type Combo = { vehicle_type: string | null; city: string };
      const combos: Combo[] = [];
      if (vehicles.length === 0) {
        for (const c of cities) combos.push({ vehicle_type: null, city: c });
      } else {
        for (const v of vehicles) for (const c of cities) combos.push({ vehicle_type: v, city: c });
      }

      const all: ResultRow[] = [];
      setResults([]);
      setProgress({ done: 0, total: combos.length });

      for (let i = 0; i < combos.length; i += CHUNK) {
        const slice = combos.slice(i, i + CHUNK);
        const chunkVehicles = Array.from(
          new Set(slice.map((s) => s.vehicle_type).filter((v): v is string => !!v)),
        );
        const chunkCities = Array.from(new Set(slice.map((s) => s.city)));

        const { data, error } = await supabase.functions.invoke("seo-local-landing", {
          body: {
            action: "generate_batch",
            shop_id: currentShop.id,
            service: service.trim(),
            cities: chunkCities,
            vehicle_types: chunkVehicles,
            tone,
            min_words: minWords,
          },
        });
        if (error) throw error;
        if ((data as { error?: string })?.error) {
          throw new Error((data as { error: string }).error);
        }
        const batch = data as BatchResponse;
        all.push(...batch.results);
        setResults([...all]);
        setProgress({ done: Math.min(i + slice.length, combos.length), total: combos.length });
      }

      return all;
    },
    onSuccess: (all) => {
      const ok = all.filter((r) => !r.error).length;
      const failed = all.filter((r) => r.error).length;
      toast({
        title: `Generated ${ok} landing page${ok === 1 ? "" : "s"}`,
        description: failed
          ? `${failed} failed — check the table for details.`
          : "Drafts saved. Open each to review and publish.",
      });
      setTimeout(() => setProgress(null), 1500);
    },
    onError: (e: Error) => {
      toast({ title: "Generate failed", description: e.message, variant: "destructive" });
      setProgress(null);
    },
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to generate landing pages.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/seo">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <MapPin className="h-6 w-6 text-cyan-400" /> Local landing pages
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Programmatic SEO. Generate one full landing page per
              {" "}<code>{`{vehicle type}`}</code> × <code>{`{city}`}</code> combo
              (or just per city) — drafts go straight into <Link to="/admin/seo/blog" className="text-cyan-400 hover:underline">/admin/seo/blog</Link> ready to review and publish.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-6">
          <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Inputs</div>
            <div>
              <Label>Service</Label>
              <Input
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="Vehicle Wraps"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                The thing the page is selling. Examples: "Color Change Wraps",
                "Fleet Vehicle Wraps", "Commercial Truck Wraps".
              </p>
            </div>
            <div>
              <Label>Vehicle types (optional)</Label>
              <Textarea
                rows={4}
                value={vehiclesText}
                onChange={(e) => setVehiclesText(e.target.value)}
                placeholder={"One per line. Optional.\nSprinter Van\nBox Truck\nFleet Van\nSemi Trailer"}
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Leave empty to generate one page per city. Otherwise one page per vehicle × city.
              </p>
            </div>
            <div>
              <Label>Cities</Label>
              <Textarea
                rows={6}
                value={citiesText}
                onChange={(e) => setCitiesText(e.target.value)}
                placeholder={"One per line. Include state for clarity.\nDenver, CO\nBoulder, CO\nColorado Springs, CO"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tone</Label>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} />
              </div>
              <div>
                <Label>Min words</Label>
                <Input
                  type="number"
                  value={minWords}
                  onChange={(e) => setMinWords(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
              <div className="text-zinc-400">
                Plan: <span className="font-semibold text-cyan-400">
                  {totalCombos.toLocaleString()}
                </span> page{totalCombos === 1 ? "" : "s"}{" "}
                {vehicles.length > 0 && cities.length > 0
                  ? `(${vehicles.length} × ${cities.length})`
                  : ""}
              </div>
              {totalCombos > 50 && (
                <div className="text-amber-400 mt-1">
                  Heads up — &gt;50 pages. Generation runs in chunks of {CHUNK}.
                </div>
              )}
            </div>
            <Button
              onClick={() => run.mutate()}
              disabled={run.isPending || totalCombos === 0 || !service.trim()}
              className="w-full"
            >
              {run.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Generate {totalCombos > 0 ? `${totalCombos} page${totalCombos === 1 ? "" : "s"}` : "batch"}
            </Button>
            <p className="text-[10px] text-zinc-500">
              Drafts are saved to <code>seo_blog_posts</code> with
              {" "}<code>intent='local_landing'</code>. Review and push to
              WordPress from <Link to="/admin/seo/blog" className="text-cyan-400 hover:underline">/admin/seo/blog</Link>.
            </p>
          </Card>

          <div className="space-y-4">
            {progress && (
              <Card className="bg-zinc-950 border-zinc-800 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    Generating {progress.done}/{progress.total}
                  </span>
                  <span>
                    {Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%
                  </span>
                </div>
                <Progress
                  value={(progress.done / Math.max(progress.total, 1)) * 100}
                  className="h-2"
                />
              </Card>
            )}

            <Card className="bg-zinc-950 border-zinc-800 p-4">
              <h2 className="text-lg font-semibold mb-3">Results</h2>
              {results.length === 0 ? (
                <p className="text-zinc-500 text-sm">
                  Fill in the form and hit Generate. You'll see each draft show up
                  here with a link to its editor.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {results.map((r, i) => (
                    <li
                      key={`${r.slug || i}-${r.city}-${r.vehicle_type ?? "none"}`}
                      className="py-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {r.error ? (
                            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          )}
                          <span className="font-medium truncate">
                            {r.title || `${r.vehicle_type ?? ""} ${r.city}`.trim()}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                          <Badge variant="outline" className="text-[10px]">{r.city}</Badge>
                          {r.vehicle_type && (
                            <Badge variant="outline" className="text-[10px]">{r.vehicle_type}</Badge>
                          )}
                          {!r.error && (
                            <span>{r.word_count.toLocaleString()} words</span>
                          )}
                        </div>
                        {r.error && (
                          <div className="text-red-400 text-[11px] mt-1">{r.error}</div>
                        )}
                      </div>
                      {r.id && (
                        <Button asChild variant="outline" size="sm" className="shrink-0">
                          <Link to={`/admin/seo/blog/${r.id}`}>
                            Open <ExternalLink className="h-3 w-3 ml-1" />
                          </Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
