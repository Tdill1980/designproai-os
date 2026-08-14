import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

/**
 * /wpw — Public landing page mirroring the WPW × RestylePro Connect Portal
 * Klaviyo email. Same offer, same images, same copy structure — so a customer
 * who clicks through from email or SMS lands somewhere coherent before signup.
 *
 * Linked from the email + SMS campaign launched 2026-05-14.
 */

const DASHBOARD_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/Dashboard.png";
const PROOF_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20koi%20proof%203d.jpeg";
const MCLAREN_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20close%20rear.jpeg";
const MINI_COOPER_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/2014%20mini%20cooper%20s%20-%20Passenger%20Side.png";
const TOKEN_IMG = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/Token.jpeg";

const SIGNUP_URL = "/signup?utm_source=wpw_landing&utm_medium=web&utm_campaign=wpw_connect_portal&wpw=1";

export default function WpwConnectPortal() {
  return (
    <>
      <Helmet>
        <title>Your free Shop Engine Dashboard — WPW × RestylePro</title>
        <meta
          name="description"
          content="3 free design tokens ($75 value), past-order dashboard, customer quoting tool with WPW wholesale pricing baked in. Free forever for WePrintWraps shops."
        />
        <link rel="canonical" href="https://www.restyleproai.com/wpw" />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        <div className="max-w-[680px] mx-auto px-5 sm:px-8 py-10">
          {/* Header */}
          <div className="text-center mb-7">
            <div className="text-[#888] text-[20px] font-light tracking-wide">RestyleProAI</div>
            <div className="text-[#888] text-[11px] font-semibold tracking-[2px] uppercase mt-2.5">
              × WePrintWraps.com · Free Shop Engine Dashboard
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-6">
            <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight">
              Your shop, supercharged.
            </h1>
            <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-[#00C7FF] mt-2">
              Free Shop Engine Dashboard.
            </h1>
          </div>

          <div className="text-center text-white text-base sm:text-lg font-medium mb-8">
            Built for WePrintWraps shops. Powered by RestylePro.
          </div>

          {/* Intro */}
          <div className="border-y border-[#222] py-6 mb-8">
            <p className="text-[#ccc] text-base leading-relaxed">
              We just unlocked your free <strong className="text-white">Shop Engine Dashboard</strong> — the WPW × RestylePro
              Connect Portal, a no-cost account tier built for the shops we already work with. Sign in once and you get
              the design tool, the quote tool, and your full order history in one screen.
            </p>
          </div>

          {/* CTA #1 (above the fold) */}
          <div className="text-center mb-10">
            <Link
              to={SIGNUP_URL}
              className="inline-block px-9 py-[18px] rounded-lg text-base font-extrabold tracking-wide text-white"
              style={{
                backgroundImage: "linear-gradient(135deg, #00C7FF 0%, #7E5BEC 50%, #FF2DC8 100%)",
                textShadow: "0 1px 0 rgba(0,0,0,0.15)",
              }}
            >
              Activate my Shop Engine Dashboard →
            </Link>
            <div className="text-[#666] text-xs mt-3">No card. No catch. Free forever.</div>
          </div>

          {/* Dashboard image */}
          <img
            src={DASHBOARD_IMG}
            alt="ShopEngine Dashboard inside the WPW Connect Portal"
            className="w-full rounded-xl border border-[#222] mb-10"
            loading="lazy"
          />

          {/* Perk #1 */}
          <div className="mb-10">
            <div className="text-[#00C7FF] text-xs font-bold tracking-[2px] uppercase mb-3">
              Perk #1 · 3 Free Design Tokens · $75 Value
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-4">
              A free custom wrap design — on us.
            </h2>
            <p className="text-[#ccc] text-base leading-relaxed mb-4">
              Use your tokens for a <strong className="text-white">full custom wrap design</strong> on DesignProAI — or on any
              of our other tools (ColorPro, FadeWraps, GraphicsPro, MyVehiclePro). Each one outputs a polished{" "}
              <strong className="text-white">6-view 3D approval proof</strong> — driver side, passenger, front, rear, hood, and
              roof on a single design card — built to win the customer's sign-off in one send.
            </p>

            <img
              src={TOKEN_IMG}
              alt="Design tokens card: 3 tokens, $25 each, $75 retail value"
              className="w-full max-w-sm mx-auto block rounded-xl border border-[#222] mb-5"
              loading="lazy"
            />

            <div className="bg-[rgba(0,199,255,0.06)] border border-[rgba(0,199,255,0.30)] rounded-[10px] p-4 sm:p-[18px] mb-4">
              <div className="text-[#00C7FF] text-[11px] font-bold tracking-[2px] uppercase mb-2">How tokens work</div>
              <ul className="text-white text-sm leading-[1.7] space-y-1 list-disc pl-5">
                <li>
                  <strong>Each token = $25 of design value.</strong> You get <strong>3 tokens on signup ($75 total)</strong>.
                </li>
                <li>
                  <strong>1 token = 1 generation</strong> on any tool: DesignProAI custom wrap design, MyVehiclePro, ColorPro, FadeWraps, or GraphicsPro.
                </li>
                <li>
                  <strong>Every revision = 1 token too.</strong> Not happy with the first pass? Each re-roll is another $25 token.
                </li>
                <li>
                  Plan it: <strong>1 DesignProAI design + 2 revisions = all 3 tokens used</strong>.
                </li>
                <li>
                  Hit zero? A pop-up asks if you want to <strong>grab more tokens</strong> &mdash; pick the amount and keep going without losing the design.
                </li>
                <li>
                  Once your customer approves &rarr; upgrade to a{" "}
                  <strong className="text-[#FF2DC8]">$299 Production Pack</strong> for the print-ready 2D panels.
                </li>
              </ul>
            </div>

            <p className="text-[#ccc] text-sm leading-relaxed italic">
              These tools are real — treat your tokens like real ammo. Use them on jobs you're closing, not test renders.
            </p>
          </div>

          {/* Proof sheet image */}
          <img
            src={PROOF_IMG}
            alt="6-view 3D approval proof sheet — example of the customer-ready output your tokens produce"
            className="w-full rounded-xl border border-[#222] mb-10"
            loading="lazy"
          />

          {/* Perk #2 */}
          <div className="mb-10">
            <div className="text-[#FF2DC8] text-xs font-bold tracking-[2px] uppercase mb-3">
              Perk #2 · Shop Engine Dashboard · Free Tier
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-4">
              Your wholesale floor — with your retail markup on top.
            </h2>
            <p className="text-[#ccc] text-base leading-relaxed mb-4">That dashboard at the top? It's yours. Free tier includes:</p>
            <ul className="text-[#ccc] text-base leading-[1.8] list-disc pl-6 mb-4 space-y-1">
              <li>
                <strong className="text-white">Look up past orders</strong> — every WPW job you've ever printed, instantly
                searchable in your <strong>Past Orders card</strong>
              </li>
              <li>
                <strong className="text-white">Reorder in one click</strong> — same SKUs, same specs, fewer emails
              </li>
              <li>
                <strong className="text-white">Customer quoting tool</strong> — WPW wholesale pricing baked in. Add your markup,
                customize the line items, send the quote out under your own brand.{" "}
                <span className="text-[#FF2DC8] font-bold">They pay you. You pay us.</span>
              </li>
              <li>
                <strong className="text-[#00C7FF]">Plus your 3 free design tokens</strong> — the $75 value from Perk #1, included
                in the same free account.
              </li>
            </ul>

            <div className="bg-[rgba(0,199,255,0.06)] border border-[rgba(0,199,255,0.25)] rounded-[10px] p-4 sm:p-[18px]">
              <div className="text-[#00C7FF] text-[11px] font-bold tracking-[2px] uppercase mb-1.5">How your past orders show up</div>
              <div className="text-white text-sm leading-relaxed">
                Sign up with the <strong>same email you've used at WePrintWraps</strong>. We auto-match your customer record and
                your full WPW order history populates on the dashboard automatically — no upload, no CSV.
              </div>
            </div>
          </div>

          {/* McLaren close rear image */}
          <img
            src={MCLAREN_IMG}
            alt="Custom koi McLaren wrap design by DesignProAI, rear close-up"
            className="w-full rounded-xl border border-[#222] mb-10"
            loading="lazy"
          />

          {/* Nav guide */}
          <div className="mb-8">
            <div className="text-[#a78bfa] text-xs font-bold tracking-[2px] uppercase mb-3">
              Inside your free Shop Engine Dashboard — where to find each thing
            </div>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight mb-4">Three clicks — not three menus deep.</h2>
            <div className="space-y-2">
              {[
                {
                  label: "Past WPW orders",
                  title: <>Dashboard → <span className="text-[#00C7FF]">Past Orders card</span></>,
                  desc: <>Every WPW job you've printed, with one-click reorder. <span className="text-[#00C7FF]">View all</span> for the full list.</>,
                },
                {
                  label: "Build a customer quote",
                  title: <>Dashboard → <span className="text-[#00C7FF]">Quotes</span></>,
                  desc: "WPW pricing pre-loaded. Add your markup. Send it out under your brand.",
                },
                {
                  label: "Your 3 design tokens ($25 each)",
                  title: <>Top of every tool page · <span className="text-[#00C7FF]">My Designs</span> after</>,
                  desc: "Open DesignProAI, ColorPro, FadeWraps — your remaining count is at the top.",
                },
                {
                  label: "Approved? Get the print files",
                  title: <>Order a <span className="text-[#00C7FF]">$299 Production Pack</span></>,
                  desc: "Print-ready 2D panels, ready for the plotter. One click from any approved proof.",
                },
              ].map((row, i) => (
                <div key={i} className="bg-[#0f0f0f] border border-[#222] rounded-[10px] p-4">
                  <div className="text-[#FF2DC8] text-[11px] font-bold tracking-[1.5px] uppercase mb-1">{row.label}</div>
                  <div className="text-white text-[15px] font-semibold">{row.title}</div>
                  <div className="text-[#999] text-[13px] mt-1">{row.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recap */}
          <div className="bg-[rgba(0,199,255,0.06)] border border-[rgba(0,199,255,0.25)] rounded-xl p-5 sm:p-6 mb-8">
            <div className="text-[#00C7FF] text-[11px] font-bold tracking-[2px] uppercase mb-2">
              Everything in your free Shop Engine Dashboard
            </div>
            <div className="text-white text-base leading-relaxed font-semibold">
              3 free design tokens ($25 each &middot; $75 value) &middot; Past-order view &middot; One-click reorder &middot; Customer quoting tool with WPW
              wholesale pricing baked in.
            </div>
            <div className="text-[#aaa] text-[13px] mt-2">
              No card. No catch. Free forever. Production Packs sold separately at $299 when you&rsquo;re ready to print.
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
              and outputs <strong className="text-white">print-ready, production-ready files</strong> &mdash;
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
              you&rsquo;re ready to print. No subscription, no per-design markup &mdash; pay only when
              the job is closed.
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
              Activate my Shop Engine Dashboard →
            </Link>
            <div className="text-[#777] text-[13px] mt-3">
              Want details first?{" "}
              <a href="/pricing" className="text-[#00C7FF] underline font-semibold">
                See pricing & tiers →
              </a>
            </div>
          </div>

          <p className="text-[#888] text-sm leading-relaxed mb-8">
            — Trish<br />
            Founder, WePrintWraps.com
          </p>

          {/* Mini Cooper at bottom */}
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
              — we're here.
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#222] pt-8 text-center text-[#555] text-xs leading-relaxed">
            <div className="text-[#888] text-sm font-light tracking-wide mb-2.5">RestyleProAI</div>
            WePrintWraps.com × RestylePro free Shop Engine Dashboard · Built for shops that don't have time to wait.
            <br />
            <a href="/user-guide" className="text-[#666] underline">
              User guide
            </a>{" "}
            ·{" "}
            <a href="/pricing" className="text-[#666] underline">
              Pricing
            </a>{" "}
            ·{" "}
            <a href="mailto:support@restyleproai.com" className="text-[#666] underline">
              Contact
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
