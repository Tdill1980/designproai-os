import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { SEOBreadcrumb } from "@/components/SEOBreadcrumb";
import { Search, HelpCircle, ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { faqData, faqCategories, FAQCategory } from "@/data/faqData";
import { faqRelatedPages } from "@/data/faqRelatedPages";
import { Link } from "react-router-dom";

const FAQ = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FAQCategory | "all">("all");

  const filteredFAQs = useMemo(() => {
    let results = faqData;

    // Filter by category
    if (activeCategory !== "all") {
      results = results.filter((faq) => faq.category === activeCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      results = results.filter(
        (faq) =>
          faq.question.toLowerCase().includes(query) ||
          faq.answer.toLowerCase().includes(query)
      );
    }

    return results;
  }, [searchQuery, activeCategory]);

  const getCategoryCount = (category: FAQCategory) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return faqData.filter(
        (faq) =>
          faq.category === category &&
          (faq.question.toLowerCase().includes(query) ||
            faq.answer.toLowerCase().includes(query))
      ).length;
    }
    return faqData.filter((faq) => faq.category === category).length;
  };

  const totalCount = searchQuery.trim()
    ? filteredFAQs.length
    : faqData.length;

  return (
    <>
      <Helmet>
        <title>FAQ | DesignProAI™ Vehicle Wrap Design Suite</title>
        <meta
          name="description"
          content="Find answers about the world's first prompt-to-production vehicle wrap design software. Learn about DesignProAI tools, pricing, wrap design, and print-ready output. Design it. Panel it. Print it."
        />
        <link rel="canonical" href="https://designproai.com/faq" />
        <meta property="og:title" content="FAQ | DesignProAI™ Vehicle Wrap Design Suite" />
        <meta property="og:description" content="Find answers about AI vehicle wrap design, pricing, print-ready output, and more." />
        <meta property="og:url" content="https://designproai.com/faq" />
        <meta property="og:image" content="https://designproai.com/hero-mustang.jpg" />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqData.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer,
              },
            })),
          })}
        </script>
      </Helmet>
      <SEOBreadcrumb items={[{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }]} />


      <main className="min-h-screen bg-background">
        {/* Hero Section */}
        <section className="relative py-16 sm:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="container mx-auto px-4 sm:px-6 relative">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
                <HelpCircle className="w-4 h-4" />
                Help Center
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
                Frequently Asked Questions
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                Everything you need to know about DesignProAI™ Vehicle Wrap Design Suite
              </p>

              {/* Search Input */}
              <div className="relative max-w-xl mx-auto">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 pr-4 py-6 text-lg bg-card border-border rounded-xl shadow-lg"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {searchQuery && (
                <p className="mt-4 text-muted-foreground">
                  Found <span className="font-semibold text-foreground">{filteredFAQs.length}</span> result{filteredFAQs.length !== 1 ? "s" : ""} for "{searchQuery}"
                </p>
              )}
            </div>
          </div>
        </section>

        {/* FAQ Content */}
        <section className="py-8 sm:py-12">
          <div className="container mx-auto px-4 sm:px-6">
            <Tabs
              value={activeCategory}
              onValueChange={(value) => setActiveCategory(value as FAQCategory | "all")}
              className="w-full"
            >
              {/* Category Tabs */}
              <div className="flex justify-center mb-8">
                <TabsList className="inline-flex h-auto flex-wrap gap-2 bg-card/50 p-2 rounded-xl">
                  <TabsTrigger
                    value="all"
                    className="px-4 py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    All ({totalCount})
                  </TabsTrigger>
                  {faqCategories.map((cat) => (
                    <TabsTrigger
                      key={cat.id}
                      value={cat.id}
                      className="px-4 py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      {cat.label} ({getCategoryCount(cat.id)})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* FAQ Accordion */}
              <div className="max-w-3xl mx-auto">
                <TabsContent value={activeCategory} className="mt-0">
                  {filteredFAQs.length > 0 ? (
                    <Accordion type="single" collapsible className="space-y-4">
                      {filteredFAQs.map((faq, index) => (
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
                          <AccordionContent className="text-muted-foreground pb-5 pt-0">
                            {faq.answer}
                            <div className="mt-3">
                              <span className="inline-block text-xs font-medium px-2 py-1 bg-primary/10 text-primary rounded-full capitalize">
                                {faq.category === 'pricing' ? 'Pricing & Plans' : faq.category}
                              </span>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  ) : (
                    <div className="text-center py-12 bg-card border border-border rounded-xl">
                      <HelpCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-foreground mb-2">
                        No results found
                      </h3>
                      <p className="text-muted-foreground mb-4">
                        We couldn't find any questions matching "{searchQuery}"
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearchQuery("");
                          setActiveCategory("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </section>

        {/* Browse by Topic */}
        <section className="py-8 sm:py-12">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
                Browse FAQs by Topic
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {faqRelatedPages.map((page) => (
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

        {/* Still Have Questions CTA */}
        <section className="py-12 sm:py-16">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="max-w-2xl mx-auto text-center bg-gradient-to-br from-primary/10 via-card to-card border border-border rounded-2xl p-8 sm:p-12">
              <MessageCircle className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
                Still have questions?
              </h2>
              <p className="text-muted-foreground mb-6">
                Can't find the answer you're looking for? Our support team is here to help.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg">
                  <a href="mailto:support@weprintwraps.com">Contact Support</a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/user-guide">View User Guide</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

    </>
  );
};

export default FAQ;
