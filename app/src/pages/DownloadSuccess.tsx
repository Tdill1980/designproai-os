import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, CheckCircle, Clock, Mail } from "lucide-react";
import { Helmet } from "react-helmet-async";

const DownloadSuccess = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [purchase, setPurchase] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPurchase = async () => {
      if (!sessionId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('design_pack_purchases')
          .select(`
            *,
            designpanelpro_patterns (
              name,
              ai_generated_name,
              clean_display_url,
              media_url
            )
          `)
          .eq('stripe_checkout_id', sessionId)
          .single();

        if (error) throw error;
        setPurchase(data);
      } catch (error) {
        console.error('Error fetching purchase:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPurchase();
  }, [sessionId]);

  const handleDownload = async () => {
    if (!purchase?.download_url) return;

    // Track download
    await supabase
      .from('design_pack_purchases')
      .update({ downloaded_at: new Date().toISOString() })
      .eq('id', purchase.id);

    // Open download link
    window.open(purchase.download_url, '_blank');
  };

  const getDesignName = () => {
    return purchase?.designpanelpro_patterns?.ai_generated_name || 
           purchase?.designpanelpro_patterns?.name || 
           'Design Pack';
  };

  const getDesignImage = () => {
    return purchase?.designpanelpro_patterns?.clean_display_url || 
           purchase?.designpanelpro_patterns?.media_url;
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getOrderId = () => {
    return purchase?.order_number || purchase?.id?.substring(0, 8) || 'N/A';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center p-8">
          <p className="text-foreground">Loading your purchase...</p>
        </main>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center p-8">
          <Card className="p-8 max-w-md text-center">
            <h1 className="text-2xl font-bold mb-4">Purchase Not Found</h1>
            <p className="text-muted-foreground mb-6">
              We couldn't find your purchase. Please check your email for the download link.
            </p>
            <Button onClick={() => window.location.href = '/'}>
              Return to Home
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const isProductionFiles = purchase.purchase_type === 'production_files';
  const expiresAt = purchase.download_expires_at ? new Date(purchase.download_expires_at) : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Purchase Complete | DesignProAI™ Vehicle Wrap Design Suite</title>
      </Helmet>


      <main className="flex-1 container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          {/* Success Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h1 className="text-4xl font-bold mb-4">
              Purchase Complete! 🎉
            </h1>
            <p className="text-xl text-muted-foreground">
              Thank you for your order
            </p>
          </div>

          {/* Order ID Card */}
          <Card className="p-6 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Order Number</p>
                <p className="text-xl font-mono font-bold">#{getOrderId()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground mb-1">Order Date</p>
                <p className="font-semibold">
                  {new Date(purchase.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </Card>

          {/* Purchase Details Card */}
          <Card className="p-8 mb-8">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Design Preview */}
              {getDesignImage() && (
                <div className="md:w-1/3">
                  <img
                    src={getDesignImage()}
                    alt={getDesignName()}
                    className="w-full rounded-lg"
                    style={{ aspectRatio: '3.32 / 1' }}
                  />
                </div>
              )}

              {/* Details */}
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-2">{getDesignName()}</h2>
                <p className="text-muted-foreground mb-4">
                  {isProductionFiles ? 'Production Files' : 'Printed Panels'}
                </p>

                {isProductionFiles && purchase.download_url && (
                  <div className="space-y-4">
                    <Button 
                      onClick={handleDownload}
                      size="lg"
                      className="w-full"
                    >
                      <Download className="w-5 h-5 mr-2" />
                      Download Production Files
                    </Button>

                    {expiresAt && (
                      <div className="flex items-start gap-2 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <Clock className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-yellow-500">Download Link Expires</p>
                          <p className="text-sm text-muted-foreground">
                            {expiresAt.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isProductionFiles && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <p className="font-semibold mb-2">Your Order is Processing</p>
                    <p className="text-sm text-muted-foreground">
                      We'll send you an email confirmation and tracking details once your panels are printed and shipped.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Pricing Breakdown Card */}
          {purchase.order_metadata && (
            <Card className="p-6 mb-8">
              <h3 className="font-semibold text-lg mb-4">Order Summary</h3>
              <div className="space-y-3">
                {purchase.order_metadata.kit_size && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      {purchase.order_metadata.kit_size.charAt(0).toUpperCase() + purchase.order_metadata.kit_size.slice(1)} Kit
                    </span>
                    <span className="font-semibold">
                      {formatPrice(purchase.order_metadata.kit_price)}
                    </span>
                  </div>
                )}

                {purchase.order_metadata.add_hood && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Hood Panel</span>
                    <span className="font-semibold">
                      {formatPrice(purchase.order_metadata.hood_price)}
                    </span>
                  </div>
                )}

                {purchase.order_metadata.add_front_bumper && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Front Bumper</span>
                    <span className="font-semibold">
                      {formatPrice(purchase.order_metadata.front_bumper_price)}
                    </span>
                  </div>
                )}

                {purchase.order_metadata.add_rear_bumper && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Rear Bumper</span>
                    <span className="font-semibold">
                      {formatPrice(purchase.order_metadata.rear_bumper_price)}
                    </span>
                  </div>
                )}

                {purchase.order_metadata.roof_size && purchase.order_metadata.roof_size !== 'none' && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      {purchase.order_metadata.roof_size.charAt(0).toUpperCase() + purchase.order_metadata.roof_size.slice(1)} Roof Panel
                    </span>
                    <span className="font-semibold">
                      {formatPrice(purchase.order_metadata.roof_price)}
                    </span>
                  </div>
                )}

                <div className="border-t border-border pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold">Total Paid</span>
                    <span className="text-lg font-bold">
                      {formatPrice(purchase.order_metadata.total_amount)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Email Notice */}
          <Card className="p-6 mb-8">
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Check Your Email</h3>
                <p className="text-sm text-muted-foreground">
                  We've sent a confirmation email to <strong>{purchase.email}</strong> with 
                  {isProductionFiles ? ' your download link and' : ''} order details.
                </p>
              </div>
            </div>
          </Card>

          {/* What's Included */}
          {isProductionFiles && (
            <Card className="p-6 mb-8">
              <h3 className="font-semibold mb-4">What's Included:</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ High-resolution production files</li>
                <li>✓ Print-ready format</li>
                <li>✓ Installation guide (if applicable)</li>
                <li>✓ 24-hour download access</li>
              </ul>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="outline" 
              onClick={() => window.location.href = '/printpro'}
            >
              Browse More Products
            </Button>
            <Button 
              onClick={() => window.location.href = '/'}
            >
              Back to Design Tools
            </Button>
          </div>
        </div>
      </main>

    </div>
  );
};

export default DownloadSuccess;
