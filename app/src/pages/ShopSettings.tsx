import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Upload, Save, Trash2, X, Mail, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ShopTeamTab } from '@/components/shop/ShopTeamTab';

interface ShopProfile {
  id?: string;
  shop_name: string;
  shop_logo_url: string | null;
  phone: string;
  website: string;
  notification_emails: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type TabKey = 'profile' | 'team';

const ShopSettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: TabKey = tabParam === 'team' ? 'team' : 'profile';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [shopProfile, setShopProfile] = useState<ShopProfile>({
    shop_name: '',
    shop_logo_url: null,
    phone: '',
    website: '',
    notification_emails: [],
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    loadShopProfile();
  }, []);

  // Sync tab state with ?tab= query param so deep links + back/forward
  // navigation preserve the selected tab.
  useEffect(() => {
    const next = searchParams.get('tab') === 'team' ? 'team' : 'profile';
    if (next !== activeTab) setActiveTab(next);
    // Only react to query-param changes, not activeTab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    const next = value === 'team' ? 'team' : 'profile';
    setActiveTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'team') {
      params.set('tab', 'team');
    } else {
      params.delete('tab');
    }
    setSearchParams(params, { replace: true });
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
          notification_emails: Array.isArray((data as any).notification_emails)
            ? (data as any).notification_emails
            : [],
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
      reader.onloadend = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setShopProfile(prev => ({ ...prev, shop_logo_url: null }));
  };

  const addNotificationEmail = () => {
    const candidate = newEmail.trim().toLowerCase();
    if (!candidate) return;
    if (!EMAIL_RE.test(candidate)) {
      toast({ title: 'Invalid email', description: `"${candidate}" doesn't look like a valid email address.`, variant: 'destructive' });
      return;
    }
    if (shopProfile.notification_emails.some(e => e.toLowerCase() === candidate)) {
      toast({ title: 'Already on the list', description: candidate });
      setNewEmail('');
      return;
    }
    setShopProfile(prev => ({ ...prev, notification_emails: [...prev.notification_emails, candidate] }));
    setNewEmail('');
  };

  const removeNotificationEmail = (email: string) => {
    setShopProfile(prev => ({
      ...prev,
      notification_emails: prev.notification_emails.filter(e => e !== email),
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: 'Error', description: 'You must be logged in to save settings', variant: 'destructive' });
        return;
      }

      let logoUrl = shopProfile.shop_logo_url;

      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${user.id}/shop-logo.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('renders')
          .upload(fileName, logoFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('renders')
          .getPublicUrl(fileName);

        logoUrl = publicUrl;
      }

      const { error } = await supabase
        .from('shop_profiles')
        .upsert({
          id: shopProfile.id || undefined,
          user_id: user.id,
          shop_name: shopProfile.shop_name,
          shop_logo_url: logoUrl,
          phone: shopProfile.phone,
          website: shopProfile.website,
          notification_emails: shopProfile.notification_emails,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'user_id' });

      if (error) throw error;

      toast({ title: 'Settings Saved', description: 'Your shop branding has been updated.' });
      loadShopProfile();
    } catch (error) {
      console.error('Error saving shop profile:', error);
      toast({ title: 'Error', description: 'Failed to save settings. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-8">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Shop Settings</h1>
            <p className="text-sm text-muted-foreground">
              Branding that appears on customer proofs and the team that can sign in
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="profile">Branding</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Shop Identity</CardTitle>
                <CardDescription>
                  Add your logo and shop name so they appear on all customer design proofs
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
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="h-16 w-40 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                        No logo
                      </div>
                    )}
                    <Label htmlFor="shop-logo-upload" className="cursor-pointer">
                      <div className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted transition-colors">
                        <Upload className="h-4 w-4" />
                        Upload Logo
                      </div>
                      <input
                        id="shop-logo-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoChange}
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
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Website (optional)</Label>
                    <Input
                      id="website"
                      placeholder="www.yourshop.com"
                      value={shopProfile.website}
                      onChange={(e) => setShopProfile(prev => ({ ...prev, website: e.target.value }))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Proof Notifications */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Proof Notifications
                </CardTitle>
                <CardDescription>
                  Cc additional recipients (design team, production manager, etc.) on
                  ApprovePro emails when a customer approves, declines, or requests a revision.
                  Your account email always stays as the primary recipient.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="notification-email">Add recipient</Label>
                  <div className="flex gap-2">
                    <Input
                      id="notification-email"
                      type="email"
                      placeholder="design@yourshop.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addNotificationEmail();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addNotificationEmail}
                      disabled={!newEmail.trim()}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Press Enter or click Add. Remember to click "Save Shop Branding" below to persist changes.
                  </p>
                </div>

                {shopProfile.notification_emails.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No additional recipients yet. Notifications go only to your account email.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {shopProfile.notification_emails.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeNotificationEmail(email)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${email}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Preview */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>How your branding appears on customer proofs</CardDescription>
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

            <Button className="w-full" size="lg" onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Shop Branding
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="team">
            <ShopTeamTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ShopSettings;
