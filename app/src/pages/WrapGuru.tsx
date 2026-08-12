import { Helmet } from "react-helmet-async";
import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import WrapGuruChat from "@/components/wrapguru/WrapGuruChat";

/**
 * WrapGuru — /wrapguru  (INTERNAL TEST BENCH, not a customer page)
 *
 * WrapGuru is a live chat AGENT that sits on weprintwraps.com as a floating
 * bubble — it is not a landing page and must not be marketed as one. This route
 * exists so the team can exercise the agent (pricing, order status, print-file
 * check) exactly as a visitor meets it, and to hand out the embed snippet.
 *
 * The real deliverable is public/embeds/wpw-chat-widget.js — one script tag in
 * the WPW theme footer or a GTM Custom HTML tag.
 *
 * `noindex` on purpose: this page should never turn up in search.
 */

// data-cfasync="false" is REQUIRED on Cloudflare — it excludes the file from
// Rocket Loader, which rewrites script execution and is the usual reason a
// third-party widget "gets blocked" on a Cloudflare site.
const SNIPPET = '<script src="https://restyleproai.com/embeds/wpw-chat-widget.js" async data-cfasync="false"></script>';

export default function WrapGuru() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the snippet is visible to select manually */ }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Helmet>
        <title>WrapGuru — Test Bench (internal)</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            Internal test bench — not a customer page
          </span>
          <h1 className="mt-3 text-2xl font-bold">WrapGuru</h1>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            The live chat agent that sits on weprintwraps.com. Use the bubble in the bottom-right —
            it is the same widget, the same backend, and the same session logging a real visitor gets.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* What to exercise */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold mb-3">What to test</h2>
            <ul className="space-y-3 text-sm text-gray-700">
              <li>
                <strong>Pricing</strong> — “price a full wrap on a 2022 Transit 250 high roof”.
                Real coverage from the vehicle database, real per-sq-ft price, add-to-cart link.
              </li>
              <li>
                <strong>Emailed quote</strong> — give it an email address and ask it to send the quote.
              </li>
              <li>
                <strong>Order status</strong> — needs the order number <em>and</em> the email on the
                order; it will refuse with only one.
              </li>
              <li>
                <strong>Print-file check</strong> — the paperclip. It parses real dimensions, DPI
                against the wrap size, and colour space, then routes to a cart link, a paid prep, or
                a recreate.
              </li>
            </ul>
            <a
              href="/admin/wrapguru"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
            >
              Transcripts &amp; file checks in Admin <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Embed */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold mb-1">Put it on weprintwraps.com</h2>
            <p className="text-sm text-gray-600 mb-3">
              One script tag in the theme footer, or a GTM Custom HTML tag set to All Pages.
              It renders the floating bubble sitewide.
            </p>
            <div className="rounded-lg bg-gray-900 text-gray-100 text-[12.5px] font-mono p-3 overflow-x-auto">
              {SNIPPET}
            </div>
            <button
              onClick={copy}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:border-gray-400"
            >
              {copied ? <><Check className="w-4 h-4 text-emerald-600" /> Copied</> : <><Copy className="w-4 h-4" /> Copy snippet</>}
            </button>
            <p className="mt-3 text-xs text-gray-500">
              Kill switch: set <code className="font-mono">window.WPW_CHAT_DISABLED = true</code> before
              the script loads and the widget will not render.
            </p>

            {/* This site has been broken by a chat embed three times before —
                covered page, white screen, Cloudflare block. Each cause has a
                defence in the widget; these are the steps that use them. */}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">Install it safely</p>
              <ol className="mt-1.5 space-y-1 text-xs text-amber-900/90 list-decimal list-inside">
                <li>Keep <code className="font-mono">data-cfasync="false"</code> — without it Cloudflare Rocket Loader can break the script.</li>
                <li>Add it to <strong>one unlisted page first</strong>, not the homepage. Open it, send a message, attach a file.</li>
                <li>Check the homepage on desktop <em>and</em> phone before going sitewide.</li>
                <li>If anything looks wrong, delete the tag — or set the kill switch. Nothing else needs undoing.</li>
              </ol>
              <p className="mt-2 text-[11px] text-amber-900/80">
                The widget renders inside a shadow root, so page CSS cannot reach it and it cannot
                cover the page; and every handler is wrapped so a failure removes the widget rather
                than the page.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* The agent itself, exactly as a visitor meets it. */}
      <WrapGuruChat variant="floating" />
    </div>
  );
}
