import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  Megaphone,
  ShoppingBag,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type BusinessKey = "all" | "weprintwraps" | "designproai" | "wraptvworld" | "inkandedge" | "quotecommerce" | "creatormarket";

type LiveWorkItem = {
  id: string;
  source: "task" | "social" | "email" | "marketplace";
  brand: BusinessKey;
  title: string;
  detail: string;
  owner: string;
  status: string;
  createdAt?: string | null;
  route: string;
};

const BUSINESSES: Record<Exclude<BusinessKey, "all">, { label: string; model: string; route: string }> = {
  weprintwraps: { label: "WePrintWraps", model: "Operating ecommerce", route: "/wpw/engine-room" },
  designproai: { label: "DesignProAI", model: "SaaS + production commerce", route: "/admin/marketing-hub" },
  wraptvworld: { label: "WrapTVWorld", model: "Media + sponsor business", route: "/admin/marketing-hub" },
  inkandedge: { label: "Ink & Edge", model: "Publishing + audience", route: "/admin/marketing-hub" },
  quotecommerce: { label: "QuoteCommerce", model: "B2B SaaS", route: "/admin/marketing-hub" },
  creatormarket: { label: "CreatorMarket", model: "Independent ecommerce marketplace", route: "/admin/creatormarket-manager" },
};

