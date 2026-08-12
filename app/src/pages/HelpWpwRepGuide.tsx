/**
 * /help/wpw-rep-guide — Rep-facing playbook.
 *
 * Public so reps can bookmark it / open it on phone without a login,
 * but written for an internal audience (commission details, talking
 * points, customer objection handling). Linked from the WPW Rep
 * Toolkit card in the affiliate dashboard.
 */

import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  ArrowRight,
  Sparkles,
  Mail,
  MessageSquare,
  Hash,
  DollarSign,
  Tag,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScreenshotSlot } from "@/components/help/ScreenshotSlot";
import { WpwTeamCards } from "@/components/affiliate/WpwTeamCards";

const SECTIONS = [
  { id: "what-you-have", label: "1. What you have" },
  { id: "how-to-share", label: "2. How to share" },
  { id: "commissions", label: "3. How you get paid" },
  { id: "dashboard", label: "4. Reading your dashboard" },
  { id: "objections", label: "5. Customer objections" },
];

const HelpWpwRepGuide = () => {
  return (
    <>
      <Helmet>
        <title>WPW Rep Playbook — RestyleProAI</title>
        <meta
          name="description"
          content="How to use your RestyleProAI rep toolkit: share your branded landing page, earn 20% commission on $25 designs and first-month subscriptions, and handle customer questions."
        />
        <link
          rel="canonical"
          href="https://restyleproai.com/help/wpw-rep-guide"
        />
      </Helmet>

      <div className="min-h-screen bg-[#f3f4f6] light text-gray-900">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
          <div className="text-[11px] font-semibold tracking-[2px] uppercase text-fuchsia-600 mb-3">
            Playbook · For WPW reps
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-[1.05] tracking-tight text-gray-900">
            Your rep playbook.
          </h1>
          <p className="text-base sm:text-lg text-gray-600 mt-4 leading-relaxed">
            Everything you need to start sharing RestyleProAI today: your
            branded link, paste-able templates, how commissions get paid,
            and how to handle the questions you'll get back.
          </p>

          {/* Team cards — above the fold so reps + customers immediately
              see the real humans (Founder + Design + Marketing) behind
              every wrap. Reads media from /admin/wpw-founder-assets. */}
          <WpwTeamCards />

          <nav className="mt-8 mb-12 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-[#38BDF8] hover:shadow-sm transition text-gray-800"
              >
                {s.label}
              </a>
            ))}
          </nav>

          {/* 1. What you have */}
          <section id="what-you-have" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              1. What you have
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed">
              When you log into your affiliate dashboard, the "WPW Rep
              Toolkit" card at the top has everything in one place.
            </p>
            <ScreenshotSlot
              label="Affiliate dashboard — WPW Rep Toolkit card"
              note="Capture the toolkit card showing URL, coupon, QR, and the three template buttons."
            />
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex gap-3">
                <Sparkles className="w-4 h-4 text-[#0284C7] mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-gray-900">Your branded URL</span> —{" "}
                  <code className="text-[#0284C7] bg-[#38BDF8]/10 px-1 py-0.5 rounded">
                    restyleproai.com/wpw/&lt;your-name&gt;
                  </code>{" "}
                  — pre-loaded with your face, your 10% coupon, and a $25
                  design + subscription path.
                </div>
              </li>
              <li className="flex gap-3">
                <Tag className="w-4 h-4 text-[#0284C7] mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-gray-900">Your coupon code</span> —
                  10% off the $25 AI design or a customer's first month of
                  any subscription. Auto-applies when they click your URL.
                </div>
              </li>
              <li className="flex gap-3">
                <Share2 className="w-4 h-4 text-[#0284C7] mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-gray-900">A QR code</span> — download
                  the PNG and use it on a business card, window decal, or
                  shop signage. Scans straight to your URL.
                </div>
              </li>
              <li className="flex gap-3">
                <Mail className="w-4 h-4 text-[#0284C7] mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-gray-900">Three paste-able templates</span>{" "}
                  — full email reply, short SMS, social caption. Click [Copy]
                  and paste wherever.
                </div>
              </li>
            </ul>
          </section>

          {/* 2. How to share */}
          <section id="how-to-share" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              2. How to share
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed">
              The whole point of the toolkit is you never have to write a
              pitch from scratch. Match the channel to the template.
            </p>

            <div className="space-y-4 mt-5">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold mb-1.5 text-gray-900">
                  <Mail className="w-4 h-4 text-[#0284C7]" />
                  Use the Email reply template when…
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  A customer emails asking for a quote or a "design proof" or
                  "can you mock something up". Paste it as your reply, hit
                  send. They'll either build their own quote or buy a $25
                  render — either way you're credited.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold mb-1.5 text-gray-900">
                  <MessageSquare className="w-4 h-4 text-[#0284C7]" />
                  Use the Text message template when…
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  You're texting a lead back, in a DM thread, or following up
                  on a shop walk-in. One line, the link, your code. Done.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold mb-1.5 text-gray-900">
                  <Hash className="w-4 h-4 text-[#0284C7]" />
                  Use the Social caption template when…
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  You're posting to your personal Instagram or Facebook
                  story. Pair it with a render you did or a finished wrap
                  photo. Don't post the same caption back-to-back — change
                  the hook each time.
                </p>
              </div>
            </div>

            <ScreenshotSlot
              label="Toolkit card — Copy buttons highlighted"
              note="Zoom in on the three template Copy buttons so reps can see exactly where to click."
            />
          </section>

          {/* 3. Commissions */}
          <section id="commissions" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              3. How you get paid
            </h2>
            <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-5 mt-4">
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-fuchsia-600 mt-0.5" />
                <div className="text-sm text-gray-800 leading-relaxed">
                  <span className="font-semibold text-fuchsia-700">
                    20% on every $25 design.
                  </span>{" "}
                  About $5 per single-design sale. Customer pays $22.50 with
                  your coupon — your commission is on the discounted total.
                </div>
              </div>
              <div className="flex items-start gap-3 mt-3">
                <DollarSign className="w-5 h-5 text-fuchsia-600 mt-0.5" />
                <div className="text-sm text-gray-800 leading-relaxed">
                  <span className="font-semibold text-fuchsia-700">
                    20% on a customer's first month of subscription.
                  </span>{" "}
                  Starter $350 → ~$70 to you. DesignPro Plus $995 → ~$199 to
                  you. After their first month, the commission ends —
                  single-payout, no MRR cut.
                </div>
              </div>
              <div className="flex items-start gap-3 mt-3">
                <ShieldCheck className="w-5 h-5 text-fuchsia-600 mt-0.5" />
                <div className="text-sm text-gray-800 leading-relaxed">
                  <span className="font-semibold text-fuchsia-700">
                    Paid out twice a month
                  </span>{" "}
                  via Stripe Connect — 1st and 15th. $10 minimum balance to
                  trigger a payout. Connect your bank account in your
                  affiliate Settings so we have somewhere to send it.
                </div>
              </div>
            </div>

            <ScreenshotSlot
              label="Stripe Connect onboarding banner"
              note="The yellow 'Connect your bank' banner that appears at the top of the affiliate dashboard until Stripe Connect is set up."
            />
          </section>

          {/* 4. Dashboard */}
          <section id="dashboard" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              4. Reading your dashboard
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed">
              The numbers on your affiliate dashboard refresh in real time as
              customers buy through your link. What each card means:
            </p>
            <ScreenshotSlot
              label="Affiliate dashboard — Stats grid"
              note="The 4-card row showing Total Earned, Pending Balance, Total Referrals, and Next Fund Date."
            />
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex gap-2">
                <span className="text-[#0284C7] font-bold">•</span>
                <span>
                  <span className="font-semibold text-gray-900">Total Earned</span> — every
                  commission credited to you since you started, paid or
                  pending.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#0284C7] font-bold">•</span>
                <span>
                  <span className="font-semibold text-gray-900">Pending Balance</span> —
                  commissions waiting to go out on the next 1st or 15th.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#0284C7] font-bold">•</span>
                <span>
                  <span className="font-semibold text-gray-900">Total Referrals</span> —
                  unique customers who bought something through your link.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#0284C7] font-bold">•</span>
                <span>
                  <span className="font-semibold text-gray-900">Next Fund Date</span> —
                  the next date your pending balance will be sent to your
                  bank.
                </span>
              </li>
            </ul>
          </section>

          {/* 5. Objections */}
          <section id="objections" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              5. Handling customer questions
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed">
              You'll hear the same five questions over and over. Here's how
              to answer each one fast.
            </p>

            <div className="space-y-4 mt-5">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-bold text-gray-900">
                  "Why would I pay $25 for AI designs?"
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  Because guessing what a wrap will look like on YOUR truck
                  costs more than $25 in second-guessing. You get 3 design
                  credits — burn them as 3 different concepts, or one
                  design plus two refinements. Each one is a real 6-view
                  3D proof, not a chatbot screenshot, and lands in your
                  inbox in minutes.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-bold text-gray-900">
                  "Is this an AI thing? I want a real designer."
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  AI does the heavy lifting on the render, but the
                  subscriptions ($699 Studio and up) include a real human
                  designer with a 48-hour file turnaround. The $25 is great
                  for "let me see if this idea even works" — bigger jobs go
                  through Studio or Plus.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-bold text-gray-900">
                  "Can I use my own photo of my truck?"
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  Yes — that's what MyVehiclePro is for. It's included in
                  DesignPro Lite ($499) and up. The "3 designs for $25"
                  pack uses a stock 3D model of your year/make/model.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-bold text-gray-900">
                  "What if I hate it?"
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  Each revision is also a credit. Tell the AI what to
                  change ("make it darker", "less chrome on the hood",
                  "more aggressive lines"). So 1 design + 2 refinements
                  uses all 3 credits in the $25 pack. Customers who'd
                  rather try 3 totally different concepts can do that
                  instead. On subscriptions, the credit quota refills
                  every month.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-bold text-gray-900">
                  "Is the $25 a subscription?"
                </div>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  No — one-time charge, no recurring billing, no card stored
                  for renewal. They can come back and buy another $25 design
                  later if they want.
                </p>
              </div>
            </div>
          </section>

          {/* CTA footer */}
          <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-6 sm:p-8 text-center">
            <h3 className="text-xl font-bold text-gray-900">Open your toolkit</h3>
            <p className="text-sm text-gray-600 mt-1">
              Jump to the affiliate dashboard, grab your link, and start
              sending.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
              <Button
                asChild
                className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold"
              >
                <Link to="/affiliate/dashboard">
                  Open my dashboard
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/help/restylepro-walkthrough">
                  Customer walkthrough (share with leads)
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HelpWpwRepGuide;
