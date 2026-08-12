import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { ArrowLeft, Trash2, ChevronDown, ChevronRight, Image, RefreshCw, Star, CheckSquare, Square, Sparkles, Loader2, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type ProductType = 'all' | 'colorpro' | 'inkfusion' | 'wbty' | 'approvemode' | 'fadewraps' | 'designpanelpro';

interface GalleryItem {
  id: string;
  media_url: string;
  title: string;
  subtitle: string;
  vehicle_name?: string;
  color_name?: string;
  pattern_name?: string;
  category?: string;
  product_type: string;
  table_name: string;
  created_at: string;
  render_urls?: any;
  mode_type?: string;
  finish_type?: string;
  manufacturer?: string;
  is_featured_hero?: boolean;
  show_on_quote_pdf?: boolean;
}

interface GroupedRender {
  id: string;
  title: string;
  vehicle_name: string;
  color_name: string;
  pattern_name: string;
  product_type: string;
  created_at: string;
  images: GalleryItem[];
  table_name: string;
  finish_type?: string;
  manufacturer?: string;
  is_featured_hero?: boolean;
  show_on_quote_pdf?: boolean;
}

export default function AdminGallery() {
  const [selectedProduct, setSelectedProduct] = useState<ProductType>('all');
  const [itemToDelete, setItemToDelete] = useState<GalleryItem | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const queryClient = useQueryClient();

  // Fetch ALL gallery items from all sources
  const { data: galleryItems, isLoading, error: queryError } = useQuery({
    queryKey: ['admin-gallery-all-items'],
    queryFn: async () => {
      console.log('🔍 Admin Gallery: Fetching all items...');
      const allItems: GalleryItem[] = [];

      // 1. Fetch ALL color_visualizations (main renders table)
      const { data: visualizationsData, error: vizError } = await supabase
        .from('color_visualizations')
        .select('*')
        .order('created_at', { ascending: false });

      if (vizError) {
        console.error('Error fetching color_visualizations:', vizError);
      }
      
      console.log('📊 color_visualizations count:', visualizationsData?.length || 0);

      if (visualizationsData) {
        for (const item of visualizationsData) {
          const renderUrls = item.render_urls as any;
          const modeType = item.mode_type || 'colorpro';
          
          // Determine product type from mode_type
          let productType = 'colorpro';
          if (modeType === 'wbty' || modeType === 'patternpro') productType = 'wbty';
          else if (modeType === 'fadewraps') productType = 'fadewraps';
          else if (modeType === 'designpanelpro') productType = 'designpanelpro';
          else if (modeType === 'approvemode') productType = 'approvemode';
          else if (modeType === 'inkfusion') productType = 'inkfusion';

          // Get pattern name for WBTY from design_file_name or custom_design_url
          let patternName = '';
          if (productType === 'wbty' && item.design_file_name) {
            patternName = item.design_file_name.replace(/\.[^/.]+$/, ''); // Remove file extension
          }

          // One card per design — pick hero image, not one per view
          if (renderUrls) {
            const viewOrder = ['side', 'driver-side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof', 'top'];
            let heroUrl = '';
            for (const vk of viewOrder) {
              if (renderUrls[vk] && typeof renderUrls[vk] === 'string') {
                heroUrl = renderUrls[vk];
                break;
              }
            }
            if (!heroUrl) continue;

            const viewCount = Object.keys(renderUrls).filter(k => k !== 'spin_views' && k !== 'manufacturer' && renderUrls[k]).length;

            allItems.push({
              id: item.id,
              media_url: heroUrl,
              title: item.color_name && item.color_name !== 'Untitled' && !item.color_name.toLowerCase().includes('custom')
                ? item.color_name
                : patternName || `${item.finish_type || 'Gloss'} ${item.vehicle_make || ''} Wrap`.trim(),
              subtitle: `${item.finish_type || 'Gloss'} • ${viewCount} views`,
              vehicle_name: `${item.vehicle_year} ${item.vehicle_make} ${item.vehicle_model}`,
              color_name: item.color_name || '',
              pattern_name: patternName,
              category: productType === 'wbty' ? 'Pattern' : '',
              product_type: productType,
              table_name: 'color_visualizations',
              created_at: item.created_at || '',
              render_urls: renderUrls,
              mode_type: modeType,
              finish_type: item.finish_type,
              manufacturer: (renderUrls as any)?.manufacturer || '',
              is_featured_hero: item.is_featured_hero || false,
              show_on_quote_pdf: (item as any).show_on_quote_pdf || false
            });
          }
        }
      }

      // 2. Fetch vehicle_renders table
      const { data: vehicleRendersData, error: vrError } = await supabase
        .from('vehicle_renders')
        .select('*')
        .order('created_at', { ascending: false });

      if (vrError) {
        console.error('Error fetching vehicle_renders:', vrError);
      }

      if (vehicleRendersData) {
        for (const item of vehicleRendersData) {
          const colorData = item.color_data as any;
          const rawName = colorData?.color_name || colorData?.name;
          // NEVER show "Untitled" - use descriptive fallback
          const displayName = rawName && rawName !== 'Untitled' && !rawName.toLowerCase().includes('custom')
            ? rawName
            : `${colorData?.finish || 'Gloss'} ${item.vehicle_make || ''} Wrap`.trim();
          allItems.push({
            id: item.id,
            media_url: item.render_url,
            title: displayName,
            subtitle: item.mode_type || '',
            vehicle_name: `${item.vehicle_year} ${item.vehicle_make} ${item.vehicle_model}`,
            color_name: colorData?.color_name || colorData?.name || '',
            pattern_name: colorData?.pattern_name || '',
            category: '',
            product_type: item.mode_type || 'colorpro',
            table_name: 'vehicle_renders',
            created_at: item.created_at || '',
            finish_type: colorData?.finish,
            manufacturer: colorData?.manufacturer || ''
          });
        }
      }

      // 3. Fetch carousel tables
      // InkFusion carousel
      const { data: inkfusionData } = await supabase
        .from('inkfusion_carousel')
        .select('*')
        .order('created_at', { ascending: false });

      if (inkfusionData) {
        allItems.push(...inkfusionData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.color_name || 'Untitled',
          subtitle: item.subtitle || 'Carousel',
          vehicle_name: item.vehicle_name || '',
          color_name: item.color_name || '',
          pattern_name: '',
          category: '',
          product_type: 'inkfusion',
          table_name: 'inkfusion_carousel',
          created_at: item.created_at || ''
        })));
      }

      // WBTY carousel - fetch pattern name from wbty_products
      const { data: wbtyData } = await supabase
        .from('wbty_carousel')
        .select('*')
        .order('created_at', { ascending: false });

      if (wbtyData) {
        for (const item of wbtyData) {
          let category = '';
          let patternDisplayName = item.pattern_name || '';
          
          if (item.pattern_name) {
            const { data: productData } = await supabase
              .from('wbty_products')
              .select('category, name')
              .eq('name', item.pattern_name)
              .maybeSingle();
            
            if (productData) {
              category = productData.category || '';
              patternDisplayName = productData.name || item.pattern_name;
            }
          }
          
          allItems.push({
            id: item.id,
            media_url: item.media_url,
            title: item.title || patternDisplayName || 'Untitled',
            subtitle: item.subtitle || 'Carousel',
            vehicle_name: item.vehicle_name || '',
            color_name: '',
            pattern_name: patternDisplayName,
            category: category,
            product_type: 'wbty',
            table_name: 'wbty_carousel',
            created_at: item.created_at || ''
          });
        }
      }

      // ApproveMode carousel
      const { data: approvemodeData } = await supabase
        .from('approvemode_carousel')
        .select('*')
        .order('created_at', { ascending: false });

      if (approvemodeData) {
        allItems.push(...approvemodeData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.color_name || 'Untitled',
          subtitle: item.subtitle || 'Carousel',
          vehicle_name: item.vehicle_name || '',
          color_name: item.color_name || '',
          pattern_name: '',
          category: '',
          product_type: 'approvemode',
          table_name: 'approvemode_carousel',
          created_at: item.created_at || ''
        })));
      }

      // FadeWraps carousel
      const { data: fadewrapsData } = await supabase
        .from('fadewraps_carousel')
        .select('*')
        .order('created_at', { ascending: false });

      if (fadewrapsData) {
        allItems.push(...fadewrapsData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.pattern_name || 'Untitled',
          subtitle: item.subtitle || 'Carousel',
          vehicle_name: item.vehicle_name || '',
          color_name: '',
          pattern_name: item.pattern_name || '',
          category: '',
          product_type: 'fadewraps',
          table_name: 'fadewraps_carousel',
          created_at: item.created_at || ''
        })));
      }

      // DesignPanelPro carousel
      const { data: designpanelproData } = await supabase
        .from('designpanelpro_carousel')
        .select('*')
        .order('created_at', { ascending: false });

      if (designpanelproData) {
        allItems.push(...designpanelproData.map(item => ({
          id: item.id,
          media_url: item.media_url,
          title: item.title || item.pattern_name || 'Untitled',
          subtitle: item.subtitle || 'Carousel',
          vehicle_name: item.vehicle_name || '',
          color_name: '',
          pattern_name: item.pattern_name || '',
          category: '',
          product_type: 'designpanelpro',
          table_name: 'designpanelpro_carousel',
          created_at: item.created_at || ''
        })));
      }

      console.log('✅ Admin Gallery: Total items fetched:', allItems.length);
      return allItems.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    staleTime: 0, // Always refetch
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  // Group items by render session (same vehicle + color/pattern + timestamp proximity)
  const groupedRenders = (): GroupedRender[] => {
    if (!galleryItems) return [];
    
    const groups: Map<string, GroupedRender> = new Map();
    
    for (const item of galleryItems) {
      // Extract full UUID (36 chars) from IDs that may have view suffixes
      let baseId = item.id;
      if (item.table_name === 'color_visualizations') {
        const uuidMatch = item.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          baseId = uuidMatch[0];
        }
      }
      
      const groupKey = `${baseId}-${item.vehicle_name}-${item.color_name || item.pattern_name}`;
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: baseId,
          title: item.title,
          vehicle_name: item.vehicle_name || '',
          color_name: item.color_name || '',
          pattern_name: item.pattern_name || '',
          product_type: item.product_type,
          created_at: item.created_at,
          images: [],
          table_name: item.table_name,
          finish_type: item.finish_type,
          manufacturer: item.manufacturer,
          is_featured_hero: item.is_featured_hero || false,
          show_on_quote_pdf: (item as any).show_on_quote_pdf || false
        });
      }

      groups.get(groupKey)!.images.push(item);
    }
    
    return Array.from(groups.values()).sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };

  // Delete mutation with proper table handling
  const deleteMutation = useMutation({
    mutationFn: async (item: GalleryItem) => {
      // For color_visualizations items with view suffixes, get the base UUID
      // UUIDs have format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
      let idToDelete = item.id;
      let tableToDeleteFrom = item.table_name;
      
      if (item.table_name === 'color_visualizations') {
        // Extract UUID (first 36 characters) - handles suffixes like -hood_detail, -spin-30
        const uuidMatch = item.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          idToDelete = uuidMatch[0];
        }
      }

      console.log(`Deleting from ${tableToDeleteFrom} with id: ${idToDelete}`);

      const { error } = await supabase
        .from(tableToDeleteFrom as any)
        .delete()
        .eq('id', idToDelete);

      if (error) {
        console.error('Delete error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Force immediate refetch after invalidation
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.invalidateQueries({ queryKey: ['gallery-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      toast.success('Item deleted successfully');
      setItemToDelete(null);
    },
    onError: (error: any) => {
      console.error('Delete mutation error:', error);
      toast.error('Failed to delete item: ' + error.message);
    },
  });

  // Delete entire group
  const deleteGroupMutation = useMutation({
    mutationFn: async (group: GroupedRender) => {
      const { error } = await supabase
        .from(group.table_name as any)
        .delete()
        .eq('id', group.id);

      if (error) {
        console.error('Delete group error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Force immediate refetch after invalidation
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.invalidateQueries({ queryKey: ['gallery-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      toast.success('Render group deleted successfully');
    },
    onError: (error: any) => {
      console.error('Delete group mutation error:', error);
      toast.error('Failed to delete: ' + error.message);
    },
  });

  // Star/unstar toggle
  const starMutation = useMutation({
    mutationFn: async ({ groupId, starred }: { groupId: string; starred: boolean }) => {
      const { error } = await supabase
        .from('color_visualizations')
        .update({ is_featured_hero: starred })
        .eq('id', groupId);
      if (error) throw error;
    },
    onSuccess: (_, { starred }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      toast.success(starred ? 'Starred — will stay in gallery' : 'Unstarred');
    },
    onError: (error: any) => {
      toast.error('Failed to update: ' + error.message);
    },
  });

  // Quote PDF showcase toggle — flips show_on_quote_pdf so this design
  // appears in the 3-up "See it on real vehicles" strip on every quote
  // PDF. Independent of the gallery star so admins can curate the PDF
  // strip without affecting the dashboard slider rotation.
  const quotePdfMutation = useMutation({
    mutationFn: async ({ groupId, on }: { groupId: string; on: boolean }) => {
      const { error } = await (supabase.from('color_visualizations') as any)
        .update({ show_on_quote_pdf: on })
        .eq('id', groupId);
      if (error) throw error;
    },
    onSuccess: (_, { on }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      toast.success(on ? 'Will appear on Quote PDFs' : 'Removed from Quote PDFs');
    },
    onError: (error: any) => {
      toast.error('Failed to update: ' + error.message);
    },
  });

  // Bulk delete selected groups
  const bulkDeleteMutation = useMutation({
    mutationFn: async (groups: GroupedRender[]) => {
      for (const group of groups) {
        const { error } = await supabase
          .from(group.table_name as any)
          .delete()
          .eq('id', group.id);
        if (error) {
          console.error(`Failed to delete group ${group.id}:`, error);
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.invalidateQueries({ queryKey: ['gallery-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      setSelectedGroups(new Set());
      setBulkMode(false);
      toast.success('Selected renders deleted');
    },
    onError: (error: any) => {
      toast.error('Bulk delete failed: ' + error.message);
    },
  });

  // Re-render via DesignProAI pipeline
  const [reRenderingIds, setReRenderingIds] = useState<Set<string>>(new Set());
  const [reRenderProgress, setReRenderProgress] = useState<Record<string, string>>({});

  const reRenderDesignProAI = async (group: GroupedRender) => {
    const groupId = group.id;
    setReRenderingIds(prev => new Set(prev).add(groupId));
    setReRenderProgress(prev => ({ ...prev, [groupId]: "Starting..." }));

    try {
      // Parse vehicle info
      const parts = (group.vehicle_name || '').trim().split(/\s+/);
      const vehicleYear = parts[0] || '2024';
      const vehicleMake = parts[1] || 'Vehicle';
      const vehicleModel = parts.slice(2).join(' ') || 'Car';
      const colorName = group.color_name || group.pattern_name || group.title || 'Custom Design';
      const finish = group.finish_type || 'Gloss';

      // Get admin email
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'admin@restyleproai.com';

      const viewOrder = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
      let heroUrl: string | null = null;
      let completedViews = 0;

      // Render each view sequentially (2 at a time would hit rate limits)
      for (const viewType of viewOrder) {
        setReRenderProgress(prev => ({
          ...prev,
          [groupId]: `Rendering ${viewType} (${completedViews + 1}/${viewOrder.length})...`
        }));

        try {
          const { data, error } = await supabase.functions.invoke('generate-color-render', {
            body: {
              vehicleYear,
              vehicleMake,
              vehicleModel,
              modeType: 'designpanelpro',
              viewType,
              userEmail,
              skipCache: true,
              colorData: {
                panelName: colorName,
                finish: finish.toLowerCase(),
                manufacturer: 'DesignProAI Upgrade',
                colorLibrary: 'designpanelpro',
                ...(heroUrl ? { heroReferenceUrl: heroUrl } : {}),
              },
            },
          });

          if (error) {
            console.error(`[ReRender] ${viewType} error:`, error.message);
            continue;
          }

          if (data?.renderUrl) {
            completedViews++;
            if (viewType === 'side') heroUrl = data.renderUrl;
          }
        } catch (e: any) {
          console.error(`[ReRender] ${viewType} failed:`, e.message);
        }
      }

      setReRenderProgress(prev => ({ ...prev, [groupId]: `Done! ${completedViews}/${viewOrder.length} views` }));
      toast.success(`Re-rendered ${completedViews}/${viewOrder.length} views via DesignProAI`);

      // Refresh gallery
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-all-items'] });
      queryClient.invalidateQueries({ queryKey: ['gallery-items'] });
      queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
    } catch (e: any) {
      toast.error('Re-render failed: ' + e.message);
      setReRenderProgress(prev => ({ ...prev, [groupId]: 'Failed' }));
    } finally {
      setTimeout(() => {
        setReRenderingIds(prev => { const next = new Set(prev); next.delete(groupId); return next; });
        setReRenderProgress(prev => { const next = { ...prev }; delete next[groupId]; return next; });
      }, 5000);
    }
  };

  const toggleSelectGroup = (groupId: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await queryClient.refetchQueries({ queryKey: ['admin-gallery-all-items'] });
      toast.success('Gallery refreshed');
    } catch (e: any) {
      toast.error('Refresh failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const filteredGroups = groupedRenders().filter(group => 
    selectedProduct === 'all' || group.product_type === selectedProduct
  );

  const getProductLabel = (type: string) => {
    switch (type) {
      case 'colorpro': return 'ColorPro™';
      case 'inkfusion': return 'InkFusion™';
      case 'wbty': return 'PatternPro™';
      case 'fadewraps': return 'FadeWraps™';
      case 'approvemode': return 'ApprovePro™';
      case 'designpanelpro': return 'DesignProAI™';
      default: return type;
    }
  };

  const totalImages = galleryItems?.length || 0;

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-8">
          <Link to="/admin">
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          
          <h1 className="text-4xl font-bold mb-2">Gallery Management</h1>
          <p className="text-muted-foreground">
            Manage ALL renders across all products - {totalImages} total images in {filteredGroups.length} groups
          </p>
        </div>

        {/* Filter + Bulk Actions */}
        <Card className="p-6 mb-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">Filter Items</h2>
              <div className="flex items-center gap-2">
                <Button
                  variant={bulkMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setBulkMode(!bulkMode);
                    setSelectedGroups(new Set());
                  }}
                >
                  <CheckSquare className="h-4 w-4 mr-2" />
                  {bulkMode ? 'Cancel Select' : 'Bulk Select'}
                </Button>
                {bulkMode && selectedGroups.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Delete ${selectedGroups.size} selected render groups? This cannot be undone.`)) {
                        const groupsToDelete = filteredGroups.filter(g => selectedGroups.has(g.id));
                        bulkDeleteMutation.mutate(groupsToDelete);
                      }
                    }}
                    disabled={bulkDeleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete {selectedGroups.size} Selected
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            </div>
            <div className="max-w-xs">
              <Select value={selectedProduct} onValueChange={(value) => setSelectedProduct(value as ProductType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  <SelectItem value="colorpro">ColorPro™</SelectItem>
                  <SelectItem value="inkfusion">InkFusion™</SelectItem>
                  <SelectItem value="wbty">PatternPro™ (WBTY)</SelectItem>
                  <SelectItem value="fadewraps">FadeWraps™</SelectItem>
                  <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
                  <SelectItem value="approvemode">ApprovePro™</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Showing {filteredGroups.length} render groups ({filteredGroups.reduce((acc, g) => acc + g.images.length, 0)} images)
              {bulkMode && ` — ${selectedGroups.size} selected`}
            </p>
          </div>
        </Card>

        {/* Gallery Groups */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-20 w-full" />
              </Card>
            ))}
          </div>
        ) : !filteredGroups.length ? (
          <Card className="p-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium mb-2">No renders found</p>
              <p className="text-sm">No items match your filter</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="overflow-hidden">
                <Collapsible
                  open={expandedGroups.has(group.id)}
                  onOpenChange={() => toggleGroup(group.id)}
                >
                  <div className="p-4 flex items-center gap-3">
                    {/* Bulk select checkbox */}
                    {bulkMode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectGroup(group.id);
                        }}
                      >
                        {selectedGroups.has(group.id) ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    )}

                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        {expandedGroups.has(group.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>

                    {/* Thumbnail */}
                    <div className="w-20 h-14 rounded overflow-hidden bg-muted shrink-0">
                      <img
                        src={group.images[0]?.media_url}
                        alt={group.title}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">
                          {group.pattern_name || group.color_name || group.title}
                        </h3>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                          {getProductLabel(group.product_type)}
                        </span>
                        {group.manufacturer && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            {group.manufacturer}
                          </span>
                        )}
                        {group.finish_type && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary/50 text-secondary-foreground border border-border">
                            {group.finish_type}
                          </span>
                        )}
                        {group.is_featured_hero && (
                          <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {group.vehicle_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        <Image className="h-3 w-3" />
                        <span>{group.images.length} images</span>
                        <span>•</span>
                        <span>{new Date(group.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="text-muted-foreground/50">{group.table_name}</span>
                      </div>
                    </div>

                    {/* MyVehiclePro */}
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <MyVehicleProInline
                        colorName={group.color_name || group.pattern_name || group.title}
                        finishType={group.finish_type}
                        manufacturer={group.manufacturer}
                        modeType={group.product_type}
                        compact
                      />
                    </div>

                    {/* Star — only for color_visualizations (has the DB column) */}
                    {group.table_name === 'color_visualizations' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-9 w-9"
                        onClick={(e) => {
                          e.stopPropagation();
                          starMutation.mutate({ groupId: group.id, starred: !group.is_featured_hero });
                        }}
                        disabled={starMutation.isPending}
                        title={group.is_featured_hero ? 'Unstar (remove from featured)' : 'Star (keep in gallery)'}
                      >
                        <Star className={`h-5 w-5 ${group.is_featured_hero ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
                      </Button>
                    )}

                    {/* Quote PDF showcase — independent of star. Top 3
                        most-recently-flagged designs appear on every
                        Quote PDF's "See it on real vehicles" strip. */}
                    {group.table_name === 'color_visualizations' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-9 w-9"
                        onClick={(e) => {
                          e.stopPropagation();
                          quotePdfMutation.mutate({ groupId: group.id, on: !group.show_on_quote_pdf });
                        }}
                        disabled={quotePdfMutation.isPending}
                        title={group.show_on_quote_pdf ? 'Remove from Quote PDF strip' : 'Show on Quote PDF strip'}
                      >
                        <FileText className={`h-5 w-5 ${group.show_on_quote_pdf ? 'text-cyan-400' : 'text-muted-foreground'}`} />
                      </Button>
                    )}

                    {/* Re-render via DesignProAI */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-9 gap-1.5 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (reRenderingIds.has(group.id)) return;
                        if (confirm(`Re-render "${group.pattern_name || group.color_name || group.title}" with DesignProAI studio? This creates a NEW render (original stays).`)) {
                          reRenderDesignProAI(group);
                        }
                      }}
                      disabled={reRenderingIds.has(group.id)}
                      title="Re-render all 7 views with DesignProAI lighting"
                    >
                      {reRenderingIds.has(group.id) ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> <span className="text-[10px] max-w-[120px] truncate">{reRenderProgress[group.id]}</span></>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> <span className="text-[10px]">DesignProAI</span></>
                      )}
                    </Button>

                    {/* Red X Delete — always visible */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-9 w-9 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${group.pattern_name || group.color_name || group.title}"?`)) {
                          deleteGroupMutation.mutate(group);
                        }
                      }}
                      disabled={deleteGroupMutation.isPending}
                      title="Delete render group"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </div>

                  <CollapsibleContent>
                    <div className="border-t border-border p-4 bg-muted/30">
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {group.images.map((image) => (
                          <div key={image.id} className="relative group/img">
                            <div className="aspect-video rounded overflow-hidden bg-muted">
                              <img
                                src={image.media_url}
                                alt={image.subtitle}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                              <Button
                                variant="destructive"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setItemToDelete(image)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-xs text-center text-muted-foreground mt-1 truncate">
                              {image.subtitle}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image "{itemToDelete?.subtitle}"? 
              This will delete the entire render record from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
