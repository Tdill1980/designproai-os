import { Link, useParams, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight } from "lucide-react";

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

const MIN_POSTS_FOR_COVER = 6;

const BlogCover = () => {
  const { slug } = useParams<{ slug: string }>();

  // Check total published post count
  const { data: postCount = 0 } = useQuery({
    queryKey: ["blog-post-count"],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("blog_posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published");
      if (error) return 0;
      return count || 0;
    },
  });

  const { data: post, isLoading } = useQuery({
    queryKey: ["blog-cover", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data as DBPost;
    },
    enabled: !!slug,
  });

  // Redirect to full article until we have enough posts
  if (!isLoading && postCount < MIN_POSTS_FOR_COVER) {
    return <Navigate to={`/blog/${slug}`} replace />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-pulse text-neutral-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!post) {
    return <Navigate to="/blog" replace />;
  }

  const ogImage = post.featured_image_url || "https://designproai.com/hero-mustang.jpg";

  return (
    <>
      <Helmet>
        <title>{post.title} | DesignProAI</title>
        <meta name="description" content={post.description} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:type" content="article" />
      </Helmet>

      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          {/* Cover card */}
          <div className="overflow-hidden rounded-xl border border-neutral-200 shadow-sm bg-white">
            {/* Image — constrained height */}
            <div className="w-full h-48 sm:h-56 overflow-hidden bg-neutral-100 relative">
              <img
                src={ogImage}
                alt={post.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <span className="absolute top-3 left-3 text-[9px] font-medium tracking-widest uppercase text-white/80 bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded">
                DesignProAI
              </span>
            </div>

            {/* Content */}
            <div className="p-5">
              <h1 className="text-lg font-semibold text-neutral-900 leading-snug mb-2">
                {post.title}
              </h1>

              <p className="text-sm text-neutral-500 leading-relaxed mb-4">
                {post.description}
              </p>

              {post.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {post.tags.map((tag: string) => (
                    <span key={tag} className="text-[10px] font-medium text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-neutral-400 mb-4 pb-4 border-b border-neutral-100">
                <span>{post.author || "DesignProAI"}</span>
                <span>·</span>
                <span>{post.read_time}</span>
                <span>·</span>
                <span>{new Date(post.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>

              <Link
                to={`/blog/${post.slug}`}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors"
              >
                Read Article <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <p className="text-center text-[10px] text-neutral-400 mt-3 tracking-widest uppercase">
            Design. Output. Profit.
          </p>
        </div>
      </div>
    </>
  );
};

export default BlogCover;
