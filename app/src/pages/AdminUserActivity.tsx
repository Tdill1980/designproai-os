import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCw, Star, Edit3, Flag, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface QualityRating {
  id: string;
  render_id: string;
  rating: number | null;
  is_flagged: boolean | null;
  flag_reason: string | null;
  notes: string | null;
  render_type: string;
  user_email: string | null;
  created_at: string | null;
  gradient_quality_score: number | null;
  has_hard_line: boolean | null;
}

interface DesignRevision {
  id: string;
  user_id: string | null;
  design_id: string | null;
  tool: string;
  view_type: string | null;
  original_url: string | null;
  revised_url: string | null;
  revision_prompt: string;
  created_at: string | null;
}

const AdminUserActivity = () => {
  const [reviews, setReviews] = useState<QualityRating[]>([]);
  const [revisions, setRevisions] = useState<DesignRevision[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch quality ratings/reviews
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('render_quality_ratings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (reviewsError) throw reviewsError;
      setReviews(reviewsData || []);

      // Fetch design revision history
      const { data: revisionsData, error: revisionsError } = await supabase
        .from('design_revision_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (revisionsError) throw revisionsError;
      setRevisions(revisionsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load activity data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const flaggedCount = reviews.filter(r => r.is_flagged).length;
  const avgRating = reviews.filter(r => r.rating).reduce((acc, r) => acc + (r.rating || 0), 0) / (reviews.filter(r => r.rating).length || 1);

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">User Activity</h1>
            <p className="text-sm text-muted-foreground">
              View quality reviews and design revision history
            </p>
          </div>
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Total Reviews</p>
            <p className="text-2xl font-bold">{reviews.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Flagged Issues</p>
            <p className="text-2xl font-bold text-destructive">{flaggedCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Avg Rating</p>
            <p className="text-2xl font-bold">{avgRating.toFixed(1)} / 5</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Total Revisions</p>
            <p className="text-2xl font-bold">{revisions.length}</p>
          </Card>
        </div>

        <Tabs defaultValue="reviews" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="reviews" className="gap-2">
              <Star className="w-4 h-4" />
              Reviews ({reviews.length})
            </TabsTrigger>
            <TabsTrigger value="revisions" className="gap-2">
              <Edit3 className="w-4 h-4" />
              Revisions ({revisions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reviews" className="space-y-4">
            {reviews.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No reviews yet
              </Card>
            ) : (
              reviews.map((review) => (
                <Card key={review.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 grid md:grid-cols-5 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">User</p>
                        <p className="font-medium text-sm truncate">{review.user_email || 'Anonymous'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Type</p>
                        <p className="font-medium capitalize">{review.render_type}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Rating</p>
                        <div className="flex items-center gap-1">
                          {review.rating ? (
                            <>
                          <Star className="w-4 h-4 fill-primary text-primary" />
                              <span className="font-medium">{review.rating}/5</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        {review.is_flagged ? (
                          <span className="inline-flex items-center gap-1 text-destructive font-medium">
                            <Flag className="w-4 h-4" /> Flagged
                          </span>
                        ) : (
                          <span className="text-primary font-medium">OK</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Date</p>
                        <p className="text-sm">
                          {review.created_at ? format(new Date(review.created_at), 'MMM d, yyyy') : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                  {(review.flag_reason || review.notes) && (
                    <div className="mt-3 pt-3 border-t">
                      {review.flag_reason && (
                        <p className="text-sm"><span className="font-medium">Reason:</span> {review.flag_reason}</p>
                      )}
                      {review.notes && (
                        <p className="text-sm text-muted-foreground"><span className="font-medium">Notes:</span> {review.notes}</p>
                      )}
                    </div>
                  )}
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="revisions" className="space-y-4">
            {revisions.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No revisions yet
              </Card>
            ) : (
              revisions.map((revision) => (
                <Card key={revision.id} className="p-4">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Tool</p>
                      <p className="font-medium capitalize">{revision.tool}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">View Type</p>
                      <p className="font-medium capitalize">{revision.view_type || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Prompt</p>
                      <p className="text-sm truncate" title={revision.revision_prompt}>
                        {revision.revision_prompt}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Date</p>
                      <p className="text-sm">
                        {revision.created_at ? format(new Date(revision.created_at), 'MMM d, yyyy HH:mm') : '-'}
                      </p>
                    </div>
                  </div>
                  {(revision.original_url || revision.revised_url) && (
                    <div className="mt-3 pt-3 border-t flex gap-4">
                      {revision.original_url && (
                        <a 
                          href={revision.original_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Original <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {revision.revised_url && (
                        <a 
                          href={revision.revised_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Revised <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminUserActivity;
