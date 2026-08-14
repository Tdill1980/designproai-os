import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliateContent, ContentStatus } from "@/types/affiliate";

export function useAffiliateContent(filters?: { status?: string; partnerId?: string }) {
  return useQuery({
    queryKey: ["affiliate-content", filters],
    queryFn: async () => {
      let query = (supabase.from("affiliate_content" as any) as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }
      if (filters?.partnerId) {
        query = query.eq("partner_id", filters.partnerId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AffiliateContent[];
    },
  });
}

export function usePartnerAdCount() {
  return useQuery({
    queryKey: ["affiliate-partner-ad-count"],
    queryFn: async () => {
      const { count } = await (supabase.from("affiliate_content" as any) as any)
        .select("*", { count: "exact", head: true })
        .eq("is_partner_ad", true);
      return count || 0;
    },
  });
}

export function useUploadAffiliateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      partnerId,
      file,
      contentType,
      title,
      description,
    }: {
      partnerId: string;
      file: File;
      contentType: "reel" | "static_ad";
      title?: string;
      description?: string;
    }) => {
      const fileExt = file.name.split(".").pop();
      const filePath = `${partnerId}/${Date.now()}.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("affiliate-content")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: publicUrl } = supabase.storage
        .from("affiliate-content")
        .getPublicUrl(filePath);

      // Insert record
      const { data, error } = await (supabase.from("affiliate_content" as any) as any)
        .insert({
          partner_id: partnerId,
          content_type: contentType,
          title: title || file.name,
          description,
          file_url: publicUrl.publicUrl,
          mime_type: file.type,
          file_size_bytes: file.size,
          status: "pending_review",
        })
        .select()
        .single();

      if (error) throw error;
      return data as AffiliateContent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-content"] });
    },
  });
}

export function useUpdateContentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      rejectionReason,
    }: {
      id: string;
      status: ContentStatus;
      rejectionReason?: string;
    }) => {
      const updates: Record<string, any> = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (status === "partner_ad") {
        updates.is_partner_ad = true;
      }
      if (status === "rejected" && rejectionReason) {
        updates.rejection_reason = rejectionReason;
      }
      if (status === "approved") {
        updates.is_partner_ad = false;
        updates.rejection_reason = null;
      }

      const { error } = await (supabase.from("affiliate_content" as any) as any)
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-content"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partner-ad-count"] });
    },
  });
}

export function useDeleteAffiliateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Get file URL to delete from storage
      const { data: content } = await (supabase.from("affiliate_content" as any) as any)
        .select("file_url")
        .eq("id", id)
        .single();

      if (content) {
        const url = (content as any).file_url as string;
        const pathMatch = url.split("/affiliate-content/");
        if (pathMatch[1]) {
          await supabase.storage.from("affiliate-content").remove([pathMatch[1]]);
        }
      }

      const { error } = await (supabase.from("affiliate_content" as any) as any)
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-content"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partner-ad-count"] });
    },
  });
}
