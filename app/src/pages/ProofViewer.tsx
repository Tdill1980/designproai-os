import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Download, Loader2, MessageSquare, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { getProofByToken } from '@/lib/proof-service';
import { RevisionRequestModal } from '@/components/proof/RevisionRequestModal';
import { ProofStatusBadge } from '@/components/proof/ProofStatusBadge';
import { supabase } from '@/integrations/supabase/client';

// ═══════════════════════════════════════════════════════════════
// PROOF VIEWER - News Reel + Split Comparison (3D vs GENIE Panel)
// ═══════════════════════════════════════════════════════════════

interface ProofData {
  id: string;
  tool_name: string;
  manufacturer: string | null;
  film_or_design_name: string | null;
  render_urls: string[];
  pdf_url: string | null;
  vehicle_info: {
    year?: string;
    make?: string;
    model?: string;
    shopName?: string;
  } | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_notes: string | null;
  status: string | null;
  approved_at: string | null;
  created_at: string | null;
  // Extended fields for panelizer proof
  panel_urls?: Record<string, string>;
  genie_mask_urls?: Record<string, string>;
  all_view_urls?: Record<string, string>;
}

interface ComparisonSlide {
  key: string;
  label: string;
  renderUrl: string;     // 3D render view
  panelUrl: string;      // GENIE flat panel
  genieUrl?: string;     // GENIE mask composite (optional)
}

const VIEW_LABELS: Record<string, string> = {
  'driver-side': 'Driver Side',
  'passenger-side': 'Passenger Side',
  'hood': 'Hood',
  'roof': 'Roof',
  'rear': 'Rear',
  'front': 'Front',
  'front-bumper': 'Front Bumper',
  'rear-bumper': 'Rear Bumper',
  'driver-upper': 'Driver Upper',
  'driver-lower': 'Driver Lower',
  'passenger-upper': 'Passenger Upper',
  'passenger-lower': 'Passenger Lower',
  side: 'Side View',
  hood_detail: 'Hood Detail',
  'close-up': 'Close-Up',
};

// ── Split Comparison Slider ──
function ComparisonSlider({ leftUrl, rightUrl, leftLabel, rightLabel }: {
  leftUrl: string; rightUrl: string; leftLabel: string; rightLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPos, setSplitPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const updateSplit = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
    setSplitPos(pct);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => { e.preventDefault(); updateSplit(e.clientX); };
    const onTouchMove = (e: TouchEvent) => { updateSplit(e.touches[0].clientX); };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, updateSplit]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%', aspectRatio: '16/9',
        overflow: 'hidden', borderRadius: 12, cursor: dragging ? 'ew-resize' : 'default',
        background: '#000', userSelect: 'none',
      }}
      onMouseDown={(e) => { setDragging(true); updateSplit(e.clientX); }}
      onTouchStart={(e) => { setDragging(true); updateSplit(e.touches[0].clientX); }}
    >
      {/* Right image (flat panel) - full width behind */}
      <img
        src={rightUrl}
        alt={rightLabel}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          objectFit: 'contain', pointerEvents: 'none',
        }}
        draggable={false}
      />
      {/* Left image (3D render) - clipped at split position */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        clipPath: `inset(0 ${100 - splitPos}% 0 0)`,
      }}>
        <img
          src={leftUrl}
          alt={leftLabel}
          style={{
            width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none',
          }}
          draggable={false}
        />
      </div>
      {/* Slider handle */}
      <div style={{
        position: 'absolute', top: 0, left: `${splitPos}%`, width: 3,
        height: '100%', background: '#00C7FF', transform: 'translateX(-50%)',
        zIndex: 10, pointerEvents: 'none',
      }}>
        {/* Handle grip */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 40, height: 40, borderRadius: '50%', background: '#00C7FF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)', cursor: 'ew-resize',
          pointerEvents: 'auto',
        }}>
          <span style={{ color: '#fff', fontSize: 16, fontWeight: 900, letterSpacing: 2 }}>⟨⟩</span>
        </div>
      </div>
      {/* Labels */}
      <div style={{
        position: 'absolute', top: 12, left: 12, padding: '4px 12px',
        background: 'rgba(0,0,0,0.7)', borderRadius: 6, color: '#fff',
        fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)',
        zIndex: 5,
      }}>
        {leftLabel}
      </div>
      <div style={{
        position: 'absolute', top: 12, right: 12, padding: '4px 12px',
        background: 'rgba(0,199,255,0.85)', borderRadius: 6, color: '#fff',
        fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)',
        zIndex: 5,
      }}>
        {rightLabel}
      </div>
    </div>
  );
}

