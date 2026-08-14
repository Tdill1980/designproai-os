/**
 * useShopProducts — CRUD for per-shop custom product catalog.
 *
 * Products are linked to the shop via shop_profiles.
 * WPW products include WooCommerce product IDs for order fulfillment.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export interface ShopProduct {
  id: string;
  shop_id: string | null;
  user_id: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  woo_product_id: number | null;
  woo_product_url: string | null;
  price: number;
  cost: number;
  price_unit: "each" | "sqft" | "yard" | "linear_foot" | "roll";
  category: string | null;
  logo_url: string | null;
  is_active: boolean;
  is_quotable: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ShopProductInsert = Omit<ShopProduct, "id" | "created_at" | "updated_at" | "shop_id" | "user_id">;

async function getShopAndUser(): Promise<{ shopId: string | null; userId: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { shopId: null, userId: null };
  const { data } = await db
    .from("shop_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return { shopId: data?.id || null, userId: user.id };
}

export function useShopProducts(category?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["shop-products", category],
    queryFn: async (): Promise<ShopProduct[]> => {
      const { shopId } = await getShopAndUser();
      if (!shopId) return [];

      let q = db
        .from("shop_products")
        .select("*")
        .eq("shop_id", shopId)
        .order("sort_order", { ascending: true });

      if (category) q = q.eq("category", category);

      const { data, error } = await q;
      if (error) {
        console.warn("[useShopProducts] fetch failed", error);
        return [];
      }
      return (data || []) as ShopProduct[];
    },
  });

  const createProduct = useMutation({
    mutationFn: async (product: ShopProductInsert) => {
      const { shopId, userId } = await getShopAndUser();
      if (!shopId) throw new Error("No shop profile found");

      const { data, error } = await db
        .from("shop_products")
        .insert({
          ...product,
          shop_id: shopId,
          user_id: userId,
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-products"] });
    },
  });

  const updateProduct = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShopProduct> & { id: string }) => {
      const { error } = await db
        .from("shop_products")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-products"] });
    },
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("shop_products")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-products"] });
    },
  });

  const seedWpwProducts = useMutation({
    mutationFn: async (products: ShopProductInsert[]) => {
      const { shopId, userId } = await getShopAndUser();
      if (!shopId) throw new Error("No shop profile found");

      const rows = products.map((p) => ({
        ...p,
        shop_id: shopId,
        user_id: userId,
      }));

      const { error } = await db
        .from("shop_products")
        .insert(rows);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-products"] });
    },
  });

  const uploadLogo = async (file: File, productId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "png";
    const path = `shop-product-logos/${productId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      console.warn("[useShopProducts] logo upload failed", uploadError);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("wrap-files")
      .getPublicUrl(path);

    const publicUrl = urlData?.publicUrl || null;

    if (publicUrl) {
      await db
        .from("shop_products")
        .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", productId);
      queryClient.invalidateQueries({ queryKey: ["shop-products"] });
    }

    return publicUrl;
  };

  return {
    products: query.data ?? [],
    isLoading: query.isLoading,
    createProduct: createProduct.mutateAsync,
    updateProduct: updateProduct.mutateAsync,
    deleteProduct: deleteProduct.mutateAsync,
    seedWpwProducts: seedWpwProducts.mutateAsync,
    uploadLogo,
    isCreating: createProduct.isPending,
    isUpdating: updateProduct.isPending,
    isSeeding: seedWpwProducts.isPending,
  };
}
