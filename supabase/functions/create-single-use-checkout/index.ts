/**
 * create-single-use-checkout — Stripe one-time-payment checkout for a
 * single use of any RestylePro tool, sold from the public /pay-per-use
 * landing page.
 *
 * Public (no auth): Stripe collects the buyer's email at checkout. If a
 * JWT is supplied we'll attach the user_id to metadata, but it is not
 * required — that's what "pay to play" means here.
 *
 * Body:
 *   { tool: string, return_path?: string }
 *
 * Returns:
 *   { url: string, tool: string, unit_amount: number }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type ToolSpec = {
  slug: string;
  name: string;
  description: string;
  unit_amount: number;
  return_path: string;
};

// All single-use prices are $25 to match the existing AlaCarte
// pay-as-you-go rate (create-alacarte-render-checkout). One number,
// one ladder — no customer confusion.
const TOOLS: Record<string, ToolSpec> = {
  colorpro: {
    slug: "colorpro",
    name: "ColorPro — 1 render",
    description: "One photorealistic color-change render on your vehicle.",
    unit_amount: 2500,
    return_path: "/colorpro",
  },
  designpro: {
    slug: "designpro",
    name: "DesignPro — 1 render",
    description: "One AI-generated panel design render on your vehicle.",
    unit_amount: 2500,
    return_path: "/designpro",
  },
  fadewraps: {
    slug: "fadewraps",
    name: "FadeWraps — 1 render",
    description: "One gradient / fade wrap render on your vehicle.",
    unit_amount: 2500,
    return_path: "/fadewraps",
  },
  wbty: {
    slug: "wbty",
    name: "WBTY — 1 calculation",
    description: "One Wrap-By-The-Yard linear-footage calculation.",
    unit_amount: 2500,
    return_path: "/wbty",
  },
  approvemode: {
    slug: "approvemode",
    name: "ApproveMode — 1 proof",
    description: "One client approval proof with revision workflow.",
    unit_amount: 2500,
    return_path: "/approvemode",
  },
  graphicspro: {
    slug: "graphicspro",
    name: "GraphicsPro — 1 render",
    description: "One AI-generated cut-contour graphic on a vehicle zone.",
    unit_amount: 2500,
    return_path: "/graphics-pro",
  },
  printpro: {
    slug: "printpro",
    name: "PrintPro — 1 print-ready file",
    description: "One print-ready production export.",
    unit_amount: 2500,
    return_path: "/printpro",
  },
  visualize: {
    slug: "visualize",
    name: "Visualizer — 1 spin",
    description: "One 360° 3D vehicle visualization.",
    unit_amount: 2500,
    return_path: "/visualize",
  },
  material: {
    slug: "material",
    name: "MaterialMode — 1 render",
    description: "One material / texture visualization render.",
    unit_amount: 2500,
    return_path: "/material",
  },
  gallery: {
    slug: "gallery",
    name: "Gallery — 1 feature credit",
    description: "Feature one of your designs in the public gallery.",
    unit_amount: 2500,
    return_path: "/gallery",
  },
  // $299 done-for-you print-ready production pack. Guest-capable (Stripe
  // collects email). On payment the webhook opens a Print Production Request
  // for the design team — customers never run the panel editor themselves.
  production_pack: {
    slug: "production_pack",
    name: "Print-Ready Production Pack",
    description: "Done-for-you print-ready panel files, paneled and finalized by the RestylePro design team.",
    unit_amount: 29900,
    return_path: "/designpro",
  },
  // $29 Logo Pack — the separated logo/lettering assets lifted clean off the
  // design (owner's separate-purchase model, price set 2026-08-11). On payment
  // productionflow-stripe-webhook (product_type 'logo_pack') opens the
  // logo_pack panelizer job that keys the delivery.
  logo_pack: {
    slug: "logo_pack",
    name: "Logo Pack — separated logo & lettering assets",
    description: "Every logo and lettering element lifted clean off your approved design, with plotter-ready cut files.",
    unit_amount: 2900,
    return_path: "/designpro",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const toolKey = String(body?.tool ?? "").toLowerCase().trim();
    if (toolKey === "approvemode" && !isApproveProLive()) {
      return approveProDisabledResponse();
    }
    const spec = TOOLS[toolKey];
    if (!spec) {
      return new Response(
        JSON.stringify({ error: `Unknown tool: ${toolKey}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const returnPath =
      typeof body?.return_path === "string" && body.return_path.startsWith("/")
        ? body.return_path
        : spec.return_path;

    // Optional auth — if a JWT is present we tag the session with user_id,
    // but the endpoint is intentionally usable while logged out.
    let userId: string | null = null;
    let userEmail: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (jwt && SUPABASE_URL && SERVICE_ROLE) {
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userResp } = await admin.auth.getUser(jwt);
        if (userResp?.user) {
          userId = userResp.user.id;
          userEmail = userResp.user.email ?? null;
        }
      } catch (_) {
        // Anonymous purchase — fall through.
      }
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const origin = req.headers.get("origin") || "";
    const successPath = `${returnPath}${returnPath.includes("?") ? "&" : "?"}single_use=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelPath = `/pay-per-use?canceled=${spec.slug}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: userEmail ?? undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: spec.unit_amount,
            product_data: {
              name: spec.name,
              description: spec.description,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}${cancelPath}`,
      metadata: {
        purchase_type: "single_use",
        tool: spec.slug,
        unit_amount: String(spec.unit_amount),
        user_id: userId ?? "",
        ...(spec.slug === "production_pack"
          ? {
              product_type: "print_production_pack",
              generation_id: typeof body?.generation_id === "string" ? body.generation_id : "",
              render_url: typeof body?.render_url === "string" ? body.render_url : "",
              vehicle_year: body?.vehicle_year ? String(body.vehicle_year) : "",
              vehicle_make: typeof body?.vehicle_make === "string" ? body.vehicle_make : "",
              vehicle_model: typeof body?.vehicle_model === "string" ? body.vehicle_model : "",
            }
          : {}),
        ...(spec.slug === "logo_pack"
          ? {
              // productionflow-stripe-webhook keys the fulfillment job by the
              // canonical DesignIQ generation id it looks up in
              // designiq_generations — pass exactly that id, never a render id.
              product_type: "logo_pack",
              generation_id: typeof body?.generation_id === "string" ? body.generation_id : "",
            }
          : {}),
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, tool: spec.slug, unit_amount: spec.unit_amount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-single-use-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