const normalizeBrand = (value?: string | null): BusinessKey => {
  const v = (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (v.includes("creator")) return "creatormarket";
  if (v.includes("designpro")) return "designproai";
  if (v.includes("wraptv")) return "wraptvworld";
  if (v.includes("ink") && v.includes("edge")) return "inkandedge";
  if (v.includes("quotecommerce") || v.includes("getquote")) return "quotecommerce";
  return "weprintwraps";
};

const age = (iso?: string | null) => {
  if (!iso) return "";
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export default function PlatformDirectorHome() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [business, setBusiness] = useState<BusinessKey>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-director-live"],
    queryFn: async () => {
      const [tasks, social, email, marketplace] = await Promise.all([
        (supabase as any)
          .from("slack_agent_tasks")
          .select("id,title,description,status,priority,assigned_to,category,created_by,created_at,metadata")
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("agent_social_posts")
          .select("id,brand,platform,post_type,caption,status,created_by,created_at")
          .in("status", ["draft", "needs_review", "approved", "scheduled"])
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("agent_email_campaigns")
          .select("id,campaign_name,campaign_type,subject_line,status,created_by,created_at")
          .in("status", ["draft", "needs_review", "approved"])
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("marketplace_listings")
          .select("id,title,status,is_hidden,listed_at,created_at,price")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const failures = [tasks, social, email, marketplace].filter((r: any) => r.error);
      if (failures.length === 4) throw failures[0].error;

      const work: LiveWorkItem[] = [];
      for (const row of tasks.data || []) {
        const metadata = row.metadata || {};
        const brand = normalizeBrand(metadata.brand || row.category || row.title);
        work.push({
          id: row.id,
          source: "task",
          brand,
          title: row.title || "Untitled task",
          detail: row.description || "No execution brief supplied.",
          owner: row.assigned_to || "Unassigned",
          status: row.status || "pending",
          createdAt: row.created_at,
          route: "/admin/workforce",
        });
      }
      for (const row of social.data || []) {
        const brand = normalizeBrand(row.brand);
        work.push({
          id: row.id,
          source: "social",
          brand,
          title: `${row.platform || "Social"}: ${row.post_type || "content"}`,
          detail: row.caption || "Draft has no caption yet.",
          owner: row.created_by || "Content Agent",
          status: row.status || "draft",
          createdAt: row.created_at,
          route: "/admin/marketing-hub?tab=content",
        });
      }
      for (const row of email.data || []) {
        work.push({
          id: row.id,
          source: "email",
          brand: normalizeBrand(row.campaign_name || row.subject_line),
          title: row.campaign_name || row.subject_line || "Email campaign",
          detail: row.subject_line || row.campaign_type || "Email draft",
          owner: row.created_by || "Marketing Agent",
          status: row.status || "draft",
          createdAt: row.created_at,
          route: "/admin/marketing-hub?tab=campaigns",
        });
      }
      for (const row of marketplace.data || []) {
        work.push({
          id: row.id,
          source: "marketplace",
          brand: "creatormarket",
          title: row.title || "Untitled CreatorMarket listing",
          detail: row.is_hidden ? "Hidden listing" : `Commerce listing${row.price ? ` · $${Number(row.price).toLocaleString()}` : ""}`,
          owner: "CreatorMarket Commerce",
          status: row.status || (row.is_hidden ? "hidden" : "active"),
          createdAt: row.created_at || row.listed_at,
          route: "/admin/creatormarket-manager",
        });
      }

      return {
        work,
        marketplaceCount: (marketplace.data || []).length,
        marketplaceReview: (marketplace.data || []).filter((r: any) => r.status === "pending_review" || r.is_hidden).length,
      };
    },
    refetchInterval: 30_000,
  });

  const markTaskActive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("slack_agent_tasks").update({ status: "in_progress" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task started. The live Director will continue tracking it.");
      qc.invalidateQueries({ queryKey: ["platform-director-live"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(
    () => (data?.work || []).filter((item) => business === "all" || item.brand === business),
    [data?.work, business],
  );
  const needsAction = filtered.filter((item) => ["pending", "needs_review", "blocked", "draft", "pending_review"].includes(item.status));
  const active = filtered.filter((item) => ["in_progress", "approved", "scheduled", "active", "published"].includes(item.status));
  const unassigned = filtered.filter((item) => item.owner === "Unassigned");

  return (
    <section className="space-y-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">Live company orchestration</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 md:text-3xl">Platform Director</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            This view reads the real task, campaign, content, and CreatorMarket queues. CreatorMarket is treated as its own ecommerce business—not as a DesignProAI feature or a generic content brand.
          </p>
        </div>
        <Button onClick={() => navigate("/admin/marketing-hub")} className="gap-2 bg-gray-950 text-white hover:bg-gray-800">
          Open Marketing Hub <ArrowRight className="h-4 w-4" />
        </Button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Business filter">
        <button onClick={() => setBusiness("all")} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${business === "all" ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200"}`}>All businesses</button>
        {(Object.keys(BUSINESSES) as Exclude<BusinessKey, "all">[]).map((key) => (
          <button key={key} onClick={() => setBusiness(key)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${business === key ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200"}`}>
            {BUSINESSES[key].label}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-6 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading live operating data…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">The Director could not load live queues: {(error as Error).message}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<AlertTriangle className="h-5 w-5" />} value={needsAction.length} label="Needs action" />
            <Stat icon={<CheckCircle2 className="h-5 w-5" />} value={active.length} label="Moving" />
            <Stat icon={<Users className="h-5 w-5" />} value={unassigned.length} label="Unassigned" />
            <Stat icon={<ShoppingBag className="h-5 w-5" />} value={business === "creatormarket" ? data?.marketplaceReview || 0 : data?.marketplaceCount || 0} label={business === "creatormarket" ? "Listings needing commerce review" : "CreatorMarket inventory"} />
          </div>

          {business !== "all" && (
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-bold text-gray-950">{BUSINESSES[business].label}</div>
                <div className="text-sm text-gray-600">{BUSINESSES[business].model}</div>
              </div>
              <Button variant="outline" onClick={() => navigate(BUSINESSES[business].route)}>Open operating surface</Button>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center gap-2"><Megaphone className="h-5 w-5" /><h2 className="text-lg font-bold">Live work queue</h2></div>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500">No live work records exist for this business. That is a data or orchestration gap—not a completed workflow.</div>
            ) : (
              <div className="divide-y overflow-hidden rounded-xl border border-gray-200">
                {filtered.slice(0, 40).map((item) => (
                  <article key={`${item.source}-${item.id}`} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                        <span>{BUSINESSES[item.brand as Exclude<BusinessKey, "all">]?.label || item.brand}</span>
                        <span>·</span><span>{item.source}</span><span>·</span><span>{item.status.replaceAll("_", " ")}</span>
                        {item.createdAt && <><span>·</span><span>{age(item.createdAt)}</span></>}
                      </div>
                      <h3 className="mt-1 font-bold text-gray-950">{item.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-gray-600">{item.detail}</p>
                      <p className="mt-2 text-xs font-semibold text-gray-500">Owner: {item.owner}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.source === "task" && item.status === "pending" && <Button size="sm" onClick={() => markTaskActive.mutate(item.id)}>Start</Button>}
                      <Button size="sm" variant="outline" onClick={() => navigate(item.route)}>Open</Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={() => navigate("/admin/marketing-hub?tab=content")} className="rounded-xl border border-gray-200 p-4 text-left hover:border-gray-400">
              <Megaphone className="h-5 w-5" /><div className="mt-3 font-bold">Marketing Hub content workflow</div><p className="mt-1 text-sm text-gray-600">Create, review, approve, schedule, and publish brand content from the existing hub and library.</p>
            </button>
            <button onClick={() => navigate("/admin/creatormarket-manager")} className="rounded-xl border border-gray-200 p-4 text-left hover:border-gray-400">
              <CircleDollarSign className="h-5 w-5" /><div className="mt-3 font-bold">CreatorMarket commerce operations</div><p className="mt-1 text-sm text-gray-600">Manage inventory, pricing, merchandising, listing readiness, and sales separately from marketing content.</p>
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <div className="rounded-xl border border-gray-200 bg-gray-50 p-4"><div className="flex items-center gap-2 text-2xl font-bold text-gray-950">{icon}{value}</div><div className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</div></div>;
}
