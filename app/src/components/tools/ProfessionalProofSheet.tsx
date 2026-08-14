import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Download, Printer, Share2, Loader2, FileImage, Mail, Check, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { generateAndSaveProof, loadShopProfile, type ProofRequest } from '@/lib/proof-service';
import { getToolLabel, type ToolKey } from '@/lib/tool-registry';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { attachAsset } from '@/lib/quickquote-db';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { findVehicle } from '@/data/vehicle-measurements';
import { sqFtToYards } from '@/lib/quick-quote';
import { useTermsOnboarding } from '@/hooks/useTermsOnboarding';
import { ShopTermsOnboardingWizard } from './ShopTermsOnboardingWizard';
import { TwoDProofSheet } from './TwoDProofSheet';
import { EmailConfigurator } from './EmailConfigurator';
// Lazy so the proof sheet doesn't drag the entire QuickQuote estimator
// bundle into every tool's initial paint. Only loaded when the rep
// clicks "+ New" to create a quote inline.
const QuickQuoteDialog = lazy(() =>
  import('@/components/dashboard/QuickQuoteDialog').then((m) => ({ default: m.QuickQuoteDialog })),
);

// Loose row shapes — `quotes` and `orders` are referenced as `any` everywhere
// else in this codebase because the generated types file is too large to
// regenerate. Treat the query result as untyped here too.
type LinkedCustomer = { name?: string | null; email?: string | null; phone?: string | null } | null;
type QuoteSearchRow = {
  id: string;
  quote_number: string;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  customers?: LinkedCustomer;
};
type OrderSearchRow = {
  id: string;
  order_number: string;
  quote_id?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  customers?: LinkedCustomer;
};
const db = supabase as any;

interface RenderView {
  type: string;
  url: string;
  label?: string;
}

interface MaterialZone {
  zone: string;
  color: string;
  finish: string;
  manufacturer?: string;
  yardsEstimate: number;
}

interface MaterialEstimateData {
  totalYards: number;
  totalSquareFeet: number;
  vehicleCategory: string;
  zones: MaterialZone[];
}

interface ProfessionalProofSheetProps {
  views: RenderView[];
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  /** Tool key from registry - PREFERRED */
  toolKey?: ToolKey;
  /** Legacy: free-form tool name */
  toolName?: string;
  designName?: string;
  manufacturer?: string;
  colorName?: string;
  productCode?: string;
  finish?: string;
  hex?: string;
  shopName?: string;
  shopLogo?: string;
  userTier?: 'basic' | 'pro' | 'elite';
  materialEstimate?: MaterialEstimateData | null;
  /** Pre-filled quote number from a previous quote */
  initialQuoteNumber?: string;
  /** Which coverage unit to show: 'sqft' or 'yards'. Default: 'sqft' */
  coverageUnit?: 'sqft' | 'yards';
  /** Proof already generated + stored during the render pass. When present,
   *  the 2D Proof viewer shows it instantly instead of regenerating (30-60s). */
  initialProofUrl?: string | null;
}

const SHORT_DISCLAIMER = `TERMS & CONDITIONS OF APPROVAL:

1. COLOR ACCURACY: Digital previews are approximate representations. Actual film colors may vary due to lighting conditions, screen calibration, and manufacturer batch variations.

2. PHYSICAL SWATCH REVIEW: Customer confirms they have reviewed physical vinyl swatches prior to approval and understand digital-to-physical color differences.

3. PRE-EXISTING CONDITIONS: Vehicle condition may affect film adhesion and final appearance. Existing paint damage, rust, dents, or previous wrap residue may impact installation quality.

4. PRODUCTION AUTHORIZATION: By signing this approval, customer authorizes production using specified manufacturer vinyl film. Changes after approval may incur additional charges.

5. WARRANTY: Final wrap quality is subject to manufacturer film specifications and proper installation procedures.`;

const MINIMAL_APPROVAL = `I have reviewed the design, colors, and coverage shown in this proof and approve this layout for production. I understand the final wrap is produced using manufacturer vinyl film and may vary slightly from digital previews.`;

