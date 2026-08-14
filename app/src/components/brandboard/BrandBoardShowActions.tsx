import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Film, Loader2, MapPin, MonitorPlay } from "lucide-react";
import { toast as notify } from "sonner";
import {
  planBrandBoardShowAction,
  runBrandBoardShowAction,
} from "@/lib/brandBoardShowActions";
import {
  BRAND_BOARD_SHOW_UI,
  installerCreditIssue,
  musicOverrideIssue,
  normalizedInstallerCredit,
  showActionsForBrand,
  type BrandBoardShowUiAction,
} from "@/lib/brandBoardShowUi";

type ShowPlan = Awaited<ReturnType<typeof planBrandBoardShowAction>>;

interface PlanState {
  loading: boolean;
  plan?: ShowPlan;
  error?: string;
}

type MusicEditor = readonly [
  label: string,
  title: string,
  setTitle: (value: string) => void,
  url: string,
  setUrl: (value: string) => void,
];

export interface BrandBoardShowActionsProps {
  renderJobId: string;
  brand: string;
  initialInstallerHandle?: string | null;
  initialInstallerLocation?: string | null;
  initialMusicUrl?: string | null;
  initialMusicTitle?: string | null;
  initialMusicSelectionMode?: "auto" | "manual" | null;
  initialMusicReuseGroupKey?: string | null;
  onQueued?: () => void;
}

/**
 * The production controls on a BrandBoard cut.
 *
 * The component never invokes a generic URL or chooses a fallback brand. Each
 * button asks the server-side planner to validate the source job, then calls
 * the matching canonical action. This keeps the board an approval/production
 * surface while the renderer remains the authority on footage and format fit.
 */
