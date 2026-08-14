/**
 * Admin Shop Products — per-shop custom product catalog.
 *
 * CRUD for products with:
 * - WooCommerce product ID wiring
 * - Logo/image upload
 * - Pricing (retail + cost + unit)
 * - Category tagging
 * - Quotable toggle (can be added to quotes)
 *
 * WPW internal sees "WPW" branding. Everyone else sees "PrintPro".
 * "Seed WPW Products" button pre-loads the full WPW catalog.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Trash2, Upload, Save, ExternalLink,
  Package, ShoppingCart, Edit2, X, Check, Loader2, Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShopProducts, type ShopProduct, type ShopProductInsert } from "@/hooks/useShopProducts";
import { WPW_SEED_PRODUCTS, WPW_PRODUCT_CATEGORIES } from "@/lib/wpw-seed-products";

const inputCls = "h-9 bg-black border-[#48484a] rounded text-sm text-white placeholder:text-white/40 focus-visible:ring-[#60A5FA]/40";
const sectionCls = "rounded-2xl border border-[#48484a] bg-rp-surface";

const PRICE_UNITS = [
  { value: "each", label: "Each" },
  { value: "sqft", label: "Per Sq Ft" },
  { value: "yard", label: "Per Yard" },
  { value: "linear_foot", label: "Per Linear Foot" },
  { value: "roll", label: "Per Roll" },
];

const ALL_CATEGORIES = [
  { id: "all", label: "All Products" },
  ...WPW_PRODUCT_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  { id: "custom", label: "Custom" },
];

const emptyProduct: ShopProductInsert = {
  name: "",
  description: null,
  sku: null,
  woo_product_id: null,
  woo_product_url: null,
  price: 0,
  cost: 0,
  price_unit: "each",
  category: null,
  logo_url: null,
  is_active: true,
  is_quotable: true,
  sort_order: 0,
  metadata: {},
};

const AdminShopProducts = () => {
  const navigate = useNavigate();
  const {
    products, isLoading, createProduct, updateProduct,
    deleteProduct, seedWpwProducts, uploadLogo,
    isCreating, isSeeding,
  } = useShopProducts();

  const [filterCategory, setFilterCategory] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ShopProductInsert>({ ...emptyProduct });
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const filteredProducts = filterCategory === "all"
    ? products
    : products.filter((p) => p.category === filterCategory);

  const handleSeedWpw = async () => {
    if (products.some((p) => p.woo_product_id && WPW_SEED_PRODUCTS.some((s) => s.woo_product_id === p.woo_product_id))) {
      toast.error("Some WPW products already exist. Remove duplicates first or add missing products individually.");
      return;
    }
    try {
      await seedWpwProducts(WPW_SEED_PRODUCTS as ShopProductInsert[]);
      toast.success(`Seeded ${WPW_SEED_PRODUCTS.length} WPW products`);
    } catch (err: any) {
      toast.error("Seed failed: " + (err.message || "Unknown"));
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    try {
      const result = await createProduct(form);
      if (logoFile && result?.id) {
        await uploadLogo(logoFile, result.id);
      }
      toast.success("Product created");
      setForm({ ...emptyProduct });
      setLogoFile(null);
      setShowCreate(false);
    } catch (err: any) {
      toast.error("Create failed: " + (err.message || "Unknown"));
    }
  };

  const startEdit = (p: ShopProduct) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description,
      sku: p.sku,
      woo_product_id: p.woo_product_id,
      woo_product_url: p.woo_product_url,
      price: p.price,
      cost: p.cost,
      price_unit: p.price_unit,
      category: p.category,
      logo_url: p.logo_url,
      is_active: p.is_active,
      is_quotable: p.is_quotable,
      sort_order: p.sort_order,
      metadata: p.metadata,
    });
    setLogoFile(null);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    try {
      await updateProduct({ id: editingId, ...form } as any);
      if (logoFile) {
        await uploadLogo(logoFile, editingId);
      }
      toast.success("Product updated");
      setEditingId(null);
      setForm({ ...emptyProduct });
      setLogoFile(null);
    } catch (err: any) {
      toast.error("Update failed: " + (err.message || "Unknown"));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteProduct(id);
      toast.success("Product deleted");
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown"));
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...emptyProduct });
    setLogoFile(null);
  };

  const updateForm = (key: keyof ShopProductInsert, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const ProductForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label className="text-[10px] text-white/60 mb-1 block">Product Name *</Label>
          <Input value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Product name" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-[10px] text-white/60 mb-1 block">Description</Label>
          <Input value={form.description || ""} onChange={(e) => updateForm("description", e.target.value)} placeholder="Description" className={inputCls} />
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">Price</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => updateForm("price", parseFloat(e.target.value) || 0)} className={inputCls} />
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">Price Unit</Label>
          <Select value={form.price_unit} onValueChange={(v) => updateForm("price_unit", v)}>
            <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-rp-elevated border-[#48484a]">
              {PRICE_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">Cost (wholesale)</Label>
          <Input type="number" step="0.01" value={form.cost} onChange={(e) => updateForm("cost", parseFloat(e.target.value) || 0)} className={inputCls} />
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">Category</Label>
          <Select value={form.category || "custom"} onValueChange={(v) => updateForm("category", v)}>
            <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-rp-elevated border-[#48484a]">
              {WPW_PRODUCT_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">SKU</Label>
          <Input value={form.sku || ""} onChange={(e) => updateForm("sku", e.target.value)} placeholder="Optional SKU" className={inputCls} />
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">WooCommerce Product ID</Label>
          <Input type="number" value={form.woo_product_id || ""} onChange={(e) => updateForm("woo_product_id", parseInt(e.target.value) || null)} placeholder="e.g. 79" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-[10px] text-white/60 mb-1 block">WooCommerce URL</Label>
          <Input value={form.woo_product_url || ""} onChange={(e) => updateForm("woo_product_url", e.target.value)} placeholder="https://weprintwraps.com/..." className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-[10px] text-white/60 mb-1 block">Product Logo / Image</Label>
          <div className="flex items-center gap-3">
            {(form.logo_url || logoFile) && (
              <img
                src={logoFile ? URL.createObjectURL(logoFile) : (form.logo_url || "")}
                alt=""
                className="w-10 h-10 object-contain rounded border border-[#48484a] bg-white/5"
              />
            )}
            <label className="cursor-pointer text-xs text-[#60A5FA] hover:underline flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" /> Upload Image
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setLogoFile(f);
              }} />
            </label>
            {logoFile && <span className="text-[10px] text-white/40">{logoFile.name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={(v) => updateForm("is_active", v)} />
            <Label className="text-xs text-white/70">Active</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_quotable} onCheckedChange={(v) => updateForm("is_quotable", v)} />
            <Label className="text-xs text-white/70">Quotable</Label>
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-white/60 mb-1 block">Sort Order</Label>
          <Input type="number" value={form.sort_order} onChange={(e) => updateForm("sort_order", parseInt(e.target.value) || 0)} className={inputCls} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-[#48484a]">
        <Button variant="outline" size="sm" onClick={cancelEdit} className="border-[#48484a] text-white/70">Cancel</Button>
        <Button size="sm" onClick={onSubmit} disabled={isCreating} className="bg-gradient-rp-pop text-white">
          {isCreating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/quotes")} className="p-2 rounded-lg hover:bg-white/10 transition">
              <ArrowLeft className="w-4 h-4 text-white/60" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Shop Products</h1>
              <p className="text-xs text-white/50">Manage your product catalog for quotes and orders</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {products.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSeedWpw}
                disabled={isSeeding}
                className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
              >
                {isSeeding ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Store className="w-3.5 h-3.5 mr-1.5" />}
                Seed WPW Products
              </Button>
            )}
            <Button size="sm" onClick={() => { setShowCreate(true); setForm({ ...emptyProduct }); }} className="bg-gradient-rp-pop text-white">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Product
            </Button>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2 mb-5">
          {ALL_CATEGORIES.map((c) => {
            const count = c.id === "all" ? products.length : products.filter((p) => p.category === c.id).length;
            return (
              <button
                key={c.id}
                onClick={() => setFilterCategory(c.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[11px] font-medium border transition",
                  filterCategory === c.id
                    ? "bg-[#60A5FA]/20 border-[#60A5FA]/40 text-[#60A5FA]"
                    : "bg-rp-elevated border-[#48484a] text-white/50 hover:text-white/70"
                )}
              >
                {c.label} {count > 0 && <span className="ml-1 text-white/30">({count})</span>}
              </button>
            );
          })}
        </div>

        {/* Create product dialog */}
        {showCreate && (
          <div className={cn(sectionCls, "mb-5")}>
            <div className="px-4 pt-4 pb-0">
              <div className="text-xs font-bold text-[#60A5FA] uppercase tracking-[0.12em] flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Product
              </div>
            </div>
            <ProductForm onSubmit={handleCreate} submitLabel="Create Product" />
          </div>
        )}

        {/* Products grid */}
        {isLoading ? (
          <div className="text-center py-20 text-white/30 text-sm">Loading products...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm mb-1">No products yet</p>
            <p className="text-white/20 text-xs">Add products manually or seed the WPW catalog</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredProducts.map((p) => (
              <div key={p.id} className={cn(sectionCls, "overflow-hidden")}>
                {editingId === p.id ? (
                  <ProductForm onSubmit={handleUpdate} submitLabel="Save Changes" />
                ) : (
                  <div className="flex items-center gap-4 p-4">
                    {/* Logo */}
                    {p.logo_url ? (
                      <img src={p.logo_url} alt="" className="w-10 h-10 object-contain rounded border border-[#48484a] bg-white/5 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded border border-[#48484a] bg-white/5 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-white/15" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white truncate">{p.name}</h3>
                        {!p.is_active && <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Inactive</span>}
                        {p.is_quotable && <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Quotable</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {p.category && (
                          <span className="text-[10px] text-white/40">{WPW_PRODUCT_CATEGORIES.find((c) => c.id === p.category)?.label || p.category}</span>
                        )}
                        {p.woo_product_id && (
                          <span className="text-[10px] text-cyan-400/60">WC #{p.woo_product_id}</span>
                        )}
                        {p.description && <span className="text-[10px] text-white/25 truncate">{p.description}</span>}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-white font-mono">
                        ${Number(p.price).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {PRICE_UNITS.find((u) => u.value === p.price_unit)?.label || p.price_unit}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {p.woo_product_url && (
                        <a href={p.woo_product_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-white/10 transition text-white/30 hover:text-white/60">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button onClick={() => startEdit(p)} className="p-1.5 rounded hover:bg-white/10 transition text-white/30 hover:text-[#60A5FA]">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(p.id, p.name)} className="p-1.5 rounded hover:bg-white/10 transition text-white/30 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminShopProducts;
