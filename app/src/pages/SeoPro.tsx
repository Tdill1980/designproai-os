import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  TrendingUp,
  Sparkles,
  MapPin,
  Zap,
  Globe,
  Mail,
  Search,
  FileBarChart,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const PILLARS = [
  {
    icon: Sparkles,
    title: "AI blog batch",
    line: "Paste 25 topics. Walk away. Come back to 25 SEO-scored drafts ready to push to WordPress.",
    proof: "Each post targets a focus keyword, scores against an on-page checklist, and pushes through Yoast / RankMath / AIOSEO.",
  },
  {
    icon: MapPin,
    title: "Google Business Profile, on autopilot",
    line: "Schedule GBP posts in advance. AI-drafted review replies. Auto-dispatched every 5 minutes by cron.",
    proof: "Replies in your brand voice, not template fluff. Review responses ready to post in one click.",
  },
  {
    icon: Zap,
    title: "CTR sweep",
    line: "Find pages already ranking 5–20 on Google with high impressions and low clicks. Claude rewrites the title + meta. One click, live on WordPress.",
    proof: "The single highest-leverage SEO move — converts existing impressions into traffic in days, not months.",
  },
  {
    icon: Globe,
    title: "Programmatic local landing pages",
    line: "Paste your service area. Get one indexable landing page per {vehicle type} × {city}, built with buyer-question H2s and LocalBusiness schema.",
    proof: "How every wrap shop in the country eats local SERPs.",
  },
  {
    icon: Search,
    title: "Indexing API push",
    line: "Pull your full WordPress sitemap with one click. Bulk-request indexing for every URL through Google's Indexing API.",
    proof: "30 seconds to ping every page on your site for re-crawl.",
  },
  {
    icon: Mail,
    title: "Content powers your email",
    line: "Every blog post you publish feeds straight into MightyMail. One write, two channels, three times the reach.",
    proof: "Blog → newsletter → Facebook → Instagram → GBP. Same source of truth, distributed everywhere.",
  },
  {
    icon: FileBarChart,
    title: "White-label monthly reports",
    line: "One-click client report for every shop you manage — GSC traffic, GA4 revenue, audit trend, content published — branded with your logo.",
    proof: "Save as PDF in the browser. No Puppeteer, no extra service to host.",
  },
  {
    icon: TrendingUp,
    title: "Search Console + GA4, in your dashboard",
    line: "Top queries, traffic, revenue, and channel mix — pulled live from your shop's connected Google account, surfaced in the same UI as your blog.",
    proof: "No more 11 browser tabs. SEO + analytics + content in one place.",
  },
];

const PROOF = [
  "Multi-tenant by design — every shop you manage gets its own Search Console, GA4, GBP, and WordPress connection.",
  "Yoast / RankMath / AIOSEO compatible — meta updates push through whichever plugin the site already uses.",
  "Built into DesignProAI — same login, same billing, same support.",
];

export default function SeoPro() {
  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-zinc-900">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(800px circle at 30% 0%, rgba(0,199,255,0.18), transparent 60%), radial-gradient(900px circle at 80% 40%, rgba(217,70,239,0.15), transparent 60%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 py-20 sm:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300 mb-6">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            New in DesignProAI · AutoSEO Toolkit
          </div>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight">
            Seo
            <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-500 bg-clip-text text-transparent">
              Pro
            </span>
            <span className="block text-2xl sm:text-3xl text-zinc-400 font-normal mt-3">
              Automatic SEO. Real organic traffic to your wrap shop website.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-zinc-300 text-base sm:text-lg leading-relaxed">
            Blog content, Google Business Profile posts, on-page rewrites, local
            landing pages, indexing pings, and white-label monthly client
            reports — every move that drives organic traffic, run from one
            dashboard. Multi-tenant. Yoast/RankMath/AIOSEO native.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 border-0">
              <Link to="/admin/seo">
                Open SeoPro <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/pricing">See pricing</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link to="/admin/seo/blog/batch">
                <Sparkles className="h-4 w-4 mr-1" /> Try the blog batch
              </Link>
            </Button>
          </div>
          <ul className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-zinc-400">
            {PROOF.map((p) => (
              <li key={p} className="flex gap-2 items-start">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-semibold">
            Eight features. One outcome.
          </h2>
          <p className="text-zinc-400 mt-2 max-w-2xl">
            Every pillar below is already built into DesignProAI and shipping
            today. Each one moves a different lever on your organic traffic —
            and they compound when used together.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <Card
                key={p.title}
                className="bg-zinc-950 border-zinc-800 p-5 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 shrink-0">
                    <Icon className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-base">{p.title}</div>
                    <p className="text-sm text-zinc-300 mt-1">{p.line}</p>
                    <p className="text-[11px] text-zinc-500 mt-2">{p.proof}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* The flywheel */}
      <section className="border-t border-zinc-900 bg-zinc-950/50">
        <div className="max-w-5xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-semibold">
            One source of truth. Five distribution channels.
          </h2>
          <p className="text-zinc-400 mt-3 max-w-2xl mx-auto">
            Write a blog post once. SeoPro pushes it to WordPress, suggests
            internal links, queues a Google Business post, drafts an email
            campaign in MightyMail, and pings the Indexing API for re-crawl —
            without you copy-pasting a thing.
          </p>
          <div className="mt-8 inline-flex flex-wrap justify-center gap-2 text-xs text-zinc-300">
            {[
              "Blog post (DesignProAI)",
              "→ WordPress",
              "→ Google Business",
              "→ MightyMail email",
              "→ Facebook + Instagram",
              "→ Indexing API",
            ].map((step) => (
              <span
                key={step}
                className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1"
              >
                {step}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold">
          Stop hand-writing SEO. Start automating it.
        </h2>
        <p className="text-zinc-400 mt-3">
          SeoPro ships with every DesignProAI plan. Connect WordPress + Google
          once and the whole engine starts running in the background.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 border-0">
            <Link to="/admin/seo">
              Open SeoPro <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/admin/seo/connections">Connect a site</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
