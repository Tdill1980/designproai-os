import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ShopMarkupConfigProps {
  /** Called when markup is saved — parent can update pricing display */
  onSaved?: (markup: number, minOrder: number) => void;
}

export function ShopMarkupConfig({ onSaved }: ShopMarkupConfigProps) {
  const { toast } = useToast();
  const [markup, setMarkup] = useState(100);
  const [minOrder, setMinOrder] = useState(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load existing config
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from("shop_pricing_config")
        .select("default_markup_percentage, minimum_order_price")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setMarkup(Number(data.default_markup_percentage) || 100);
        setMinOrder(Number(data.minimum_order_price) || 25);
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("shop_pricing_config")
        .upsert({
          user_id: user.id,
          default_markup_percentage: markup,
          minimum_order_price: minOrder,
        }, { onConflict: "user_id" });

      if (error) throw error;

      toast({ title: "Saved", description: "Shop pricing updated" });
      onSaved?.(markup, minOrder);
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4 bg-rp-surface border-border/30">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
      </Card>
    );
  }

  // Example pricing at current markup
  const exampleSqft = 3;
  const averyWholesale = exampleSqft * 6.32;
  const exampleRetail = averyWholesale * (1 + markup / 100);

  return (
    <Card className="p-5 bg-rp-surface border-border/30">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-blue-500" />
        <h4 className="text-sm font-semibold text-foreground">Shop Pricing Settings</h4>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm text-muted-foreground">Default Markup (%)</Label>
          <Input
            type="number"
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value) || 0)}
            min={0}
            max={500}
            className="mt-1 bg-secondary border-border/30"
          />
          <p className="text-xs text-muted-foreground/60 mt-1">
            100% = 2x wholesale (${averyWholesale.toFixed(2)} → ${exampleRetail.toFixed(2)} for {exampleSqft} sq ft Avery)
          </p>
        </div>
        <div>
          <Label className="text-sm text-muted-foreground">Minimum Order ($)</Label>
          <Input
            type="number"
            value={minOrder}
            onChange={(e) => setMinOrder(Number(e.target.value) || 0)}
            min={0}
            max={500}
            className="mt-1 bg-secondary border-border/30"
          />
          <p className="text-xs text-muted-foreground/60 mt-1">
            Orders below this amount will be charged the minimum
          </p>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        size="sm"
        className="mt-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white gap-2"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        Save Settings
      </Button>
    </Card>
  );
}
