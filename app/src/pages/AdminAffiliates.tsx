import { useState } from "react";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AffiliateStatsCards } from "@/components/affiliate/AffiliateStatsCards";
import { AffiliateAdminAnalytics } from "@/components/admin/AffiliateAdminAnalytics";
import { AffiliatePartnerForm } from "@/components/affiliate/AffiliatePartnerForm";
import { AffiliateTransactionList } from "@/components/affiliate/AffiliateTransactionList";
import { AffiliateOnboardingWizard } from "@/components/affiliate/AffiliateOnboardingWizard";
import { AffiliatePartnerAdminControls } from "@/components/affiliate/AffiliatePartnerAdminControls";
import { useAffiliatePartners, useUpdateAffiliatePartner } from "@/hooks/useAffiliatePartners";
import type { AffiliateToolAccess } from "@/types/affiliate";

const TOOL_ACCESS_OPTIONS: { key: keyof AffiliateToolAccess; label: string }[] = [
  { key: "colorpro", label: "ColorPro + ApprovePro" },
  { key: "graphicspro", label: "GraphicsPro" },
  { key: "patternpro", label: "PatternPro (WBTY)" },
  { key: "quickquote", label: "QuickQuote" },
  { key: "quickquote_admin", label: "QuickQuote Admin + QuickText + Retargeting" },
];
import { useAffiliateTransactionsByPartner } from "@/hooks/useAffiliateTransactions";
import type { AffiliatePartner } from "@/types/affiliate";
import { Search, UserPlus, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function AdminAffiliates() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<AffiliatePartner | null>(null);
  const [onboardingPartner, setOnboardingPartner] = useState<AffiliatePartner | null>(null);

  const { data: partners, isLoading } = useAffiliatePartners(
    statusFilter ? { status: statusFilter } : undefined
  );
  const { data: partnerTransactions } = useAffiliateTransactionsByPartner(selectedPartner?.id);
  const updatePartner = useUpdateAffiliatePartner();

  const filteredPartners = (partners || []).filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.full_name.toLowerCase().includes(s) ||
      p.email.toLowerCase().includes(s) ||
      p.business_name?.toLowerCase().includes(s)
    );
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "approved": return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "pending": return "bg-amber-100 text-amber-700 border-amber-200";
      case "suspended": return "bg-red-100 text-red-700 border-red-200";
      case "terminated": return "bg-gray-100 text-gray-600 border-gray-200";
      default: return "bg-gray-100 text-gray-600 border-gray-200";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Affiliate Partners</h1>
            <p className="text-gray-600">Manage affiliate partners, commissions, and profiles</p>
          </div>

          <AffiliateAdminAnalytics />

          <AffiliateStatsCards />

          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">Affiliates</TabsTrigger>
              <TabsTrigger value="add">Add Affiliate</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, or business..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Referrals</TableHead>
                        <TableHead>Earnings</TableHead>
                        <TableHead>Pending</TableHead>
                        <TableHead>Stripe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPartners.map((p) => (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedPartner(p)}
                        >
                          <TableCell className="font-medium">{p.full_name}</TableCell>
                          <TableCell className="text-sm">{p.email}</TableCell>
                          <TableCell>{p.commission_rate}%</TableCell>
                          <TableCell>
                            <Badge className={statusColor(p.status)}>{p.status}</Badge>
                          </TableCell>
                          <TableCell>{p.total_referrals}</TableCell>
                          <TableCell className="text-green-400">
                            ${Number(p.total_earned || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-yellow-400">
                            ${Number(p.pending_balance || 0).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {p.stripe_onboarded ? (
                              <Badge className="bg-green-500/20 text-green-400">Connected</Badge>
                            ) : (
                              <Badge className="bg-yellow-500/20 text-yellow-400">No</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredPartners.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            No affiliates found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="add">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Add New Affiliate Partner
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AffiliatePartnerForm />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />

      {/* Detail Sheet */}
      <Sheet open={!!selectedPartner} onOpenChange={() => setSelectedPartner(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedPartner && (
            <div className="space-y-6">
              <SheetHeader>
                <SheetTitle>{selectedPartner.full_name}</SheetTitle>
              </SheetHeader>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={statusColor(selectedPartner.status)}>
                    {selectedPartner.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {selectedPartner.commission_rate}% commission
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Referrals</p>
                    <p className="font-bold">{selectedPartner.total_referrals}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Total Earnings</p>
                    <p className="font-bold text-green-400">${Number(selectedPartner.total_earned || 0).toFixed(2)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Paid Out</p>
                    <p className="font-bold">${Number(selectedPartner.total_paid || 0).toFixed(2)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Pending Balance</p>
                    <p className="font-bold text-yellow-400">${Number(selectedPartner.pending_balance || 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Email:</span> {selectedPartner.email}</p>
                  <p><span className="text-muted-foreground">Company:</span> {selectedPartner.company_name || "-"}</p>
                  <p><span className="text-muted-foreground">Phone:</span> {selectedPartner.phone || "-"}</p>
                  <p><span className="text-muted-foreground">Referral code:</span> {selectedPartner.referral_code}</p>
                </div>

                {(selectedPartner.instagram_handle || selectedPartner.website) && (
                  <div className="flex flex-wrap gap-2">
                    {selectedPartner.instagram_handle && (
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`https://instagram.com/${selectedPartner.instagram_handle.replace(/^@/, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Instagram <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      </Button>
                    )}
                    {selectedPartner.website && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={selectedPartner.website} target="_blank" rel="noopener noreferrer">
                          Website <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      </Button>
                    )}
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setOnboardingPartner(selectedPartner);
                    setSelectedPartner(null);
                  }}
                >
                  Launch Onboarding Wizard
                </Button>

                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-3">Commission & Tier</h4>
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Commission Rate</Label>
                      <Select
                        defaultValue={String(selectedPartner.commission_rate)}
                        onValueChange={async (v) => {
                          try {
                            await updatePartner.mutateAsync({
                              id: selectedPartner.id,
                              updates: { commission_rate: parseInt(v) },
                            });
                            toast.success("Commission rate updated");
                          } catch {
                            toast.error("Failed to update rate");
                          }
                        }}
                      >
                        <SelectTrigger className="w-[120px] mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10%</SelectItem>
                          <SelectItem value="20">20%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Tier</Label>
                      <Select
                        defaultValue={selectedPartner.tier}
                        onValueChange={async (v) => {
                          try {
                            await updatePartner.mutateAsync({
                              id: selectedPartner.id,
                              updates: { tier: v } as any,
                            });
                            toast.success("Tier updated");
                          } catch {
                            toast.error("Failed to update tier");
                          }
                        }}
                      >
                        <SelectTrigger className="w-[140px] mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="partner">Partner</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="elite">Elite</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-3">Tool Access (Onboarding Cards)</h4>
                <p className="text-xs text-muted-foreground mb-3">Toggle which tool tutorial cards this partner sees during onboarding.</p>
                <div className="space-y-3">
                  {TOOL_ACCESS_OPTIONS.map((opt) => {
                    const currentAccess: AffiliateToolAccess = (selectedPartner as any)?.tool_access || { colorpro: true };
                    const isEnabled = currentAccess[opt.key] ?? false;
                    return (
                      <div key={opt.key} className="flex items-center justify-between">
                        <Label className="text-sm">{opt.label}</Label>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={async (checked) => {
                            const newAccess = { ...currentAccess, [opt.key]: checked };
                            try {
                              await updatePartner.mutateAsync({
                                id: selectedPartner.id,
                                updates: { tool_access: newAccess } as any,
                              });
                              toast.success(`${opt.label} ${checked ? "enabled" : "disabled"}`);
                            } catch {
                              toast.error("Failed to update tool access");
                            }
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <AffiliatePartnerAdminControls key={selectedPartner.id} partner={selectedPartner} />

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-3">Recent Transactions</h4>
                <AffiliateTransactionList transactions={partnerTransactions || []} />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {onboardingPartner && (
        <AffiliateOnboardingWizard
          open={!!onboardingPartner}
          onOpenChange={() => setOnboardingPartner(null)}
          partnerId={onboardingPartner.id}
          partnerName={onboardingPartner.full_name}
          commissionRate={onboardingPartner.commission_rate}
        />
      )}
    </div>
  );
}
