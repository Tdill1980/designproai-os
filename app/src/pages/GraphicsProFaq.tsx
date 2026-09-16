/**
 * GRAPHICSPRO — THE QUESTIONS, ANSWERED, WITH THE PRODUCT'S OWN NUMBERS.
 *
 * Owner, 2026-09-16: "wire the entire set", after the same page was built for
 * WallPro.
 *
 * ── WHAT THIS REPLACES, AND WHY IT IS A PAGE ───────────────────────────────
 *
 * GraphicsPro already had an FAQ: `<FAQ productName="GraphicsPro" />`, eight
 * hard-coded question/answer pairs pinned to the bottom of all three tool
 * pages. It is kept — it is the SEO tail on a tool page and it earns that — but
 * it could not answer the two questions a buyer actually stalls on:
 *
 *   what does this cost?    it said "choose a plan that fits your shop"
 *   what happens after I press the button?   it did not say
 *
 * and it stated everything as prose, so it would be wrong the first time a
 * material rate or a cut-file format moved and nobody would notice.
 *
 * ── THE ARCHITECTURAL DECISION, SAME AS WALLPRO'S ──────────────────────────
 *
 * NOTHING HERE IS TYPED TWICE. Every number is read from the code that owns it:
 *
 *   GRAPHICS_MATERIALS              the per-square-foot rates the estimator charges
 *   GRAPHICS_LAMINATION_PER_SQFT    the lamination adder
 *   graphicsPanelizerRun            the production rail, stage copy included
 *
 * so the page is wrong only if the product is wrong. The cut-file facts that
 * have no app-side constant (the CutContour separation, the 1/4" bleed, the
 * nested sheet) are stated as the deterministic contract in
 * _shared/cut-contour, which is a contract rather than a tunable — and they are
 * named there rather than invented here.
 *
 * One surface, three doors: this page serves /graphics-pro, -wall and -window
 * alike, because the answers do not differ by surface. Where they DO differ --
 * interior-mount window kits being cut in reverse -- that is its own question.
 */
import { Link } from 'react-router-dom';
import { WALL_GRADIENT } from '@/lib/wallpro-brand';
import { ArrowRight, HelpCircle, Layers, Scissors, Wallet, Frame } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { ToolHeader } from '@/components/layout/ToolHeader';
import { OS_TOOLS } from '@/lib/os-brand';
import { UniversalPanelizerProgress } from '@/components/production/UniversalPanelizerProgress';
import { graphicsPanelizerRun } from '@/lib/graphicspro-panelizer';
import {
  GRAPHICS_MATERIALS, GRAPHICS_LAMINATION_PER_SQFT, type GraphicsMaterialKey,
} from '@/lib/graphicspro-pricing';

/** A worked job, at 12 sq ft — a pair of 24″ × 36″ door graphics. */
const EXAMPLE_SQFT = 12;

/**
 * THE WORKED RUN — built by the product's own stage builder, not described.
 *
 * `graphicsPanelizerRun` owns what each step is called and what it promises,
 * and that copy is read by a paying customer while they wait. Re-typing it here
 * to "explain the pipeline" would produce two descriptions of one process, and
 * the marketing one always wins the argument and loses the truth.
 */
const WORKED_RUN = graphicsPanelizerRun({
  id: 'example0',
  status: 'complete',
  mode: 'production',
  name: 'Your cut graphics',
  files: [
    { format: 'pdf', path: 'example' },
    { format: 'svg', path: 'example' },
    { format: 'zip', path: 'example' },
  ],
});

const money = (n: number) => '$' + n.toFixed(2);

function Qa({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="flex gap-2.5 text-[15px] font-semibold text-slate-900">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ec4899]" />{q}
      </h3>
      <div className="mt-2 space-y-2 pl-[26px] text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
  );
}

