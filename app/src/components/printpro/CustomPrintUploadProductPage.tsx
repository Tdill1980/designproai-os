import { useState } from "react";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload } from "lucide-react";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";

const CustomPrintUploadProductPage = () => {
  const [vehicleSize, setVehicleSize] = useState<string>("");
  const [customWidth, setCustomWidth] = useState<string>("");
  const [customHeight, setCustomHeight] = useState<string>("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const vehicleSizes = {
    compact: { sqft: 250, label: "Compact Car (250 sq ft)" },
    sedan: { sqft: 300, label: "Sedan (300 sq ft)" },
    suv: { sqft: 400, label: "SUV (400 sq ft)" },
    truck: { sqft: 450, label: "Truck (450 sq ft)" },
    van: { sqft: 500, label: "Van/Commercial (500 sq ft)" },
  };

  const calculateSqFt = (): number => {
    if (customWidth && customHeight) {
      const width = parseFloat(customWidth);
      const height = parseFloat(customHeight);
      return Math.ceil((width * height) / 144); // Convert inches to sq ft
    }
    if (vehicleSize && vehicleSize in vehicleSizes) {
      return vehicleSizes[vehicleSize as keyof typeof vehicleSizes].sqft;
    }
    return 0;
  };

  const calculatePrice = (): number => {
    const sqft = calculateSqFt();
    return sqft * 12; // $12 per sq ft
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  const handleAddToCart = () => {
    const sqft = calculateSqFt();
    const price = calculatePrice();
    
    // Track conversion event (fire-and-forget)
    trackQuoteEvent({
      eventType: "order_now_clicked",
      quoteId: generateQuoteId(),
      productType: "custom_print",
      metadata: { 
        sqft, 
        price, 
        vehicleSize: vehicleSize || "custom",
        fileName: uploadedFile?.name 
      },
    });
    
    // Redirect to store with ApprovePro print service
    window.open(
      `https://weprintwraps.com/cart/?add-to-cart=APPROVEPRO_PRINT&sqft=${sqft}&price=${price}`,
      "_blank"
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle>
              <span className="text-foreground">Approve</span><span className="text-gradient-designpro">Pro™</span><span className="text-foreground"> Print Service</span>
            </PrintProCardTitle>
            <PrintProCardDescription>
              Upload your print-ready artwork and we'll print it on high-quality vinyl. Perfect for 2D designs that need professional printing.
            </PrintProCardDescription>
          </PrintProCardHeader>
        </PrintProCard>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">Calculate Square Footage</PrintProCardTitle>
          </PrintProCardHeader>
          <PrintProCardContent className="space-y-6">
            <div>
              <Label htmlFor="vehicleSize">Select Vehicle Size</Label>
              <Select value={vehicleSize} onValueChange={setVehicleSize}>
                <SelectTrigger id="vehicleSize">
                  <SelectValue placeholder="Choose vehicle size..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(vehicleSizes).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or enter custom dimensions</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="width">Width (inches)</Label>
                <Input
                  id="width"
                  type="number"
                  placeholder="60"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="height">Height (inches)</Label>
                <Input
                  id="height"
                  type="number"
                  placeholder="30"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                />
              </div>
            </div>

            {calculateSqFt() > 0 && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Coverage</p>
                <p className="text-2xl font-bold">{calculateSqFt()} sq ft</p>
                <p className="text-lg mt-2">Price: ${calculatePrice()}</p>
                <p className="text-xs text-muted-foreground mt-1">$12 per square foot</p>
              </div>
            )}
          </PrintProCardContent>
        </PrintProCard>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">Upload Print-Ready Artwork</PrintProCardTitle>
            <PrintProCardDescription>
              Accepted formats: PDF, AI, EPS, PNG, JPG (high resolution)
            </PrintProCardDescription>
          </PrintProCardHeader>
          <PrintProCardContent>
            <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
              <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <Label htmlFor="fileUpload" className="cursor-pointer">
                <p className="text-lg font-medium mb-2">
                  {uploadedFile ? uploadedFile.name : "Click to upload design file"}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Maximum file size: 50MB
                </p>
              </Label>
              <Input
                id="fileUpload"
                type="file"
                accept=".pdf,.ai,.eps,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button variant="outline" onClick={() => document.getElementById("fileUpload")?.click()}>
                Browse Files
              </Button>
            </div>
          </PrintProCardContent>
        </PrintProCard>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">2D → 3D Proof Example</PrintProCardTitle>
            <PrintProCardDescription>
              How your flat design will look installed on a vehicle
            </PrintProCardDescription>
          </PrintProCardHeader>
          <PrintProCardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2 text-center">2D Design</p>
                <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground text-sm">Flat design preview</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2 text-center">3D Installed</p>
                <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground text-sm">3D render preview</p>
                </div>
              </div>
            </div>
          </PrintProCardContent>
        </PrintProCard>

        <div className="flex justify-center">
          <Button 
            size="lg" 
            disabled={calculateSqFt() === 0 || !uploadedFile}
            onClick={handleAddToCart}
            className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
          >
            Order Custom Print - ${calculatePrice()}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CustomPrintUploadProductPage;