export default function BrandBoardShowActions({
  renderJobId,
  brand,
  initialInstallerHandle,
  initialInstallerLocation,
  initialMusicUrl,
  initialMusicTitle,
  initialMusicSelectionMode,
  initialMusicReuseGroupKey,
  onQueued,
}: BrandBoardShowActionsProps) {
  const actions = useMemo(() => showActionsForBrand(brand), [brand]);
  const initialManualMusic = initialMusicSelectionMode === "manual";
  const [installerHandle, setInstallerHandle] = useState(initialInstallerHandle || "");
  const [installerLocation, setInstallerLocation] = useState(initialInstallerLocation || "");
  const [longformMusicUrl, setLongformMusicUrl] = useState(initialManualMusic ? (initialMusicUrl || "") : "");
  const [reelMusicUrl, setReelMusicUrl] = useState(initialManualMusic ? (initialMusicUrl || "") : "");
  const [longformMusicTitle, setLongformMusicTitle] = useState(initialManualMusic ? (initialMusicTitle || "") : "");
  const [reelMusicTitle, setReelMusicTitle] = useState(initialManualMusic ? (initialMusicTitle || "") : "");
  const [shareMusic, setShareMusic] = useState(Boolean(initialMusicReuseGroupKey));
  const [plans, setPlans] = useState<Partial<Record<BrandBoardShowUiAction, PlanState>>>({});
  const [running, setRunning] = useState<BrandBoardShowUiAction | null>(null);
  const [resultText, setResultText] = useState<Partial<Record<BrandBoardShowUiAction, string>>>({});
  const planGeneration = useRef(0);

  useEffect(() => {
    setInstallerHandle(initialInstallerHandle || "");
    setInstallerLocation(initialInstallerLocation || "");
    const manual = initialMusicSelectionMode === "manual";
    setLongformMusicUrl(manual ? (initialMusicUrl || "") : "");
    setReelMusicUrl(manual ? (initialMusicUrl || "") : "");
    setLongformMusicTitle(manual ? (initialMusicTitle || "") : "");
    setReelMusicTitle(manual ? (initialMusicTitle || "") : "");
    setShareMusic(Boolean(initialMusicReuseGroupKey));
  }, [renderJobId, initialInstallerHandle, initialInstallerLocation, initialMusicReuseGroupKey, initialMusicSelectionMode, initialMusicTitle, initialMusicUrl]);

  const inputFor = useCallback((action: BrandBoardShowUiAction) => {
    const credit = normalizedInstallerCredit(installerHandle, installerLocation);
    return {
      renderJobId,
      action,
      installerHandle: action === "behind_the_install" ? credit.handle : null,
      installerLocation: action === "behind_the_install" ? credit.location : null,
      musicUrls: action === "behind_the_install" ? {
        longform: longformMusicUrl.trim(),
        reel: (shareMusic ? longformMusicUrl : reelMusicUrl).trim(),
      } : undefined,
      musicTitles: action === "behind_the_install" ? {
        longform: longformMusicTitle.trim(),
        reel: (shareMusic ? longformMusicTitle : reelMusicTitle).trim(),
      } : undefined,
      musicReuseGroupKey: action === "behind_the_install" && shareMusic
        ? `source:${renderJobId}:both-formats`
        : null,
    };
  }, [installerHandle, installerLocation, longformMusicTitle, longformMusicUrl, reelMusicTitle, reelMusicUrl, renderJobId, shareMusic]);

  // Surface the pipeline's actual refusal before a person spends a click. The
  // small debounce keeps an @handle/location edit from querying on every key.
  useEffect(() => {
    if (!actions.length) return;
    const generation = ++planGeneration.current;
    setPlans((current) => {
      const next = { ...current };
      for (const action of actions) next[action] = { loading: true };
      return next;
    });

    const timer = window.setTimeout(async () => {
      await Promise.all(actions.map(async (action) => {
        try {
          const plan = await planBrandBoardShowAction(inputFor(action));
          if (planGeneration.current !== generation) return;
          setPlans((current) => ({ ...current, [action]: { loading: false, plan } }));
        } catch (error) {
          if (planGeneration.current !== generation) return;
          setPlans((current) => ({
            ...current,
            [action]: {
              loading: false,
              error: error instanceof Error ? error.message : "Could not check this source cut.",
            },
          }));
        }
      }));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [actions, inputFor]);

  const run = useCallback(async (action: BrandBoardShowUiAction) => {
    setRunning(action);
    setResultText((current) => ({ ...current, [action]: "" }));
    try {
      const result = await runBrandBoardShowAction(inputFor(action));
      if (!result.ok) throw new Error(result.reason || result.errors?.join(" ") || "This cut could not be queued.");
      const made = result.queued.map((item) => item.key === "longform"
        ? "Longform (16:9)"
        : "Reel / Short (9:16)");
      const message = made.length
        ? `Queued ${made.join(" + ")}.`
        : "The pipeline accepted the action, but did not queue an output.";
      setResultText((current) => ({ ...current, [action]: message }));
      if (result.errors?.length) notify.warning(result.errors.join(" "));
      else notify.success(message);
      onQueued?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "This cut could not be queued.";
      setResultText((current) => ({ ...current, [action]: message }));
      notify.error(message);
    } finally {
      setRunning(null);
    }
  }, [inputFor, onQueued]);

  if (!actions.length) return null;

  const credit = normalizedInstallerCredit(installerHandle, installerLocation);
  const creditIssue = installerCreditIssue(installerHandle, installerLocation);
  const trackIssue = musicOverrideIssue(longformMusicTitle, longformMusicUrl)
    || (!shareMusic ? musicOverrideIssue(reelMusicTitle, reelMusicUrl) : null);
  const musicEditors: MusicEditor[] = shareMusic ? [
    ["Shared 16:9 + 9:16", longformMusicTitle, setLongformMusicTitle, longformMusicUrl, setLongformMusicUrl],
  ] : [
    ["Longform 16:9", longformMusicTitle, setLongformMusicTitle, longformMusicUrl, setLongformMusicUrl],
    ["Reel / Short 9:16", reelMusicTitle, setReelMusicTitle, reelMusicUrl, setReelMusicUrl],
  ];

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Brand video production">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-900">Make from this source cut</div>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
            The video pipeline checks the source and brand before it queues a real edit.
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {brand === "wraptvworld" ? "WrapTVWorld only" : "WePrintWraps only"}
        </span>
      </div>

      {actions.includes("behind_the_install") && (
        <div className="mt-3 rounded-lg border border-fuchsia-200 bg-white p-3" data-show-format="behind_the_install">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-fuchsia-600" />
            <div className="text-xs font-bold text-slate-900">Behind the Install</div>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-slate-600">
            Music-led install story with two separate edits—not one crop. Blank music fields use the next original WrapTVWorld song in rotation.
          </p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] font-semibold text-slate-700">
              Featured installer/shop Instagram
              <input
                value={installerHandle}
                onChange={(event) => setInstallerHandle(event.target.value)}
                placeholder="@shophandle"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-normal text-slate-900 outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500"
                aria-label="Featured installer or shop Instagram handle"
              />
            </label>
            <label className="text-[10px] font-semibold text-slate-700">
              Location
              <span className="ml-1 font-normal text-slate-400">city + state, or country</span>
              <div className="relative mt-1">
                <MapPin className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={installerLocation}
                  onChange={(event) => setInstallerLocation(event.target.value)}
                  placeholder="City, State or Country"
                  className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs font-normal text-slate-900 outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500"
                  aria-label="Featured installer or shop location"
                />
              </div>
            </label>
          </div>

          <label className="mt-2 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700">
            <input
              type="checkbox"
              checked={shareMusic}
              onChange={(event) => setShareMusic(event.target.checked)}
              className="mt-0.5"
              aria-label="Intentionally use one song for both output formats"
            />
            <span>
              <span className="font-semibold">Intentionally use one song for both formats</span>
              <span className="mt-0.5 block text-[9px] text-slate-500">Off by default: each finished 16:9 and 9:16 video receives a different song until the library is exhausted.</span>
            </span>
          </label>

          <div className={`mt-2 grid gap-2 ${shareMusic ? "" : "sm:grid-cols-2"}`}>
            {musicEditors.map(([label, title, setTitle, url, setUrl]) => (
              <div key={label} className="rounded-md border border-slate-200 p-2">
                <div className="text-[10px] font-bold text-slate-800">{label} music</div>
                <label className="mt-1 block text-[9px] font-semibold text-slate-600">
                  Song title <span className="font-normal text-slate-400">shown in ticker</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Blank = automatic original-song rotation"
                    className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-normal text-slate-900 outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500"
                    aria-label={`${label} song title`}
                  />
                </label>
                <label className="mt-1 block text-[9px] font-semibold text-slate-600">
                  Track URL <span className="font-normal text-slate-400">optional human override</span>
                  <input
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Blank = automatic; paste URL to override"
                    className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-normal text-slate-900 outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500"
                    aria-label={`${label} music track URL`}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="mt-2 rounded-md bg-slate-950 px-2.5 py-2 text-[10px] text-white">
            <div className="flex items-center justify-between gap-2">
              <span>WrapTVWorld logo · top right</span>
              <span>moving credit + song ticker · bottom</span>
            </div>
            <div className="mt-1 truncate text-slate-300" aria-label="Behind the Install credit preview">
              {credit.handle || "@installer/shop"} · {credit.location || "City, State or Country"}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {actions.map((action) => {
          const spec = BRAND_BOARD_SHOW_UI[action];
          const state = plans[action];
          const localIssue = action === "behind_the_install" ? (creditIssue || trackIssue) : null;
          const refusal = localIssue
            || state?.error
            || (state?.loading ? "Checking source footage and format requirements…" : null)
            || (state?.plan && !state.plan.ok ? state.plan.reason : null)
            || (!state?.plan ? "Checking source footage and format requirements…" : null);
          const busy = running === action;
          const disabled = Boolean(running || refusal || !state?.plan?.ok);

          return (
            <div
              key={action}
              className="rounded-lg border border-slate-200 bg-white p-2.5"
              data-brand={spec.brand}
              data-show-format={spec.showFormat || "none"}
              data-angle={state?.plan?.angle || spec.angle}
              data-output-formats={spec.outputs.map((output) => output.key).join(",")}
            >
              <div className="flex items-start gap-2">
                <MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900">{spec.label}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {spec.outputs.map((output) => (
                      <span key={output.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                        {output.label} ({output.aspect})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => run(action)}
                disabled={disabled}
                title={refusal || `Queue ${spec.label}`}
                className="mt-2 h-8 w-full text-[11px] font-bold"
                data-action={action}
              >
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {busy ? "Queuing real edits…" : action === "behind_the_install"
                  ? "Create Behind the Install"
                  : action === "behind_the_brand"
                    ? "Create Behind the Brand · Documentary"
                    : "Create WPW Reel + Video"}
              </Button>
              {refusal && (
                <p className="mt-1.5 text-[10px] leading-snug text-amber-700" role="status">
                  {refusal}
                </p>
              )}
              {!refusal && resultText[action] && (
                <p className="mt-1.5 text-[10px] leading-snug text-emerald-700" role="status">
                  {resultText[action]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {actions.includes("behind_the_install") && (
        <p className="mt-2 text-[9px] leading-snug text-slate-500">
          Use the real featured account and location. Empty or invalid credits block both outputs; BrandBoard never invents them.
        </p>
      )}
    </section>
  );
}
