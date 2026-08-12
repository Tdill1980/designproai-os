import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Heart, ImagePlus, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { brandMeta } from "@/lib/content-tags";
import { toast } from "sonner";

/**
 * The Feed (/feed) — OUR OWN social platform (page component: WrapFeed) (docs/SOCIALIQ_SPEC.md).
 * First-party posts, likes, comments on our ground — engagement here needs
 * no Meta permissions and every commenter is an owned relationship. Native
 * comments mirror into SocialIQ automatically (DB trigger), where the same
 * trigger-word rules and reply machinery run.
 *
 * WHITE UI (customer-facing). Anyone can read; sign in to like/comment;
 * admins author brand posts.
 */

interface FeedPost {
  id: string;
  brand: string;
  author_name: string;
  caption: string | null;
  media_urls: string[];
  like_count: number;
  comment_count: number;
  created_at: string;
}

interface FeedComment {
  id: string;
  post_id: string;
  author_name: string;
  text: string;
  is_brand: boolean;
  brand_liked: boolean;
  created_at: string;
}

function displayName(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const meta = user?.user_metadata || {};
  return (meta.full_name as string) || (meta.name as string) || user?.email?.split("@")[0] || "Wrapper";
}

function PostCard({ post, userId, userName }: { post: FeedPost; userId: string | null; userName: string }) {
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");

  const { data: comments } = useQuery({
    queryKey: ["wrapfeed-comments", post.id],
    enabled: showComments,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_feed_comments")
        .select("id, post_id, author_name, text, is_brand, brand_liked, created_at")
        .eq("post_id", post.id)
        .eq("status", "published")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as FeedComment[];
    },
  });

  const { data: myLike } = useQuery({
    queryKey: ["wrapfeed-mylike", post.id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("social_feed_likes")
        .select("post_id")
        .eq("post_id", post.id)
        .eq("user_id", userId)
        .maybeSingle();
      return Boolean(data);
    },
  });

  const toggleLike = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in to like");
      const table = (supabase as any).from("social_feed_likes");
      const { error } = myLike
        ? await table.delete().eq("post_id", post.id).eq("user_id", userId)
        : await table.insert({ post_id: post.id, user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrapfeed-posts"] });
      queryClient.invalidateQueries({ queryKey: ["wrapfeed-mylike", post.id, userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in to comment");
      const { error } = await (supabase as any).from("social_feed_comments").insert({
        post_id: post.id,
        author_id: userId,
        author_name: userName,
        text: comment.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["wrapfeed-comments", post.id] });
      queryClient.invalidateQueries({ queryKey: ["wrapfeed-posts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="font-semibold text-sm">{post.author_name}</span>
        <BadgeCheck className="w-4 h-4 text-blue-500" />
        <span className="text-xs text-gray-500 ml-auto">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.media_urls[0] && (
        <img src={post.media_urls[0]} alt="" className="w-full max-h-[560px] object-cover" loading="lazy" />
      )}
      {post.caption && <p className="px-4 pt-3 text-sm whitespace-pre-line">{post.caption}</p>}
      <div className="flex items-center gap-4 px-4 py-3">
        <button
          onClick={() => toggleLike.mutate()}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-pink-500"
        >
          <Heart className={`w-5 h-5 ${myLike ? "fill-pink-500 text-pink-500" : ""}`} />
          {post.like_count}
        </button>
        <button
          onClick={() => setShowComments((s) => !s)}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-500"
        >
          <MessageCircle className="w-5 h-5" />
          {post.comment_count}
        </button>
      </div>
      {showComments && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2">
          {(comments || []).map((c) => (
            <div key={c.id} className={`text-sm ${c.is_brand ? "pl-4" : ""}`}>
              <span className={`font-semibold ${c.is_brand ? "bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent" : ""}`}>
                {c.author_name}
              </span>{" "}
              <span className="text-gray-700">{c.text}</span>
              {c.brand_liked && <Heart className="inline w-3 h-3 ml-1 fill-pink-500 text-pink-500" />}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={userId ? "Add a comment…" : "Sign in to comment"}
              disabled={!userId}
              className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              onKeyDown={(e) => e.key === "Enter" && comment.trim() && addComment.mutate()}
            />
            <Button
              size="sm"
              disabled={!userId || !comment.trim() || addComment.isPending}
              onClick={() => addComment.mutate()}
              className="rounded-full bg-gradient-to-r from-blue-500 to-pink-500 text-white"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function WrapFeed() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Wrapper");
  const [isAdmin, setIsAdmin] = useState(false);
  const [draft, setDraft] = useState({ caption: "", mediaUrl: "" });

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      setUserName(displayName(user));
      const { data } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
      setIsAdmin(Boolean(data));
    });
  }, []);

  const { data: posts, isLoading } = useQuery({
    queryKey: ["wrapfeed-posts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_feed_posts")
        .select("id, brand, author_name, caption, media_urls, like_count, comment_count, created_at")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as FeedPost[];
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("social_feed_posts").insert({
        brand: "weprintwraps",
        author_id: userId,
        author_name: "WePrintWraps",
        caption: draft.caption.trim() || null,
        media_urls: draft.mediaUrl.trim() ? [draft.mediaUrl.trim()] : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft({ caption: "", mediaUrl: "" });
      queryClient.invalidateQueries({ queryKey: ["wrapfeed-posts"] });
      toast.success("Posted to the feed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4 sm:p-6">
      <div className="max-w-xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            The <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Feed</span>
          </h1>
          <p className="text-sm text-gray-600">Real wraps, real installs — the industry's feed, on our ground.</p>
        </div>

        {isAdmin && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className={`h-1 bg-gradient-to-r ${brandMeta("weprintwraps").gradient}`} />
            <div className="p-4 space-y-2">
            <textarea
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              placeholder="Post to the feed as WePrintWraps…"
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                value={draft.mediaUrl}
                onChange={(e) => setDraft({ ...draft, mediaUrl: e.target.value })}
                placeholder="Image URL (render, install shot…)"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <Button
                size="sm"
                disabled={publish.isPending || (!draft.caption.trim() && !draft.mediaUrl.trim())}
                onClick={() => publish.mutate()}
                className="bg-gradient-to-r from-blue-500 to-pink-500 text-white"
              >
                <ImagePlus className="w-4 h-4 mr-1.5" /> Post
              </Button>
            </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-gray-500">Loading the feed…</p>
        ) : !posts?.length ? (
          <div className="border border-gray-200 rounded-2xl p-10 text-center text-gray-500">
            The feed is warming up — first posts land soon.
          </div>
        ) : (
          posts.map((p) => <PostCard key={p.id} post={p} userId={userId} userName={userName} />)
        )}
      </div>
    </div>
  );
}
