import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlertRequest {
  renderId: string;
  renderType: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { renderId, renderType }: AlertRequest = await req.json();
    const supabase = createExternalClient();

    // Check flag threshold (3+ flags on same render)
    const { data: flags, error: flagError } = await supabase
      .from("render_quality_ratings")
      .select("*")
      .eq("render_id", renderId)
      .eq("is_flagged", true);

    if (flagError) {
      console.error("Error fetching flags:", flagError);
      throw flagError;
    }

    const shouldAlertForFlags = flags && flags.length >= 3;

    // Check pattern-level low rating threshold (avg < 3.0 with 5+ ratings)
    const { data: allRatings, error: ratingError } = await supabase
      .from("render_quality_ratings")
      .select("rating, render_id")
      .eq("render_type", renderType)
      .not("rating", "is", null);

    if (ratingError) {
      console.error("Error fetching ratings:", ratingError);
      throw ratingError;
    }

    let shouldAlertForLowRatings = false;
    let patternAverage = 0;
    let totalRatings = 0;

    if (allRatings && allRatings.length >= 5) {
      const sum = allRatings.reduce((acc, r) => acc + (r.rating || 0), 0);
      patternAverage = sum / allRatings.length;
      totalRatings = allRatings.length;
      shouldAlertForLowRatings = patternAverage < 3.0;
    }

    // Send email alert if thresholds met
    if (shouldAlertForFlags || shouldAlertForLowRatings) {
      // Build flag reasons HTML
      let flagReasons = '';
      if (shouldAlertForFlags && flags) {
        flagReasons = flags.map((f, i) => 
          `<li><strong>Flag ${i + 1}:</strong> ${f.flag_reason}${f.notes ? ` - ${f.notes}` : ''}</li>`
        ).join('');
      }

      // Call the templated email function
      const templateResponse = await fetch(
        `${getExternalSupabaseUrl()}/functions/v1/send-templated-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getExternalServiceRoleKey()}`
          },
          body: JSON.stringify({
            templateSlug: 'quality-alert',
            to: 'admin@restyleproai.com',
            subject: `⚠️ Quality Alert: ${renderType.toUpperCase()} Render Issues`,
            mergeData: {
              render_id: renderId,
              render_type: renderType.toUpperCase(),
              flag_count: String(flags?.length || 0),
              average_rating: patternAverage.toFixed(2),
              total_ratings: String(totalRatings),
              flag_reasons: flagReasons || 'N/A',
              has_flags: shouldAlertForFlags ? 'true' : 'false',
              has_low_ratings: shouldAlertForLowRatings ? 'true' : 'false'
            }
          })
        }
      );

      console.log("Alert email sent via template:", await templateResponse.json());

      return new Response(
        JSON.stringify({ 
          alertSent: true, 
          flagCount: flags?.length || 0,
          averageRating: patternAverage,
          message: "Quality alert sent to admins" 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        alertSent: false, 
        message: "No thresholds exceeded" 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in quality-threshold-alert function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
