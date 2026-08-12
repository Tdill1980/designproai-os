import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { HelpCircle, MessageCircle, ArrowLeft, ChevronRight } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

export interface SEOFAQItem {
  question: string;
  answer: string;
}

interface SEOFAQPageProps {
  title: string;
  headline: string;
  description: string;
  canonicalPath: string;
  faqs: SEOFAQItem[];
  relatedPages?: { label: string; path: string }[];
  badgeText?: string;
}

export const SEOFAQPage = ({
  title,
  headline,
  description,
  canonicalPath,
  faqs,
  relatedPages,
  badgeText = "FAQ",
}: SEOFAQPageProps) => {
  // JSON-LD FAQPage structured data for Google rich results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  const canonicalUrl = `https://www.restyleproai.com${canonicalPath}`;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://restyleproai.com" },
      { "@type": "ListItem", position: 2, name: "FAQ", item: "https://restyleproai.com/faq" },
      { "@type": "ListItem", position: 3, name: headline, item: canonicalUrl },
    ],
  };

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
      </Helmet>

      <main className="min-h-screen bg-background">
        {/* Breadcrumb */}
        <div className="container mx-auto px-4 sm:px-6 pt-6">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/faq" className="hover:text-primary transition-colors flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              All FAQs
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-foreground">{badgeText}</span>
          </nav>
        </div>

        {/* Hero */}
        <section className="relative py-12 sm:py-20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="container mx-auto px-4 sm:px-6 relative">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
                <HelpCircle className="w-4 h-4" />
                {badgeText}
              </div>
              <h1 className="text-3xl sm:text-5xl font-bold text-foreground mb-4">
                {headline}
              </h1>
              <p className="text-lg text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ Accordion */}
        <section className="py-8 sm:py-12">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-3xl mx-auto">
              <Accordion type="single" collapsible className="space-y-4">
                {faqs.map((faq, index) => (
                  <AccordionItem
                    key={index}
                    value={`faq-${index}`}
                    className="bg-card border border-border rounded-xl px-6 overflow-hidden"
                  >
                    <AccordionTrigger className="text-left hover:no-underline py-5 [&[data-state=open]>svg]:rotate-180">
                      <span className="font-medium text-foreground pr-4">
                        {faq.question}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground pb-5 pt-0 leading-relaxed">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* Related FAQ Pages */}
        {relatedPages && relatedPages.length > 0 && (
          <section className="py-8 sm:py-12">
            <div className="container mx-auto px-4 sm:px-6">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Explore More FAQs
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {relatedPages.map((page) => (
                    <Link
                      key={page.path}
                      to={page.path}
                      className="flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                    >
                      <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {page.label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="py-12 sm:py-16">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-2xl mx-auto text-center bg-gradient-to-br from-primary/10 via-card to-card border border-border rounded-2xl p-8 sm:p-12">
              <MessageCircle className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
                Still have questions?
              </h2>
              <p className="text-muted-foreground mb-6">
                Our support team is here to help you get the most out of RestyleProAI.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg">
                  <a href="mailto:support@weprintwraps.com">Contact Support</a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/faq">View All FAQs</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};
