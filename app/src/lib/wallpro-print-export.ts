import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { layoutMetrics, type WallLayout } from './wallpro-geometry';
import { intersectPrintRect, wallPrintPreflight, type PrintRect, type WallPrintSettings } from './wallpro-print-plan';

export type WallPrintSource = { bytes: Uint8Array; width: number; height: number };
export type WallPrintFile = { name: string; bytes: Uint8Array; mime: string };
export type WallPrintPack = { id: string; filename: string; zip: Uint8Array; files: WallPrintFile[]; manifest: Record<string, unknown> };
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '-').slice(0, 160);
const fmt = (n: number) => Number(n.toFixed(3)).toString();
const maxPackBytes = 256 * 1024 * 1024;
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');

/** PDF image objects retain all source pixels. Physical placement is expressed
 * in PDF points; there is no wall-sized canvas and no preview-resolution cap. */
function drawWall(doc: jsPDF, frame: PrintRect, layout: WallLayout, source: WallPrintSource, bleed: number, factor: number, offset = { x: 0, y: 0 }) {
  const m = layoutMetrics(layout, source.width / source.height);
  const px = (x: number) => offset.x + (x - frame.x) * factor;
  const py = (y: number) => offset.y + (y - frame.y) * factor;
  const clip = (r: PrintRect) => { doc.rect(px(r.x), py(r.y), r.width * factor, r.height * factor); doc.clip(); doc.discardPath(); };
  const image = (x: number, y: number) => doc.addImage(source.bytes, 'PNG', px(x), py(y), m.artworkWidth * factor, m.artworkHeight * factor, 'wall-source', 'FAST');
  doc.saveGraphicsState(); clip(frame);
  if (layout.mode === 'repeat') {
    for (let row = Math.floor(frame.y / m.artworkHeight); row * m.artworkHeight < frame.y + frame.height - 1e-8; row++) {
      for (let col = Math.floor(frame.x / m.artworkWidth); col * m.artworkWidth < frame.x + frame.width - 1e-8; col++) image(col * m.artworkWidth, row * m.artworkHeight);
    }
  } else {
    // Reflect the accepted wall composition into perimeter bleed. The artwork
    // inside the wall keeps the exact same crop/fit and physical dimensions.
    const xs = [{ start: -bleed, length: bleed, sign: -1, shift: 0 }, { start: 0, length: layout.width, sign: 1, shift: 0 }, { start: layout.width, length: bleed, sign: -1, shift: 2 * layout.width }];
    const ys = [{ start: -bleed, length: bleed, sign: -1, shift: 0 }, { start: 0, length: layout.height, sign: 1, shift: 0 }, { start: layout.height, length: bleed, sign: -1, shift: 2 * layout.height }];
    for (const x of xs) for (const y of ys) {
      const region = intersectPrintRect(frame, { x: x.start, y: y.start, width: x.length, height: y.length });
      if (!region) continue;
      doc.saveGraphicsState(); clip(region);
      const tx = (1 - x.sign) * (offset.x - frame.x * factor) + x.shift * factor;
      const ty = (1 - y.sign) * (doc.internal.pageSize.getHeight() - offset.y + frame.y * factor) - y.shift * factor;
      doc.setCurrentTransformationMatrix(doc.Matrix(x.sign, 0, 0, y.sign, tx, ty));
      image((layout.width - m.artworkWidth) / 2, (layout.height - m.artworkHeight) / 2);
      doc.restoreGraphicsState();
    }
  }
  doc.restoreGraphicsState();
}

function fullSizePdf(frame: PrintRect, layout: WallLayout, source: WallPrintSource, bleed: number, title: string) {
  // PDF 1.6 UserUnit expresses physical size without jsPDF's 200-inch MediaBox
  // clamp. Ordinary wall panels use UserUnit=1. Never silently scale a page.
  const userUnit = Math.max(1, Math.ceil(Math.max(frame.width, frame.height) / 199));
  const factor = 72 / userUnit;
  const doc = new jsPDF({ unit: 'pt', format: [frame.width * factor, frame.height * factor], orientation: frame.width > frame.height ? 'landscape' : 'portrait', userUnit, compress: true, floatPrecision: 8 });
  (doc as unknown as { __private__: { setPdfVersion(v: string): void } }).__private__.setPdfVersion('1.6');
  doc.setProperties({ title: ascii(title), subject: 'Full-size wall artwork. Print MediaBox at 100%.', creator: 'DesignProAI WallPro', author: 'WallPro' });
  doc.setDisplayMode('fullwidth', 'single');
  const ctx = doc.getCurrentPageInfo().pageContext;
  ctx.bleedBox = { bottomLeftX: 0, bottomLeftY: 0, topRightX: frame.width * factor, topRightY: frame.height * factor };
  const trim = intersectPrintRect(frame, { x: 0, y: 0, width: layout.width, height: layout.height });
  if (trim) ctx.trimBox = { bottomLeftX: (trim.x - frame.x) * factor, bottomLeftY: (frame.y + frame.height - trim.y - trim.height) * factor, topRightX: (trim.x + trim.width - frame.x) * factor, topRightY: (frame.y + frame.height - trim.y) * factor };
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, frame.width * factor, frame.height * factor, 'F');
  drawWall(doc, frame, layout, source, bleed, factor);
  return new Uint8Array(doc.output('arraybuffer'));
}

