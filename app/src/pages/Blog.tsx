import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Calendar, Clock, ArrowRight, Mail, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogPostMeta } from "@/components/blog/BlogPostLayout";

// ── Legacy hardcoded posts (still accessible at their original routes) ──
export const legacyBlogPosts: BlogPostMeta[] = [
  {
    slug: "how-much-does-a-vehicle-wrap-cost-2026",
    title: "How Much Does a Vehicle Wrap Cost in 2026? Complete Pricing Guide",
    description:
      "Full breakdown of vehicle wrap costs by type — color change, commercial fleet, custom design — plus how AI design tools are cutting costs by 40%.",
    date: "2026-03-25",
    readTime: "8 min read",
    author: "RestyleProAI",
    tags: ["Pricing", "Guide", "Vehicle Wraps"],
  },
  {
    slug: "best-vehicle-wrap-colors-2026",
    title: "15 Best Vehicle Wrap Colors for 2026: Trends Wrap Shops Need to Know",
    description:
      "The hottest wrap colors dominating 2026 — from deep ocean teal to satin bronze. See which finishes clients are requesting most.",
    date: "2026-03-25",
    readTime: "6 min read",
    author: "RestyleProAI",
    tags: ["Colors", "Trends", "Vehicle Wraps"],
  },
  {
    slug: "matte-vs-gloss-vs-satin-wrap-finish",
    title: "Matte vs Gloss vs Satin Wrap: Which Finish Is Right for Your Vehicle?",
    description:
      "Compare matte, gloss, and satin vehicle wrap finishes — durability, maintenance, cost, and which looks best on different vehicles.",
    date: "2026-03-25",
    readTime: "7 min read",
    author: "RestyleProAI",
    tags: ["Finishes", "Guide", "Vehicle Wraps"],
  },
];

const LEGACY_SLUGS = new Set(legacyBlogPosts.map((p) => p.slug));

interface DBPost {
  id: string;
  title: string;
  slug: string;
  description: string;
  featured_image_url: string | null;
  tags: string[];
  author: string;
  read_time: string;
  published_at: string;
}

