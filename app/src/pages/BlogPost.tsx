import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface DBPost {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: string;
  featured_image_url: string | null;
  tags: string[];
  author: string;
  read_time: string;
  published_at: string;
}

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();

  const { data: post, isLoading, error } = useQuery({
    queryKey: ["blog-post", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString())
        .single();
      if (error) throw error;
      return data as DBPost;
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-pulse font-montserrat text-neutral-400">Loading...</div>
      </main>
    );
  }

  if (error || !post) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-league-spartan text-3xl font-black text-black mb-2">Post Not Found</h1>
          <p className="font-montserrat text-neutral-500 mb-6">This post may not be published yet.</p>
          <Link
            to="/blog"
            className="inline-block font-poppins font-semibold text-sm bg-black text-white px-6 py-3 rounded hover:bg-neutral-800 transition-colors"
          >
            &larr; Back to Blog
          </Link>
        </div>
      </main>
    );
  }

  const canonicalUrl = `https://www.restyleproai.com/blog/${post.slug}`;
  const ogImage = post.featured_image_url || "https://restyleproai.com/hero-mustang.jpg";

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    image: ogImage,
    datePublished: post.published_at,
    dateModified: post.published_at,
    author: {
      "@type": "Person",
      name: post.author || "RestyleProAI",
      url: "https://restyleproai.com",
    },
    publisher: {
      "@type": "Organization",
      name: "RestyleProAI",
      url: "https://restyleproai.com",
      logo: { "@type": "ImageObject", url: "https://restyleproai.com/logo.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    ...(post.tags?.length > 0 && { keywords: post.tags.join(", ") }),
    articleSection: "Vehicle Wraps",
    inLanguage: "en-US",
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://restyleproai.com" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://restyleproai.com/blog" },
      { "@type": "ListItem", position: 3, name: post.title, item: canonicalUrl },
    ],
  };

  return (
    <>
      <Helmet>
        <title>{post.title} | RestyleProAI Blog</title>
        <meta name="description" content={post.description} />
        <meta name="keywords" content={post.tags?.length > 0 ? [...post.tags, "vehicle wraps", "wrap design", "RestyleProAI"].join(", ") : "vehicle wraps, wrap design, RestyleProAI"} />
        <meta name="author" content={post.author || "RestyleProAI"} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content="RestyleProAI" />
        <meta property="article:published_time" content={post.published_at} />
        <meta property="article:author" content={post.author || "RestyleProAI"} />
        {post.tags?.map((tag: string) => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={post.title} />
        <meta name="twitter:description" content={post.description} />
        <meta name="twitter:image" content={ogImage} />
        <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      </Helmet>

      {/* ── Clean article layout ── */}
      <main className="min-h-screen bg-white">
        {/* Breadcrumb */}
        <div className="bg-neutral-50 border-b border-neutral-200">
          <div className="container mx-auto px-4 sm:px-6 py-3">
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 text-sm text-neutral-400"
            >
              <Link
                to="/blog"
                className="hover:text-neutral-700 transition-colors flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                The Source Blog
              </Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-neutral-600 line-clamp-1">{post.title}</span>
            </nav>
          </div>
        </div>

        {/* Article Header */}
        <header className="container mx-auto px-4 sm:px-6 pt-10 pb-6 max-w-2xl">
          {/* Tags */}
          {post.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {post.tags.map((tag: string) => (
                <span
                  key={tag}
                  className="text-[11px] font-medium text-neutral-400 bg-neutral-100 px-2.5 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h1 className="text-3xl sm:text-4xl font-semibold text-neutral-900 leading-tight mb-4 tracking-tight">
            {post.title}
          </h1>

          {/* Description */}
          <p className="text-base text-neutral-500 leading-relaxed mb-6">
            {post.description}
          </p>

          {/* Meta */}
          <div className="flex items-center gap-4 text-sm text-neutral-400 pb-6 border-b border-neutral-200">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date(post.published_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {post.read_time}
            </span>
            {post.author && (
              <span className="text-neutral-500">by {post.author}</span>
            )}
          </div>
        </header>

        {/* Featured Image */}
        {post.featured_image_url && (
          <div className="container mx-auto px-4 sm:px-6 pb-8 max-w-2xl">
            <img
              src={post.featured_image_url}
              alt={post.title}
              className="w-full rounded-xl"
            />
          </div>
        )}

        {/* Article Body */}
        <article className="container mx-auto px-4 sm:px-6 pb-16 max-w-2xl">
          <div
            className="prose prose-neutral max-w-none
              prose-headings:text-neutral-900 prose-headings:font-semibold prose-headings:tracking-tight
              prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
              prose-h3:text-lg prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-neutral-600 prose-p:leading-relaxed prose-p:text-[15px]
              prose-a:text-neutral-900 prose-a:font-medium prose-a:underline prose-a:underline-offset-4 prose-a:decoration-neutral-300 hover:prose-a:decoration-neutral-900
              prose-strong:text-neutral-900 prose-strong:font-semibold
              prose-li:text-neutral-600 prose-li:text-[15px]
              prose-img:rounded-xl
              prose-blockquote:border-l-2 prose-blockquote:border-neutral-300 prose-blockquote:pl-5 prose-blockquote:italic prose-blockquote:text-neutral-500
              prose-hr:border-neutral-200
              prose-table:text-neutral-600
              prose-th:text-neutral-900 prose-th:font-medium
              prose-td:border-neutral-200 prose-th:border-neutral-200"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </article>

        {/* CTA */}
        <section className="container mx-auto px-4 sm:px-6 pb-10 max-w-2xl">
          <div className="rounded-xl bg-neutral-900 p-8 sm:p-10 text-center">
            <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
              Ready to see it on your vehicle?
            </h2>
            <p className="text-sm text-neutral-400 mb-6">
              From concept to print-ready output — built by operators, not observers.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center justify-center text-sm font-medium bg-white text-neutral-900 px-6 py-2.5 rounded-lg hover:bg-neutral-100 transition-colors"
              >
                Try RestyleProAI
              </Link>
              <a
                href="https://weprintwraps.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center text-sm font-medium border border-neutral-700 text-neutral-300 px-6 py-2.5 rounded-lg hover:bg-neutral-800 transition-colors"
              >
                Shop WePrintWraps
              </a>
            </div>
          </div>
        </section>

        {/* Footer nav */}
        <section className="container mx-auto px-4 sm:px-6 pb-16 max-w-2xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6 border-t border-neutral-200">
            <Link to="/blog" className="text-sm font-medium text-neutral-900 hover:text-neutral-600 transition-colors flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back to The Source Blog
            </Link>
            <div className="flex items-center gap-4 text-xs text-neutral-400">
              <a href="https://instagram.com/restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">Instagram</a>
              <a href="https://tiktok.com/@restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">TikTok</a>
              <a href="https://youtube.com/@restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">YouTube</a>
              <a href="https://linkedin.com/company/restyleproai" target="_blank" rel="noopener noreferrer" className="hover:text-neutral-700 transition-colors">LinkedIn</a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default BlogPost;
