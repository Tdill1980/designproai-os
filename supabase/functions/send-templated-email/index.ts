import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendEmailRequest {
  templateSlug: string;
  to: string | string[];
  mergeData?: Record<string, string>;
  subject?: string; // Optional override
  shopId?: string; // If provided, shop branding is auto-injected into mergeData
}

function replaceMergeTags(content: string, mergeData: Record<string, string>): string {
  let result = content;
  
  // Add current year automatically
  mergeData.current_year = new Date().getFullYear().toString();
  
  for (const [key, value] of Object.entries(mergeData)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  }
  
  // Remove any unreplaced merge tags
  result = result.replace(/\{\{[^}]+\}\}/g, '');
  
  return result;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { templateSlug, to, mergeData = {}, subject: subjectOverride, shopId }: SendEmailRequest = await req.json();
    if (/^ap-/i.test(String(templateSlug || "")) && !isApproveProLive()) {
      return approveProDisabledResponse();
    }

    if (!templateSlug || !to) {
      return new Response(
        JSON.stringify({ error: "templateSlug and to are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create EXTERNAL Supabase client for data operations
    const supabase = createExternalClient();

    // Auto-inject shop branding from shop_profiles if shopId provided
    if (shopId) {
      const { data: shop } = await supabase
        .from("shop_profiles")
        .select("shop_name, shop_logo_url, phone, email, website")
        .eq("id", shopId)
        .maybeSingle();
      if (shop) {
        mergeData.shop_name = mergeData.shop_name || shop.shop_name || "";
        mergeData.shop_logo_url = mergeData.shop_logo_url || shop.shop_logo_url || "";
        mergeData.shop_phone = mergeData.shop_phone || shop.phone || "";
        mergeData.shop_email = mergeData.shop_email || shop.email || "";
        mergeData.shop_website = mergeData.shop_website || shop.website || "";
      }
    }

    // Fetch template by slug
    const { data: template, error: templateError } = await supabase
      .from("email_templates")
      .select("*")
      .eq("slug", templateSlug)
      .eq("is_active", true)
      .single();

    if (templateError || !template) {
      console.error("Template not found:", templateSlug, templateError);
      return new Response(
        JSON.stringify({ error: `Template '${templateSlug}' not found or inactive` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Replace merge tags in subject and content
    const finalSubject = replaceMergeTags(subjectOverride || template.subject, mergeData);
    const finalHtml = replaceMergeTags(template.html_content, mergeData);
    const finalText = template.text_content ? replaceMergeTags(template.text_content, mergeData) : undefined;

    // Prepare recipient list
    const recipients = Array.isArray(to) ? to : [to];

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: `${template.from_name || 'RestylePro'} <${template.from_email || 'onboarding@resend.dev'}>`,
      to: recipients,
      subject: finalSubject,
      html: finalHtml,
      text: finalText,
    });

    console.log(`Email sent successfully using template '${templateSlug}':`, emailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: emailResponse.data?.id,
        template: templateSlug,
        recipients: recipients.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-templated-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
