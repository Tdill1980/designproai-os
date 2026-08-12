import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface Subscription {
  id: string;
  email: string;
  tier: string;
  status: string;
  billing_cycle_start: string;
  billing_cycle_end: string;
  created_at: string;
}

const AdminSubscriptions = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newTier, setNewTier] = useState<string>("starter");
  const [adding, setAdding] = useState(false);

  const loadSubscriptions = async () => {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubscriptions(data || []);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
      toast.error('Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  };

  const addSubscription = async () => {
    if (!newEmail) {
      toast.error('Email is required');
      return;
    }

    setAdding(true);
    try {
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);

      const { error } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: crypto.randomUUID(), // Generate a placeholder user_id
          email: newEmail,
          tier: newTier,
          status: 'active',
          billing_cycle_start: now.toISOString(),
          billing_cycle_end: endDate.toISOString()
        });

      if (error) throw error;

      toast.success('Subscription added successfully');
      setNewEmail("");
      setNewTier("starter");
      loadSubscriptions();
    } catch (error) {
      console.error('Error adding subscription:', error);
      toast.error('Failed to add subscription');
    } finally {
      setAdding(false);
    }
  };

  const deleteSubscription = async (id: string) => {
    if (!confirm('Are you sure you want to delete this subscription?')) return;

    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Subscription deleted');
      loadSubscriptions();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      toast.error('Failed to delete subscription');
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Subscription Management</h1>

        {/* Add New Subscription */}
        <Card className="p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Add New Subscription</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <Label htmlFor="tier">Tier</Label>
              <Select value={newTier} onValueChange={setNewTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter - 10 renders/month</SelectItem>
                  <SelectItem value="professional">Professional - 50 renders/month</SelectItem>
                  <SelectItem value="business">Business - 200 renders/month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={addSubscription} disabled={adding} className="w-full">
                {adding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Subscription
              </Button>
            </div>
          </div>
        </Card>

        {/* Subscriptions List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Subscriptions ({subscriptions.length})</h2>
          {subscriptions.map((sub) => (
            <Card key={sub.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="grid md:grid-cols-4 gap-4 flex-1">
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{sub.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tier</p>
                    <p className="font-medium capitalize">{sub.tier}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className={`font-medium ${sub.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                      {sub.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Billing Cycle</p>
                    <p className="text-sm">
                      {new Date(sub.billing_cycle_start).toLocaleDateString()} - {new Date(sub.billing_cycle_end).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => deleteSubscription(sub.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default AdminSubscriptions;
