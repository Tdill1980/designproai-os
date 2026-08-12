import { useState, useEffect } from 'react';
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Loader2, Sparkles } from 'lucide-react';
import { GenerationWizard, COLORPRO_TIPS } from '@/components/tools/GenerationWizard';
import { VehicleSelector } from '@/components/visualize/VehicleSelector';
import { ColorDropdown } from '@/components/visualize/ColorDropdown';
import { SwatchUploader } from '@/components/visualize/SwatchUploader';
import { DesignUploader } from '@/components/visualize/DesignUploader';
import { FinishSelector } from '@/components/visualize/FinishSelector';
import { RenderResults } from '@/components/visualize/RenderResults';
import { InkFusionColor } from '@/lib/restyleproai-colors';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { useToast } from '@/hooks/use-toast';
import { useRenderPolling } from '@/hooks/useRenderPolling';
import { extractColorsFromImage } from '@/lib/color-extractor';

export default function Visualize() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [vehicle, setVehicle] = useState<{ year: string; make: string; model: string } | null>(null);
  const [selectedColor, setSelectedColor] = useState<InkFusionColor | null>(null);
  const [customColor, setCustomColor] = useState<{ hex: string; name: string; swatchUrl?: string } | null>(null);
  const [uploadedDesign, setUploadedDesign] = useState<{ url: string; fileName: string; extractedColorHex?: string } | null>(null);
  const [finish, setFinish] = useState('gloss');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedViews, setGeneratedViews] = useState<any[]>([]);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [totalViewsExpected, setTotalViewsExpected] = useState(0);
  const { allViews, isPolling, startPolling } = useRenderPolling(visualizationId, totalViewsExpected);

  useEffect(() => {
    const checkAdminAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsAdmin(false);
        return;
      }
      const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").single();
      setIsAdmin(!!roleData);
    };
    checkAdminAccess();
  }, []);

  const handleGenerate = async () => {
    if (!vehicle) {
      toast({ title: 'Select vehicle', variant: 'destructive' });
      return;
    }
    let payload: any = { vehicleYear: vehicle.year, vehicleMake: vehicle.make, vehicleModel: vehicle.model, finishType: finish, subscriptionTier: 'premium', customerEmail: 'admin@restyleproai.com' };
    if (uploadedDesign) payload = { ...payload, colorHex: uploadedDesign.extractedColorHex || '#000000', colorName: uploadedDesign.fileName, useCustomDesign: true, customDesignUrl: uploadedDesign.url, modeType: 'approval' };
    else if (customColor) payload = { ...payload, colorHex: customColor.hex, colorName: customColor.name, modeType: 'material' };
    else if (selectedColor) payload = { ...payload, colorHex: selectedColor.hex, colorName: selectedColor.name, modeType: 'inkfusion' };
    else { toast({ title: 'Select color', variant: 'destructive' }); return; }
    try {
      setIsGenerating(true);
      const { data, error } = await renderClient.functions.invoke('generate-color-render', { body: payload });
      if (error) throw error;
      setVisualizationId(data.visualizationId);
      setTotalViewsExpected(data.totalViews);
      setGeneratedViews([{ type: 'hero_angle', url: data.heroUrl }]);
      toast({ title: '✅ Render started!' });
      if (data.totalViews > 1) startPolling();
    } catch (error: any) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isAdmin === null) return <div className="min-h-screen flex flex-col"><main className="flex-1 flex items-center justify-center"><p className="text-muted-foreground">Checking access...</p></main></div>;
  if (!isAdmin) return <div className="min-h-screen flex flex-col"><main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center"><Alert className="max-w-md"><Shield className="h-4 w-4" /><AlertDescription>Admin access only</AlertDescription></Alert></main></div>;
  if (generatedViews.length > 0) return <div className="min-h-screen flex flex-col"><main className="flex-1 container mx-auto px-4 py-8"><Alert className="mb-4 bg-primary/10 border-primary"><Shield className="h-4 w-4" /><AlertDescription>Admin Tool - No Paywall</AlertDescription></Alert><RenderResults views={allViews.length > 0 ? allViews : generatedViews} isPolling={isPolling} expectedViewCount={totalViewsExpected} onBack={() => setGeneratedViews([])} /></main></div>;

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>3D Vehicle Visualizer - RestyleProAI</title>
        <meta name="description" content="Visualize vehicle wraps in 3D with AI-powered rendering. See your design from every angle before printing." />
        <link rel="canonical" href="https://www.restyleproai.com/visualize" />
      </Helmet>
      <main className="flex-1">
        <div className="container mx-auto p-6 max-w-6xl">
          <Alert className="mb-6 bg-primary/10 border-primary"><Shield className="h-4 w-4" /><AlertDescription>Admin 3D Generator</AlertDescription></Alert>
          <Card>
            <CardHeader><CardTitle>DesignPro AI™ Admin</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <VehicleSelector onVehicleChange={setVehicle} />
              <Tabs defaultValue="inkfusion">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 h-auto">
                  <TabsTrigger value="inkfusion">InkFusion™</TabsTrigger>
                  <TabsTrigger value="material">Material™</TabsTrigger>
                  <TabsTrigger value="approval">Approval™</TabsTrigger>
                </TabsList>
                <TabsContent value="inkfusion"><ColorDropdown onColorSelect={(c) => { setSelectedColor(c); setCustomColor(null); setUploadedDesign(null); }} selectedColor={selectedColor} /></TabsContent>
                <TabsContent value="material"><SwatchUploader onAnalysisComplete={(a) => { if (a) { setCustomColor({ hex: a.hex, name: a.name, swatchUrl: a.url }); setSelectedColor(null); setUploadedDesign(null); } }} /></TabsContent>
                <TabsContent value="approval"><DesignUploader onDesignUpload={async (d) => { try { const r = await fetch(d.url); const b = await r.blob(); const f = new File([b], d.fileName); const { primary } = await extractColorsFromImage(f); setUploadedDesign({ ...d, extractedColorHex: primary }); setSelectedColor(null); setCustomColor(null); } catch { setUploadedDesign(d); } }} /></TabsContent>
              </Tabs>
              <FinishSelector value={finish} onChange={setFinish} />
              <Button onClick={handleGenerate} disabled={isGenerating} className="w-full" size="lg">{isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate</>}</Button>
              {isGenerating && (
                <GenerationWizard
                  isGenerating={isGenerating}
                  tips={COLORPRO_TIPS}
                  currentTipIndex={0}
                  toolName="Admin Render"
                  gradientFrom="from-blue-500"
                  gradientTo="to-blue-500"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </main>

    </div>
  );
}