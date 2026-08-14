/**
 * /try-design/success — Post-checkout confirmation page.
 *
 * Stripe redirects here after a successful $25 guest design purchase.
 * stripe-webhook is already firing in the background to create the user,
 * grant a token, and email a magic link. We just tell the visitor what
 * to expect.
 */

import { Helmet } from "react-helmet-async";
import { CheckCircle2, Mail, Clock } from "lucide-react";

const TryDesignSuccess = () => {
  return (
    <>
      <Helmet>
        <title>Check your email — RestyleProAI</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen bg-black text-white flex items-center">
        <div className="max-w-xl w-full mx-auto px-5 sm:px-8 py-12">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#00C7FF]/15 text-[#00C7FF] mb-5">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
              Payment received.
            </h1>
            <p className="text-base sm:text-lg text-white/75 leading-relaxed">
              Check your inbox — we just emailed you a link that opens the designer
              with your credit pre-loaded.
            </p>
          </div>

          <div className="mt-8 bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 text-white shrink-0">
                <Mail className="w-4 h-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Email from noreply@restyleproai.com</p>
                <p className="text-xs text-white/55 mt-0.5">
                  Subject: "Your RestyleProAI design credit is ready"
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 text-white shrink-0">
                <Clock className="w-4 h-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Delivery: under 60 seconds</p>
                <p className="text-xs text-white/55 mt-0.5">
                  If it doesn't arrive, check your spam folder.
                </p>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-white/40 mt-8">
            Need help?{" "}
            <a
              href="mailto:support@restyleproai.com"
              className="text-[#00C7FF] hover:underline"
            >
              support@restyleproai.com
            </a>
          </p>
        </div>
      </div>
    </>
  );
};

export default TryDesignSuccess;
