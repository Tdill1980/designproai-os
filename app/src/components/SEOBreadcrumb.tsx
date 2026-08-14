import { Helmet } from "react-helmet-async";

export interface BreadcrumbItem {
  name: string;
  path: string;
}

interface SEOBreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Injects BreadcrumbList JSON-LD structured data into the page head.
 * Does NOT render visible UI — pages handle their own visual breadcrumbs.
 *
 * Usage:
 *   <SEOBreadcrumb items={[
 *     { name: "Home", path: "/" },
 *     { name: "Pricing", path: "/pricing" },
 *   ]} />
 */
export const SEOBreadcrumb = ({ items }: SEOBreadcrumbProps) => {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `https://designproai.com${item.path}`,
    })),
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
};
