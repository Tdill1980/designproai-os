import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";

const TEST_PREFIX = "[VALIDATION — DO NOT PUBLISH]";

export default function MarketingValidationSeeder() {
  const [busy, setBusy] = useState(false);

  const createValidationSet = async () => {
    setBusy(true);
    const stamp = new Date().toISOString();
    const db = supabase as any;

    try {
      const inserts = [
        db.from("agent_social_posts").insert({
          brand: "designproai",
          platform: "instagram",
          post_type: "feed",
          caption: `${TEST_PREFIX} DesignProAI prompt-to-production proof post. Created ${stamp}.`,
          media_urls: [],
          status: "needs_review",
          created_by: "platform-director-validation",
        }),
        db.from("agent_email_campaigns").insert({
          brand: "designproai",
          campaign_name: `${TEST_PREFIX} DesignProAI launch proof email`,
          campaign_type: "validation",
          subject_line: `${TEST_PREFIX} Prompt to production, verified`,
          preview_text: "Internal validation record. Do not send.",
          body_text: "Internal validation content for the DesignProAI launch workflow. This record must remain in review and must not be sent.",
          list_segment: "INTERNAL_VALIDATION_ONLY",
          status: "needs_review",
          created_by: "platform-director-validation",
        }),
        db.from("agent_ad_campaigns").insert({
          brand: "designproai",
          platform: "meta",
          campaign_name: `${TEST_PREFIX} Commercial wrap proof ad`,
          headline: "From prompt to production-ready wrap files",
          ad_type: "validation",
          media_urls: [],
          status: "needs_review",
          created_by: "platform-director-validation",
        }),
        db.from("agent_blog_posts").insert({
          brand: "designproai",
          title: `${TEST_PREFIX} How prompt-to-production changes wrap design`,
          slug: `validation-designproai-${Date.now()}`,
          platform: "website",
          featured_image_url: null,
          status: "needs_review",
          created_by: "platform-director-validation",
        }),
        db.from("slack_agent_tasks").insert({
          brand: "designproai",
          category: "marketing",
          task_type: "design_request",
          title: `${TEST_PREFIX} Design request — commercial wrap case study`,
          description: "Create one clean white-UI case-study asset using verified DesignProAI output. Internal validation only.",
          status: "pending",
          priority: "medium",
          assigned_to: "carley",
          created_by: "platform-director-validation",
          metadata: { approval_stage: "needs_review", validation_only: true, publish_allowed: false },
        }),
        db.from("slack_agent_tasks").insert({
          brand: "designproai",
          category: "marketing",
          task_type: "seo_task",
          title: `${TEST_PREFIX} SEO brief — prompt-to-print vehicle wrap software`,
          description: "Prepare a keyword and page-outline brief using verified product claims only. Internal validation only.",
          status: "pending",
          priority: "medium",
          assigned_to: "jackson",
          created_by: "platform-director-validation",
          metadata: { approval_stage: "needs_review", validation_only: true, publish_allowed: false },
        }),
      ];

      const results = await Promise.all(inserts);
      const errors = results.map((result: any) => result.error).filter(Boolean);
      if (errors.length) throw new Error(errors.map((error: any) => error.message).join(" | "));

      toast.success("Created six native validation items. All remain pending or needs review.");
    } catch (error: any) {
      toast.error(`Validation set was not fully created: ${error?.message ?? String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-gray-950">
            <FlaskConical className="h-4 w-4 text-amber-700" /> Marketing system validation
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-700">
            Creates one native test record for Blog, Social, Email, Ad, Design Request, and SEO. Every record is clearly marked validation-only and remains pending or needs review.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={createValidationSet}>
          {busy ? "Creating validation set…" : "Create six safe test items"}
        </Button>
      </div>
    </section>
  );
}
