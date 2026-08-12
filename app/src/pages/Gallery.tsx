import { Helmet } from "react-helmet-async";
import { SEOBreadcrumb } from "@/components/SEOBreadcrumb";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Maximize2, Download, Eye, ExternalLink, ChevronLeft, ChevronRight, Star, LayoutGrid, Layers, ImageOff, Palette, ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getCanvasVersion } from "@/lib/canvas-bg-removal";
import { downloadWithOverlay } from "@/lib/download-with-overlay";
import { thumbnailUrl } from "@/lib/storage-thumbnail";
import { ShareDesignButton } from "@/components/ShareDesignButton";

const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "driver-side": "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up Detail",
  roof: "Roof",
  panel: "Flat Panel (2D)",
  hero: "Hero View",
  myvehicle_edit: "Customer Photo",
  closeup: "Close-Up Detail",
  detail: "Detail",
};

// View keys that are 2D flat artwork rather than a 3D vehicle render.
// Used to stamp a "2D" badge on the gallery card when the customer is
// looking at the flat panel artwork instead of the on-vehicle render.
const FLAT_2D_VIEW_KEYS = new Set(["panel", "flat", "artwork"]);

// Product-type → display label + badge color for the corner pill.
// Keep this in sync with the dashboard token-balance card's tool list
// so customers see consistent tool branding across surfaces.
const TOOL_BADGE: Record<string, { label: string; bg: string }> = {
  inkfusion: { label: "ColorPro™", bg: "bg-cyan-500/90" },
  colorpro: { label: "ColorPro™", bg: "bg-cyan-500/90" },
  designpanelpro: { label: "DesignProAI™", bg: "bg-purple-500/90" },
  designproai: { label: "DesignProAI™", bg: "bg-purple-500/90" },
  wbty: { label: "PatternPro™", bg: "bg-emerald-500/90" },
  patternpro: { label: "PatternPro™", bg: "bg-emerald-500/90" },
  fadewraps: { label: "FadeWraps™", bg: "bg-pink-500/90" },
  approvemode: { label: "ApprovePro™", bg: "bg-amber-500/90" },
  wallpro: { label: "WallPro™", bg: "bg-indigo-500/90" },
  graphicspro: { label: "GraphicsPro™", bg: "bg-fuchsia-500/90" },
  recreatepro: { label: "RecreatePro™", bg: "bg-orange-500/90" },
  myvehiclepro: { label: "MyVehiclePro™", bg: "bg-blue-500/90" },
};
import { BeforeAfterSlider } from "@/components/gallery/BeforeAfterSlider";
import { useNavigate } from "react-router-dom";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { NewsletterCouponPopup } from "@/components/NewsletterCouponPopup";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";

type ProductType = 'all' | 'colorpro' | 'wbty' | 'approvemode' | 'fadewraps' | 'designpanelpro' | 'myvehiclepro';
type WBTYCategory = 'all' | 'Metal & Marble' | 'Wicked & Wild' | 'Camo & Carbon' | 'Bape Camo' | 'Modern & Trippy';
type SortOption = 'newest' | 'oldest' | 'vehicle-asc' | 'vehicle-desc' | 'pattern-asc' | 'pattern-desc';

interface GalleryItem {
  id: string;
  media_url: string;
  before_url?: string;
  title: string;
  subtitle: string;
  vehicle_name?: string;
  color_name?: string;
  pattern_name?: string;
  category?: string;
  product_type: string;
  created_at: string;
  render_urls?: Record<string, any>;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_type?: string;
  color_hex?: string;
  finish_type?: string;
  manufacturer?: string;
  mode_type?: string;
}

interface GroupedGalleryItem {
  groupKey: string;
  items: GalleryItem[];
  primaryItem: GalleryItem;
}

