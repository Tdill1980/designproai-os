import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { FadeWrapToolUI } from "@/components/productTools/FadeWrapToolUI";

const FadeWraps = () => {
  const [searchParams] = useSearchParams();
  const renderId = searchParams.get("renderId");
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>FadeWraps - Premium Gradient Wrap Designer | RestyleProAI</title>
        <meta name="description" content="Create stunning gradient wraps with FadeWraps. Premium gradient patterns with panel kits and photorealistic 3D renders." />
        <link rel="canonical" href="https://www.restyleproai.com/fadewraps" />
      </Helmet>

      <main className="flex-1 pt-2 pb-6">
        <FadeWrapToolUI preloadRenderId={renderId} />
      </main>
    </div>
  );
};

export default FadeWraps;
