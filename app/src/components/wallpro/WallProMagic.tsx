import React from 'react';
import { DEFAULT_CASE_STUDY } from '@/lib/wallpro-case-studies';
import { DEFAULT_WALL_PRINT, planWallPrint } from '@/lib/wallpro-print-plan';
import './wallpro-magic.css';

const BEFORE = '/wallpro/studio-original.jpg';
const AFTER = '/wallpro/studio-floral-preview.jpg';
const STEPS = [
  { title: 'Start with your room', short: 'Photo', detail: 'One photo. Your actual space.', caption: 'A blank wall is all you need to begin.' },
  { title: 'Touch the four corners', short: 'Corners', detail: 'Tell WallPro where the design belongs.', caption: 'Four touches outline the wall, not the furniture or the floor.' },
  { title: 'Keep what stays', short: 'Mask', detail: 'One touch protects each curtain.', caption: 'Try it: tap either curtain to switch its protection on or off.' },
  { title: 'See your wall transformed', short: 'Preview', detail: 'Your design. In your room.', caption: 'The floral design wraps the wall. The curtains stay in view.' },
  { title: 'Go from design to print', short: 'Panels', detail: 'Artwork becomes measured panels.', caption: 'Flat artwork, divided using the same panel planner as the tool.' },
] as const;
const CORNERS = [[238, 140], [1223, 111], [1223, 994], [229, 912]];
// These outlines demonstrate the supplied photo only. They are not detector
// results, saved customer masks, or production geometry.
const CURTAINS = [
  '378,117 414,113 468,115 641,122 649,643 421,649 394,690 359,711',
  '684,122 832,111 864,102 959,105 966,727 931,701 912,655 684,646',
];
type State = { active: number; playing: boolean; visible: boolean; reduced: boolean; left: boolean; right: boolean; imageError: boolean };

function PanelExample() {
  const study = DEFAULT_CASE_STUDY;
  if (!study.wall || !study.photos.artwork) return <p>Print layout appears after your design is approved.</p>;
  const plan = planWallPrint(study.wall.widthIn, study.wall.heightIn, DEFAULT_WALL_PRINT);
  return <div className="wm-panels">
    <div className="wm-panel-heading"><span>FROM THE FLAT ARTWORK</span><strong>{plan.panels.length} production panels</strong></div>
    <div className="wm-panel-row">
      {plan.panels.map(panel => <figure key={panel.number} style={{ flex: panel.width }}>
        <svg viewBox={`${panel.x} ${panel.y} ${panel.width} ${panel.height}`} role="img" aria-label={`Artwork panel ${panel.number}`}>
          <image href={study.photos.artwork!} x={plan.bounds.x} y={plan.bounds.y} width={plan.bounds.width} height={plan.bounds.height} preserveAspectRatio="xMidYMid slice" />
        </svg>
        <figcaption><b>0{panel.number}</b><span>{panel.width}″ × {panel.height}″</span></figcaption>
      </figure>)}
    </div>
    <p className="wm-panel-note">Example wall: {plan.wall.width}″ × {plan.wall.height}″<br />{plan.settings.bleed}″ perimeter bleed · {plan.settings.overlap}″ seam overlap</p>
  </div>;
}

/** A read-only, illustrated walkthrough. It has no API, checkout, upload,
 * production, or customer-project side effects. Both WallPro themes use it. */
export class WallProMagic extends React.PureComponent<Record<string, never>, State> {
  state: State = { active: 3, playing: false, visible: false, reduced: false, left: true, right: true, imageError: false };
  private root: HTMLElement | null = null;
  private stepButtons: Array<HTMLButtonElement | null> = [];
  private observer: IntersectionObserver | null = null;
  private motion: MediaQueryList | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isMountedHere = false;

