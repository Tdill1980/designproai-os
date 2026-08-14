/**
 * RestyleProAI Preview Widget for WePrintWraps.com
 *
 * SAFE FOR WOOCOMMERCE — no jQuery conflicts, no global CSS, no DOM mutation.
 * Just paste this script tag anywhere on your WooCommerce page:
 *
 *   <script src="https://restylepro.ai/embed/wpw-preview-widget.js" defer></script>
 *
 * Or paste the script + a target div for placement control:
 *
 *   <div id="restylepro-widget"></div>
 *   <script src="https://restylepro.ai/embed/wpw-preview-widget.js" defer></script>
 *
 * The widget renders a non-intrusive banner that links to RestyleProAI.
 * It uses Shadow DOM so its styles CANNOT conflict with your WooCommerce theme.
 */
(function () {
  "use strict";

  // Prevent double-init
  if (window.__restyleProWidgetLoaded) return;
  window.__restyleProWidgetLoaded = true;

  var LANDING_URL =
    "https://restylepro.ai/from/weprintwraps?utm_source=weprintwraps&utm_medium=embed_widget&utm_campaign=presale-wpw";

  function createWidget() {
    // Find or create host element
    var host = document.getElementById("restylepro-widget");
    if (!host) {
      host = document.createElement("div");
      host.id = "restylepro-widget";
      // Insert after the first product form, or after .entry-summary, or at end of main content
      var anchor =
        document.querySelector(".entry-summary") ||
        document.querySelector(".woocommerce-product-content") ||
        document.querySelector("#content") ||
        document.querySelector("main") ||
        document.body;
      if (anchor && anchor !== document.body) {
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
      } else {
        document.body.appendChild(host);
      }
    }

    // Use Shadow DOM to fully isolate styles
    var shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML =
      '<style>' +
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.rpw-banner {' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
      '  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);' +
      '  border: 1px solid rgba(212, 175, 55, 0.4);' +
      '  border-radius: 12px;' +
      '  padding: 24px 28px;' +
      '  margin: 24px 0;' +
      '  display: flex;' +
      '  align-items: center;' +
      '  gap: 20px;' +
      '  flex-wrap: wrap;' +
      '  text-decoration: none;' +
      '  color: #fff;' +
      '  transition: border-color 0.2s, transform 0.2s;' +
      '  cursor: pointer;' +
      '}' +
      '.rpw-banner:hover {' +
      '  border-color: rgba(212, 175, 55, 0.8);' +
      '  transform: translateY(-1px);' +
      '}' +
      '.rpw-icon {' +
      '  width: 48px; height: 48px;' +
      '  background: rgba(0, 199, 255, 0.15);' +
      '  border-radius: 10px;' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  flex-shrink: 0;' +
      '}' +
      '.rpw-icon svg { width: 24px; height: 24px; color: #00C7FF; }' +
      '.rpw-text { flex: 1; min-width: 200px; }' +
      '.rpw-title {' +
      '  font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;' +
      '}' +
      '.rpw-title span { color: #00C7FF; }' +
      '.rpw-subtitle {' +
      '  font-size: 13px; color: #aaa; line-height: 1.4;' +
      '}' +
      '.rpw-cta {' +
      '  background: linear-gradient(135deg, #00C7FF, #0090FF);' +
      '  color: #000; font-weight: 700; font-size: 14px;' +
      '  padding: 10px 20px; border-radius: 8px; border: none;' +
      '  cursor: pointer; white-space: nowrap; text-decoration: none;' +
      '  display: inline-block; transition: opacity 0.2s;' +
      '}' +
      '.rpw-cta:hover { opacity: 0.9; }' +
      '.rpw-badge {' +
      '  background: linear-gradient(135deg, #D4AF37, #B8941F);' +
      '  color: #000; font-weight: 700; font-size: 11px;' +
      '  padding: 4px 10px; border-radius: 20px;' +
      '  display: inline-block; margin-bottom: 6px;' +
      '}' +
      '.rpw-powered {' +
      '  width: 100%; text-align: right; font-size: 10px; color: #555; margin-top: 4px;' +
      '}' +
      '@media (max-width: 600px) {' +
      '  .rpw-banner { flex-direction: column; text-align: center; padding: 20px; }' +
      '  .rpw-cta { width: 100%; text-align: center; }' +
      '}' +
      '</style>' +
      '<a class="rpw-banner" href="' + LANDING_URL + '" target="_blank" rel="noopener">' +
      '  <div class="rpw-icon">' +
      '    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
      '      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>' +
      '      <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>' +
      '    </svg>' +
      '  </div>' +
      '  <div class="rpw-text">' +
      '    <span class="rpw-badge">WPW PRE-SALE \u2014 ENDS APRIL 7</span>' +
      '    <div class="rpw-title">Meet Your New Graphic Designer. <span>ACE</span> Is Reporting for Duty!</div>' +
      '    <div class="rpw-subtitle">ACE \u2014 Your AI Creative Engine. Custom vehicle wrap designs in seconds. WPW Friends &amp; Family get the lowest price.</div>' +
      '  </div>' +
      '  <span class="rpw-cta">Get Pre-Sale Pricing &rarr;</span>' +
      '  <div class="rpw-powered">Powered by RestyleProAI\u2122</div>' +
      '</a>';
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget);
  } else {
    createWidget();
  }
})();
