import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Loader2, CheckCircle, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RenderQualityRating } from "@/types/render-quality";

interface CustomerStatusEmailProps {
  rating: RenderQualityRating;
  onEmailSent: () => void;
}

const toolUrls: Record<string, string> = {
  colorpro: "https://lovable-restylepro-builder.lovable.app/colorpro",
  designpanelpro: "https://lovable-restylepro-builder.lovable.app/designpro",
  fadewraps: "https://lovable-restylepro-builder.lovable.app/fadewraps",
  wbty: "https://lovable-restylepro-builder.lovable.app/wbty",
  approvemode: "https://lovable-restylepro-builder.lovable.app/approvemode",
};

const toolDisplayNames: Record<string, string> = {
  colorpro: "ColorPro",
  designpanelpro: "DesignPanelPro",
  fadewraps: "FadeWraps",
  wbty: "PatternPro",
  approvemode: "ApprovePro",
};

export function CustomerStatusEmail({ rating, onEmailSent }: CustomerStatusEmailProps) {
  const [isSending, setIsSending] = useState(false);

  const sendEmail = async (templateSlug: "quality-issue-working" | "quality-issue-resolved") => {
    if (!rating.user_email) {
      toast({
        title: "No email address",
        description: "This rating doesn't have an associated customer email",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-templated-email", {
        body: {
          templateSlug,
          to: rating.user_email,
          mergeData: {
            customer_name: rating.user_email.split("@")[0],
            tool_name: toolDisplayNames[rating.render_type] || rating.render_type,
            issue_description: rating.notes || rating.flag_reason || "Quality issue with your render",
            tool_url: toolUrls[rating.render_type] || "https://lovable-restylepro-builder.lovable.app",
          },
        },
      });

      if (error) throw error;

      // Update the rating with notification timestamp
      await supabase
        .from("render_quality_ratings")
        .update({
          customer_notified_at: new Date().toISOString(),
        })
        .eq("id", rating.id);

      toast({
        title: "Email Sent!",
        description: `Status update sent to ${rating.user_email}`,
      });
      onEmailSent();
    } catch (error) {
      console.error("Error sending email:", error);
      toast({
        title: "Failed to send email",
        description: "Check the edge function logs for details",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Customer Communication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!rating.user_email ? (
          <p className="text-sm text-muted-foreground">
            No customer email associated with this rating
          </p>
        ) : (
          <>
            <p className="text-sm text-foreground">
              <strong>Customer:</strong> {rating.user_email}
            </p>
            
            {rating.customer_notified_at && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle className="h-4 w-4" />
                Customer notified on{" "}
                {new Date(rating.customer_notified_at).toLocaleDateString()}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => sendEmail("quality-issue-working")}
                disabled={isSending}
                variant="outline"
                size="sm"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Clock className="h-4 w-4 mr-2" />
                )}
                Send "Working on Fix" Email
              </Button>
              <Button
                onClick={() => sendEmail("quality-issue-resolved")}
                disabled={isSending}
                size="sm"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Send "Issue Resolved" Email
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
