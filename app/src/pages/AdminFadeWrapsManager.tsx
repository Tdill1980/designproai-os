import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Upload, Trash2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { AdminSmartUploader } from "@/components/admin/AdminSmartUploader";

const AdminFadeWrapsManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedPatterns, setExpandedPatterns] = useState<string[]>([]);

  const { data: patterns, isLoading } = useQuery({
    queryKey: ["fadewraps_patterns_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fadewraps_patterns")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-${Date.now()}.${fileExt}`;
      const filePath = `fadewraps/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('fadewraps_patterns')
        .update({ media_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fadewraps_patterns_admin"] });
      toast({
        title: "Success",
        description: "Pattern swatch updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('fadewraps_patterns')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fadewraps_patterns_admin"] });
      toast({
        title: "Success",
        description: "Pattern deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadMutation.mutate({ id, file });
    }
  };

  const togglePattern = (patternId: string) => {
    setExpandedPatterns(prev =>
      prev.includes(patternId)
        ? prev.filter(id => id !== patternId)
        : [...prev, patternId]
    );
  };

  const uploadedPatterns = patterns?.filter(pattern => 
    pattern.media_url && pattern.media_url.includes('supabase.co/storage')
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <Button
          variant="ghost"
          onClick={() => navigate('/admin')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Admin
        </Button>

        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            FadeWraps™ Pattern Manager
          </h1>
          <p className="text-muted-foreground">
            Upload and manage FadeWraps gradient patterns with AI naming and auto 3D generation
          </p>
        </div>

        <div className="mb-8">
          <AdminSmartUploader
            productType="fadewraps"
            onUploadComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["fadewraps_patterns_admin"] });
            }}
          />
        </div>

        <div className="space-y-4">
          {uploadedPatterns?.map((pattern) => (
            <Card key={pattern.id} className="p-6">
              <Collapsible
                open={expandedPatterns.includes(pattern.id)}
                onOpenChange={() => togglePattern(pattern.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    {pattern.media_url && pattern.media_url.includes('supabase.co/storage') && (
                      <div className="w-24 h-24 rounded overflow-hidden border border-border">
                        <img
                          src={pattern.media_url}
                          alt={pattern.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-semibold">{pattern.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Sort Order: {pattern.sort_order}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <ChevronDown className={`h-4 w-4 transition-transform ${
                          expandedPatterns.includes(pattern.id) ? 'rotate-180' : ''
                        }`} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </div>

                <CollapsibleContent className="mt-4 space-y-4">
                  <div className="grid gap-4">
                    <div>
                      <Label htmlFor={`swatch-${pattern.id}`}>Upload Pattern Swatch</Label>
                      <div className="flex gap-2 mt-2">
                        <Input
                          id={`swatch-${pattern.id}`}
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileChange(pattern.id, e)}
                          disabled={uploadMutation.isPending}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => document.getElementById(`swatch-${pattern.id}`)?.click()}
                          disabled={uploadMutation.isPending}
                        >
                          <Upload className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete ${pattern.name}?`)) {
                            deleteMutation.mutate(pattern.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Pattern
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}

          {(!uploadedPatterns || uploadedPatterns.length === 0) && (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">
                No uploaded patterns yet. Upload pattern swatches to get started.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminFadeWrapsManager;
