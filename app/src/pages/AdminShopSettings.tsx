import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Save, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { DEFAULT_TERMS_TEXT } from '@/lib/default-terms';
// useUserTier returns a string, not an object

interface ShopProfile {
  id?: string;
  shop_name: string;
  shop_logo_url: string | null;
  phone: string;
  website: string;
  default_include_disclaimer: boolean;
  custom_terms_text: string;
}

const AdminShopSettings = () => {
  const navigate = useNavigate();
  const [tier, setTier] = useState<string>('basic');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [shopProfile, setShopProfile] = useState<ShopProfile>({
    shop_name: '',
    shop_logo_url: null,
    phone: '',
    website: '',
    default_include_disclaimer: false,
    custom_terms_text: DEFAULT_TERMS_TEXT,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    loadShopProfile();
    loadUserTier();
  }, []);

  const loadUserTier = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('user_subscriptions')
        .select('tier')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();
      
      if (data?.tier) setTier(data.tier);
    } catch (error) {
      console.error('Error loading tier:', error);
    }
  };

  const loadShopProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('shop_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data && !error) {
        setShopProfile({
          id: data.id,
          shop_name: data.shop_name || '',
          shop_logo_url: data.shop_logo_url,
          phone: data.phone || '',
          website: data.website || '',
          default_include_disclaimer: data.default_include_disclaimer || false,
          custom_terms_text: (data as any).custom_terms_text || DEFAULT_TERMS_TEXT,
        });
        if (data.shop_logo_url) {
          setLogoPreview(data.shop_logo_url);
        }
      }
    } catch (error) {
      console.error('Error loading shop profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setShopProfile(prev => ({ ...prev, shop_logo_url: null }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: 'Error',
          description: 'You must be logged in to save settings',
          variant: 'destructive',
        });
        return;
      }

      let logoUrl = shopProfile.shop_logo_url;

      // Upload logo if new file selected
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${user.id}/shop-logo.${fileExt}`;

        const { error: uploadError, data: uploadData } = await supabase.storage
          .from('renders')
          .upload(fileName, logoFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('renders')
          .getPublicUrl(fileName);

        logoUrl = publicUrl;
      }

      // Upsert shop profile
      const { error } = await supabase
        .from('shop_profiles')
        .upsert({
          id: shopProfile.id || undefined,
          user_id: user.id,
          shop_name: shopProfile.shop_name,
          shop_logo_url: logoUrl,
          phone: shopProfile.phone,
          website: shopProfile.website,
          default_include_disclaimer: shopProfile.default_include_disclaimer,
          custom_terms_text: shopProfile.custom_terms_text,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'user_id',
        });

      if (error) throw error;

      toast({
        title: 'Settings Saved',
        description: 'Your shop settings have been updated.',
      });

      // Reload to get the new ID if it was an insert
      loadShopProfile();
    } catch (error) {
      console.error('Error saving shop profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const canAccessShopBranding = tier === 'pro' || tier === 'elite' || tier === 'agency';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Shop Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure your shop branding for customer proofs
            </p>
          </div>
        </div>

        {/* Shop Branding Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Shop Branding</CardTitle>
            <CardDescription>
              Add your shop logo and name to appear on customer design proofs
              {!canAccessShopBranding && (
                <span className="block mt-1 text-amber-500">
                  Upgrade to Pro or Elite tier to enable custom shop branding
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Logo Upload */}
            <div className="space-y-2">
              <Label>Shop Logo</Label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <div className="relative">
                    <img
                      src={logoPreview}
                      alt="Shop logo preview"
                      className="h-16 w-auto max-w-[200px] object-contain border rounded-lg p-2"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={removeLogo}
                      disabled={!canAccessShopBranding}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="h-16 w-40 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                    No logo
                  </div>
                )}
                <Label
                  htmlFor="logo-upload"
                  className={`cursor-pointer ${!canAccessShopBranding ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted transition-colors">
                    <Upload className="h-4 w-4" />
                    Upload Logo
                  </div>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoChange}
                    disabled={!canAccessShopBranding}
                  />
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Recommended: PNG or SVG with transparent background, max 500KB
              </p>
            </div>

            {/* Shop Name */}
            <div className="space-y-2">
              <Label htmlFor="shop-name">Shop Name</Label>
              <Input
                id="shop-name"
                placeholder="Your Wrap Shop Name"
                value={shopProfile.shop_name}
                onChange={(e) => setShopProfile(prev => ({ ...prev, shop_name: e.target.value }))}
                disabled={!canAccessShopBranding}
              />
            </div>

            {/* Contact Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input
                  id="phone"
                  placeholder="(555) 123-4567"
                  value={shopProfile.phone}
                  onChange={(e) => setShopProfile(prev => ({ ...prev, phone: e.target.value }))}
                  disabled={!canAccessShopBranding}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website (optional)</Label>
                <Input
                  id="website"
                  placeholder="www.yourshop.com"
                  value={shopProfile.website}
                  onChange={(e) => setShopProfile(prev => ({ ...prev, website: e.target.value }))}
                  disabled={!canAccessShopBranding}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Proof Settings Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Default Proof Settings</CardTitle>
            <CardDescription>
              Configure default options for generated customer proofs
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="disclaimer-default">Include Terms & Conditions by Default</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, proofs will include the full disclaimer text
                </p>
              </div>
              <Switch
                id="disclaimer-default"
                checked={shopProfile.default_include_disclaimer}
                onCheckedChange={(checked) => setShopProfile(prev => ({ 
                  ...prev, 
                  default_include_disclaimer: checked 
                }))}
                disabled={!canAccessShopBranding}
              />
            </div>
          </CardContent>
        </Card>

        {/* Terms & Conditions Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Terms & Conditions</CardTitle>
            <CardDescription>
              Customize the terms shown on customer design proofs. These are pre-filled with standard wrap industry terms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={shopProfile.custom_terms_text}
              onChange={(e) => setShopProfile(prev => ({ ...prev, custom_terms_text: e.target.value }))}
              placeholder="Enter your shop's terms and conditions..."
              className="min-h-[240px] text-sm font-mono leading-relaxed"
              disabled={!canAccessShopBranding}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                These terms appear on 3D proofs and PDF proof sheets when the T&C checkbox is enabled.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShopProfile(prev => ({ ...prev, custom_terms_text: DEFAULT_TERMS_TEXT }))}
                disabled={!canAccessShopBranding || shopProfile.custom_terms_text === DEFAULT_TERMS_TEXT}
                className="gap-1.5 shrink-0"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to Default
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              How your branding will appear on customer proofs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-white text-black p-4 rounded-lg border">
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="h-8 object-contain" />
                ) : (
                  <div className="text-lg font-bold">
                    <span className="text-black">Restyle</span>
                    <span className="text-blue-600">Pro</span>
                    <span className="text-xs align-top">™</span>
                  </div>
                )}
                {shopProfile.shop_name && (
                  <span className="text-sm text-gray-600">{shopProfile.shop_name}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <Button 
          className="w-full" 
          size="lg" 
          onClick={handleSave}
          disabled={isSaving || !canAccessShopBranding}
        >
          {isSaving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>

        {!canAccessShopBranding && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            Upgrade to Pro or Elite tier to customize shop branding
          </p>
        )}
      </div>
    </div>
  );
};

export default AdminShopSettings;
