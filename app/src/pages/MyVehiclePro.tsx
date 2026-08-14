import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { MyVehicleToolCore } from "@/components/colorpro/MyVehicleToolCore";
import { ToolContainer } from "@/components/layout/ToolContainer";

const MyVehiclePro = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>MyVehicle Pro - Upload Your Vehicle Photo & Visualize Wraps | RestyleProAI</title>
        <meta name="description" content="Upload a photo of your actual vehicle and see any wrap color, design, or graphic applied to it instantly with AI. The ultimate vehicle wrap visualization tool." />
        <link rel="canonical" href="https://www.restyleproai.com/myvehiclepro" />
        <meta property="og:title" content="MyVehicle Pro - Upload Your Vehicle Photo & Visualize Wraps | RestyleProAI" />
        <meta property="og:description" content="Upload a photo of your actual vehicle and see any wrap color, design, or graphic applied to it instantly with AI." />
        <meta property="og:url" content="https://www.restyleproai.com/myvehiclepro" />
      </Helmet>

      <main className="flex-1">
        <section className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <MyVehicleToolCore />
          </ToolContainer>
        </section>
      </main>
    </div>
  );
};

export default MyVehiclePro;