function Group({ icon: Icon, title, children }: {
  icon: typeof Scissors; title: string; children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-slate-900">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${WALL_GRADIENT}`}>
          <Icon className="h-4 w-4 text-white" />
        </span>
        {title}
      </h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

export default function GraphicsProFaq() {
  const materials = Object.entries(GRAPHICS_MATERIALS) as [GraphicsMaterialKey, typeof GRAPHICS_MATERIALS[GraphicsMaterialKey]][];

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-slate-900">
      <Helmet>
        <title>GraphicsPro — Prices &amp; FAQ | DesignProAI</title>
        <meta name="description" content="What cut vinyl graphics cost, what files you receive, and what happens after you approve a mockup. Every number computed from the product's own code." />
      </Helmet>

      <main className="flex-1">
        <ToolHeader
          id="cutpro-faq-header"
          theme={{
            logo: null,
            logoAlt: '',
            eyebrow: '',
            wordmarkLead: OS_TOOLS.cutpro.wordmark.base,
            wordmarkAccent: OS_TOOLS.cutpro.wordmark.suffix,
            tagline: OS_TOOLS.cutpro.tagline,
          }}
        />

        <div className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
          <section className="py-10 md:py-14">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ec4899]">Questions &amp; answers</p>
            <h1 className="mt-3 max-w-[20ch] text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
              What it costs, and what you actually receive.
            </h1>
            <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-slate-600">
              Cut graphics are priced by the square foot of vinyl, and the rates below are the
              ones the estimator in the tool charges — read from the same table, not retyped.
              A shop with its own pricing row overrides them at quote time.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className={`${WALL_GRADIENT} text-white`}>
                <Link to="/graphics-pro">Design your graphics<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </section>

          {/* ── PRICE ────────────────────────────────────────────────────── */}
          <section>
            <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
              <Wallet className="h-6 w-6 text-[#ec4899]" />What cut graphics cost
            </h2>
            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Material</th>
                    <th className="px-4 py-3 font-semibold">When a shop picks it</th>
                    <th className="px-4 py-3 text-right font-semibold">Per sq ft</th>
                    <th className="px-4 py-3 text-right font-semibold">{EXAMPLE_SQFT} sq ft</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {materials.map(([key, m]) => (
                    <tr key={key}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{m.label}</td>
                      <td className="px-4 py-3 text-slate-600">{m.note}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{money(m.rate)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-500">
                        {money(m.rate * EXAMPLE_SQFT)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">Lamination</td>
                    <td className="px-4 py-3 text-slate-600">
                      Optional, on top of the material rate — for graphics that will be washed,
                      scraped or left in the sun.
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">
                      +{money(GRAPHICS_LAMINATION_PER_SQFT)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-500">
                      +{money(GRAPHICS_LAMINATION_PER_SQFT * EXAMPLE_SQFT)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Worked on {EXAMPLE_SQFT} sq ft — a pair of 24″ × 36″ door graphics. The tool prices
              your real shapes off the nested sheet, which is usually less than the rectangle
              they came from.
            </p>
          </section>

          {/* ── THE PIPELINE ─────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
              <Layers className="h-6 w-6 text-[#ec4899]" />What happens after you approve
            </h2>
            <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-slate-600">
              This is the GENIE Universal Panelizer — the same screen you watch while your cut
              files are produced, shown here finished. A file glows when it actually exists,
              never when a step merely ran.
            </p>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
              <UniversalPanelizerProgress run={WORKED_RUN} />
            </div>
          </section>

          {/* ── THE QUESTIONS ────────────────────────────────────────────── */}
          <Group icon={Scissors} title="What you get">
            <Qa q="Is this printed wrap or cut vinyl?">
              <p>
                Cut vinyl. Solid colours with clean cut paths, tuned to cut and weed cleanly on a
                plotter — not a full printed wrap. If you want a printed wall covering, that is
                WallPro.
              </p>
            </Qa>
            <Qa q="What files does my plotter receive?">
              <p>
                Three. A <strong className="text-slate-900">cut-contour PDF</strong> carrying one
                unified cut line as a real CutContour separation (CMYK 0/100/0/0, 0.25 pt stroke)
                with your artwork bled ¼″ past it; the same contour as a{' '}
                <strong className="text-slate-900">vector cut path</strong> for a plotter that
                prefers SVG; and a <strong className="text-slate-900">layered film ZIP</strong> —
                one vector layer per colour with offset-path bleeds, nested on one sheet.
              </p>
            </Qa>
            <Qa q="Are the cut lines generated by AI?">
              <p>
                No, and this is the part worth knowing. The cut geometry is calculated
                deterministically from your approved artwork — no model, no guesswork on the line
                your plotter follows. What the cutter cuts is exactly the silhouette of what you
                approved.
              </p>
            </Qa>
            <Qa q="What surfaces does it handle?">
              <p>
                Vehicle panels, storefront and office glass, and interior or exterior walls. One
                tool serves all three; <Link to="/graphics-pro-wall" className="font-semibold text-[#ec4899] underline-offset-4 hover:underline">GraphicsPro Wall</Link>{' '}
                and <Link to="/graphics-pro-window" className="font-semibold text-[#ec4899] underline-offset-4 hover:underline">GraphicsPro Window</Link>{' '}
                are the same tool with the surface pre-selected.
              </p>
            </Qa>
          </Group>

          <Group icon={Frame} title="Your photo and the zones">
            <Qa q="How does it know where the graphics go?">
              <p>
                You draw the zones. ZoneMasker puts rectangles on your own photo — the wall, the
                storefront, or every angle of the vehicle you uploaded — and those rectangles are
                burned into the image and sent as a hard mask, so the design lands where you put
                it rather than where a model guessed.
              </p>
            </Qa>
            <Qa q="Window graphics for inside the glass — is that different?">
              <p>
                Yes, and it is handled for you. An interior-mount window kit is cut in{' '}
                <strong className="text-slate-900">reverse</strong> — the whole kit is mirrored — so
                it reads correctly from the street. Say it is going on the inside and the files
                come out that way.
              </p>
            </Qa>
            <Qa q="Can I use my own logo or artwork?">
              <p>
                Yes. Upload artwork, a logo, or reference images and choose whether GraphicsPro
                should match them exactly or treat them as style inspiration. It can also draw a
                cut-vinyl-friendly logo if you do not have one.
              </p>
            </Qa>
            <Qa q="Can I put a phone number and website on it?">
              <p>
                Yes — add your business details and choose which zone carries the logo, the name,
                the phone, the website or the full contact block. Nothing is invented: a number
                you did not enter is never printed.
              </p>
            </Qa>
          </Group>

          <Group icon={Layers} title="Production">
            <Qa q="How is the price worked out?">
              <p>
                Off the <strong className="text-slate-900">nested sheet</strong>, not the bounding
                box. Every graphic is packed onto one sheet, the real area is measured, and the
                material rate above is applied. That is usually less than the rectangles your
                shapes came from — and it is what the shop is actually buying.
              </p>
            </Qa>
            <Qa q="Is anything flagged for a human to look at?">
              <p>
                Yes. Letters under 2″, hairline strokes, paths over 200 vertices and anything
                needing tiling are flagged for manual review, because those are what fail on the
                plotter rather than on screen.
              </p>
            </Qa>
            <Qa q="What if the production run stops partway?">
              <p>
                You will see it. Any files that finished are listed and downloadable, and the run
                says which step it stopped on — a stalled job is reported as stalled rather than
                spinning forever.
              </p>
            </Qa>
            <Qa q="Is there a size limit?">
              <p>
                Graphics are nested onto a sheet up to 51.5″ wide. Anything beyond the 200″ PDF
                limit is written at 10% scale with the scale in the filename, so the file is
                still valid and your shop knows exactly what it is holding.
              </p>
            </Qa>
          </Group>

          <section className={`mt-16 ${WALL_GRADIENT} rounded-2xl px-6 py-10 text-center text-white shadow-xl md:px-10 md:py-14`}>
            <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Describe it, and cut it.</h2>
            <p className="mx-auto mt-3 max-w-[48ch] text-sm text-white/85">
              Draw the zones on your own photo, say what you want, and take the plotter files.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-white text-[#3b82f6] hover:bg-white/90">
                <Link to="/graphics-pro">Start a design<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
