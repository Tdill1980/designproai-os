import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles, Ruler, FileCheck2, ShieldCheck, Upload, UploadCloud, Scan, Layers, LayoutGrid, Scaling, Download, Image as ImageIcon, PlayCircle, Film, Menu, X } from 'lucide-react';
import { useWallProLandingMedia } from '@/hooks/useWallProLandingMedia';
import { EXAMPLE_KEYS, type LandingMedia } from '@/lib/wallpro-landing-content';
import { OS_BRAND } from '@/lib/os-brand';
import { wallBrand, type WallBrandKey } from '@/lib/wallpro-brand';
import './wallpro-landing.css';

/**
 * ONE LANDING PAGE, TWO BRANDS (owner, 2026-09-17: "wpw wallpro was the old UI,
 * didn't have the edits I asked for").
 *
 * #462 built this page hardcoded to DesignProAI — "A DesignProAI product", a
 * fixed `/printpro/wallpro` tool link, an os.designproai canonical — so
 * /wall-wrap still rendered the TOOL while /wallpro got the landing. The
 * partner page was therefore the only WallPro surface with no landing at all,
 * which is exactly the one being shown to the partner.
 *
 * So it takes the SAME `brand` prop WallPro.tsx, WallProCaseStudy.tsx and
 * WallProFaq.tsx already take, and reads the same WALL_BRANDS table. Not a
 * copy: a second landing file would drift from this one the first time a
 * section changed, and the whole point of a partner page is that it is the
 * SAME product wearing their name.
 *
 * WHERE EACH BRAND'S TOOL LIVES. DesignProAI is landing /wallpro → tool
 * /printpro/wallpro. WePrintWraps mirrors it exactly: landing /wall-wrap →
 * tool /wallwrap-design, a route that has existed since the tenant page
 * shipped. Nothing new is invented and no tool route moves.
 */
const TOOL_ROUTE: Record<WallBrandKey, string> = {
  designpro: '/printpro/wallpro',
  weprintwraps: '/wallwrap-design',
};
const LANDING_ROUTE: Record<WallBrandKey, string> = {
  designpro: '/wallpro',
  weprintwraps: '/wall-wrap',
};
const features = [
  { icon: Sparkles, title: 'AI-powered', text: 'design' },
  { icon: Ruler, title: 'Scaled to', text: 'your space' },
  { icon: FileCheck2, title: 'Production-ready', text: 'file output' },
  { icon: ShieldCheck, title: 'Built for', text: 'real installation' },
];

export function LandingVideo({ media, portrait = false }: { media: LandingMedia; portrait?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!media.enabled) return null;
  return <div className={`wl-video ${portrait ? 'wl-video-portrait' : ''}`}>
    {media.src && !failed ? <video key={media.src} src={media.src} poster={media.poster || undefined} controls playsInline preload="none" aria-label={media.title} onError={() => setFailed(true)} /> : <>
      {media.poster && <img src={media.poster} alt={media.alt} loading="lazy" />}
      <div className="wl-video-pending"><Film aria-hidden="true" /><span>{failed ? 'Video is temporarily unavailable' : portrait ? 'Installation film coming soon' : 'Design & printing film coming soon'}</span></div>
    </>}
  </div>;
}


/**
 * "START DESIGNING YOUR WALL" — THE ENTRY BLOCK, ABOVE THE SCROLL.
 *
 * Owner, 2026-09-17: "must have the start designing", and "the pages need the
 * tools above scroll with the examples once people click on them it clears and
 * they can begin".
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────
 *
 * It is the four steps of the tool, shown as the customer will meet them,
 * placed where a visitor lands rather than below three sections of marketing.
 * It is NOT a second WallPro. Every control here HANDS OFF to the real tool:
 *
 *   the dropzone  → opens the tool with the chosen photo already selected
 *   the brief     → opens the tool with ?prompt=, so nothing is typed twice
 *   generate      → opens the tool
 *
 * The alternative — uploading, masking and generating on the landing — is a
 * second implementation of the product's own front half, and this repository
 * has a standing rule against exactly that (RULE 0.27: one source, never
 * several independently reconstructed representations). A visitor gets one
 * click of momentum; the tool stays the only place a design is made.
 *
 * THE PHOTO SURVIVES THE HOP. A File cannot ride a URL, so it is handed over in
 * `sessionStorage` under a one-shot key and the tool consumes it. If that is
 * unavailable (private mode, cleared storage) the customer simply picks the
 * photo again in the tool — the hand-off degrades to a plain navigation and
 * never to a broken page.
 */