export default function ProofViewer() {
  const { token } = useParams<{ token: string }>();
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const reelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) {
      setError('No proof token provided');
      setLoading(false);
      return;
    }
    loadProof();
  }, [token]);

  const loadProof = async () => {
    if (!token) return;
    setLoading(true);
    const result = await getProofByToken(token);
    if (!result.success || !result.proof) {
      setError(result.error || 'Proof not found');
      setLoading(false);
      return;
    }
    setProof(result.proof as ProofData);
    setLoading(false);
  };

  const handleApprove = async () => {
    if (!token || !proof) return;
    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.functions.invoke('update-proof-status', {
        body: { token, action: 'approve' },
      });
      if (updateError) throw updateError;
      toast({ title: 'Design Approved!', description: 'The shop has been notified. Production will begin.' });
      await loadProof();
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to submit approval. Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevisionRequest = async (notes: string) => {
    if (!token || !proof) return;
    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.functions.invoke('update-proof-status', {
        body: { token, action: 'request_revision', customerNotes: notes },
      });
      if (updateError) throw updateError;
      toast({ title: 'Revision Requested', description: 'Your feedback has been sent to the shop.' });
      setShowRevisionModal(false);
      await loadProof();
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to submit revision request.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#00C7FF', margin: '0 auto 16px' }} />
          <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading proof...</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error || !proof) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <AlertCircle style={{ width: 48, height: 48, color: '#dc2626', margin: '0 auto 16px' }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Proof Not Found</h1>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>
            {error || 'This proof link may have expired. Please contact the shop for a new link.'}
          </p>
        </div>
      </div>
    );
  }

  const vehicleInfo = proof.vehicle_info || {};
  const vehicleName = [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(Boolean).join(' ') || 'Vehicle';
  const shopName = vehicleInfo.shopName;
  const renderUrls = Array.isArray(proof.render_urls) ? proof.render_urls : [];
  const isAlreadyActioned = proof.status === 'approved' || proof.status === 'revision_requested';

  // ── Build comparison slides ──
  // Each slide pairs a 3D render view with its GENIE flat panel output
  const panelUrls = proof.panel_urls || {};
  const genieUrls = proof.genie_mask_urls || {};
  const viewUrls = proof.all_view_urls || {};

  const slides: ComparisonSlide[] = [];

  // If we have panel URLs, create comparison slides
  if (Object.keys(panelUrls).length > 0) {
    Object.entries(panelUrls).forEach(([key, panelUrl]) => {
      // Find the matching 3D render for this panel
      const renderUrl = viewUrls[key]
        || (key.includes('driver') ? (viewUrls['side'] || viewUrls['driver-side'] || renderUrls[0]) : null)
        || (key.includes('passenger') ? (viewUrls['passenger-side'] || viewUrls['side'] || renderUrls[0]) : null)
        || viewUrls[key.split('-')[0]]
        || renderUrls[0]
        || '';

      if (renderUrl && panelUrl) {
        slides.push({
          key,
          label: VIEW_LABELS[key] || key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          renderUrl,
          panelUrl,
          genieUrl: genieUrls[key],
        });
      }
    });
  }

  // If no panel URLs, fall back to showing render views in the reel without comparison
  const hasComparison = slides.length > 0;
  const currentSlide = hasComparison ? slides[activeSlide] || slides[0] : null;

  // For news reel: use slides if available, otherwise use render URLs
  const reelItems = hasComparison
    ? slides.map(s => ({ key: s.key, label: s.label, thumbUrl: s.panelUrl }))
    : renderUrls.map((url, i) => ({
        key: `view-${i}`,
        label: Object.keys(VIEW_LABELS)[i] ? VIEW_LABELS[Object.keys(VIEW_LABELS)[i]] : `View ${i + 1}`,
        thumbUrl: url,
      }));

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: "'Inter', 'Poppins', sans-serif" }}>
      {/* ── Header Bar ── */}
      <header style={{
        borderBottom: '1px solid #1f1f1f', background: 'rgba(10,10,10,0.95)',
        backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto', padding: '12px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#00C7FF', letterSpacing: -0.5 }}>
              DesignProAI<span style={{ fontSize: 10, verticalAlign: 'super', color: '#666' }}>AI</span>
            </span>
            {shopName && (
              <>
                <span style={{ color: '#333', fontSize: 14 }}>|</span>
                <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 500 }}>{shopName}</span>
              </>
            )}
          </div>
          <ProofStatusBadge status={proof.status} />
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {/* ── Vehicle & Design Info ── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{vehicleName}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {proof.film_or_design_name && (
              <span style={{ padding: '4px 12px', background: '#1a1a2e', borderRadius: 20, fontSize: 12, color: '#00C7FF', fontWeight: 600 }}>
                {proof.film_or_design_name}
              </span>
            )}
            {proof.manufacturer && (
              <span style={{ padding: '4px 12px', background: '#1a1a1a', borderRadius: 20, fontSize: 12, color: '#9ca3af' }}>
                {proof.manufacturer}
              </span>
            )}
            {proof.customer_name && (
              <span style={{ padding: '4px 12px', background: '#1a1a1a', borderRadius: 20, fontSize: 12, color: '#9ca3af' }}>
                Prepared for: {proof.customer_name}
              </span>
            )}
          </div>
        </div>

        {/* ── Main Comparison View ── */}
        {hasComparison && currentSlide ? (
          <ComparisonSlider
            leftUrl={currentSlide.renderUrl}
            rightUrl={currentSlide.panelUrl}
            leftLabel="3D Design Render"
            rightLabel="GENIE Production Panel"
          />
        ) : renderUrls.length > 0 ? (
          <div style={{
            width: '100%', aspectRatio: '16/9', borderRadius: 12,
            overflow: 'hidden', background: '#111',
          }}>
            <img
              src={renderUrls[activeSlide] || renderUrls[0]}
              alt={vehicleName}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        ) : null}

        {/* ── Drag instruction ── */}
        {hasComparison && (
          <p style={{ textAlign: 'center', color: '#555', fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>
            Drag the slider to compare the 3D design render with the GENIE production panel
          </p>
        )}

        {/* ── News Reel Filmstrip ── */}
        {reelItems.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <div
              ref={reelRef}
              style={{
                display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0',
                scrollbarWidth: 'thin', scrollbarColor: '#333 transparent',
              }}
            >
              {reelItems.map((item, i) => (
                <button
                  key={item.key}
                  onClick={() => setActiveSlide(i)}
                  style={{
                    flexShrink: 0, width: 140, border: 'none', padding: 0,
                    background: 'none', cursor: 'pointer', textAlign: 'center',
                  }}
                >
                  <div style={{
                    width: 140, height: 80, borderRadius: 8, overflow: 'hidden',
                    border: i === activeSlide ? '2px solid #00C7FF' : '2px solid #222',
                    transition: 'border-color 0.2s',
                  }}>
                    <img
                      src={item.thumbUrl}
                      alt={item.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <p style={{
                    fontSize: 10, fontWeight: 600, marginTop: 4,
                    color: i === activeSlide ? '#00C7FF' : '#666',
                    transition: 'color 0.2s',
                  }}>
                    {item.label}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── GENIE Mask Composite (if available) ── */}
        {hasComparison && currentSlide?.genieUrl && (
          <div style={{ marginTop: 20 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase',
              letterSpacing: 1.5, marginBottom: 8,
            }}>
              GENIE Panel Zone Map
            </p>
            <div style={{
              width: '100%', maxWidth: 600, borderRadius: 8, overflow: 'hidden',
              border: '1px solid #222',
            }}>
              <img
                src={currentSlide.genieUrl}
                alt="GENIE zone map"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
          </div>
        )}

        {/* ── Customer Notes (if revision requested) ── */}
        {proof.customer_notes && (
          <div style={{
            marginTop: 24, padding: 16, background: '#1a1500', border: '1px solid #ca8a04',
            borderRadius: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MessageSquare style={{ width: 16, height: 16, color: '#ca8a04' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>Revision Notes</span>
            </div>
            <p style={{ color: '#e5e7eb', fontSize: 14, lineHeight: 1.5 }}>{proof.customer_notes}</p>
          </div>
        )}

        {/* ── Design Specs ── */}
        <div style={{
          marginTop: 24, padding: 16, background: '#111', border: '1px solid #1f1f1f',
          borderRadius: 10,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>
            Design Specifications
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {proof.manufacturer && (
              <div>
                <p style={{ fontSize: 10, color: '#555' }}>Manufacturer</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{proof.manufacturer}</p>
              </div>
            )}
            {proof.film_or_design_name && (
              <div>
                <p style={{ fontSize: 10, color: '#555' }}>Design</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{proof.film_or_design_name}</p>
              </div>
            )}
            {vehicleInfo.year && (
              <div>
                <p style={{ fontSize: 10, color: '#555' }}>Year</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{vehicleInfo.year}</p>
              </div>
            )}
            {vehicleInfo.make && vehicleInfo.model && (
              <div>
                <p style={{ fontSize: 10, color: '#555' }}>Vehicle</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{vehicleInfo.make} {vehicleInfo.model}</p>
              </div>
            )}
            {hasComparison && (
              <div>
                <p style={{ fontSize: 10, color: '#555' }}>Panels</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{slides.length} production panels</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Action Buttons ── */}
        {!isAlreadyActioned ? (
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button
                onClick={handleApprove}
                disabled={isSubmitting}
                style={{
                  padding: '16px 24px', borderRadius: 10, border: 'none',
                  background: '#16a34a', color: '#fff', fontSize: 16, fontWeight: 800,
                  cursor: isSubmitting ? 'wait' : 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: isSubmitting ? 0.6 : 1, transition: 'opacity 0.2s',
                }}
              >
                {isSubmitting ? (
                  <Loader2 style={{ width: 20, height: 20, animation: 'spin 0.8s linear infinite' }} />
                ) : (
                  <CheckCircle2 style={{ width: 20, height: 20 }} />
                )}
                I Approve This Design
              </button>
              <button
                onClick={() => setShowRevisionModal(true)}
                disabled={isSubmitting}
                style={{
                  padding: '16px 24px', borderRadius: 10,
                  border: '2px solid #ca8a04', background: 'transparent',
                  color: '#fbbf24', fontSize: 16, fontWeight: 800,
                  cursor: isSubmitting ? 'wait' : 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <MessageSquare style={{ width: 20, height: 20 }} />
                Request Changes
              </button>
            </div>

            {proof.pdf_url && (
              <button
                onClick={() => window.open(proof.pdf_url!, '_blank')}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: '1px solid #222',
                  background: 'transparent', color: '#666', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Download style={{ width: 14, height: 14 }} />
                Download PDF Proof
              </button>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 32, textAlign: 'center', padding: 32 }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: proof.status === 'approved' ? 'rgba(22,163,106,0.15)' : 'rgba(202,138,4,0.15)',
            }}>
              {proof.status === 'approved' ? (
                <CheckCircle2 style={{ width: 32, height: 32, color: '#16a34a' }} />
              ) : (
                <MessageSquare style={{ width: 32, height: 32, color: '#ca8a04' }} />
              )}
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
              {proof.status === 'approved' ? 'Design Approved' : 'Revision Requested'}
            </h3>
            <p style={{ color: '#666', fontSize: 14 }}>
              {proof.status === 'approved'
                ? 'Thank you! The shop will begin production.'
                : 'The shop will review your feedback and prepare a new proof.'}
            </p>
            {proof.approved_at && proof.status === 'approved' && (
              <p style={{ color: '#444', fontSize: 12, marginTop: 8 }}>
                Approved on {new Date(proof.approved_at).toLocaleDateString()}
              </p>
            )}
            {proof.pdf_url && (
              <button
                onClick={() => window.open(proof.pdf_url!, '_blank')}
                style={{
                  marginTop: 16, padding: '8px 16px', borderRadius: 6, border: '1px solid #333',
                  background: 'transparent', color: '#9ca3af', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Download style={{ width: 14, height: 14 }} />
                Download PDF
              </button>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: '1px solid #1f1f1f', marginTop: 48, padding: '20px 0',
        textAlign: 'center', color: '#333', fontSize: 12,
      }}>
        Powered by DesignProAI<span style={{ verticalAlign: 'super', fontSize: 8 }}>AI</span>
      </footer>

      {/* Revision Modal */}
      <RevisionRequestModal
        isOpen={showRevisionModal}
        onClose={() => setShowRevisionModal(false)}
        onSubmit={handleRevisionRequest}
        isSubmitting={isSubmitting}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>
    </div>
  );
}
