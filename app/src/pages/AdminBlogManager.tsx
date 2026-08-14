import { useState } from "react";
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
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Image as ImageIcon,
  Calendar as CalendarIcon,
  Eye,
  FileText,
  Clock,
  Megaphone,
} from "lucide-react";
import { Link } from "react-router-dom";

// ── Types ──────────────────────────────────────────────────────────
interface BlogPost {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: string;
  featured_image_url: string | null;
  tags: string[];
  author: string;
  read_time: string;
  status: "draft" | "scheduled" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

type EditorPost = Omit<BlogPost, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

const EMPTY_POST: EditorPost = {
  title: "",
  slug: "",
  description: "",
  content: "",
  featured_image_url: null,
  tags: [],
  author: "DesignProAI",
  read_time: "5 min read",
  status: "draft",
  published_at: null,
};

// ── Helpers ────────────────────────────────────────────────────────
const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const statusColor = (s: string) => {
  if (s === "published") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (s === "scheduled") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Component ──────────────────────────────────────────────────────
const AdminBlogManager = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // View state
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Editor state
  const [editing, setEditing] = useState<EditorPost | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tagsInput, setTagsInput] = useState("");

  // ── Data ─────────────────────────────────────────────────────────
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["admin-blog-posts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blog_posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BlogPost[];
    },
  });

  // ── Mutations ────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (post: EditorPost) => {
      const payload = {
        title: post.title,
        slug: post.slug,
        description: post.description,
        content: post.content,
        featured_image_url: post.featured_image_url,
        tags: post.tags,
        author: post.author,
        read_time: post.read_time,
        status: post.status,
        published_at: post.published_at,
        updated_at: new Date().toISOString(),
      };
      if (post.id) {
        const { error } = await (supabase as any)
          .from("blog_posts")
          .update(payload)
          .eq("id", post.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("blog_posts")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      toast({ title: "Saved", description: "Blog post saved successfully." });
      setEditing(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("blog_posts")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      toast({ title: "Deleted", description: "Blog post deleted." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Image Upload ─────────────────────────────────────────────────
  const handleImageUpload = async (file: File) => {
    if (!editing) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `blog/${Date.now()}-${slugify(editing.title || "post")}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("blog-images")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        // Bucket might not exist — try patterns bucket as fallback
        const fallbackName = `blog/${Date.now()}-${slugify(editing.title || "post")}.${ext}`;
        const { error: fallbackError } = await supabase.storage
          .from("patterns")
          .upload(fallbackName, file, { upsert: true });
        if (fallbackError) throw fallbackError;
        const { data: urlData } = supabase.storage
          .from("patterns")
          .getPublicUrl(fallbackName);
        setEditing({ ...editing, featured_image_url: urlData.publicUrl });
      } else {
        const { data: urlData } = supabase.storage
          .from("blog-images")
          .getPublicUrl(fileName);
        setEditing({ ...editing, featured_image_url: urlData.publicUrl });
      }
      toast({ title: "Uploaded", description: "Image uploaded successfully." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ── Editor Open ──────────────────────────────────────────────────
  const openEditor = (post?: BlogPost) => {
    if (post) {
      setEditing({ ...post });
      setTagsInput((post.tags || []).join(", "));
    } else {
      setEditing({ ...EMPTY_POST });
      setTagsInput("");
    }
  };

  // ── Calendar helpers ─────────────────────────────────────────────
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay();
  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const postsForDay = (day: number) =>
    posts.filter((p) => {
      const d = p.published_at ? new Date(p.published_at) : new Date(p.created_at);
      return d.getFullYear() === calYear && d.getMonth() === calMonth && d.getDate() === day;
    });

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-oswald text-foreground">Blog Manager</h1>
              <p className="text-sm text-muted-foreground">
                {posts.length} post{posts.length !== 1 ? "s" : ""} &middot;{" "}
                {posts.filter((p) => p.status === "published").length} published
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/marketing-hub"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-primary/30 transition-colors"
            >
              <Megaphone className="w-3.5 h-3.5" />
              Engine Room
            </Link>
            <div className="flex bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setView("list")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarIcon className="w-4 h-4" />
              </button>
            </div>
            <Button onClick={() => openEditor()} className="gap-2">
              <Plus className="w-4 h-4" /> New Post
            </Button>
          </div>
        </div>

        {/* ── List View ───────────────────────────────────────────── */}
        {view === "list" && (
          <div className="space-y-3">
            {isLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="p-4 animate-pulse bg-card border-border">
                    <div className="h-5 bg-muted rounded w-1/3 mb-2" />
                    <div className="h-4 bg-muted rounded w-2/3" />
                  </Card>
                ))}
              </div>
            )}
            {!isLoading && posts.length === 0 && (
              <Card className="p-12 text-center border-border bg-card">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No blog posts yet</h3>
                <p className="text-muted-foreground mb-6">Create your first post to get started.</p>
                <Button onClick={() => openEditor()} className="gap-2">
                  <Plus className="w-4 h-4" /> Create First Post
                </Button>
              </Card>
            )}
            {posts.map((post) => (
              <Card
                key={post.id}
                className="p-4 border-border bg-card hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* Thumbnail */}
                  {post.featured_image_url ? (
                    <img
                      src={post.featured_image_url}
                      alt=""
                      className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-14 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground truncate">{post.title}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor(
                          post.status
                        )}`}
                      >
                        {post.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{post.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {post.read_time}
                      </span>
                      {post.published_at && (
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="w-3 h-3" />
                          {new Date(post.published_at).toLocaleDateString()}
                        </span>
                      )}
                      {post.tags?.length > 0 && (
                        <span>{post.tags.join(", ")}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => window.open(`/blog/${post.slug}`, "_blank")}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditor(post)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("Delete this post?")) deleteMutation.mutate(post.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* ── Calendar View ───────────────────────────────────────── */}
        {view === "calendar" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="ghost"
                onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
              >
                &larr;
              </Button>
              <h2 className="text-lg font-semibold text-foreground font-oswald">
                {MONTHS[calMonth]} {calYear}
              </h2>
              <Button
                variant="ghost"
                onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
              >
                &rarr;
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="bg-card p-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-card p-2 min-h-[80px]" />
              ))}
              {calendarDays.map((day) => {
                const dayPosts = postsForDay(day);
                const isToday =
                  day === new Date().getDate() &&
                  calMonth === new Date().getMonth() &&
                  calYear === new Date().getFullYear();
                return (
                  <div
                    key={day}
                    className={`bg-card p-2 min-h-[80px] ${isToday ? "ring-1 ring-primary" : ""}`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        isToday ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {day}
                    </span>
                    {dayPosts.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openEditor(p)}
                        className={`block w-full text-left mt-1 px-1.5 py-0.5 rounded text-[10px] leading-tight truncate border ${statusColor(
                          p.status
                        )}`}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Editor Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-oswald">
              {editing?.id ? "Edit Post" : "New Blog Post"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-5 mt-2">
              {/* Title */}
              <div>
                <Label>Title</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    const autoSlug = !editing.id ? slugify(title) : editing.slug;
                    setEditing({ ...editing, title, slug: autoSlug });
                  }}
                  placeholder="How Much Does a Vehicle Wrap Cost?"
                />
              </div>

              {/* Slug */}
              <div>
                <Label>URL Slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">/blog/</span>
                  <Input
                    value={editing.slug}
                    onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                    placeholder="how-much-does-a-vehicle-wrap-cost"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <Label>Description (SEO)</Label>
                <Textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Brief description for search engines and social sharing..."
                  rows={2}
                />
              </div>

              {/* Featured Image */}
              <div>
                <Label>Featured Image</Label>
                <div className="mt-2">
                  {editing.featured_image_url ? (
                    <div className="relative group">
                      <img
                        src={editing.featured_image_url}
                        alt="Featured"
                        className="w-full h-48 object-cover rounded-lg"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditing({ ...editing, featured_image_url: null })}
                        >
                          Remove
                        </Button>
                        <label className="cursor-pointer">
                          <Button variant="secondary" size="sm" asChild>
                            <span>Replace</span>
                          </Button>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          {uploading ? "Uploading..." : "Click to upload featured image"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Design in Canva, export PNG/JPG, drop it here
                        </p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Content */}
              <div>
                <Label>Content (HTML)</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Use &lt;h2&gt;, &lt;h3&gt;, &lt;p&gt;, &lt;strong&gt;, &lt;ul&gt;/&lt;li&gt;, &lt;a href&gt; tags.
                  Add images with: &lt;img src="url" alt="description" /&gt;
                </p>
                <Textarea
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  placeholder="<h2>Introduction</h2>\n<p>Write your content here...</p>"
                  rows={14}
                  className="font-mono text-sm"
                />
              </div>

              {/* Inline Image Upload for Content */}
              <div>
                <Label>Upload Image for Content</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Upload an image, then copy the URL into your content as an &lt;img&gt; tag.
                </p>
                <label className="cursor-pointer inline-block">
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <span>
                      <ImageIcon className="w-4 h-4" />
                      Upload Content Image
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      try {
                        const ext = file.name.split(".").pop() || "jpg";
                        const fileName = `blog/content/${Date.now()}.${ext}`;
                        const { error } = await supabase.storage
                          .from("blog-images")
                          .upload(fileName, file, { upsert: true });
                        let url: string;
                        if (error) {
                          const fallback = `blog/content/${Date.now()}.${ext}`;
                          const { error: fbErr } = await supabase.storage
                            .from("patterns")
                            .upload(fallback, file, { upsert: true });
                          if (fbErr) throw fbErr;
                          url = supabase.storage.from("patterns").getPublicUrl(fallback).data.publicUrl;
                        } else {
                          url = supabase.storage.from("blog-images").getPublicUrl(fileName).data.publicUrl;
                        }
                        await navigator.clipboard.writeText(`<img src="${url}" alt="" class="rounded-lg w-full" />`);
                        toast({ title: "Copied!", description: "Image tag copied to clipboard — paste it into your content." });
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>
              </div>

              {/* Meta row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label>Status</Label>
                  <Select
                    value={editing.status}
                    onValueChange={(v: any) => setEditing({ ...editing, status: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Publish Date</Label>
                  <Input
                    type="datetime-local"
                    value={editing.published_at ? editing.published_at.slice(0, 16) : ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        published_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Read Time</Label>
                  <Input
                    value={editing.read_time}
                    onChange={(e) => setEditing({ ...editing, read_time: e.target.value })}
                    placeholder="5 min read"
                  />
                </div>
                <div>
                  <Label>Author</Label>
                  <Input
                    value={editing.author}
                    onChange={(e) => setEditing({ ...editing, author: e.target.value })}
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <Label>Tags (comma-separated)</Label>
                <Input
                  value={tagsInput}
                  onChange={(e) => {
                    setTagsInput(e.target.value);
                    setEditing({
                      ...editing,
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                  }}
                  placeholder="Pricing, Guide, Vehicle Wraps"
                />
              </div>

              {/* Save */}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => saveMutation.mutate(editing)}
                  disabled={!editing.title || !editing.slug || saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving..." : editing.id ? "Update Post" : "Create Post"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminBlogManager;
