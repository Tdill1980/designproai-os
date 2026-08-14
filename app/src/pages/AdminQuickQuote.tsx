/**
 * Admin QuickQuote Settings
 *
 * Manage: film prices, print prices, regional labor rates,
 * shop branding (logo + name), and view/manage quotes.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DollarSign, MapPin, Upload, Save,
  FileText, CheckCircle2, Clock,
  Phone, PhoneIncoming, Car, MessageSquare,
  Search, Send, Users, ChevronDown,
  Settings, TrendingUp, RefreshCw, Plus, Mail, Play,
  ArrowLeft, BarChart3, List, LayoutGrid, Store, Package,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FILM_COST_PER_YARD,
  PRINT_COST_PER_SQFT,
  REGIONS,
  US_STATES,
  type PriceRegion,
} from "@/lib/quick-quote";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  RETARGET_TEMPLATES,
  DAY3_SMS_TEMPLATES,
  DAY7_SMS_TEMPLATES,
  DAY3_EMAIL_TEMPLATES,
  DAY7_EMAIL_TEMPLATES,
  TONE_PRESETS,
  type ToneStyle,
  mergeTemplate,
  getRetargetTier,
  getRetargetLabel,
  type RetargetTemplate,
  type RetargetTier,
} from "@/lib/retarget-templates";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SavedQuotesTable } from "@/components/admin/SavedQuotesTable";
import { QuoteToolSelfServeTable } from "@/components/admin/QuoteToolSelfServeTable";
import { AppointmentsTab } from "@/components/admin/AppointmentsTab";

const AdminQuickQuote = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Film Prices ──
  const [filmPrices, setFilmPrices] = useState<Record<string, number>>({ ...FILM_COST_PER_YARD });
  const [printPrices, setPrintPrices] = useState<Record<string, number>>({ ...PRINT_COST_PER_SQFT });
  const [laborRates, setLaborRates] = useState<Record<PriceRegion, number>>({
    budget: REGIONS.budget.laborPerSqFt,
    standard: REGIONS.standard.laborPerSqFt,
    premium: REGIONS.premium.laborPerSqFt,
    luxury: REGIONS.luxury.laborPerSqFt,
  });

  // ── Shop Branding ──
  const [shopName, setShopName] = useState("");
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [shopLogoFile, setShopLogoFile] = useState<File | null>(null);

  // Load shop profile
  useEffect(() => {
    supabase.from("shop_settings").select("*").limit(1).single().then(({ data }) => {
      if (data) {
        setShopName((data as any).shop_name || "");
        setShopLogoUrl((data as any).shop_logo_url || null);
        if ((data as any).tone_style) setShopTone((data as any).tone_style as ToneStyle);
      }
    });
  }, []);

  // ── Leads ──
  const { data: leads, isLoading: leadsLoading, refetch: refetchLeads } = useQuery({
    queryKey: ["admin-quick-quote-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  // ── Quotes (from QuickQuote dashboard card + standalone /quick-quote page) ──
  //
  // The main pipeline below is driven by this feed (merged with `leads` for
  // inbound voicemails / QuikText). Every time someone clicks "Save Quote" on
  // the dashboard QuickQuote dialog or the /quick-quote page, a row lands
  // here within seconds thanks to the saveQuote() + queryClient.invalidate
  // wiring in QuickQuoteDialog.tsx and tools/QuickQuote.tsx.
  const { data: pipelineQuotes, isLoading: pipelineQuotesLoading, refetch: refetchPipelineQuotes } = useQuery({
    queryKey: ["admin-quick-quote-quotes-pipeline"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quotes")
        .select(
          `id, quote_number, created_at, status, last_email_at, last_email_type,
           vehicle_year, vehicle_make, vehicle_model, manufacturer, color_name, finish, category,
           customer_total, shop_cost, sq_ft, yards_needed, render_url, quote_url, share_token, metadata,
           customers ( id, name, email, phone )`
        )
        .not("quote_number", "like", "DEMO-%")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      // Drop any sample/demo customers that slipped in without the prefix.
      return ((data || []) as any[]).filter((q) => {
        const name = (q.customers?.name || "").toLowerCase();
        const email = (q.customers?.email || "").toLowerCase();
        if (name.includes("demo") || name.includes("(sample)")) return false;
        if (email.startsWith("demo@") || email.includes("@example.")) return false;
        return true;
      });
    },
  });

  // Map a quotes row → the lead-shaped view model used by the table below.
  // This keeps existing JSX/columns working while every QuickQuote submission
  // flows through the same pipeline as classic voicemail / manual leads.
  const quoteRowsAsFeed = useMemo(() => {
    if (!pipelineQuotes) return [];
    return pipelineQuotes.map((q: any) => {
      const meta = (q.metadata || {}) as any;
      const totalEstimate = Number(q.customer_total) || meta.totalEstimate || 0;
      const qt: "quiktext" | null = meta.quiktext_sent_at ? "quiktext" : null;
      const mergedMeta = {
        ...meta,
        totalEstimate,
        email: q.customers?.email || meta.email || null,
        manufacturer: q.manufacturer || meta.manufacturer || null,
        sqFt: q.sq_ft || meta.sqFt || 0,
        quote_id: q.quote_number,
        quote_source: q.toolSource || meta.quote_source || null,
      };
      return {
        __source: "quote" as const,
        __quote: q,
        id: q.id,
        quote_id: q.quote_number,
        created_at: q.created_at,
        status: q.status || "quoted",
        caller_name: q.customers?.name || meta.customer_name || null,
        caller_phone: q.customers?.phone || meta.customer_phone || null,
        vehicle_year: q.vehicle_year,
        vehicle_make: q.vehicle_make,
        vehicle_model: q.vehicle_model,
        service_requested: q.category || null,
        voicemail_transcript: null,
        voicemail_recording_url: null,
        source: (q.metadata as any)?.tool_source || "quickquote",
        customer_id: q.customers?.id || null,
        quote_url: q.quote_url || null,
        quote_sent_at: q.last_email_at || null,
        sms_sent_to_customer: !!meta.sms_sent_at,
        email_sent_to_customer: !!q.last_email_at,
        last_email_at: q.last_email_at,
        last_email_type: q.last_email_type,
        is_hot: qt === "quiktext" || !!meta.is_hot,
        auto_texted_at: meta.quiktext_sent_at || null,
        lead_score: meta.lead_score || 0,
        metadata: mergedMeta,
      };
    });
  }, [pipelineQuotes]);

  // Merge the quotes feed with the leads feed. Quotes first (they are the
  // primary product), then inbound leads that have not yet been priced.
  const pipelineRows = useMemo(() => {
    const quoteIds = new Set(quoteRowsAsFeed.map((r: any) => r.id));
    const leadRows = (leads || []).map((l: any) => ({ ...l, __source: "lead" as const }));
    return [...quoteRowsAsFeed, ...leadRows].filter(
      (r: any) => r.__source === "quote" || !quoteIds.has(r.id),
    );
  }, [quoteRowsAsFeed, leads]);

  const refetchAll = () => {
    refetchLeads();
    refetchPipelineQuotes();
  };

  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);
  const [customerEmailInput, setCustomerEmailInput] = useState<Record<string, string>>({});

  // ── Manual Lead Creation ──
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [newLead, setNewLead] = useState({
    name: "", phone: "", email: "", year: "", make: "", model: "", service: "", notes: "",
  });
  const [creatingLead, setCreatingLead] = useState(false);

  const handleCreateLead = async () => {
    if (!newLead.name && !newLead.phone) {
      toast.error("Name or phone is required");
      return;
    }
    setCreatingLead(true);
    try {
      const { error } = await supabase.from("leads").insert({
        caller_name: newLead.name || null,
        caller_phone: newLead.phone || "manual",
        vehicle_year: newLead.year || null,
        vehicle_make: newLead.make || null,
        vehicle_model: newLead.model || null,
        service_requested: newLead.service || null,
        voicemail_transcript: newLead.notes || null,
        source: "manual",
        status: "new",
      });
      if (error) throw error;

      // Also create customer record
      if (newLead.phone || newLead.email) {
        const vehicle = [newLead.year, newLead.make, newLead.model].filter(Boolean).join(" ");
        await supabase.from("customers").insert({
          phone: newLead.phone || null,
          email: newLead.email || null,
          name: newLead.name || null,
          last_vehicle: vehicle || null,
          last_service: newLead.service || null,
          source: "manual",
          total_inquiries: 1,
        });
      }

      toast.success("Lead created!");
      setNewLead({ name: "", phone: "", email: "", year: "", make: "", model: "", service: "", notes: "" });
      setShowCreateLead(false);
      refetchLeads();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setCreatingLead(false);
    }
  };

  const updateLeadStatus = async (leadId: string, status: string) => {
    const { error } = await supabase
      .from("leads")
      .update({ status })
      .eq("id", leadId);
    if (error) {
      toast.error(`Failed to update lead: ${error.message}`);
    } else {
      toast.success(`Lead marked as ${status}`);
      refetchLeads();
    }
  };

  // Send vetted quote to customer via SMS + email
  const handleSendQuote = async (lead: any) => {
    setSendingQuoteId(lead.id);
    try {
      const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model]
        .filter(Boolean).join(" ") || "your vehicle";
      const customerEmail = customerEmailInput[lead.id];
      const quoteUrl = lead.quote_url || `${window.location.origin}/quick-quote`;

      // 1. SMS to customer
      if (lead.caller_phone) {
        const smsMsg = `${shopName || "Your wrap shop"}: Your estimate for ${vehicle} is ready! View it here: ${quoteUrl}`;
        const { error: smsError } = await supabase.functions.invoke("send-sms-campaign", {
          body: {
            recipients: [{ phone: lead.caller_phone, name: lead.caller_name || "there" }],
            messageTemplate: smsMsg,
            campaignName: `QuickQuote Lead ${lead.id}`,
          },
        });
        if (smsError) console.error("SMS send error:", smsError);
      }

      // 2. Email to customer (if email provided)
      if (customerEmail) {
        await supabase.functions.invoke("send-templated-email", {
          body: {
            templateSlug: "quickquote-send",
            to: customerEmail,
            mergeData: {
              customer_name: lead.caller_name || "there",
              vehicle,
              service: lead.service_requested || "Vehicle Wrap",
              quote_url: quoteUrl,
              shop_name: shopName || "DesignProAI",
              shop_phone: lead.caller_phone || "",
            },
          },
        });
      }

      // 3. Update status — route to the right table based on row source.
      const nowIso = new Date().toISOString();
      if (lead.__source === "quote" && lead.__quote) {
        await (supabase as any).from("quotes").update({
          status: "sent",
          last_email_at: nowIso,
          last_email_type: "quickquote-send",
        }).eq("id", lead.__quote.id);
        queryClient.invalidateQueries({ queryKey: ["admin-quick-quote-quotes-pipeline"] });
        queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
      } else {
        await supabase.from("leads").update({
          status: "quoted",
          sms_sent_to_customer: true,
          email_sent_to_customer: !!customerEmail,
          quote_sent_at: nowIso,
        }).eq("id", lead.id);
      }

      // 4. Update customer record with email
      if (customerEmail && lead.customer_id) {
        await supabase.from("customers").update({
          email: customerEmail,
          total_quotes_sent: ((lead as any).total_quotes_sent || 0) + 1,
        }).eq("id", lead.customer_id);
      }

      toast.success(`Quote sent to ${lead.caller_name || lead.caller_phone}!`);
      refetchLeads();
    } catch (err: any) {
      toast.error(`Failed to send quote: ${err.message}`);
    } finally {
      setSendingQuoteId(null);
    }
  };

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");

  // Pipeline stats — computed from the unified quotes + leads feed.
  // Status buckets used across the tabs + header stat cards:
  //   new        — Quote has been built (saved from QuickQuote) but no
  //                customer contact yet, OR inbound lead still marked "new".
  //   emailed    — Customer has been emailed (last_email_at set) OR lead
  //                status === "quoted".
  //   callback   — metadata.callback_scheduled_at set OR lead "contacted".
  //   completed  — Job finished / installed (quote status === "completed"
  //                or legacy lead "booked").
  //   converted  — Customer accepted the quote (quote status === "converted").
  //                This is an order, but not yet marked complete.
  //   quiktext   — Auto-texted or flagged hot, across either source.
  //   contacted  — Any customer interaction (emailed, callback, completed,
  //                converted, or quiktext). Powers the "Total Contacted"
  //                header card.
  const isNewRow = (r: any) => {
    if (r.__source === "lead") return r.status === "new" || !r.status;
    return (
      (r.status === "quoted" || r.status === "draft" || !r.status) &&
      !r.last_email_at &&
      !(r.metadata as any)?.callback_scheduled_at &&
      !(r.metadata as any)?.quiktext_sent_at
    );
  };
  const isEmailedRow = (r: any) => {
    if (r.__source === "lead") return r.status === "quoted";
    return !!r.last_email_at && r.status !== "completed" && r.status !== "converted";
  };
  const isCallbackRow = (r: any) => {
    if (r.__source === "lead") return r.status === "contacted";
    return !!(r.metadata as any)?.callback_scheduled_at && r.status !== "completed" && r.status !== "converted";
  };
  const isCompletedRow = (r: any) => {
    if (r.__source === "lead") return r.status === "booked";
    return r.status === "completed";
  };
  const isConvertedRow = (r: any) => {
    if (r.__source === "lead") return false; // leads never become converted directly
    return r.status === "converted";
  };
  const isQuikTextRow = (r: any) => !!r.is_hot || !!r.auto_texted_at;

  const pipelineStats = useMemo(() => {
    const rows = pipelineRows;
    return {
      total: rows.length,
      new: rows.filter(isNewRow).length,
      emailed: rows.filter(isEmailedRow).length,
      callback: rows.filter(isCallbackRow).length,
      completed: rows.filter(isCompletedRow).length,
      converted: rows.filter(isConvertedRow).length,
      quiktext: rows.filter(isQuikTextRow).length,
      contacted: rows.filter(
        (r: any) =>
          isEmailedRow(r) ||
          isCallbackRow(r) ||
          isCompletedRow(r) ||
          isConvertedRow(r) ||
          isQuikTextRow(r),
      ).length,
      autoTexted: rows.filter((r: any) => !!r.auto_texted_at).length,
    };
  }, [pipelineRows]);

  // Legacy alias kept for the minority of JSX blocks (QuikText history,
  // analytics) that still read this name.
  const leadStats = pipelineStats;

  // Filtered pipeline rows (search across name, email, phone, vehicle, service).
  // Works on the unified quotes + leads feed so Quote Management actually sees
  // every QuickQuote submission, not just voicemail leads.
  const filteredLeads = useMemo(() => {
    if (!pipelineRows || pipelineRows.length === 0) return [];
    if (!searchQuery.trim()) return pipelineRows;
    const q = searchQuery.toLowerCase();
    return pipelineRows.filter((l: any) => {
      const vehicle = [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ").toLowerCase();
      const email = (l.metadata as any)?.email || "";
      return (
        (l.caller_name || "").toLowerCase().includes(q) ||
        (l.caller_phone || "").includes(q) ||
        email.toLowerCase().includes(q) ||
        vehicle.includes(q) ||
        (l.service_requested || "").toLowerCase().includes(q) ||
        (l.status || "").includes(q) ||
        (l.quote_id || "").toLowerCase().includes(q)
      );
    });
  }, [pipelineRows, searchQuery]);

  // ── Customers ──
  const { data: customers, refetch: refetchCustomers } = useQuery({
    queryKey: ["admin-quick-quote-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("last_contact_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter((c: any) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.phone || "").includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.last_vehicle || "").toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  // ── Quote History ──
  const { data: quotes, isLoading: quotesLoading } = useQuery({
    queryKey: ["admin-quick-quote-quotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Analytics — auto-populated from quote_events
  const analytics = useMemo(() => {
    if (!quotes) return { views: 0, saved: 0, converted: 0, conversionRate: 0, revenue: 0 };
    const views = quotes.filter((q: any) => q.event_type === "estimate_viewed").length;
    const saved = quotes.filter((q: any) => q.event_type === "quote_saved" || q.event_type === "quote_copied").length;
    const converted = quotes.filter((q: any) => q.event_type === "converted_to_job" || q.event_type === "quote_converted_to_order").length;
    const revenue = quotes
      .filter((q: any) => q.event_type === "converted_to_job" || q.event_type === "quote_converted_to_order")
      .reduce((sum: number, q: any) => sum + (parseFloat(q.metadata?.price || q.metadata?.finalPrice) || 0), 0);
    return {
      views,
      saved,
      converted,
      conversionRate: views > 0 ? Math.round((converted / views) * 100) : 0,
      revenue,
    };
  }, [quotes]);

  // ── Retarget (re-text a past lead/customer with template) ──
  const [retargetingId, setRetargetingId] = useState<string | null>(null);

  const handleRetargetWithTemplate = async (
    lead: any,
    template: RetargetTemplate,
  ) => {
    const phone = lead.caller_phone;
    const name = lead.caller_name || "";
    const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
    const meta = (lead.metadata || {}) as any;
    const price = meta.totalEstimate ? `$${Number(meta.totalEstimate).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "";
    const quoteUrl = lead.quote_url || `${window.location.origin}/quick-quote${vehicle ? `?make=${encodeURIComponent(lead.vehicle_make || "")}&model=${encodeURIComponent(lead.vehicle_model || "")}&year=${encodeURIComponent(lead.vehicle_year || "")}` : ""}`;

    const mergeData = { name, vehicle, shop: shopName || "Your wrap shop", quote_url: quoteUrl, price, shop_logo: shopLogoUrl || "" };

    setRetargetingId(lead.id);
    try {
      if (template.channel === "sms" && phone) {
        const msg = mergeTemplate(template.body, mergeData);
        await supabase.functions.invoke("send-sms-campaign", {
          body: {
            recipients: [{ phone, name: name || "there" }],
            messageTemplate: msg,
            campaignName: `Retarget ${template.tier} - ${name || phone}`,
          },
        });
        toast.success(`${template.label} SMS sent to ${name || phone}!`);
      } else if (template.channel === "email") {
        const customerEmail = meta.email || customerEmailInput[lead.id];
        if (!customerEmail) {
          toast.error("No email on file. Add an email first.");
          return;
        }
        await supabase.functions.invoke("send-templated-email", {
          body: {
            templateSlug: "quickquote-retarget",
            to: customerEmail,
            mergeData: {
              customer_name: name || "there",
              vehicle,
              service: lead.service_requested || "Vehicle Wrap",
              quote_url: quoteUrl,
              shop_name: shopName || "DesignProAI",
              shop_logo_url: shopLogoUrl || "",
              price,
              tone_style: shopTone,
              subject: mergeTemplate(template.subject || "", mergeData),
              body_text: mergeTemplate(template.body, mergeData),
            },
          },
        });
        toast.success(`${template.label} email sent to ${customerEmail}!`);
      }
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setRetargetingId(null);
    }
  };

  // Legacy retarget (for SMS button)
  const handleRetarget = async (phone: string, name: string, vehicle: string, id: string) => {
    const row = pipelineRows.find((r: any) => r.id === id);
    if (!row) return;
    if (row.__source === "quote") {
      await handleQuikTextForRow(row);
    } else {
      handleRetargetWithTemplate(row, DAY3_SMS_TEMPLATES[0]);
    }
  };

  // ── MightyMail retarget for quote-backed rows ──
  // Queues a row into public.scheduled_emails which the
  // process-scheduled-emails cron worker picks up. Mirrors the approach
  // already used in SavedQuotesTable.handleScheduleRetarget so QuickQuote
  // submissions schedule follow-ups through the exact same MightyMail
  // pipeline the "Saved Quotes" tab uses.
  const handleScheduleQuoteRetarget = async (row: any, days: number) => {
    const quote = row.__quote;
    if (!quote) {
      toast.error("Missing quote data for retarget.");
      return;
    }
    const recipient = row.metadata?.email || quote.customers?.email;
    if (!recipient) {
      toast.error("No email on file. Add a customer email before scheduling.");
      return;
    }

    setRetargetingId(row.id);
    try {
      // Resolve shop id for RLS + template slug for voice.
      const { data: { user } } = await supabase.auth.getUser();
      let shopId: string | null = null;
      let shopVoice: string = "formal";
      if (user) {
        const { data: sp } = await (supabase as any)
          .from("shop_profiles")
          .select("id, shop_voice")
          .eq("user_id", user.id)
          .maybeSingle();
        shopId = sp?.id || null;
        shopVoice = sp?.shop_voice || "formal";
      }
      const templateSlug = `retarget-${days}day-${shopVoice}`;
      const sendAt = new Date();
      sendAt.setDate(sendAt.getDate() + days);

      const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
        .filter(Boolean)
        .join(" ");
      const price = row.metadata?.totalEstimate
        ? `$${Number(row.metadata.totalEstimate).toFixed(2)}`
        : "";

      // Pull the design that was attached to the quote so MightyMail can
      // embed the actual render as the hero image. Quote.render_url is the
      // hero render produced by the visualizer at quote-build time. We
      // pre-render the <img> as HTML (instead of a bare {{render_url}}
      // src) so the template renders nothing — not a broken image — when
      // no render exists.
      const renderUrl = quote.render_url || row.metadata?.render_url || "";
      const quoteUrl = quote.share_token
        ? `${window.location.origin}/q/${quote.share_token}`
        : "";
      const heroRenderBlock = renderUrl
        ? `<tr><td style="padding:0 32px 24px 32px;"><img src="${renderUrl}" alt="Your ${vehicle || "wrap"} render" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;border:1px solid #e2e8f0;" /></td></tr>`
        : "";

      const { error: insertError } = await (supabase as any).from("scheduled_emails").insert({
        send_at: sendAt.toISOString(),
        template_slug: templateSlug,
        recipient_email: recipient,
        merge_data: {
          customer_name: row.caller_name || "there",
          customer_email: recipient,
          quote_number: row.quote_id || "",
          quote_total: price,
          // Templates use {{vehicle_name}}; pass both for safety.
          vehicle,
          vehicle_name: vehicle,
          vehicle_year: row.vehicle_year || "",
          vehicle_make: row.vehicle_make || "",
          vehicle_model: row.vehicle_model || "",
          manufacturer: row.metadata?.manufacturer || "",
          color_name: quote.color_name || "",
          finish: quote.finish || "",
          days_since_quote: String(days),
          // The "relevant design" — embedded as an HTML <img> block in the
          // retarget templates via {{hero_render_block}}. Empty string when
          // no render exists so the row collapses cleanly.
          render_url: renderUrl,
          hero_render_block: heroRenderBlock,
          quote_url: quoteUrl,
        },
        shop_id: shopId,
        source: "quote_retarget",
        source_ref: quote.id,
        status: "pending",
        created_by: user?.id || null,
      });
      if (insertError) throw insertError;

      // Mirror the retarget flag onto the quote so the UI can show state.
      await (supabase as any)
        .from("quotes")
        .update({
          metadata: {
            ...(quote.metadata || {}),
            retarget_scheduled: true,
            retarget_send_at: sendAt.toISOString(),
            retarget_days: days,
            retarget_template_slug: templateSlug,
          },
        })
        .eq("id", quote.id);

      toast.success(`MightyMail retarget queued (${days}d) for ${recipient}`);
      queryClient.invalidateQueries({ queryKey: ["admin-quick-quote-quotes-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    } catch (err: any) {
      toast.error(`Retarget failed: ${err.message}`);
    } finally {
      setRetargetingId(null);
    }
  };

  // ── QuikText (SMS) send for either a lead row or a quote row ──
  // For quotes, invokes send-sms-campaign with the customer phone +
  // merged-in quote context. Stamps metadata.quiktext_sent_at so the
  // QuikText stat card + tab pick it up, and mirrors last_email_type
  // for table display.
  const handleQuikTextForRow = async (row: any) => {
    const phone = row.caller_phone;
    if (!phone) {
      toast.error("No phone number on file.");
      return;
    }
    const name = row.caller_name || "there";
    const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
      .filter(Boolean)
      .join(" ") || "your vehicle";
    const price = row.metadata?.totalEstimate
      ? `$${Number(row.metadata.totalEstimate).toFixed(2)}`
      : "";
    const quoteUrl =
      row.quote_url ||
      `${window.location.origin}/quick-quote?make=${encodeURIComponent(row.vehicle_make || "")}&model=${encodeURIComponent(row.vehicle_model || "")}&year=${encodeURIComponent(row.vehicle_year || "")}`;

    const msg = `Hey ${name}! ${shopName || "Your wrap shop"} here — your estimate for the ${vehicle}${price ? ` is ${price}` : ""}. View & book: ${quoteUrl}`;

    setRetargetingId(row.id);
    try {
      const { error } = await supabase.functions.invoke("send-sms-campaign", {
        body: {
          recipients: [{ phone, name }],
          messageTemplate: msg,
          campaignName: `QuikText - ${row.quote_id || row.id}`,
        },
      });
      if (error) throw error;

      const stampedAt = new Date().toISOString();
      if (row.__source === "quote" && row.__quote) {
        await (supabase as any)
          .from("quotes")
          .update({
            metadata: {
              ...(row.__quote.metadata || {}),
              quiktext_sent_at: stampedAt,
            },
            last_email_type: "quiktext",
          })
          .eq("id", row.__quote.id);
        queryClient.invalidateQueries({ queryKey: ["admin-quick-quote-quotes-pipeline"] });
      } else {
        await supabase
          .from("leads")
          .update({
            auto_texted_at: stampedAt,
            is_hot: true,
            sms_sent_to_customer: true,
          })
          .eq("id", row.id);
        refetchLeads();
      }

      toast.success(`QuikText sent to ${name}!`);
    } catch (err: any) {
      toast.error(`QuikText failed: ${err.message}`);
    } finally {
      setRetargetingId(null);
    }
  };

  // ── Status update that routes to the correct table based on row source ──
  const updateRowStatus = async (row: any, status: string) => {
    if (row.__source === "quote" && row.__quote) {
      const { error } = await (supabase as any)
        .from("quotes")
        .update({ status })
        .eq("id", row.__quote.id);
      if (error) {
        toast.error(`Failed to update quote: ${error.message}`);
        return;
      }
      toast.success(`Quote marked as ${status}`);
      queryClient.invalidateQueries({ queryKey: ["admin-quick-quote-quotes-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    } else {
      await updateLeadStatus(row.id, status);
    }
  };

  const handleSaveShop = async () => {
    try {
      let logoUrl = shopLogoUrl;

      if (shopLogoFile) {
        const ext = shopLogoFile.name.split(".").pop();
        const path = `shop-logos/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("wrap-files")
          .upload(path, shopLogoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
        logoUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from("shop_settings").upsert({
        id: "default",
        shop_name: shopName,
        shop_logo_url: logoUrl,
      } as any);

      if (error) throw error;
      setShopLogoUrl(logoUrl);
      setShopLogoFile(null);
      toast.success("Shop settings saved");
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    }
  };

  const handleSavePrices = () => {
    toast.success("Prices updated for this session. To persist, update quick-quote.ts.");
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [retargetTemplatesOpen, setRetargetTemplatesOpen] = useState(false);
  const [editableTemplates, setEditableTemplates] = useState<RetargetTemplate[]>([...RETARGET_TEMPLATES]);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templatesDirty, setTemplatesDirty] = useState(false);
  const [shopTone, setShopTone] = useState<ToneStyle>("casual");

  // Load templates from Supabase on mount
  useEffect(() => {
    supabase
      .from("retarget_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setEditableTemplates(data.map((row: any) => ({
            id: row.id,
            tier: row.tier as RetargetTier,
            channel: row.channel as "sms" | "email",
            label: row.label,
            description: row.description || "",
            subject: row.subject || undefined,
            body: row.body,
          })));
        }
      });
  }, []);

  const handleSaveTemplates = async () => {
    setSavingTemplates(true);
    try {
      for (const t of editableTemplates) {
        await supabase.from("retarget_templates").upsert({
          id: t.id,
          tier: t.tier,
          channel: t.channel,
          label: t.label,
          description: t.description,
          subject: t.subject || null,
          body: t.body,
        } as any);
      }
      toast.success("Retarget templates saved!");
      setTemplatesDirty(false);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSavingTemplates(false);
    }
  };

  const updateTemplate = (id: string, updates: Partial<RetargetTemplate>) => {
    setEditableTemplates(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    setTemplatesDirty(true);
  };
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"card" | "table">("table");

  // Apply status filter on top of search. Tab keys map to pipeline buckets:
  //   all       → New Quotes    (isNewRow)
  //   quoted    → Email Sent    (isEmailedRow)
  //   contacted → Call Back Later (isCallbackRow)
  //   booked    → Completed     (isCompletedRow)
  //   lost      → Converted     (isConvertedRow) — "lost" kept as the key
  //                              only because the existing tab list uses it.
  const displayLeads = useMemo(() => {
    let result = filteredLeads;
    if (statusFilter === "all") {
      result = result.filter(isNewRow);
    } else if (statusFilter === "quoted") {
      result = result.filter(isEmailedRow);
    } else if (statusFilter === "contacted") {
      result = result.filter(isCallbackRow);
    } else if (statusFilter === "booked") {
      result = result.filter(isCompletedRow);
    } else if (statusFilter === "lost") {
      result = result.filter(isConvertedRow);
    }
    if (sourceFilter !== "all") {
      result = result.filter((l: any) => {
        const src = (l.source || "unknown") as string;
        // "tool" = anything brought in via the public quote/booking tool —
        // public-quote:<slug>, public-booking:<slug>, plus the legacy
        // tool_source values that flow in from internal QuickQuote saves.
        if (sourceFilter === "tool") {
          return (
            src.startsWith("public-quote") ||
            src.startsWith("public-booking") ||
            src === "quickquote" ||
            src === "WPW"
          );
        }
        return src === sourceFilter;
      });
    }
    if (sortOrder === "oldest") {
      result = [...result].reverse();
    }
    return result;
  }, [filteredLeads, statusFilter, sortOrder, sourceFilter]);

  // Overdue count — pipeline rows older than 48h still in the "new" bucket
  // (QuickQuote saved but no customer contact). Used to highlight the
  // Overdue stat card and the Call Back Later tab dot.
  const overdueCount = useMemo(() => {
    if (!pipelineRows || pipelineRows.length === 0) return 0;
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    return pipelineRows.filter(
      (r: any) => isNewRow(r) && new Date(r.created_at).getTime() < cutoff,
    ).length;
  }, [pipelineRows]);

  return (
    <div className="min-h-screen bg-[#fafafa]">

      {/* ── Sticky Dashboard: Header + Stats + Search + Tabs ── */}
      <div className="sticky top-0 z-30 bg-[#fafafa] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">

      {/* ── Contrast Header ── */}
      <div className="bg-[#111] border-b border-[#e5e7eb] px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/admin")} className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="h-5 w-px bg-gray-700" />
          <h1 className="text-lg sm:text-xl font-bold text-white">Quote Management</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/admin/quote-pricing")} className="h-9 px-3 text-xs font-medium text-gray-300 rounded-lg flex items-center gap-1.5 border border-gray-700 hover:bg-white/10 transition">
            <DollarSign className="w-3.5 h-3.5" /> Pricing & Branding
          </button>
          <button onClick={() => navigate("/admin/shop-products")} className="h-9 px-3 text-xs font-medium text-gray-300 rounded-lg flex items-center gap-1.5 border border-gray-700 hover:bg-white/10 transition">
            <Store className="w-3.5 h-3.5" /> Shop Products
          </button>
          <Dialog open={showCreateLead} onOpenChange={setShowCreateLead}>
            <DialogTrigger asChild>
              <button className="h-9 px-4 text-sm font-semibold text-white rounded-lg flex items-center gap-1.5" style={{ background: "linear-gradient(135deg, #0891b2, #2563eb)" }}>
                <Plus className="w-4 h-4" /> Create Quote
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-[520px] bg-white rounded-2xl border border-[#e5e7eb]">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-[#111]">New Lead / Quote</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 pt-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <Label className="text-xs text-[#6b7280]">Name</Label>
                    <Input value={newLead.name} onChange={(e) => setNewLead(p => ({ ...p, name: e.target.value }))}
                      placeholder="John Smith" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                  </div>
                  <div>
                    <Label className="text-xs text-[#6b7280]">Phone</Label>
                    <Input value={newLead.phone} onChange={(e) => setNewLead(p => ({ ...p, phone: e.target.value }))}
                      placeholder="(214) 555-1234" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-[#6b7280]">Email</Label>
                  <Input value={newLead.email} onChange={(e) => setNewLead(p => ({ ...p, email: e.target.value }))}
                    placeholder="john@email.com" type="email" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                </div>
                <div className="grid grid-cols-[80px_1fr_1fr] gap-2.5">
                  <div>
                    <Label className="text-xs text-[#6b7280]">Year</Label>
                    <Input value={newLead.year} onChange={(e) => setNewLead(p => ({ ...p, year: e.target.value }))}
                      placeholder="2024" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                  </div>
                  <div>
                    <Label className="text-xs text-[#6b7280]">Make</Label>
                    <Input value={newLead.make} onChange={(e) => setNewLead(p => ({ ...p, make: e.target.value }))}
                      placeholder="Ford" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                  </div>
                  <div>
                    <Label className="text-xs text-[#6b7280]">Model</Label>
                    <Input value={newLead.model} onChange={(e) => setNewLead(p => ({ ...p, model: e.target.value }))}
                      placeholder="Mustang GT" className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-[#6b7280]">Service</Label>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {[
                      { label: "Color Change" },
                      { label: "Full Wrap" },
                      { label: "PPF" },
                      { label: "Window Tint" },
                      { label: "Chrome Delete" },
                      { label: "Other" },
                    ].map((b) => {
                      const active = newLead.service === b.label;
                      return (
                        <button
                          key={b.label}
                          type="button"
                          onClick={() => setNewLead(p => ({ ...p, service: b.label }))}
                          className={cn(
                            "h-8 px-2 text-[11px] font-semibold rounded-md border transition",
                            active
                              ? "border-[#0891b2] bg-[#0891b2]/10 text-[#0891b2]"
                              : "border-[#e5e7eb] bg-white text-[#374151] hover:border-[#0891b2]/40 hover:bg-[#0891b2]/5",
                          )}
                        >
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                  <Select value={newLead.service} onValueChange={(v) => setNewLead(p => ({ ...p, service: v }))}>
                    <SelectTrigger className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]">
                      <SelectValue placeholder="Or pick from full list…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Full Wrap">Full Wrap</SelectItem>
                      <SelectItem value="Partial Wrap">Partial Wrap</SelectItem>
                      <SelectItem value="Color Change">Color Change</SelectItem>
                      <SelectItem value="Chrome Delete">Chrome Delete</SelectItem>
                      <SelectItem value="Commercial Wrap">Commercial / Fleet</SelectItem>
                      <SelectItem value="PPF">PPF / Paint Protection</SelectItem>
                      <SelectItem value="Window Tint">Window Tint</SelectItem>
                      <SelectItem value="Roof Wrap">Roof Wrap</SelectItem>
                      <SelectItem value="Hood Wrap">Hood Wrap</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-[#6b7280]">Notes</Label>
                  <Input value={newLead.notes} onChange={(e) => setNewLead(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Customer wants matte black, full body..." className="h-9 text-sm border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                </div>
                <button
                  onClick={handleCreateLead}
                  disabled={creatingLead}
                  className="h-10 text-sm font-semibold text-white rounded-lg mt-1"
                  style={{ background: "linear-gradient(135deg, #0891b2, #2563eb)" }}
                >
                  {creatingLead ? "Creating..." : "Create Lead"}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <button
            onClick={refetchAll}
            className="h-9 px-4 text-sm font-semibold text-gray-300 bg-transparent border border-gray-600 rounded-lg flex items-center gap-1.5 hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5">

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {[
            { label: "New Quotes", value: pipelineStats.new, color: "#0891b2", highlight: pipelineStats.new > 0, borderColor: "#0891b2" },
            { label: "Email Sent", value: pipelineStats.emailed, color: "#111" },
            { label: "Callbacks Today", value: pipelineStats.callback, color: "#111" },
            { label: "Overdue", value: overdueCount, color: overdueCount > 0 ? "#dc2626" : "#111", bgColor: overdueCount > 0 ? "#fef2f2" : undefined },
            { label: "QuikText", value: pipelineStats.quiktext, color: pipelineStats.quiktext > 0 ? "#0891b2" : "#111", bgColor: pipelineStats.quiktext > 0 ? "#f0fdfa" : undefined },
            { label: "Total Contacted", value: pipelineStats.contacted, color: "#16a34a" },
          ].map(({ label, value, color, highlight, borderColor, bgColor }) => (
            <div key={label} className={cn(
              "bg-white rounded-xl p-3.5",
              highlight ? "border-2" : "border border-[#e5e7eb]"
            )} style={{
              borderColor: highlight ? borderColor : undefined,
              backgroundColor: bgColor,
            }}>
              <p className="text-2xl sm:text-3xl font-bold" style={{ color }}>{value}</p>
              <p className="text-xs text-[#6b7280] mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Search + Filters Row ── */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative flex-1 max-w-[360px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
            <Input
              placeholder="Search by name, email, vehicle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 bg-white border-[#e5e7eb] rounded-lg text-sm text-[#111]"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-9 w-[150px] text-sm border-[#e5e7eb] rounded-lg bg-white text-[#374151]">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="tool">Brought by tool (self-serve)</SelectItem>
              <SelectItem value="manual">Entered manually</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="voicemail">Voicemail</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(v: any) => setSortOrder(v)}>
            <SelectTrigger className="h-9 w-[150px] text-sm border-[#e5e7eb] rounded-lg bg-white text-[#374151]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Date (Newest)</SelectItem>
              <SelectItem value="oldest">Date (Oldest)</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setViewMode(viewMode === "card" ? "table" : "card")}
            className="h-9 w-9 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:text-[#111] hover:bg-gray-50"
            title={viewMode === "card" ? "Switch to table view" : "Switch to card view"}
          >
            {viewMode === "card" ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
          </button>
        </div>

        {/* ── Pipeline Tabs ── */}
        <div className="flex gap-0 mb-5 border-b-2 border-[#e5e7eb] overflow-x-auto">
          {[
            { key: "all", label: "New Quotes", count: pipelineStats.new },
            { key: "quoted", label: "Email Sent", count: pipelineStats.emailed },
            { key: "contacted", label: "Call Back Later", count: pipelineStats.callback, badge: overdueCount > 0 },
            { key: "booked", label: "Completed", count: pipelineStats.completed },
            { key: "lost", label: "Converted", count: pipelineStats.converted, accent: true },
            { key: "hot_texts", label: "QuikText", count: pipelineStats.quiktext, hot: true },
            { key: "quotetool_selfserve", label: "QuoteTool (Self-Serve)", selfserve: true },
            { key: "saved_quotes", label: "Saved Quotes (Staff)" },
            { key: "appointments", label: "Appointments (Self-Serve)" },
            { key: "revenue", label: "Revenue", icon: true },
          ].map(({ key, label, count, accent, badge, icon, hot, selfserve }: any) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  "px-4 sm:px-5 py-2.5 text-sm font-medium whitespace-nowrap -mb-[2px] transition-all border-b-2 flex items-center gap-1.5",
                  active ? "border-[#0891b2] text-[#111] font-semibold" : "border-transparent text-[#6b7280] hover:text-[#374151]",
                  accent && !active && "text-[#16a34a]",
                  hot && !active && "text-[#dc2626]",
                  selfserve && !active && "text-[#0891b2]",
                )}
              >
                {icon && <BarChart3 className="w-4 h-4" />}
                {label}
                {count !== undefined && <span className="text-xs">({count})</span>}
                {badge && <span className="ml-1 w-2 h-2 rounded-full bg-[#dc2626] inline-block" />}
              </button>
            );
          })}
        </div>
        </div>{/* end max-w inside sticky */}
      </div>{/* end sticky wrapper */}

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pb-5">

        {/* ── QuoteTool Self-Serve Tab (from public.customer_quotes) ── */}
        {/* Customers self-quoting via the public QuoteTool. Separate stream
            from staff-entered quotes — own analytics tiles. */}
        {statusFilter === "quotetool_selfserve" && (
          <QuoteToolSelfServeTable />
        )}

        {/* ── Saved Quotes Tab (from public.quotes) ── */}
        {/* Staff-entered internal quotes. Distinct from customer self-serve. */}
        {statusFilter === "saved_quotes" && (
          <div className="pt-2">
            <SavedQuotesTable />
          </div>
        )}

        {/* ── Appointments Tab (BookingPro self-serve receipts) ── */}
        {statusFilter === "appointments" && (
          <div className="pt-2">
            <AppointmentsTab />
          </div>
        )}

        {/* ── Hot Texts Tab Content ── */}
        {statusFilter === "hot_texts" && (
          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "QuikTexts Sent", value: leadStats.quiktext, color: "#0891b2" },
                { label: "Auto-Texted", value: leadStats.autoTexted, color: "#16a34a" },
                { label: "Avg Score", value: leads?.filter((l: any) => l.lead_score > 0).length ? Math.round((leads?.filter((l: any) => l.lead_score > 0).reduce((s: number, l: any) => s + (l.lead_score || 0), 0) || 0) / (leads?.filter((l: any) => l.lead_score > 0).length || 1)) : 0, color: "#111" },
                { label: "Conversion Rate", value: `${leadStats.quiktext > 0 ? Math.round(((leads?.filter((l: any) => l.is_hot && (l.status === "booked" || l.status === "quoted")).length || 0) / leadStats.quiktext) * 100) : 0}%`, color: "#0891b2" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-[#e5e7eb] p-3.5">
                  <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-[#6b7280] mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Hot texts log */}
            <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
              <div className="px-4 py-3 bg-[#f0fdfa] border-b border-[#e5e7eb] flex items-center gap-2">
                <span className="text-sm font-bold text-[#0891b2]">QuikText History</span>
                <span className="text-[10px] text-[#9ca3af]">Auto-texts sent to callers who mentioned a quote, rush, or problem</span>
              </div>
              <div className="divide-y divide-[#e5e7eb]">
                {(() => {
                  // Pull hot rows from the unified feed so QuikTexts sent via
                  // the row icon (on quotes) also land in this history tab.
                  const hotLeads = (pipelineRows || [])
                    .filter((l: any) => l.is_hot || l.auto_texted_at)
                    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                  if (hotLeads.length === 0) {
                    return (
                      <div className="text-center py-12">
                        <p className="text-sm text-[#9ca3af]">No QuikTexts yet</p>
                        <p className="text-xs text-[#d1d5db] mt-1">When a caller mentions a quote, rush, or problem — they'll auto-text and appear here</p>
                      </div>
                    );
                  }
                  return hotLeads.map((lead: any) => {
                    const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
                    const meta = (lead.metadata || {}) as any;
                    const dateStr = lead.created_at ? new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
                    const autoTextDate = lead.auto_texted_at ? new Date(lead.auto_texted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
                    return (
                      <div key={lead.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-[#fafafa]">
                        {/* Score badge */}
                        <div className="flex-shrink-0">
                          <span className={cn(
                            "inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold",
                            lead.is_hot ? "bg-cyan-100 text-cyan-700" : "bg-gray-100 text-[#6b7280]"
                          )}>
                            {(lead.metadata as any)?.quicktext_reason === "rush" ? "!" : (lead.metadata as any)?.quicktext_reason === "problem" ? "?" : "Q"}
                          </span>
                        </div>
                        {/* Customer + vehicle */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-[#111]">{lead.caller_name || "Unknown"}</p>
                            {lead.auto_texted_at && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">Auto-Texted</span>}
                            {!lead.auto_texted_at && lead.is_hot && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200">QuikText Pending</span>}
                          </div>
                          <p className="text-xs text-[#6b7280] mt-0.5">{vehicle || "No vehicle"} {lead.service_requested ? `· ${lead.service_requested}` : ""}</p>
                          {lead.caller_phone && <a href={`tel:${lead.caller_phone}`} className="text-xs text-[#0891b2] hover:underline">{lead.caller_phone}</a>}
                        </div>
                        {/* Text preview */}
                        <div className="flex-1 min-w-0 max-w-xs">
                          {lead.auto_texted_at ? (
                            <div className="bg-[#f0fdfa] border border-[#ccfbf1] rounded-lg px-3 py-2">
                              <p className="text-[10px] text-[#0891b2] font-semibold mb-0.5">Sent {autoTextDate}</p>
                              <p className="text-[11px] text-[#374151] line-clamp-2">
                                "Hey {lead.caller_name || "there"}! Your instant wrap estimate for the {vehicle} is ready..."
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-[#9ca3af] italic">Awaiting shop review</p>
                          )}
                        </div>
                        {/* Status + actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={cn(
                            "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                            lead.status === "booked" && "bg-green-50 text-green-700",
                            lead.status === "quoted" && "bg-blue-50 text-blue-700",
                            lead.status === "contacted" && "bg-yellow-50 text-yellow-700",
                            lead.status === "new" && "bg-gray-50 text-[#6b7280]",
                            lead.status === "lost" && "bg-red-50 text-red-600",
                          )}>
                            {lead.status}
                          </span>
                          <button
                            onClick={() => {
                              const quoteUrl = lead.quote_url || `${window.location.origin}/quick-quote?make=${encodeURIComponent(lead.vehicle_make || "")}&model=${encodeURIComponent(lead.vehicle_model || "")}`;
                              window.open(quoteUrl, "_blank");
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-[#0891b2] text-white hover:bg-[#0e7490]"
                            title="View Quote"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Revenue Tab Content ── */}
        {statusFilter === "revenue" && <RevenueTab />}

        {/* ── Lead Cards / Table ── */}
        {statusFilter !== "revenue" && statusFilter !== "saved_quotes" && statusFilter !== "hot_texts" && statusFilter !== "quotetool_selfserve" && statusFilter !== "appointments" && (
          <>
            {/* TABLE VIEW — matches WePrintWraps quote manager layout */}
            {viewMode === "table" && (
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f0fdfa] border-b border-[#e5e7eb]">
                        <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Quote #</th>
                        <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Date</th>
                        <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Customer</th>
                        <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Request</th>
                        <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Est. Price</th>
                        <th className="text-right px-4 py-3 font-semibold text-[#6b7280] text-xs whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leadsLoading || pipelineQuotesLoading) ? (
                        <tr><td colSpan={6} className="text-center py-12 text-[#9ca3af]">Loading leads...</td></tr>
                      ) : displayLeads.length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-12 text-[#9ca3af]">No matching leads</td></tr>
                      ) : (
                        displayLeads.map((lead: any) => {
                          const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
                          const meta = (lead.metadata || {}) as any;
                          const dateObj = lead.created_at ? new Date(lead.created_at) : null;
                          const dateStr = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                          const timeStr = dateObj ? dateObj.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
                          const customerEmail = meta.email || customerEmailInput[lead.id] || "";
                          const location = meta.location || "";
                          const manufacturer = meta.manufacturer || "";
                          const sqFt = meta.sqFt || 0;
                          const totalEstimate = meta.totalEstimate || 0;
                          const hasPrice = totalEstimate > 0;

                          return (
                            <tr key={lead.id} className="border-b border-[#e5e7eb] hover:bg-[#f9fafb] transition-colors align-top">
                              {/* Quote # */}
                              <td className="px-4 py-4">
                                <span className="font-mono text-xs font-bold text-[#374151] leading-tight block">
                                  {(lead.quote_id || (lead.id ? lead.id.slice(0, 8).toUpperCase() : "—")).split("-").map((part: string, i: number) => (
                                    <span key={i}>{i > 0 && <br />}{i > 0 ? part : `${part}-`}</span>
                                  ))}
                                </span>
                              </td>

                              {/* Date */}
                              <td className="px-4 py-4">
                                <p className="text-xs font-medium text-[#374151]">{dateStr},</p>
                                <p className="text-xs text-[#9ca3af]">{timeStr}</p>
                              </td>

                              {/* Customer — name, QuikText badge, email, phone, location */}
                              <td className="px-4 py-4 min-w-[220px]">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-bold text-[#111]">{lead.caller_name || "Unknown"}</p>
                                  {lead.is_hot && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200">
                                      QuikText
                                    </span>
                                  )}
                                </div>
                                {customerEmail && (
                                  <a href={`mailto:${customerEmail}`} className="text-xs text-[#0891b2] hover:underline block mt-0.5">{customerEmail}</a>
                                )}
                                {lead.caller_phone && (
                                  <a href={`tel:${lead.caller_phone}`} className="text-xs text-[#0891b2] hover:underline block mt-0.5">
                                    <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.caller_phone}</span>
                                  </a>
                                )}
                                {location && (
                                  <p className="text-[10px] text-[#9ca3af] mt-1 flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> {location}
                                  </p>
                                )}
                                {lead.auto_texted_at && (
                                  <p className="text-[9px] text-[#16a34a] mt-0.5 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Auto-texted
                                  </p>
                                )}
                                {lead.voicemail_recording_url && (
                                  <button
                                    onClick={() => {
                                      const audio = new Audio(lead.voicemail_recording_url);
                                      audio.play();
                                    }}
                                    className="mt-1 flex items-center gap-1 text-[9px] font-semibold text-[#6b7280] hover:text-[#111] transition-colors"
                                    title="Play voicemail"
                                  >
                                    <Play className="w-3 h-3 fill-current" /> Play VM
                                  </button>
                                )}
                              </td>

                              {/* Request — vehicle, manufacturer, sqft */}
                              <td className="px-4 py-4">
                                {vehicle && <p className="text-sm font-bold text-[#111]">{vehicle}</p>}
                                <p className="text-xs text-[#6b7280] mt-0.5">
                                  {manufacturer || "—"} {sqFt > 0 ? `· ${sqFt} sqft` : ""}
                                </p>
                              </td>

                              {/* Est. Price + retarget tier badge */}
                              <td className="px-4 py-4">
                                {hasPrice ? (
                                  <span className="text-base font-bold text-[#111]">${Number(totalEstimate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                ) : (
                                  <span className="text-xs font-bold text-[#dc2626]">Needs<br />Quote</span>
                                )}
                                {lead.created_at && lead.status !== "booked" && lead.status !== "lost" && lead.status !== "completed" && lead.status !== "converted" && (() => {
                                  const tier = getRetargetTier(lead.created_at);
                                  if (tier === "too_early" || tier === "expired") return null;
                                  return (
                                    <span className={cn(
                                      "block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full w-fit",
                                      tier === "3day" && "bg-blue-50 text-blue-600 border border-blue-200",
                                      tier === "7day" && "bg-purple-50 text-purple-600 border border-purple-200",
                                    )}>
                                      {tier === "3day" ? "3-Day Due" : "7-Day Due"}
                                    </span>
                                  );
                                })()}
                              </td>

                              {/* Actions — icon strip. Quote-sourced rows get
                                  MightyMail retarget + QuikText. Lead-sourced
                                  rows keep the existing SMS-template retarget +
                                  QuikText Approve page. */}
                              <td className="px-4 py-4">
                                <div className="flex items-center justify-end gap-1">
                                  {/* 1. Email quote (both sources) */}
                                  <button
                                    onClick={() => {
                                      if (customerEmail) {
                                        setCustomerEmailInput(prev => ({ ...prev, [lead.id]: customerEmail }));
                                        handleSendQuote(lead);
                                      } else {
                                        const email = prompt("Enter customer email:");
                                        if (email) {
                                          setCustomerEmailInput(prev => ({ ...prev, [lead.id]: email }));
                                          setTimeout(() => handleSendQuote(lead), 100);
                                        }
                                      }
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-md border border-[#e5e7eb] text-[#9ca3af] hover:text-[#111] hover:bg-gray-50 transition-colors"
                                    title="Email Quote"
                                  >
                                    <Mail className="w-4 h-4" />
                                  </button>

                                  {/* 2. QuikText SMS — routes through handleQuikTextForRow
                                      for both quotes and leads. Stamps
                                      metadata.quiktext_sent_at so the QuikText
                                      counter increments. */}
                                  <button
                                    onClick={() => { if (lead.caller_phone) handleQuikTextForRow(lead); }}
                                    disabled={retargetingId === lead.id || !lead.caller_phone}
                                    className={cn(
                                      "w-8 h-8 flex items-center justify-center rounded-md border transition-colors",
                                      retargetingId === lead.id
                                        ? "border-[#0891b2] text-[#0891b2] bg-cyan-50"
                                        : "border-[#e5e7eb] text-[#9ca3af] hover:text-[#0891b2] hover:bg-cyan-50 disabled:opacity-40",
                                    )}
                                    title="Send QuikText (SMS)"
                                  >
                                    <MessageSquare className={cn("w-4 h-4", retargetingId === lead.id && "animate-pulse")} />
                                  </button>

                                  {/* 3. Mark Complete (job finished) */}
                                  <button
                                    onClick={() => {
                                      const done = isCompletedRow(lead);
                                      if (lead.__source === "quote") {
                                        updateRowStatus(lead, done ? "quoted" : "completed");
                                      } else {
                                        updateRowStatus(lead, done ? "new" : "booked");
                                      }
                                    }}
                                    className={cn(
                                      "w-8 h-8 flex items-center justify-center rounded-md border transition-colors",
                                      isCompletedRow(lead)
                                        ? "border-[#16a34a] text-[#16a34a] bg-green-50"
                                        : "border-[#e5e7eb] text-[#9ca3af] hover:text-[#16a34a] hover:bg-green-50"
                                    )}
                                    title={isCompletedRow(lead) ? "Completed — click to revert" : "Mark Job Complete"}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>

                                  {/* 3b. Convert to Order (quotes only) */}
                                  {lead.__source === "quote" && (
                                    <button
                                      onClick={() => updateRowStatus(lead, isConvertedRow(lead) ? "quoted" : "converted")}
                                      className={cn(
                                        "w-8 h-8 flex items-center justify-center rounded-md border transition-colors",
                                        isConvertedRow(lead)
                                          ? "border-[#0891b2] text-[#0891b2] bg-cyan-50"
                                          : "border-[#e5e7eb] text-[#9ca3af] hover:text-[#0891b2] hover:bg-cyan-50"
                                      )}
                                      title={isConvertedRow(lead) ? "Order — click to revert" : "Convert to Order (customer accepted)"}
                                    >
                                      <Package className="w-4 h-4" />
                                    </button>
                                  )}

                                  {/* 4. Call customer */}
                                  <a
                                    href={lead.caller_phone ? `tel:${lead.caller_phone}` : "#"}
                                    onClick={(e) => {
                                      if (!lead.caller_phone) e.preventDefault();
                                      else updateRowStatus(lead, lead.__source === "quote" ? "contacted" : "contacted");
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-md border border-[#e5e7eb] text-[#16a34a] hover:bg-green-50 transition-colors"
                                    title="Call Customer"
                                  >
                                    <Phone className="w-4 h-4" />
                                  </a>

                                  {/* 5. Copy phone */}
                                  <button
                                    onClick={() => {
                                      if (lead.caller_phone) {
                                        navigator.clipboard.writeText(lead.caller_phone);
                                        toast.success(`Copied ${lead.caller_phone}`);
                                      }
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-md border border-[#e5e7eb] text-[#16a34a] hover:bg-green-50 transition-colors"
                                    title="Copy Phone Number"
                                  >
                                    <PhoneIncoming className="w-4 h-4" />
                                  </button>

                                  {/* 6. Retarget — branch on source. Quotes:
                                      MightyMail scheduled_emails (3/5/7-day).
                                      Leads: SMS template picker (legacy). */}
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        disabled={retargetingId === lead.id}
                                        className={cn(
                                          "w-8 h-8 flex items-center justify-center rounded-md border transition-colors",
                                          retargetingId === lead.id
                                            ? "border-[#f59e0b] text-[#f59e0b] bg-amber-50"
                                            : "border-[#e5e7eb] text-[#f59e0b] hover:bg-amber-50"
                                        )}
                                        title="Retarget — MightyMail follow-up"
                                      >
                                        <RefreshCw className={cn("w-4 h-4", retargetingId === lead.id && "animate-spin")} />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-72 p-0 bg-white border border-[#e5e7eb] shadow-lg rounded-xl" sideOffset={4}>
                                      {lead.__source === "quote" ? (
                                        <div className="max-h-80 overflow-y-auto">
                                          <div className="px-3 py-2 border-b border-[#e5e7eb] bg-[#f9fafb] rounded-t-xl sticky top-0">
                                            <p className="text-xs font-bold text-[#111]">MightyMail Retarget</p>
                                            <p className="text-[10px] text-[#9ca3af]">Queues a scheduled follow-up email to the customer</p>
                                          </div>
                                          <div className="p-1.5 space-y-1">
                                            {[3, 5, 7].map((d) => (
                                              <button
                                                key={d}
                                                onClick={() => handleScheduleQuoteRetarget(lead, d)}
                                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#f0fdfa] transition-colors flex items-center gap-2"
                                              >
                                                <span className="text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 bg-blue-50 text-blue-700">EMAIL</span>
                                                <p className="text-[11px] font-semibold text-[#111]">Schedule {d}-day follow-up</p>
                                              </button>
                                            ))}
                                            <button
                                              onClick={() => handleQuikTextForRow(lead)}
                                              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#f0fdfa] transition-colors flex items-center gap-2 border-t border-[#e5e7eb] mt-1 pt-2"
                                            >
                                              <span className="text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 bg-green-50 text-green-700">SMS</span>
                                              <p className="text-[11px] font-semibold text-[#111]">Send QuikText now</p>
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        (() => {
                                          const tier = lead.created_at ? getRetargetTier(lead.created_at) : "3day";
                                          const allTiers: { key: RetargetTier; label: string }[] = [
                                            { key: tier === "7day" ? "7day" : "3day", label: getRetargetLabel(tier as any) },
                                            { key: "seasonal", label: "Seasonal" },
                                            { key: "sale", label: "Sale / Promo" },
                                            { key: "educational", label: "Educational" },
                                            { key: "review", label: "Review Request" },
                                            { key: "referral", label: "Referral" },
                                          ];
                                          return (
                                            <div className="max-h-80 overflow-y-auto">
                                              <div className="px-3 py-2 border-b border-[#e5e7eb] bg-[#f9fafb] rounded-t-xl sticky top-0">
                                                <p className="text-xs font-bold text-[#111]">Retarget: Pick a template</p>
                                                <p className="text-[10px] text-[#9ca3af]">Auto-detected: {getRetargetLabel(tier as any)}</p>
                                              </div>
                                              <div className="p-1.5">
                                                {allTiers.map(({ key, label }) => {
                                                  const templates = editableTemplates.filter(t => t.tier === key);
                                                  if (templates.length === 0) return null;
                                                  return (
                                                    <div key={key}>
                                                      <p className="text-[9px] font-bold text-[#9ca3af] uppercase tracking-wider px-2 py-1 mt-1">{label}</p>
                                                      {templates.map((t) => (
                                                        <button
                                                          key={t.id}
                                                          onClick={() => handleRetargetWithTemplate(lead, t)}
                                                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#f0fdfa] transition-colors flex items-center gap-2"
                                                        >
                                                          <span className={cn(
                                                            "text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0",
                                                            t.channel === "sms" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"
                                                          )}>{t.channel.toUpperCase()}</span>
                                                          <div className="min-w-0">
                                                            <p className="text-[11px] font-semibold text-[#111]">{t.label}</p>
                                                          </div>
                                                        </button>
                                                      ))}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          );
                                        })()
                                      )}
                                    </PopoverContent>
                                  </Popover>

                                  {/* 7. QuikText Approve (lead rows only —
                                      the approve page reads from leads). */}
                                  {lead.__source === "lead" && (
                                    <button
                                      onClick={() => {
                                        window.open(`${window.location.origin}/quiktext-approve?id=${lead.id}`, "_blank");
                                      }}
                                      className="w-8 h-8 flex items-center justify-center rounded-md text-white hover:opacity-90 transition-colors"
                                      style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
                                      title="QuikText Approve — edit price & send"
                                    >
                                      <Send className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CARD VIEW */}
            {viewMode === "card" && (
              <div className="flex flex-col gap-3">
                {(leadsLoading || pipelineQuotesLoading) ? (
                  <p className="text-center py-12 text-[#9ca3af] text-sm">Loading leads...</p>
                ) : displayLeads.length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-xl border border-[#e5e7eb]">
                    <PhoneIncoming className="w-9 h-9 text-[#d1d5db] mx-auto mb-3" />
                    <p className="text-sm font-medium text-[#6b7280]">{searchQuery || statusFilter !== "all" ? "No matching leads" : "No leads yet"}</p>
                    <p className="text-xs text-[#9ca3af] mt-1">Leads auto-populate from missed calls and voicemails</p>
                  </div>
                ) : (
                  displayLeads.map((lead: any) => {
                    const isNew = lead.status === "new";
                    const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
                    const dateStr = lead.created_at ? new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

                    return (
                      <div key={lead.id} className="bg-white border border-[#e5e7eb] rounded-xl px-4 sm:px-6 py-4 hover:shadow-sm transition-shadow">
                        {/* Top row: Quote ID + badge + actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#111]">{lead.quote_id || lead.id?.slice(0, 8).toUpperCase()}</span>
                            {lead.service_requested && (
                              <span className="bg-[#f3f4f6] border border-[#e5e7eb] rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[#374151]">
                                {lead.service_requested}
                              </span>
                            )}
                            {isNew && (
                              <span className="bg-[#fef2f2] text-[#dc2626] rounded-full px-2.5 py-0.5 text-[11px] font-semibold">New</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {!lead.quote_sent_at && lead.status !== "booked" && lead.status !== "lost" ? (
                              <>
                                <Input
                                  placeholder="Email"
                                  value={customerEmailInput[lead.id] || ""}
                                  onChange={(e) => setCustomerEmailInput(prev => ({ ...prev, [lead.id]: e.target.value }))}
                                  className="h-8 text-xs w-40 bg-white border-[#e5e7eb] rounded-md text-[#111]"
                                  type="email"
                                />
                                <button
                                  onClick={() => handleSendQuote(lead)}
                                  disabled={sendingQuoteId === lead.id}
                                  className="h-8 px-3 text-xs font-semibold bg-white border border-[#e5e7eb] rounded-md text-[#374151] hover:bg-gray-50 flex items-center gap-1"
                                >
                                  <Mail className="w-3.5 h-3.5" /> Email
                                </button>
                                <button
                                  onClick={() => handleSendQuote(lead)}
                                  disabled={sendingQuoteId === lead.id}
                                  className="h-8 px-3 text-xs font-semibold text-white rounded-md flex items-center gap-1"
                                  style={{ background: "linear-gradient(135deg, #0891b2, #2563eb)" }}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {sendingQuoteId === lead.id ? "Sending..." : "Mark Completed"}
                                </button>
                              </>
                            ) : (
                              <div className="flex gap-1.5 items-center">
                                {lead.sms_sent_to_customer && <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />}
                                {lead.email_sent_to_customer && <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />}
                                {lead.quote_url && (
                                  <a href={lead.quote_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[#0891b2] hover:underline">View Quote</a>
                                )}
                              </div>
                            )}
                            {(lead.status === "quoted" || lead.status === "contacted") && lead.caller_phone && (
                              <button
                                onClick={() => handleRetarget(lead.caller_phone, lead.caller_name, vehicle, lead.id)}
                                disabled={retargetingId === lead.id}
                                className="h-8 w-8 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-md text-[#6b7280] hover:bg-orange-50 hover:text-orange-600"
                              >
                                <RefreshCw className={cn("w-3.5 h-3.5", retargetingId === lead.id && "animate-spin")} />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-[#9ca3af] mb-3">Submitted {dateStr}</p>

                        {/* Content: Contact + Project Details side by side */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                          {/* Contact Info */}
                          <div>
                            <p className="text-xs font-semibold text-[#6b7280] mb-2 flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5" /> Contact Information
                            </p>
                            <p className="text-sm font-semibold text-[#111] mb-1">Name: {lead.caller_name || "Unknown"}</p>
                            {lead.caller_phone && (
                              <a href={`tel:${lead.caller_phone}`} className="text-sm text-[#0891b2] hover:underline block mb-1">
                                {lead.caller_phone}
                              </a>
                            )}
                          </div>

                          {/* Project Details */}
                          <div>
                            <p className="text-xs font-semibold text-[#6b7280] mb-2 flex items-center gap-1.5">
                              <Car className="w-3.5 h-3.5" /> Project Details
                            </p>
                            {vehicle && <p className="text-sm text-[#111] mb-1">Vehicle: <strong>{vehicle}</strong></p>}
                            {lead.service_requested && <p className="text-sm text-[#374151] mb-1">Wrap Type: <strong>{lead.service_requested}</strong></p>}
                          </div>
                        </div>

                        {/* Notes */}
                        {lead.voicemail_transcript && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-[#6b7280] mb-1.5 flex items-center gap-1.5">
                              <MessageSquare className="w-3.5 h-3.5" /> Notes
                            </p>
                            <div className="bg-[#f3f4f6] rounded-lg px-3.5 py-2.5 text-sm text-[#374151] italic">
                              {lead.voicemail_transcript}
                            </div>
                          </div>
                        )}

                        {/* Status */}
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-[11px] text-[#9ca3af]">Status:</span>
                          <Select value={lead.status} onValueChange={(val) => updateRowStatus(lead, val)}>
                            <SelectTrigger className="h-7 w-[140px] text-xs border-[#e5e7eb] rounded-md bg-white text-[#374151]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {lead.__source === "quote" ? (
                                <>
                                  <SelectItem value="quoted" className="text-xs">Quoted</SelectItem>
                                  <SelectItem value="contacted" className="text-xs">Contacted</SelectItem>
                                  <SelectItem value="converted" className="text-xs">Converted (Order)</SelectItem>
                                  <SelectItem value="completed" className="text-xs">Completed (Job Done)</SelectItem>
                                </>
                              ) : (
                                <>
                                  <SelectItem value="new" className="text-xs">New</SelectItem>
                                  <SelectItem value="contacted" className="text-xs">Contacted</SelectItem>
                                  <SelectItem value="quoted" className="text-xs">Quoted</SelectItem>
                                  <SelectItem value="booked" className="text-xs">Booked</SelectItem>
                                  <SelectItem value="lost" className="text-xs">Lost</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}

        {/* ── Retarget Templates Manager ── */}
        <div className="mt-8">
          <Collapsible open={retargetTemplatesOpen} onOpenChange={setRetargetTemplatesOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-white border border-[#e5e7eb] rounded-xl cursor-pointer text-sm text-[#6b7280] hover:bg-gray-50">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-[#f59e0b]" /> Retarget Templates (3-Day & 7-Day)
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", retargetTemplatesOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-3">
                {/* ── Tone / Style Picker ── */}
                <div className="bg-white border border-[#e5e7eb] rounded-lg p-4">
                  <p className="text-sm font-bold text-[#111] mb-1">Shop Voice & Tone</p>
                  <p className="text-[10px] text-[#9ca3af] mb-3">Sets the personality for all outgoing messages</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(Object.values(TONE_PRESETS) as { id: ToneStyle; label: string; description: string }[]).map((tone) => (
                      <button
                        key={tone.id}
                        onClick={() => {
                          setShopTone(tone.id);
                          // Save to shop_settings
                          supabase.from("shop_settings").upsert({ id: "default", tone_style: tone.id } as any);
                        }}
                        className={cn(
                          "px-3 py-2.5 rounded-lg border text-left transition-all",
                          shopTone === tone.id
                            ? "bg-[#0891b2]/10 border-[#0891b2] text-[#0891b2]"
                            : "bg-[#f9fafb] border-[#e5e7eb] text-[#374151] hover:border-[#0891b2]/30"
                        )}
                      >
                        <p className="text-xs font-bold">{tone.label}</p>
                        <p className="text-[9px] text-[#9ca3af] mt-0.5">{tone.description}</p>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 bg-[#f9fafb] rounded-lg px-3 py-2 border border-[#e5e7eb]">
                    <p className="text-[9px] text-[#9ca3af] mb-1">Preview</p>
                    <p className="text-xs text-[#374151]">{TONE_PRESETS[shopTone].greeting("Marcus")} Your 2024 BMW M4 wrap estimate is ready. {TONE_PRESETS[shopTone].cta}: https://... {TONE_PRESETS[shopTone].signoff(shopName || "Your Shop")}</p>
                  </div>
                </div>

                {/* All template tiers — rendered dynamically */}
                {([
                  { tier: "3day" as const, label: "3-Day Follow-up", sub: "Sent 3 days after quote", dot: "bg-blue-500" },
                  { tier: "7day" as const, label: "7-Day Re-engagement", sub: "Sent 7 days after quote", dot: "bg-purple-500" },
                  { tier: "seasonal" as const, label: "Seasonal Campaigns", sub: "Holiday & season promos", dot: "bg-orange-500" },
                  { tier: "sale" as const, label: "Sales & Promos", sub: "Flash sales, bundles, referrals", dot: "bg-emerald-500" },
                  { tier: "educational" as const, label: "Educational", sub: "Wrap care, value, tips", dot: "bg-cyan-500" },
                  { tier: "review" as const, label: "Review Requests", sub: "Google/Yelp reviews after job", dot: "bg-yellow-500" },
                  { tier: "referral" as const, label: "Referral Program", sub: "Refer friends, earn discounts", dot: "bg-pink-500" },
                ] as const).map(({ tier: tierKey, label: tierLabel, sub, dot }) => {
                  const tierTemplates = editableTemplates.filter(t => t.tier === tierKey);
                  if (tierTemplates.length === 0) return null;
                  return (
                    <div key={tierKey}>
                      <h3 className="text-sm font-bold text-[#111] mb-2 flex items-center gap-2">
                        <span className={cn("w-2 h-2 rounded-full", dot)} />
                        {tierLabel}
                        <span className="text-[10px] text-[#9ca3af] font-normal">{sub}</span>
                      </h3>
                      <div className="space-y-2">
                        {tierTemplates.map((template) => {
                          const isEditing = editingTemplateId === template.id;
                          const isPreviewing = previewTemplateId === template.id;
                          return (
                            <div key={template.id} className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-2.5 bg-[#f9fafb]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                    template.channel === "sms" ? "bg-green-50 text-green-700 border border-green-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                                  )}>
                                    {template.channel.toUpperCase()}
                                  </span>
                                  <span className="text-sm font-semibold text-[#111]">{template.label}</span>
                                  <span className="text-[10px] text-[#9ca3af] hidden sm:inline">{template.description}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setPreviewTemplateId(isPreviewing ? null : template.id)}
                                    className="text-[10px] px-2 py-1 rounded border border-[#e5e7eb] text-[#6b7280] hover:bg-gray-50"
                                  >
                                    {isPreviewing ? "Hide" : "Preview"}
                                  </button>
                                  <button
                                    onClick={() => setEditingTemplateId(isEditing ? null : template.id)}
                                    className="text-[10px] px-2 py-1 rounded border border-[#e5e7eb] text-[#0891b2] hover:bg-cyan-50"
                                  >
                                    {isEditing ? "Done" : "Edit"}
                                  </button>
                                </div>
                              </div>
                              {isPreviewing && (
                                <div className="px-4 py-3 bg-[#f0fdfa] border-t border-[#e5e7eb]">
                                  {template.subject && <p className="text-xs font-semibold text-[#111] mb-1">Subject: {mergeTemplate(template.subject, { name: "Marcus", vehicle: "2024 BMW M4", shop: shopName || "Your Shop", price: "$2,373.00", quote_url: "https://..." })}</p>}
                                  <p className="text-xs text-[#374151] whitespace-pre-wrap">{mergeTemplate(template.body, { name: "Marcus", vehicle: "2024 BMW M4", shop: shopName || "Your Shop", price: "$2,373.00", quote_url: "https://restylepro.ai/quick-quote?..." })}</p>
                                </div>
                              )}
                              {isEditing && (
                                <div className="px-4 py-3 border-t border-[#e5e7eb] space-y-2">
                                  {template.channel === "email" && (
                                    <div>
                                      <Label className="text-[10px] text-[#6b7280]">Subject Line</Label>
                                      <Input
                                        value={template.subject || ""}
                                        onChange={(e) => updateTemplate(template.id, { subject: e.target.value })}
                                        className="h-8 text-xs border-[#e5e7eb] bg-white text-[#111]"
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <Label className="text-[10px] text-[#6b7280]">Message Body</Label>
                                    <textarea
                                      value={template.body}
                                      onChange={(e) => updateTemplate(template.id, { body: e.target.value })}
                                      rows={template.channel === "email" ? 6 : 3}
                                      className="w-full text-xs border border-[#e5e7eb] rounded-md bg-white text-[#111] px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-[#0891b2]"
                                    />
                                  </div>
                                  <p className="text-[9px] text-[#9ca3af]">Merge fields: {"{name}"} {"{vehicle}"} {"{shop}"} {"{quote_url}"} {"{price}"} {"{shop_logo}"} {"{review_url}"}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Save button */}
                <div className="flex items-center justify-between bg-white border border-[#e5e7eb] rounded-lg px-4 py-3">
                  <p className="text-xs text-[#9ca3af]">
                    {templatesDirty ? "You have unsaved changes" : "All templates saved"}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate("/admin/email-editor")}
                      className="h-9 px-4 text-sm font-semibold text-[#6b7280] bg-white border border-[#e5e7eb] rounded-lg flex items-center gap-1.5 hover:bg-gray-50"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email Editor
                    </button>
                    <button
                      onClick={handleSaveTemplates}
                      disabled={savingTemplates || !templatesDirty}
                      className={cn(
                        "h-9 px-5 text-sm font-semibold rounded-lg flex items-center gap-1.5 transition-all",
                        templatesDirty
                          ? "text-white"
                          : "bg-[#f3f4f6] text-[#9ca3af] cursor-default"
                      )}
                      style={templatesDirty ? { background: "linear-gradient(135deg, #0891b2, #2563eb)" } : undefined}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingTemplates ? "Saving..." : "Save Templates"}
                    </button>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* ── Settings (Collapsible) ── */}
        <div className="mt-3">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-white border border-[#e5e7eb] rounded-xl cursor-pointer text-sm text-[#6b7280] hover:bg-gray-50">
                <span className="flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Pricing & Shop Settings
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", settingsOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-[#111] mb-3 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-[#16a34a]" /> Film Prices ($/yard)
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(filmPrices).map(([finish, price]) => (
                      <div key={finish}>
                        <Label className="text-[10px] text-[#9ca3af] capitalize">{finish.replace(/_/g, " ")}</Label>
                        <Input type="number" value={price}
                          onChange={(e) => setFilmPrices((p) => ({ ...p, [finish]: parseFloat(e.target.value) || 0 }))}
                          className="h-8 text-xs border-[#e5e7eb] rounded-md bg-white text-[#111]" step="1" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-[#111] mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#3b82f6]" /> Labor Rates ($/sq ft)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(laborRates) as PriceRegion[]).map((region) => (
                      <div key={region}>
                        <Label className="text-[10px] text-[#9ca3af]">{REGIONS[region].label}</Label>
                        <Input type="number" value={laborRates[region]}
                          onChange={(e) => setLaborRates((r) => ({ ...r, [region]: parseFloat(e.target.value) || 0 }))}
                          className="h-8 text-xs border-[#e5e7eb] rounded-md bg-white text-[#111]" step="0.50" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-white border border-[#e5e7eb] rounded-xl p-4 mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                <Store className="w-4 h-4 text-[#3b82f6] flex-shrink-0" />
                <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop Name"
                  className="h-9 text-sm max-w-[200px] border-[#e5e7eb] rounded-md bg-white text-[#111]" />
                <label className="cursor-pointer flex-shrink-0">
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setShopLogoFile(f); }} />
                  <span className="text-xs text-[#0891b2] flex items-center gap-1 hover:underline">
                    <Upload className="w-3 h-3" />{shopLogoUrl || shopLogoFile ? "Replace Logo" : "Upload Logo"}
                  </span>
                </label>
                <button onClick={() => { handleSaveShop(); handleSavePrices(); }}
                  className="h-9 px-4 text-xs font-semibold text-white rounded-lg flex items-center gap-1.5 sm:ml-auto"
                  style={{ background: "linear-gradient(135deg, #0891b2, #2563eb)" }}>
                  <Save className="w-3.5 h-3.5" /> Save All
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
};

/* ================================================================ */
/* Revenue Tab                                                      */
/* ================================================================ */

function RevenueTab() {
  const [dateRange, setDateRange] = useState<"all" | "30" | "60" | "90">("all");

  // ── Stream 1: Manual quotes (Jackson / Lance / Troy via QuickQuote)
  // From public.quotes — staff-entered. Revenue is customer_total on
  // converted rows.
  const { data: revenueData, isLoading: loadingManual } = useQuery({
    queryKey: ["admin-quote-revenue", dateRange],
    queryFn: async () => {
      const db = supabase as any;
      let query = db
        .from("quotes")
        .select("id, quote_number, created_at, status, customer_total, shop_cost, margin_percent, vehicle_year, vehicle_make, vehicle_model, manufacturer, category, tool_source, customers(name, email, phone)")
        .not("quote_number", "like", "DEMO-%")
        .order("created_at", { ascending: false });

      if (dateRange !== "all") {
        const d = new Date();
        d.setDate(d.getDate() - Number(dateRange));
        query = query.gte("created_at", d.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter((q: any) => {
        const name = q.customers?.name || "";
        const email = q.customers?.email || "";
        return !name.toLowerCase().includes("demo") && !email.toLowerCase().includes("demo@");
      });
    },
  });

  // ── Stream 2: QuoteTool self-serve (from public.customer_quotes)
  // Revenue = matched WPW order total when wpw-sync-orders linked it,
  // else fall back to quote_total.
  const { data: selfServeData, isLoading: loadingSelfServe } = useQuery({
    queryKey: ["admin-quote-revenue-selfserve", dateRange],
    queryFn: async () => {
      const db = supabase as any;
      let query = db
        .from("customer_quotes")
        .select(
          "id, created_at, customer_name, customer_email, vehicle_year, vehicle_make, vehicle_model, quote_total, status, shop_id",
        )
        .order("created_at", { ascending: false });
      if (dateRange !== "all") {
        const d = new Date();
        d.setDate(d.getDate() - Number(dateRange));
        query = query.gte("created_at", d.toISOString());
      }
      const { data, error } = await query;
      if (error) {
        console.warn("self-serve revenue query failed:", error.message);
        return [];
      }
      return data || [];
    },
  });

  // ── Stream 3: Direct WooCommerce orders (from public.wpw_orders)
  // We pull all orders so we can both surface "WPW Direct" revenue
  // (orders with no quote_id — true walk-up sales) AND look up the
  // matched order total for converted self-serve rows above.
  const { data: wpwOrdersData, isLoading: loadingWpw } = useQuery({
    queryKey: ["admin-quote-revenue-wpw-orders", dateRange],
    queryFn: async () => {
      const db = supabase as any;
      let query = db
        .from("wpw_orders")
        .select("id, order_number, total, status, date_created, customer_name, quote_id")
        .order("date_created", { ascending: false });
      if (dateRange !== "all") {
        const d = new Date();
        d.setDate(d.getDate() - Number(dateRange));
        query = query.gte("date_created", d.toISOString());
      }
      const { data, error } = await query;
      if (error) {
        console.warn("wpw orders revenue query failed:", error.message);
        return [];
      }
      return data || [];
    },
  });

  const isLoading = loadingManual || loadingSelfServe || loadingWpw;
  const rows = revenueData || [];
  const selfServeRows = selfServeData || [];
  const wpwOrdersAll = wpwOrdersData || [];

  // Map of customer_quote.id → matched WPW order so converted self-
  // serve rows can show the actual paid amount instead of the quoted
  // estimate.
  const wpwOrderByQuoteId = useMemo(() => {
    const m = new Map<string, any>();
    for (const o of wpwOrdersAll) {
      if (o.quote_id) m.set(o.quote_id, o);
    }
    return m;
  }, [wpwOrdersAll]);

  // ── Stream stats ───────────────────────────────────────────────
  // Manual (staff-entered)
  const manualConverted = rows.filter((q: any) => q.status === "converted");
  const manualRevenue = manualConverted.reduce(
    (s: number, q: any) => s + (parseFloat(q.customer_total) || 0),
    0,
  );
  const manualCost = manualConverted.reduce(
    (s: number, q: any) => s + (parseFloat(q.shop_cost) || 0),
    0,
  );

  // QuoteTool self-serve — converted = booked / won / converted status.
  // Revenue prefers the matched WPW order total when available.
  const selfServeConverted = selfServeRows.filter((q: any) =>
    q.status === "booked" || q.status === "won" || q.status === "converted",
  );
  const selfServeRevenue = selfServeConverted.reduce((s: number, q: any) => {
    const order = wpwOrderByQuoteId.get(q.id);
    const orderTotal = parseFloat(order?.total) || 0;
    const quoteTotal = parseFloat(q.quote_total) || 0;
    return s + (orderTotal > 0 ? orderTotal : quoteTotal);
  }, 0);

  // WPW Direct — orders without a quote_id (walk-up Woo sales). The
  // ones WITH quote_id are already counted under self-serve, so we
  // skip them here to avoid double-counting.
  const wpwDirectOrders = wpwOrdersAll.filter((o: any) => !o.quote_id);
  const wpwDirectRevenue = wpwDirectOrders.reduce(
    (s: number, o: any) => s + (parseFloat(o.total) || 0),
    0,
  );

  // Combined totals — revenue rolls up all three streams.
  const totalRevenue = manualRevenue + selfServeRevenue + wpwDirectRevenue;
  const totalConverted =
    manualConverted.length + selfServeConverted.length + wpwDirectOrders.length;
  const avgOrder = totalConverted > 0 ? totalRevenue / totalConverted : 0;

  // Conversion rate is only meaningful for the streams that have a
  // "quote → order" path: manual + self-serve. WPW Direct has no
  // upstream quote so we leave it out of the denominator.
  const totalQuotes = rows.length + selfServeRows.length;
  const totalConvertedFromQuotes =
    manualConverted.length + selfServeConverted.length;
  const conversionRate =
    totalQuotes > 0
      ? Math.round((totalConvertedFromQuotes / totalQuotes) * 100)
      : 0;

  // Legacy aliases kept so the rest of the JSX (table, profit, etc.)
  // stays untouched. The headline tiles use the unified totals above.
  const converted = manualConverted;
  const totalCost = manualCost;
  const totalProfit = manualRevenue - manualCost;

  // Monthly breakdown — combine all three converted streams so the
  // bars show the real monthly revenue picture, not just manual quotes.
  const monthlyMap: Record<string, { month: string; orders: number; revenue: number }> = {};
  const addToMonthly = (iso: string | null, amount: number) => {
    if (!iso) return;
    const m = new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    if (!monthlyMap[m]) monthlyMap[m] = { month: m, orders: 0, revenue: 0 };
    monthlyMap[m].orders++;
    monthlyMap[m].revenue += amount;
  };
  for (const q of manualConverted) {
    addToMonthly(q.created_at, parseFloat(q.customer_total) || 0);
  }
  for (const q of selfServeConverted) {
    const order = wpwOrderByQuoteId.get(q.id);
    const amt = parseFloat(order?.total) || parseFloat(q.quote_total) || 0;
    addToMonthly(q.created_at, amt);
  }
  for (const o of wpwDirectOrders) {
    addToMonthly(o.date_created, parseFloat(o.total) || 0);
  }
  const monthly = Object.values(monthlyMap);

  const fmt = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // CSV export
  const exportCSV = () => {
    const header = "Quote #,Date,Customer,Email,Vehicle,Manufacturer,Category,Status,Customer Total,Shop Cost,Source\n";
    const csvRows = rows.map((q: any) => {
      const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ");
      return [
        q.quote_number, new Date(q.created_at).toLocaleDateString(), q.customers?.name || "", q.customers?.email || "",
        `"${vehicle}"`, q.manufacturer || "", q.category || "", q.status,
        q.customer_total || 0, q.shop_cost || 0, q.tool_source || "",
      ].join(",");
    });
    const blob = new Blob([header + csvRows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quote-revenue-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (isLoading) return <div className="flex items-center gap-2 justify-center py-12 text-[#6b7280]"><Loader2 className="w-5 h-5 animate-spin" /> Loading revenue data…</div>;

  return (
    <div className="space-y-4">
      {/* Per-source breakdown — three streams that feed total revenue.
          Manual (Jackson/Lance/Troy via QuickQuote) + QuoteTool self-
          serve (the customer modal — separately priced subscription
          item, the team wants to encourage shops to use it) + WPW
          Direct (walk-up Woo orders with no upstream quote). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-[#a78bfa]/40 p-3.5 ring-1 ring-[#a78bfa]/20">
          <p className="text-[10px] text-[#7c3aed] uppercase tracking-wider font-bold">Manual quotes (Staff)</p>
          <p className="text-xl font-bold text-[#111] tabular-nums mt-1">
            {manualConverted.length} / {fmt(manualRevenue)}
          </p>
          <p className="text-[10px] text-[#6b7280] mt-0.5">
            Jackson, Lance, Troy via QuickQuote
          </p>
        </div>
        <div className="bg-white rounded-xl border border-[#0891b2]/40 p-3.5 ring-1 ring-[#0891b2]/20">
          <p className="text-[10px] text-[#0891b2] uppercase tracking-wider font-bold">QuoteTool (Self-Serve)</p>
          <p className="text-xl font-bold text-[#111] tabular-nums mt-1">
            {selfServeConverted.length} / {fmt(selfServeRevenue)}
          </p>
          <p className="text-[10px] text-[#6b7280] mt-0.5">
            Customer-facing modal — separately priced
          </p>
        </div>
        <div className="bg-white rounded-xl border border-[#16a34a]/40 p-3.5 ring-1 ring-[#16a34a]/20">
          <p className="text-[10px] text-[#16a34a] uppercase tracking-wider font-bold">WPW Direct (Woo)</p>
          <p className="text-xl font-bold text-[#111] tabular-nums mt-1">
            {wpwDirectOrders.length} / {fmt(wpwDirectRevenue)}
          </p>
          <p className="text-[10px] text-[#6b7280] mt-0.5">
            Walk-up Woo orders (no upstream quote)
          </p>
        </div>
      </div>

      {/* Summary Cards — unified totals across all three streams */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: "Total Booked Orders",
            value: String(totalConverted),
            color: "#16a34a",
            sublabel: "All sources",
          },
          {
            label: "Total Revenue",
            value: fmt(totalRevenue),
            color: "#0891b2",
            sublabel: "Combined",
          },
          {
            label: "Avg Order",
            value: fmt(avgOrder),
            sublabel: "Per booked order",
          },
          {
            label: "Conversion Rate",
            value: `${conversionRate}%`,
            color: "#7c3aed",
            sublabel: "Quotes → orders",
          },
          {
            label: "Manual Shop Cost",
            value: fmt(totalCost),
            sublabel: "Staff quotes only",
          },
          {
            label: "Manual Profit",
            value: fmt(totalProfit),
            color: totalProfit > 0 ? "#16a34a" : "#dc2626",
            sublabel: "Revenue − cost",
          },
        ].map(({ label, value, color, sublabel }) => (
          <div key={label} className="bg-white rounded-xl border border-[#e5e7eb] p-3.5">
            <p className="text-lg sm:text-xl font-bold text-[#111] tabular-nums" style={color ? { color } : undefined}>{value}</p>
            <p className="text-xs text-[#6b7280] mt-0.5">{label}</p>
            <p className="text-[10px] text-[#9ca3af] mt-0.5">{sublabel}</p>
          </div>
        ))}
      </div>

      {/* Monthly Breakdown */}
      {monthly.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
          <h3 className="text-sm font-semibold text-[#111] mb-3">Monthly Revenue (Converted Orders)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {monthly.map(m => (
              <div key={m.month} className="bg-[#f0fdfa] rounded-lg p-3 border border-[#e5e7eb]">
                <p className="text-xs font-semibold text-[#0891b2]">{m.month}</p>
                <p className="text-lg font-bold text-[#111]">{fmt(m.revenue)}</p>
                <p className="text-xs text-[#6b7280]">{m.orders} orders</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + Export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {([["all", "All Time"], ["30", "30 Days"], ["60", "60 Days"], ["90", "90 Days"]] as const).map(([val, label]) => (
            <button key={val} onClick={() => setDateRange(val as any)}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-lg border transition-all",
                dateRange === val ? "bg-[#0891b2] text-white border-[#0891b2]" : "bg-white text-[#6b7280] border-[#e5e7eb] hover:border-[#0891b2]"
              )}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-[#6b7280]">
          <span>{rows.length} quotes total &bull; {converted.length} converted</span>
          <button onClick={exportCSV} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e5e7eb] bg-white text-[#111] font-medium hover:border-[#0891b2] transition-all">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Quote List Table */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f0fdfa] border-b border-[#e5e7eb]">
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Quote #</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Customer</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Vehicle</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b7280] text-xs">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-[#6b7280] text-xs">Customer Total</th>
                <th className="text-right px-4 py-3 font-semibold text-[#6b7280] text-xs">Shop Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((q: any) => {
                const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ");
                const isConverted = q.status === "converted";
                return (
                  <tr key={q.id} className={cn("border-b border-[#f0f0f0] hover:bg-[#f9fafb] transition-colors", isConverted && "bg-[#f0fdf4]")}>
                    <td className="px-4 py-2.5 text-xs font-mono text-[#374151]">{q.quote_number}</td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280]">{new Date(q.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-medium text-[#111] truncate max-w-[160px]">{q.customers?.name || "—"}</p>
                      <p className="text-[10px] text-[#9ca3af] truncate max-w-[160px]">{q.customers?.email || ""}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#6b7280] truncate max-w-[180px]">{vehicle || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        q.tool_source === "WPW" ? "bg-[#dbeafe] text-[#1d4ed8]" : "bg-[#f3e8ff] text-[#7c3aed]"
                      )}>
                        {q.tool_source || "Internal"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        isConverted ? "bg-[#dcfce7] text-[#16a34a]" :
                        q.status === "sent" ? "bg-[#fef3c7] text-[#d97706]" :
                        q.status === "quoted" ? "bg-[#dbeafe] text-[#2563eb]" :
                        "bg-[#f3f4f6] text-[#6b7280]"
                      )}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-[#111]">
                      {(q.customer_total && q.customer_total > 0) ? fmt(parseFloat(q.customer_total)) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[#6b7280]">
                      {(q.shop_cost && q.shop_cost > 0) ? fmt(parseFloat(q.shop_cost)) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && (
          <div className="text-center py-3 text-xs text-[#9ca3af] border-t border-[#e5e7eb]">
            Showing 200 of {rows.length} quotes — export CSV for full data
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminQuickQuote;
