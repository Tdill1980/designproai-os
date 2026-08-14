import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Send,
  Users,
  Mail,
  ExternalLink,
  Loader2,
  AlertTriangle,
  ImageIcon,
} from "lucide-react";
import { useWpwFounderAssets } from "@/hooks/useWpwFounderAssets";
import { isVideoUrl, WPW_FOUNDER_TOOL_KEYS } from "@/lib/wpw-founder-slots";

/**
 * /admin/wpw-founder-campaign
 *
 * White, pro-look admin console for the WPW Founder invitation campaign.
 * Pulls audiences from Klaviyo (list or segment ID) and sends the
 * invitation email through Resend via the wpw-founder-campaign edge
 * function. Live-previews the founder letter + uploaded video/images.
 */

interface PreviewResult {
  count: number;
  sample: Array<{ email: string; first_name: string }>;
}

interface SendResult {
  sent: number;
  failed: number;
  errors?: Array<{ email: string; error: string }>;
}

interface Audience {
  id: string;
  name: string;
  source: "list" | "segment" | "wpw";
}

export default function AdminWpwFounderCampaign() {
  const { toast } = useToast();
  const { data: assets = {} } = useWpwFounderAssets();

  const [audienceKey, setAudienceKey] = useState(""); // "list:abc" / "segment:xyz"

  const audiencesQuery = useQuery({
    queryKey: ["wpw-founder-klaviyo-audiences"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "wpw-founder-campaign",
        { body: { action: "list_audiences" } },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as { audiences: Audience[] }).audiences ?? [];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const audiences = audiencesQuery.data ?? [];
  const selected = audiences.find(
    (a) => `${a.source}:${a.id}` === audienceKey,
  );

  type TemplateKey = "founder" | "connect-portal";
  const TEMPLATE_DEFAULTS: Record<TemplateKey, { subject: string; label: string; landingPath: string }> = {
    "founder": {
      subject: "You're invited — your DesignProAI Founder Dashboard",
      label: "Founder Invitation (full pitch + $50 off membership)",
      landingPath: "/from/weprintwraps",
    },
    "connect-portal": {
      subject: "Your free WePrintWraps dashboard is waiting",
      label: "Connect Portal (free dashboard + 3 tokens, single CTA)",
      landingPath: "/wpw-connect",
    },
  };
  const [template, setTemplate] = useState<TemplateKey>("founder");
  const [subject, setSubject] = useState(TEMPLATE_DEFAULTS.founder.subject);
  const [fromName, setFromName] = useState("Trish Dill — WePrintWraps");
  const [fromEmail, setFromEmail] = useState("trish@weprintwraps.com");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const isStillDefault = Object.values(TEMPLATE_DEFAULTS).some(
      (t) => t.subject === subject,
    );
    if (isStillDefault) {
      setSubject(TEMPLATE_DEFAULTS[template].subject);
    }
  }, [template]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a Klaviyo audience first.");
      const { data, error } = await supabase.functions.invoke(
        "wpw-founder-campaign",
        {
          body: {
            action: "preview",
            source: selected.source,
            id: selected.id,
          },
        },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PreviewResult;
    },
    onSuccess: (data) => {
      setPreview(data);
      setSendResult(null);
      toast({
        title: "Audience loaded",
        description: `${data.count.toLocaleString()} contacts ready to receive the invitation.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Preview failed",
        description: err?.message || "Could not load Klaviyo audience.",
        variant: "destructive",
      });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a Klaviyo audience first.");
      const { data, error } = await supabase.functions.invoke(
        "wpw-founder-campaign",
        {
          body: {
            action: "send",
            source: selected.source,
            id: selected.id,
            subject,
            fromName,
            fromEmail,
            template,
          },
        },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as SendResult;
    },
    onSuccess: (data) => {
      setSendResult(data);
      setConfirmOpen(false);
      toast({
        title: "Campaign sent",
        description: `Delivered to ${data.sent.toLocaleString()} • ${data.failed} failed.`,
      });
    },
    onError: (err: any) => {
      setConfirmOpen(false);
      toast({
        title: "Send failed",
        description: err?.message || "Resend send failed.",
        variant: "destructive",
      });
    },
  });

  const heroVideo = assets["video"] || "";

  return (
    <div className="min-h-screen bg-white text-black">
      <Helmet>
        <title>WPW Founder Campaign — Admin</title>
      </Helmet>

      {/* ── Header ── */}
      <header className="border-b border-black/10 bg-white">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" asChild className="text-black/70 hover:text-black">
            <Link to="/admin">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Admin
            </Link>
          </Button>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50">
            Founder Campaign
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 sm:py-14 max-w-6xl">
        {/* ── Title ── */}
        <div className="mb-10 text-center">
          <h1 className="font-montserrat text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3">
            Send the{" "}
            <span className="bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text text-transparent">
              Founder Invitation
            </span>
          </h1>
          <p className="text-base text-black/65 max-w-2xl mx-auto leading-relaxed">
            Pull a list or segment from Klaviyo, preview the audience, then
            send the founder letter through Resend. Each contact gets a
            personalized email with their first name.
          </p>
          <div className="mt-5 inline-flex items-center gap-3 text-xs text-black/55">
            <Link
              to="/from/weprintwraps"
              target="_blank"
              className="inline-flex items-center gap-1 underline"
            >
              View landing page <ExternalLink className="w-3 h-3" />
            </Link>
            <span className="text-black/20">·</span>
            <Link
              to="/admin/wpw-founder-assets"
              className="inline-flex items-center gap-1 underline"
            >
              Edit images & video <ImageIcon className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
          {/* ── Left column: form + audience + send ── */}
          <div className="space-y-6">
            {/* 0. Email template */}
            <section className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 mb-2">
                Step 0
              </div>
              <h2 className="font-montserrat text-xl sm:text-2xl font-bold mb-2">
                Pick the email template
              </h2>
              <p className="text-sm text-black/60 mb-5 leading-relaxed">
                Founder Invitation = the original long-form pitch with the $50/mo offer, links to{" "}
                <code className="text-[11px]">/from/weprintwraps</code>.<br />
                Connect Portal = the short, single-CTA follow-up that lands customers on{" "}
                <code className="text-[11px]">/wpw-connect</code> so they auto-link their WPW account.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(Object.keys(TEMPLATE_DEFAULTS) as TemplateKey[]).map((key) => {
                  const t = TEMPLATE_DEFAULTS[key];
                  const active = template === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTemplate(key)}
                      className={
                        "text-left rounded-lg border p-4 transition-all " +
                        (active
                          ? "border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/40"
                          : "border-black/15 hover:border-black/30 bg-white")
                      }
                    >
                      <div className="text-xs font-bold uppercase tracking-wider text-black/55 mb-1">
                        {key === "founder" ? "Founder Invitation" : "Connect Portal"}
                      </div>
                      <div className="text-sm text-black/85 leading-snug mb-2">{t.label}</div>
                      <div className="text-[11px] text-black/55">
                        Lands on <code>{t.landingPath}</code>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 1. Klaviyo audience */}
            <section className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 mb-2">
                Step 1
              </div>
              <h2 className="font-montserrat text-xl sm:text-2xl font-bold mb-2">
                Pick the Klaviyo audience
              </h2>
              <p className="text-sm text-black/60 mb-5 leading-relaxed">
                Paste a Klaviyo list ID or segment ID. Find it in your Klaviyo
                dashboard under Audience &rarr; Lists / Segments.
              </p>

              <div className="space-y-4">
                <div>
                  <Label
                    htmlFor="audience"
                    className="text-xs font-bold uppercase tracking-wider text-black/55 mb-2 block"
                  >
                    Audience
                  </Label>
                  {audiencesQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-black/55">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading your Klaviyo lists & segments…
                    </div>
                  ) : audiencesQuery.isError ? (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                      Couldn't reach Klaviyo:{" "}
                      {(audiencesQuery.error as any)?.message ||
                        "unknown error"}
                      . Confirm <code>KLAVIYO_API_KEY</code> is set in
                      Supabase secrets.
                    </div>
                  ) : (
                    <select
                      id="audience"
                      value={audienceKey}
                      onChange={(e) => setAudienceKey(e.target.value)}
                      className="w-full bg-white border border-black/15 rounded-md px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">— Select an audience —</option>
                      {audiences.some((a) => a.source === "wpw") && (
                        <optgroup label="WPW Order History (built-in)">
                          {audiences
                            .filter((a) => a.source === "wpw")
                            .map((a) => (
                              <option
                                key={`wpw:${a.id}`}
                                value={`wpw:${a.id}`}
                              >
                                {a.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {audiences.some((a) => a.source === "list") && (
                        <optgroup label="Klaviyo Lists">
                          {audiences
                            .filter((a) => a.source === "list")
                            .map((a) => (
                              <option
                                key={`list:${a.id}`}
                                value={`list:${a.id}`}
                              >
                                {a.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {audiences.some((a) => a.source === "segment") && (
                        <optgroup label="Klaviyo Segments">
                          {audiences
                            .filter((a) => a.source === "segment")
                            .map((a) => (
                              <option
                                key={`segment:${a.id}`}
                                value={`segment:${a.id}`}
                              >
                                {a.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  )}
                  {selected && (
                    <p className="text-[11px] text-black/45 mt-1.5">
                      {selected.source === "list"
                        ? "Klaviyo list"
                        : selected.source === "segment"
                        ? "Klaviyo segment"
                        : "WPW segment"}{" "}
                      ID: <code>{selected.id}</code>
                    </p>
                  )}
                </div>

                <Button
                  onClick={() => previewMutation.mutate()}
                  disabled={!selected || previewMutation.isPending}
                  variant="outline"
                  className="border-black/15 text-black hover:bg-black/5"
                >
                  {previewMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading audience…
                    </>
                  ) : (
                    <>
                      <Users className="w-4 h-4 mr-2" />
                      Preview Audience
                    </>
                  )}
                </Button>
              </div>
            </section>

            {/* 2. Audience result */}
            {preview && (
              <section className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 mb-1">
                      Audience
                    </div>
                    <div className="font-montserrat text-3xl sm:text-4xl font-bold leading-none">
                      <span className="bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text text-transparent">
                        {preview.count.toLocaleString()}
                      </span>
                      <span className="text-black/60 text-base font-normal ml-2">
                        contact{preview.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <Users className="w-8 h-8 text-black/30" />
                </div>
                {preview.sample.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-black/55 mb-2">
                      Sample (first {preview.sample.length}):
                    </div>
                    <ul className="text-sm text-black/75 space-y-1">
                      {preview.sample.map((p) => (
                        <li
                          key={p.email}
                          className="flex items-center justify-between gap-2 border-b border-black/5 pb-1"
                        >
                          <span className="truncate">{p.email}</span>
                          <span className="text-xs text-black/45 shrink-0">
                            {p.first_name || "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* 3. Email config + send */}
            <section className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 mb-2">
                Step 2
              </div>
              <h2 className="font-montserrat text-xl sm:text-2xl font-bold mb-5">
                Send the campaign
              </h2>

              <div className="grid sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-black/55 mb-2 block">
                    Subject line
                  </Label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="bg-white border-black/15 text-black"
                  />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-black/55 mb-2 block">
                    From name
                  </Label>
                  <Input
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    className="bg-white border-black/15 text-black"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-black/55 mb-2 block">
                    From email
                  </Label>
                  <Input
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    className="bg-white border-black/15 text-black"
                  />
                  <p className="text-[11px] text-black/45 mt-1.5">
                    Must be a verified sender domain in your Resend account.
                  </p>
                </div>
              </div>

              {!confirmOpen ? (
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90 text-white px-7 font-bold"
                  disabled={!preview || preview.count === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send to{" "}
                  {preview ? preview.count.toLocaleString() : "0"} contacts
                </Button>
              ) : (
                <div className="rounded-xl border border-black/10 bg-neutral-50 p-5">
                  <div className="flex items-start gap-3 mb-4">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">
                        Send {preview?.count.toLocaleString() ?? 0} live
                        emails through Resend?
                      </p>
                      <p className="text-xs text-black/60 mt-1 leading-snug">
                        This cannot be undone. Resend will throttle the
                        outbound at ~8/sec, so a list of 500 contacts will
                        take about a minute.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="lg"
                      className="bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90 text-white font-bold"
                      disabled={sendMutation.isPending}
                      onClick={() => sendMutation.mutate()}
                    >
                      {sendMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Confirm & Send
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setConfirmOpen(false)}
                      disabled={sendMutation.isPending}
                      className="border-black/15 text-black hover:bg-black/5"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {sendResult && (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold text-emerald-800">
                        Delivered to {sendResult.sent.toLocaleString()} of{" "}
                        {(sendResult.sent + sendResult.failed).toLocaleString()}
                      </p>
                      {sendResult.failed > 0 && (
                        <p className="text-xs text-emerald-700 mt-1">
                          {sendResult.failed} failed.{" "}
                          {sendResult.errors && sendResult.errors.length > 0 && (
                            <>First: {sendResult.errors[0].email} —{" "}
                              {sendResult.errors[0].error}</>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ── Right column: live letter preview ── */}
          <aside className="lg:sticky lg:top-6">
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-black/50" />
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/55">
                  Letter preview
                </div>
              </div>

              {/* Founder phone */}
              <div className="mx-auto w-full max-w-[220px] aspect-[9/16] rounded-2xl overflow-hidden border border-black/10 bg-neutral-50 mb-4">
                {heroVideo ? (
                  isVideoUrl(heroVideo) ? (
                    <video
                      src={heroVideo}
                      className="w-full h-full object-cover"
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={heroVideo}
                      alt="Founder"
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-center px-3 border-2 border-dashed border-black/15 rounded-2xl">
                    <div className="text-[10px] text-black/40 leading-snug">
                      Upload founder video at{" "}
                      <Link
                        to="/admin/wpw-founder-assets"
                        className="underline"
                      >
                        /admin/wpw-founder-assets
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Letter snippet */}
              <p className="text-sm font-semibold text-black mb-2 leading-snug">
                You're invited to the future of vehicle wrap design.
              </p>
              <p className="text-xs text-black/65 leading-relaxed mb-4">
                As part of this invitation, receive{" "}
                <span className="font-bold bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text text-transparent">
                  $50 OFF
                </span>{" "}
                your membership. Your ShopEngine™ Dashboard is included.
              </p>

              {/* Tool images mini-grid */}
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {WPW_FOUNDER_TOOL_KEYS.map((tk) => {
                  const url = assets[`tool-${tk}`];
                  return (
                    <div
                      key={tk}
                      className="aspect-square rounded-md border border-black/10 bg-neutral-50 overflow-hidden"
                    >
                      {url && !isVideoUrl(url) ? (
                        <img
                          src={url}
                          alt={tk}
                          className="w-full h-full object-cover"
                        />
                      ) : url ? (
                        <video
                          src={url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-3 h-3 text-black/25" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button asChild size="sm" variant="outline" className="w-full border-black/15 text-black hover:bg-black/5">
                <Link to="/from/weprintwraps" target="_blank">
                  Open full landing page
                  <ArrowRight className="w-3 h-3 ml-1.5" />
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
