import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

/**
 * /free-wrap-designs — Public landing page geared toward shops/operators
 * who want the design tools (DesignProAI, MyVehiclePro, ColorPro,
 * FadeWraps, GraphicsPro) and don't care about the Shop Engine Dashboard.
 *
 * Almost identical to /wpw, with the Shop Engine Dashboard image, Perk #2,
 * dashboard nav guide, and dashboard recap stripped. Same offer (3 free
 * design tokens = $75 value), different framing.
 */

const PROOF_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20koi%20proof%203d.jpeg";
const MCLAREN_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20close%20rear.jpeg";
const MINI_COOPER_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/2014%20mini%20cooper%20s%20-%20Passenger%20Side.png";
const TOKEN_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/Token.jpeg";

const SIGNUP_URL =
  "/signup?utm_source=free_designs_landing&utm_medium=web&utm_campaign=free_wrap_designs";

export default function FreeWrapDesigns() {
  return (
    <>
      <Helmet>
        <title>3 free custom wrap designs — RestyleProAI</title>
        <meta
          name="description"
          content="3 free design tokens ($75 value). Use them on DesignProAI, MyVehiclePro, ColorPro, FadeWraps, or GraphicsPro. Customer-ready 6-view 3D approval proofs in minutes."
        />
        <link rel="canonical" href="https://www.restyleproai.com/free-wrap-designs" />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        {/* Wide hero — token image left, headline center, McLaren right */}
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-[#888] text-[20px] font-light tracking-wide">RestyleProAI</div>
            <div className="text-[#888] text-[11px] font-semibold tracking-[2px] uppercase mt-2.5">
              Pro Wrap Design Suite · DesignProAI · MyVehiclePro · ColorPro · FadeWraps · GraphicsPro
            </div>
          </div>

          {/* Hero row: small token | headline | McLaren close-up */}
          <div className="grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)_minmax(320px,1.4fr)] items-center gap-6 md:gap-8 mb-8">
            <img
              src={TOKEN_IMG}
              alt="Design tokens card: 3 tokens, $25 each, $75 retail value"
              className="hidden md:block w-[140px] rounded-lg border border-[#222]"
              loading="eager"
            />
            <div className="text-center order-first md:order-none">
              <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.1] tracking-tight">
                3 free custom wrap designs.
              </h1>
              <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.1] tracking-tight text-[#00C7FF] mt-2">
                On us. $75 value.
              </h1>
              <div className="text-white text-base sm:text-lg font-medium mt-5">
                Built for shops that close jobs on the customer-approval proof.
              </div>
            </div>
            <img
              src={MCLAREN_IMG}
              alt="Custom koi McLaren wrap design by DesignProAI — close-up"
              className="hidden md:block w-full rounded-xl border border-[#222]"
              loading="eager"
            />
            {/* Mobile-only flanking row: small token + close-up McLaren */}
            <div className="flex md:hidden items-center gap-3 mt-1">
              <img
                src={TOKEN_IMG}
                alt="Design tokens card: 3 tokens, $25 each, $75 retail value"
                className="w-[90px] shrink-0 rounded-lg border border-[#222]"
                loading="eager"
              />
              <img
                src={MCLAREN_IMG}
                alt="Custom koi McLaren wrap design by DesignProAI — close-up"
                className="flex-1 rounded-xl border border-[#222]"
                loading="eager"
              />
            </div>
          </div>
        </div>

        {/* Body — narrower */}
        <div className="max-w-[680px] mx-auto px-5 sm:px-8 pb-10">

          {/* Intro */}
          <div className="border-y border-[#222] py-6 mb-8">
            <p className="text-[#ccc] text-base leading-relaxed">
              The moment you create your account you get{" "}
              <strong className="text-white">3 design tokens ($25 each &middot; $75 total)</strong>.
              Spend them on a full custom wrap design — or on{" "}
              <strong className="text-white">any of our tools</strong>: DesignProAI, MyVehiclePro,
              ColorPro, FadeWraps, GraphicsPro.{" "}
              <strong className="text-white">Each token covers one generation</strong>, and{" "}
              <strong className="text-white">every revision also costs 1 token</strong> — so 1 design + 2
              revisions = your 3 tokens used. When you hit zero, a pop-up will ask if you want to grab
              more.
            </p>
          </div>

          {/* CTA #1 */}
          <div className="text-center mb-10">
            <Link
              to={SIGNUP_URL}
              className="inline-block px-9 py-[18px] rounded-lg text-base font-extrabold tracking-wide text-white"
              style={{
                backgroundImage: "linear-gradient(135deg, #00C7FF 0%, #7E5BEC 50%, #FF2DC8 100%)",
                textShadow: "0 1px 0 rgba(0,0,0,0.15)",
              }}
            >
              Claim my 3 free designs &rarr;
            </Link>
            <div className="text-[#666] text-xs mt-3">No card. No catch.</div>
          </div>

          {/* The offer */}
          <div className="mb-10">
            <div className="text-[#00C7FF] text-xs font-bold tracking-[2px] uppercase mb-3">
              3 Free Design Tokens · $75 Value
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-4">
              A full custom wrap design &mdash; on us.
            </h2>
            <p className="text-[#ccc] text-base leading-relaxed mb-4">
              Use your tokens for a <strong className="text-white">full custom wrap design</strong> on
              DesignProAI &mdash; or on any of our other tools (ColorPro, FadeWraps, GraphicsPro,
              MyVehiclePro). Each one outputs a polished{" "}
              <strong className="text-white">6-view 3D approval proof</strong> &mdash; driver side, passenger,
              front, rear, hood, and roof on a single design card &mdash; built to win the customer&rsquo;s
              sign-off in one send.
            </p>

            <div className="bg-[rgba(0,199,255,0.06)] border border-[rgba(0,199,255,0.30)] rounded-[10px] p-4 sm:p-[18px] mb-4">
              <div className="text-[#00C7FF] text-[11px] font-bold tracking-[2px] uppercase mb-2">
                How tokens work
              </div>
              <ul className="text-white text-sm leading-[1.7] space-y-1 list-disc pl-5">
                <li>
                  <strong>Each token = $25 of design value.</strong> You get{" "}
                  <strong>3 tokens on signup ($75 total)</strong>.
                </li>
                <li>
                  <strong>1 token = 1 generation</strong> on any tool: DesignProAI custom wrap design,
                  MyVehiclePro, ColorPro, FadeWraps, or GraphicsPro.
                </li>
                <li>
                  <strong>Every revision = 1 token too.</strong> Not happy with the first pass? Each
                  re-roll is another $25 token.
                </li>
                <li>
                  Plan it: <strong>1 DesignProAI design + 2 revisions = all 3 tokens used</strong>.
                </li>
                <li>
                  Hit zero? A pop-up asks if you want to <strong>grab more tokens</strong> — pick the
                  amount and keep going without losing the design.
                </li>
                <li>
                  Once your customer approves &rarr; upgrade to a{" "}
                  <strong className="text-[#FF2DC8]">$299 Production Pack</strong> for the print-ready
                  2D panels.
                </li>
              </ul>
            </div>

            <p className="text-[#ccc] text-sm leading-relaxed italic">
              These tools are real &mdash; treat your tokens like real ammo. Use them on jobs you&rsquo;re
              closing, not test renders.
            </p>
          </div>

          {/* Proof sheet */}
          <img
            src={PROOF_IMG}
            alt="6-view 3D approval proof sheet — example of the customer-ready output your tokens produce"
            className="w-full rounded-xl border border-[#222] mb-10"
            loading="lazy"
          />

          {/* What's in the suite */}
          <div className="mb-10">
            <div className="text-[#a78bfa] text-xs font-bold tracking-[2px] uppercase mb-3">
              What you get inside
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-4">
              Five tools. One login. Three free designs.
            </h2>
            <div className="space-y-2">
              {[
                {
                  label: "DesignProAI",
                  desc: "Prompt-to-wrap full custom designs. The flagship — 1 token = 1 design.",
                },
                {
                  label: "MyVehiclePro",
                  desc: "Upload the customer's actual vehicle photo. Visualize the wrap on the real truck/car, not a stock model.",
                },
                {
                  label: "ColorPro",
                  desc: "Full-vehicle color changes from the manufacturer color browser. Show the customer the chameleon shift before they buy.",
                },
                {
                  label: "FadeWraps",
                  desc: "Gradient + fade wrap effects with multiple style presets. Killer for sports cars and showpieces.",
                },
                {
                  label: "GraphicsPro",
                  desc: "AI-powered graphics on vehicle zones — door logos, hood callouts, tailgate decals.",
                },
              ].map((row, i) => (
                <div key={i} className="bg-[#0f0f0f] border border-[#222] rounded-[10px] p-4">
                  <div className="text-[#00C7FF] text-[13px] font-bold tracking-[1px] uppercase mb-1">
                    {row.label}
                  </div>
                  <div className="text-[#ccc] text-[14px] leading-relaxed">{row.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Production Pack — print-ready output */}
          <div className="bg-[#0f0f0f] border border-[rgba(255,45,200,0.30)] rounded-xl p-5 sm:p-6 mb-10">
            <div className="text-[#FF2DC8] text-xs font-bold tracking-[2px] uppercase mb-2">
              When the customer approves &middot; $299 Production Pack
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-3 text-white">
              Print-ready files from a <span className="text-[#FF2DC8]">real human graphic designer</span>.
            </h2>
            <p className="text-[#ccc] text-base leading-relaxed mb-4">
              Once your customer signs off on the AI proof, one click sends it to our Production team.
              A <strong className="text-white">real human graphic designer</strong> takes your AI design
              and outputs <strong className="text-white">print-ready, production-ready files</strong> —
              fully panelized, dialed for your printer, ready to drop on the plotter.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-black border border-[#222] rounded-[10px] p-3 text-center">
                <div className="text-[#FF2DC8] text-[11px] font-bold tracking-[1.5px] uppercase mb-1">
                  Price
                </div>
                <div className="text-white text-[17px] font-extrabold">$299</div>
                <div className="text-[#999] text-[12px] mt-0.5">flat per vehicle</div>
              </div>
              <div className="bg-black border border-[#222] rounded-[10px] p-3 text-center">
                <div className="text-[#FF2DC8] text-[11px] font-bold tracking-[1.5px] uppercase mb-1">
                  Turnaround
                </div>
                <div className="text-white text-[17px] font-extrabold">48 hours</div>
                <div className="text-[#999] text-[12px] mt-0.5">2 business days</div>
              </div>
              <div className="bg-black border border-[#222] rounded-[10px] p-3 text-center">
                <div className="text-[#FF2DC8] text-[11px] font-bold tracking-[1.5px] uppercase mb-1">
                  Output
                </div>
                <div className="text-white text-[17px] font-extrabold">Print files</div>
                <div className="text-[#999] text-[12px] mt-0.5">panelized, plotter-ready</div>
              </div>
            </div>
            <p className="text-[#aaa] text-[13px] leading-relaxed">
              You sell the design to the customer for whatever you want. We charge you $299 flat when
              you're ready to print. No subscription, no per-design markup &mdash; pay only when the
              job is closed.
            </p>
          </div>

          {/* CTA #2 */}
          <div className="text-center mb-8">
            <Link
              to={SIGNUP_URL}
              className="inline-block px-9 py-[18px] rounded-lg text-base font-extrabold tracking-wide text-white"
              style={{
                backgroundImage: "linear-gradient(135deg, #00C7FF 0%, #7E5BEC 50%, #FF2DC8 100%)",
                textShadow: "0 1px 0 rgba(0,0,0,0.15)",
              }}
            >
              Claim my 3 free designs &rarr;
            </Link>
            <div className="text-[#777] text-[13px] mt-3">
              Want details first?{" "}
              <a href="/pricing" className="text-[#00C7FF] underline font-semibold">
                See pricing &amp; tiers &rarr;
              </a>
            </div>
          </div>

          <p className="text-[#888] text-sm leading-relaxed mb-8">
            &mdash; Trish<br />
            Founder, WePrintWraps.com
          </p>

          {/* Mini Cooper */}
          <img
            src={MINI_COOPER_IMG}
            alt="2014 Mini Cooper S — Practical Magic Day Spa wrap design by DesignProAI"
            className="w-full rounded-xl border border-[#222] mb-8"
            loading="lazy"
          />

          {/* Questions */}
          <div className="bg-[rgba(0,199,255,0.05)] border border-[rgba(0,199,255,0.20)] rounded-[10px] p-5 mb-8 text-center">
            <div className="text-white text-[15px] font-semibold mb-1">Questions?</div>
            <div className="text-[#ccc] text-sm leading-relaxed">
              Email us at{" "}
              <a href="mailto:support@restyleproai.com" className="text-[#00C7FF] underline font-semibold">
                support@restyleproai.com
              </a>{" "}
              &mdash; we&rsquo;re here.
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#222] pt-8 text-center text-[#555] text-xs leading-relaxed">
            <div className="text-[#888] text-sm font-light tracking-wide mb-2.5">RestyleProAI</div>
            Pro wrap design suite &middot; Built for shops that close jobs on the proof.
            <br />
            <a href="/user-guide" className="text-[#666] underline">
              User guide
            </a>{" "}
            &middot;{" "}
            <a href="/pricing" className="text-[#666] underline">
              Pricing
            </a>{" "}
            &middot;{" "}
            <a href="mailto:support@restyleproai.com" className="text-[#666] underline">
              Contact
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
