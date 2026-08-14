import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { useToast } from "@/hooks/use-toast";
import { Trash2, ArrowRightCircle, Settings, X, Send, Sparkles, Loader2, Download } from "lucide-react";

interface PanelLibraryProps {
  panels: any[];
  selectedPanel: any;
  onSelectPanel: (panel: any) => void;
  isLoading: boolean;
}

const PanelCard = ({
  panel,
  isSelected,
  onSelect,
  isAdmin,
  manageMode,
  onDelete,
  onMoveToStudio,
  onGenerate2DProof,
  isMoving,
  isDeleting,
  isGenerating,
}: {
  panel: any;
  isSelected: boolean;
  onSelect: () => void;
  isAdmin: boolean;
  manageMode: boolean;
  onDelete: () => void;
  onMoveToStudio: () => void;
  onGenerate2DProof: () => void;
  isMoving: boolean;
  isDeleting: boolean;
  isGenerating: boolean;
}) => {
  // STRICT: Only use thumbnail_url for library display - media_url is for AI generation only
  // Skip panels without thumbnail_url (they should not appear in public library)
  if (!panel.thumbnail_url) return null;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:scale-[1.02] overflow-hidden relative select-none",
        isSelected && "ring-2 ring-primary bg-primary/10 shadow-lg shadow-primary/20",
        manageMode && "ring-1 ring-amber-500/30"
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!manageMode) onSelect();
      }}
    >
      <div className="relative bg-muted/30 pointer-events-none">
        <img
          src={panel.thumbnail_url}
          alt={panel.name}
          className="w-full h-auto object-contain pointer-events-none"
          draggable={false}
        />
      </div>
      <div className="p-3 bg-background">
        <p className="text-sm font-medium truncate pointer-events-none">
          {panel.ai_generated_name || panel.name}
        </p>

        {/* Admin management buttons */}
        {isAdmin && manageMode && (
          <div className="flex flex-col gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate2DProof();
              }}
              disabled={isMoving || isDeleting || isGenerating}
              title="Run this panel through generate-2d-proof (Gemini) — see the flat 2D output"
            >
              {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {isGenerating ? "Generating..." : "Generate 2D Proof"}
            </Button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-xs gap-1 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveToStudio();
                }}
                disabled={isMoving || isDeleting || isGenerating}
              >
                <ArrowRightCircle className="w-3 h-3" />
                {isMoving ? "Moving..." : "RevisionStudio"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={isMoving || isDeleting || isGenerating}
              >
                <Trash2 className="w-3 h-3" />
                {isDeleting ? "..." : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export const PanelLibrary = ({
  panels,
  selectedPanel,
  onSelectPanel,
  isLoading
}: PanelLibraryProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [manageMode, setManageMode] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<{
    open: boolean;
    panel: any | null;
    proofUrl: string | null;
  }>({ open: false, panel: null, proofUrl: null});

  // Admin role check
  const { data: isAdmin } = useQuery({
    queryKey: ["panel-library-admin-role"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Central email allowlist (src/lib/admin-allowlist.ts) runs first so
      // operators are granted access immediately without a user_roles row.
      if (isAllowlistedAdmin(user.email)) return true;

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"])
        .limit(1)
        .maybeSingle();

      return !!roleData;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Invalidate all query keys that might hold panel data
  const invalidateAllPanelQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns"] });
    queryClient.invalidateQueries({ queryKey: ["designpro_patterns"] });
  };

  // Move panel to RevisionStudio: create a color_visualization record, then deactivate the pattern
  const handleMoveToStudio = async (panel: any) => {
    setMovingId(panel.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Not authenticated");

      // Create a color_visualization record so it shows in RevisionStudioIQ
      const renderUrl = panel.thumbnail_url || panel.example_render_url || panel.media_url;
      const { error: insertError } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: user.email,
          vehicle_year: 2024,
          vehicle_make: "TBD",
          vehicle_model: "Select in RevisionStudio",
          color_hex: "#000000",
          color_name: panel.ai_generated_name || panel.name || "Library Design",
          finish_type: "Gloss",
          mode_type: "designpanelpro",
          generation_status: "completed",
          render_urls: { roof: renderUrl },
          custom_design_url: panel.media_url || null,
          design_file_name: panel.ai_generated_name || panel.name || "Library Design",
        });

      if (insertError) throw insertError;

      // Deactivate the pattern so it no longer shows in the library
      const { data: updated, error: updateError } = await supabase
        .from("designpanelpro_patterns")
        .update({ is_active: false })
        .eq("id", panel.id)
        .select("id");

      if (updateError) throw updateError;

      // If RLS blocked the update, no rows come back - try deleting instead
      if (!updated || updated.length === 0) {
        console.warn("[PanelLibrary] RLS blocked update - trying delete");
        const { error: delError } = await supabase
          .from("designpanelpro_patterns")
          .delete()
          .eq("id", panel.id);
        if (delError) {
          console.error("[PanelLibrary] Delete also blocked by RLS:", delError.message);
          throw new Error("Permission denied - ask an admin to check RLS on designpanelpro_patterns");
        }
      }

      toast({
        title: "Moved to RevisionStudio",
        description: `"${panel.ai_generated_name || panel.name}" is now in RevisionStudio for re-rendering.`,
      });

      invalidateAllPanelQueries();
    } catch (err: any) {
      console.error("Move to RevisionStudio failed:", err);
      toast({
        title: "Move failed",
        description: err.message || "Could not move panel to RevisionStudio",
        variant: "destructive",
      });
    } finally {
      setMovingId(null);
    }
  };

  // Delete (deactivate) a panel from the library
  const handleDelete = async (panel: any) => {
    setDeletingId(panel.id);
    try {
      // Try soft-delete first (set is_active: false)
      const { data: updated, error } = await supabase
        .from("designpanelpro_patterns")
        .update({ is_active: false })
        .eq("id", panel.id)
        .select("id");

      if (error) throw error;

      // If RLS blocked the update (0 rows affected), try hard delete
      if (!updated || updated.length === 0) {
        console.warn("[PanelLibrary] RLS blocked update - trying delete");
        const { error: delError } = await supabase
          .from("designpanelpro_patterns")
          .delete()
          .eq("id", panel.id);
        if (delError) {
          console.error("[PanelLibrary] Delete also blocked by RLS:", delError.message);
          throw new Error("Permission denied - ask an admin to check RLS on designpanelpro_patterns");
        }
      }

      toast({
        title: "Panel removed",
        description: `"${panel.ai_generated_name || panel.name}" has been removed from the library.`,
      });

      invalidateAllPanelQueries();
    } catch (err: any) {
      console.error("Delete panel failed:", err);
      toast({
        title: "Delete failed",
        description: err.message || "Could not remove panel",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  // Run the panel through generate-2d-proof (the same Gemini flat-proof
  // pipeline QC Artboard uses) so we can eyeball "with generation" output for
  // a library file. Result opens in a modal where it can be downloaded or
  // sent into QC Artboard as a test job.
  const handleGenerate2DProof = async (panel: any) => {
    const source = panel.media_url || panel.thumbnail_url;
    if (!source) {
      toast({ title: "No image", description: "Panel has no media URL", variant: "destructive" });
      return;
    }
    setGeneratingId(panel.id);
    try {
      const designName = panel.ai_generated_name || panel.name || "Library Panel";
      const { data, error } = await supabase.functions.invoke("generate-2d-proof", {
        body: {
          allViewUrls: { side: source },
          designName,
          finish: "Gloss",
        },
      });
      if (error) throw error;
      const proofUrl: string | undefined = data?.url || data?.proofUrl || data?.image_url;
      if (!proofUrl) throw new Error(data?.error || "No proof URL returned");
      setProofModal({ open: true, panel, proofUrl});
    } catch (err: any) {
      console.error("Generate 2D proof failed:", err);
      toast({
        title: "Generation failed",
        description: err?.message || "Could not generate 2D proof",
        variant: "destructive",
      });
    } finally {
      setGeneratingId(null);
    }
  };

  // Push the generated 2D proof into QC Artboard as a test job so the same
  // upscale / CutPath tools can run on the post-generation output.


  // Bulk: Move ALL visible panels to RevisionStudio
  const handleMoveAllToStudio = async () => {
    const visiblePanels = (panels || []).filter((p: any) => p.thumbnail_url);
    if (visiblePanels.length === 0) return;

    const confirmed = window.confirm(
      `Move all ${visiblePanels.length} panels to RevisionStudio? They will be removed from the library and available for re-rendering in RevisionStudio.`
    );
    if (!confirmed) return;

    let moved = 0;
    for (const panel of visiblePanels) {
      try {
        await handleMoveToStudio(panel);
        moved++;
      } catch {
        // Continue with remaining panels
      }
    }

    toast({
      title: "Bulk move complete",
      description: `${moved} of ${visiblePanels.length} panels moved to RevisionStudio.`,
    });
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="aspect-video" />
        ))}
      </div>
    );
  }

  if (!panels || panels.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No curated panels available yet</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Admin manage toggle */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={manageMode ? "default" : "outline"}
            className="h-7 text-xs gap-1"
            onClick={() => setManageMode(!manageMode)}
          >
            {manageMode ? <X className="w-3 h-3" /> : <Settings className="w-3 h-3" />}
            {manageMode ? "Done" : "Manage Library"}
          </Button>
          {manageMode && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
              onClick={handleMoveAllToStudio}
            >
              <ArrowRightCircle className="w-3 h-3" />
              Move All to Studio
            </Button>
          )}
        </div>
      )}

      {manageMode && isAdmin && (
        <div className="text-center py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-xs font-medium text-amber-300">
            Manage Mode (internal): move to RevisionStudio, or delete
          </p>
        </div>
      )}

      {!manageMode && (
        <div className="text-center py-2 px-3 bg-primary/10 border border-primary/30 rounded-lg">
          <p className="text-xs font-medium text-foreground">
            Click any design to select it
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 max-h-[600px] overflow-y-auto p-1 scrollbar-blue">
        {panels.map((panel) => (
          <PanelCard
            key={panel.id}
            panel={panel}
            isSelected={selectedPanel?.id === panel.id}
            onSelect={() => onSelectPanel(panel)}
            isAdmin={!!isAdmin}
            manageMode={manageMode}
            onDelete={() => handleDelete(panel)}
            onMoveToStudio={() => handleMoveToStudio(panel)}
            onGenerate2DProof={() => handleGenerate2DProof(panel)}
            isMoving={movingId === panel.id}
            isDeleting={deletingId === panel.id}
            isGenerating={generatingId === panel.id}
          />
        ))}
      </div>

      {/* 2D Proof result modal — shown after handleGenerate2DProof returns. */}
      <Dialog
        open={proofModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setProofModal({ open: false, panel: null, proofUrl: null});
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>2D Proof — {proofModal.panel?.ai_generated_name || proofModal.panel?.name || "Library Panel"}</DialogTitle>
            <DialogDescription>
              Generated by the same generate-2d-proof pipeline QC Artboard uses. Send to QC to run upscale / CutPath tools on the result.
            </DialogDescription>
          </DialogHeader>
          {proofModal.proofUrl && (
            <div className="space-y-3">
              <img
                src={proofModal.proofUrl}
                alt="Generated 2D proof"
                className="w-full h-auto rounded-md border border-border bg-muted/20 object-contain max-h-[60vh]"
              />
              <div className="flex flex-wrap gap-2 justify-end">
                <a
                  href={proofModal.proofUrl}
                  download={`2d-proof-${proofModal.panel?.id || "library"}.png`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" variant="outline" className="h-9 text-xs gap-1">
                    <Download className="w-3 h-3" />
                    Download
                  </Button>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
