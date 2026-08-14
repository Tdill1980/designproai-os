/**
 * Proofs — Phase 7 shop owner dashboard.
 *
 * Lists every proof_approvals row owned by the logged-in shop, with status
 * filtering, search, inline resend / revoke / open / copy-link actions, and
 * a header tier-usage meter. The single surface a shop uses to manage all
 * client approval activity.
 *
 * Route: /proofs (RequireAuth)
 *
 * RLS on proof_approvals already restricts to shop_id = auth.uid(), so the
 * client-side query is naturally tenant-scoped.
 */

import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProofUsageMeter } from "@/components/proof/ProofUsageMeter";
import {
  ClipboardSignature,
  Search,
  RefreshCw,
  ExternalLink,
  Send,
  Copy,
  XCircle,
  Loader2,
  MoreHorizontal,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Filter,
  RotateCw,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ProofStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "revising"
  | "approved"
  | "declined"
  | "revoked"
  | "expired"
  | "delivery_failed"
  | "escalated_shop"
  | "escalated_support";

interface ProofRow {
  id: string;
  view_token: string;
  manage_token: string;
  customer_name: string | null;
  customer_email: string;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  design_name: string | null;
  finish_type: string | null;
  mode: string;
  status: ProofStatus;
  expires_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  ai_revisions_used: number;
  ai_revisions_allowed: number;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<
  ProofStatus,
  { label: string; color: string; icon: typeof Send }
> = {
  draft:             { label: "Draft",       color: "bg-zinc-100 text-zinc-700 border-zinc-200", icon: ClipboardSignature },
  sent:              { label: "Sent",        color: "bg-blue-100 text-blue-700 border-blue-200", icon: Send },
  viewed:            { label: "Viewed",      color: "bg-blue-100 text-blue-700 border-blue-200", icon: Eye },
  revising:          { label: "Revising",    color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw },
  approved:          { label: "Approved",    color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  declined:          { label: "Declined",    color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  revoked:           { label: "Revoked",     color: "bg-zinc-100 text-zinc-600 border-zinc-200", icon: XCircle },
  expired:           { label: "Expired",     color: "bg-zinc-100 text-zinc-600 border-zinc-200", icon: Clock },
  delivery_failed:   { label: "Email failed", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  escalated_shop:    { label: "Shop revising", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  escalated_support: { label: "Support",     color: "bg-amber-100 text-amber-700 border-amber-200", icon: LifeBuoy },
};

type StatusFilter = "all" | "active" | "approved" | "declined" | "revising" | "draft";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string; statuses?: ProofStatus[] }> = [
  { key: "all",      label: "All" },
  { key: "active",   label: "Active",   statuses: ["sent", "viewed", "revising", "delivery_failed", "escalated_shop", "escalated_support"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "declined", label: "Declined", statuses: ["declined"] },
  { key: "revising", label: "Revising", statuses: ["revising", "escalated_shop", "escalated_support"] },
  { key: "draft",    label: "Draft",    statuses: ["draft"] },
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = 60_000;
  const h = 60 * m;
  const day = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < day) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getProofPublicBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://restyleproai.com";
}

export default function Proofs() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login?redirect=/proofs");
      return;
    }
    const { data, error } = await supabase
      .from("proof_approvals" as any)
      .select(
        "id, view_token, manage_token, customer_name, customer_email, vehicle_year, vehicle_make, vehicle_model, design_name, finish_type, mode, status, expires_at, sent_at, signed_at, ai_revisions_used, ai_revisions_allowed, created_at, updated_at",
      )
      .eq("shop_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      toast({
        title: "Failed to load proofs",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
    } else {
      setRows((data || []) as unknown as ProofRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const filterCfg = STATUS_FILTERS.find((f) => f.key === filter);
    let r = rows;
    if (filterCfg?.statuses) {
      r = r.filter((row) => filterCfg.statuses!.includes(row.status));
    }
    if (search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      r = r.filter((row) =>
        [
          row.customer_name,
          row.customer_email,
          row.design_name,
          row.vehicle_year,
          row.vehicle_make,
          row.vehicle_model,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      );
    }
    return r;
  }, [rows, filter, search]);

  // Counts per filter (computed from full row set, not the filtered subset)
  const counts = useMemo(() => {
    const r = rows || [];
    const total = r.length;
    const counted: Record<StatusFilter, number> = {
      all: total,
      active: 0,
      approved: 0,
      declined: 0,
      revising: 0,
      draft: 0,
    };
    for (const row of r) {
      for (const f of STATUS_FILTERS) {
        if (!f.statuses) continue;
        if (f.statuses.includes(row.status)) counted[f.key]++;
      }
    }
    return counted;
  }, [rows]);

  const handleResend = async (row: ProofRow) => {
    setBusyRowId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("proof-send", {
        body: { proof_id: row.id },
      });
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Resend failed";
        toast({ title: "Resend failed", description: msg, variant: "destructive" });
        return;
      }
      toast({
        title: data.already_sent ? "Already sent" : "Resent",
        description: `${row.customer_email} should see the email shortly.`,
      });
      await load();
    } finally {
      setBusyRowId(null);
    }
  };

  const handleRevoke = async (row: ProofRow) => {
    if (!confirm("Revoke this proof? The customer's link will stop working immediately.")) return;
    setBusyRowId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("proof-revoke", {
        body: { proof_id: row.id },
      });
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Revoke failed";
        toast({ title: "Revoke failed", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "Revoked", description: "The customer's link is no longer active." });
      await load();
    } finally {
      setBusyRowId(null);
    }
  };

  const handleCopyLink = async (row: ProofRow) => {
    try {
      await navigator.clipboard.writeText(`${getProofPublicBase()}/approve/${row.view_token}`);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the link manually.", variant: "destructive" });
    }
  };

  const isTerminal = (s: ProofStatus) =>
    ["approved", "declined", "revoked", "expired"].includes(s);

  return (
    <div className="min-h-screen bg-background pb-12">
      <Helmet><title>Proofs · RestylePro</title></Helmet>

      <header className="bg-white dark:bg-zinc-950 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ClipboardSignature className="w-7 h-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Proofs</h1>
              <p className="text-xs text-muted-foreground">
                Send, sign, revise, and audit every client approval.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Tier + usage meter */}
        <ProofUsageMeter />

        {/* Filters + search */}
        <Card className="p-3 flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.key)}
              className="gap-1.5"
            >
              {f.label}
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] h-4 px-1.5",
                  filter === f.key && "bg-white/25 text-white border-0",
                )}
              >
                {counts[f.key] ?? 0}
              </Badge>
            </Button>
          ))}
          <div className="ml-auto relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, design, vehicle…"
              className="pl-8 h-9"
            />
          </div>
        </Card>

        {/* List */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <Card className="p-12 text-center text-muted-foreground space-y-3">
            <ClipboardSignature className="w-10 h-10 mx-auto text-zinc-300" />
            <div>
              <p className="font-medium">No proofs in this view.</p>
              <p className="text-sm">
                {rows && rows.length === 0
                  ? "Generate a render in DesignPro and click \u201CSend for Client Approval.\u201D"
                  : "Try a different filter or clear your search."}
              </p>
            </div>
          </Card>
        )}

        {!loading && filtered.length > 0 && (
          <ol className="space-y-2">
            {filtered.map((row) => {
              const cfg = STATUS_CONFIG[row.status] || STATUS_CONFIG.draft;
              const StatusIcon = cfg.icon;
              const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
                .filter(Boolean)
                .join(" ");
              const isBusy = busyRowId === row.id;
              const expired =
                row.expires_at && new Date(row.expires_at) < new Date();

              return (
                <li key={row.id}>
                  <Card className="px-4 py-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-[260px] space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold leading-tight">
                            {row.design_name || "Untitled"}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] h-5 px-1.5 gap-1", cfg.color)}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {cfg.label}
                          </Badge>
                          {row.mode === "sign_only" && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                              Sign-only
                            </Badge>
                          )}
                          {row.ai_revisions_used > 0 && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-purple-50 text-purple-700 border-purple-200">
                              {row.ai_revisions_used} AI rev
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {row.customer_name ? `${row.customer_name} · ` : ""}
                          {row.customer_email}
                          {vehicle && ` · ${vehicle}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Updated {formatRelative(row.updated_at)}
                          {row.signed_at && ` · Signed ${formatRelative(row.signed_at)}`}
                          {expired && row.status !== "expired" && (
                            <span className="ml-2 text-amber-600">· Link expired</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="gap-1 h-8"
                          title="Open shop manage page"
                        >
                          <Link to={`/approve/manage/${row.manage_token}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Open</span>
                          </Link>
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isBusy}>
                              {isBusy ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="w-4 h-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem asChild>
                              <Link to={`/approve/${row.view_token}`} target="_blank">
                                <Eye className="w-4 h-4 mr-2" />
                                Preview client page
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyLink(row)}>
                              <Copy className="w-4 h-4 mr-2" />
                              Copy view link
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleResend(row)}
                              disabled={isTerminal(row.status) || isBusy}
                            >
                              <Send className="w-4 h-4 mr-2" />
                              {row.status === "delivery_failed" ? "Retry email" : "Resend email"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-700 focus:bg-red-50"
                              onClick={() => handleRevoke(row)}
                              disabled={isTerminal(row.status) || isBusy}
                            >
                              <XCircle className="w-4 h-4 mr-2" />
                              Revoke proof
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
