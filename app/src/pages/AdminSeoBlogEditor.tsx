import { useState, useEffect, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TipTapEditor } from "@/components/seo/TipTapEditor";
import { SeoScoreSidebar } from "@/components/seo/SeoScoreSidebar";
import { scoreSeoClient } from "@/lib/seo-scoring";
import {
  ArrowLeft,
  Save,
  Sparkles,
  Loader2,
  ExternalLink,
  Send,
  Trash2,
  Facebook,
  Instagram,
  MapPin,
  Share2,
  Link as LinkIcon,
  Check,
} from "lucide-react";

interface BlogPost {
  id: string;
  shop_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body_html: string | null;
  meta_title: string | null;
  meta_description: string | null;
  focus_keyword: string | null;
  keywords: string[];
  featured_image_url: string | null;
  intent: string;
  status: string;
  seo_score: number | null;
  seo_findings: unknown;
  schema_json: unknown;
  internal_links: unknown;
  external_url: string | null;
  external_post_id: string | null;
  external_status: string | null;
  external_synced_at: string | null;
  external_last_error: string | null;
  reading_time_min: number | null;
  published_at: string | null;
}

export default function AdminSeoBlogEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<BlogPost | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiFocus, setAiFocus] = useState("");
  const [aiSecondary, setAiSecondary] = useState("");
  const [aiTone, setAiTone] = useState("expert, no-fluff");
  const [aiIntent, setAiIntent] = useState<string>("");
  const [aiInternalLinks, setAiInternalLinks] = useState("");
  const [aiProducts, setAiProducts] = useState("");

  const post = useQuery({
    queryKey: ["seo-post", id],
    enabled: !!id,
    queryFn: async (): Promise<BlogPost | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("seo_blog_posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as BlogPost | null;
    },
  });

  useEffect(() => {
    if (post.data) setDraft(post.data);
  }, [post.data]);

  const liveScore = useMemo(() => {
    if (!draft) return { score: 0, findings: [], wordCount: 0 };
    return scoreSeoClient({
      metaTitle: draft.meta_title ?? draft.title ?? "",
      metaDescription: draft.meta_description ?? "",
      focusKeyword: draft.focus_keyword ?? "",
      bodyHtml: draft.body_html ?? "",
      hasSchema: !!draft.schema_json,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft?.meta_title,
    draft?.title,
    draft?.meta_description,
    draft?.focus_keyword,
    draft?.body_html,
    draft?.schema_json,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !id) throw new Error("No draft");
      const updates = {
        title: draft.title,
        slug: draft.slug,
        excerpt: draft.excerpt,
        body_html: draft.body_html,
        meta_title: draft.meta_title,
        meta_description: draft.meta_description,
        focus_keyword: draft.focus_keyword,
        keywords: draft.keywords,
        featured_image_url: draft.featured_image_url,
        intent: draft.intent,
        seo_score: liveScore.score,
        seo_findings: liveScore.findings,
      };
      const { error } = await supabase.from("seo_blog_posts").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["seo-post", id] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const aiGenerate = useMutation({
    mutationFn: async () => {
      if (!currentShop || !id) throw new Error("No context");
      const internal_link_targets = aiInternalLinks
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [url, ...rest] = l.split("|").map((s) => s.trim());
          return { url, anchor_hint: rest[0] ?? "", description: rest[1] ?? "" };
        });
      const product_context = aiProducts
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, url, description] = l.split("|").map((s) => s.trim());
          return { name, url, description };
        });
      const { data, error } = await supabase.functions.invoke("seo-blog-generate", {
        body: {
          shop_id: currentShop.id,
          topic: aiTopic,
          focus_keyword: aiFocus,
          secondary_keywords: aiSecondary
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          tone: aiTone,
          intent: aiIntent || undefined,
          internal_link_targets,
          product_context,
          draft_post_id: id,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: () => {
      toast({ title: "AI draft generated" });
      setAiOpen(false);
      qc.invalidateQueries({ queryKey: ["seo-post", id] });
    },
    onError: (e: Error) =>
      toast({ title: "AI draft failed", description: e.message, variant: "destructive" }),
  });

  const publish = useMutation({
    mutationFn: async (status: "draft" | "publish") => {
      if (!id) throw new Error("No id");
      // Save first
      await save.mutateAsync();
      const { data, error } = await supabase.functions.invoke("seo-wp-publish", {
        body: { post_id: id, status },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: (_, status) => {
      toast({
        title: status === "publish" ? "Published live" : "Pushed to WordPress as draft",
      });
      qc.invalidateQueries({ queryKey: ["seo-post", id] });
    },
    onError: (e: Error) =>
      toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No id");
      const { error } = await supabase.from("seo_blog_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      navigate("/admin/seo/blog");
    },
  });

  if (post.isLoading || !draft) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/blog">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{draft.title || "Untitled draft"}</h1>
              <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                <Badge variant="outline" className="text-[10px] capitalize">{draft.status}</Badge>
                {draft.external_url && (
                  <a
                    href={draft.external_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-zinc-300"
                  >
                    Live on WP <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {draft.external_last_error && (
                  <span className="text-red-400">Last error: {draft.external_last_error}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Dialog open={aiOpen} onOpenChange={setAiOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Sparkles className="h-4 w-4 mr-1" /> AI Writer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Generate post with Claude</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Topic</Label>
                    <Input
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="e.g. Best 3M vinyl wrap films for matte finishes"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Focus keyword</Label>
                      <Input
                        value={aiFocus}
                        onChange={(e) => setAiFocus(e.target.value)}
                        placeholder="3m matte vinyl wrap"
                      />
                    </div>
                    <div>
                      <Label>Intent</Label>
                      <Select value={aiIntent} onValueChange={setAiIntent}>
                        <SelectTrigger>
                          <SelectValue placeholder="Auto (based on shop type)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buyer_intent">Buyer intent</SelectItem>
                          <SelectItem value="comparison">Comparison</SelectItem>
                          <SelectItem value="how_to">How-to</SelectItem>
                          <SelectItem value="informational">Informational</SelectItem>
                          <SelectItem value="local_landing">Local landing</SelectItem>
                          <SelectItem value="product_landing">Product landing</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Secondary keywords</Label>
                    <Input
                      value={aiSecondary}
                      onChange={(e) => setAiSecondary(e.target.value)}
                      placeholder="comma, separated, keywords"
                    />
                  </div>
                  <div>
                    <Label>Tone</Label>
                    <Input
                      value={aiTone}
                      onChange={(e) => setAiTone(e.target.value)}
                      placeholder="e.g. expert but friendly"
                    />
                  </div>
                  <div>
                    <Label>Internal link targets</Label>
                    <Textarea
                      value={aiInternalLinks}
                      onChange={(e) => setAiInternalLinks(e.target.value)}
                      placeholder={"One per line. Format: url | anchor hint | optional description\n/products/3m-2080 | 3M 2080 | Our top-selling matte film"}
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Products to feature</Label>
                    <Textarea
                      value={aiProducts}
                      onChange={(e) => setAiProducts(e.target.value)}
                      placeholder={"One per line. Format: name | url | optional description\n3M 2080 Satin Black | /products/3m-2080-satin-black | Our bestseller"}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setAiOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => aiGenerate.mutate()}
                    disabled={aiGenerate.isPending || !aiTopic || !aiFocus}
                  >
                    {aiGenerate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Generate
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="sm"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => publish.mutate("draft")}
              disabled={publish.isPending}
            >
              Push as draft
            </Button>
            <Button
              size="sm"
              onClick={() => publish.mutate("publish")}
              disabled={publish.isPending}
            >
              {publish.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <Send className="h-4 w-4 mr-1" /> Publish
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Delete this post?")) del.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="The post title — also used as H1 on the published page"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Slug</Label>
                  <Input
                    value={draft.slug}
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                    placeholder="kebab-case-url-slug"
                  />
                </div>
                <div>
                  <Label>Focus keyword</Label>
                  <Input
                    value={draft.focus_keyword ?? ""}
                    onChange={(e) => setDraft({ ...draft, focus_keyword: e.target.value })}
                    placeholder="primary keyword to rank for"
                  />
                </div>
              </div>
              <div>
                <Label>Featured image URL</Label>
                <Input
                  value={draft.featured_image_url ?? ""}
                  onChange={(e) => setDraft({ ...draft, featured_image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Excerpt</Label>
                <Textarea
                  value={draft.excerpt ?? ""}
                  onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                  rows={2}
                  placeholder="1-2 sentence summary shown on archive pages"
                />
              </div>
            </Card>

            <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Search appearance</div>
              <div>
                <Label>
                  Meta title{" "}
                  <span className="text-xs text-zinc-500">
                    ({(draft.meta_title ?? "").length}/60)
                  </span>
                </Label>
                <Input
                  value={draft.meta_title ?? ""}
                  onChange={(e) => setDraft({ ...draft, meta_title: e.target.value })}
                  placeholder="Title shown in Google search results"
                />
              </div>
              <div>
                <Label>
                  Meta description{" "}
                  <span className="text-xs text-zinc-500">
                    ({(draft.meta_description ?? "").length}/160)
                  </span>
                </Label>
                <Textarea
                  value={draft.meta_description ?? ""}
                  onChange={(e) => setDraft({ ...draft, meta_description: e.target.value })}
                  rows={2}
                  placeholder="Description shown under the title in Google"
                />
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="text-xs text-zinc-500 mb-1">Google preview</div>
                <div className="text-blue-400 text-base truncate">
                  {draft.meta_title || draft.title || "Your title here"}
                </div>
                <div className="text-emerald-600 text-xs truncate">
                  {(draft.external_url || `https://example.com/${draft.slug}`).slice(0, 80)}
                </div>
                <div className="text-zinc-300 text-sm mt-0.5 line-clamp-2">
                  {draft.meta_description || "Your meta description will appear here once filled in."}
                </div>
              </div>
            </Card>

            <Card className="bg-zinc-950 border-zinc-800 p-4">
              <Label className="mb-2 block">Body</Label>
              <TipTapEditor
                value={draft.body_html ?? ""}
                onChange={(html) => setDraft({ ...draft, body_html: html })}
                placeholder="Click AI Writer to draft a full post, or start writing here…"
              />
            </Card>
          </div>

          <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
            <SeoScoreSidebar
              score={liveScore.score}
              findings={liveScore.findings}
              metaTitle={draft.meta_title ?? ""}
              metaDescription={draft.meta_description ?? ""}
              focusKeyword={draft.focus_keyword ?? ""}
              wordCount={liveScore.wordCount}
            />
            {currentShop && (
              <DistributePanel
                shopId={currentShop.id}
                postId={draft.id}
                externalUrl={draft.external_url}
                title={draft.title}
                excerpt={draft.excerpt}
                metaDescription={draft.meta_description}
                featuredImageUrl={draft.featured_image_url}
              />
            )}
            {currentShop && (
              <InternalLinksPanel
                shopId={currentShop.id}
                postId={draft.id}
                bodyHtml={draft.body_html ?? ""}
                cachedLinks={draft.internal_links}
                onUpdateBody={(html) => setDraft({ ...draft, body_html: html })}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Distribute panel — push published post to FB / IG / GBP ──────────────
interface DistributePanelProps {
  shopId: string;
  postId: string;
  externalUrl: string | null;
  title: string;
  excerpt: string | null;
  metaDescription: string | null;
  featuredImageUrl: string | null;
}

function DistributePanel({
  shopId,
  postId,
  externalUrl,
  title,
  excerpt,
  metaDescription,
  featuredImageUrl,
}: DistributePanelProps) {
  const { toast } = useToast();
  const [results, setResults] = useState<Record<string, string>>({});

  const distributeMeta = useMutation({
    mutationFn: async (channels: Array<"facebook" | "instagram">) => {
      const { data, error } = await supabase.functions.invoke("seo-meta-publish", {
        body: { action: "distribute_blog_post", shop_id: shopId, post_id: postId, channels },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { results: Record<string, unknown> };
    },
    onSuccess: (d, channels) => {
      const next: Record<string, string> = {};
      for (const ch of channels) {
        const r = d.results?.[ch] as { error?: string; id?: string } | undefined;
        next[ch] = r?.error ? `Error: ${r.error}` : "Posted";
      }
      setResults((prev) => ({ ...prev, ...next }));
      toast({ title: "Distributed", description: channels.join(", ") });
    },
    onError: (e: Error) =>
      toast({ title: "Distribute failed", description: e.message, variant: "destructive" }),
  });

  const postToGbp = useMutation({
    mutationFn: async () => {
      if (!externalUrl) throw new Error("Post must be published first");
      const summary = (excerpt || metaDescription || `${title}`).slice(0, 1500);
      const { data, error } = await supabase.functions.invoke("seo-google-business", {
        body: {
          action: "create_post",
          shop_id: shopId,
          summary,
          topic_type: "STANDARD",
          call_to_action: { actionType: "LEARN_MORE", url: externalUrl },
          media_url: featuredImageUrl ?? undefined,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      setResults((p) => ({ ...p, gbp: "Posted" }));
      toast({ title: "Posted to Google Business Profile" });
    },
    onError: (e: Error) => {
      setResults((p) => ({ ...p, gbp: `Error: ${e.message}` }));
      toast({ title: "GBP post failed", description: e.message, variant: "destructive" });
    },
  });

  const isPublished = !!externalUrl;

  return (
    <Card className="bg-zinc-950 border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Share2 className="h-4 w-4 text-cyan-400" />
        <h3 className="font-semibold">Distribute</h3>
      </div>
      {!isPublished ? (
        <p className="text-xs text-zinc-500">
          Publish this post to WordPress first, then you'll be able to share it to Facebook,
          Instagram, and Google Business Profile.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Push this post out to social + local channels. Each requires the relevant connection
            in <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
            /admin/seo/connections</Link>.
          </p>

          <DistributeButton
            icon={<Facebook className="h-4 w-4" />}
            label="Post to Facebook"
            status={results.facebook}
            loading={distributeMeta.isPending}
            onClick={() => distributeMeta.mutate(["facebook"])}
          />
          <DistributeButton
            icon={<Instagram className="h-4 w-4" />}
            label="Post to Instagram"
            status={results.instagram}
            loading={distributeMeta.isPending}
            disabled={!featuredImageUrl}
            disabledReason="Needs a featured image"
            onClick={() => distributeMeta.mutate(["instagram"])}
          />
          <DistributeButton
            icon={<MapPin className="h-4 w-4" />}
            label="Post to GBP"
            status={results.gbp}
            loading={postToGbp.isPending}
            onClick={() => postToGbp.mutate()}
          />
        </div>
      )}
    </Card>
  );
}

// ─── Internal-link suggestions ────────────────────────────────────────────
interface InternalLinkSuggestion {
  anchor: string;
  url: string;
  rationale: string;
}

interface InternalLinksPanelProps {
  shopId: string;
  postId: string;
  bodyHtml: string;
  cachedLinks: unknown;
  onUpdateBody: (html: string) => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wrap the first occurrence of `anchor` in body_html with an <a href="url">.
// We deliberately operate outside HTML tags so we don't smash existing markup.
function insertAnchor(html: string, anchor: string, url: string): string | null {
  if (!anchor) return null;
  const safeAnchor = escapeRegex(anchor);
  // Match the anchor only when it's not already inside an <a> tag's attributes
  // or content. We split on tags to keep replacement simple.
  const parts = html.split(/(<[^>]+>)/g);
  const re = new RegExp(`(${safeAnchor})`, "i");
  let inAnchorTag = 0;
  let replaced = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("<")) {
      if (/^<a\b/i.test(part)) inAnchorTag++;
      else if (/^<\/a>/i.test(part)) inAnchorTag = Math.max(0, inAnchorTag - 1);
      continue;
    }
    if (inAnchorTag > 0) continue;
    if (re.test(part)) {
      parts[i] = part.replace(
        re,
        `<a href="${url}" data-internal-link="1">$1</a>`,
      );
      replaced = true;
      break;
    }
  }
  return replaced ? parts.join("") : null;
}

function InternalLinksPanel({
  shopId,
  postId,
  bodyHtml,
  cachedLinks,
  onUpdateBody,
}: InternalLinksPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inserted, setInserted] = useState<Record<string, boolean>>({});

  const initialFromCache = useMemo<InternalLinkSuggestion[]>(() => {
    if (!Array.isArray(cachedLinks)) return [];
    return (cachedLinks as InternalLinkSuggestion[]).filter(
      (l) => l && typeof l.anchor === "string" && typeof l.url === "string",
    );
  }, [cachedLinks]);

  const [suggestions, setSuggestions] = useState<InternalLinkSuggestion[]>(initialFromCache);
  useEffect(() => {
    setSuggestions(initialFromCache);
  }, [initialFromCache]);

  const suggest = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-internal-links", {
        body: { action: "suggest", shop_id: shopId, post_id: postId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return (data as { suggestions: InternalLinkSuggestion[] }).suggestions ?? [];
    },
    onSuccess: (list) => {
      setSuggestions(list);
      setInserted({});
      toast({ title: `${list.length} internal-link suggestion${list.length === 1 ? "" : "s"}` });
      qc.invalidateQueries({ queryKey: ["seo-post", postId] });
    },
    onError: (e: Error) =>
      toast({
        title: "Suggest failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const insert = (s: InternalLinkSuggestion) => {
    const next = insertAnchor(bodyHtml, s.anchor, s.url);
    if (!next) {
      toast({
        title: "Anchor not found",
        description: `"${s.anchor}" is no longer in the body — edit the body, then click Suggest links again.`,
        variant: "destructive",
      });
      return;
    }
    onUpdateBody(next);
    setInserted((p) => ({ ...p, [`${s.anchor}::${s.url}`]: true }));
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-cyan-400" />
          <h3 className="font-semibold">Internal links</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending || !bodyHtml || bodyHtml.length < 200}
        >
          {suggest.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          Suggest
        </Button>
      </div>
      {suggestions.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {bodyHtml.length < 200
            ? "Write at least a paragraph, then click Suggest to get AI-picked anchor links."
            : "No suggestions cached yet. Click Suggest to ask Claude for 5-10 internal links."}
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s, i) => {
            const key = `${s.anchor}::${s.url}`;
            const done = inserted[key];
            return (
              <li
                key={`${i}-${key}`}
                className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-200 truncate">
                      "{s.anchor}"
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">
                      → {s.url}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={done ? "ghost" : "outline"}
                    onClick={() => insert(s)}
                    disabled={done}
                    className="shrink-0 h-7 px-2"
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      "Insert"
                    )}
                  </Button>
                </div>
                {s.rationale && (
                  <div className="text-[10px] text-zinc-500">{s.rationale}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DistributeButton({
  icon,
  label,
  status,
  loading,
  disabled,
  disabledReason,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  status?: string;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  const isError = status?.startsWith("Error");
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        className="w-full justify-start"
        onClick={onClick}
        disabled={disabled || loading}
      >
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <span className="mr-2">{icon}</span>}
        {label}
      </Button>
      {disabled && disabledReason && (
        <p className="text-[10px] text-zinc-500 ml-2">{disabledReason}</p>
      )}
      {status && (
        <p className={`text-[10px] ml-2 ${isError ? "text-red-400" : "text-emerald-400"}`}>
          {status}
        </p>
      )}
    </div>
  );
}
