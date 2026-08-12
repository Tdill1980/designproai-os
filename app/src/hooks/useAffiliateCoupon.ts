import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "restylepro_affiliate_coupon";

export interface AffiliateCoupon {
  id: string;
  code: string;
  affiliate_name: string;
  discount_percent: number;
  commission_percent: number;
}

interface UseAffiliateCouponReturn {
  coupon: AffiliateCoupon | null;
  loading: boolean;
  error: string | null;
  validateCoupon: (code: string) => Promise<boolean>;
  clearCoupon: () => void;
}

export const useAffiliateCoupon = (): UseAffiliateCouponReturn => {
  const [coupon, setCoupon] = useState<AffiliateCoupon | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (coupon) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(coupon));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [coupon]);

  const validateCoupon = useCallback(async (code: string): Promise<boolean> => {
    if (!code.trim()) {
      setError("Please enter a coupon code");
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from("affiliate_coupons" as any)
        .select("id, code, affiliate_name, discount_percent, commission_percent, active, max_uses, current_uses, expires_at")
        .eq("code", code.trim().toUpperCase())
        .eq("active", true)
        .maybeSingle();

      if (dbError) {
        console.error("Coupon validation error:", dbError);
        setError("Unable to validate coupon. Please try again.");
        return false;
      }

      if (!data) {
        setError("Invalid or expired coupon code");
        return false;
      }

      const couponData = data as any;

      // Check expiration
      if (couponData.expires_at && new Date(couponData.expires_at) < new Date()) {
        setError("This coupon has expired");
        return false;
      }

      // Check usage limits
      if (couponData.max_uses && couponData.current_uses >= couponData.max_uses) {
        setError("This coupon has reached its usage limit");
        return false;
      }

      setCoupon({
        id: couponData.id,
        code: couponData.code,
        affiliate_name: couponData.affiliate_name,
        discount_percent: couponData.discount_percent || 25,
        commission_percent: couponData.commission_percent || 25,
      });

      return true;
    } catch (err) {
      console.error("Coupon validation error:", err);
      setError("Unable to validate coupon. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearCoupon = useCallback(() => {
    setCoupon(null);
    setError(null);
  }, []);

  return { coupon, loading, error, validateCoupon, clearCoupon };
};
