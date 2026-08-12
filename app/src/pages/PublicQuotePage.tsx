/**
 * PublicQuotePage — customer-facing quote view at /q/:token.
 *
 * Anonymous-safe. Loads via the SECURITY DEFINER RPC
 * `get_public_quote_by_token` so the quotes table itself stays under
 * shop-scoped RLS. The RPC returns ONLY customer-safe fields plus the
 * owning shop's branding info and a single is_wpw_shop boolean used to
 * pick the dual skin:
 *
 *   • WPW shop owner    → "Powered by WePrintWraps" footer + magenta accent
 *   • Non-WPW shop      → "Powered by PrintPro" footer + cyan accent
 *
 * Layout (light UI, matching the printed quote layout):
 *   • Top accent bar (gradient)
 *   • Header row: shop name (left, dominant) + QUOTE/#/date (right)
 *   • Customer + Vehicle blocks (2 col)
 *   • Product Details
 *   • Pricing table → highlighted TOTAL bar
 *   • Big WPW Cart BUY button (primary CTA)
 *   • Secondary actions: call / email / download PDF
 *   • DesignPro pitch (WPW only) → restyleproai.com/pricing
 *   • Footer attribution
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  Globe,
  Loader2,
  Mail,
  Phone,
  Printer,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { generateQuotePDF, type QuotePDFData } from "@/lib/quote-pdf-generator";
import { buildPayUrl } from "@/lib/pay-link";

interface PublicQuote {
  quote_id: string;
  quote_number: string;
  status: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  manufacturer: string | null;
  finish: string | null;
  color_name: string | null;
  category: string | null;
  sq_ft: number | null;
  yards_needed: number | null;
  customer_total: number | null;
  margin_percent: number | null;
  line_items: Array<{
    label: string;
    detail?: string;
    amount: number;
    wooProductId?: number;
    quantity?: number;
  }> | null;
  render_url: string | null;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  shop_name: string | null;
  shop_logo_url: string | null;
  shop_phone: string | null;
  shop_website: string | null;
  is_wpw_shop: boolean;
}

const currency = (n: number | null | undefined): string => {
  if (n == null) return "$0";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

// Cart URL is built via the shared @/lib/pay-link helper so the public
// quote page, the saved-quotes admin PDF, and the email edge function all
// produce the exact same one-click cart link.

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing quote token");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "get_public_quote_by_token" as never,
          { p_token: token } as never,
        );
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setError("Quote not found");
          return;
        }
        setQuote(row as unknown as PublicQuote);
      } catch (err) {
        console.error("[PublicQuotePage] fetch failed", err);
        setError("This quote link is invalid or has expired.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Quote unavailable</h1>
          <p className="text-gray-600 mb-5">{error || "We couldn't find this quote."}</p>
          <Button asChild variant="outline">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // is_wpw_shop from the RPC is computed off user_subscriptions.woo_customer_id,
  // which doesn't fire for the WPW shop owner itself. Fallback: also treat any
  // shop named "WePrintWraps" or whose website is weprintwraps.com as WPW so
  // the BUY button + DesignPro pitch render correctly on customer-facing quotes.
  const isWpw =
    !!quote.is_wpw_shop ||
    (quote.shop_name || "").trim().toLowerCase().replace(/\s+/g, "") === "weprintwraps" ||
    /weprintwraps/i.test(quote.shop_website || "");
  const accent = isWpw
    ? "bg-gradient-to-r from-fuchsia-500 to-rose-500"
    : "bg-gradient-to-r from-cyan-500 to-blue-600";
  const totalBar = isWpw
    ? "bg-gradient-to-r from-fuchsia-500 to-rose-500"
    : "bg-gradient-to-r from-cyan-500 to-blue-600";
  const buyButton = isWpw
    ? "bg-gradient-to-r from-fuchsia-500 to-rose-500 hover:from-fuchsia-600 hover:to-rose-600"
    : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700";
  const poweredBy = isWpw ? "WePrintWraps" : "PrintPro";
  const poweredByUrl = isWpw ? "https://weprintwraps.com" : "/quotetool";

  const vehicle = [quote.vehicle_year, quote.vehicle_make, quote.vehicle_model]
    .filter(Boolean)
    .join(" ");

  // WPW shops can offer a one-click checkout via Woo's native ?add-to-cart=
  // URL. Gated on the local isWpw fallback (which catches the WPW shop owner
  // itself, whose user_subscriptions row doesn't carry woo_customer_id) so
  // non-WPW shops don't accidentally show a WePrintWraps cart button.
  const wpwCheckoutUrl = isWpw ? buildPayUrl(quote.shop_website, quote.line_items) : null;
  const wpwShopFallbackUrl =
    "https://weprintwraps.com/?utm_source=restylepro&utm_medium=quote&utm_campaign=public_quote";

  const handleDownloadPdf = async () => {
    const pdfData: QuotePDFData = {
      quoteNumber: quote.quote_number,
      createdAt: quote.created_at,
      shopName: quote.shop_name || "Your wrap shop",
      shopLogoUrl: quote.shop_logo_url ?? null,
      shopWebsite: quote.shop_website ?? null,
      payUrl: wpwCheckoutUrl,
      customer: {
        name: quote.customer_name ?? null,
        email: quote.customer_email ?? null,
        phone: null,
      },
      vehicle: {
        year: quote.vehicle_year ?? null,
        make: quote.vehicle_make ?? null,
        model: quote.vehicle_model ?? null,
      },
      manufacturer: quote.manufacturer ?? null,
      colorName: quote.color_name ?? null,
      finish: quote.finish ?? null,
      customerTotal: Number(quote.customer_total) || 0,
      lineItems: (quote.line_items || []).map((i) => ({
        label: i.label,
        detail: i.detail,
        amount: i.amount,
      })),
      renderUrl: quote.render_url ?? null,
      status: "sent",
    };
    await generateQuotePDF(pdfData);
  };

  const subtotal = (quote.line_items || []).reduce((sum, i) => sum + (i.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <Helmet>
        <title>
          {quote.shop_name ? `Quote from ${quote.shop_name}` : "Your wrap quote"}{" "}
          · #{quote.quote_number}
        </title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">

          {/* Top accent bar */}
          <div className={`h-1.5 ${accent}`} />

          <div className="px-6 sm:px-10 py-8 sm:py-10">

            {/* Header row: shop identity (left) + QUOTE meta (right) */}
            <div className="flex items-start justify-between gap-6 flex-wrap mb-8">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 mb-1">
                  RestyleProAI
                </p>
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 truncate">
                  {quote.shop_name || "Your wrap shop"}
                </h1>
                {(quote.shop_phone || quote.shop_website) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                    {quote.shop_phone && (
                      <a href={`tel:${quote.shop_phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-cyan-600">
                        <Phone className="w-3 h-3" />
                        {quote.shop_phone}
                      </a>
                    )}
                    {quote.shop_website && (
                      <a
                        href={quote.shop_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-cyan-600"
                      >
                        <Globe className="w-3 h-3" />
                        {quote.shop_website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl sm:text-4xl font-black text-cyan-600 leading-none">QUOTE</p>
                <p className="text-xs text-gray-500 mt-2 font-mono">#{quote.quote_number}</p>
                <p className="text-xs text-gray-500 mt-0.5">{formatDate(quote.created_at)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-2">
                  {(quote.status || "QUOTED").toUpperCase()}
                </p>
              </div>
            </div>

            <hr className="border-gray-200 my-6" />

            {/* Hero render (if any) */}
            {quote.render_url && (
              <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 aspect-[16/9] bg-gray-50">
                <img
                  src={quote.render_url}
                  alt={`${vehicle} render`}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Customer + Vehicle blocks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 mb-2">
                  Customer
                </p>
                <p className="text-base font-bold text-gray-900">
                  {quote.customer_name || "Customer"}
                </p>
                {quote.customer_email && (
                  <p className="text-sm text-gray-600 mt-0.5">{quote.customer_email}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 mb-2">
                  Vehicle
                </p>
                <p className="text-base font-bold text-gray-900">
                  {vehicle || "Custom vehicle"}
                </p>
                {(quote.manufacturer || quote.finish || quote.color_name) && (
                  <p className="text-sm text-gray-600 mt-0.5">
                    {[quote.manufacturer, quote.finish, quote.color_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>

            <hr className="border-gray-200 my-6" />

            {/* Product Details */}
            {(quote.sq_ft || quote.yards_needed) && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 mb-3">
                  Product Details
                </p>
                <div className="space-y-1 mb-6 text-sm">
                  {quote.sq_ft && (
                    <div className="flex">
                      <span className="font-bold text-gray-900 w-44">Square Footage:</span>
                      <span className="text-gray-700">{quote.sq_ft} sq ft</span>
                    </div>
                  )}
                  {quote.yards_needed && (
                    <div className="flex">
                      <span className="font-bold text-gray-900 w-44">Yards Needed:</span>
                      <span className="text-gray-700">{quote.yards_needed} yd</span>
                    </div>
                  )}
                </div>
                <hr className="border-gray-200 my-6" />
              </>
            )}

            {/* Pricing table */}
            {quote.line_items && quote.line_items.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 mb-3">
                  Pricing
                </p>
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3">Detail</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.line_items.map((item, i) => (
                      <tr key={`${item.label}-${i}`} className="border-b border-gray-100 last:border-0">
                        <td className="py-3 px-3 text-gray-900 font-medium">{item.label}</td>
                        <td className="py-3 px-3 text-gray-600">{item.detail || ""}</td>
                        <td className="py-3 px-3 text-right text-gray-900 font-semibold whitespace-nowrap">
                          {currency(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-gray-100">
                      <td className="py-3 px-3" colSpan={2}>
                        <span className="text-gray-500">Subtotal</span>
                      </td>
                      <td className="py-3 px-3 text-right text-gray-700 font-semibold whitespace-nowrap">
                        {currency(subtotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* TOTAL highlighted bar */}
            <div className={`${totalBar} rounded-lg px-5 py-4 flex items-center justify-between mb-8`}>
              <span className="text-white text-lg font-black tracking-wide">TOTAL</span>
              <span className="text-white text-2xl sm:text-3xl font-black">
                {currency(quote.customer_total)}
              </span>
            </div>

            {/* PRIMARY CTA — Big Buy button (WPW shops) or Contact (others) */}
            {isWpw ? (
              <div className="text-center mb-6">
                <a
                  href={wpwCheckoutUrl || wpwShopFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buyButton} inline-flex items-center justify-center gap-2 text-white font-black text-lg sm:text-xl px-10 sm:px-14 py-5 rounded-xl shadow-lg shadow-cyan-500/30 transition-all hover:shadow-xl hover:-translate-y-0.5`}
                >
                  <ShoppingCart className="w-5 h-5" />
                  {wpwCheckoutUrl ? "Buy Now on WePrintWraps.com" : "Shop on WePrintWraps.com"}
                </a>
                <p className="text-xs text-gray-500 mt-3">
                  Secure checkout · Pay online in seconds
                </p>
              </div>
            ) : (
              <div className="text-center mb-6">
                <p className="text-base text-gray-700 mb-4">
                  Ready to move forward? Contact <strong className="text-gray-900">{quote.shop_name || "your shop"}</strong> below.
                </p>
              </div>
            )}

            {/* Secondary actions */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
              {quote.shop_phone && (
                <Button asChild variant="outline" size="sm">
                  <a href={`tel:${quote.shop_phone.replace(/[^\d+]/g, "")}`}>
                    <Phone className="w-4 h-4 mr-1" />
                    Call {quote.shop_name || "shop"}
                  </a>
                </Button>
              )}
              {quote.customer_email && (
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${quote.customer_email}?subject=Re: Quote #${quote.quote_number}`}>
                    <Mail className="w-4 h-4 mr-1" />
                    Reply by email
                  </a>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
              >
                <Printer className="w-4 h-4 mr-1" />
                Download PDF
              </Button>
            </div>

            {/* WPW-only DesignPro pitch + product showcase — same DesignPro
                copy as the QuickQuote email so customers get a consistent
                message across channels. Owner-approved copy — confirm with
                Trish before changing. */}
            {isWpw && (
              <div className="mt-10">
                <div className="text-center mb-6">
                  <h3 className="text-xl sm:text-2xl font-black text-gray-900 leading-tight">
                    Want a graphic designer at your fingertips?
                  </h3>
                  <p className="text-sm text-gray-600 mt-2 max-w-xl mx-auto">
                    RestyleProAI gives you the entire wrap-design toolkit — try any of these tools free.
                  </p>
                </div>

                {/* Product showcase — 4 tools matching the /pricing page heroes.
                    Order matches the tier ladder so the leading tile (ColorPro)
                    is what Starter customers actually get; DesignPro is later
                    since it's a Studio-tier tool, not a Starter feature. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {[
                    {
                      name: "ColorPro™",
                      tagline: "Color visualizer · every tier",
                      href: "https://www.restyleproai.com/colorpro",
                      img: "/colorpro-hero-corvette.png",
                      grad: "from-cyan-500 to-blue-600",
                    },
                    {
                      name: "MyVehiclePro™",
                      tagline: "Your photo + AI",
                      href: "https://www.restyleproai.com/myvehiclepro",
                      img: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wpw-founder/myvehiclepro-1778253166069-IMG_6538.jpeg",
                      grad: "from-amber-500 to-orange-600",
                    },
                    {
                      name: "DesignPro™",
                      tagline: "AI wrap designs",
                      href: "https://www.restyleproai.com/designpro",
                      img: "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wpw-founder/designproai-1778216355003-IMG_4216.jpeg",
                      grad: "from-fuchsia-500 to-rose-500",
                    },
                    {
                      name: "RecreatePro™",
                      tagline: "Recreate any design",
                      href: "https://www.restyleproai.com/recreatepro",
                      img: null,
                      grad: "from-emerald-500 to-teal-600",
                    },
                  ].map((t) => (
                    <a
                      key={t.name}
                      href={t.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 hover:shadow-md transition-all"
                    >
                      {t.img ? (
                        <div className="h-24 sm:h-28 overflow-hidden">
                          <img
                            src={t.img}
                            alt={t.name}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className={`h-24 sm:h-28 bg-gradient-to-br ${t.grad} flex items-center justify-center`}>
                          <span className="text-white text-xl font-black">{t.name.charAt(0)}</span>
                        </div>
                      )}
                      <div className="px-3 py-3 text-center">
                        <p className="text-sm font-bold text-gray-900">{t.name}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{t.tagline}</p>
                        <p className="text-[11px] font-semibold text-cyan-600 mt-1.5 group-hover:text-cyan-700">
                          Try it!
                        </p>
                      </div>
                    </a>
                  ))}
                </div>

                {/* DesignPro Studio pitch box */}
                <div className="rounded-xl border border-cyan-300 bg-cyan-50 px-6 py-6 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-700 mb-2">
                    Subscribe and design unlimited wraps
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed mb-3">
                    Our custom wrap design fee is <strong className="text-gray-900">$975</strong> per design.
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed mb-3">
                    Or — for <span className="font-semibold text-gray-900">less than that</span> — subscribe to{" "}
                    <strong className="text-gray-900">RestylePro DesignPro Studio at $699/mo</strong> and get unlimited
                    photoreal AI mockups, our real human designer producing Production Packs, all the design tools, and
                    print-ready files included.
                  </p>
                  <p className="italic text-xs text-gray-500 mb-4">
                    One subscription month &lt; one custom design. And you keep designing — forever.
                  </p>
                  <a
                    href="https://www.restyleproai.com/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:from-cyan-600 hover:to-fuchsia-600 text-white font-bold text-sm px-6 py-3 rounded-lg shadow-md transition-all"
                  >
                    Subscribe to DesignPro Studio →
                  </a>
                  <p className="text-[11px] text-gray-500 mt-3">
                    WPW Family rate: <strong className="text-gray-900">$649/mo</strong> · save $50/mo for life
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer attribution */}
          <footer className="border-t border-gray-200 px-6 sm:px-10 py-4 bg-gray-50">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-[11px] text-gray-500">
                Generated by{" "}
                <a
                  href={poweredByUrl}
                  target={isWpw ? "_blank" : undefined}
                  rel={isWpw ? "noopener noreferrer" : undefined}
                  className="text-cyan-600 font-semibold hover:text-cyan-700"
                >
                  {poweredBy}
                </a>
              </p>
              <p className="text-[11px] text-gray-400 italic">QuickQuote™</p>
            </div>
          </footer>

        </div>
      </div>
    </div>
  );
}
