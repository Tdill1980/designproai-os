import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Type, Images, Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';

const db = supabase as any;

const FONT_OPTIONS: { value: string; label: string; stack: string }[] = [
  { value: 'poppins', label: 'Poppins (modern)', stack: '"Poppins", sans-serif' },
  { value: 'oswald', label: 'Oswald (bold display)', stack: '"Oswald", sans-serif' },
  { value: 'montserrat', label: 'Montserrat (clean)', stack: '"Montserrat", sans-serif' },
  { value: 'inter', label: 'Inter (UI sans)', stack: '"Inter", sans-serif' },
  { value: 'georgia', label: 'Georgia (serif)', stack: 'Georgia, serif' },
  { value: 'impact', label: 'Impact (heavy)', stack: 'Impact, "Arial Black", sans-serif' },
  { value: 'courier', label: 'Courier (mono)', stack: '"Courier New", monospace' },
];

const STORAGE_BUCKET = 'wrap-files';
const STORAGE_PREFIX = (userId: string) => `renders/${userId}/shop-logo`;

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function persistLogoUrl(url: string | null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  await db
    .from('shop_profiles')
    .update({ shop_logo_url: url })
    .eq('user_id', user.id);

  await db
    .from('shops')
    .update({ logo_url: url })
    .eq('owner_user_id', user.id);
}

async function renderTextToPng(
  text: string,
  fontStack: string,
  color: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const width = 800;
  const height = 200;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.clearRect(0, 0, width, height);
  let fontSize = 96;
  ctx.font = `700 ${fontSize}px ${fontStack}`;
  while (ctx.measureText(text).width > width - 40 && fontSize > 20) {
    fontSize -= 4;
    ctx.font = `700 ${fontSize}px ${fontStack}`;
  }

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

export function ShopEmailBrandingCard() {
  const { currentShop, refresh } = useOrganization();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(currentShop?.name ?? '');
  const [fontValue, setFontValue] = useState(FONT_OPTIONS[0].value);
  const [color, setColor] = useState('#0a0a0d');

  useEffect(() => {
    if (currentShop?.name && !text) setText(currentShop.name);
  }, [currentShop?.name]);

  const activeFont = FONT_OPTIONS.find((f) => f.value === fontValue) ?? FONT_OPTIONS[0];

  const gallery = useQuery({
    queryKey: ['shop-logo-gallery', currentShop?.id],
    enabled: !!currentShop,
    queryFn: async () => {
      const userId = await getCurrentUserId();
      if (!userId) return [] as { name: string; url: string; path: string; created: string | null }[];
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(STORAGE_PREFIX(userId), {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' },
        });
      if (error) return [];
      return (data ?? [])
        .filter((f: any) => !!f.name && !f.name.startsWith('.'))
        .map((f: any) => {
          const path = `${STORAGE_PREFIX(userId)}/${f.name}`;
          const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
          return { name: f.name, url: pub.publicUrl, path, created: f.created_at ?? null };
        });
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['shop-logo-gallery'] }),
      refresh(),
    ]);
  };

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo too large — max 5MB');
      return;
    }
    setBusy(true);
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error('Not signed in');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${STORAGE_PREFIX(userId)}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await persistLogoUrl(pub.publicUrl);
      toast.success('Logo updated');
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveText = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Type your shop name first');
      return;
    }
    setBusy(true);
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error('Not signed in');
      const blob = await renderTextToPng(trimmed, activeFont.stack, color);
      const path = `${STORAGE_PREFIX(userId)}/text-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, blob, { contentType: 'image/png', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await persistLogoUrl(pub.publicUrl);
      toast.success('Text logo saved');
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePickFromGallery = async (url: string) => {
    setBusy(true);
    try {
      await persistLogoUrl(url);
      toast.success('Logo set');
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not set logo');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFromGallery = async (path: string, isActive: boolean) => {
    setBusy(true);
    try {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
      if (error) throw error;
      if (isActive) {
        await persistLogoUrl(null);
      }
      toast.success('Removed from gallery');
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const activeLogoUrl = currentShop?.logo_url ?? null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6 shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Email header logo</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            This is the logo customers see at the top of every email you send. Upload an image,
            type your shop name with a font, or pick from a logo you&apos;ve already uploaded.
          </p>
        </div>
        <div className="shrink-0">
          <div className="h-16 w-40 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
            {activeLogoUrl ? (
              <img src={activeLogoUrl} alt="Current logo" className="h-full w-full object-contain p-2" />
            ) : (
              <span className="text-[11px] text-gray-400">No logo set</span>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="upload" className="gap-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="text" className="gap-1.5 text-xs">
            <Type className="h-3.5 w-3.5" /> Text + font
          </TabsTrigger>
          <TabsTrigger value="gallery" className="gap-1.5 text-xs">
            <Images className="h-3.5 w-3.5" /> My gallery
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {activeLogoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            <p className="text-[11px] text-gray-500">
              PNG, JPG, SVG, or WebP — transparent background recommended, max 5MB.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="text" className="mt-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="branding-text" className="text-xs">Shop name</Label>
                <Input
                  id="branding-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Royalty Wraps"
                  maxLength={40}
                />
              </div>
              <div>
                <Label className="text-xs">Font</Label>
                <Select value={fontValue} onValueChange={setFontValue}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.stack }}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="branding-color" className="text-xs">Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="branding-color"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-9 w-12 rounded border border-gray-200 cursor-pointer"
                  />
                  <Input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="font-mono text-xs uppercase"
                  />
                </div>
              </div>
              <Button onClick={handleSaveText} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                Save as my logo
              </Button>
            </div>
            <div>
              <Label className="text-xs">Preview</Label>
              <div className="mt-1 h-32 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                <span
                  className="text-3xl font-bold truncate px-4"
                  style={{ fontFamily: activeFont.stack, color }}
                >
                  {text || 'Your shop name'}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Saved as a transparent PNG so it drops cleanly into any email background.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="gallery" className="mt-4">
          {gallery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your logos…
            </div>
          ) : (gallery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-500">
              No saved logos yet. Anything you upload or generate from text will show up here so you
              can switch between them later.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {gallery.data!.map((g) => {
                const isActive = g.url === activeLogoUrl;
                return (
                  <div
                    key={g.path}
                    className={cn(
                      'relative group rounded-lg border bg-gray-50 overflow-hidden',
                      isActive ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200',
                    )}
                  >
                    <div className="h-24 flex items-center justify-center p-3">
                      <img src={g.url} alt={g.name} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="flex items-center justify-between p-2 bg-white border-t border-gray-100">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handlePickFromGallery(g.url)}
                          disabled={busy}
                        >
                          Use this
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-400 hover:text-red-500"
                        onClick={() => handleDeleteFromGallery(g.path, isActive)}
                        disabled={busy}
                        aria-label="Remove from gallery"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