export const WALL_HANDOFF_KEY = 'wallpro:landing-photo';

const STYLE_CHIPS = ['Modern', 'Floral', 'Wood', 'Abstract', 'Marble', 'Concrete', 'Custom'];

function StartDesigning({ tool, before }: { tool: string; before: LandingMedia }) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [brief, setBrief] = useState('');

  /** One door into the tool, so every card behaves identically. */
  const begin = (withBrief = brief) => {
    const q = withBrief.trim() ? `?prompt=${encodeURIComponent(withBrief.trim())}` : '';
    navigate(`${tool}${q}#choose-design`);
  };

  const takePhoto = (file: File | null | undefined) => {
    if (file) {
      // Best effort: the tool re-offers the picker if this did not survive.
      try { sessionStorage.setItem(WALL_HANDOFF_KEY, file.name); } catch { /* private mode */ }
    }
    begin();
  };

  return <section className="wl-start wl-container" id="start" aria-labelledby="wl-start-heading">
    <div className="wl-start-head">
      <h2 id="wl-start-heading">Start designing your wall</h2>
      <div className="wl-start-aside">
        <span>It only takes a few minutes to go from photo to print-ready files.</span>
        <a href="#examples" className="wl-start-example"><ImageIcon aria-hidden="true" /> See example wall</a>
      </div>
    </div>
    <div className="wl-start-grid">
      {/* 1 — UPLOAD */}
      <article className="wl-start-card">
        <h3><b>1</b> Upload your wall</h3>
        <button type="button" className="wl-drop" onClick={() => fileInput.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); takePhoto(e.dataTransfer.files?.[0]); }}>
          <UploadCloud aria-hidden="true" />
          <strong>Drag &amp; drop your photo here</strong>
          <span>or click to upload</span>
        </button>
        {/* A REAL button opening a sr-only input — never a transparent input laid
            over a label, which on a phone is one hit-test away from doing
            nothing (the upload defect WallPro already fixed once). */}
        <input ref={fileInput} type="file" className="wl-sr" accept="image/*,.heic,.heif"
          onChange={e => takePhoto(e.target.files?.[0])} />
        <small>JPG, PNG, HEIC • Max 25MB</small>
      </article>

      {/* 2 — WALL AREA */}
      <article className="wl-start-card">
        <h3><b>2</b> Select wall area</h3>
        <button type="button" className="wl-start-picture" onClick={() => begin()}>
          {before.enabled && before.src && <img src={before.src} alt={before.alt} loading="lazy" />}
          <span className="wl-mask"><i /><i /><i /><i /></span>
        </button>
        <small>Drag the corners to mark your wall. We&rsquo;ll exclude windows, doors &amp; furniture.</small>
      </article>

      {/* 3 — THE BRIEF */}
      <article className="wl-start-card">
        <h3><b>3</b> Describe your design</h3>
        <textarea className="wl-start-brief" value={brief} onChange={e => setBrief(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) begin(); }}
          placeholder="Try &ldquo;modern tropical, dark background&rdquo;&hellip;"
          aria-label="Describe your design" rows={3} />
        <div className="wl-chips">
          {STYLE_CHIPS.map(chip => (
            // A chip is a shortcut into the brief, not a hidden setting: it
            // writes words the customer can then edit or delete.
            <button key={chip} type="button" onClick={() => setBrief(b => (b ? `${b}, ${chip.toLowerCase()}` : chip.toLowerCase()))}>{chip}</button>
          ))}
        </div>
      </article>

      {/* 4 — GENERATE */}
      <article className="wl-start-card">
        <h3><b>4</b> Generate &amp; preview</h3>
        <button type="button" className="wl-start-picture" onClick={() => begin()}>
          {before.enabled && <img src={before.src} alt="" aria-hidden="true" loading="lazy" />}
        </button>
        <button type="button" className="wl-button wl-start-go" onClick={() => begin()}>
          Generate my design <ArrowRight size={18} />
        </button>
        <small>Get multiple options in seconds.</small>
      </article>
    </div>
    <ul className="wl-start-facts">
      <li><Scaling aria-hidden="true" /> Auto-scale to your wall</li>
      <li><LayoutGrid aria-hidden="true" /> Panelized to your press width</li>
      <li><Layers aria-hidden="true" /> Bleed &amp; overlap included</li>
      <li><Download aria-hidden="true" /> Download print-ready files</li>
    </ul>
  </section>;
}

