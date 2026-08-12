import { useState } from "react";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAffiliateContent, useUpdateContentStatus, useDeleteAffiliateContent } from "@/hooks/useAffiliateContent";
import type { AffiliateContent, ContentStatus } from "@/types/affiliate";
import { toast } from "sonner";
import { Check, X, Megaphone, Trash2, Play, ImageIcon } from "lucide-react";

export default function AdminAffiliateContent() {
  const [tab, setTab] = useState("all");
  const [rejectDialog, setRejectDialog] = useState<AffiliateContent | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const statusFilter = tab === "all" ? undefined : tab === "partner_ads" ? undefined : tab;
  const { data: allContent, isLoading } = useAffiliateContent(
    statusFilter ? { status: statusFilter } : undefined
  );

  const updateStatus = useUpdateContentStatus();
  const deleteContent = useDeleteAffiliateContent();

  // Filter for partner_ads tab separately since it's a boolean filter
  const content = tab === "partner_ads"
    ? (allContent || []).filter((c) => c.is_partner_ad)
    : allContent || [];

  const handleAction = async (id: string, status: ContentStatus, rejectionReason?: string) => {
    try {
      await updateStatus.mutateAsync({ id, status, rejectionReason });
      toast.success(
        status === "approved" ? "Content approved" :
        status === "rejected" ? "Content rejected" :
        status === "partner_ad" ? "Promoted to Partner Ad" :
        "Status updated"
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to update status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this content permanently?")) return;
    try {
      await deleteContent.mutateAsync(id);
      toast.success("Content deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    await handleAction(rejectDialog.id, "rejected", rejectReason);
    setRejectDialog(null);
    setRejectReason("");
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "pending_review": return "bg-yellow-500/20 text-yellow-400";
      case "approved": return "bg-green-500/20 text-green-400";
      case "rejected": return "bg-red-500/20 text-red-400";
      case "partner_ad": return "bg-purple-500/20 text-purple-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Affiliate Content</h1>
            <p className="text-muted-foreground">Review and manage affiliate uploaded content</p>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="pending_review">Pending Review</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="partner_ads">Partner Ads</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-4">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading content...</div>
              ) : content.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No content found</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {content.map((item) => (
                    <Card key={item.id} className="overflow-hidden">
                      <div className="aspect-video bg-muted flex items-center justify-center relative">
                        {item.content_type === "reel" ? (
                          <>
                            {item.thumbnail_url ? (
                              <img src={item.thumbnail_url} alt={item.title || ""} className="w-full h-full object-cover" />
                            ) : (
                              <video
                                src={item.file_url}
                                className="w-full h-full object-cover"
                                muted
                                preload="metadata"
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="p-3 rounded-full bg-black/60">
                                <Play className="h-6 w-6 text-white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={item.file_url}
                            alt={item.title || ""}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                        {!item.file_url && (
                          <ImageIcon className="h-12 w-12 text-muted-foreground" />
                        )}
                        <div className="absolute top-2 left-2">
                          <Badge className={statusColor(item.status)}>
                            {item.status.replace("_", " ")}
                          </Badge>
                        </div>
                        {item.is_partner_ad && (
                          <div className="absolute top-2 right-2">
                            <Badge className="bg-purple-500 text-white">
                              <Megaphone className="h-3 w-3 mr-1" /> Partner Ad
                            </Badge>
                          </div>
                        )}
                      </div>
                      <CardContent className="p-3 space-y-2">
                        <p className="font-medium text-sm truncate">{item.title || "Untitled"}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {item.content_type === "reel" ? "Reel" : "Static"}
                          </Badge>
                          <span>{new Date(item.created_at).toLocaleDateString()}</span>
                        </div>
                        {item.rejection_reason && (
                          <p className="text-xs text-red-400">Reason: {item.rejection_reason}</p>
                        )}
                        <div className="flex flex-wrap gap-1 pt-1">
                          {item.status === "pending_review" && (
                            <>
                              <Button size="sm" variant="outline" className="text-green-400" onClick={() => handleAction(item.id, "approved")}>
                                <Check className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-400" onClick={() => setRejectDialog(item)}>
                                <X className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {(item.status === "approved" || item.status === "pending_review") && !item.is_partner_ad && (
                            <Button size="sm" variant="outline" className="text-purple-400" onClick={() => handleAction(item.id, "partner_ad")}>
                              <Megaphone className="h-3 w-3 mr-1" /> Promote
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />

      {/* Rejection reason dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Content</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Rejection Reason</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={updateStatus.isPending}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
