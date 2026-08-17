import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DesignPackEmailRequest {
  email: string;
  designName: string;
  downloadUrl: string;
  expiresAt: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, designName, downloadUrl, expiresAt }: DesignPackEmailRequest = await req.json();

    const expiryDate = new Date(expiresAt).toLocaleString();
    const customerName = email.split('@')[0];

    // Call the templated email function
    const templateResponse = await fetch(
      `${Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')}/functions/v1/send-templated-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          templateSlug: 'design-pack-delivery',
          to: email,
          mergeData: {
            customer_name: customerName,
            design_name: designName,
            download_url: downloadUrl,
            expiry_date: expiryDate
          }
        })
      }
    );

    if (!templateResponse.ok) {
      const errorData = await templateResponse.text();
      console.error("Template email error:", errorData);
      throw new Error(`Failed to send templated email: ${errorData}`);
    }

    const result = await templateResponse.json();
    console.log("Design pack email sent successfully via template:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-design-pack-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
