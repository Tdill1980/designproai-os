import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Calculator, CreditCard, ExternalLink, FileText, Gift, HelpCircle, LayoutDashboard, MapPin, Menu, Package, ShieldCheck, User } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WPW_SHOPFLOW_URL } from "@/lib/dashboard-nav";
import "./wpw-shopflow-shell.css";

const ASSETS = "https://www.restyleproai.com/assets/commercialpro/";
const workspace = [
  { name: "Dashboard", short: "Home", href: WPW_SHOPFLOW_URL, icon: LayoutDashboard },
  { name: "My QuickQuotes CRM", short: "QuickQuotes", href: WPW_SHOPFLOW_URL + "#quotes", icon: Calculator },
  { name: "My Orders", short: "Orders", href: WPW_SHOPFLOW_URL + "#orders", icon: FileText },
  { name: "My ShopFlow", short: "Track", href: WPW_SHOPFLOW_URL + "#tracker", icon: Package },
];
const apps = [
  { name: "PatternPro", base: "Pattern", route: "/pattern-wrap", image: "patternpro-shopflow.webp", preview: "patternpro-page.webp", detail: "Patterns on your vehicle" },
  { name: "WallPro", base: "Wall", route: "/wallwrap-design", image: "wallpro-gym-example.jpeg", preview: "wallpro-page.webp", detail: "Custom wall wraps" },
  { name: "CommercialPro", base: "Commercial", route: "https://weprintwraps.com/commercialpro/", image: "commercialpro-thumb.webp", preview: "commercialpro-page.png", detail: "Fleet & volume printing" },
  { name: "Custom Wrap Design", base: "", route: "https://weprintwraps.com/our-products/custom-wrap-design/", image: "custom-design-studio.webp", preview: "custom-design-studio.webp", detail: "Designed by the WPW team" },
];
const account = [
  { name: "Addresses", href: "https://weprintwraps.com/my-account/edit-address/", icon: MapPin },
  { name: "Payment Methods", href: "https://weprintwraps.com/my-account/payment-methods/", icon: CreditCard },
  { name: "Account Details", href: "https://weprintwraps.com/my-account/edit-account/", icon: User },
  { name: "Tax Exemption", href: "https://weprintwraps.com/my-account/", icon: ShieldCheck },
  { name: "ClubWPW Rewards", href: WPW_SHOPFLOW_URL + "#rewards", icon: Gift },
];

function Wordmark() {
  return <><span className="wpws-prefix">WPW</span> <span>Shop<span className="wpws-flow">Flow</span> Dashboard<sup>®</sup></span></>;
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [preview, setPreview] = useState<{ app: (typeof apps)[number]; top: number } | null>(null);
  const showPreview = (app: (typeof apps)[number], element: HTMLElement) => {
    if (window.matchMedia("(min-width: 761px)").matches) {
      setPreview({ app, top: Math.max(90, Math.min(element.getBoundingClientRect().top, window.innerHeight - 300)) });
    }
  };
  return <div className="wpws-navigation" onKeyDown={event => { if (event.key === "Escape") setPreview(null); }}>
    <p className="wpws-section">Your workspace</p>
    <nav aria-label="ShopFlow workspace">{workspace.map(item =>
      <a key={item.name} href={item.href} onClick={onNavigate}><item.icon aria-hidden="true"/>{item.name}</a>
    )}</nav>
    <p className="wpws-section">My apps</p>
    <nav className="wpws-apps" aria-label="ShopFlow apps">{apps.map(app => {
      const content = <><img src={ASSETS + app.image} alt=""/><span><strong>{app.base ? <>{app.base}<span className="wpws-pro">Pro</span></> : app.name}</strong><small>{app.detail}</small></span><ExternalLink aria-hidden="true"/></>;
      const events = {
        onClick: () => { setPreview(null); onNavigate?.(); },
        onMouseEnter: (event: React.MouseEvent<HTMLAnchorElement>) => showPreview(app, event.currentTarget),
        onMouseLeave: () => setPreview(null),
        onFocus: (event: React.FocusEvent<HTMLAnchorElement>) => showPreview(app, event.currentTarget),
        onBlur: () => setPreview(null),
      };
      return app.route.startsWith("/") ?
        <Link key={app.name} to={app.route} {...events} aria-current={pathname === app.route || (app.name === "WallPro" && pathname.startsWith("/wall-wrap/")) ? "page" : undefined}>{content}</Link> :
        <a key={app.name} href={app.route} {...events}>{content}</a>;
    })}</nav>
    <p className="wpws-section">My WPW account</p>
    <nav aria-label="My WPW account">{account.map(item =>
      <a key={item.name} href={item.href} onClick={onNavigate}><item.icon aria-hidden="true"/>{item.name}</a>
    )}</nav>
    <div className="wpws-help"><a href="https://weprintwraps.com/faqs/"><HelpCircle aria-hidden="true"/>Help &amp; Support</a></div>
    {preview && <aside className="wpws-preview" aria-hidden="true" style={{ top: preview.top }}><strong>{preview.app.name} · Page preview</strong><img src={ASSETS + preview.app.preview} alt=""/></aside>}
  </div>;
}

/** One ShopFlow layout around the real WPW tools; generation and account state stay native. */
export function WpwShopflowShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="wpws-shell">
    <a className="wpws-skip" href="#wpws-content">Skip to content</a>
    <header className="wpws-header sticky">
      <a className="wpws-logo" href="https://weprintwraps.com/" aria-label="WePrintWraps.com home"><img src={ASSETS + "wpw-logo-nav.png"} alt="WePrintWraps.com" width={112} height={52}/></a>
      <a className="wpws-brand" href={WPW_SHOPFLOW_URL}><Wordmark/></a>
      <div className="wpws-actions">
        <a className="wpws-store" href="https://weprintwraps.com/" aria-label="Shop WePrintWraps"><ArrowLeft aria-hidden="true"/><span>Shop WePrintWraps</span></a>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><button className="wpws-menu" aria-label="Open ShopFlow navigation"><Menu aria-hidden="true"/></button></SheetTrigger>
          <SheetContent side="left" className="wpws-drawer">
            <SheetTitle className="sr-only">ShopFlow navigation</SheetTitle>
            <SheetDescription className="sr-only">Your WPW dashboard, quotes, orders, design tools and account.</SheetDescription>
            <Navigation onNavigate={() => setOpen(false)}/>
          </SheetContent>
        </Sheet>
      </div>
    </header>
    <div className="wpws-layout">
      <aside className="wpws-sidebar" aria-label="ShopFlow sidebar"><Navigation/></aside>
      <div className="wpws-content" id="wpws-content" tabIndex={-1}>{children}</div>
    </div>
    <nav className="wpws-bottom" aria-label="ShopFlow mobile navigation">{workspace.map(item =>
      <a key={item.name} href={item.href}><item.icon aria-hidden="true"/><span>{item.short}</span></a>
    )}</nav>
  </div>;
}