export const ProfessionalProofSheet: React.FC<ProfessionalProofSheetProps> = ({
  views,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  toolKey,
  toolName,
  designName,
  manufacturer,
  colorName,
  productCode,
  finish,
  hex,
  shopName: propShopName,
  shopLogo: propShopLogo,
  userTier = 'basic',
  materialEstimate,
  initialQuoteNumber,
  coverageUnit = 'sqft',
  initialProofUrl,
}) => {
  const proofRef = useRef<HTMLDivElement>(null);
  const { currentShop } = useOrganization();

  // Deterministic vehicle lookup for yards + sq ft
  const vehicleMeasurement = vehicleMake && vehicleModel
    ? findVehicle(vehicleMake, vehicleModel, vehicleYear)
    : null;
  const estimatedSqFt = vehicleMeasurement?.corrSqFt || vehicleMeasurement?.totalSqFt || null;
  const estimatedYards = estimatedSqFt ? sqFtToYards(estimatedSqFt) : null;

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [quoteNumber, setQuoteNumber] = useState(initialQuoteNumber || '');
  const [orderNumber, setOrderNumber] = useState('');
  const [includeDisclaimer, setIncludeDisclaimer] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [needsRevision, setNeedsRevision] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [shopProfile, setShopProfile] = useState<{ shop_name?: string; shop_logo_url?: string; default_include_disclaimer?: boolean } | null>(null);

  // ─── Quote/Order link state ────────────────────────────────────────────
  // When the user picks a row out of the typeahead, the proof becomes
  // "linked" to that quote / order. The Save & Email flow then attaches
  // the generated PDF to the linked quote via `quote_assets`.
  const [linkedQuote, setLinkedQuote] = useState<QuoteSearchRow | null>(null);
  const [linkedOrder, setLinkedOrder] = useState<OrderSearchRow | null>(null);
  const [quoteResults, setQuoteResults] = useState<QuoteSearchRow[]>([]);
  const [orderResults, setOrderResults] = useState<OrderSearchRow[]>([]);
  const [quoteSearchFocus, setQuoteSearchFocus] = useState(false);
  const [orderSearchFocus, setOrderSearchFocus] = useState(false);
  const [show2DProof, setShow2DProof] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  // Which slice of content the email dialog should open with. The
  // dropdown next to the Email button writes here; EmailConfigurator
  // reads it via `initialEmailType`. Defaults to 'all' when a quote is
  // linked (so pricing rides along) and 'proof' otherwise.
  const [emailMode, setEmailMode] = useState<'proof' | 'quote' | 'all'>('all');
  // Inline "Create new quote" dialog. Opens QuickQuoteDialog pre-seeded
  // with the rep's current vehicle + customer fields so they don't have
  // to leave the proof sheet to materialize a quote.
  const [showCreateQuoteDialog, setShowCreateQuoteDialog] = useState(false);

  // Terms onboarding
  const { needsOnboarding, markComplete } = useTermsOnboarding();

  // Load shop profile on mount
  useEffect(() => {
    loadShopProfile().then(profile => {
      if (profile) {
        setShopProfile(profile);
        if (profile.default_include_disclaimer) {
          setIncludeDisclaimer(true);
        }
      }
    });
  }, []);

  // ─── Typeahead: search quotes by quote_number ──────────────────────────
  // Scoped to the current shop so a tech can't accidentally attach a proof
  // to another shop's record. Match is `quote_number ilike %term%` — the
  // most common case (rep is reading a printed quote number off a sticky
  // note). Customer-name search would require a join filter; defer that.
  useEffect(() => {
    if (linkedQuote && linkedQuote.quote_number === quoteNumber) return;
    const term = quoteNumber.trim();
    if (!quoteSearchFocus || !currentShop?.id || term.length < 1) {
      setQuoteResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await db
        .from('quotes')
        .select(
          'id, quote_number, vehicle_year, vehicle_make, vehicle_model, customers:customer_id(name, email, phone)'
        )
        .eq('shop_id', currentShop.id)
        .ilike('quote_number', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(8);
      if (!cancelled) setQuoteResults((data as QuoteSearchRow[]) ?? []);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [quoteNumber, quoteSearchFocus, currentShop?.id, linkedQuote]);

  // ─── Typeahead: search orders by order_number ──────────────────────────
  useEffect(() => {
    if (linkedOrder && linkedOrder.order_number === orderNumber) return;
    const term = orderNumber.trim();
    if (!orderSearchFocus || !currentShop?.id || term.length < 1) {
      setOrderResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await db
        .from('orders')
        .select(
          'id, order_number, quote_id, vehicle_year, vehicle_make, vehicle_model, customers:customer_id(name, email, phone)'
        )
        .eq('shop_id', currentShop.id)
        .ilike('order_number', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(8);
      if (!cancelled) setOrderResults((data as OrderSearchRow[]) ?? []);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [orderNumber, orderSearchFocus, currentShop?.id, linkedOrder]);

  // Pick a quote out of the typeahead and prefill customer info from it.
  const pickQuote = (row: QuoteSearchRow) => {
    setLinkedQuote(row);
    setQuoteNumber(row.quote_number);
    if (!customerName && row.customers?.name) setCustomerName(row.customers.name);
    if (!customerEmail && row.customers?.email) setCustomerEmail(row.customers.email);
    setQuoteSearchFocus(false);
    setQuoteResults([]);
  };

  // Pick an order out of the typeahead. The order carries `quote_id` so
  // the Save & Email flow can still write the proof onto a quote_assets
  // row (no `order_assets` table exists today — confirmed by the user).
  const pickOrder = (row: OrderSearchRow) => {
    setLinkedOrder(row);
    setOrderNumber(row.order_number);
    if (!customerName && row.customers?.name) setCustomerName(row.customers.name);
    if (!customerEmail && row.customers?.email) setCustomerEmail(row.customers.email);
    setOrderSearchFocus(false);
    setOrderResults([]);
  };

  // Unlink — they typed past the picked number or hit the clear chip.
  const clearLinkedQuote = () => {
    setLinkedQuote(null);
    setQuoteNumber('');
  };
  const clearLinkedOrder = () => {
    setLinkedOrder(null);
    setOrderNumber('');
  };

  // Resolve tool label from registry
  const resolvedToolKey: ToolKey = toolKey || 'colorpro';
  const displayToolLabel = getToolLabel(resolvedToolKey);

  // Use shop profile values if props not provided
  const shopName = propShopName || shopProfile?.shop_name;
  const shopLogo = propShopLogo || shopProfile?.shop_logo_url;

  const vehicleFullName = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ');
  const proofDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Build proof request
  const buildProofRequest = (): ProofRequest => ({
    toolKey: resolvedToolKey,
    views: views.map(v => ({ type: v.type, url: v.url, label: v.label })),
    vehicleInfo: { year: vehicleYear, make: vehicleMake, model: vehicleModel },
    manufacturer,
    filmName: colorName || designName,
    productCode,
    finish,
    customerName: customerName || undefined,
    shopName,
    shopLogoUrl: shopLogo,
    shopId: currentShop?.id ?? null,
    includeTerms: includeDisclaimer,
  });

  // Capture the on-screen proof as a canvas, then convert to PDF
  const captureProofAsPdf = async (): Promise<jsPDF | null> => {
    if (!proofRef.current) return null;

    // Wait for all images to load before capturing
    const images = proofRef.current.querySelectorAll('img');
    await Promise.all(
      Array.from(images).map(img =>
        img.complete ? Promise.resolve() : new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        })
      )
    );

    const canvas = await html2canvas(proofRef.current, {
      scale: 2, // 2x for sharp output
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    // Create PDF page that exactly matches the captured content's aspect ratio
    // so the proof looks identical to what's on screen — no letter-page squishing
    const pdfWidth = 1120; // pts (~15.5 inches at 72dpi, good print resolution)
    const pdfHeight = pdfWidth * (imgHeight / imgWidth);

    const pdf = new jsPDF({
      orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pdfWidth, pdfHeight],
    });

    // Full-bleed: image fills the entire page, no margins
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

    // ─── Page 2: Terms & Conditions (when checkbox is checked) ───
    if (includeDisclaimer) {
      const termsPdfWidth = 612; // standard US Letter width in pts
      const termsPdfHeight = 792; // standard US Letter height in pts
      pdf.addPage([termsPdfWidth, termsPdfHeight], 'portrait');

      const margin = 50;
      const contentWidth = termsPdfWidth - margin * 2;
      let y = margin;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text('Terms & Conditions of Approval', termsPdfWidth / 2, y, { align: 'center' });
      y += 30;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const termsLines = pdf.splitTextToSize(SHORT_DISCLAIMER, contentWidth);
      pdf.text(termsLines, margin, y);
      y += termsLines.length * 11 + 20;

      // Signature lines
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('CUSTOMER APPROVAL', margin, y);
      y += 30;

      pdf.setFont('helvetica', 'normal');
      pdf.setDrawColor(0);
      pdf.line(margin, y, margin + 250, y);
      pdf.text('Customer Signature', margin, y + 14);
      pdf.line(margin + 300, y, margin + contentWidth, y);
      pdf.text('Date', margin + 300, y + 14);
      y += 40;

      pdf.line(margin, y, margin + 250, y);
      pdf.text('Print Name', margin, y + 14);
    }

    return pdf;
  };

  // Download PDF - captures the exact on-screen proof
  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const pdf = await captureProofAsPdf();
      if (pdf) {
        const fileName = `${vehicleFullName || 'Vehicle'} - Design Proof.pdf`.replace(/[^a-zA-Z0-9 _\-.]/g, '');
        pdf.save(fileName);
        toast({ title: 'PDF Downloaded', description: 'Your proof sheet has been saved.' });
      } else {
        toast({ title: 'Error', description: 'Could not capture proof sheet.', variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('PDF capture error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to generate PDF', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  // Print - captures the exact on-screen proof and opens print dialog
  const handlePrint = async () => {
    setIsGenerating(true);
    try {
      const pdf = await captureProofAsPdf();
      if (pdf) {
        const pdfBlob = pdf.output('blob');
        const blobUrl = URL.createObjectURL(pdfBlob);
        const printWindow = window.open(blobUrl, '_blank');
        if (printWindow) {
          printWindow.onload = () => {
            printWindow.print();
            URL.revokeObjectURL(blobUrl);
          };
        }
        toast({ title: 'Print Ready', description: 'Print dialog will open shortly.' });
      } else {
        toast({ title: 'Error', description: 'Could not capture proof sheet.', variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('PDF print error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to generate PDF', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  // The linked quote id, whether the user picked a quote directly or
  // picked an order whose underlying quote_id is set. Used by Save &
  // Share and Email Quote & Proof to write a `quote_assets` row so the
  // proof PDF travels with the deal.
  const linkedQuoteIdForAsset: string | null =
    linkedQuote?.id || linkedOrder?.quote_id || null;

  const attachProofToLinkedQuote = async (proofUrl: string) => {
    if (!linkedQuoteIdForAsset || !proofUrl) return;
    try {
      await attachAsset({
        quoteId: linkedQuoteIdForAsset,
        assetType: 'photoreal_proof',
        url: proofUrl,
        label: `Design Approval Proof — ${vehicleFullName || 'vehicle'}`,
      });
    } catch (err) {
      // Best-effort — the proof is already saved in storage; the link is
      // just a convenience for the admin view. Don't block the user.
      console.warn('[ProfessionalProofSheet] attach proof to quote failed', err);
    }
  };

  // Save & Share
  const handleSaveAndShare = async () => {
    setIsGenerating(true);
    try {
      const result = await generateAndSaveProof(buildProofRequest());
      if (result.success) {
        // Best-effort: attach the saved PDF to the linked quote so it
        // shows up in /admin/quotes alongside the deal.
        if (result.pdfUrl) await attachProofToLinkedQuote(result.pdfUrl);
        if (result.shareUrl) {
          await navigator.clipboard.writeText(result.shareUrl);
          const linkTag = linkedQuote
            ? ` Linked to Quote #${linkedQuote.quote_number}.`
            : linkedOrder
              ? ` Linked to Order #${linkedOrder.order_number}.`
              : '';
          toast({
            title: 'Proof Saved!',
            description: `Share link copied to clipboard.${linkTag}`,
          });
        } else {
          toast({ title: 'Proof Saved', description: 'PDF generated successfully.' });
        }
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to save proof', variant: 'destructive' });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Open the email dialog for the chosen content slice. When the user
  // picks "proof" or "all" we first generate + save the proof PDF (and
  // attach it to the linked quote if any) so the email can include a
  // permanent storage URL. For "quote only" we skip the PDF gen — the
  // email is text/quote-data only and doesn't need the renders saved.
  const openEmailDialog = async (mode: 'proof' | 'quote' | 'all') => {
    setEmailMode(mode);
    if (mode === 'quote') {
      setShowEmailDialog(true);
      return;
    }
    setIsGenerating(true);
    try {
      const result = await generateAndSaveProof(buildProofRequest());
      if (result.success && result.pdfUrl) {
        await attachProofToLinkedQuote(result.pdfUrl);
      }
    } catch (err) {
      console.warn('[ProfessionalProofSheet] proof save before email failed', err);
    } finally {
      setIsGenerating(false);
      setShowEmailDialog(true);
    }
  };

  // Map views to 6-grid layout positions
  const getViewByType = (types: string[], exclude?: string[]) => {
    for (const type of types) {
      const view = views.find(v => {
        const vl = v.type.toLowerCase();
        // Exclude views that match any exclude patterns
        if (exclude?.some(ex => vl.includes(ex.toLowerCase()))) return false;
        return vl.includes(type.toLowerCase());
      });
      if (view) return view;
    }
    return undefined;
  };

  // Exclude 'passenger' when searching for driver side so 'passenger-side' doesn't match 'side'
  const sideView = getViewByType(['side', 'driver', 'left'], ['passenger']);
  const passengerView = getViewByType(['passenger', 'right']);
  const hoodView = getViewByType(['hood', 'hood_detail']);
  const frontView = getViewByType(['front'], ['passenger']);
  const rearView = getViewByType(['rear', 'back']);
  const closeUpView = getViewByType(['close-up', 'closeup', 'detail']);
  const roofView = getViewByType(['roof']);

  // Passenger side: use dedicated render if available, otherwise mirror driver side via CSS flip
  const passengerIsFlipped = !passengerView && !!sideView;
  const effectivePassengerView = passengerView || sideView;

  // All 7 canonical views — top row: 4 views, bottom row: 3 views
  const topRow: Array<{ label: string; view?: RenderView; flipped?: boolean }> = [
    { label: 'Driver Side', view: sideView },
    { label: 'Passenger Side', view: effectivePassengerView, flipped: passengerIsFlipped },
    { label: 'Front', view: frontView },
    { label: 'Rear', view: rearView },
  ];
  const bottomRow: Array<{ label: string; view?: RenderView; flipped?: boolean }> = [
    { label: 'Hood', view: hoodView },
    { label: 'Close-Up', view: closeUpView },
    { label: 'Roof', view: roofView },
  ];

  return (
    <div className="w-full bg-background">
      {/* Control Bar — mobile-friendly stacked layout */}
      <div className="p-3 sm:p-4 border-b border-border bg-muted/30 space-y-3">
        {/* Customer name + Quote/Order numbers */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <Label htmlFor="customerName" className="text-xs sm:text-sm text-muted-foreground shrink-0 font-semibold">
            Customer Name
          </Label>
          <Input
            id="customerName"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Enter customer name"
            className="w-full sm:max-w-xs"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
          {/* Quote # — typeahead against this shop's quotes table.
              Picking a row links the proof to that quote so the Save &
              Share / Email Quote & Proof actions can write a
              quote_assets row and round-trip the deal. */}
          <div className="flex-1 relative">
            <div className="flex items-center gap-2">
              <Label htmlFor="quoteNumber" className="text-xs sm:text-sm text-muted-foreground shrink-0 font-semibold">
                Quote #
              </Label>
              <Input
                id="quoteNumber"
                value={quoteNumber}
                onChange={(e) => {
                  setQuoteNumber(e.target.value);
                  if (linkedQuote && linkedQuote.quote_number !== e.target.value) {
                    setLinkedQuote(null);
                  }
                }}
                onFocus={() => setQuoteSearchFocus(true)}
                onBlur={() => setTimeout(() => setQuoteSearchFocus(false), 150)}
                placeholder="Search QT-… or type new"
                className="w-full sm:max-w-[220px]"
                autoComplete="off"
              />
              {linkedQuote && (
                <button
                  type="button"
                  onClick={clearLinkedQuote}
                  className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 transition"
                  title="Unlink quote"
                >
                  <Link2 className="h-3 w-3 inline mr-1" />Linked
                </button>
              )}
              {/* Create a new quote inline. Spawns QuickQuoteDialog
                  pre-seeded with the current vehicle + customer. On
                  save, the dialog fires onSaved → we auto-link the
                  freshly-minted quote to this proof. */}
              {!linkedQuote && (
                <button
                  type="button"
                  onClick={() => setShowCreateQuoteDialog(true)}
                  className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition flex items-center gap-1"
                  title="Build a new quote without leaving the proof sheet"
                >
                  <Plus className="h-3 w-3" />New
                </button>
              )}
            </div>
            {quoteSearchFocus && quoteResults.length > 0 && (
              <div className="absolute z-30 mt-1 left-0 sm:left-[68px] w-[280px] max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-lg">
                {quoteResults.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onMouseDown={(e) => {
                      // mouseDown beats input blur so the click actually fires
                      e.preventDefault();
                      pickQuote(row);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-xs border-b border-border/40 last:border-b-0"
                  >
                    <div className="font-mono font-semibold">{row.quote_number}</div>
                    <div className="text-muted-foreground text-[11px] truncate">
                      {row.customers?.name || 'No customer'}
                      {row.vehicle_year || row.vehicle_make
                        ? ` · ${[row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ')}`
                        : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Order # — typeahead against this shop's orders table. */}
          <div className="flex-1 relative">
            <div className="flex items-center gap-2">
              <Label htmlFor="orderNumber" className="text-xs sm:text-sm text-muted-foreground shrink-0 font-semibold">
                Order #
              </Label>
              <Input
                id="orderNumber"
                value={orderNumber}
                onChange={(e) => {
                  setOrderNumber(e.target.value);
                  if (linkedOrder && linkedOrder.order_number !== e.target.value) {
                    setLinkedOrder(null);
                  }
                }}
                onFocus={() => setOrderSearchFocus(true)}
                onBlur={() => setTimeout(() => setOrderSearchFocus(false), 150)}
                placeholder="Search RP-… or type new"
                className="w-full sm:max-w-[220px]"
                autoComplete="off"
              />
              {linkedOrder && (
                <button
                  type="button"
                  onClick={clearLinkedOrder}
                  className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-500/25 transition"
                  title="Unlink order"
                >
                  <Link2 className="h-3 w-3 inline mr-1" />Linked
                </button>
              )}
            </div>
            {orderSearchFocus && orderResults.length > 0 && (
              <div className="absolute z-30 mt-1 left-0 sm:left-[68px] w-[280px] max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-lg">
                {orderResults.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickOrder(row);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-xs border-b border-border/40 last:border-b-0"
                  >
                    <div className="font-mono font-semibold">{row.order_number}</div>
                    <div className="text-muted-foreground text-[11px] truncate">
                      {row.customers?.name || 'No customer'}
                      {row.vehicle_year || row.vehicle_make
                        ? ` · ${[row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ')}`
                        : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — equal-width grid on mobile, inline on desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          {/* 2D Proof — opens the flat-panel AI proof viewer in a dialog.
              Available in DesignPanelPro today; surfacing it here makes
              it available across all 6 tools that use this sheet. */}
          <Button
            variant="outline"
            onClick={() => setShow2DProof(true)}
            disabled={isGenerating || views.length === 0}
            className="gap-1.5 text-xs sm:text-sm h-10 border-cyan-500/40 hover:bg-cyan-500/10"
            title="Open the 2D / flat-panel proof viewer"
          >
            <FileImage className="h-4 w-4 text-cyan-500" />
            <span>2D Proof</span>
          </Button>
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={isGenerating}
            className="gap-1.5 text-xs sm:text-sm h-10"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            <span className="hidden xs:inline sm:inline">Print</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={isGenerating}
            className="gap-1.5 text-xs sm:text-sm h-10"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span>PDF</span>
          </Button>
          <Button
            onClick={handleSaveAndShare}
            disabled={isGenerating}
            className="gap-1.5 text-xs sm:text-sm h-10 bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:brightness-110 text-white"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            <span>Share</span>
          </Button>
          {/* Email — split button. The big half does the most useful
              default for the current state (proof+quote when linked,
              proof-only otherwise). The chevron half opens a menu so
              the rep can explicitly send just the proof OR just the
              quote when they want to. */}
          <div className="col-span-2 sm:col-span-1 flex items-stretch rounded-md overflow-hidden shadow-sm">
            <Button
              onClick={() => openEmailDialog(linkedQuote ? 'all' : 'proof')}
              disabled={isGenerating}
              className="flex-1 gap-1.5 text-xs sm:text-sm h-10 rounded-none bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-white"
              title={linkedQuote
                ? 'Send proof + quote in one email and attach to the linked quote'
                : linkedOrder
                  ? 'Send proof in an email and attach to the linked order'
                  : 'Send proof in an email (link a quote to include pricing)'}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              <span>
                {linkedQuote ? 'Email Quote & Proof' : 'Email Proof'}
              </span>
              {(linkedQuote || linkedOrder) && <Check className="h-3 w-3 opacity-80" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isGenerating}
                  className="h-10 px-2 rounded-none border-l border-white/20 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-white"
                  aria-label="Choose what to email"
                  title="Choose what to email"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">Send to customer</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openEmailDialog('proof')}>
                  <Mail className="h-4 w-4 mr-2 text-blue-500" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">Email proof only</span>
                    <span className="text-[10px] text-muted-foreground">Design renders + approval</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openEmailDialog('quote')}>
                  <Mail className="h-4 w-4 mr-2 text-amber-500" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">Email quote only</span>
                    <span className="text-[10px] text-muted-foreground">Pricing breakdown, no renders</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openEmailDialog('all')}>
                  <Mail className="h-4 w-4 mr-2 text-emerald-500" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">Email proof + quote</span>
                    <span className="text-[10px] text-muted-foreground">Full package in one email</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* T&C Toggle */}
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <Checkbox
            id="includeDisclaimer"
            checked={includeDisclaimer}
            onCheckedChange={(checked) => setIncludeDisclaimer(checked === true)}
            className="border-amber-500 data-[state=checked]:bg-amber-500 mt-0.5"
          />
          <Label htmlFor="includeDisclaimer" className="text-xs sm:text-sm cursor-pointer font-medium leading-snug">
            Include Full Terms &amp; Conditions (Page 2)
          </Label>
        </div>
      </div>

      {/* Preview — on mobile, wrap in an overflow-x-auto scroll
          container and force the proof to 1200px so html2canvas captures
          at a stable desktop width. On desktop (md+), behave exactly
          like the original: w-full max-w-[1920px] mx-auto inside the
          modal, no overflow, no min-width, no visual change. */}
      <div className="w-full overflow-x-auto md:overflow-visible bg-muted/10">
        <div
          ref={proofRef}
          className="aspect-[16/9] bg-white text-black p-4 sm:p-6 mx-auto w-[1200px] md:w-full md:max-w-[1920px]"
        >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {shopLogo ? (
              <img src={shopLogo} alt={shopName || 'Shop'} className="h-10 object-contain" />
            ) : (
              <div className="text-lg font-bold tracking-tight text-black">
                {displayToolLabel}
              </div>
            )}
            {shopName && !shopLogo && (
              <span className="text-sm text-gray-600 ml-2">{shopName}</span>
            )}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-bold text-black">{vehicleFullName || 'Vehicle'}</h1>
            <p className="text-sm text-gray-600">Design Approval Proof</p>
            {(quoteNumber || orderNumber) && (
              <div className="flex items-center justify-end gap-3 mt-1">
                {quoteNumber && (
                  <span className="text-xs text-gray-500 font-mono">Quote: {quoteNumber}</span>
                )}
                {orderNumber && (
                  <span className="text-xs text-gray-500 font-mono">Order: {orderNumber}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 7-View Grid Layout — top row: 4 views, bottom row: 3 views */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          {topRow.map(({ label, view, flipped }) => (
            <div key={label} className="relative aspect-video rounded-lg overflow-hidden">
              {view?.url ? (
                <img
                  src={view.url}
                  alt={label}
                  className="w-full h-full object-cover"
                  style={flipped ? { transform: 'scaleX(-1)' } : undefined}
                />
              ) : (
                <div className="w-full h-full border-2 border-dashed border-gray-300 bg-gray-50 rounded-lg" />
              )}
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full">
                {label}
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {bottomRow.map(({ label, view, flipped }) => (
            <div key={label} className="relative aspect-video rounded-lg overflow-hidden">
              {view?.url ? (
                <img
                  src={view.url}
                  alt={label}
                  className="w-full h-full object-cover"
                  style={flipped ? { transform: 'scaleX(-1)' } : undefined}
                />
              ) : (
                <div className="w-full h-full border-2 border-dashed border-gray-300 bg-gray-50 rounded-lg" />
              )}
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Film Information Bar — ORIGINAL horizontal flex layout with
            vertical dividers. Desktop renders pixel-identical to the
            pre-PR#989 version. The ONLY difference from before is that
            Manufacturer / Film Color / Color # always render with a
            '—' or 'Custom' fallback when the swatch metadata is empty. */}
        <div className="bg-gray-900 text-white px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Manufacturer — always rendered */}
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Manufacturer</span>
              <p className="font-semibold">
                {manufacturer && manufacturer !== 'Custom'
                  ? manufacturer
                  : <span className="text-gray-500">—</span>}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-700" />

            {/* Film Color — always rendered */}
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Film Color</span>
              <p className="font-semibold">
                {colorName && colorName !== 'Custom Color'
                  ? colorName
                  : <span className="text-gray-500">Custom</span>}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-700" />

            {/* Color # — always rendered */}
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Color #</span>
              <p className="font-semibold font-mono">
                {productCode
                  ? productCode
                  : <span className="text-gray-500 font-sans">—</span>}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-700" />

            {designName && (
              <>
                <div>
                  <span className="text-gray-400 text-xs uppercase tracking-wide">Design</span>
                  <p className="font-semibold">{designName}</p>
                </div>
                <div className="h-8 w-px bg-gray-700" />
              </>
            )}
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Finish</span>
              <p className="font-semibold">{finish || 'Gloss'}</p>
            </div>
            {coverageUnit === 'sqft' && estimatedSqFt && (
              <>
                <div className="h-8 w-px bg-gray-700" />
                <div>
                  <span className="text-gray-400 text-xs uppercase tracking-wide">Coverage</span>
                  <p className="font-semibold">{estimatedSqFt} sq ft</p>
                </div>
              </>
            )}
            {coverageUnit === 'yards' && estimatedYards && (
              <>
                <div className="h-8 w-px bg-gray-700" />
                <div>
                  <span className="text-gray-400 text-xs uppercase tracking-wide">Film Needed</span>
                  <p className="font-semibold">{estimatedYards} yards</p>
                </div>
              </>
            )}
          </div>

          {hex && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg border-2 border-white/20" style={{ backgroundColor: hex }} />
              <span className="text-sm font-mono uppercase">{hex}</span>
            </div>
          )}
        </div>

        {/* Customer Approval Section */}
        <div className="border border-gray-300 rounded-lg p-4">
          <h3 className="font-bold text-sm uppercase tracking-wide text-gray-600 mb-3">Customer Approval</h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="flex items-end gap-4 mb-3">
                <div className="flex-1">
                  <span className="text-xs text-gray-500">Customer Name</span>
                  <div className="border-b border-gray-400 h-6 mt-1 flex items-end">
                    <span className="text-sm">{customerName || ''}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2">
                  <div className={`w-4 h-4 border-2 border-gray-400 rounded ${isApproved ? 'bg-green-500 border-green-500' : ''}`} />
                  <span className="text-sm">I approve this design</span>
                </label>
                <label className="flex items-center gap-2">
                  <div className={`w-4 h-4 border-2 border-gray-400 rounded ${needsRevision ? 'bg-orange-500 border-orange-500' : ''}`} />
                  <span className="text-sm">Revisions requested</span>
                </label>
              </div>
            </div>
            <div>
              <div className="flex items-end gap-4 mb-4">
                <div className="flex-1">
                  <span className="text-xs text-gray-500">Customer Signature</span>
                  <div className="border-b border-gray-400 h-8 mt-1" />
                </div>
                <div className="w-32">
                  <span className="text-xs text-gray-500">Date</span>
                  <div className="border-b border-gray-400 h-8 mt-1" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer preview text */}
        <div className="mt-3 text-[10px] text-gray-500 leading-tight italic">
          {includeDisclaimer ? 'Full Terms & Conditions will appear on Page 2' : MINIMAL_APPROVAL}
        </div>
        </div>
      </div>

      {/* Terms Onboarding Wizard */}
      <ShopTermsOnboardingWizard
        open={needsOnboarding}
        onOpenChange={(open) => { if (!open) markComplete(); }}
        onComplete={markComplete}
      />

      {/* 2D Proof — flat-panel AI proof viewer, hoisted from
          DesignPanelPro so all 6 tools that mount this sheet can open
          it. Lazy/dialog mount keeps the heavy AI generator off the
          main paint. */}
      {show2DProof && (
        <Dialog open={show2DProof} onOpenChange={setShow2DProof}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
            <TwoDProofSheet
              views={views}
              vehicleYear={vehicleYear}
              vehicleMake={vehicleMake}
              vehicleModel={vehicleModel}
              toolKey={resolvedToolKey}
              designName={designName}
              manufacturer={manufacturer}
              colorName={colorName}
              productCode={productCode}
              finish={finish}
              hex={hex}
              initialProofUrl={initialProofUrl}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Email Quote & Proof — re-uses the existing EmailConfigurator.
          When a quote is linked we pre-select emailType='all' so the
          customer gets the proof + pricing in one message. When only
          an order is linked (or nothing is linked), we fall back to
          emailType='proof'. The hero render URL is used as the email
          hero image so the inbox preview shows the design. */}
      {showEmailDialog && (
        <EmailConfigurator
          isOpen={showEmailDialog}
          onClose={() => setShowEmailDialog(false)}
          year={vehicleYear || ''}
          make={vehicleMake || ''}
          model={vehicleModel || ''}
          finish={finish || ''}
          colorName={colorName || ''}
          manufacturer={manufacturer || ''}
          colorHex={hex}
          productCode={productCode}
          views={views.map(v => ({ type: v.type, url: v.url, label: v.label }))}
          heroImageUrl={views[0]?.url ?? null}
          customerName={customerName}
          customerEmail={customerEmail}
          initialEmailType={emailMode}
        />
      )}

      {/* Inline "Create new quote" dialog. Pre-seeded with the proof
          sheet's current vehicle + customer so the rep doesn't retype
          anything. On save, auto-link the new quote so the next click
          on Share / Email writes a quote_assets row tying the proof to
          the new deal. */}
      {showCreateQuoteDialog && (
        <Suspense fallback={null}>
          <QuickQuoteDialog
            open={showCreateQuoteDialog}
            onClose={() => setShowCreateQuoteDialog(false)}
            initial={{
              year: vehicleYear || undefined,
              make: vehicleMake || undefined,
              model: vehicleModel || undefined,
              colorName: colorName || undefined,
              finish: finish || undefined,
              customerName: customerName || undefined,
              customerEmail: customerEmail || undefined,
            }}
            onSaved={(saved) => {
              const newRow: QuoteSearchRow = {
                id: saved.quoteId,
                quote_number: saved.quoteNumber,
                vehicle_year: saved.vehicle.year ?? null,
                vehicle_make: saved.vehicle.make ?? null,
                vehicle_model: saved.vehicle.model ?? null,
                customers: {
                  name: saved.customer.name ?? null,
                  email: saved.customer.email ?? null,
                  phone: saved.customer.phone ?? null,
                },
              };
              setLinkedQuote(newRow);
              setQuoteNumber(saved.quoteNumber);
              if (!customerName && saved.customer.name) setCustomerName(saved.customer.name);
              if (!customerEmail && saved.customer.email) setCustomerEmail(saved.customer.email);
              setShowCreateQuoteDialog(false);
              toast({
                title: `Quote ${saved.quoteNumber} ${saved.intent === 'send' ? 'sent' : 'saved'} and linked`,
                description: 'Save / Share / Email actions will now attach this proof to that quote.',
              });
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default ProfessionalProofSheet;
