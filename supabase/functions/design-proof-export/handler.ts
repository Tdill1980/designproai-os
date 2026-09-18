// Ports ProfessionalProofSheet.captureProofAsPdf delivery and the
// send-client-proof-email PDF attachment/link behavior into the standalone OS.
// The browser supplies the SAME PDF used for Print/Download. No design is generated.
const BUCKET = 'wrap-files';
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const LINK_SECONDS = 7 * 24 * 60 * 60;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const field = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

export function proofMetadata(input: any) {
  if (!input || !['weprintwraps', 'designpro'].includes(input.brand)) throw new Error('Choose the proof brand.');
  const tool = input.tool || 'patternpro';
  if (!['patternpro', 'wallpro'].includes(tool)) throw new Error('Unknown proof tool.');
  const yards = tool === 'patternpro' ? Number(input.yards) : undefined;
  if (tool === 'patternpro' && (!Number.isFinite(yards) || yards! <= 0 || yards! > 1000)) throw new Error('Enter a valid quantity in yards.');
  let wall: { widthInches: number; heightInches: number; squareFeet: number; linearFeet: number; panels: number } | undefined;
  if (tool === 'wallpro') {
    const value = input.wall || {};
    wall = { widthInches: Number(value.widthInches), heightInches: Number(value.heightInches), squareFeet: Number(value.squareFeet), linearFeet: Number(value.linearFeet), panels: Number(value.panels) };
    if (Object.values(wall).some(n => !Number.isFinite(n) || n <= 0 || n > 100000) || !Number.isInteger(wall.panels)) throw new Error('Enter valid wall dimensions and panel quantities.');
  }
  const wpw = input.brand === 'weprintwraps';
  const vehicle = field(input.vehicle);
  const design = field(input.design);
  if (!vehicle || !design) throw new Error('The proof needs a project and design name.');
  const toolTitle = tool === 'wallpro' ? 'WallPro' : 'PatternPro';
  return {
    brand: input.brand as 'designpro' | 'weprintwraps',
    tool, title: wpw ? `WPW × ${toolTitle}` : toolTitle,
    footer: wpw ? '® DesignProAI Software for WePrintWraps' : '® DesignProAI Software',
    vehicle, design, yards, wall, finish: field(input.finish, 40) || 'Gloss',
    customerName: field(input.customerName), quoteNumber: field(input.quoteNumber, 80),
    orderNumber: field(input.orderNumber, 80), sourceId: field(input.sourceId, 80),
    designId: field(input.designId, 80), generationId: field(input.generationId, 80), projectId: field(input.projectId, 80),
    includeTerms: input.includeTerms === true,
  };
}

