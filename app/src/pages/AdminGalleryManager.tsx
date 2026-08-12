import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Trash2, Edit, Grid3x3, List, Upload, ImagePlus, Star, StarOff, ArrowUpToLine } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ProductType = 'all' | 'inkfusion' | 'wbty' | 'approvemode' | 'fadewraps' | 'designpanelpro';

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
  is_active: boolean;
}

interface HeroRender {
  id: string;
  render_urls: Record<string, string> | null;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  mode_type: string;
  is_featured_hero: boolean;
  created_at: string;
}

export default function AdminGalleryManager() {
  const queryClient = useQueryClient();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<ProductType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    subtitle: '',
    vehicle_name: '',
    color_name: '',
    pattern_name: '',
    category: '',
    is_active: true
  });

  // Upload form state
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState({
    product_type: 'inkfusion' as Exclude<ProductType, 'all'>,
    vehicle_name: '',
    color_name: '',
    pattern_name: '',
    title: '',
    subtitle: '',
    is_active: true
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadRender = async () => {
    if (!uploadFile) {
      toast.error('Please select an image');
      return;
    }

    setIsUploading(true);
    try {
      // Upload to storage
      const fileName = `${Date.now()}-${uploadFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('renders')
        .upload(`gallery/${fileName}`, uploadFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('renders')
        .getPublicUrl(`gallery/${fileName}`);

      // Insert into appropriate carousel table
      const tableName = getTableName(uploadForm.product_type);
      const insertData: any = {
        name: uploadForm.title || uploadForm.vehicle_name || 'Uploaded Render',
        media_url: publicUrl,
        vehicle_name: uploadForm.vehicle_name || null,
        title: uploadForm.title || null,
        subtitle: uploadForm.subtitle || null,
        is_active: uploadForm.is_active
      };

      // Add product-specific fields
      if (uploadForm.product_type === 'inkfusion' || uploadForm.product_type === 'approvemode') {
        insertData.color_name = uploadForm.color_name || null;
      }
      if (uploadForm.product_type === 'wbty' || uploadForm.product_type === 'fadewraps' || uploadForm.product_type === 'designpanelpro') {
        insertData.pattern_name = uploadForm.pattern_name || null;
      }

      const { error: insertError } = await supabase
        .from(tableName as any)
        .insert(insertData);

      if (insertError) throw insertError;

      toast.success('Render uploaded successfully!');
      
      // Reset form
      setUploadFile(null);
      setUploadPreview(null);
      setUploadForm({
        product_type: 'inkfusion',
        vehicle_name: '',
        color_name: '',
        pattern_name: '',
        title: '',
        subtitle: '',
        is_active: true
      });
      setShowUploadForm(false);
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-items'] });
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Fetch hero renders from color_visualizations (source for landing page)
  const { data: heroRenders, isLoading: heroLoading } = useQuery({
    queryKey: ['admin-hero-renders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('color_visualizations')
        .select('id, render_urls, vehicle_year, vehicle_make, vehicle_model, color_name, mode_type, is_featured_hero, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as HeroRender[];
    }
  });

  // Fetch all gallery items
  const { data: galleryItems, isLoading } = useQuery({
    queryKey: ['admin-gallery-items'],
    queryFn: async () => {
      const allItems: GalleryItem[] = [];

      // Fetch from all tables
      const tables = [
        { name: 'inkfusion_carousel', type: 'inkfusion' },
        { name: 'wbty_carousel', type: 'wbty' },
        { name: 'approvemode_carousel', type: 'approvemode' },
        { name: 'fadewraps_carousel', type: 'fadewraps' },
        { name: 'designpanelpro_carousel', type: 'designpanelpro' }
      ];

      for (const table of tables) {
        const { data } = await supabase
          .from(table.name as any)
          .select('*')
          .order('created_at', { ascending: false });

        if (data) {
          allItems.push(...data.map((item: any) => ({
            id: item.id,
            media_url: item.media_url || '',
            before_url: item.before_url || undefined,
            title: item.title || item.color_name || item.pattern_name || 'Untitled',
            subtitle: item.subtitle || '',
            vehicle_name: item.vehicle_name || '',
            color_name: item.color_name || '',
            pattern_name: item.pattern_name || '',
            category: item.category || '',
            product_type: table.type,
            created_at: item.created_at || '',
            is_active: item.is_active ?? true
          })));
        }
      }

      return allItems;
    }
  });

  // Delete hero render
  const handleDeleteHeroRender = async (id: string) => {
    if (!confirm('Delete this render from the landing page?')) return;
    
    try {
      const { error } = await supabase
        .from('color_visualizations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Render deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-hero-renders'] });
      queryClient.invalidateQueries({ queryKey: ['dynamic-hero-renders'] });
    } catch (error: any) {
      toast.error(`Delete failed: ${error.message}`);
    }
  };

  // Toggle featured hero status
  const handleToggleFeatured = async (id: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('color_visualizations')
        .update({ is_featured_hero: !currentValue })
        .eq('id', id);

      if (error) throw error;
      toast.success(currentValue ? 'Removed from featured' : 'Added to featured');
      queryClient.invalidateQueries({ queryKey: ['admin-hero-renders'] });
      queryClient.invalidateQueries({ queryKey: ['dynamic-hero-renders'] });
    } catch (error: any) {
      toast.error(`Update failed: ${error.message}`);
    }
  };

  // Promote gallery item to landing page hero
  const handlePromoteToHero = async (item: GalleryItem) => {
    try {
      // Parse vehicle name into parts (e.g., "2024 Porsche 911" -> year, make, model)
      const vehicleParts = item.vehicle_name?.split(' ') || [];
      const vehicleYear = parseInt(vehicleParts[0]) || new Date().getFullYear();
      const vehicleMake = vehicleParts[1] || 'Custom';
      const vehicleModel = vehicleParts.slice(2).join(' ') || 'Vehicle';

      // Create entry in color_visualizations
      const { error } = await supabase
        .from('color_visualizations')
        .insert({
          render_urls: { hero: item.media_url },
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          color_name: item.color_name || item.pattern_name || item.title || 'Custom Design',
          color_hex: '#000000',
          finish_type: 'Gloss',
          mode_type: item.product_type,
          is_featured_hero: true,
          customer_email: 'admin@restylepro.com',
          generation_status: 'completed'
        });

      if (error) throw error;
      
      toast.success('Added to Landing Page Hero!');
      queryClient.invalidateQueries({ queryKey: ['admin-hero-renders'] });
      queryClient.invalidateQueries({ queryKey: ['dynamic-hero-renders'] });
    } catch (error: any) {
      toast.error(`Promote failed: ${error.message}`);
    }
  };

  // Get primary image from render_urls
  // DesignProAI: prefer side (original branded render with logos/text)
  const getHeroImage = (render: HeroRender): string => {
    if (!render.render_urls) return '';
    const isDesignPro = (render as any).mode_type === 'designpanelpro' || (render as any).mode_type === 'designpro';
    const views = isDesignPro
      ? ['side', 'roof', 'hood_detail', 'front', 'rear', 'top']
      : ['hood_detail', 'front', 'roof', 'side', 'rear', 'top'];
    for (const view of views) {
      if (render.render_urls[view]) return render.render_urls[view];
    }
    return Object.values(render.render_urls)[0] || '';
  };

  // Filter items
  const filteredItems = galleryItems?.filter(item => {
    const productMatch = selectedProduct === 'all' || item.product_type === selectedProduct;
    const searchMatch = searchQuery === '' || 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.vehicle_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.color_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.pattern_name?.toLowerCase().includes(searchQuery.toLowerCase());
    return productMatch && searchMatch;
  });

  const handleSelectAll = () => {
    if (selectedItems.size === filteredItems?.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems?.map(item => item.id) || []));
    }
  };

  const handleSelectItem = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }

    if (!confirm(`Delete ${selectedItems.size} selected items?`)) {
      return;
    }

    try {
      const itemsToDelete = galleryItems?.filter(item => selectedItems.has(item.id));
      
      for (const item of itemsToDelete || []) {
        const tableName = getTableName(item.product_type);
        await supabase.from(tableName as any).delete().eq('id', item.id);
      }

      toast.success(`Deleted ${selectedItems.size} items`);
      setSelectedItems(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-items'] });
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error('Failed to delete items');
    }
  };

  const handleBulkToggleActive = async (active: boolean) => {
    if (selectedItems.size === 0) {
      toast.error('No items selected');
      return;
    }

    try {
      const itemsToUpdate = galleryItems?.filter(item => selectedItems.has(item.id));
      
      for (const item of itemsToUpdate || []) {
        const tableName = getTableName(item.product_type);
        await supabase.from(tableName as any).update({ is_active: active }).eq('id', item.id);
      }

      toast.success(`Updated ${selectedItems.size} items`);
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-items'] });
    } catch (error) {
      console.error('Bulk update error:', error);
      toast.error('Failed to update items');
    }
  };

  const getTableName = (productType: string): string => {
    const tableMap: Record<string, string> = {
      'inkfusion': 'inkfusion_carousel',
      'wbty': 'wbty_carousel',
      'approvemode': 'approvemode_carousel',
      'fadewraps': 'fadewraps_carousel',
      'designpanelpro': 'designpanelpro_carousel'
    };
    return tableMap[productType] || 'vehicle_renders';
  };

  const handleEditItem = (item: GalleryItem) => {
    setEditingItem(item);
    setEditForm({
      title: item.title,
      subtitle: item.subtitle,
      vehicle_name: item.vehicle_name || '',
      color_name: item.color_name || '',
      pattern_name: item.pattern_name || '',
      category: item.category || '',
      is_active: item.is_active
    });
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;

    try {
      const tableName = getTableName(editingItem.product_type);
      const updates: any = {
        title: editForm.title || null,
        subtitle: editForm.subtitle || null,
        is_active: editForm.is_active
      };

      // Add optional fields based on product type
      if (editForm.vehicle_name) updates.vehicle_name = editForm.vehicle_name;
      if (editForm.color_name) updates.color_name = editForm.color_name;
      if (editForm.pattern_name) updates.pattern_name = editForm.pattern_name;
      if (editForm.category) updates.category = editForm.category;

      const { error } = await supabase
        .from(tableName as any)
        .update(updates)
        .eq('id', editingItem.id);

      if (error) throw error;

      toast.success('Item updated successfully');
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: ['admin-gallery-items'] });
    } catch (error) {
      console.error('Update error:', error);
      toast.error('Failed to update item');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="font-sans text-3xl font-bold mb-2">Gallery Manager</h1>
            <p className="font-sans text-muted-foreground">Manage all gallery images with batch operations</p>
          </div>
          <Button onClick={() => setShowUploadForm(true)} className="gap-2">
            <Upload className="w-4 h-4" />
            Upload Render
          </Button>
        </div>

        <Tabs defaultValue="hero" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="hero" className="font-sans">Landing Page Hero</TabsTrigger>
            <TabsTrigger value="carousels" className="font-sans">Product Carousels</TabsTrigger>
          </TabsList>

          {/* Landing Page Hero Tab */}
          <TabsContent value="hero" className="space-y-6">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-sans text-xl font-semibold">Landing Page Hero Renders</h2>
                  <p className="font-sans text-sm text-muted-foreground">
                    These renders appear in the hero slider on the landing page. Toggle star to feature specific renders.
                  </p>
                </div>
                <Badge variant="outline" className="font-sans">
                  {heroRenders?.filter(r => r.is_featured_hero).length || 0} featured
                </Badge>
              </div>

              {heroLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : !heroRenders?.length ? (
                <p className="font-sans text-muted-foreground text-center py-8">No renders found</p>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {heroRenders.map((render) => {
                    const imageUrl = getHeroImage(render);
                    const vehicleName = [render.vehicle_year, render.vehicle_make, render.vehicle_model].filter(Boolean).join(' ');
                    
                    return (
                      <div 
                        key={render.id} 
                        className={`flex items-center gap-4 p-3 rounded-lg border ${render.is_featured_hero ? 'bg-primary/5 border-primary/30' : 'bg-card'}`}
                      >
                        {imageUrl && (
                          <img src={imageUrl} alt={vehicleName} className="w-24 h-14 object-cover rounded" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-sans font-medium truncate">{render.color_name || 'Custom Design'}</p>
                          <p className="font-sans text-sm text-muted-foreground truncate">{vehicleName}</p>
                          <Badge variant="outline" className="font-sans text-xs mt-1">{render.mode_type || 'colorpro'}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant={render.is_featured_hero ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => handleToggleFeatured(render.id, render.is_featured_hero || false)}
                            title={render.is_featured_hero ? 'Remove from featured' : 'Add to featured'}
                          >
                            {render.is_featured_hero ? <Star className="h-4 w-4 fill-current" /> : <StarOff className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteHeroRender(render.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Product Carousels Tab */}
          <TabsContent value="carousels" className="space-y-6">

        {/* Controls */}
        <Card className="p-6 mb-6">
          <div className="space-y-4">
            {/* Search and Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search images..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={selectedProduct} onValueChange={(value) => setSelectedProduct(value as ProductType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  <SelectItem value="inkfusion">ColorPro™</SelectItem>
                  <SelectItem value="wbty">PatternPro™</SelectItem>
                  <SelectItem value="fadewraps">FadeWraps™</SelectItem>
                  <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
                  <SelectItem value="approvemode">ApprovePro™</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button
                  variant={viewMode === 'table' ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => setViewMode('table')}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => setViewMode('grid')}
                >
                  <Grid3x3 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Batch Actions */}
            {selectedItems.size > 0 && (
              <div className="flex items-center gap-4 p-4 bg-primary/10 rounded-lg">
                <Badge variant="secondary">{selectedItems.size} selected</Badge>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleBulkToggleActive(true)}>
                    Activate
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleBulkToggleActive(false)}>
                    Deactivate
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !filteredItems?.length ? (
          <Card className="p-12">
            <div className="text-center text-muted-foreground">
              <p>No items found</p>
            </div>
          </Card>
        ) : viewMode === 'table' ? (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-4">
                      <Checkbox
                        checked={selectedItems.size === filteredItems.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </th>
                    <th className="p-4">Image</th>
                    <th className="p-4">Title</th>
                    <th className="p-4">Product</th>
                    <th className="p-4">Vehicle</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-muted/50">
                      <td className="p-4">
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => handleSelectItem(item.id)}
                        />
                      </td>
                      <td className="p-4">
                        <img
                          src={item.media_url}
                          alt={item.title}
                          className="w-20 h-12 object-cover rounded"
                        />
                      </td>
                      <td className="p-4 max-w-xs truncate">{item.title}</td>
                      <td className="p-4">
                        <Badge variant="outline">{item.product_type}</Badge>
                      </td>
                      <td className="p-4">{item.vehicle_name || '-'}</td>
                      <td className="p-4">
                        <Badge variant={item.is_active ? 'default' : 'secondary'}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePromoteToHero(item)}
                            title="Promote to Landing Page Hero"
                          >
                            <ArrowUpToLine className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditItem(item)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredItems.map((item) => (
              <Card key={item.id} className="overflow-hidden">
                <div className="relative">
                  <Checkbox
                    checked={selectedItems.has(item.id)}
                    onCheckedChange={() => handleSelectItem(item.id)}
                    className="absolute top-2 left-2 z-10 bg-background"
                  />
                  <img
                    src={item.media_url}
                    alt={item.title}
                    className="w-full aspect-video object-cover"
                  />
                </div>
                <div className="p-4">
                  <p className="font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">{item.product_type}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePromoteToHero(item)}
                      title="Promote to Hero"
                    >
                      <ArrowUpToLine className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditItem(item)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit Modal */}
      <Dialog open={!!editingItem} onOpenChange={() => setEditingItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Item Metadata</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Subtitle</Label>
                <Input
                  value={editForm.subtitle}
                  onChange={(e) => setEditForm({ ...editForm, subtitle: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vehicle Name</Label>
                <Input
                  value={editForm.vehicle_name}
                  onChange={(e) => setEditForm({ ...editForm, vehicle_name: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Color Name</Label>
                <Input
                  value={editForm.color_name}
                  onChange={(e) => setEditForm({ ...editForm, color_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pattern Name</Label>
                <Input
                  value={editForm.pattern_name}
                  onChange={(e) => setEditForm({ ...editForm, pattern_name: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Category</Label>
                <Input
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={editForm.is_active}
                onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: !!checked })}
              />
              <Label>Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Modal */}
      <Dialog open={showUploadForm} onOpenChange={setShowUploadForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus className="w-5 h-5" />
              Upload New Render
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Image Upload */}
            <div className="space-y-2">
              <Label>Render Image</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              {uploadPreview ? (
                <div className="relative">
                  <img 
                    src={uploadPreview} 
                    alt="Preview" 
                    className="w-full h-48 object-cover rounded-lg border"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      setUploadPreview(null);
                      setUploadFile(null);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div 
                  className="w-full h-48 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Click to select image</p>
                </div>
              )}
            </div>

            {/* Product Type */}
            <div className="space-y-2">
              <Label>Product Type</Label>
              <Select 
                value={uploadForm.product_type} 
                onValueChange={(value) => setUploadForm({ ...uploadForm, product_type: value as Exclude<ProductType, 'all'> })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inkfusion">ColorPro™</SelectItem>
                  <SelectItem value="wbty">PatternPro™</SelectItem>
                  <SelectItem value="fadewraps">FadeWraps™</SelectItem>
                  <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
                  <SelectItem value="approvemode">ApprovePro™</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Metadata Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vehicle Name</Label>
                <Input
                  placeholder="e.g. 2024 Porsche 911"
                  value={uploadForm.vehicle_name}
                  onChange={(e) => setUploadForm({ ...uploadForm, vehicle_name: e.target.value })}
                />
              </div>
              
              {(uploadForm.product_type === 'inkfusion' || uploadForm.product_type === 'approvemode') && (
                <div className="space-y-2">
                  <Label>Color Name</Label>
                  <Input
                    placeholder="e.g. Nardo Gray"
                    value={uploadForm.color_name}
                    onChange={(e) => setUploadForm({ ...uploadForm, color_name: e.target.value })}
                  />
                </div>
              )}
              
              {(uploadForm.product_type === 'wbty' || uploadForm.product_type === 'fadewraps' || uploadForm.product_type === 'designpanelpro') && (
                <div className="space-y-2">
                  <Label>Pattern Name</Label>
                  <Input
                    placeholder="e.g. Carbon Fiber"
                    value={uploadForm.pattern_name}
                    onChange={(e) => setUploadForm({ ...uploadForm, pattern_name: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title (Optional)</Label>
                <Input
                  placeholder="Display title"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Subtitle (Optional)</Label>
                <Input
                  placeholder="Display subtitle"
                  value={uploadForm.subtitle}
                  onChange={(e) => setUploadForm({ ...uploadForm, subtitle: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={uploadForm.is_active}
                onCheckedChange={(checked) => setUploadForm({ ...uploadForm, is_active: !!checked })}
              />
              <Label>Active (visible in gallery)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadRender} disabled={isUploading || !uploadFile}>
              {isUploading ? 'Uploading...' : 'Upload Render'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
