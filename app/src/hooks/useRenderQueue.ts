import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RenderJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type RenderJob = {
  id: string;
  user_id: string;
  tool: string;
  status: RenderJobStatus;
  label: string | null;
  vehicle: string | null;
  view_type: string | null;
  prompt_summary: string | null;
  thumbnail_url: string | null;
  result_url: string | null;
  generation_id: string | null;
  design_name: string | null;
  error: string | null;
  window_id: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type EnqueueInput = {
  tool: string;
  label?: string;
  vehicle?: string;
  view_type?: string;
  prompt_summary?: string;
  thumbnail_url?: string;
};

const WINDOW_KEY = "restylepro_window_id";

function getWindowId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(WINDOW_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `w_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    sessionStorage.setItem(WINDOW_KEY, id);
  }
  return id;
}

export function useRenderQueue() {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUserId(data?.session?.user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setJobs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("render_queue" as never)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (!error && data) setJobs(data as unknown as RenderJob[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`render-queue-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "render_queue",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setJobs((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as RenderJob;
              if (prev.some((j) => j.id === next.id)) return prev;
              return [next, ...prev].slice(0, 200);
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as RenderJob;
              return prev.map((j) => (j.id === next.id ? next : j));
            }
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id?: string })?.id;
              return prev.filter((j) => j.id !== oldId);
            }
            return prev;
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId]);

  const enqueue = useCallback(
    async (input: EnqueueInput): Promise<string | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("render_queue" as never)
        .insert({
          user_id: userId,
          tool: input.tool,
          label: input.label ?? null,
          vehicle: input.vehicle ?? null,
          view_type: input.view_type ?? null,
          prompt_summary: input.prompt_summary?.slice(0, 280) ?? null,
          thumbnail_url: input.thumbnail_url ?? null,
          window_id: getWindowId(),
          status: "running",
          started_at: new Date().toISOString(),
          progress: 5,
        } as never)
        .select("id")
        .single();
      if (error || !data) return null;
      return (data as { id: string }).id;
    },
    [userId]
  );

  const update = useCallback(
    async (id: string, patch: Partial<RenderJob>) => {
      if (!id) return;
      await supabase
        .from("render_queue" as never)
        .update(patch as never)
        .eq("id", id);
    },
    []
  );

  const complete = useCallback(
    async (
      id: string | null,
      result: { result_url?: string; thumbnail_url?: string; design_name?: string; generation_id?: string }
    ) => {
      if (!id) return;
      await supabase
        .from("render_queue" as never)
        .update({
          status: "succeeded",
          progress: 100,
          completed_at: new Date().toISOString(),
          result_url: result.result_url ?? null,
          thumbnail_url: result.thumbnail_url ?? result.result_url ?? null,
          design_name: result.design_name ?? null,
          generation_id: result.generation_id ?? null,
        } as never)
        .eq("id", id);
    },
    []
  );

  const fail = useCallback(async (id: string | null, err: unknown) => {
    if (!id) return;
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Render failed";
    await supabase
      .from("render_queue" as never)
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: message.slice(0, 500),
      } as never)
      .eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    await supabase.from("render_queue" as never).delete().eq("id", id);
  }, []);

  const clearCompleted = useCallback(async () => {
    if (!userId) return;
    await supabase
      .from("render_queue" as never)
      .delete()
      .eq("user_id", userId)
      .in("status", ["succeeded", "failed", "cancelled"]);
  }, [userId]);

  const counts = useMemo(() => {
    const active = jobs.filter((j) => j.status === "running" || j.status === "pending").length;
    const ready = jobs.filter((j) => j.status === "succeeded").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    return { active, ready, failed, total: jobs.length };
  }, [jobs]);

  return {
    userId,
    jobs,
    loading,
    counts,
    enqueue,
    update,
    complete,
    fail,
    remove,
    clearCompleted,
  };
}

export type UseRenderQueueReturn = ReturnType<typeof useRenderQueue>;
