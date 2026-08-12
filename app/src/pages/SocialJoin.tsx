import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * /social/join — the public capture page a SocialIQ comment reply links to
 * (docs/SOCIALIQ_SPEC.md; Klaviyo-style social CRM). Turns a commenter into
 * an OWNED contact: email + explicit consent → social-capture → Klaviyo
 * profile tagged with the post that drove them.
 *
 * WHITE UI (customer-facing): white surface, gray text, blue→magenta
 * gradient accent only. Query params ride from the reply link:
 *   b = brand · pl = platform · p = source post id · h = handle
 */

const CONSENT_TEXT =
  "Yes — email me quotes, wrap inspiration, and offers from WePrintWraps. Unsubscribe anytime.";

export default function SocialJoin() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("social-capture", {
        body: {
          email,
          brand: params.get("b") || "weprintwraps",
          platform: params.get("pl") || undefined,
          handle: params.get("h") || undefined,
          source_post_id: params.get("p") || undefined,
          consent_text: CONSENT_TEXT,
        },
      });
      if (fnErr) throw fnErr;
      if (data?.success === false) throw new Error(data.error || "Try again");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="h-1 rounded-full bg-gradient-to-r from-blue-500 to-pink-500 mb-8" />
        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 mx-auto text-pink-500" />
            <h1 className="text-2xl font-bold">You're in. 🎉</h1>
            <p className="text-gray-600">
              Watch your inbox — and if you're ready now, get a real number for your vehicle in minutes.
            </p>
            <Button asChild className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90">
              <a href="https://www.weprintwraps.com" rel="noopener">Get my instant quote</a>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="text-3xl font-bold">
                Wrap
                <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent"> talk</span>
                , straight to you
              </h1>
              <p className="text-gray-600 mt-2">
                Quotes, real installs, and wrap inspiration from WePrintWraps. No spam — just the good stuff.
              </p>
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            <label className="flex items-start gap-3 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-pink-500"
              />
              <span>{CONSENT_TEXT}</span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              disabled={!consent || busy}
              className="w-full bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
            >
              <Send className="w-4 h-4 mr-2" />
              {busy ? "Joining…" : "Count me in"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
