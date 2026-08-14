// CreatorHowItWorks — a plain-language "show Amanda how it works" panel that
// sits at the top of /admin/creator, right next to the Build button. Collapsible
// so it's out of the way once the team knows the flow. No jargon on purpose.
import { useState } from "react";

const STEPS: { n: string; title: string; body: React.ReactNode }[] = [
  {
    n: "1",
    title: "Find “Build from library”",
    body: <>The ⚡ box below is the machine — it grabs real clips from our footage and cuts them together. You make three choices: <b>Format</b>, <b>Brand</b>, and a one-line <b>Topic</b>.</>,
  },
  {
    n: "2",
    title: "Pick a Format & Brand",
    body: <>Format = what kind of video (start with <b>Reel</b>). Brand = whose logo &amp; site go on it — for a DesignPro ad, pick <b>DesignProAI</b>.</>,
  },
  {
    n: "3",
    title: "Type the angle",
    body: <>Write it like you'd say it — e.g. <i>“why cheap wraps cost more.”</i> Or pick a saved hook from the dropdown. Either works.</>,
  },
  {
    n: "4",
    title: "Click Build, then wait",
    body: <>The video drops into <b>Render jobs</b> below and goes Queued → Rendering → done. Give it a couple minutes — you don't have to do anything.</>,
  },
  {
    n: "5",
    title: "Post it, or hit ✂️ Edit",
    body: <>When it finishes, post as-is — or click <b>✂️ Edit</b> on the job to swap the logo (→ WrapTV), change music, trim, or fix the on-screen text. <span className="text-gray-400">The ✂️ Edit button only appears once a video finishes.</span></>,
  },
];

export default function CreatorHowItWorks() {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg">🎬</span>
          <span className="text-sm font-bold text-gray-900">How it works</span>
          <span className="hidden sm:inline text-xs text-gray-500">— show Amanda: pick, type, click, wait, tweak</span>
        </span>
        <span className="text-xs font-semibold text-gray-500">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-sm font-bold text-white">
                  {s.n}
                </div>
                <div className="text-[13px] font-bold text-gray-900">{s.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600">
            <b className="text-gray-900">If a video is stuck on “Queued”</b> more than ~5 minutes, that's the render machine — tell Trish the video's name. Everything up to that point is working. <b className="text-gray-900">Didn't love the clips?</b> Just build again with slightly different topic wording — each build is fresh.
          </p>
        </div>
      )}
    </section>
  );
}
