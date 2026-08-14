import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import html2canvas from 'html2canvas';

interface BlankProofTemplateProps {
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  designName?: string;
  /** Panel dimensions from panelizer_jobs.panels */
  panels?: Array<{
    label: string;
    panelKey: string;
    widthInches: number;
    heightInches: number;
  }>;
}

export const BlankProofTemplate: React.FC<BlankProofTemplateProps> = ({
  vehicleYear,
  vehicleMake,
  vehicleModel,
  designName,
  panels,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  const yearText = vehicleYear || '[YEAR]';
  const makeText = vehicleMake || '[MAKE]';
  const modelText = vehicleModel || '[MODEL]';
  const designText = designName || '[DESIGN NAME]';

  const handleDownload = async () => {
    if (!sheetRef.current) return;
    const canvas = await html2canvas(sheetRef.current, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const link = document.createElement('a');
    link.download = `proof-template-${makeText}-${modelText}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <Button onClick={handleDownload} variant="secondary" className="gap-2">
        <Download className="w-4 h-4" /> Download Template PNG
      </Button>

      {/* ── Proof Sheet ── */}
      <div
        ref={sheetRef}
        style={{
          width: 1400,
          height: 990,
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, Helvetica, sans-serif',
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid #ccc',
        }}
      >
        {/* ═══ TOP BAR ═══ */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '14px 20px 10px 20px',
            borderBottom: '2px solid #222',
          }}
        >
          {/* Top Left — Vehicle Info */}
          <div style={{ flex: '0 0 280px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#999', lineHeight: 1.2 }}>
              {yearText} {makeText} {modelText}
            </div>
            <div style={{ fontSize: 14, color: '#bbb', marginTop: 2 }}>
              ({designText})
            </div>
          </div>

          {/* Top Center — Social Collaboration */}
          <div
            style={{
              flex: '0 0 520px',
              border: '1.5px solid #333',
              borderRadius: 4,
              padding: '8px 16px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#222' }}>
              Social Collaboration
            </div>
            <div style={{ fontSize: 11, color: '#555', lineHeight: 1.4, marginTop: 2 }}>
              We love to share your work! When you have completed your installation, please send us
              pictures or videos. If you are posting on Social Media and would like to tag us, please
              tag us <strong>@restyleproai</strong>
            </div>
          </div>

          {/* Top Right — DesignProAI™ Logo */}
          <div
            style={{
              flex: '0 0 280px',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%)',
              borderRadius: 8,
              padding: '12px 18px',
              textAlign: 'right',
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900, color: '#fff', lineHeight: 1 }}>
              Design<span style={{ color: '#00c7ff' }}>Pro</span>AI
              <span style={{ fontSize: 14, verticalAlign: 'super', color: '#00c7ff' }}>™</span>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4, fontStyle: 'italic' }}>
              🚀 Out of This World Designs Everytime
            </div>
          </div>
        </div>

        {/* ═══ MIDDLE — PANEL AREA (BLANK) ═══ */}
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: 20,
            right: 20,
            bottom: 120,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#fafafa',
            border: '2px dashed #ddd',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 300, color: '#ccc', letterSpacing: 4 }}>
            [ PANELS GO HERE ]
          </div>

          {/* Show expected panel list if provided */}
          {panels && panels.length > 0 && (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: '#bbb', marginBottom: 8, fontWeight: 600 }}>
                Expected Panels:
              </div>
              {panels.map((p) => (
                <div key={p.panelKey} style={{ fontSize: 12, color: '#ccc', lineHeight: 1.6 }}>
                  {p.label}: {p.widthInches}" W × {p.heightInches}" H
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ BOTTOM BAR ═══ */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            borderTop: '2px solid #222',
            padding: '10px 20px',
            backgroundColor: '#fff',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          {/* DON'T PAY TWICE badge */}
          <div
            style={{
              flex: '0 0 100px',
              textAlign: 'center',
              lineHeight: 1.1,
            }}
          >
            <div
              style={{
                backgroundColor: '#cc0000',
                color: '#fff',
                fontWeight: 900,
                fontSize: 14,
                padding: '6px 8px',
                borderRadius: 4,
                fontStyle: 'italic',
              }}
            >
              DON'T<br />PAY<br />TWICE!!
            </div>
          </div>

          {/* Approval text */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#cc0000',
                fontStyle: 'italic',
                marginBottom: 2,
              }}
            >
              ARTWORK AND PROOF APPROVAL
            </div>
            <div style={{ fontSize: 9.5, color: '#333', lineHeight: 1.45 }}>
              Your approval, either in writing or by utilizing our online proofing system,
              constitutes acceptance of the final design. DesignProAI will not be liable for
              errors, omissions, or legal and ethical compliance after approval. It is your
              responsibility to confirm spelling, placement, sizing, colors, etc.
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: '#cc0000',
                fontStyle: 'italic',
                marginTop: 2,
                lineHeight: 1.45,
              }}
            >
              Ensure that the template (Make, Model, Year, Wheelbase, etc) and panel sizes match
              your vehicle.
            </div>
            <div style={{ fontSize: 9.5, color: '#333', lineHeight: 1.45, marginTop: 2 }}>
              We <strong>DO NOT</strong> have access to the actual vehicle, therefore it is your
              duty to confirm the size, positioning of visual elements, text, colors, and panel
              sizing are ready for production.
            </div>
          </div>

          {/* Website */}
          <div
            style={{
              flex: '0 0 140px',
              textAlign: 'right',
              alignSelf: 'center',
            }}
          >
            <div style={{ fontSize: 11, color: '#999' }}>restyleproai.com</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlankProofTemplate;
