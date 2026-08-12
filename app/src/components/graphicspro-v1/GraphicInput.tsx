import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Sparkles, Building2, ImageUp, RefreshCw, Stamp, Scissors, FileText, Image, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GraphicInput as GraphicInputType, GraphicMode } from "./types";
import { DESIGN_STYLES, BUSINESS_INDUSTRIES } from "./types";
import { FontSelector } from "./FontSelector";
import { VisionBoardUploader } from "@/components/designpanelpro/VisionBoardUploader";
import type { VisionBoardImage, VisionBoardIntent } from "@/lib/designiq-engine";

interface GraphicInputProps {
  graphic: GraphicInputType;
  onChange: (updates: Partial<GraphicInputType>) => void;
}

const MODE_TABS: { mode: GraphicMode; label: string; icon: React.ReactNode; description: string }[] = [
  { mode: 'logo', label: 'Logo', icon: <Stamp className="w-4 h-4" />, description: 'Recreate a logo for cut vinyl' },
  { mode: 'design', label: 'Design', icon: <Sparkles className="w-4 h-4" />, description: 'AI generates your graphic' },
  { mode: 'commercial', label: 'Commercial', icon: <Building2 className="w-4 h-4" />, description: 'Business graphics package' },
  { mode: 'upload', label: 'Upload', icon: <ImageUp className="w-4 h-4" />, description: 'Use your own artwork' },
  { mode: 'restyle', label: 'Restyle', icon: <RefreshCw className="w-4 h-4" />, description: 'Modernize existing art' },
];

const ACCEPTED_ART_TYPES = '.png,.jpg,.jpeg,.svg,.pdf,.eps,.ai';