export function proofEmailHtml(metadata: ReturnType<typeof proofMetadata>, message: string, url: string) {
  const e = escapeHtml;
  const quantity = metadata.wall ? `${metadata.wall.widthInches}″ × ${metadata.wall.heightInches}″ · ${metadata.wall.squareFeet} sq ft · ${metadata.wall.panels} panels` : `${metadata.yards} linear yards · 60-inch roll`;
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#111">
  <div style="max-width:680px;margin:24px auto;background:white;padding:32px;border-radius:12px">
  <h1 style="margin:0 0 8px;color:#000;font-size:24px">${e(metadata.title)}</h1>
  <p style="color:#536277">Design Approval Proof · ${e(metadata.vehicle)}</p>
  <p style="line-height:1.6;white-space:pre-wrap">${e(message)}</p>
  <div style="padding:16px;background:#f0f5ff;border-radius:8px"><strong>${e(metadata.design)}</strong><br>
  ${e(quantity)} · ${e(metadata.finish)}</div>
  <p style="margin:24px 0"><a href="${e(url)}" style="display:inline-block;background:#2166d1;color:#fff;text-decoration:none;padding:14px 20px;border-radius:6px">Download proof PDF</a></p>
  <p style="font-size:12px;color:#637083">The PDF is also attached. The download link is available for seven days. Reply to this email with your approval or requested changes.</p>
  <p style="margin-top:28px;text-align:right;font-size:11px;color:#111">${e(metadata.footer)}</p></div></body></html>`;
}

function toBase64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export function createProofExportHandler({ db, fetchImpl = fetch, resendKey, fromEmail = 'orders@designproai.com' }: {
  db: any; fetchImpl?: typeof fetch; resendKey?: string; fromEmail?: string;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
    const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return json(401, { error: 'Sign in to save or email a proof.' });
    const { data: auth, error: authError } = await db.auth.getUser(bearer).catch(() => ({ data: null, error: true }));
    if (authError || !auth?.user?.id || auth.user.is_anonymous) return json(401, { error: 'Sign in to save or email a proof.' });
    const user = auth.user;
    if (Number(req.headers.get('content-length') || 0) > MAX_PDF_BYTES * 1.4 + 10000) return json(413, { error: 'The proof PDF is too large.' });
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid proof request.' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid proof request.' });
    const files = db.storage.from(BUCKET);
    const prefix = `proof-exports/${user.id}/`;
    try {
      if (body.action === 'list') {
        if (body.brand && !['designpro', 'weprintwraps'].includes(body.brand)) return json(400, { error: 'Unknown proof brand.' });
        if (body.tool && !['patternpro', 'wallpro'].includes(body.tool)) return json(400, { error: 'Unknown proof system.' });
        const page = Number(body.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > 10000) return json(400, { error: 'Invalid proof page.' });
        let query = db.from('design_proofs').select('id,brand,tool,storage_path,metadata,created_at')
          .eq('owner_user_id', user.id);
        if (body.brand) query = query.eq('brand', body.brand);
        if (body.tool) query = query.eq('tool', body.tool);
        const search = field(body.search, 160);
        // A single bound ilike value: punctuation cannot add PostgREST filters.
        if (search) query = query.ilike('search_text', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
        const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 24, page * 24 + 24);
        if (result.error) throw new Error('Your saved proofs could not be loaded. Please try again.');
        return json(200, { success: true, proofs: (result.data || []).slice(0, 24), hasMore: (result.data || []).length > 24 });
      }
      if (body.action === 'save') {
        let metadata;
        try { metadata = proofMetadata(body.metadata); } catch (error) { return json(400, { error: (error as Error).message }); }
        if (typeof body.pdfBase64 !== 'string' || body.pdfBase64.length > Math.ceil(MAX_PDF_BYTES * 4 / 3)) return json(413, { error: 'The proof PDF is too large.' });
        let binary: string;
        try { binary = atob(body.pdfBase64); } catch { return json(400, { error: 'Invalid PDF.' }); }
        if (!binary.startsWith('%PDF-') || binary.length > MAX_PDF_BYTES) return json(400, { error: 'Invalid PDF.' });
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const id = crypto.randomUUID();
        const path = `${prefix}${id}/proof.pdf`;
        const contextPath = path.replace('/proof.pdf', '/context.json');
        const uploaded = await files.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
        if (uploaded.error) throw new Error('The proof PDF could not be saved.');
        const context = await files.upload(contextPath, JSON.stringify(metadata), { contentType: 'application/json', upsert: false });
        if (context.error) {
          await files.remove([path]);
          throw new Error('The proof details could not be saved.');
        }
        const signed = await files.createSignedUrl(path, LINK_SECONDS, { download: `${metadata.tool === 'wallpro' ? 'WallPro' : 'PatternPro'}-Design-Proof.pdf` });
        if (signed.error || !signed.data?.signedUrl) {
          await files.remove([path, contextPath]);
          throw new Error('The proof download link could not be created.');
        }
        const indexed = await db.from('design_proofs').insert({ id, owner_user_id: user.id, brand: metadata.brand, tool: metadata.tool, storage_path: path, metadata });
        if (indexed.error) {
          await files.remove([path, contextPath]);
          throw new Error('The proof could not be filed in DesignProofs. Please try again.');
        }
        return json(200, { success: true, id, path, pdfUrl: signed.data.signedUrl });
      }
      if (!['email', 'link'].includes(body.action)) return json(400, { error: 'Unknown proof action.' });
      // Only a PDF created for this authenticated owner can be emailed. The
      // sender cannot supply arbitrary attachment URLs or a different sender.
      const path = typeof body.path === 'string' ? body.path : '';
      if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\/proof\.pdf$/.test(path.slice(prefix.length))) return json(403, { error: 'This proof belongs to another account or is unavailable.' });
      if (body.action === 'link') {
        const existing = await files.download(path.replace('/proof.pdf', '/context.json'));
        if (existing.error || !existing.data) return json(404, { error: 'Saved proof not found.' });
        const metadata = proofMetadata(JSON.parse(await existing.data.text()));
        const signed = await files.createSignedUrl(path, LINK_SECONDS, { download: `${metadata.tool === 'wallpro' ? 'WallPro' : 'PatternPro'}-Design-Proof.pdf` });
        if (signed.error || !signed.data?.signedUrl) throw new Error('The proof download link could not be created.');
        return json(200, { success: true, path, pdfUrl: signed.data.signedUrl });
      }
      const to = field(body.to, 254);
      const subject = field(body.subject, 200);
      const message = field(body.message, 4000);
      if (!emailPattern.test(to) || !subject || !message || /[\r\n]/.test(subject)) return json(400, { error: 'Enter a valid recipient, subject, and message.' });
      if (!resendKey) return json(503, { error: 'Proof email is not configured. You can download or share the PDF.' });
      const context = await files.download(path.replace('/proof.pdf', '/context.json'));
      if (context.error || !context.data) return json(404, { error: 'Saved proof not found. Open the proof and try again.' });
      const metadata = proofMetadata(JSON.parse(await context.data.text()));
      const pdf = await files.download(path);
      if (pdf.error || !pdf.data || pdf.data.size > MAX_PDF_BYTES) return json(404, { error: 'Saved PDF not found.' });
      const filename = `${metadata.tool === 'wallpro' ? 'WallPro' : 'PatternPro'}-Design-Proof.pdf`;
      const signed = await files.createSignedUrl(path, LINK_SECONDS, { download: filename });
      if (signed.error || !signed.data?.signedUrl) throw new Error('The proof download link could not be created.');
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([path, to.toLowerCase(), subject, message]))));
      const idempotencyKey = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `design-proof-${idempotencyKey}` },
        body: JSON.stringify({
          from: `${metadata.title} <${fromEmail}>`, to: [to],
          ...(emailPattern.test(user.email || '') ? { reply_to: user.email } : {}),
          subject, html: proofEmailHtml(metadata, message, signed.data.signedUrl),
          attachments: [{ filename, content: toBase64(new Uint8Array(await pdf.data.arrayBuffer())) }],
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.id) return json(502, { error: 'The email provider did not confirm delivery. Your saved PDF is still available; please try again.' });
      // Same immutable export can be resent without changing its design or yards.
      return json(200, { success: true, emailId: result.id });
    } catch (error) {
      console.error('[design-proof-export]', error instanceof Error ? error.message : 'Failed');
      return json(500, { error: error instanceof Error ? error.message : 'The proof could not be delivered.' });
    }
  };
}
