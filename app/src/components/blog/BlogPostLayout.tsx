import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, ChevronRight } from "lucide-react";

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  readTime: string;
  author: string;
  ogImage?: string;
  tags?: string[];
}

interface BlogPostLayoutProps {
  meta: BlogPostMeta;
  children: React.ReactNode;
}

export const BlogPostLayout = ({ meta, children }: BlogPostLayoutProps) => {
  const canonicalUrl = `https://www.restyleproai.com/blog/${meta.slug}`;
  const ogImage = meta.ogImage || "https://restyleproai.com/hero-mustang.jpg";

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    image: ogImage,
    datePublished: meta.date,
    author: { "@type": "Organization", name: "RestyleProAI", url: "https://restyleproai.com" },
    publisher: {
      "@type": "Organization",
      name: "RestyleProAI",
      logo: { "@type": "ImageObject", url: "https://restyleproai.com/logo.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://restyleproai.com" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://restyleproai.com/blog" },
      { "@type": "ListItem", position: 3, name: meta.title, item: canonicalUrl },
    ],
  };

  return (
    <>
      <Helmet>
        <title>{meta.title} | RestyleProAI Blog</title>
        <meta name="description" content={meta.description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={ogImage} />
        <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      </Helmet>

      {/* ── White + black editorial layout ── */}
      <main className="min-h-screen bg-white">
        {/* Breadcrumb */}
        <div className="container mx-auto px-4 sm:px-6 pt-6">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 font-montserrat text-sm text-neutral-400"
          >
            <Link
              to="/blog"
              className="hover:text-black transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Blog
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-neutral-600 line-clamp-1">{meta.title}</span>
          </nav>
        </div>

        {/* Article Header */}
        <header className="container mx-auto px-4 sm:px-6 pt-10 pb-6 max-w-3xl">
          {meta.tags && (
            <div className="flex flex-wrap gap-2 mb-4">
              {meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="font-montserrat text-[11px] font-semibold tracking-wider uppercase text-neutral-400"
                >
                  {tag}
                  {tag !== meta.tags![meta.tags!.length - 1] && (
                    <span className="ml-2 text-neutral-300">/</span>
                  )}
                </span>
              ))}
            </div>
          )}

          <h1 className="font-league-spartan text-4xl sm:text-5xl lg:text-6xl font-black text-black leading-[0.95] mb-5 uppercase">
            {meta.title}
          </h1>

          <p className="font-montserrat text-lg text-neutral-500 leading-relaxed mb-6">
            {meta.description}
          </p>

          <div className="flex items-center gap-4 font-montserrat text-sm text-neutral-400 pb-6 border-b border-neutral-200">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date(meta.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {meta.readTime}
            </span>
          </div>
        </header>

        {/* Article Body */}
        <article className="container mx-auto px-4 sm:px-6 pb-16 max-w-3xl">
          <div
            className="prose prose-lg max-w-none font-montserrat
              prose-headings:font-league-spartan prose-headings:text-black prose-headings:font-extrabold prose-headings:uppercase prose-headings:tracking-tight
              prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-neutral-600 prose-p:leading-relaxed prose-p:text-[15px]
              prose-a:text-black prose-a:font-semibold prose-a:underline prose-a:underline-offset-4 prose-a:decoration-neutral-300 hover:prose-a:decoration-black
              prose-strong:text-black
              prose-li:text-neutral-600 prose-li:text-[15px]
              prose-img:rounded-xl
              prose-blockquote:border-l-4 prose-blockquote:border-black prose-blockquote:pl-6 prose-blockquote:italic prose-blockquote:text-neutral-600 prose-blockquote:font-poppins
              prose-table:text-neutral-600
              prose-th:text-black prose-th:font-semibold prose-th:font-poppins
              prose-td:border-neutral-200 prose-th:border-neutral-200"
          >
            {children}
          </div>
        </article>

        {/* CTA */}
        <section className="container mx-auto px-4 sm:px-6 pb-16 max-w-3xl">
          <div className="bg-black rounded-xl p-8 sm:p-10 text-center">
            <h2 className="font-league-spartan text-3xl sm:text-4xl font-black text-white mb-3 uppercase">
              Ready to Design Your First Wrap?
            </h2>
            <p className="font-montserrat text-neutral-400 mb-6">
              Go from text prompt to print-ready files in 60 seconds.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center justify-center font-poppins font-semibold text-sm bg-white text-black px-8 py-3.5 rounded hover:bg-neutral-100 transition-colors uppercase tracking-wide"
            >
              Join Now
            </Link>
          </div>
        </section>
      </main>
    </>
  );
};
