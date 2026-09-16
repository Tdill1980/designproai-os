// The WallPro batch brief writer — RULE 1 port of RestylePro's
// `supabase/functions/generate-batch-prompts` (the AI that wrote the fresh
// commercial/restyle briefs its vehicle batch ran; owner, 2026-09-14: "Every
// single one was fantastic"). It writes NATURAL-LANGUAGE customer briefs for
// the curator's batch, in the voice of the static preset library, and the
// batch then sends each brief to `generate-wall-design` exactly as a customer
// would — where the consultant and designer personas do the designing.
//
// Curator-side only (admin / tester, the catalog's own curator roles). It is
// never on the customer path, so the standing "no extra LLM stage before the
// customer sees anything" rule is untouched. No token is charged.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const BRIEF_WRITER_MODEL = 'gemini-2.5-flash';
export const BRIEF_WRITER_VERSION = 'wallpro-brief-writer.20260914.v1';
export const MAX_COUNT = 20;

export type BriefDomain = 'commercial' | 'residential';
export type BriefMode = 'repeat' | 'mural';
export type BriefRendering = 'flat-bold' | 'fine-line' | 'faux-material' | 'painted-mural' | 'photographic';
export type BriefRequest = { domain: BriefDomain; count: number; space: string | null; rendering: BriefRendering | 'any'; mode: BriefMode | 'any' };
export type GeneratedWallBrief = { id: string; name: string; subcategory: string; style: string; prompt: string; tags: string[]; mode: BriefMode; rendering: BriefRendering; domain: BriefDomain };

const RENDERINGS: BriefRendering[] = ['flat-bold', 'fine-line', 'faux-material', 'painted-mural', 'photographic'];
const RESIDENTIAL_SPACES = 'bedroom, nursery, kids\' room, living room, dining room, kitchen, powder room, bathroom, entryway, hallway, home office, media room';
const COMMERCIAL_SPACES = 'restaurant, cafe, bar, retail store, salon, spa, med-spa, dental office, medical office, gym, corporate office, coworking space, hotel, apartment leasing lobby, church, school, daycare, wrap shop, auto shop';

const RENDERING_SCOPE: Record<BriefRendering, string> = {
  'flat-bold': 'flat bold print — bold silhouettes in two to four solid colours on a solid ground, block print / linocut / screen print, crisp or dry-brush edges',
  'fine-line': 'fine-line engraving — toile, lattice, trellis or botanical engraving built from hatched or single pen lines in one or two inks on a plain ground',
  'faux-material': 'photoreal faux material — chevron or herringbone wood, slat wall, zellige or subway tile, marble, brick, plaster or limewash, straight-on with no perspective or lighting hot spots',
  'painted-mural': 'a painted mural — gouache, watercolor, oil or chinoiserie hand-painting, one scene across the wall',
  'photographic': 'fine-art photographic realism, one continuous image across the wall',
};

/** Marketplace signals (owner, 2026-09-14: "use the marketplace research as
 * taxonomy input, not prompt copying"). Current residential wall-mural
 * listings sell under these styles and palette families; the writer rotates
 * a set across them so a batch does not converge on one "luxury botanical AI
 * wallpaper", and generates ORIGINAL designs under each. A subset of the
 * `RESIDENTIAL_STYLE_TAXONOMY` in generate-wall-design/domain.ts. */
