import { useState } from "react";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { PrintProSwatch } from "./PrintProSwatch";
import { PrintProThumbnail } from "./PrintProThumbnail";
import { PrintProRenderViewer } from "./PrintProRenderViewer";
import { Button } from "@/components/ui/button";

// Mock data - UI only
const mockSwatches = [
  { name: "Reflective Silver", hex: "#C0C0C0", finish: "Gloss" },
  { name: "Reflective White", hex: "#F5F5F5", finish: "Gloss" },
  { name: "Reflective Yellow", hex: "#FFD700", finish: "Gloss" },
  { name: "Reflective Orange", hex: "#FF8C00", finish: "Gloss" },
];

const mockThumbnails = [
  { imageUrl: "/panels/chrome-red-flames.png", title: "Safety Stripe Kit", subtitle: "High-vis pattern" },
  { imageUrl: "/panels/neon-tactical.png", title: "Emergency Response", subtitle: "First responder design" },
];

const PrintableReflectiveProductPage = () => {
  const [selectedSwatch, setSelectedSwatch] = useState(0);
  const [selectedThumbnail, setSelectedThumbnail] = useState(0);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle>Printable Reflective Film</PrintProCardTitle>
            <PrintProCardDescription>
              High-visibility printable reflective vinyl. Sold by square foot. Perfect for safety applications, emergency vehicles, and high-visibility signage.
            </PrintProCardDescription>
          </PrintProCardHeader>
        </PrintProCard>

        <div className="grid lg:grid-cols-2 gap-8 mb-8">
          <PrintProCard>
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg">Select Reflective Color</PrintProCardTitle>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="grid grid-cols-4 gap-4">
                {mockSwatches.map((swatch, idx) => (
                  <PrintProSwatch
                    key={idx}
                    color={swatch}
                    selected={selectedSwatch === idx}
                    onClick={() => setSelectedSwatch(idx)}
                    size="md"
                  />
                ))}
              </div>
            </PrintProCardContent>
          </PrintProCard>

          <PrintProCard>
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg">Select Design Pattern</PrintProCardTitle>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="grid grid-cols-2 gap-4">
                {mockThumbnails.map((thumb, idx) => (
                  <PrintProThumbnail
                    key={idx}
                    imageUrl={thumb.imageUrl}
                    title={thumb.title}
                    subtitle={thumb.subtitle}
                    selected={selectedThumbnail === idx}
                    onClick={() => setSelectedThumbnail(idx)}
                  />
                ))}
              </div>
            </PrintProCardContent>
          </PrintProCard>
        </div>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">3D Preview (Coming Soon)</PrintProCardTitle>
          </PrintProCardHeader>
          <PrintProCardContent>
            <PrintProRenderViewer views={[]} />
          </PrintProCardContent>
        </PrintProCard>

        <div className="flex justify-center">
          <Button size="lg" disabled className="bg-muted text-muted-foreground cursor-not-allowed">
            Order Printed Reflective Film (Coming Soon)
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PrintableReflectiveProductPage;
