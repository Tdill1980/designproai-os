import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Plus, Trash2, Calendar, ExternalLink } from "lucide-react";

interface ScheduledPost {
  id: string;
  shop_id: string;
  summary: string;
  topic_type: string;
  call_to_action: { actionType?: string; url?: string } | null;
  media_url: string | null;
  scheduled_for: string;
  status: "pending" | "posted" | "error" | "cancelled";
  posted_at: string | null;
  error: string | null;
  created_at: string;
}

const TOPIC_OPTIONS = [
  { value: "STANDARD", label: "Standard" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
  { value: "ALERT", label: "Alert" },
];

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "Learn more" },
  { value: "BOOK", label: "Book" },
  { value: "ORDER", label: "Order online" },
  { value: "SHOP", label: "Shop" },
  { value: "SIGN_UP", label: "Sign up" },
  { value: "CALL", label: "Call" },
];

function nowPlusHourLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  // Format as YYYY-MM-DDTHH:mm in local time for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function AdminSeoGbpPosts() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [summary, setSummary] = useState("");
  const [topicType, setTopicType] = useState("STANDARD");
  const [ctaType, setCtaType] = useState<string>("LEARN_MORE");
  const [ctaUrl, setCtaUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState(nowPlusHourLocal());

  const list = useQuery({
    queryKey: ["seo-gbp-scheduled-posts", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async () => {
      if (!currentShop) return { posts: [] as ScheduledPost[] };
      const { data, error } = await supabase.functions.invoke("seo-gbp-scheduler", {
        body: { action: "list", shop_id: currentShop.id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { posts: ScheduledPost[] };
    },
    retry: false,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop");
      const payload: Record<string, unknown> = {
        action: "create",
        shop_id: currentShop.id,
        summary: summary.trim(),
        topic_type: topicType,
        scheduled_for: new Date(scheduledFor).toISOString(),
      };
      if (ctaUrl.trim()) {
        payload.call_to_action = { actionType: ctaType, url: ctaUrl.trim() };
      }
      if (mediaUrl.trim()) payload.media_url = mediaUrl.trim();
      const { data, error } = await supabase.functions.invoke("seo-gbp-scheduler", {
        body: payload,
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Scheduled" });
      setSummary("");
      setCtaUrl("");
      setMediaUrl("");
      setScheduledFor(nowPlusHourLocal());
      qc.invalidateQueries({ queryKey: ["seo-gbp-scheduled-posts", currentShop?.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Schedule failed", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke("seo-gbp-scheduler", {
        body: { action: "delete", shop_id: currentShop.id, id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast({ title: "Cancelled" });
      qc.invalidateQueries({ queryKey: ["seo-gbp-scheduled-posts", currentShop?.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    const posts = list.data?.posts ?? [];
    const map = new Map<string, ScheduledPost[]>();
    for (const p of posts) {
      const day = new Date(p.scheduled_for).toLocaleDateString();
      const arr = map.get(day) ?? [];
      arr.push(p);
      map.set(day, arr);
    }
    return Array.from(map.entries());
  }, [list.data]);

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to schedule GBP posts.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/seo">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">GBP scheduler</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Queue Google Business Profile posts. A cron job dispatches due
              posts every 5 minutes via the connected GBP location.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
          <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Schedule a post
            </div>
            <div>
              <Label>Summary</Label>
              <Textarea
                rows={5}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What's new at the shop? Up to ~1500 chars."
              />
              <div className="text-[10px] text-zinc-500 mt-1 text-right">
                {summary.length}/1500
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Topic type</Label>
                <Select value={topicType} onValueChange={setTopicType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOPIC_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Schedule for</Label>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CTA</Label>
                <Select value={ctaType} onValueChange={setCtaType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>CTA URL (optional)</Label>
                <Input
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
            <div>
              <Label>Media URL (optional)</Label>
              <Input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://…/image.jpg"
              />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !summary.trim() || !scheduledFor}
              className="w-full"
            >
              {create.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Schedule post
            </Button>
            <p className="text-[10px] text-zinc-500">
              Requires Google Business Profile connected on{" "}
              <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
                /admin/seo/connections
              </Link>{" "}
              with a location selected.
            </p>
          </Card>

          <div className="space-y-4">
            <Card className="bg-zinc-950 border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-cyan-400" />
                <h2 className="text-lg font-semibold">Queue</h2>
              </div>
              {list.isLoading ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : list.error ? (
                <div className="text-sm">
                  <div className="text-red-400">Could not load scheduled posts.</div>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    {list.error instanceof Error ? list.error.message : "Unknown"}
                  </p>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Make sure GBP is connected in{" "}
                    <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
                      /admin/seo/connections
                    </Link>
                    .
                  </p>
                </div>
              ) : grouped.length === 0 ? (
                <p className="text-zinc-500 text-sm">
                  No posts scheduled yet — fill in the form on the left.
                </p>
              ) : (
                <div className="space-y-4">
                  {grouped.map(([day, posts]) => (
                    <div key={day}>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                        {day}
                      </div>
                      <ul className="space-y-2">
                        {posts.map((p) => (
                          <li
                            key={p.id}
                            className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <StatusBadge status={p.status} />
                                  <span className="text-[11px] text-zinc-500">
                                    {new Date(p.scheduled_for).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                  <Badge variant="outline" className="text-[10px]">
                                    {p.topic_type}
                                  </Badge>
                                </div>
                                <p className="text-sm text-zinc-200 mt-1 line-clamp-3 whitespace-pre-wrap">
                                  {p.summary}
                                </p>
                                {p.call_to_action?.url && (
                                  <a
                                    href={p.call_to_action.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-cyan-400 hover:underline inline-flex items-center gap-1 mt-1"
                                  >
                                    {p.call_to_action.actionType ?? "CTA"}{" "}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                {p.error && (
                                  <p className="text-[11px] text-red-400 mt-1">
                                    {p.error}
                                  </p>
                                )}
                              </div>
                              {p.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => cancel.mutate(p.id)}
                                  disabled={cancel.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-zinc-500" />
                                </Button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ScheduledPost["status"] }) {
  switch (status) {
    case "posted":
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
          Posted
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Error
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" className="text-[10px]">
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge className="bg-cyan-600 hover:bg-cyan-600 text-[10px]">
          Pending
        </Badge>
      );
  }
}
