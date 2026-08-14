import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Sparkles, Send, Star, RefreshCw } from "lucide-react";

type StarRating =
  | "STAR_RATING_UNSPECIFIED"
  | "ONE"
  | "TWO"
  | "THREE"
  | "FOUR"
  | "FIVE";

interface GbpReview {
  name: string;
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: StarRating;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

const RATING_TO_NUM: Record<StarRating, number> = {
  STAR_RATING_UNSPECIFIED: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export default function AdminSeoReviews() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});

  const reviews = useQuery({
    queryKey: ["seo-gbp-reviews", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async () => {
      if (!currentShop) return { reviews: [] as GbpReview[], total: 0 };
      const { data, error } = await supabase.functions.invoke("seo-google-business", {
        body: { action: "list_reviews", shop_id: currentShop.id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { reviews: GbpReview[]; total: number };
    },
    retry: false,
  });

  const suggest = useMutation({
    mutationFn: async (review: GbpReview) => {
      if (!currentShop) throw new Error("No shop");
      const rating = review.starRating ? RATING_TO_NUM[review.starRating] : 5;
      const { data, error } = await supabase.functions.invoke("seo-google-business", {
        body: {
          action: "suggest_review_reply",
          shop_id: currentShop.id,
          review_text: review.comment ?? "",
          reviewer: review.reviewer?.displayName ?? "the reviewer",
          rating,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return { reviewName: review.name, reply: (data as { reply: string }).reply };
    },
    onSuccess: ({ reviewName, reply }) => {
      setDrafts((d) => ({ ...d, [reviewName]: reply }));
      setOpenReplies((o) => ({ ...o, [reviewName]: true }));
    },
    onError: (e: Error) =>
      toast({ title: "Suggest failed", description: e.message, variant: "destructive" }),
  });

  const reply = useMutation({
    mutationFn: async ({ reviewName, comment }: { reviewName: string; comment: string }) => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke("seo-google-business", {
        body: {
          action: "reply_to_review",
          shop_id: currentShop.id,
          review_name: reviewName,
          comment,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: (_, { reviewName }) => {
      toast({ title: "Reply posted" });
      setDrafts((d) => {
        const next = { ...d };
        delete next[reviewName];
        return next;
      });
      setOpenReplies((o) => ({ ...o, [reviewName]: false }));
      qc.invalidateQueries({ queryKey: ["seo-gbp-reviews", currentShop?.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Reply failed", description: e.message, variant: "destructive" }),
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to view reviews.</p>
      </div>
    );
  }

  const list = reviews.data?.reviews ?? [];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">GBP reviews</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Latest 50 Google Business Profile reviews. Use AI to draft a reply, edit, then post.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ["seo-gbp-reviews", currentShop.id] })
            }
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        {reviews.isLoading ? (
          <Card className="bg-zinc-950 border-zinc-800 p-12 text-center text-zinc-500">
            Loading…
          </Card>
        ) : reviews.error ? (
          <Card className="bg-zinc-950 border-zinc-800 p-6 text-sm text-zinc-300">
            <div className="text-red-400 mb-1">Could not load reviews.</div>
            <div className="text-zinc-500 text-xs">
              {reviews.error instanceof Error ? reviews.error.message : "Unknown error"}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Make sure Google Business Profile is connected and a location is selected in{" "}
              <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
                /admin/seo/connections
              </Link>
              . GBP API access also requires Google approval on the project.
            </p>
          </Card>
        ) : list.length === 0 ? (
          <Card className="bg-zinc-950 border-zinc-800 p-12 text-center text-zinc-500 text-sm">
            No reviews yet for this location.
          </Card>
        ) : (
          <div className="space-y-3">
            {list.map((r) => {
              const rating = r.starRating ? RATING_TO_NUM[r.starRating] : 0;
              const draft = drafts[r.name] ?? r.reviewReply?.comment ?? "";
              const isOpen = openReplies[r.name] ?? !!r.reviewReply;
              return (
                <Card key={r.name} className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {r.reviewer?.displayName ?? "Anonymous"}
                        </span>
                        <RatingStars n={rating} />
                        {r.reviewReply && (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
                            Replied
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {r.createTime ? new Date(r.createTime).toLocaleDateString() : ""}
                      </div>
                    </div>
                  </div>
                  {r.comment && (
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{r.comment}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => suggest.mutate(r)}
                      disabled={suggest.isPending}
                    >
                      {suggest.isPending && suggest.variables?.name === r.name ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-1" />
                      )}
                      AI suggest reply
                    </Button>
                    {!isOpen && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenReplies((o) => ({ ...o, [r.name]: true }))}
                      >
                        Write reply
                      </Button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="space-y-2 border-t border-zinc-800 pt-3">
                      <Textarea
                        rows={4}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.name]: e.target.value }))}
                        placeholder="Write a reply, or click AI suggest reply…"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenReplies((o) => ({ ...o, [r.name]: false }))}
                        >
                          Close
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            reply.mutate({ reviewName: r.name, comment: draft.trim() })
                          }
                          disabled={!draft.trim() || reply.isPending}
                        >
                          {reply.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4 mr-1" />
                          )}
                          {r.reviewReply ? "Update reply" : "Post reply"}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RatingStars({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i <= n ? "text-amber-400 fill-amber-400" : "text-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}
