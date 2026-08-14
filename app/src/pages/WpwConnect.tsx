/**
 * /wpw-connect — Plain-utility explanation of the WPW Connect Portal.
 *
 * Public route. Reachable from WPW marketing emails. Tells active
 * WePrintWraps customers what they get when they sign in to
 * DesignProAI and how to claim it. No hero gradients, no sales pitch
 * sections — just facts and a sign-in link.
 */
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const PERKS: string[] = [
  "3 free render tokens on signup (1 token = 1 render or revision in any tool).",
  "QuickQuote — instant wrap pricing, no token cost.",
  "Past WPW orders with one-click reorder.",
  "Branded customer quote tool.",
  "WPW Family rate — $50/mo off any paid tier, auto-applied once your account is linked.",
];

export default function WpwConnect() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>WPW Connect Portal | DesignProAI</title>
        <meta
          name="description"
          content="What active WePrintWraps customers get when they sign in to DesignProAI — free dashboard, QuickQuote, past-order portal, 3 free render tokens, and WPW Family pricing."
        />
      </Helmet>

      <div className="min-h-screen bg-[#0a0a0d] text-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55 mb-2">
            WPW Connect Portal
          </div>
          <h1 className="font-montserrat text-3xl sm:text-4xl font-bold leading-tight mb-4">
            What active WPW customers get
          </h1>
          <p className="text-sm text-white/65 leading-relaxed mb-6">
            Sign in to DesignProAI with the email you use for WPW orders and
            you&apos;re auto-linked. Nothing to enter, no code, no card.
          </p>

          <ul className="space-y-2.5 mb-8">
            {PERKS.map((perk) => (
              <li key={perk} className="flex gap-2.5 text-sm text-white/80 leading-relaxed">
                <span className="text-white/35 shrink-0">·</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => navigate("/signup")}
              className="bg-white text-black font-semibold hover:bg-white/90"
            >
              Sign up
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/login")}
              className="border-white/20 text-white hover:bg-white/5"
            >
              Sign in
            </Button>
          </div>

          <p className="mt-8 text-[11px] text-white/40 leading-relaxed">
            Different email at WPW than DesignProAI? Email
            {" "}
            <a href="mailto:Design@weprintwraps.com" className="text-white/60 hover:text-white underline underline-offset-2">
              Design@weprintwraps.com
            </a>
            {" "}
            and we&apos;ll link them manually.
          </p>

          <div className="mt-10 pt-6 border-t border-white/5 text-[11px] text-white/40">
            <Link to="/pricing" className="hover:text-white/70 underline underline-offset-2">
              See full pricing →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
