import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Loader2, ExternalLink, Trash2 } from "lucide-react";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  status: string;
  seo_score: number | null;
  intent: string;
  external_url: string | null;
  updated_at: string;
  published_at: string | null;
  focus_keyword: string | null;
}

export default function AdminSeoBlogList() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const posts = useQuery({
    queryKey: ["seo-blog-posts", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<BlogPost[]> => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("seo_blog_posts")
        .select("id, title, slug, status, seo_score, intent, external_url, updated_at, published_at, focus_keyword")
        .eq("shop_id", currentShop.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BlogPost[];
    },
  });

  const newPost = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase
        .from("seo_blog_posts")
        .insert({
          shop_id: currentShop.id,
          title: "Untitled draft",
          slug: `draft-${Date.now()}`,
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d: { id: string }) => {
      window.location.href = `/admin/seo/blog/${d.id}`;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("seo_blog_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["seo-blog-posts", currentShop?.id] });
    },
  });

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">SEO Blog Posts</h1>
          </div>
          <Button onClick={() => newPost.mutate()} disabled={newPost.isPending}>
            {newPost.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            New post
          </Button>
        </div>

        <Card className="bg-zinc-950 border-zinc-800">
          {posts.isLoading ? (
            <div className="p-12 text-center text-zinc-500">Loading…</div>
          ) : (posts.data ?? []).length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              No posts yet.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {(posts.data ?? []).map((p) => (
                <li key={p.id} className="p-4 hover:bg-zinc-900/50 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <Link to={`/admin/seo/blog/${p.id}`} className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.title || "(untitled)"}</div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                        <Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge>
                        <span className="capitalize">{p.intent.replace(/_/g, " ")}</span>
                        {p.focus_keyword && (
                          <>
                            <span>·</span>
                            <span>{p.focus_keyword}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                      </div>
                    </Link>

                    <div className="flex items-center gap-3">
                      {p.seo_score !== null && (
                        <div
                          className={`text-2xl font-semibold ${
                            p.seo_score >= 80
                              ? "text-emerald-400"
                              : p.seo_score >= 60
                              ? "text-amber-400"
                              : "text-red-400"
                          }`}
                        >
                          {p.seo_score}
                        </div>
                      )}
                      {p.external_url && (
                        <a
                          href={p.external_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-500 hover:text-zinc-200"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${p.title}"?`)) del.mutate(p.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
