import { useState } from 'react';
import { Monitor, Smartphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/contexts/OrganizationContext';

interface TemplatePreviewProps {
  html: string;
  subject: string;
}

// Sample data for preview — shows what the email will look like with real values.
// Shop-specific tags (shop_name, shop_logo_url, shop_phone, shop_website) are
// overridden at render time with the signed-in shop's real values so the
// preview reflects what the customer will actually receive.
const SAMPLE_DATA: Record<string, string> = {
  customer_name: 'John Smith',
  customer_email: 'john@example.com',
  design_name: 'Carbon Fiber Pro',
  vehicle_name: '2024 Porsche 911 GT3',
  download_url: 'https://restylepro.com/download/abc123',
  expiry_date: 'December 15, 2025',
  order_id: 'ORD-2024-001234',
  shop_name: 'Elite Wraps Studio',
  shop_logo_url: 'https://designproai.com/sprocket/restyleproai-logo.png',
  shop_phone: '(555) 123-4567',
  shop_email: 'hello@elitewraps.com',
  shop_website: 'www.elitewraps.com',
  app_url: 'https://restylepro.com',
  magic_link: 'https://restylepro.com/auth/magic?token=xyz',
  render_type: 'ColorPro',
  render_id: 'render-12345',
  rating: '2',
  flag_reason: 'Color accuracy issue',
  admin_url: 'https://restylepro.com/admin/quality',
  current_year: new Date().getFullYear().toString(),
  quote_url: 'https://restylepro.com/quotes/abc123',
  care_sheet_url: 'https://restylepro.com/care/abc123.pdf',
  gallery_url: 'https://restylepro.com/gallery',
  library_url: 'https://restylepro.com/library',
  hero_image_url: 'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/colorpro/1775249634733_Chevrolet_Corvette%20C8_side.png',
  discount_percent: '20',
  sale_end_date: 'April 30, 2026',
  price: '$2,499',
};

export function TemplatePreview({ html, subject }: TemplatePreviewProps) {
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [key, setKey] = useState(0);
  const { currentShop } = useOrganization();

  // Override sample shop tags with the signed-in shop's real values so the
  // logo, name, phone, and website match what the customer will see when the
  // shop sends the email. Falls back to SAMPLE_DATA when a field is unset or
  // no shop is selected (admin/global preview).
  const mergeData: Record<string, string> = {
    ...SAMPLE_DATA,
    ...(currentShop?.name ? { shop_name: currentShop.name } : {}),
    ...(currentShop?.logo_url ? { shop_logo_url: currentShop.logo_url } : {}),
    ...(currentShop?.phone ? { shop_phone: currentShop.phone } : {}),
    ...(currentShop?.website ? { shop_website: currentShop.website } : {}),
  };

  // Replace merge tags with sample data
  const processedHtml = Object.entries(mergeData).reduce(
    (acc, [tag, value]) => acc.replace(new RegExp(`{{${tag}}}`, 'g'), value),
    html
  );

  const processedSubject = Object.entries(mergeData).reduce(
    (acc, [tag, value]) => acc.replace(new RegExp(`{{${tag}}}`, 'g'), value),
    subject
  );

  const fromDisplayName = currentShop?.name ?? 'DesignProAI';

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Preview Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Preview</h3>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'desktop' | 'mobile')}>
            <TabsList className="h-8">
              <TabsTrigger value="desktop" className="h-7 px-2">
                <Monitor className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="mobile" className="h-7 px-2">
                <Smartphone className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => setKey(k => k + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Email Header Preview */}
      <div className="p-3 border-b border-border bg-muted/30">
        <div className="space-y-1 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16">From:</span>
            <span className="text-foreground">{fromDisplayName} &lt;onboarding@resend.dev&gt;</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16">To:</span>
            <span className="text-foreground">{mergeData.customer_email}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16">Subject:</span>
            <span className="text-foreground font-medium">{processedSubject}</span>
          </div>
        </div>
      </div>

      {/* Email Body Preview */}
      <div 
        className={`bg-white transition-all duration-300 ${
          viewMode === 'mobile' ? 'max-w-[375px] mx-auto' : 'max-w-full'
        }`}
      >
        <iframe
          key={key}
          srcDoc={processedHtml}
          className="w-full h-[500px] border-0"
          title="Email Preview"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