  componentDidMount() {
    this.isMountedHere = true;
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener?.('change', this.onMotion);
    // Start with the finished room; the visitor chooses when the walkthrough
    // plays. There is no automatic motion or moving target on page entry.
    this.setState({ reduced: this.motion.matches });
    if (typeof IntersectionObserver !== 'undefined' && this.root) {
      this.observer = new IntersectionObserver(([entry]) => this.setState({ visible: entry.isIntersecting }), { threshold: 0.15 });
      this.observer.observe(this.root);
    } else this.setState({ visible: true });
    document.addEventListener('visibilitychange', this.schedule);
    [BEFORE, AFTER, DEFAULT_CASE_STUDY.photos.artwork].forEach(src => { if (src) { const image = new Image(); image.src = src; } });
  }
  componentDidUpdate(_: Record<string, never>, previous: State) {
    if (previous.active !== this.state.active || previous.playing !== this.state.playing || previous.visible !== this.state.visible) this.schedule();
  }
  componentWillUnmount() {
    this.isMountedHere = false;
    if (this.timer) clearTimeout(this.timer);
    this.observer?.disconnect();
    this.motion?.removeEventListener?.('change', this.onMotion);
    document.removeEventListener('visibilitychange', this.schedule);
  }
  private onMotion = (event: MediaQueryListEvent) => this.setState({ reduced: event.matches, playing: false });
  private schedule = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.isMountedHere || !this.state.playing || !this.state.visible || document.hidden) return;
    this.timer = setTimeout(() => this.setState(state => state.active === STEPS.length - 1
      ? { active: state.active, playing: false }
      : { active: state.active + 1, playing: true }), 4000);
  };
  private choose = (active: number) => this.setState({ active, playing: false, imageError: false });
  private play = () => {
    if (this.state.playing) this.setState({ playing: false });
    else this.setState({ playing: true, active: 0, left: true, right: true, imageError: false });
  };
  private toggleCurtain = (index: number) => this.setState(state => ({
    playing: false, left: index === 0 ? !state.left : state.left, right: index === 1 ? !state.right : state.right,
  }));
  private moveStep = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % STEPS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + STEPS.length - 1) % STEPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = STEPS.length - 1;
    else return;
    event.preventDefault(); this.choose(next); this.stepButtons[next]?.focus();
  };

  render() {
    const { active, playing, reduced, left, right, imageError } = this.state;
    const step = STEPS[active];
    const original = active < 3;
    return <section ref={el => { this.root = el; }} className="wallpro-magic" aria-labelledby="wallpro-magic-heading" data-motion={reduced ? 'reduced' : 'full'}>
      <div className="wm-heading">
        <div><p className="wm-eyebrow">THE WALLPRO EXPERIENCE</p><h2 id="wallpro-magic-heading">Your room. Reimagined.</h2></div>
        <button type="button" className="wm-play" onClick={this.play} aria-label={playing ? 'Pause walkthrough' : 'Play the 20-second walkthrough'}>
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{playing ? 'Pause demo' : 'Watch the magic'}<small>{playing ? `${active + 1} / 5` : '20 sec'}</small>
        </button>
      </div>
      <div className="wm-workspace">
        <div className="wm-visual">
          <div className="wm-stage-top"><span>INTERACTIVE EXAMPLE</span><span>Exotic floral · Interior wall</span></div>
          <div id="wallpro-magic-stage" className="wm-stage" role="region" aria-label={step.title}>
            {active === 4 ? <PanelExample /> : imageError ? <div className="wm-image-error" role="status">The example photo could not load. Your wall tool is still available below.</div> :
              <svg key={original ? 'original' : 'preview'} className="wm-room" viewBox={original ? '0 0 1253 1122' : '0 0 1254 1254'} preserveAspectRatio="xMidYMid meet" role="group" aria-label={original ? 'Full original room photo' : 'Full room with the floral wall design'}>
                <image href={original ? BEFORE : AFTER} width={original ? 1253 : 1254} height={original ? 1122 : 1254} onError={() => this.setState({ imageError: true, playing: false })} />
                {active === 1 && <g className="wm-geometry" aria-label="Four wall corner markers">
                  <polygon points={CORNERS.map(point => point.join(',')).join(' ')} />
                  {CORNERS.map(([x, y], i) => <g key={i} className="wm-pin" style={{ animationDelay: `${i * 0.35}s` }}><circle cx={x} cy={y} r="16" /><text x={x} y={y + 6} textAnchor="middle">{i + 1}</text></g>)}
                </g>}
                {active === 2 && CURTAINS.map((points, i) => <polygon key={i} className="wm-mask" data-protected={(i === 0 ? left : right) ? 'true' : 'false'} points={points} onClick={() => this.toggleCurtain(i)} aria-hidden="true" />)}
              </svg>}
          </div>
          <div className="wm-caption" aria-live={playing ? 'off' : 'polite'}>
            <p>{step.caption}</p>
            {active === 2 && <div className="wm-mask-controls">{[left, right].map((protectedNow, i) => <button type="button" key={i} onClick={() => this.toggleCurtain(i)} aria-pressed={protectedNow}><span aria-hidden="true">{protectedNow ? '✓' : '+'}</span>{i === 0 ? 'Left' : 'Right'} curtain{protectedNow ? ' protected' : ' unprotected'}</button>)}</div>}
          </div>
        </div>
        <div className="wm-controls">
          <p className="wm-rail-label">ONE PHOTO. FIVE SIMPLE STEPS.</p>
          <ol className="wm-steps" aria-label="Explore the WallPro walkthrough">
            {STEPS.map((item, i) => <li key={item.short}><button ref={el => { this.stepButtons[i] = el; }} type="button" onClick={() => this.choose(i)} onKeyDown={event => this.moveStep(event, i)} aria-current={active === i ? 'step' : undefined} aria-controls="wallpro-magic-stage" className={active === i ? 'wm-step is-active' : 'wm-step'}>
              <span className="wm-number">0{i + 1}</span><span className="wm-step-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="wm-mobile-title">{item.short}</span><span className="wm-step-arrow" aria-hidden="true">↗</span>
            </button></li>)}
          </ol>
          <div className="wm-next"><p>Now make it your wall.</p><a href="#upload-wall">Start your wall wrap <span aria-hidden="true">→</span></a><small>Enter dimensions. Upload your photo.</small></div>
        </div>
      </div>
    </section>;
  }
}