export function GraphicInput({ graphic, onChange }: GraphicInputProps) {
  const { toast } = useToast();
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const restyleInputRef = useRef<HTMLInputElement>(null);
  const logoSourceInputRef = useRef<HTMLInputElement>(null);
  const logoExamplesInputRef = useRef<HTMLInputElement>(null);

  const handleArtworkUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const maxSize = 50 * 1024 * 1024; // 50MB
    const oversized = files.find(f => f.size > maxSize);
    if (oversized) {
      toast({ title: "File too large", description: "Maximum file size is 50MB per file", variant: "destructive" });
      return;
    }

    const previews = files.map(f => URL.createObjectURL(f));
    onChange({
      uploadedArtworkFiles: [...graphic.uploadedArtworkFiles, ...files],
      uploadedArtworkUrls: [...graphic.uploadedArtworkUrls, ...previews],
    });
  }, [graphic.uploadedArtworkFiles, graphic.uploadedArtworkUrls, onChange, toast]);

  const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange({
      businessLogoFile: file,
      businessLogoUrl: URL.createObjectURL(file),
    });
  }, [onChange]);

  const handleRestyleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange({
      restyleSourceFile: file,
      restyleSourceUrl: URL.createObjectURL(file),
    });
  }, [onChange]);

  const handleLogoSourceUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange({
      logoSourceFile: file,
      logoSourceUrl: URL.createObjectURL(file),
    });
  }, [onChange]);

  const handleLogoExamplesUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const previews = files.map(f => URL.createObjectURL(f));
    onChange({
      logoExampleFiles: [...graphic.logoExampleFiles, ...files],
      logoExampleUrls: [...graphic.logoExampleUrls, ...previews],
    });
  }, [graphic.logoExampleFiles, graphic.logoExampleUrls, onChange]);

  const removeLogoExample = useCallback((index: number) => {
    const newFiles = graphic.logoExampleFiles.filter((_, i) => i !== index);
    const newUrls = graphic.logoExampleUrls.filter((_, i) => i !== index);
    onChange({ logoExampleFiles: newFiles, logoExampleUrls: newUrls });
  }, [graphic.logoExampleFiles, graphic.logoExampleUrls, onChange]);

  const removeArtwork = useCallback((index: number) => {
    const newFiles = graphic.uploadedArtworkFiles.filter((_, i) => i !== index);
    const newUrls = graphic.uploadedArtworkUrls.filter((_, i) => i !== index);
    onChange({ uploadedArtworkFiles: newFiles, uploadedArtworkUrls: newUrls });
  }, [graphic.uploadedArtworkFiles, graphic.uploadedArtworkUrls, onChange]);

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.mode}
            onClick={() => onChange({ mode: tab.mode })}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg border text-xs font-medium transition-all ${
              graphic.mode === tab.mode
                ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                : tab.mode === 'logo'
                  ? 'border-fuchsia-500/40 text-fuchsia-400 hover:border-fuchsia-500/60'
                  : 'border-gray-200 hover:border-gray-200 text-gray-500'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Logo Mode — utility-first: upload logo → cutpath files. Visualize optional. */}
      {graphic.mode === 'logo' && (
        <Card className="p-4 space-y-4 bg-white border-gray-200">
          {/* Utility badge */}
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200/20">
            <Stamp className="w-4 h-4 text-fuchsia-400" />
            <p className="text-xs font-semibold text-fuchsia-400 uppercase tracking-wide">Logo Utility</p>
            <p className="text-[10px] text-gray-500 ml-auto">Upload → Cutpath Files</p>
          </div>

          {/* Step 1: Upload Logo */}
          <div>
            <Label className="text-sm font-medium text-gray-900">1. Upload Your Logo *</Label>
            <p className="text-[11px] text-gray-500 mb-2">Any format — we'll trace it and generate production-ready cutpath files</p>
            <div
              className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center cursor-pointer hover:border-fuchsia-500/50 transition-colors"
              onClick={() => logoSourceInputRef.current?.click()}
            >
              {graphic.logoSourceUrl ? (
                <div className="space-y-2">
                  <img src={graphic.logoSourceUrl} alt="Logo source" className="max-h-36 mx-auto rounded-lg border border-gray-200/20 bg-white/5" />
                  <p className="text-xs text-gray-500">Click to change</p>
                </div>
              ) : (
                <>
                  <Stamp className="w-8 h-8 mx-auto text-gray-500/50 mb-2" />
                  <p className="text-sm text-gray-500">Drop your logo here, or click to browse</p>
                  <p className="text-xs text-gray-500/60 mt-1">PNG, JPG, SVG, PDF, EPS, AI</p>
                </>
              )}
              <input
                ref={logoSourceInputRef}
                type="file"
                accept="image/*,.svg,.pdf,.eps,.ai"
                className="hidden"
                onChange={handleLogoSourceUpload}
              />
            </div>
            {graphic.logoSourceUrl && (
              <div className="flex justify-end mt-1">
                <button
                  onClick={() => onChange({ logoSourceFile: null, logoSourceUrl: null })}
                  className="text-[11px] text-red-400 hover:text-red-300"
                >
                  Remove logo
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Target size (Enlarge Pattern) */}
          <div>
            <Label className="text-sm font-medium text-gray-900">2. Enlarge / Target Size</Label>
            <p className="text-[11px] text-gray-500 mb-2">Set the final print dimensions in inches — leave height at 0 to auto-scale (maintain aspect ratio)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-gray-500/70">Width (in)</Label>
                <Input
                  type="number"
                  value={graphic.logoTargetWidth || ''}
                  onChange={(e) => onChange({ logoTargetWidth: Number(e.target.value) || 0 })}
                  placeholder="e.g. 24"
                  className="h-8 text-sm bg-white border-gray-200"
                />
              </div>
              <div>
                <Label className="text-[10px] text-gray-500/70">Height (in)</Label>
                <Input
                  type="number"
                  value={graphic.logoTargetHeight || ''}
                  onChange={(e) => onChange({ logoTargetHeight: Number(e.target.value) || 0 })}
                  placeholder="auto"
                  className="h-8 text-sm bg-white border-gray-200"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Optional notes */}
          <div>
            <Label className="text-sm font-medium text-gray-900">3. Notes (optional)</Label>
            <Textarea
              value={graphic.logoRecreatePrompt}
              onChange={(e) => onChange({ logoRecreatePrompt: e.target.value })}
              placeholder="e.g. Single-color red vinyl, simplify fine details, match Pantone 186..."
              className="mt-1 min-h-[60px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* Visualize Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">Visualize on Client's Surface</span>
              <span className="block text-[11px] text-gray-500">Optional — see a photorealistic render of the logo on a real wall, vehicle, or window</span>
            </div>
            <button
              onClick={() => onChange({ logoVisualizeEnabled: !graphic.logoVisualizeEnabled })}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-2 ${
                graphic.logoVisualizeEnabled ? 'bg-blue-500' : 'bg-white border border-gray-200'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                graphic.logoVisualizeEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* Visualize sub-panel — only shown when toggle is on */}
          {graphic.logoVisualizeEnabled && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-500/30">
              <div className="rounded-md bg-blue-500/5 p-2">
                <p className="text-[11px] text-blue-300">
                  <strong>Upload a photo of the client's wall</strong> in Section 1 above (Upload Photo tab) — or pick a Wall/Glass/Vehicle/Surface to generate one.
                </p>
              </div>

              {/* Examples upload */}
              <div>
                <Label className="text-xs font-medium text-gray-900">Examples — what do you want it to look like?</Label>
                <p className="text-[10px] text-gray-500/70 mb-1">Upload photos of similar installations as reference (optional)</p>
                <div
                  className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-500/50 transition-colors"
                  onClick={() => logoExamplesInputRef.current?.click()}
                >
                  <Upload className="w-5 h-5 mx-auto text-gray-500/50 mb-1" />
                  <p className="text-xs text-gray-500">Drop example photos or click to browse</p>
                  <input
                    ref={logoExamplesInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleLogoExamplesUpload}
                  />
                </div>
                {graphic.logoExampleUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {graphic.logoExampleUrls.map((url, i) => (
                      <div key={i} className="relative group">
                        <img src={url} alt={`Example ${i + 1}`} className="w-16 h-16 rounded-md object-cover border border-gray-200" />
                        <button
                          onClick={() => removeLogoExample(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* What you'll get — output clarity */}
          <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-fuchsia-400">Output files:</p>
            <ul className="text-xs text-gray-500 space-y-1">
              <li className="flex items-center gap-2"><Scissors className="w-3 h-3 text-fuchsia-400 shrink-0" /> <span><strong className="text-gray-900">CutContour SVG</strong> — Plotter-ready, magenta #FF00FF, 1/16" offset</span></li>
              <li className="flex items-center gap-2"><FileText className="w-3 h-3 text-blue-400 shrink-0" /> <span><strong className="text-gray-900">Production PDF</strong> — Artwork + cut layers, direct to RIP</span></li>
              <li className="flex items-center gap-2"><Image className="w-3 h-3 text-green-400 shrink-0" /> <span><strong className="text-gray-900">Print File</strong> — ESRGAN upscaled, scaled to target size</span></li>
              <li className="flex items-center gap-2"><Package className="w-3 h-3 text-amber-400 shrink-0" /> <span><strong className="text-gray-900">Cut Files ZIP</strong> — Vectorized SVGs with 1/4" bleed</span></li>
              {graphic.logoVisualizeEnabled && (
                <li className="flex items-center gap-2"><Sparkles className="w-3 h-3 text-purple-400 shrink-0" /> <span><strong className="text-gray-900">Render on Surface</strong> — Photorealistic mockup on the client's wall</span></li>
              )}
            </ul>
            <p className="text-[10px] text-gray-500/60 pt-1">Compatible: Roland, Graphtec, Summa, Mimaki — VersaWorks, Onyx, Caldera, Flexi, SAi</p>
          </div>
        </Card>
      )}

      {/* Design prompt — always visible (except logo mode which has its own prompt) */}
      {graphic.mode !== 'logo' && <Card className="p-4 space-y-3 bg-white border-gray-200">
        <div>
          <Label className="text-sm font-medium text-gray-900">What should the cut vinyl design look like? *</Label>
          <p className="text-xs text-gray-500 mb-1">Describe colors, shapes, text, layout — the more detail the better</p>
          <Textarea
            value={graphic.designPrompt}
            onChange={(e) => onChange({ designPrompt: e.target.value })}
            placeholder="e.g. Bold company logo with a mountain silhouette and the text 'Summit Roofing' in white Helvetica Bold, phone number (555) 123-4567 below in smaller text, blue and black color scheme, clean modern layout..."
            className="mt-1 min-h-[100px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
          />
        </div>
        <div>
          <Label className="text-sm text-gray-500">Style</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {DESIGN_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => onChange({ designStyle: s.value })}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  graphic.designStyle === s.value
                    ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                    : 'border-gray-200 text-gray-500 hover:border-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </Card>}

      {/* Commercial Mode — additional business fields */}
      {graphic.mode === 'commercial' && (
        <Card className="p-4 space-y-3 bg-white border-gray-200">
          <div>
            <Label className="text-sm text-gray-500">Business Name *</Label>
            <Input
              value={graphic.businessName}
              onChange={(e) => onChange({ businessName: e.target.value })}
              placeholder="Your Business Name"
              className="mt-1 bg-white border-gray-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm text-gray-500">Phone</Label>
              <Input
                value={graphic.businessPhone}
                onChange={(e) => onChange({ businessPhone: e.target.value })}
                placeholder="(555) 123-4567"
                className="mt-1 bg-white border-gray-200"
              />
            </div>
            <div>
              <Label className="text-sm text-gray-500">Website</Label>
              <Input
                value={graphic.businessWebsite}
                onChange={(e) => onChange({ businessWebsite: e.target.value })}
                placeholder="www.example.com"
                className="mt-1 bg-white border-gray-200"
              />
            </div>
          </div>
          <div>
            <Label className="text-sm text-gray-500">Industry</Label>
            <select
              value={graphic.businessIndustry}
              onChange={(e) => onChange({ businessIndustry: e.target.value })}
              className="w-full mt-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="">Select industry...</option>
              {BUSINESS_INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-sm text-gray-500">Tagline (optional)</Label>
            <Input
              value={graphic.businessTagline}
              onChange={(e) => onChange({ businessTagline: e.target.value })}
              placeholder="Your tagline or slogan"
              className="mt-1 bg-white border-gray-200"
            />
          </div>
          <div>
            <Label className="text-sm text-gray-500">Additional Text / Copy</Label>
            <Textarea
              value={graphic.businessCopyText}
              onChange={(e) => onChange({ businessCopyText: e.target.value })}
              placeholder="e.g. License #12345, 'Free Estimates', address, hours, services list..."
              className="mt-1 min-h-[60px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/60"
            />
          </div>
          <FontSelector
            value={graphic.businessFont}
            onChange={(font) => onChange({ businessFont: font })}
            label="Font Preference (optional)"
          />
          <div>
            <Label className="text-sm text-gray-500">Logo (optional)</Label>
            <div className="mt-1 flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!graphic.generateLogo}
                  onChange={(e) => onChange({ generateLogo: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-200 accent-blue-500"
                />
                <span className="text-xs text-gray-900">AI generates a logo</span>
              </label>
              <span className="text-xs text-gray-500">or</span>
              <button
                onClick={() => logoInputRef.current?.click()}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                upload yours
              </button>
              {graphic.businessLogoUrl && (
                <div className="flex items-center gap-2">
                  <img src={graphic.businessLogoUrl} alt="Logo" className="h-8 rounded" />
                  <button onClick={() => onChange({ businessLogoUrl: '', businessLogoFile: null })} className="text-xs text-red-400">remove</button>
                </div>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*,.svg,.pdf,.eps,.ai"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>
        </Card>
      )}

      {/* Upload Mode */}
      {graphic.mode === 'upload' && (
        <Card className="p-4 space-y-4 bg-white border-gray-200">
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-500/50 transition-colors"
            onClick={() => artworkInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 mx-auto text-gray-500/50 mb-2" />
            <p className="text-sm text-gray-500">Drop your artwork files here</p>
            <p className="text-xs text-gray-500/60 mt-1">PNG, JPG, SVG, PDF, EPS, AI — up to 50MB each</p>
            <input
              ref={artworkInputRef}
              type="file"
              accept={ACCEPTED_ART_TYPES}
              multiple
              className="hidden"
              onChange={handleArtworkUpload}
            />
          </div>

          {graphic.uploadedArtworkUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {graphic.uploadedArtworkUrls.map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt={`Artwork ${i + 1}`} className="w-16 h-16 rounded-md object-cover border border-gray-200" />
                  <button
                    onClick={() => removeArtwork(i)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Restyle Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200/20 bg-white">
            <div>
              <span className="text-sm font-medium text-gray-900">Restyle My Design</span>
              <span className="block text-xs text-gray-500">AI redesigns and modernizes your artwork</span>
            </div>
            <button
              onClick={() => onChange({ restyleEnabled: !graphic.restyleEnabled })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                graphic.restyleEnabled ? 'bg-blue-500' : 'bg-white'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                graphic.restyleEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {graphic.restyleEnabled && (
            <div>
              <Label className="text-sm text-gray-500">Restyle instructions</Label>
              <Textarea
                value={graphic.restylePrompt}
                onChange={(e) => onChange({ restylePrompt: e.target.value })}
                placeholder="e.g. Make it more modern, simplify the shapes, add a gradient..."
                className="mt-1 min-h-[80px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/60"
              />
            </div>
          )}
        </Card>
      )}

      {/* Restyle Mode */}
      {graphic.mode === 'restyle' && (
        <Card className="p-4 space-y-4 bg-white border-gray-200">
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-500/50 transition-colors"
            onClick={() => restyleInputRef.current?.click()}
          >
            {graphic.restyleSourceUrl ? (
              <div className="space-y-2">
                <img src={graphic.restyleSourceUrl} alt="Source artwork" className="max-h-32 mx-auto rounded-lg" />
                <p className="text-xs text-gray-500">Click to change</p>
              </div>
            ) : (
              <>
                <RefreshCw className="w-8 h-8 mx-auto text-gray-500/50 mb-2" />
                <p className="text-sm text-gray-500">Upload the graphic you want restyled</p>
                <p className="text-xs text-gray-500/60 mt-1">PNG, JPG, SVG, PDF</p>
              </>
            )}
            <input
              ref={restyleInputRef}
              type="file"
              accept="image/*,.svg,.pdf"
              className="hidden"
              onChange={handleRestyleUpload}
            />
          </div>
          <div>
            <Label className="text-sm text-gray-500">What changes do you want?</Label>
            <Textarea
              value={graphic.restylePrompt}
              onChange={(e) => onChange({ restylePrompt: e.target.value })}
              placeholder="e.g. Make it modern, add a gradient, simplify the logo, make it bolder..."
              className="mt-1 min-h-[100px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/60"
            />
          </div>
          <div>
            <Label className="text-sm text-gray-500">Text / Lettering to Include</Label>
            <Textarea
              value={graphic.businessCopyText}
              onChange={(e) => onChange({ businessCopyText: e.target.value })}
              placeholder="e.g. Team name, sponsor logos, car number, driver name, website URL..."
              className="mt-1 min-h-[60px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/60"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FontSelector
              value={graphic.businessFont}
              onChange={(font) => onChange({ businessFont: font })}
              label="Font (optional)"
            />
            <div>
              <Label className="text-sm text-gray-500">Logo</Label>
              <div
                className="mt-1 border-2 border-dashed border-gray-200 rounded-lg p-2 text-center cursor-pointer hover:border-blue-500/40 transition-colors"
                onClick={() => logoInputRef.current?.click()}
              >
                {graphic.businessLogoUrl ? (
                  <img src={graphic.businessLogoUrl} alt="Logo" className="max-h-10 mx-auto" />
                ) : (
                  <p className="text-[10px] text-gray-500">Upload logo</p>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
      {/* VisionBoardIQ — same component as DesignPro */}
      <Card className="p-4 bg-white border-gray-200">
        <VisionBoardUploader
          images={graphic.visionBoardImages as VisionBoardImage[]}
          onChange={(images: VisionBoardImage[]) => onChange({ visionBoardImages: images })}
          intent={graphic.visionBoardIntent as VisionBoardIntent}
          onIntentChange={(intent: VisionBoardIntent) => onChange({ visionBoardIntent: intent })}
          maxImages={4}
        />
      </Card>
    </div>
  );
}
