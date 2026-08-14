import { HeroCarousel } from "./HeroCarousel";

interface ProductSlide {
  id: string;
  image: string;
  title: string;
  subtitle: string;
  link?: string;
}

interface ProductHeroProps {
  productName: string;
  tagline: string;
  leftSlides: ProductSlide[];
  rightSlides: ProductSlide[];
  showColorProExample?: boolean;
}

export const ProductHero = ({
  productName,
  tagline,
  leftSlides,
  rightSlides,
  showColorProExample
}: ProductHeroProps) => {
  // Combine slides for mobile - interleave 2D proofs and 3D renders
  const combinedSlides = leftSlides.flatMap((leftSlide, i) => {
    const rightSlide = rightSlides[i];
    return rightSlide ? [leftSlide, rightSlide] : [leftSlide];
  }).concat(rightSlides.slice(leftSlides.length));

  return (
    <section className="container mx-auto px-4 pt-20 pb-4 md:pt-24 md:pb-6">
      <div className="max-w-7xl mx-auto">
        {/* Mobile: Title + single combined carousel */}
        <div className="md:hidden">
          <div className="text-center space-y-2 animate-fade-in mb-4">
            <h1 className="text-2xl font-bold tracking-tight leading-tight">
              {productName === "ApproveMode™" || productName === "ApprovePro™" ? (
                <>
                  <span className="text-white">Approve</span>
                  <span className="text-gradient-blue">Pro™</span>
                </>
              ) : productName === "ColorPro™" ? (
                <>
                  <span className="text-white">Color</span>
                  <span className="text-gradient-blue">Pro™</span>
                </>
              ) : productName === "RestyleLibrary™" ? (
                <>
                  <span className="text-white">Restyle</span>
                  <span className="text-gradient-blue">Library™</span>
                </>
              ) : productName === "DesignProAI™" ? (
                <>
                  <span className="text-white">Design</span>
                  <span className="text-gradient-blue">ProAI™</span>
                </>
              ) : (
                <span className="text-white">{productName}</span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed px-2">
              {tagline}
            </p>
          </div>
          
          {/* Single carousel with all slides */}
          <div className="carousel-container h-[250px]">
            <HeroCarousel slides={combinedSlides.length > 0 ? combinedSlides : rightSlides} showColorProExample={showColorProExample} />
          </div>
        </div>

        {/* Desktop layout - 3 column */}
        <div className="hidden md:grid md:grid-cols-3 gap-6 lg:gap-8 items-center">
          {/* Left Carousel - 2D Proof */}
          <div className="carousel-container h-[300px] lg:h-[400px]">
            <HeroCarousel slides={leftSlides} showColorProExample={showColorProExample} />
          </div>

          {/* Center Content */}
          <div className="text-center space-y-2 animate-fade-in">
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
              {productName === "InkFusion™" ? (
                <>
                  <span className="text-white">Ink</span>
                  <span className="text-gradient-blue">Fusion™</span>
                </>
              ) : productName === "WBTY™" ? (
                <>
                  <span className="text-white">WBTY</span>
                  <span className="text-gradient-blue">™</span>
                </>
              ) : productName === "FadeWraps™" ? (
                <>
                  <span className="text-white">Fade</span>
                  <span className="text-gradient-blue">Wraps™</span>
                </>
              ) : productName === "RestyleLibrary™" ? (
                <>
                  <span className="text-white">Restyle</span>
                  <span className="text-gradient-blue">Library™</span>
                </>
              ) : productName === "DesignProAI™" ? (
                <>
                  <span className="text-white">Design</span>
                  <span className="text-gradient-blue">ProAI™</span>
                </>
              ) : productName === "ApproveMode™" || productName === "ApprovePro™" ? (
                <>
                  <span className="text-white">Approve</span>
                  <span className="text-gradient-blue">Pro™</span>
                </>
              ) : productName === "ColorPro™" ? (
                <>
                  <span className="text-white">Color</span>
                  <span className="text-gradient-blue">Pro™</span>
                </>
              ) : (
                <span className="text-white">{productName}</span>
              )}
            </h1>
            
            <div className="max-w-xl mx-auto">
              <p className="text-base lg:text-lg text-muted-foreground leading-relaxed">
                {tagline}
              </p>
            </div>
          </div>

          {/* Right Carousel - 3D Render */}
          <div className="carousel-container h-[300px] lg:h-[400px]">
            <HeroCarousel slides={rightSlides} showColorProExample={showColorProExample} />
          </div>
        </div>
      </div>
    </section>
  );
};