export default function Gallery() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<ProductType>('all');
  const [selectedFinish, setSelectedFinish] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<WBTYCategory>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [fullscreenImage, _setFullscreenImage] = useState<GalleryItem | null>(null);
  const setFullscreenImage = (item: GalleryItem | null) => {
    if (item) window.dispatchEvent(new Event("gallery-card-click"));
    _setFullscreenImage(item);
  };
  const [swatchModal, setSwatchModal] = useState<{ isOpen: boolean; item: GalleryItem | null }>({ isOpen: false, item: null });
  const [swatchImageUrl, setSwatchImageUrl] = useState<string | null>(null);
  const [selectedViewUrl, setSelectedViewUrl] = useState<string | null>(null);
  const [groupViewIndex, setGroupViewIndex] = useState<Record<string, number>>({});
  const [isPrivilegedUser, setIsPrivilegedUser] = useState(false);
  const [lightStudioIds, setLightStudioIds] = useState<Set<string>>(new Set());
  const [layoutMode, setLayoutMode] = useState<"grid" | "gallery">("grid");
  const [canvasMode, setCanvasMode] = useState(false);
  const [canvasUrls, setCanvasUrls] = useState<Record<string, string>>({});
  const [canvasLoading, setCanvasLoading] = useState<Set<string>>(new Set());
  const [detailGroup, setDetailGroup] = useState<GroupedGalleryItem | null>(null);
  const [detailSelectedView, setDetailSelectedView] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [zoomTitle, setZoomTitle] = useState<string>('');

  const toggleLightStudio = (groupKey: string) => {
    setLightStudioIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const processCanvasView = useCallback(async (imageUrl: string, cacheKey: string) => {
    if (canvasUrls[cacheKey] || canvasLoading.has(cacheKey)) return;
    setCanvasLoading((prev) => new Set(prev).add(cacheKey));
    try {
      const url = await getCanvasVersion(imageUrl, cacheKey);
      setCanvasUrls((prev) => ({ ...prev, [cacheKey]: url }));
    } catch (err) {
      console.error("[canvas] Failed:", cacheKey, err);
      toast.error("Canvas processing failed for this image");
    } finally {
      setCanvasLoading((prev) => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  }, [canvasUrls, canvasLoading]);

  /** Get display URL for a gallery item, swapping to _light render if toggled */
  const getDisplayUrl = (item: GalleryItem, isLight: boolean): string => {
    if (!isLight) return item.media_url;
    // If the item has render_urls, try to find a _light version
    if (item.render_urls && typeof item.render_urls === 'object') {
      const urls = item.render_urls as Record<string, any>;
      // Try to find the _light variant matching the current media_url
      for (const [key, url] of Object.entries(urls)) {
        if (key.endsWith('_light') || key === 'spin_views') continue;
        if (url === item.media_url) {
          const lightKey = `${key}_light`;
          if (urls[lightKey] && typeof urls[lightKey] === 'string') {
            return urls[lightKey] as string;
          }
        }
      }
      // Fallback: try hero_light or side_light
      if (urls.hero_light) return urls.hero_light as string;
      if (urls.side_light) return urls.side_light as string;
    }
    return item.media_url;
  };

  // Check if current user is admin or tester
  useEffect(() => {
    const checkUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'tester']);
      
      setIsPrivilegedUser(roles && roles.length > 0);
    };
    checkUserRole();
  }, []);

  const getProductRoute = (productType: string) => {
    const routes: Record<string, string> = {
      'colorpro': '/colorpro',
      'ColorPro': '/colorpro',
      'inkfusion': '/colorpro',
      'fadewraps': '/fadewraps',
      'wbty': '/wbty',
      'designpanelpro': '/designpro',
      'approvemode': '/approvemode',
      'myvehiclepro': '/myvehiclepro'
    };
    return routes[productType] || '/';
  };

  const getProductName = (productType: string) => {
    const names: Record<string, string> = {
      'colorpro': 'ColorPro™',
      'ColorPro': 'ColorPro™',
      'inkfusion': 'ColorPro™',
      'fadewraps': 'FadeWraps™',
      'wbty': 'PatternPro™',
      'designpanelpro': 'DesignProAI™',
      'approvemode': 'ApprovePro™',
      'myvehiclepro': 'MyVehiclePro™'
    };
    return names[productType] || 'Product';
  };

  // Fetch all carousel items AND all past generated renders
  const { data: galleryItems, isLoading } = useQuery({
    queryKey: ['gallery-items'],
    staleTime: 0, // Always refetch for fresh data
    refetchOnMount: 'always',
    queryFn: async () => {
      const allItems: GalleryItem[] = [];

      // Fetch InkFusion carousel
      const { data: inkfusionData } = await supabase
        .from('inkfusion_carousel')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (inkfusionData) {
        allItems.push(...inkfusionData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.color_name || 'Untitled',
          subtitle: item.subtitle || '',
          vehicle_name: item.vehicle_name || '',
          color_name: item.color_name || '',
          pattern_name: '',
          category: '',
          product_type: 'inkfusion',
          created_at: item.created_at || ''
        })));
      }

      // Fetch ALL wbty_products ONCE for category lookup (performance optimization)
      const { data: wbtyProducts } = await supabase
        .from('wbty_products')
        .select('name, category');
      
      const wbtyProductsMap = new Map(
        wbtyProducts?.map(p => [p.name, p.category]) || []
      );

      // Fetch WBTY carousel
      const { data: wbtyData } = await supabase
        .from('wbty_carousel')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (wbtyData) {
        allItems.push(...wbtyData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.pattern_name || 'Untitled',
          subtitle: item.subtitle || '',
          vehicle_name: item.vehicle_name || '',
          color_name: '',
          pattern_name: item.pattern_name || '',
          category: item.pattern_name ? (wbtyProductsMap.get(item.pattern_name) || '') : '',
          product_type: 'wbty',
          created_at: item.created_at || ''
        })));
      }

      // Fetch ApproveMode carousel
      const { data: approvemodeData } = await supabase
        .from('approvemode_carousel')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (approvemodeData) {
        allItems.push(...approvemodeData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          before_url: item.before_url || undefined,
          title: item.title || item.color_name || 'Untitled',
          subtitle: item.subtitle || '',
          vehicle_name: item.vehicle_name || '',
          color_name: item.color_name || '',
          pattern_name: '',
          category: '',
          product_type: 'approvemode',
          created_at: item.created_at || ''
        })));
      }

      // Fetch FadeWraps carousel
      const { data: fadewrapsData } = await supabase
        .from('fadewraps_carousel')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (fadewrapsData) {
        allItems.push(...fadewrapsData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.pattern_name || 'Untitled',
          subtitle: item.subtitle || '',
          vehicle_name: item.vehicle_name || '',
          color_name: '',
          pattern_name: item.pattern_name || '',
          category: '',
          product_type: 'fadewraps',
          created_at: item.created_at || ''
        })));
      }

      // Fetch DesignPanelPro carousel
      const { data: designpanelproData } = await supabase
        .from('designpanelpro_carousel')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (designpanelproData) {
        allItems.push(...designpanelproData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.pattern_name || 'Untitled',
          subtitle: item.subtitle || '',
          vehicle_name: item.vehicle_name || '',
          color_name: '',
          pattern_name: item.pattern_name || '',
          category: '',
          product_type: 'designpanelpro',
          created_at: item.created_at || ''
        })));
      }

      // Fetch starred renders from color_visualizations (is_featured_hero = true)
      const { data: starredData } = await supabase
        .from('color_visualizations')
        .select('*')
        .eq('is_featured_hero', true)
        .order('created_at', { ascending: false });

      if (starredData) {
        for (const item of starredData) {
          const renderUrls = item.render_urls as Record<string, any> | null;
          const modeType = item.mode_type || 'colorpro';
          let productType = 'inkfusion';
          if (modeType.startsWith('myvehicle_') || modeType === 'myvehiclepro') productType = 'myvehiclepro';
          else if (modeType === 'wbty' || modeType === 'patternpro') productType = 'wbty';
          else if (modeType === 'fadewraps') productType = 'fadewraps';
          else if (modeType === 'designpanelpro') productType = 'designpanelpro';
          else if (modeType === 'approvemode') productType = 'approvemode';

          // Pick best hero image — driver side first, then other canonical
          // angles, then non-canonical keys used by DesignPanelPro (panel/hero),
          // MyVehiclePro (myvehicle_edit), and WallPro/GraphicsPro (hero/detail/closeup).
          const viewOrder = [
            'side', 'driver-side', 'passenger-side',
            'hood_detail', 'front', 'rear', 'close-up', 'roof', 'top',
            'myvehicle_edit', 'myvehicle_design', 'hero', 'panel', 'closeup', 'detail',
          ];
          let heroUrl = '';
          if (renderUrls) {
            for (const vk of viewOrder) {
              if (renderUrls[vk] && typeof renderUrls[vk] === 'string') {
                heroUrl = renderUrls[vk];
                break;
              }
            }
          }
          if (!heroUrl) continue;

          const displayName = item.color_name && item.color_name !== 'Untitled'
            ? item.color_name
            : `${item.finish_type || 'Gloss'} ${item.vehicle_make || ''} Wrap`.trim();

          // ONE item per design — render_urls preserved for view navigation
          allItems.push({
            id: `starred-${item.id}`,
            media_url: heroUrl,
            title: displayName,
            subtitle: `${item.finish_type || 'Gloss'} • ${Object.keys(renderUrls || {}).length} views`,
            vehicle_name: `${item.vehicle_year || ''} ${item.vehicle_make || ''} ${item.vehicle_model || ''}`.trim(),
            color_name: item.color_name || '',
            pattern_name: '',
            category: '',
            product_type: productType,
            created_at: item.created_at || '',
            render_urls: renderUrls || undefined,
            vehicle_year: item.vehicle_year ? String(item.vehicle_year) : undefined,
            vehicle_make: item.vehicle_make || undefined,
            vehicle_model: item.vehicle_model || undefined,
            vehicle_type: item.vehicle_type || undefined,
            color_hex: item.color_hex || undefined,
            finish_type: item.finish_type || undefined,
            mode_type: modeType,
          });
        }
      }

      // Fetch CreatorMarket marketplace listings
      const { data: marketplaceData } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('status', 'listed')
        .order('created_at', { ascending: false });

      if (marketplaceData) {
        allItems.push(...marketplaceData.map(item => ({
          id: `market-${item.id}`,
          media_url: item.preview_image_url || item.hero_image_url || '',
          title: item.title || 'CreatorMarket Design',
          subtitle: item.description || '',
          vehicle_name: item.vehicle_name || '',
          color_name: item.title || '',
          pattern_name: '',
          category: '',
          product_type: 'designpanelpro',
          created_at: item.created_at || '',
        })));
      }

      // Sort all items by date (newest first)
      return allItems.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
  });

  // Extract unique finishes from gallery items
  const finishes = Array.from(
    new Set(
      galleryItems
        ?.map(item => item.subtitle.toLowerCase())
        .filter(s => s.includes('gloss') || s.includes('satin') || s.includes('matte'))
        .map(s => {
          if (s.includes('gloss')) return 'Gloss';
          if (s.includes('satin')) return 'Satin';
          if (s.includes('matte')) return 'Matte';
          return '';
        })
        .filter(Boolean) || []
    )
  );

  // Filter items based on selections
  const filteredItems = galleryItems?.filter(item => {
    // Normalize product type for filtering (ColorPro and inkfusion are the same tool)
    const normalizedProductType = item.product_type?.toLowerCase() === 'colorpro' || item.product_type === 'inkfusion' 
      ? 'colorpro' 
      : item.product_type?.toLowerCase();
    const productMatch = selectedProduct === 'all' || normalizedProductType === selectedProduct;
    const finishMatch = selectedFinish === 'all' || item.subtitle.toLowerCase().includes(selectedFinish.toLowerCase());
    const categoryMatch = selectedCategory === 'all' || 
                          (item.product_type === 'wbty' && item.category === selectedCategory);
    return productMatch && finishMatch && categoryMatch;
  });

  // Sort filtered items
  const sortedItems = filteredItems?.sort((a, b) => {
    switch (sortBy) {
      case 'newest':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'oldest':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case 'vehicle-asc':
        return (a.vehicle_name || '').localeCompare(b.vehicle_name || '');
      case 'vehicle-desc':
        return (b.vehicle_name || '').localeCompare(a.vehicle_name || '');
      case 'pattern-asc':
        return (a.pattern_name || a.color_name || '').localeCompare(b.pattern_name || b.color_name || '');
      case 'pattern-desc':
        return (b.pattern_name || b.color_name || '').localeCompare(a.pattern_name || a.color_name || '');
      default:
        return 0;
    }
  });

  // Preferred view order — driver side first, then other angles
  const DRIVER_FIRST_ORDER = ["side", "driver-side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

  /** Pick the best "hero" URL for a gallery item — always driver side first */
  const getDriverSideUrl = (item: GalleryItem): string => {
    if (item.render_urls && typeof item.render_urls === 'object') {
      const urls = item.render_urls as Record<string, any>;
      for (const vk of DRIVER_FIRST_ORDER) {
        if (urls[vk] && typeof urls[vk] === 'string') return urls[vk] as string;
      }
    }
    return item.media_url;
  };

  // Group items by vehicle + color/pattern — one card per design, NOT per view
  const groupedItems = useMemo(() => {
    if (!sortedItems) return [];

    const groups = new Map<string, GalleryItem[]>();

    sortedItems.forEach(item => {
      let vehicleKey: string;
      if (item.vehicle_year && item.vehicle_make && item.vehicle_model) {
        const year = String(item.vehicle_year).trim();
        const make = String(item.vehicle_make).trim();
        const model = String(item.vehicle_model).trim();
        vehicleKey = `${year}-${make}-${model}`.toLowerCase();
      } else if (item.vehicle_name) {
        vehicleKey = item.vehicle_name.toLowerCase().trim();
      } else {
        vehicleKey = item.id;
      }

      let designKey = (item.color_name || item.pattern_name || '').toLowerCase().trim();
      if (!designKey) designKey = (item.title || '').toLowerCase().trim();
      if (!designKey) designKey = item.id;

      const productKey = item.product_type?.toLowerCase() || '';
      const groupKey = `${vehicleKey}|${designKey}|${productKey}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }

      // Add the whole item — do NOT explode render_urls into separate items
      const existing = groups.get(groupKey)!;
      if (!existing.some(i => i.id === item.id)) {
        existing.push(item);
      }
    });

    const result: GroupedGalleryItem[] = [];
    groups.forEach((items, groupKey) => {
      const validItems = items.filter(i => i.media_url && i.media_url.length > 0);
      if (validItems.length > 0) {
        // Pick primary item: prefer the one with the most render_urls (richest data)
        const best = validItems.reduce((a, b) => {
          const aCount = a.render_urls ? Object.keys(a.render_urls).length : 0;
          const bCount = b.render_urls ? Object.keys(b.render_urls).length : 0;
          return bCount > aCount ? b : a;
        }, validItems[0]);
        // Ensure primary shows driver side
        const primaryItem = { ...best, media_url: getDriverSideUrl(best) };
        result.push({ groupKey, items: validItems, primaryItem });
      }
    });

    return result;
  }, [sortedItems]);

  const handleGroupNav = (groupKey: string, direction: 'prev' | 'next', totalItems: number) => {
    setGroupViewIndex(prev => {
      const currentIndex = prev[groupKey] || 0;
      let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex < 0) newIndex = totalItems - 1;
      if (newIndex >= totalItems) newIndex = 0;
      return { ...prev, [groupKey]: newIndex };
    });
  };

  const handleSwatchClick = async (item: GalleryItem) => {
    setSwatchModal({ isOpen: true, item });
    
    // Fetch the swatch image based on product type
    try {
      if (item.product_type === 'inkfusion' && item.color_name) {
        const { data } = await supabase
          .from('inkfusion_swatches')
          .select('media_url')
          .eq('name', item.color_name)
          .single();
        setSwatchImageUrl(data?.media_url || null);
      } else if (item.product_type === 'wbty' && item.pattern_name) {
        const { data } = await supabase
          .from('wbty_products')
          .select('media_url')
          .eq('name', item.pattern_name)
          .single();
        setSwatchImageUrl(data?.media_url || null);
      } else if (item.product_type === 'fadewraps' && item.pattern_name) {
        const { data } = await supabase
          .from('fadewraps_patterns')
          .select('media_url')
          .eq('name', item.pattern_name)
          .single();
        setSwatchImageUrl(data?.media_url || null);
      }
    } catch (error) {
      console.error('Error fetching swatch:', error);
      setSwatchImageUrl(null);
    }
  };

  const handleDownload = async (imageUrl: string, filename: string, renderItem?: GalleryItem | null) => {
    try {
      toast.success('Download started');

      // Build overlay from render metadata
      const modeType = renderItem?.mode_type || '';
      const MODE_TOOL_MAP: Record<string, string> = {
        colorpro: 'ColorPro™', ColorPro: 'ColorPro™', inkfusion: 'ColorPro™',
        designpanelpro: 'DesignProAI™', designpro: 'DesignProAI™',
        fadewraps: 'FadeWraps™', wbty: 'PatternPro™',
        approvemode: 'ApprovePro™', GraphicsPro: 'GraphicsPro™',
      };
      const toolName = MODE_TOOL_MAP[modeType] || 'RestyleProAI™';
      const manufacturer = renderItem?.infusion_color_id || '';
      const colorName = renderItem?.color_name || '';

      await downloadWithOverlay(imageUrl, filename.replace(/\.png$/i, ''), {
        toolName,
        manufacturer,
        colorOrDesignName: colorName,
      });
    } catch (error) {
      console.error('Download error:', error);
      window.open(imageUrl, '_blank');
      toast.info('Image opened in new tab - right-click to save');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>Gallery | RestyleProAI</title>
        <meta name="description" content="Real wrap designs — color changes, full custom wraps, fade wraps, pattern wraps, wall murals, and more. Built on the world's first prompt-to-production wrap platform." />
        <link rel="canonical" href="https://www.restyleproai.com/gallery" />
        <meta property="og:title" content="Gallery | RestyleProAI" />
        <meta property="og:description" content="Real vehicle wrap designs from the RestyleProAI platform." />
        <meta property="og:url" content="https://www.restyleproai.com/gallery" />
        <meta property="og:image" content="https://restyleproai.com/hero-mustang.jpg" />
      </Helmet>
      <SEOBreadcrumb items={[{ name: "Home", path: "/" }, { name: "Gallery", path: "/gallery" }]} />

      <main className="flex-1 container mx-auto px-4 py-8">
        {/* Header Section */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/characters/sproket/sproket-camera.png" alt="SPROKET" className="w-12 h-12 sm:w-16 sm:h-16 object-contain" />
            <h1 className="text-4xl md:text-5xl font-bold">
              <span className="text-gradient-blue">Gallery</span>
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real wrap designs — every render labeled with the tool that made it. Click any card for details.
          </p>
          {/* Gallery Mode Toggle */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant={layoutMode === "grid" ? "default" : "outline"}
              size="sm"
              onClick={() => setLayoutMode("grid")}
              className="gap-1.5"
            >
              <LayoutGrid className="h-4 w-4" />
              Grid
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLayoutMode(layoutMode === "gallery" ? "grid" : "gallery")}
              className={cn(
                "gap-1.5",
                layoutMode === "gallery" ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "text-zinc-400 border-zinc-700",
              )}
            >
              <Layers className="h-4 w-4" />
              GalleryMode
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCanvasMode(!canvasMode)}
              className={cn(
                "gap-1.5",
                canvasMode ? "bg-white text-zinc-900 border-white" : "text-zinc-400 border-zinc-700",
              )}
            >
              Canvas
            </Button>
          </div>
        </div>

        {/* Compact filter row */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Select value={selectedProduct} onValueChange={(value) => setSelectedProduct(value as ProductType)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Product" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="colorpro">ColorPro™</SelectItem>
              <SelectItem value="wbty">PatternPro™</SelectItem>
              <SelectItem value="fadewraps">FadeWraps™</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
              <SelectItem value="approvemode">ApprovePro™</SelectItem>
              <SelectItem value="myvehiclepro">MyVehiclePro™</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedFinish} onValueChange={setSelectedFinish}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Finish" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Finishes</SelectItem>
              {finishes.map(finish => (
                <SelectItem key={finish} value={finish}>{finish}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="vehicle-asc">Vehicle A-Z</SelectItem>
              <SelectItem value="vehicle-desc">Vehicle Z-A</SelectItem>
            </SelectContent>
          </Select>
          {groupedItems && (
            <p className="text-sm text-muted-foreground ml-auto">
              {groupedItems.length} designs
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="w-full aspect-video mb-4 rounded-lg" />
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </Card>
            ))}
          </div>
        ) : !groupedItems?.length ? (
          <Card className="p-12">
            <div className="text-center text-muted-foreground">
              <img src="/characters/sproket/sproket-question.png" alt="SPROKET" className="w-16 h-16 object-contain mx-auto mb-3 opacity-70" />
              <p className="text-lg font-medium mb-2">No designs found</p>
              <p className="text-sm">
                {selectedProduct !== 'all' || selectedFinish !== 'all'
                  ? 'Try adjusting your filters to see more results'
                  : 'Gallery is empty. Generate some designs to see them here!'}
              </p>
            </div>
          </Card>
        ) : (
          <>
          {/* ===== GalleryMode: 7-view rows per design ===== */}
          {layoutMode === "gallery" && (
            <div className="space-y-4">
              {groupedItems.map((group) => {
                const item = group.primaryItem;
                const vehicleName = item.vehicle_name || item.title;
                const designLabel = item.color_name || item.pattern_name || item.title || "Design";
                const viewOrder = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
                const viewLabels: Record<string, string> = { side: "Driver", "passenger-side": "Passenger", hood_detail: "Hood", front: "Front 3/4", rear: "Rear 3/4", "close-up": "Close-Up", roof: "Roof" };

                // Build URL map from group items + render_urls
                const urls: Record<string, string> = {};
                for (const gi of group.items) {
                  if (gi.render_urls && typeof gi.render_urls === "object") {
                    for (const [k, v] of Object.entries(gi.render_urls)) {
                      if (typeof v === "string" && !k.endsWith("_light") && k !== "spin_views") urls[k] = v;
                    }
                  }
                }
                // If no render_urls, map the media_url to best-guess view
                if (Object.keys(urls).length === 0) {
                  group.items.forEach((gi, idx) => {
                    if (gi.media_url) urls[viewOrder[idx] || `view-${idx}`] = gi.media_url;
                  });
                }
                const viewCount = viewOrder.filter((v) => urls[v]).length;

                return (
                  <div
                    key={group.groupKey}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-all hover:border-violet-500/30"
                  >
                    {/* Header */}
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate capitalize">{vehicleName}</p>
                        <p className="text-[10px] text-zinc-500 truncate">
                          {designLabel}
                          {item.subtitle ? ` | ${item.subtitle}` : ""}
                          {item.product_type ? ` | ${item.product_type}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-[10px] font-bold", viewCount >= 5 ? "text-emerald-400" : "text-amber-400")}>
                        {viewCount}/{viewOrder.length}
                      </span>
                      <ShareDesignButton
                        shareType="render"
                        shareId={item.id}
                        designName={designLabel}
                        vehicleName={vehicleName}
                        imageUrl={urls.side || urls['driver-side'] || Object.values(urls)[0]}
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        onClick={() => setFullscreenImage(item)}
                      >
                        <Eye className="h-3 w-3" /> View
                      </Button>
                    </div>

                    {/* 7-View Grid */}
                    <div className="grid grid-cols-7 gap-1 p-2 bg-black/20">
                      {viewOrder.map((viewType) => {
                        const url = urls[viewType];
                        return (
                          <div
                            key={viewType}
                            className={cn(
                              "relative aspect-video rounded-lg overflow-hidden",
                              url ? "bg-zinc-800 cursor-pointer hover:ring-2 hover:ring-violet-500/50" : "bg-zinc-900 border border-dashed border-zinc-700",
                            )}
                            onClick={() => {
                              if (url) {
                                // Find the matching gallery item to open in lightbox
                                const matchItem = group.items.find(gi => gi.media_url === url) || { ...item, media_url: url };
                                setFullscreenImage(matchItem);
                              }
                            }}
                          >
                            {url ? (
                              <img src={thumbnailUrl(url, 400)} alt={viewLabels[viewType]} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageOff className="h-3 w-3 text-zinc-700" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                              <span className={cn("text-[7px] font-medium", url ? "text-white/80" : "text-red-400/60")}>
                                {viewLabels[viewType]}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== Grid Mode: card grid ===== */}
          {layoutMode === "grid" && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {groupedItems.map((group) => {
              const item = group.primaryItem;

              // Build ordered view URLs from render_urls (driver side first)
              // Build an ordered list of { key, url } for each view so the
              // card can render a label ("Driver Side", "Flat Panel (2D)")
              // and a 2D/3D badge alongside the existing view counter.
              const orderedViews: { key: string; url: string }[] = [];
              const bestItem = group.items.reduce((a, b) => {
                const ac = a.render_urls ? Object.keys(a.render_urls).length : 0;
                const bc = b.render_urls ? Object.keys(b.render_urls).length : 0;
                return bc > ac ? b : a;
              }, group.items[0]);
              if (bestItem.render_urls && typeof bestItem.render_urls === 'object') {
                const urls = bestItem.render_urls as Record<string, any>;
                for (const vk of DRIVER_FIRST_ORDER) {
                  if (urls[vk] && typeof urls[vk] === 'string') {
                    orderedViews.push({ key: vk, url: urls[vk] as string });
                  }
                }
                // Add any remaining views not in the priority list
                for (const [k, v] of Object.entries(urls)) {
                  if (
                    typeof v === 'string' &&
                    !k.endsWith('_light') &&
                    k !== 'spin_views' &&
                    !orderedViews.some((view) => view.url === v)
                  ) {
                    orderedViews.push({ key: k, url: v });
                  }
                }
              }
              // Fallback: if no render_urls, just the primary media_url
              if (orderedViews.length === 0) {
                orderedViews.push({ key: 'primary', url: item.media_url });
              }

              // Legacy alias — many call sites below still use the URL
              // list directly. Keep both so the rest of the card code
              // doesn't need to know about the new structure.
              const orderedViewUrls: string[] = orderedViews.map((v) => v.url);

              const currentIndex = groupViewIndex[group.groupKey] || 0;
              const displayUrl = orderedViewUrls[currentIndex] || orderedViewUrls[0];
              const hasMultipleViews = orderedViewUrls.length > 1;
              const currentView = orderedViews[currentIndex] ?? orderedViews[0];
              const currentViewLabel =
                VIEW_LABELS[currentView.key] ??
                currentView.key.replace(/[-_]/g, ' ');
              const currentIs2d = FLAT_2D_VIEW_KEYS.has(currentView.key);
              
              return (
                <Card
                  key={group.groupKey}
                  className="group overflow-hidden hover:shadow-lg transition-all duration-300 flex flex-col"
                >
                  <div className={cn(
                    "gallery-card-image-wrapper",
                    lightStudioIds.has(group.groupKey) && "bg-white"
                  )}>{/* S.A.W. FIX: contain without cropping */}

                    {/* Multi-view navigation arrows */}
                    {hasMultipleViews && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-black/60 hover:bg-black/80 text-white rounded-full h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGroupNav(group.groupKey, 'prev', orderedViewUrls.length);
                          }}
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-black/60 hover:bg-black/80 text-white rounded-full h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGroupNav(group.groupKey, 'next', orderedViewUrls.length);
                          }}
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                        {/* View counter + label badge — tells the customer
                            both which view they're on AND its name. */}
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 bg-black/75 text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap">
                          <span className="font-semibold">{currentIndex + 1} / {orderedViewUrls.length}</span>
                          <span className="text-white/55">·</span>
                          <span>{currentViewLabel}</span>
                        </div>
                      </>
                    )}

                    {/* 2D / 3D dimension badge — top-right corner. Helps
                        customers distinguish a flat-panel print artwork
                        view from a 3D vehicle render at a glance. */}
                    <div
                      className={cn(
                        "absolute top-2 right-2 z-20 text-white text-[10px] font-bold px-2 py-0.5 rounded pointer-events-none border",
                        currentIs2d
                          ? "bg-amber-500/90 border-amber-300/40"
                          : "bg-emerald-500/90 border-emerald-300/40",
                      )}
                    >
                      {currentIs2d ? "2D" : "3D"}
                    </div>

                    {/* Product type badge overlay — labels every card
                        with the tool that produced the render. Source:
                        TOOL_BADGE map at the top of this file. */}
                    {(() => {
                      const key = (
                        item.product_type === 'inkfusion' || item.mode_type === 'inkfusion'
                          ? 'colorpro'
                          : item.product_type ?? ''
                      ).toLowerCase();
                      const badge = TOOL_BADGE[key];
                      if (!badge) return null;
                      return (
                        <div className={cn(
                          "absolute top-2 left-2 z-20 text-white text-[10px] font-bold px-2 py-0.5 rounded pointer-events-none",
                          badge.bg,
                        )}>
                          {badge.label}
                        </div>
                      );
                    })()}

                    {item.product_type === 'approvemode' && item.before_url ? (
                      <>
                        <BeforeAfterSlider
                          beforeUrl={thumbnailUrl(item.before_url, 800)}
                          afterUrl={thumbnailUrl(item.media_url, 800)}
                          altText={item.title}
                        />
                        {/* PIP Before thumbnail */}
                        <div
                          className="absolute bottom-2 left-2 z-20 w-14 h-10 rounded overflow-hidden border border-white/30 shadow-lg cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setFullscreenImage(item); }}
                          title="Recreated from reference"
                        >
                          <img src={thumbnailUrl(item.before_url, 200)} alt="Before" className="w-full h-full object-cover" />
                          <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[7px] text-white text-center font-semibold py-px">Before</span>
                        </div>
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
                          <Button
                            size="icon"
                            variant="secondary"
                            onClick={() => setFullscreenImage(item)}
                            title="View fullscreen"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const canvasKey = `${group.groupKey}-${currentIndex}`;
                          const baseUrl = lightStudioIds.has(group.groupKey) ? getDisplayUrl(item, true) : displayUrl;
                          const imgSrc = canvasMode && canvasUrls[canvasKey] ? canvasUrls[canvasKey] : baseUrl;
                          const isProcessing = canvasMode && canvasLoading.has(canvasKey);

                          // Trigger canvas processing when mode is on and no cached result
                          if (canvasMode && !canvasUrls[canvasKey] && !canvasLoading.has(canvasKey)) {
                            processCanvasView(baseUrl, canvasKey);
                          }

                          return (
                            <>
                              <img
                                src={canvasMode && canvasUrls[canvasKey] ? imgSrc : thumbnailUrl(imgSrc, 800)}
                                alt={item.title}
                                className={cn(
                                  "gallery-card-image transition-transform duration-300 cursor-pointer active:scale-95",
                                  (lightStudioIds.has(group.groupKey) || (canvasMode && canvasUrls[canvasKey])) && "!bg-white"
                                )}
                                loading="lazy"
                                decoding="async"
                                onClick={() => { setDetailGroup(group); setDetailSelectedView(null); }}
                              />
                              {isProcessing && (
                                <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
                                  <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {/* PIP Before thumbnail for non-slider cards with a reference */}
                        {item.before_url && (
                          <div
                            className="absolute bottom-2 left-2 z-20 w-14 h-10 rounded overflow-hidden border border-white/30 shadow-lg cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); setFullscreenImage(item); }}
                            title="Recreated from reference"
                          >
                            <img src={thumbnailUrl(item.before_url, 200)} alt="Before" className="w-full h-full object-cover" />
                            <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[7px] text-white text-center font-semibold py-px">Before</span>
                          </div>
                        )}
                        {/* Mobile-friendly overlay - clicking opens detail view */}
                        <div
                          className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 active:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2 p-4 cursor-pointer"
                          onClick={() => { setDetailGroup(group); setDetailSelectedView(null); }}
                        >
                          <Button
                            size="lg"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailGroup(group);
                              setDetailSelectedView(null);
                            }}
                            className="touch-manipulation"
                          >
                            <Eye className="h-5 w-5 sm:mr-2" />
                            <span className="hidden sm:inline">View</span>
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                  
                  <div className="p-4 flex-1 flex flex-col gap-2">
                    {/* Vehicle name as primary label */}
                    <h3 className="font-semibold text-base line-clamp-1">
                      {item.vehicle_name || item.title}
                    </h3>
                    {/* Color/design as subtitle */}
                    <p className="text-xs text-muted-foreground truncate">
                      {item.color_name || item.pattern_name || item.title}
                      {item.subtitle ? ` · ${item.subtitle}` : ''}
                    </p>

                    {/* Date */}
                    <p className="text-xs text-muted-foreground/70">
                      {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>}
          </>
        )}

        {/* ===== Detail View — shown when a card is clicked ===== */}
        {detailGroup && (() => {
          const item = detailGroup.primaryItem;
          const vehicleName = item.vehicle_name || item.title;
          const designLabel = item.color_name || item.pattern_name || item.title || "Design";
          const toolName = getProductName(item.product_type);
          const viewOrder = ["side", "driver-side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

          // Build all view URLs from render_urls
          const allViewUrls: Array<{ key: string; url: string; label: string }> = [];
          const richItem = detailGroup.items.reduce((a, b) => {
            const ac = a.render_urls ? Object.keys(a.render_urls).length : 0;
            const bc = b.render_urls ? Object.keys(b.render_urls).length : 0;
            return bc > ac ? b : a;
          }, detailGroup.items[0]);

          if (richItem.render_urls && typeof richItem.render_urls === 'object') {
            const urls = richItem.render_urls as Record<string, any>;
            // Add in canonical order first
            for (const vk of viewOrder) {
              if (urls[vk] && typeof urls[vk] === 'string') {
                allViewUrls.push({ key: vk, url: urls[vk] as string, label: VIEW_LABELS[vk] || vk });
              }
            }
            // Add any remaining views
            for (const [k, v] of Object.entries(urls)) {
              if (typeof v === 'string' && !k.endsWith('_light') && k !== 'spin_views' && !allViewUrls.some(av => av.url === v)) {
                allViewUrls.push({ key: k, url: v, label: VIEW_LABELS[k] || k.replace('_', ' ') });
              }
            }
          }
          // Fallback: single view
          if (allViewUrls.length === 0) {
            allViewUrls.push({ key: 'hero', url: item.media_url, label: 'Hero View' });
          }

          const activeUrl = detailSelectedView || allViewUrls[0]?.url || item.media_url;
          const activeLabel = allViewUrls.find(v => v.url === activeUrl)?.label || 'View';

          return (
            <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Back button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDetailGroup(null)}
                className="mb-4 gap-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Gallery
              </Button>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left: View thumbnails grid */}
                <div className="lg:col-span-5 xl:col-span-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                    {allViewUrls.map((view) => (
                      <button
                        key={view.key}
                        onClick={() => setDetailSelectedView(view.url)}
                        onDoubleClick={() => {
                          setZoomImageUrl(view.url);
                          setZoomTitle(`${activeLabel} - ${vehicleName}`);
                        }}
                        className={cn(
                          "relative aspect-video rounded-lg overflow-hidden border-2 transition-all cursor-pointer group",
                          activeUrl === view.url
                            ? "border-cyan-500 ring-2 ring-cyan-500/30"
                            : "border-zinc-700 hover:border-zinc-500"
                        )}
                      >
                        <img src={thumbnailUrl(view.url, 400)} alt={view.label} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-0.5">
                          <span className="text-[10px] font-medium text-white/80">{view.label}</span>
                        </div>
                        {/* Zoom hint on hover */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Maximize2 className="h-4 w-4 text-white/70" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Large preview + info */}
                <div className="lg:col-span-7 xl:col-span-8 space-y-4">
                  {/* Large hero image */}
                  <div
                    className="relative aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-black cursor-pointer group"
                    onDoubleClick={() => {
                      setZoomImageUrl(activeUrl);
                      setZoomTitle(`${activeLabel} - ${vehicleName}`);
                    }}
                  >
                    <img
                      src={activeUrl}
                      alt={`${vehicleName} - ${activeLabel}`}
                      className="w-full h-full object-contain"
                    />
                    {/* View label badge */}
                    <div className="absolute top-3 left-3 bg-cyan-500/90 text-white text-xs font-bold px-3 py-1 rounded">
                      {activeLabel}
                    </div>
                    {/* Double-click zoom hint */}
                    <div className="absolute bottom-3 right-3 bg-black/60 text-white/60 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      Double-click to zoom
                    </div>
                  </div>

                  {/* Thumbnail strip below hero */}
                  {allViewUrls.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {allViewUrls.map((view) => (
                        <button
                          key={view.key}
                          onClick={() => setDetailSelectedView(view.url)}
                          className={cn(
                            "flex-shrink-0 w-20 h-14 rounded-lg border-2 overflow-hidden transition-all",
                            activeUrl === view.url
                              ? "border-cyan-400 ring-1 ring-cyan-400/40"
                              : "border-zinc-700 hover:border-zinc-500"
                          )}
                        >
                          <img src={thumbnailUrl(view.url, 200)} alt={view.label} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Vehicle info + actions */}
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-bold text-foreground capitalize">{vehicleName}</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {designLabel}
                          {item.finish_type ? ` · ${item.finish_type}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1 rounded-full whitespace-nowrap">
                        {toolName}
                      </span>
                    </div>

                    {/* View count + date */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{allViewUrls.length} views</span>
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white"
                        onClick={() => navigate('/revision-studio', { state: { imageUrl: activeUrl, vehicleName } })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit in RevisionStudio
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => navigate(getProductRoute(item.product_type))}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open in {toolName}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => handleDownload(activeUrl, `${(vehicleName || 'render').replace(/\s+/g, '-')}-${activeLabel}.png`, fullscreenImage)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Vehicle-Specific Wrap Pages — SEO Internal Links */}
        <section className="mt-12 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <img src="/characters/sproket/sproket-camera.png" alt="SPROKET" className="w-8 h-8 sm:w-10 sm:h-10 object-contain" />
            <h2 className="text-xl font-semibold text-foreground">Browse Wraps by Vehicle</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { slug: "ford-mustang-wraps", label: "Ford Mustang" },
              { slug: "ford-f150-wraps", label: "Ford F-150" },
              { slug: "chevrolet-corvette-wraps", label: "Chevy Corvette" },
              { slug: "dodge-charger-wraps", label: "Dodge Charger" },
              { slug: "tesla-model-3-wraps", label: "Tesla Model 3" },
              { slug: "bmw-m4-wraps", label: "BMW M4" },
              { slug: "porsche-911-wraps", label: "Porsche 911" },
              { slug: "lamborghini-huracan-wraps", label: "Lamborghini Huracán" },
              { slug: "jeep-wrangler-wraps", label: "Jeep Wrangler" },
              { slug: "toyota-supra-wraps", label: "Toyota Supra" },
            ].map((v) => (
              <Link
                key={v.slug}
                to={`/gallery/${v.slug}`}
                className="group p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-center"
              >
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{v.label}</p>
                <p className="text-xs text-muted-foreground">Wrap Designs</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {/* Fullscreen Modal */}
      <Dialog open={!!fullscreenImage} onOpenChange={() => { setFullscreenImage(null); setSelectedViewUrl(null); }}>
        <DialogContent className="max-w-7xl w-full p-0 bg-black/95" aria-describedby={undefined}>
          <VisuallyHidden>
            <DialogTitle>{fullscreenImage?.title || 'Gallery Image'}</DialogTitle>
          </VisuallyHidden>
          {fullscreenImage && (
            <div className="relative">
              {/* Close button */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full"
                onClick={() => setFullscreenImage(null)}
              >
                <span className="text-2xl">×</span>
              </Button>

              {/* Navigation arrows */}
              {sortedItems && sortedItems.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full h-12 w-12"
                    onClick={() => {
                      const currentIndex = sortedItems.findIndex(item => item.id === fullscreenImage.id);
                      const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedItems.length - 1;
                      setFullscreenImage(sortedItems[prevIndex]);
                    }}
                  >
                    <span className="text-2xl">‹</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full h-12 w-12"
                    onClick={() => {
                      const currentIndex = sortedItems.findIndex(item => item.id === fullscreenImage.id);
                      const nextIndex = currentIndex < sortedItems.length - 1 ? currentIndex + 1 : 0;
                      setFullscreenImage(sortedItems[nextIndex]);
                    }}
                  >
                    <span className="text-2xl">›</span>
                  </Button>
                </>
              )}

              {/* Main Image Display */}
              {fullscreenImage.product_type === 'approvemode' && fullscreenImage.before_url ? (
                <div className="w-full">
                  {selectedViewUrl ? (
                    <img
                      src={selectedViewUrl}
                      alt={fullscreenImage.title}
                      className="w-full h-auto max-h-[70vh] object-contain"
                    />
                  ) : (
                    <BeforeAfterSlider
                      beforeUrl={fullscreenImage.before_url}
                      afterUrl={fullscreenImage.media_url}
                      altText={fullscreenImage.title}
                    />
                  )}
                </div>
              ) : (
                <img
                  src={selectedViewUrl || fullscreenImage.media_url}
                  alt={fullscreenImage.title}
                  className="w-full h-auto max-h-[70vh] object-contain"
                />
              )}

              {/* Multi-View Thumbnail Strip for items with render_urls */}
              {fullscreenImage.render_urls && Object.keys(fullscreenImage.render_urls).filter(key => !key.includes('spin')).length > 1 && (
                <div className="bg-black/60 p-3 mt-2">
                  <p className="text-white/60 text-xs mb-2 text-center">All Available Views</p>
                  <div className="flex gap-2 justify-center overflow-x-auto pb-2">
                    {/* Before/After toggle for ApproveMode */}
                    {fullscreenImage.product_type === 'approvemode' && fullscreenImage.before_url && (
                      <button
                        onClick={() => setSelectedViewUrl(null)}
                        className={`flex-shrink-0 w-20 h-14 rounded border-2 overflow-hidden transition-all ${
                          !selectedViewUrl ? 'border-blue-400 ring-2 ring-blue-400/50' : 'border-white/20 hover:border-white/40'
                        }`}
                      >
                        <div className="w-full h-full bg-gradient-to-r from-orange-500/50 to-blue-500/50 flex items-center justify-center">
                          <span className="text-[10px] text-white font-medium">Before/After</span>
                        </div>
                      </button>
                    )}
                    {Object.entries(fullscreenImage.render_urls)
                      .filter(([key, val]) => !key.includes('spin') && typeof val === 'string')
                      .map(([viewType, url]) => (
                        <button
                          key={viewType}
                          onClick={() => setSelectedViewUrl(url as string)}
                          className={`flex-shrink-0 w-20 h-14 rounded border-2 overflow-hidden transition-all ${
                            selectedViewUrl === url ? 'border-blue-400 ring-2 ring-blue-400/50' : 'border-white/20 hover:border-white/40'
                          }`}
                        >
                          <img src={thumbnailUrl(url as string, 200)} className="w-full h-full object-cover" alt={viewType} />
                          <span className="sr-only">{viewType}</span>
                        </button>
                      ))}
                  </div>
                  <div className="flex gap-2 justify-center mt-2 flex-wrap">
                    {Object.entries(fullscreenImage.render_urls)
                      .filter(([key, val]) => !key.includes('spin') && typeof val === 'string')
                      .map(([viewType]) => (
                        <span key={viewType} className="text-[10px] text-white/60">{VIEW_LABELS[viewType] || viewType.replace('_', ' ')}</span>
                      ))}
                  </div>
                </div>
              )}

              {/* Info Bar */}
              <div className="bg-gradient-to-t from-black/80 to-black/60 p-6">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-2">{fullscreenImage.title}</h2>
                    <p className="text-white/80 mb-1">{fullscreenImage.subtitle}</p>
                    {fullscreenImage.vehicle_name && (
                      <p className="text-white/60 text-sm">{fullscreenImage.vehicle_name}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Share This Design */}
                    <ShareDesignButton
                      shareType="render"
                      shareId={fullscreenImage.id}
                      designName={fullscreenImage.color_name || fullscreenImage.pattern_name || fullscreenImage.title}
                      vehicleName={fullscreenImage.vehicle_name}
                      imageUrl={selectedViewUrl || fullscreenImage.media_url}
                      variant="outline"
                      size="default"
                      className="gap-2 border-white/30 text-white hover:bg-white/10"
                    />
                    {/* View in Tool - Pass visualization ID for ApproveMode */}
                    <Button
                      onClick={() => {
                        if (fullscreenImage.product_type === 'approvemode') {
                          navigate(`/approvemode?visualizationId=${fullscreenImage.id}`);
                        } else {
                          navigate(getProductRoute(fullscreenImage.product_type));
                        }
                      }}
                      className="gap-2 bg-blue-500 hover:bg-blue-600"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View in {getProductName(fullscreenImage.product_type)}
                    </Button>
                    
                    {/* Download buttons */}
                    {fullscreenImage.product_type === 'approvemode' && fullscreenImage.before_url ? (
                      <>
                        <Button
                          variant="secondary"
                          className="gap-2"
                          onClick={() => handleDownload(
                            fullscreenImage.before_url!,
                            `${fullscreenImage.title.replace(/\s+/g, '-')}-before.png`,
                            fullscreenImage
                          )}
                        >
                          <Download className="h-4 w-4" />
                          Before
                        </Button>
                        <Button
                          variant="secondary"
                          className="gap-2"
                          onClick={() => handleDownload(
                            selectedViewUrl || fullscreenImage.media_url,
                            `${fullscreenImage.title.replace(/\s+/g, '-')}-${selectedViewUrl ? 'view' : 'after'}.png`,
                            fullscreenImage
                          )}
                        >
                          <Download className="h-4 w-4" />
                          {selectedViewUrl ? 'This View' : 'After'}
                        </Button>
                        {/* Download All Views */}
                        {fullscreenImage.render_urls && Object.keys(fullscreenImage.render_urls).filter(k => !k.includes('spin')).length > 1 && (
                          <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => {
                              Object.entries(fullscreenImage.render_urls || {})
                                .filter(([key, val]) => !key.includes('spin') && typeof val === 'string')
                                .forEach(([viewType, url]) => {
                                  handleDownload(url as string, `${fullscreenImage.title.replace(/\s+/g, '-')}-${viewType}.png`, fullscreenImage);
                                });
                            }}
                          >
                            <Download className="h-4 w-4" />
                            All Views
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        className="gap-2"
                        onClick={() => handleDownload(
                          selectedViewUrl || fullscreenImage.media_url,
                          `${fullscreenImage.title.replace(/\s+/g, '-')}.png`,
                          fullscreenImage
                        )}
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Swatch Modal */}
      <Dialog open={swatchModal.isOpen} onOpenChange={(open) => {
        setSwatchModal({ isOpen: open, item: null });
        setSwatchImageUrl(null);
      }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <VisuallyHidden>
            <DialogTitle>{swatchModal.item?.pattern_name || swatchModal.item?.color_name || 'Swatch'}</DialogTitle>
          </VisuallyHidden>
          {swatchModal.item && (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold mb-2">
                  {swatchModal.item.pattern_name || swatchModal.item.color_name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {swatchModal.item.product_type === 'inkfusion' && 'InkFusion™'}
                  {swatchModal.item.product_type === 'wbty' && 'Wrap By The Yard'}
                  {swatchModal.item.product_type === 'fadewraps' && 'FadeWraps™'}
                  {swatchModal.item.product_type === 'approvemode' && 'ApproveMode™'}
                  {swatchModal.item.subtitle && ` - ${swatchModal.item.subtitle}`}
                </p>
              </div>
              
              {swatchImageUrl ? (
                <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                  <img
                    src={swatchImageUrl}
                    alt={swatchModal.item.pattern_name || swatchModal.item.color_name || 'Swatch'}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="relative aspect-square rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                  <p className="text-muted-foreground">No swatch image available</p>
                </div>
              )}
              
              {swatchModal.item.category && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Category:</span>
                  <span className="font-medium">{swatchModal.item.category}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Fullscreen zoom modal — double-click any view in detail panel */}
      <MobileZoomImageModal
        imageUrl={zoomImageUrl || ''}
        title={zoomTitle}
        isOpen={!!zoomImageUrl}
        onClose={() => setZoomImageUrl(null)}
      />

      <NewsletterCouponPopup triggerAfterClicks={3} scrollDelayMs={5000} />
    </div>
  );
}