export const RESIDENTIAL_STYLE_SIGNALS = ['Boho', 'Contemporary Boho', 'Organic Modern', 'Japandi', 'Scandinavian', 'Soft Minimalism', 'Quiet Luxury', 'Modern Luxe', 'Contemporary Classic', 'Transitional', 'Grandmillennial', 'Modern Coastal', 'Modern Mediterranean', 'Mid-Century Modern', 'Modern Art Deco', 'Moody Maximalist', 'Vintage Botanical', 'Modern Chinoiserie', 'Cottagecore', 'Dark Academia', 'Modern Rustic', 'Desert Modern', 'Modern Tropical', 'Biophilic', 'Wabi-Sabi', 'Warm Minimalist', 'Nursery Editorial', 'Whimsical', 'Feminine Luxe', 'Masculine Modern', 'Abstract Organic', 'Geometric Modern'] as const;
export const PALETTE_FAMILY_SIGNALS = ['warm beige, taupe and ivory', 'sage, olive and deep green', 'terracotta, blush and earth tones', 'a charcoal or black ground with one accent', 'indigo or navy with cream', 'dusty pastels on oat'] as const;
/** The commercial disciplines an environmental-graphics studio actually
 * bids: the set rotates across them and each brief names the wall it hangs on. */
export const COMMERCIAL_DISCIPLINE_SIGNALS = ['restaurant or bar dining room', 'corporate reception or culture wall', 'apartment leasing office or clubhouse', 'church or worship lobby and kids ministry', 'med-spa or wellness treatment corridor', 'retail boutique feature wall', 'gym or fitness training floor', 'dental or medical waiting room', 'hotel corridor or lobby', 'school or daycare hallway'] as const;

export function parseBriefRequest(body: any): BriefRequest {
  if (!body || typeof body !== 'object') throw new Error('Send a JSON body.');
  const domain = body.domain === 'residential' ? 'residential' : body.domain === 'commercial' ? 'commercial' : null;
  if (!domain) throw new Error('domain must be "commercial" or "residential".');
  const count = Math.min(Math.max(Math.round(Number(body.count) || 5), 1), MAX_COUNT);
  const space = typeof body.space === 'string' && body.space.trim() ? body.space.trim().slice(0, 60) : null;
  const rendering: BriefRequest['rendering'] = RENDERINGS.includes(body.rendering) ? body.rendering : 'any';
  const mode: BriefRequest['mode'] = body.mode === 'repeat' || body.mode === 'mural' ? body.mode : 'any';
  return { domain, count, space, rendering, mode };
}

/** The persona. Written the way the RestylePro preset library reads: a
 * client who knows what they want telling a designer, never a spec sheet. */
