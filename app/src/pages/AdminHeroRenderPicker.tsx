import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Star, StarOff, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";

const AdminHeroRenderPicker = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // DesignPro family only — this picker drives the DesignProAI showcase carousel,
  // so admins choose from DesignPro designs (not ColorPro/ApproveMode/etc.).
  const DESIGNPRO_MODE_TYPES = [
    "designpanelpro",
    "myvehicle_designpanelpro",
    "myvehicle_designpanelpropremium",
    "myvehicle_designpro_direct",
  ];

  const { data: renders, isLoading } = useQuery({
    queryKey: ["all-renders-for-hero", "designpro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("*")
        .in("mode_type", DESIGNPRO_MODE_TYPES)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data;
    },
  });

  const toggleFeaturedMutation = useMutation({
    mutationFn: async ({ id, isFeatured }: { id: string; isFeatured: boolean }) => {
      const { error } = await supabase
        .from("color_visualizations")
        .update({ is_featured_hero: isFeatured })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-renders-for-hero", "designpro"] });
      queryClient.invalidateQueries({ queryKey: ["showcase-renders", "designpro"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-hero-renders"] });
      toast({ title: "Updated", description: "DesignProAI showcase carousel updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const featuredRenders = renders?.filter((r) => r.is_featured_hero) || [];
  const availableRenders = renders?.filter((r) => !r.is_featured_hero) || [];

  const getFirstRenderUrl = (renderUrls: any) => {
    if (!renderUrls || typeof renderUrls !== "object") return null;
    const urls = Object.values(renderUrls as Record<string, string>);
    return urls[0] || null;
  };

  const getDisplayName = (render: any) => {
    if (render.color_name && !["Custom", "Custom Design", "(1)", ""].includes(render.color_name)) {
      return render.color_name;
    }
    return render.mode_type || "Design";
  };

  const getVehicleName = (render: any) => {
    const parts = [render.vehicle_year, render.vehicle_make, render.vehicle_model].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : "";
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link to="/admin">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Landing Page Hero Carousel</h1>
          <p className="text-muted-foreground">
            Select which renders appear in the hero carousel on the landing page
          </p>
        </div>

        {/* Featured Section */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
            Featured in Hero ({featuredRenders.length})
          </h2>

          {featuredRenders.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              No renders selected. Click the star on any render below to feature it.
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {featuredRenders.map((render) => {
                const imageUrl = getFirstRenderUrl(render.render_urls);
                return (
                  <Card
                    key={render.id}
                    className="overflow-hidden border-2 border-yellow-500/50"
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={getDisplayName(render)}
                        className="w-full h-32 object-cover"
                      />
                    ) : (
                      <div className="w-full h-32 bg-muted flex items-center justify-center">
                        No image
                      </div>
                    )}
                    <div className="p-3">
                      <p className="font-medium text-sm truncate">{getDisplayName(render)}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {getVehicleName(render)}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <Badge variant="secondary" className="text-xs">
                          {render.mode_type || "colorpro"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            toggleFeaturedMutation.mutate({
                              id: render.id,
                              isFeatured: false,
                            })
                          }
                          disabled={toggleFeaturedMutation.isPending}
                        >
                          <StarOff className="w-4 h-4 text-yellow-500" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Available Renders */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Available Renders</h2>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : availableRenders.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              No more renders available
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {availableRenders.map((render) => {
                const imageUrl = getFirstRenderUrl(render.render_urls);
                return (
                  <Card key={render.id} className="overflow-hidden">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={getDisplayName(render)}
                        className="w-full h-32 object-cover"
                      />
                    ) : (
                      <div className="w-full h-32 bg-muted flex items-center justify-center text-muted-foreground text-sm">
                        No image
                      </div>
                    )}
                    <div className="p-3">
                      <p className="font-medium text-sm truncate">{getDisplayName(render)}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {getVehicleName(render)}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {render.mode_type || "colorpro"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            toggleFeaturedMutation.mutate({
                              id: render.id,
                              isFeatured: true,
                            })
                          }
                          disabled={toggleFeaturedMutation.isPending}
                        >
                          <Star className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="mt-2">
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
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

    </div>
  );
};

export default AdminHeroRenderPicker;
