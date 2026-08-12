/**
 * AdminContentEngine — Claude-powered multi-brand content partner.
 *
 * Three columns:
 *   1. Brands + conversations sidebar (pick brand, switch chat, "+ new chat")
 *   2. Chat log with the selected conversation
 *   3. Composer — sends to /functions/v1/content-engine-claude
 *
 * The "brand brain" (voice, audience, offers, proof points, do/don't) is
 * edited via a dialog and stored as jsonb on the brands row. The edge
 * function injects it as a cached system prompt on every turn.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Plus,
  Send,
  Sparkles,
  Loader2,
  Trash2,
  PencilLine,
} from "lucide-react";

type Brand = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  brand_brain: Record<string, unknown>;
  created_at: string;
};

type Conversation = {
  id: string;
  brand_id: string;
  title: string;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
  created_at: string;
};

const STARTER_BRAIN = {
  voice: {
    tone: "confident, clear, no fluff",
    adjectives: ["bold", "practical", "credible"],
    avoid: ["corporate jargon", "hype words", "emojis"],
  },
  audience: {
    primary: "(who buys — be specific: role, stage, pain)",
    secondary: "(lurkers / influencers worth reaching)",
  },
  offers: [
    { name: "Offer 1", price: "$X", problem_it_solves: "…" },
  ],
  proof_points: ["(case study / metric / testimonial)"],
  do_say: ["…"],
  dont_say: ["guaranteed", "instant", "no risk"],
  visual_style: "(colors, fonts, photography style)",
  signature_formats: ["carousel: 5-10 slides", "reel: 30-45s"],
  current_goals: ["(e.g. 500 followers in 90 days, 10 demo calls/mo)"],
};

function messageToText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

export default function AdminContentEngine() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Brands ────────────────────────────────────────────────────────────────
  const { data: brands } = useQuery({
    queryKey: ["content-engine-brands"],
    queryFn: async (): Promise<Brand[]> => {
      const { data, error } = await (supabase as any)
        .from("brands")
        .select("id, slug, name, tagline, brand_brain, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Brand[]) ?? [];
    },
  });

  // Auto-select first brand when brands arrive and nothing is selected yet.
  useEffect(() => {
    if (!selectedBrandId && brands && brands.length > 0) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId]);

  const selectedBrand = useMemo(
    () => brands?.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId],
  );

  // ── Conversations ─────────────────────────────────────────────────────────
  const { data: conversations } = useQuery({
    queryKey: ["content-engine-conversations", selectedBrandId],
    enabled: !!selectedBrandId,
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await (supabase as any)
        .from("content_conversations")
        .select("id, brand_id, title, updated_at")
        .eq("brand_id", selectedBrandId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as Conversation[]) ?? [];
    },
  });

  // Auto-select most recent conversation when switching brands.
  useEffect(() => {
    setSelectedConversationId(null);
  }, [selectedBrandId]);

  // ── Messages ──────────────────────────────────────────────────────────────
  const { data: messages } = useQuery({
    queryKey: ["content-engine-messages", selectedConversationId],
    enabled: !!selectedConversationId,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await (supabase as any)
        .from("content_messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Message[]) ?? [];
    },
  });

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // ── Create brand ──────────────────────────────────────────────────────────
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandSlug, setNewBrandSlug] = useState("");
  const [newBrandTagline, setNewBrandTagline] = useState("");
  const [newBrandBrain, setNewBrandBrain] = useState(
    JSON.stringify(STARTER_BRAIN, null, 2),
  );

  const createBrand = async () => {
    if (!newBrandName.trim() || !newBrandSlug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    let parsedBrain: Record<string, unknown>;
    try {
      parsedBrain = JSON.parse(newBrandBrain);
    } catch (e: any) {
      toast({
        title: "Brand brain must be valid JSON",
        description: e?.message ?? "Parse error",
        variant: "destructive",
      });
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const ownerId = auth?.user?.id;
    if (!ownerId) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const { data, error } = await (supabase as any)
      .from("brands")
      .insert({
        owner_id: ownerId,
        slug: newBrandSlug.trim().toLowerCase(),
        name: newBrandName.trim(),
        tagline: newBrandTagline.trim() || null,
        brand_brain: parsedBrain,
      })
      .select("id")
      .single();
    if (error) {
      toast({
        title: "Create failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Brand created" });
    setCreateOpen(false);
    setNewBrandName("");
    setNewBrandSlug("");
    setNewBrandTagline("");
    setNewBrandBrain(JSON.stringify(STARTER_BRAIN, null, 2));
    qc.invalidateQueries({ queryKey: ["content-engine-brands"] });
    if (data?.id) setSelectedBrandId(data.id);
  };

  // ── Edit brand brain ──────────────────────────────────────────────────────
  const [brainDraft, setBrainDraft] = useState("");
  useEffect(() => {
    if (selectedBrand && brainOpen) {
      setBrainDraft(JSON.stringify(selectedBrand.brand_brain ?? {}, null, 2));
    }
  }, [selectedBrand, brainOpen]);

  const saveBrain = async () => {
    if (!selectedBrand) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(brainDraft);
    } catch (e: any) {
      toast({
        title: "Brand brain must be valid JSON",
        description: e?.message ?? "Parse error",
        variant: "destructive",
      });
      return;
    }
    const { error } = await (supabase as any)
      .from("brands")
      .update({ brand_brain: parsed })
      .eq("id", selectedBrand.id);
    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Brand brain saved" });
    setBrainOpen(false);
    qc.invalidateQueries({ queryKey: ["content-engine-brands"] });
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = composer.trim();
    if (!text || !selectedBrandId || sending) return;
    setSending(true);
    setComposer("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "content-engine-claude",
        {
          body: {
            brand_id: selectedBrandId,
            conversation_id: selectedConversationId,
            user_message: text,
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const newConvId = data?.conversation_id as string | undefined;
      if (newConvId && newConvId !== selectedConversationId) {
        setSelectedConversationId(newConvId);
      }
      qc.invalidateQueries({ queryKey: ["content-engine-conversations", selectedBrandId] });
      qc.invalidateQueries({
        queryKey: ["content-engine-messages", newConvId ?? selectedConversationId],
      });
    } catch (err: any) {
      toast({
        title: "Claude error",
        description: err?.message ?? "Send failed",
        variant: "destructive",
      });
      setComposer(text);
    } finally {
      setSending(false);
    }
  };

  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    const { error } = await (supabase as any)
      .from("content_conversations")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    if (selectedConversationId === id) setSelectedConversationId(null);
    qc.invalidateQueries({ queryKey: ["content-engine-conversations", selectedBrandId] });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
          <div>
            <Link
              to="/admin"
              className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back to Admin
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 mt-1 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-500" />
              Content Engine
            </h1>
            <p className="text-sm text-slate-500">
              Multi-turn Claude content partner. Per-brand brain, persistent
              conversations, prompt-cached system instructions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedBrand && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBrainOpen(true)}
              >
                <PencilLine className="w-3 h-3 mr-1" />
                Edit brand brain
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3 h-3 mr-1" />
              New brand
            </Button>
          </div>
        </div>

        {(!brands || brands.length === 0) ? (
          <Card className="p-10 text-center text-slate-500">
            No brands yet. Click "New brand" to create your first brand brain.
          </Card>
        ) : (
          <div className="grid grid-cols-12 gap-4 h-[calc(100vh-200px)] min-h-[560px]">
            {/* Sidebar */}
            <Card className="col-span-3 flex flex-col p-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Brand
                </label>
                <Select
                  value={selectedBrandId ?? ""}
                  onValueChange={(v) => setSelectedBrandId(v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pick a brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBrand?.tagline && (
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {selectedBrand.tagline}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Conversations
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setSelectedConversationId(null)}
                >
                  <Plus className="w-3 h-3 mr-0.5" />
                  New
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-1 pr-2">
                  {(conversations ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400 px-2 py-3">
                      No conversations yet. Start typing below.
                    </p>
                  ) : (
                    (conversations ?? []).map((c) => (
                      <div
                        key={c.id}
                        className={cn(
                          "group flex items-center justify-between gap-1 rounded px-2 py-1.5 text-sm cursor-pointer",
                          selectedConversationId === c.id
                            ? "bg-cyan-50 text-cyan-900"
                            : "hover:bg-slate-100 text-slate-700",
                        )}
                        onClick={() => setSelectedConversationId(c.id)}
                      >
                        <span className="truncate flex-1">{c.title}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(c.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </Card>

            {/* Chat */}
            <Card className="col-span-9 flex flex-col">
              <div className="flex-1 overflow-hidden">
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto p-5 space-y-4"
                >
                  {!selectedConversationId && (!messages || messages.length === 0) && (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2">
                      <Sparkles className="w-8 h-8" />
                      <p className="text-sm max-w-md">
                        New conversation with{" "}
                        <span className="font-medium text-slate-600">
                          {selectedBrand?.name}
                        </span>
                        . Try: "Draft a LinkedIn post announcing our winter
                        promo" or "Give me 5 hooks for a reel about common
                        customer objections."
                      </p>
                    </div>
                  )}

                  {(messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex",
                        m.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap",
                          m.role === "user"
                            ? "bg-cyan-500 text-white"
                            : "bg-slate-100 text-slate-900",
                        )}
                      >
                        {m.role === "assistant" && (
                          <Badge
                            variant="outline"
                            className="mb-1.5 text-[10px] bg-white"
                          >
                            Claude · {selectedBrand?.name}
                          </Badge>
                        )}
                        <div>{messageToText(m.content)}</div>
                      </div>
                    </div>
                  ))}

                  {sending && (
                    <div className="flex justify-start">
                      <div className="bg-slate-100 rounded-lg px-4 py-2.5 text-sm text-slate-500 flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Drafting…
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t p-3 flex items-end gap-2">
                <Textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={
                    selectedBrand
                      ? `Ask ${selectedBrand.name}'s content lead… (Cmd/Ctrl+Enter to send)`
                      : "Pick a brand first"
                  }
                  disabled={!selectedBrand || sending}
                  className="min-h-[60px] max-h-[200px] resize-none"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!composer.trim() || !selectedBrand || sending}
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Create brand dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New brand</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Name</label>
              <Input
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="RestyleProAI"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Slug</label>
              <Input
                value={newBrandSlug}
                onChange={(e) => setNewBrandSlug(e.target.value)}
                placeholder="restyle-pro-ai"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">
                Tagline (optional)
              </label>
              <Input
                value={newBrandTagline}
                onChange={(e) => setNewBrandTagline(e.target.value)}
                placeholder="Pro-grade wrap visualization"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">
                Brand brain (JSON)
              </label>
              <Textarea
                value={newBrandBrain}
                onChange={(e) => setNewBrandBrain(e.target.value)}
                className="font-mono text-xs min-h-[280px]"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Voice, audience, offers, proof points, do/don't list. Claude
                reads this as cached system context on every turn.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createBrand}>Create brand</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit brain dialog */}
      <Dialog open={brainOpen} onOpenChange={setBrainOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Brand brain · {selectedBrand?.name}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={brainDraft}
            onChange={(e) => setBrainDraft(e.target.value)}
            className="font-mono text-xs min-h-[420px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrainOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveBrain}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
