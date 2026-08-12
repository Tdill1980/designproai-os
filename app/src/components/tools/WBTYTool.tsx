import { useWBTYLogic } from "@/hooks/useWBTYLogic";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaywallModal } from "@/components/PaywallModal";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download } from "lucide-react";

export const WBTYTool = () => {
  const {
    selectedProduct,
    setSelectedProduct,
    yardsNeeded,
    setYardsNeeded,
    products,
    isLoading,
    pricePerYard,
    totalPrice,
    productId,
    hasReachedLimit,
    remainingGenerations,
    showFallback,
    setShowFallback,
    generateRender,
    isGenerating,
    generatedImageUrl,
    selectedFinish,
    setSelectedFinish,
    patternScale,
    setPatternScale,
    additionalViews,
    generateAdditionalViews,
    isGeneratingAdditional,
  } = useWBTYLogic();

  const [vehicleYear, setVehicleYear] = useState("2022");
  const [vehicleMake, setVehicleMake] = useState("Ford");
  const [vehicleModel, setVehicleModel] = useState("Mustang");

  const [paywallOpen, setPaywallOpen] = useState(false);
  const { toast } = useToast();

  const handleDownload = async (imageUrl: string, filename: string) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Download Started",
        description: `${filename} is downloading`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Could not download the image",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="grid lg:grid-cols-2 gap-6">
        <Skeleton className="h-[600px]" />
        <Skeleton className="h-[600px]" />
      </div>
    );
  }

  const handleGenerate = async () => {
    if (hasReachedLimit) {
      setPaywallOpen(true);
      return;
    }
    
    await generateRender(vehicleYear, vehicleMake, vehicleModel);
  };

  const handleAddToCart = () => {
    toast({
      title: "Added to Cart",
      description: `${yardsNeeded} yards added to cart`,
    });
  };

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left Side - Pattern Selector & Yards */}
        <div className="space-y-6">
          {/* Yards Calculator */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Yards Needed</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="yards">Number of Yards</Label>
                <Input
                  id="yards"
                  type="number"
                  min="1"
                  value={yardsNeeded}
                  onChange={(e) => setYardsNeeded(parseInt(e.target.value) || 1)}
                  className="mt-2"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Price per yard: ${pricePerYard.toFixed(2)}</p>
              </div>
            </div>
          </Card>

          {/* Pattern Selector */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Select Pattern</h3>
            <ScrollArea className="h-96">
              <div className="grid grid-cols-2 gap-3 pr-4">
                {products?.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProduct(product)}
                    className={`aspect-square rounded-lg border-2 transition-all hover:scale-105 overflow-hidden ${
                      selectedProduct?.id === product.id
                        ? "border-primary shadow-lg shadow-primary/20"
                        : "border-border"
                    }`}
                  >
                    <img
                      src={product.media_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </ScrollArea>
            
            {selectedProduct && (
              <div className="mt-4 p-4 bg-secondary/20 rounded-lg border border-border">
                <h4 className="font-semibold mb-2">{selectedProduct.name}</h4>
                {selectedProduct.category && (
                  <p className="text-sm text-muted-foreground">Family: {selectedProduct.category}</p>
                )}
              </div>
            )}
          </Card>

          {/* Pricing */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Total Price</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price per Yard</span>
                <span className="font-semibold">${pricePerYard.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Yards Needed</span>
                <span className="font-semibold">{yardsNeeded}</span>
              </div>
              <div className="h-px bg-border"></div>
              <div className="flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-primary">${totalPrice.toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Product ID: {productId}</p>
            </div>
          </Card>
        </div>

        {/* Right Side - 3D Preview */}
        <div className="space-y-6">
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">3D Preview - Hero View</h3>
              {generatedImageUrl && (
                <Button
                  onClick={() => handleDownload(generatedImageUrl, `wbty-hero-${selectedProduct?.name || 'render'}.png`)}
                  variant="outline"
                  size="sm"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              )}
            </div>
            <div className="aspect-video border-2 border-border rounded-lg flex items-center justify-center bg-secondary/20 overflow-hidden">
              {isGenerating ? (
                <div className="text-center text-muted-foreground">
                  <p className="mb-2">Generating 3D proof...</p>
                  <p className="text-sm">This may take a few moments</p>
                </div>
              ) : generatedImageUrl ? (
                <img
                  src={generatedImageUrl}
                  alt="Generated 3D Preview"
                  className="w-full h-full object-cover"
                />
              ) : selectedProduct ? (
                <img
                  src={selectedProduct.media_url}
                  alt="Pattern Swatch"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center text-muted-foreground">
                  <p className="mb-2">Select a pattern to preview</p>
                  <p className="text-sm">3D render will appear here</p>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6 bg-card border-border space-y-4">
            <Button 
              onClick={handleGenerate}
              disabled={!selectedProduct || hasReachedLimit || isGenerating}
              variant="default"
              size="lg"
              className="w-full"
            >
              {isGenerating ? "Generating..." : hasReachedLimit ? "Limit Reached - Upgrade to Continue" : "Generate 3D Proof"}
            </Button>

            {/* Generate Additional Views Button - Shows after hero view is generated */}
            {generatedImageUrl && (
              <Button 
                onClick={() => generateAdditionalViews(vehicleYear, vehicleMake, vehicleModel)}
                disabled={isGeneratingAdditional}
                variant="secondary"
                size="lg"
                className="w-full"
              >
                {isGeneratingAdditional ? "Generating Additional Views..." : additionalViews ? "Regenerate Additional Views" : "Generate Additional Views"}
              </Button>
            )}

            {/* Display additional views when available */}
            {additionalViews && (
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-sm font-semibold">Additional Views</h4>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(additionalViews).map(([viewType, url]) => (
                    <div key={viewType} className="space-y-2">
                      <div className="relative group">
                        <img
                          src={url}
                          alt={`${viewType} view`}
                          className="w-full aspect-square object-cover rounded-lg border border-border"
                        />
                        <Button
                          onClick={() => handleDownload(url, `wbty-${viewType}-${selectedProduct?.name || 'render'}.png`)}
                          variant="secondary"
                          size="sm"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-center text-muted-foreground capitalize">{viewType}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button 
              variant="outline"
              size="lg"
              className="w-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Your Design
            </Button>

            <Button 
              onClick={handleAddToCart}
              disabled={!selectedProduct}
              variant="gradient"
              size="lg"
              className="w-full"
            >
              Add {yardsNeeded} Yard{yardsNeeded > 1 ? 's' : ''} to Cart
            </Button>

            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                {remainingGenerations > 0 
                  ? `${remainingGenerations} free 3D previews remaining` 
                  : "Upgrade for unlimited 3D previews"}
              </p>
            </div>
          </Card>
        </div>
      </div>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onShowExample={() => setShowFallback(true)}
        productType="wbty"
      />
    </>
  );
};