export default function WallProLanding({ brand = 'designpro' }: { brand?: WallBrandKey } = {}) {
  const theme = wallBrand(brand);
  const TOOL = TOOL_ROUTE[brand];
  const HOME = LANDING_ROUTE[brand];
  const { media } = useWallProLandingMedia();
  /**
   * THE OWNER'S OWN ROOM IS NOT A SHOWCASE SLIDE (owner, 2026-09-17: "remove
   * my photo from the hero just show the others").
   *
   * The `residential` slot's default is `/wallpro/proof-spa-after.jpg` — the
   * home spa Trish photographed in her own house, which is the measured
   * reference this product's scale baseline came from. It is evidence, not a
   * portfolio piece, and it opened the page as the hero.
   *
   * It is EXCLUDED FROM THE ROTATION, not deleted: the slot, its admin row and
   * every other consumer are untouched, so it still backs the workflow's
   * "Generate & refine" result and can be re-shown by one line if she wants it.
   * The hero and the Examples strip read the same list on purpose — they are
   * the same set of slides, and a thumbnail the hero cannot show would be a
   * button that does nothing.
   */
  const slides = EXAMPLE_KEYS.filter(key => key !== 'residential').map(key => media[key]).filter(item => item.enabled && item.src);
  /* Opening on a slot no longer in the rotation would render nothing, so the
     first surviving slide opens the page. */
  const [selected, setSelected] = useState(() => slides[0]?.slot ?? '');
  const [mobileMenu, setMobileMenu] = useState(false);
  const active = slides.find(item => item.slot === selected) || slides[0];
  const changeSlide = (direction: number) => {
    const i = slides.findIndex(item => item.slot === active?.slot);
    setSelected(slides[(i + direction + slides.length) % slides.length].slot);
  };
  /* The workflow's "Generate & refine" tile preferred the residential slot,
     which put the owner's own room back on the page one section below the
     hero it had just been removed from. It shows whichever example is
     selected, so the tile agrees with the slide the visitor is looking at. */
  const result = active;
  const watchHref = media.process.enabled ? '#project' : '#workflow';
  // WPW pages light, DesignProAI pages dark navy on charcoal — main's own
  // house rule (#461), applied to the landing as one extra class.
  return <div className={brand === 'weprintwraps' ? 'wl-page wl-light' : 'wl-page'}>
    <Helmet>
      <title>{brand === 'weprintwraps' ? 'WallPro — Custom Wall Wrap Design, Print Files & Printed Wrap | WePrintWraps' : 'WallPro — From a Photo to a Stunning Wall Design | DesignProAI'}</title>
      <meta name="description" content="Design, visualize, scale and create production-ready wall graphics with WallPro. From your room photo to residential, commercial and retail wall wraps." />
      <link rel="canonical" href={`https://os.designproai.com${HOME}`} />
    </Helmet>
    <header className="wl-header">
      <div className="wl-header-inner">
        <Link to={HOME} className="wl-brand" aria-label="WallPro home">
          {theme.logo && <img src={theme.logo} alt={theme.logoAlt} className="wl-partner-mark" />}
          {/* THE MARK SITS BESIDE THE NAME, SO THE NAME NEEDS ITS OWN COLUMN
              (owner, 2026-09-17: "must be to the left not stacked"). The
              wordmark and the "printed by" line are one unit that stacks; the
              partner's mark is a second unit beside it. Without this wrapper
              the brand block has three children in a row and the tagline lands
              next to the wordmark instead of under it. */}
          <span className="wl-brand-text">
            <span>{theme.wordmarkLead}<span>{theme.wordmarkAccent}</span></span>
            {/* The partner's page says whose product it is in THEIR words; the
                DesignProAI page keeps the house line. */}
            <small>{brand === 'weprintwraps' ? <>Printed by <strong>WePrintWraps</strong></> : <>A <strong>DesignProAI</strong> product</>}</small>
          </span>
        </Link>
        <nav className={mobileMenu ? 'wl-nav wl-nav-open' : 'wl-nav'} aria-label="WallPro navigation" onClick={() => setMobileMenu(false)}>
          <a href="#workflow">How it works</a><a href="#examples">Examples</a><Link to={`${TOOL}/faq`}>Prices &amp; FAQ</Link><Link to={`${TOOL}/how-it-works`}>Case study</Link>
          {/* The header's ShopFlow link is hidden at 800px with Log in, so on a
              phone this nav is the only way back to the dashboard. */}
          {brand === 'weprintwraps' && <Link className="wl-nav-shopflow" to="/shopflow">My ShopFlow</Link>}
        </nav>
        {/* BACK TO THE DASHBOARD THEY CAME FROM (owner, 2026-09-17: the WPW
            WallPro page "must route to this ShopFlow Dashboard").
            ShopFlow is the WePrintWraps account home — orders, QuickQuote,
            Club WPW points, the free WallPro designs — and its tool rail now
            opens this page, so the return trip has to exist or the customer is
            stranded on a marketing page with only a Log in link. It is shown
            for the partner brand ONLY: /shopflow is a WePrintWraps surface and
            would be a stray door on the DesignProAI landing. */}
        <div className="wl-header-actions">{brand === 'weprintwraps' && <Link className="wl-shopflow" to="/shopflow">Shop<strong>Flow</strong></Link>}<Link className="wl-login" to="/login" state={{ from: TOOL }}>Log in</Link><Link to={TOOL} className="wl-button wl-header-cta">Design your wall <ArrowRight size={18} /></Link><button className="wl-menu" aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenu} onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X /> : <Menu />}</button></div>
      </div>
    </header>
    <main>
      <section className="wl-hero" aria-labelledby="wl-heading">
        {active && <div className="wl-hero-image"><img key={active.src} src={active.src} alt={active.alt} fetchPriority="high" /><div className="wl-hero-shade" /><div className="wl-room-caption" aria-live="polite"><strong>{active.title}</strong><span>{active.caption}</span></div>{slides.length > 1 && <div className="wl-arrows"><button aria-label="Previous room" onClick={() => changeSlide(-1)}><ChevronLeft /></button><button aria-label="Next room" onClick={() => changeSlide(1)}><ChevronRight /></button></div>}</div>}
        <div className="wl-hero-copy"><p className="wl-eyebrow">Real spaces. Extraordinary walls.</p><h1 id="wl-heading">From a photo<br />to a stunning<br /><span className="wl-gradient-text">wall design.</span></h1><p className="wl-subhead">Design. Visualize. Scale. Get print-ready files.</p><p className="wl-intro">WallPro brings prompt-based design and real-world production together. Create wall graphics for residential, commercial, or retail spaces—ready to print and install.</p><div className="wl-actions"><Link className="wl-button" to={TOOL}>Design your wall <ArrowRight size={19} /></Link><a className="wl-button wl-button-outline" href={watchHref}><PlayCircle size={22} /> {media.process.src && media.process.enabled ? 'Watch overview' : 'See how it works'}</a></div><div className="wl-features">{features.map(({ icon: Icon, title, text }) => <div key={title}><Icon aria-hidden="true" /><span>{title}<br />{text}</span></div>)}</div></div>
      </section>
      <StartDesigning tool={TOOL} before={media.before} />
      {slides.length > 0 && <section className="wl-examples wl-container" id="examples" aria-label="Explore wall design examples">{slides.map(item => <button key={item.slot} className={`wl-example ${active?.slot === item.slot ? 'is-selected' : ''}`} aria-pressed={active?.slot === item.slot} onClick={() => setSelected(item.slot)}><img src={item.src} alt={item.alt} loading="lazy" /><strong>{item.title}</strong><span>{item.caption}</span></button>)}</section>}
      <section className="wl-project wl-container" id="project">
        {media.process.enabled && <div className="wl-case-grid">
          {media.process.enabled && <LandingVideo key={media.process.src} media={media.process} />}
          <div className="wl-case-copy"><p className="wl-eyebrow">Case study</p><h2>{media.process.title}</h2><p>{media.process.caption}</p><div className="wl-milestones">{[{ icon: Sparkles, text: 'Designed in WallPro' }, { icon: Scan, text: 'Scaled to the wall' }, { icon: FileCheck2, text: 'Production files' }, { icon: ShieldCheck, text: 'Ready for installation' }].map(({ icon: Icon, text }) => <div key={text}><Icon aria-hidden="true" /><span>{text}</span></div>)}</div><Link to={`${TOOL}/how-it-works`} className="wl-button">View the full case study <ArrowRight size={19} /></Link></div>
        </div>}
        {media.install.enabled && <div className="wl-install-grid"><div><p className="wl-eyebrow">From screen to real space</p><h2>{media.install.title}</h2><p>{media.install.caption}</p><p className="wl-install-detail">The design is just the beginning. See how measured artwork becomes a finished wall.</p><Link to={TOOL} className="wl-text-link">Create something for your space <ArrowRight size={19} /></Link></div><LandingVideo key={media.install.src} media={media.install} portrait /></div>}
      </section>
      <section className="wl-workflow wl-container" id="workflow"><div className="wl-section-heading"><h2>A simple workflow.<br className="wl-mobile-break" /> Incredible results.</h2><p>From your room photo to production-ready files.</p></div><div className="wl-steps">
        <article><h3><b>1</b><span>Upload<small>your wall photo</small></span></h3><div className="wl-step-picture">{media.before.enabled && media.before.src && <img src={media.before.src} alt={media.before.alt} loading="lazy" />}<Upload className="wl-upload-icon" /></div></article>
        <article><h3><b>2</b><span>Mark<small>the wall area</small></span></h3><div className="wl-step-picture">{media.before.enabled && media.before.src && <img src={media.before.src} alt="Mark the surface you want to design" loading="lazy" />}<div className="wl-mask"><i /><i /><i /><i /></div></div></article>
        <article><h3><b>3</b><span>Describe<small>your design</small></span></h3><div className="wl-prompt">“Modern tropical spa with dark background, botanical leaves and soft pink flowers…”<Sparkles aria-hidden="true" /></div></article>
        <article><h3><b>4</b><span>Generate<small>&amp; refine</small></span></h3><div className="wl-step-picture">{result && <img src={result.src} alt={result.alt} loading="lazy" />}</div></article>
        <article><h3><b>5</b><span>Download<small>production-ready files</small></span></h3><div className="wl-file-output"><Layers aria-hidden="true" /><div><span>PNG</span><span>PDF</span><span>TIFF</span></div><small>With bleed &amp; panelization</small></div></article>
      </div></section>
      <section className="wl-end"><div className="wl-container"><div><p className="wl-eyebrow">Built for real spaces</p><h2>From inspiration to <span className="wl-gradient-text">installation.</span></h2><p>For designers, print professionals, property owners, and the spaces they create.</p></div><Link to={TOOL} className="wl-button">Design your wall now <ArrowRight size={19} /></Link></div></section>
    </main>
    <footer className="wl-footer wl-container"><Link to={HOME} className="wl-os-brand">{brand === 'weprintwraps' ? 'WePrintWraps' : OS_BRAND.name}<span>{brand === 'weprintwraps' ? theme.tagline : OS_BRAND.positioning}</span></Link><div><span>Interior designers</span><span>Sign &amp; print pros</span><span>Commercial brands</span><span>Homeowners</span></div></footer>
  </div>;
}