export function briefWriterPrompt(req: BriefRequest): string {
  const scope = req.space
    ? `${req.domain === 'residential' ? 'a home' : 'a business'} — every brief is for a ${req.space}`
    : req.domain === 'residential'
      ? `homes — ${RESIDENTIAL_SPACES} — sold as premium wallpaper and murals`
      : `business interiors — ${COMMERCIAL_SPACES} — specified the way a working commercial interior designer specifies a feature wall for that kind of business`;
  const renderingLine = req.rendering === 'any'
    ? 'Rotate the rendering families across the set: flat bold print (two to four solid colours), fine-line engraving (one or two inks), photoreal faux material, and — only when the space calls for one scene — a painted mural.'
    : `Every brief is ${RENDERING_SCOPE[req.rendering]}.`;
  const modeLine = req.mode === 'repeat' ? 'Every brief is a repeating wallpaper pattern.' : req.mode === 'mural' ? 'Every brief is one continuous mural.' : 'Most briefs are repeating wallpaper patterns; a mural only where one scene genuinely suits the space.';
  // Marketplace signals as taxonomy: the writer rotates the set across the
  // styles and palettes the market is buying, and each brief names its own
  // style — then designs something original under it. The style is guidance
  // for restraint, palette relationships and spacing; it never replaces the
  // subject (the same rule the design contract enforces downstream).
  const disciplineLine = req.domain === 'residential'
    ? `Rotate the set across current interior styles — ${RESIDENTIAL_STYLE_SIGNALS.join(', ')} — naming ONE style per brief, and across these palette families — ${PALETTE_FAMILY_SIGNALS.join('; ')} — so no two briefs share one. Write with the restraint of an interior designer specifying a wallcovering for a real room: coherent palette, current not dated, motif scale that reads on a wall. The style informs composition, materials and spacing; it never replaces the subject.`
    : `Rotate the set across commercial disciplines — ${COMMERCIAL_DISCIPLINE_SIGNALS.join('; ')} — naming the business type and the exact wall it hangs on in each brief, and write like an environmental-graphics studio briefing a client: room-scale hierarchy, one focal point, a mood that fits that business, no decorative filler, no generic wallpaper look, no spa leaves for every wellness space.`;
  return `You are the creative director of a wallpaper and mural studio whose patterns sell on Etsy and to interior designers. You write the briefs our designers work from — the way a well-read client talks to a designer, never like a spec sheet.

Write exactly ${req.count} briefs for ${scope}.
${disciplineLine}

Each brief is 50 to 110 words of plain prose and names:
- ONE clear subject, described concretely (which flowers, which animals, which shapes);
- the colours, with the ground colour named and the accent named — flat print uses two to four solid colours, fine line uses one or two inks, faux material uses the real material's own tones;
- the technique: hand-cut block print, linocut, screen print, engraved hatched toile line, fine pen line, woodblock, gouache, watercolor, or a photoreal faux material (chevron or herringbone wood, slat wall, zellige or subway tile, marble, plaster, limewash);
- for a repeat, the repeat structure (half-drop, straight, ogee, trellis, tossed, stripe) and the hero motif's size in inches; for a mural, what fills the wall and where the eye rests;
- the room and the feeling it should give, in a few words.

${renderingLine}
${modeLine}

Never use marketing adjectives (stunning, vibrant, breathtaking, elevate, timeless, luxurious, exquisite). Never mention print production (4K, PPI, panels, seams, bleed, overlap, upscaling). Never describe a room mockup, furniture or lighting. Never ask for text, logos or brand names. Never name a living artist or a trademarked pattern. Flat print has no gradients, no soft shading and no photorealism — depth comes from layering and line weight.

Diversity is the job: every brief has a different subject, a different ground colour, a different technique and a different repeat structure from every other brief in the set. No two briefs share a palette family.

Return ONLY a JSON array, no prose and no code fences:
[{ "name": "two to four word title", "subcategory": "the space it is for", "style": "the interior style named in the brief, or the business type", "prompt": "the brief", "tags": ["three to five lowercase tags"], "mode": "repeat" or "mural", "rendering": "flat-bold" | "fine-line" | "faux-material" | "painted-mural" | "photographic" }]`;
}

// "comic panel wall" is a subject; print panels, seams, bleed and overlap are pipeline words.
const PRODUCTION_WORDS = /\b(4k|ppi|dpi|print panels?|panelis\w*|seams?|bleed|overlap|upscal\w*)\b/i;
const MARKETING_WORDS = /\b(stunning|breathtaking|elevate|elevates|exquisite)\b/i;
const designId = /^WPB-[0-9A-Z][0-9A-Z-]{3,19}$/;

/** Turns the model's array into batch entries: drops anything that is not a
 * usable brief (empty, too short, spec-sheet or marketing language) rather
 * than sending it to a designer, stamps a catalog-legal DesignID and the
 * request's domain, and caps at the requested count. */