const Blog = () => {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const { data: cmsPosts = [] } = useQuery({
    queryKey: ["blog-posts-public"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("id, title, slug, description, featured_image_url, tags, author, read_time, published_at")
        .eq("status", "published")
        .lte("published_at", new Date().toISOString())
        .order("published_at", { ascending: false });
      if (error) return [];
      return (data || []) as DBPost[];
    },
  });

  const cmsSlugSet = new Set(cmsPosts.map((p: DBPost) => p.slug));
  const allPosts = [
    ...cmsPosts.map((p: DBPost) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      date: p.published_at,
      readTime: p.read_time,
      author: p.author,
      tags: p.tags,
      featuredImage: p.featured_image_url,
    })),
    ...legacyBlogPosts
      .filter((p) => !cmsSlugSet.has(p.slug))
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        description: p.description,
        date: p.date,
        readTime: p.readTime,
        author: p.author,
        tags: p.tags,
        featuredImage: null as string | null,
      })),
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://restyleproai.com" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://restyleproai.com/blog" },
    ],
  };

  return (
    <>
      <Helmet>
        <title>The Source Blog | RestyleProAI</title>
        <meta
          name="description"
          content="Expert guides on vehicle wrap design, pricing, trends, and AI-powered design tools. Learn from 20+ years of wrap industry experience."
        />
        <meta name="keywords" content="vehicle wrap design, wrap pricing, wrap colors, wrap trends, AI wrap design, vinyl wrap, car wrap, fleet wraps, RestyleProAI, DesignPro" />
        <link rel="canonical" href="https://www.restyleproai.com/blog" />
        <meta property="og:title" content="The Source Blog | RestyleProAI" />
        <meta
          property="og:description"
          content="Expert guides on vehicle wrap design, pricing, trends, and AI-powered design tools."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.restyleproai.com/blog" />
        <meta property="og:image" content="https://restyleproai.com/hero-mustang.jpg" />
        <meta property="og:site_name" content="RestyleProAI" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="The Source Blog | RestyleProAI" />
        <meta name="twitter:description" content="Expert guides on vehicle wrap design, pricing, trends, and AI-powered design tools." />
        <meta name="twitter:image" content="https://restyleproai.com/hero-mustang.jpg" />
        <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      </Helmet>

      {/* ── Clean blog layout ── */}
      <main className="min-h-screen bg-neutral-50">
        {/* Header */}
        <section className="bg-white border-b border-neutral-200">
          <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
            <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-widest uppercase text-neutral-400 mb-2">
                  RestyleProAI
                </p>
                <h1 className="text-3xl sm:text-4xl font-semibold text-neutral-900 tracking-tight">
                  The Source Blog
                </h1>
                <p className="text-sm text-neutral-500 mt-2 max-w-md leading-relaxed">
                  Pricing guides, design trends, and production tips from 20+ years in the wrap game.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-neutral-400">
                <a href="https://instagram.com/restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">Instagram</a>
                <span className="text-neutral-200">·</span>
                <a href="https://tiktok.com/@restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">TikTok</a>
                <span className="text-neutral-200">·</span>
                <a href="https://youtube.com/@restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">YouTube</a>
                <span className="text-neutral-200">·</span>
                <a href="https://linkedin.com/company/restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">LinkedIn</a>
              </div>
            </div>
          </div>
        </section>

        {/* Filter tabs */}
        <div className="bg-white border-b border-neutral-200">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-5xl mx-auto py-3">
              <div className="flex flex-wrap gap-1.5">
                {["All", "Manifesto", "Pricing", "Guide", "Colors", "Trends", "Finishes", "Vehicle Wraps", "Design", "Production"].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveFilter(tag === "All" ? null : tag)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                      (tag === "All" && !activeFilter) || activeFilter === tag
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Post Grid — cards */}
        <section className="py-8 sm:py-12">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {allPosts
                .filter((post) => !activeFilter || post.tags?.includes(activeFilter))
                .map((post) => (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="group bg-white rounded-xl border border-neutral-200 overflow-hidden hover:shadow-md hover:border-neutral-300 transition-all"
                >
                  {/* Card image */}
                  <div className="aspect-[16/10] overflow-hidden bg-neutral-100">
                    {post.featuredImage ? (
                      <img
                        src={post.featuredImage}
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200">
                        <span className="text-4xl text-neutral-300">✦</span>
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="p-5">
                    {/* Tags */}
                    {post.tags && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {post.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-medium text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Title */}
                    <h2 className="text-base font-semibold text-neutral-900 leading-snug mb-2 group-hover:text-neutral-600 transition-colors line-clamp-2">
                      {post.title}
                    </h2>

                    {/* Description */}
                    <p className="text-sm text-neutral-500 leading-relaxed mb-4 line-clamp-2">
                      {post.description}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center justify-between text-xs text-neutral-400">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(post.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {post.readTime}
                        </span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Newsletter CTA */}
        <section className="py-12">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-3xl mx-auto bg-white rounded-xl border border-neutral-200 p-8 sm:p-10 text-center">
              <p className="text-xs font-medium tracking-widest uppercase text-neutral-400 mb-2">
                Stay in the loop
              </p>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                The Source Newsletter
              </h2>
              <p className="text-sm text-neutral-500 mb-6 max-w-md mx-auto">
                Featured builds, design trends, and the Restyle Drop — curated monthly.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-sm mx-auto">
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="w-full sm:flex-1 h-10 px-4 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 bg-neutral-50 border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                />
                <button className="w-full sm:w-auto h-10 px-5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2">
                  <Mail className="w-3.5 h-3.5" />
                  Subscribe
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <section className="pb-12">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-5xl mx-auto pt-8 border-t border-neutral-200">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-neutral-400">
                  &copy; {new Date().getFullYear()} RestyleProAI · Powered by WePrintWraps
                </p>
                <div className="flex items-center gap-4 text-xs text-neutral-400">
                  <Link to="/colorpro" className="hover:text-neutral-700 transition-colors">ColorPro</Link>
                  <Link to="/designpro" className="hover:text-neutral-700 transition-colors">DesignPro</Link>
                  <Link to="/pricing" className="hover:text-neutral-700 transition-colors">Pricing</Link>
                  <a href="https://weprintwraps.com" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">WePrintWraps</a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default Blog;
