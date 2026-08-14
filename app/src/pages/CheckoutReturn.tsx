import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

const CheckoutReturn = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    if (!sessionId) {
      setStatus("failed");
      return;
    }
    // Stripe embedded checkout redirects here after completion.
    // The webhook handles subscription activation. Show success.
    setStatus("success");
  }, [sessionId]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 mb-6">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Something went wrong</h1>
          <p className="text-[#888] mb-8">
            We couldn't confirm your payment. If you were charged, your subscription will
            activate automatically. Please check your email for confirmation.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/pricing")}>
              Back to Pricing
            </Button>
            <Button onClick={() => navigate("/billing")}>
              Check Billing
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="text-center max-w-lg">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
          <CheckCircle className="w-10 h-10 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">Welcome to DesignProAI!</h1>
        <p className="text-lg text-[#888] mb-2">
          Your subscription is being activated now.
        </p>
        <p className="text-sm text-[#666] mb-8">
          You'll receive a confirmation email shortly. Your 3-day free trial starts today —
          explore all the tools and start creating amazing wrap designs.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => navigate("/colorpro")}
            className="bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#3B82F6] text-white border-0"
          >
            Start Designing
          </Button>
          <Button variant="outline" onClick={() => navigate("/tools")}>
            Explore All Tools
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutReturn;
