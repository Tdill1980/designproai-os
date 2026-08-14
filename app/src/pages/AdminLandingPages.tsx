import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Copy, ExternalLink, Check } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";

/**
 * /admin/landing-pages
 *
 * Quick reference for the team: every public landing URL we can share
 * for the WPW × DesignProAI Connect Portal launch, with one-click copy
 * and "open in new tab" actions.
 */

type Entry = {
  path: string;
  label: string;
  desc: string;
  audience: "wpw" | "general" | "mightymail";
};

const ENTRIES: Entry[] = [
  {
    path: "/wpw",
    label: "/wpw",
    desc: "Full WPW account-holders pitch — mirror of the Klaviyo email. Dashboard image, Past Orders, quoting tool, 3 free design tokens.",
    audience: "wpw",
  },
  {
    path: "/wpw-connect",
    label: "/wpw-connect",
    desc: "Same page as /wpw — alias for the Connect Portal.",
    audience: "wpw",
  },
  {
    path: "/connect-portal",
    label: "/connect-portal",
    desc: "Same page as /wpw — alias for the Connect Portal.",
    audience: "wpw",
  },
  {
    path: "/free-wrap-designs",
    label: "/free-wrap-designs",
    desc: "Design-tools focused — for operators who want DesignProAI / MyVehiclePro / ColorPro / FadeWraps / GraphicsPro and don't care about the dashboard. Small token chip + McLaren close-up hero + Production Pack section.",
    audience: "general",
  },
  {
    path: "/3-free-designs",
    label: "/3-free-designs",
    desc: "Same page as /free-wrap-designs — short alias for SMS / quick share.",
    audience: "general",
  },
  {
    path: "/free-designs",
    label: "/free-designs",
    desc: "Same page as /free-wrap-designs — shortest alias.",
    audience: "general",
  },
  {
    path: "/mightymail-info",
    label: "/mightymail-info",
    desc: "MightyMail explainer + inline signup. Highlights the 3 USPs: Screenshot, Auto Retargeting, Analytics. Images are managed in /admin/mightymail-landing (drop-zone uploader → wrap-files/mightymail-landing/<slot>).",
    audience: "mightymail",
  },
];

function fullUrl(path: string) {
  if (typeof window === "undefined") return `https://designproai.com${path}`;
  const origin = window.location.origin.replace(/\/$/, "");
  return `${origin}${path}`;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — silently ignore */
        }
      }}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-[#333] bg-[#0f0f0f] hover:bg-[#1a1a1a] text-cyan-300 hover:text-cyan-200 transition-colors"
      title="Copy URL"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" /> Copy
        </>
      )}
    </button>
  );
}

function Section({ title, color, entries }: { title: string; color: string; entries: Entry[] }) {
  return (
    <div className="mb-8">
      <div className="text-[11px] font-bold tracking-[2px] uppercase mb-3" style={{ color }}>
        {title}
      </div>
      <div className="space-y-2">
        {entries.map((e) => {
          const url = fullUrl(e.path);
          return (
            <div
              key={e.path}
              className="rounded-xl border border-[#222] bg-[#0a0a0a] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <code className="text-cyan-300 font-mono text-sm font-semibold">{e.label}</code>
                <div className="ml-auto flex items-center gap-2">
                  <CopyBtn value={url} />
                  <Link
                    to={e.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-[#333] bg-[#0f0f0f] hover:bg-[#1a1a1a] text-cyan-300 hover:text-cyan-200 transition-colors"
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </Link>
                </div>
              </div>
              <div className="text-[12px] font-mono text-[#888] break-all mb-2">{url}</div>
              <p className="text-[#bbb] text-sm leading-relaxed">{e.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Inner() {
  const wpw = ENTRIES.filter((e) => e.audience === "wpw");
  const general = ENTRIES.filter((e) => e.audience === "general");
  const mightymail = ENTRIES.filter((e) => e.audience === "mightymail");

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>Landing Pages · Admin</title>
      </Helmet>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
            Public landing pages
          </h1>
          <p className="text-[#aaa] text-sm leading-relaxed">
            Every public landing URL the team can share. All are public &mdash; no login required.
            Click <strong>Copy</strong> to copy the full URL or <strong>Open</strong> to preview in a
            new tab.
          </p>
        </div>

        <Section
          title="WPW account holders — full pitch (dashboard + tokens + quoting)"
          color="#00C7FF"
          entries={wpw}
        />

        <Section
          title="Design-tools focused — 3 free designs, no dashboard"
          color="#FF2DC8"
          entries={general}
        />

        <Section
          title="MightyMail — email/retarget explainer"
          color="#a78bfa"
          entries={mightymail}
        />

        <div className="rounded-xl border border-[#222] bg-[#0a0a0a] p-4 sm:p-5 mb-4">
          <div className="text-[11px] font-bold tracking-[2px] uppercase mb-2 text-[#a78bfa]">
            Admin tools for these pages
          </div>
          <p className="text-[#bbb] text-sm leading-relaxed">
            Manage MightyMail landing images at{" "}
            <Link to="/admin/mightymail-landing" className="text-cyan-300 underline font-semibold">
              /admin/mightymail-landing
            </Link>{" "}
            &mdash; drop-zone uploader for the 6 image slots (hero, usp-screenshot,
            usp-autoretarget, usp-analytics, social-proof-1, social-proof-2). Stored in Supabase
            Storage under <code className="text-cyan-300">wrap-files/mightymail-landing/&lt;slot&gt;</code>.
          </p>
        </div>

        <div className="rounded-xl border border-[#222] bg-[#0a0a0a] p-4 sm:p-5">
          <div className="text-[11px] font-bold tracking-[2px] uppercase mb-2 text-[#a78bfa]">
            Email + signup tracking
          </div>
          <p className="text-[#bbb] text-sm leading-relaxed mb-2">
            Email CTA &rarr; <code className="text-cyan-300">/signup?wpw=1</code> &mdash; auto-matches
            the recipient&rsquo;s WPW email and grants 3 design tokens on first sign-in via{" "}
            <code className="text-cyan-300">wpw-oauth-link</code>.
          </p>
          <p className="text-[#bbb] text-sm leading-relaxed">
            Landing-page CTA UTM is{" "}
            <code className="text-cyan-300">utm_campaign=wpw_connect_portal</code> (WPW page) or{" "}
            <code className="text-cyan-300">utm_campaign=free_wrap_designs</code> (general page) so we
            can split-report.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminLandingPages() {
  return (
    <RequireAdmin>
      <Inner />
    </RequireAdmin>
  );
}
