import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Triggers the GitHub Actions "Deploy Supabase Edge Functions" workflow
 * with a list of function names to deploy.
 *
 * Body: { functions: string[] }
 * Requires GITHUB_DEPLOY_TOKEN secret (PAT with `actions:write` scope)
 */
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { functions } = await req.json() as { functions: string[] };

    if (!functions || !Array.isArray(functions) || functions.length === 0) {
      return new Response(
        JSON.stringify({ error: "functions[] is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = Deno.env.get("GITHUB_DEPLOY_TOKEN");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "GITHUB_DEPLOY_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const owner = "Tdill1980";
    const repo = "restylepro-os";
    const workflowId = "deploy-edge-functions.yml";
    const ref = "main";

    const functionsList = functions.join(",");

    console.log(`Triggering deploy for: ${functionsList}`);

    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref,
          inputs: { functions: functionsList },
        }),
      },
    );

    if (!ghResponse.ok) {
      const errText = await ghResponse.text();
      console.error("GitHub API error:", ghResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `GitHub API returned ${ghResponse.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Deploy triggered for: ${functionsList}`,
        functions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("trigger-deploy error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

serve(handler);
