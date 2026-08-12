import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bookmark, BookmarkCheck, Mail, FileText, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";

const AdminRenders = () => {
  const { toast } = useToast();
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);

  const { data: renders, refetch, isLoading } = useQuery({
    queryKey: ["admin_renders", modeFilter, searchQuery, savedOnly],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      let query = supabase
        .from("color_visualizations")
        .select("*")
        .order("created_at", { ascending: false });

      if (modeFilter !== "all") {
        query = query.eq("mode_type", modeFilter);
      }

      if (savedOnly) {
        query = query.eq("is_saved", true);
      }

      if (searchQuery) {
        query = query.or(`customer_email.ilike.%${searchQuery}%,vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const handleToggleSave = async (id: string, currentSaved: boolean) => {
    const { error } = await supabase
      .from("color_visualizations")
      .update({ is_saved: !currentSaved })
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: "Failed to update save status", variant: "destructive" });
    } else {
      toast({ title: "Success", description: currentSaved ? "Removed from saved" : "Saved successfully" });
      refetch();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this render?")) return;

    const { error } = await supabase
      .from("color_visualizations")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: "Failed to delete render", variant: "destructive" });
    } else {
      toast({ title: "Success", description: "Render deleted successfully" });
      await refetch();
    }
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      toast({ title: "Error", description: "Failed to download image", variant: "destructive" });
    }
  };

  const getModeColor = (mode: string) => {
    const colors: Record<string, string> = {
      inkfusion: "bg-blue-500",
      ColorPro: "bg-blue-500",
      approvemode: "bg-green-500",
      fadewraps: "bg-orange-500",
      designpanelpro: "bg-purple-500",
      wbty: "bg-pink-500",
    };
    return colors[mode] || "bg-gray-500";
  };

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Header Stats */}
          <div>
            <h1 className="text-3xl font-bold mb-2">3D Renders Monitor</h1>
            <p className="text-muted-foreground">View, manage, and retarget all generated renders</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Renders</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{renders?.length || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">InkFusion</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {renders?.filter(r => r.mode_type === "inkfusion").length || 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">ColorPro</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {renders?.filter(r => r.mode_type === "ColorPro").length || 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">FadeWraps</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {renders?.filter(r => r.mode_type === "fadewraps").length || 0}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <Select value={modeFilter} onValueChange={setModeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="inkfusion">InkFusion</SelectItem>
                <SelectItem value="ColorPro">ColorPro</SelectItem>
                <SelectItem value="approvemode">ApproveMode</SelectItem>
                <SelectItem value="fadewraps">FadeWraps</SelectItem>
                <SelectItem value="designpanelpro">DesignProAI</SelectItem>
                <SelectItem value="wbty">WBTY</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Search email or vehicle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs"
            />

            <Button
              variant={savedOnly ? "default" : "outline"}
              onClick={() => setSavedOnly(!savedOnly)}
            >
              {savedOnly ? <BookmarkCheck className="w-4 h-4 mr-2" /> : <Bookmark className="w-4 h-4 mr-2" />}
              Saved Only
            </Button>
          </div>

          {/* Renders Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {renders?.map((render) => (
              <Card key={render.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <Badge className={getModeColor(render.mode_type || "")}>
                      {render.mode_type || "Unknown"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggleSave(render.id, render.is_saved || false)}
                    >
                      {render.is_saved ? (
                        <BookmarkCheck className="w-4 h-4 text-primary" />
                      ) : (
                        <Bookmark className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <CardTitle className="text-base mt-2">
                    {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                  </CardTitle>
                </CardHeader>
                
                <CardContent className="space-y-3">
                  {/* Image Gallery */}
                  <div className="grid grid-cols-2 gap-2">
                    {render.render_urls && typeof render.render_urls === 'object' &&
                      Object.entries(render.render_urls as Record<string, string>).slice(0, 4).map(([type, url]) => (
                        <img
                          key={type}
                          src={url}
                          alt={type}
                          className="w-full aspect-video object-cover rounded border border-border"
                        />
                      ))
                    }
                  </div>

                  {/* Metadata */}
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border border-border" style={{ backgroundColor: render.color_hex }} />
                      <span className="font-medium">{render.color_name}</span>
                    </div>
                    <p className="text-muted-foreground">{render.finish_type} finish</p>
                    <p className="text-muted-foreground">Customer: {render.customer_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(render.created_at || ""), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" className="flex-1">
                      <Mail className="w-4 h-4 mr-1" />
                      Email
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (render.render_urls && typeof render.render_urls === 'object') {
                          const urls = Object.entries(render.render_urls as Record<string, string>);
                          if (urls.length > 0) {
                            downloadImage(urls[0][1], `${render.vehicle_make}_${render.vehicle_model}_${urls[0][0]}.jpg`);
                          }
                        }
                      }}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(render.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* MyVehiclePro */}
                  <MyVehicleProInline
                    colorName={render.color_name}
                    colorHex={render.color_hex}
                    finishType={render.finish_type}
                    modeType={render.mode_type || undefined}
                    vehicleYear={render.vehicle_year}
                    vehicleMake={render.vehicle_make}
                    vehicleModel={render.vehicle_model}
                    compact
                  />
                </CardContent>
              </Card>
            ))}
          </div>

          {renders?.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No renders found matching your filters</p>
            </div>
          )}
        </div>
      </main>

    </div>
  );
};

export default AdminRenders;