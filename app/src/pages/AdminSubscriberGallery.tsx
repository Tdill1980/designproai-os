import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Calendar, Car, Palette } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

interface Render {
  id: string;
  customer_email: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  color_hex: string;
  finish_type: string;
  render_urls: unknown;
  created_at: string;
  mode_type: string | null;
}

const AdminSubscriberGallery = () => {
  const { email } = useParams<{ email: string }>();
  const navigate = useNavigate();
  const [renders, setRenders] = useState<Render[]>([]);
  const [loading, setLoading] = useState(true);
  const decodedEmail = email ? decodeURIComponent(email) : "";

  useEffect(() => {
    if (decodedEmail) {
      fetchRenders();
    }
  }, [decodedEmail]);

  const fetchRenders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('color_visualizations')
        .select('*')
        .ilike('customer_email', decodedEmail)
        .eq('generation_status', 'completed')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRenders(data || []);
    } catch (error) {
      console.error('Error fetching renders:', error);
      toast.error('Failed to load renders');
    } finally {
      setLoading(false);
    }
  };

  const getHeroImage = (render: Render): string | null => {
    if (!render.render_urls || typeof render.render_urls !== 'object') return null;
    const urls = render.render_urls as Record<string, string>;
    return urls.hero || urls.front || urls.side || Object.values(urls)[0] || null;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate('/admin/billing')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Billing
          </Button>
          <h1 className="text-3xl font-bold mb-2">Renders for {decodedEmail}</h1>
          <p className="text-muted-foreground">{renders.length} total renders</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : renders.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">No renders found for this subscriber</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {renders.map((render) => {
              const heroImage = getHeroImage(render);
              return (
                <Card key={render.id} className="overflow-hidden">
                  <Dialog>
                    <DialogTrigger asChild>
                      <div className="aspect-video bg-muted cursor-pointer relative overflow-hidden">
                        {heroImage ? (
                          <img 
                            src={heroImage} 
                            alt={`${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`}
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                      {heroImage && (
                        <img 
                          src={heroImage} 
                          alt={`${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`}
                          className="w-full h-auto rounded-lg"
                        />
                      )}
                      <div className="mt-4 space-y-2">
                        <h3 className="font-bold text-lg">
                          {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                        </h3>
                        <p className="flex items-center gap-2">
                          <span 
                            className="w-4 h-4 rounded-full border"
                            style={{ backgroundColor: render.color_hex }}
                          />
                          {render.color_name} - {render.finish_type}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Mode: {render.mode_type || 'Unknown'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Created: {new Date(render.created_at).toLocaleString()}
                        </p>
                      </div>
                    </DialogContent>
                  </Dialog>
                  
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Car className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium truncate">
                        {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Palette className="w-4 h-4 text-muted-foreground" />
                      <span 
                        className="w-3 h-3 rounded-full border"
                        style={{ backgroundColor: render.color_hex }}
                      />
                      <span className="truncate">{render.color_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {new Date(render.created_at).toLocaleDateString()}
                    </div>
                    {render.mode_type && (
                      <span className="inline-block text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {render.mode_type}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminSubscriberGallery;