export function normalizeGeneratedBriefs(raw: unknown, req: BriefRequest, now = Date.now()): GeneratedWallBrief[] {
  if (!Array.isArray(raw)) throw new Error('The brief writer did not return a list.');
  const stamp = now.toString(36).toUpperCase().slice(-6);
  const out: GeneratedWallBrief[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const prompt = typeof item.prompt === 'string' ? item.prompt.replace(/\s+/g, ' ').trim() : '';
    if (prompt.length < 40 || prompt.length > 900) continue;
    if (PRODUCTION_WORDS.test(prompt) || MARKETING_WORDS.test(prompt)) continue;
    const mode: BriefMode = req.mode !== 'any' ? req.mode : item.mode === 'mural' ? 'mural' : 'repeat';
    const rendering: BriefRendering = req.rendering !== 'any' ? req.rendering : RENDERINGS.includes(item.rendering) ? item.rendering : mode === 'mural' ? 'painted-mural' : 'flat-bold';
    const n = out.length + 1;
    const id = `WPB-AI-${stamp}-${String(n).padStart(2, '0')}`;
    if (!designId.test(id)) continue;
    out.push({
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : `Brief ${n}`,
      subcategory: typeof item.subcategory === 'string' && item.subcategory.trim() ? item.subcategory.trim().slice(0, 60) : (req.space || (req.domain === 'residential' ? 'Home' : 'Business')),
      style: typeof item.style === 'string' && item.style.trim() ? item.style.trim().slice(0, 60) : rendering,
      prompt,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().toLowerCase().slice(0, 30)).slice(0, 8) : [],
      mode, rendering, domain: req.domain,
    });
    if (out.length >= req.count) break;
  }
  return out;
}

// Injectable boundary for contract tests. No request can supply credentials or URLs.
export function createBriefWriterHandler(deps: { createClient: (...args: any[]) => any; supabaseUrl: string; serviceKey: string; apiKey: () => string; fetch: typeof fetch }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const { data: auth, error: authError } = jwt ? await sb.auth.getUser(jwt).catch(() => ({ data: null, error: true })) : { data: null, error: true };
    if (authError || !auth?.user?.id) return response({ error: 'Sign in to write batch briefs.', code: 'AUTH_REQUIRED' }, 401);
    // The catalog's curator roles (the same predicate its RLS uses).
    const roles = await sb.from('user_roles').select('role').eq('user_id', auth.user.id).in('role', ['admin', 'tester']);
    if (roles.error || !Array.isArray(roles.data) || roles.data.length === 0) return response({ error: 'Only catalog curators can write batch briefs.', code: 'CURATOR_REQUIRED' }, 403);
    let request: BriefRequest;
    try {
      const text = await req.text();
      if (text.length > 4000) throw new Error('The request is too large.');
      request = parseBriefRequest(JSON.parse(text));
    } catch (err) { return response({ error: err instanceof Error ? err.message : 'Invalid request' }, 400); }
    const key = deps.apiKey();
    if (!key) return response({ error: 'The brief writer is not configured.', code: 'NOT_CONFIGURED' }, 503);
    try {
      const upstream = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${BRIEF_WRITER_MODEL}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: briefWriterPrompt(request) }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 8192, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!upstream.ok) { console.error('[generate-wall-batch-prompts] provider', upstream.status, (await upstream.text()).slice(0, 300)); return response({ error: 'The brief writer is unavailable right now. Try again in a minute.', code: 'PROVIDER_ERROR' }, 502); }
      const data = await upstream.json();
      const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let parsed: unknown;
      try { parsed = JSON.parse(rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()); }
      catch { console.error('[generate-wall-batch-prompts] unparseable', rawText.slice(0, 300)); return response({ error: 'The brief writer returned something that was not a list of briefs. Try again.', code: 'PROVIDER_UNPARSEABLE' }, 502); }
      const prompts = normalizeGeneratedBriefs(parsed, request);
      if (!prompts.length) return response({ error: 'The brief writer returned no usable briefs. Try again.', code: 'PROVIDER_EMPTY' }, 502);
      console.log(JSON.stringify({ event: 'wall_briefs_written', domain: request.domain, requested: request.count, written: prompts.length, space: request.space, rendering: request.rendering, mode: request.mode, model: BRIEF_WRITER_MODEL }));
      return response({ prompts, model: BRIEF_WRITER_MODEL, version: BRIEF_WRITER_VERSION });
    } catch (err) {
      console.error('[generate-wall-batch-prompts]', err);
      return response({ error: err instanceof Error && err.name === 'TimeoutError' ? 'The brief writer took too long. Try a smaller batch.' : 'The brief writer failed. Try again.', code: 'PROVIDER_ERROR' }, 502);
    }
  };
}
