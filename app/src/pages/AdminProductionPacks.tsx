import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminProductionPacks() {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch all panels with production files
  const { data: panels, isLoading } = useQuery({
    queryKey: ["production-packs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designpanelpro_patterns")
        .select("*")
        .not("production_file_url", "is", null)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Delete production file mutation
  const deleteProductionFile = useMutation({
    mutationFn: async (panelId: string) => {
      const { error } = await supabase
        .from("designpanelpro_patterns")
        .update({ production_file_url: null })
        .eq("id", panelId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-packs"] });
      toast.success("Production file removed successfully");
      setDeletingId(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove production file: ${error.message}`);
      setDeletingId(null);
    },
  });

  const handleDelete = async (panelId: string) => {
    if (confirm("Are you sure you want to remove this production file?")) {
      setDeletingId(panelId);
      deleteProductionFile.mutate(panelId);
    }
  };

  const getFileName = (url: string | null) => {
    if (!url) return "N/A";
    const parts = url.split("/");
    return parts[parts.length - 1];
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 pt-24">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            Production Packs Manager
          </h1>
          <p className="text-muted-foreground">
            Manage production files for RestyleLibrary™ & DesignProAI™ panels
          </p>
        </div>

        <Card className="bg-card border-border">
          <div className="p-6">
            {isLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading production packs...</p>
              </div>
            ) : !panels || panels.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No production packs found</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload production files from the RestyleLibrary / DesignProAI Manager
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Panel Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>File Name</TableHead>
                      <TableHead>Upload Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {panels.map((panel) => (
                      <TableRow key={panel.id}>
                        <TableCell className="font-medium">
                          {panel.name}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
                            {panel.category || "Uncategorized"}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {getFileName(panel.production_file_url)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {panel.updated_at
                            ? format(new Date(panel.updated_at), "MMM d, yyyy")
                            : "N/A"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            >
                              <a
                                href={panel.production_file_url || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(panel.id)}
                              disabled={deletingId === panel.id}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Total production packs: {panels?.length || 0}
          </p>
          <Button
            variant="outline"
            onClick={() => window.location.href = "/admin/designpanelpro-manager"}
          >
            Back to Panel Manager
          </Button>
        </div>
      </main>
    </div>
  );
}