export async function buildWallPrintPack(input: {
  name: string; projectId?: string; layout: WallLayout; settings: WallPrintSettings; source: WallPrintSource;
  onProgress?: (message: string) => void;
}): Promise<WallPrintPack> {
  const { layout, settings, source, onProgress } = input;
  // Check the actual embedded PNG dimensions, not caller-provided metadata.
  const inspector = new jsPDF();
  const props = inspector.getImageProperties(source.bytes);
  if (props.fileType !== 'PNG' || props.width !== source.width || props.height !== source.height) throw new Error('The print source dimensions changed. Choose the artwork again.');
  const check = wallPrintPreflight(layout, settings, source);
  if (!check.ready) throw new Error(check.blockers.join(' '));
  if (source.bytes.length * (check.plan.panels.length + 2) > maxPackBytes) throw new Error('This package would exceed 256 MB. Export a smaller wall section or use a more compact source image.');
  const id = crypto.randomUUID(), created = new Date().toISOString();
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'wall';
  const files: WallPrintFile[] = [];
  let total = 0;
  const add = (name: string, bytes: Uint8Array, mime: string) => { total += bytes.length; if (total > maxPackBytes) throw new Error('This package exceeds 256 MB. Export a smaller wall section.'); files.push({ name, bytes, mime }); };
  const yieldUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  const panels = check.plan.panels.map(panel => ({ ...panel, filename: `panels/panel-${String(panel.number).padStart(3, '0')}-${fmt(panel.width)}x${fmt(panel.height)}in.pdf` }));
  for (const panel of panels) {
    onProgress?.(`Building panel ${panel.number} of ${panels.length}`); await yieldUi();
    add(panel.filename, fullSizePdf(panel, layout, source, settings.bleed, `${input.name} | Panel ${panel.number} of ${panels.length} | ${fmt(panel.width)} x ${fmt(panel.height)} inches`), 'application/pdf');
  }
  onProgress?.('Building the full wall master'); await yieldUi();
  add('wall-master-full-size.pdf', fullSizePdf(check.plan.bounds, layout, source, settings.bleed, `${input.name} | Full wall master including perimeter bleed`), 'application/pdf');
  add('source-artwork.png', source.bytes, 'image/png');

  onProgress?.('Building the installation sheet'); await yieldUi();
  const sheet = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape', compress: true });
  sheet.setProperties({ title: ascii(`${input.name} - installation layout`), creator: 'DesignProAI WallPro' });
  sheet.setFont('helvetica', 'bold'); sheet.setFontSize(21); sheet.setTextColor(22, 35, 58); sheet.text('WallPro | Installation layout', 36, 36);
  sheet.setFont('helvetica', 'normal'); sheet.setFontSize(10); sheet.text(ascii(input.name), 36, 54);
  sheet.text(`Wall ${fmt(layout.width)} x ${fmt(layout.height)} in  |  ${panels.length} panels  |  Print width <= 51 in`, 36, 71);
  const map = { x: 0, y: 0, width: layout.width, height: layout.height };
  const mapScale = Math.min(720 / layout.width, 195 / layout.height);
  const mapOffset = { x: 36, y: 88 };
  drawWall(sheet, map, layout, source, 0, mapScale, mapOffset);
  sheet.setDrawColor(0, 142, 170); sheet.setLineWidth(0.8);
  for (const panel of panels) {
    const left = Math.max(0, panel.x), right = Math.min(layout.width, panel.x + panel.width);
    sheet.rect(36 + left * mapScale, 88, (right - left) * mapScale, layout.height * mapScale);
    if (panels.length <= 24) { sheet.setFillColor(255, 255, 255); sheet.roundedRect(38 + left * mapScale, 92, 22, 15, 2, 2, 'F'); sheet.setFontSize(9); sheet.text(String(panel.number), 49 + left * mapScale, 103, { align: 'center' }); }
  }
  let y = 306;
  sheet.setFontSize(10);
  const notes = [
    `Print panel PDFs at 100% / actual size using the MediaBox. Disable Fit to page. Install left to right.`,
    `Adjacent panels share ${fmt(settings.overlap)} in of identical artwork. Align the duplicate image; do not stretch panels.`,
    `Perimeter bleed: ${fmt(settings.bleed)} in. ${layout.mode === 'repeat' ? 'Pattern continues through bleed.' : 'Bleed mirrors the approved wall edges.'} Trim the outside perimeter to the measured wall.`,
    `Effective source resolution: ${check.ppi.toFixed(1)} PPI. Selected minimum: ${settings.minPpi} PPI. No artificial upscaling.`,
    `RGB artwork on white. Apply your printer/media ICC profile in the RIP and check a physical color sample.`,
    `Wall-photo masks are preview only. Panels contain continuous artwork; trim doors/windows during installation.`,
    `The master includes bleed and is wider than the printer. Send the numbered panel PDFs to the RIP.`,
    `Pack ${id} | Created ${created}`,
  ];
  for (const line of notes) { sheet.text(line, 36, y); y += 16; }
  sheet.addPage('letter', 'landscape');
  const tableHeader = () => { sheet.setFont('helvetica', 'bold'); sheet.setFontSize(16); sheet.text('Panel dimensions and wall coordinates', 36, 38); sheet.setFontSize(10); sheet.text('Panel', 36, 66); sheet.text('PDF size (inches)', 105, 66); sheet.text('Wall X start / end', 280, 66); sheet.text('Overlap on left', 455, 66); sheet.setFont('helvetica', 'normal'); };
  tableHeader(); y = 89;
  for (const panel of panels) {
    if (y > 548) { sheet.addPage('letter', 'landscape'); tableHeader(); y = 89; }
    sheet.text(String(panel.number).padStart(3, '0'), 36, y); sheet.text(`${fmt(panel.width)} x ${fmt(panel.height)}`, 105, y);
    sheet.text(`${fmt(panel.x)} / ${fmt(panel.x + panel.width)}`, 280, y); sheet.text(`${fmt(panel.overlapLeft)} in`, 455, y); y += 22;
  }
  sheet.setFontSize(9); sheet.text('Coordinates start at the top-left of the finished wall. Negative coordinates are perimeter bleed.', 36, 579);
  add('installation-layout.pdf', new Uint8Array(sheet.output('arraybuffer')), 'application/pdf');

  const readme = [
    'WALLPRO PRINT PACKAGE', input.name, '', ...notes, '',
    `Finished wall: ${fmt(layout.width)} x ${fmt(layout.height)} inches.`,
    `Panel PDF height including bleed: ${fmt(check.plan.bounds.height)} inches.`,
    'Panel PDFs contain full source-resolution imagery and physical PDF dimensions. They are RGB, not a CMYK/PDF-X conversion.',
    'Pages longer than 199 inches use PDF 1.6 UserUnit. Confirm that the RIP preserves the stated physical size.',
    'Use the installation sheet as a map, not as printable wall artwork. Panel identifiers are in filenames and the map, not overprinted on the design.',
    'Verify the first panel size and a color sample before printing the complete wall.',
    'This is a local print export. It does not submit an order or send files to a print queue.',
  ].join('\n');
  add('PRINT-INSTRUCTIONS.txt', new TextEncoder().encode(readme), 'text/plain');
  const inventory = await Promise.all(files.map(async f => ({ path: f.name, mimeType: f.mime, bytes: f.bytes.length, sha256: await sha256(f.bytes) })));
  const manifest = { contract: 'wallpro.print-pack.v1', packId: id, projectId: input.projectId || null, name: input.name, createdAt: created,
    units: 'inches', printScale: 1, printableWidth: 51, wall: check.plan.wall, placement: layout, settings,
    bleedBehavior: layout.mode === 'repeat' ? 'continuous-repeat' : 'mirror-wall-perimeter', color: 'RGB; assign sRGB input and printer/media ICC in RIP',
    source: { widthPixels: source.width, heightPixels: source.height, effectivePpi: check.ppi, sha256: await sha256(source.bytes), pixelResampling: false },
    panels, files: inventory, preflight: { passed: true, minimumPpi: settings.minPpi, allPanelsWithinPrintableWidth: panels.every(p => p.width <= 51) } };
  add('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)), 'application/json');
  onProgress?.('Packaging print files'); await yieldUi();
  const zip = new JSZip(); for (const file of files) zip.file(file.name, file.bytes);
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  return { id, filename: `wallpro-${slug}-${id.slice(0, 8)}-print-pack.zip`, zip: zipBytes, files, manifest };
}
