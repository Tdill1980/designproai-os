"use strict";

/**
 * The QC certificate page: what was checked, by whom, and what each panel measures.
 *
 * The server already draws a round APPROVED seal and composites it onto the Call 8
 * proof. A seal says a person signed off; it does not say WHAT they signed off, and
 * it carries no dimensions. The pack shipped with no page a shop could read to see
 * which checks passed or what size each side is.
 *
 * This is a port in shape of restylepro-os `api/_lib/qc-certificate.js`
 * (`buildQCCertificatePng`) -- same sharp/SVG approach, same 900-wide sheet, same
 * checklist-with-tickboxes idea, same round stamp. Two deliberate differences:
 *
 *  - The per-side size table is NEW. RestylePro's surviving generator has none; the
 *    version that did lived in a deleted client file and is not recoverable from
 *    that repo's history. A wrap shop's first question about a print file is how big
 *    it is, so the table is authored here rather than left out.
 *  - Nothing is defaulted. RestylePro falls back to a hardcoded twelve-item list
 *    when none is passed; here the checks come from the receipts the humans actually
 *    signed, and a missing input is a caller error rather than a plausible-looking
 *    page. A certificate that invents its own checklist is worse than no certificate.
 *
 * Pure: no network, no storage, no clock. The caller supplies the approval time so
 * the page is reproducible from its receipts.
 */

const sharp = require("sharp");

const CERTIFICATE_CONTRACT = "designpro.qc-certificate.v1";

const W = 900;
const PAD = 48;

/** Exact labels the humans were shown. Order is the order they were ticked in. */
const PREFLIGHT_LABELS = Object.freeze([
  ["dimensionsVerified", "Panel dimensions verified against the production proof"],
  ["sourceRegionsVerified", "Each panel cut from its own approved side"],
  ["fiveInchBleed", "Five-inch bleed present on every edge"],
  ["panelHashesVerified", "Panel content hashes match the frozen set"],
  ["logoInventoryVerified", "Separated logo inventory reviewed"],
  ["textLockVerified", "Lettering matches the approved design"],
  ["panelDataSlugVerified", "Panel data slug read on every QC panel and matches the panel map"],
]);

const FINAL_LABELS = Object.freeze([
  ["outputHashesVerified", "Output file hashes verified"],
  ["printDimensionsVerified", "Print dimensions verified"],
  ["colorModeVerified", "Colour mode verified"],
  ["productionSlugVerified", "Production files carry the panel data slug on the top edge and match the panel map"],
]);

/** XML-escape every interpolated string. A design name is customer text. */
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function inches(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  return Number.isInteger(number) ? `${number}"` : `${Math.round(number * 100) / 100}"`;
}

function sqft(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${Math.round(number * 100) / 100}` : "—";
}

function checkRow(y, label, ok) {
  const box = `<rect x="${PAD}" y="${y}" width="20" height="20" rx="3" fill="none" stroke="${ok ? "#10b981" : "#d1d5db"}" stroke-width="2"/>`;
  const tick = ok
    ? `<polyline points="${PAD + 4},${y + 10} ${PAD + 8},${y + 15} ${PAD + 16},${y + 4}" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  return `${box}${tick}<text x="${PAD + 32}" y="${y + 16}" font-family="sans-serif" font-size="15" fill="${ok ? "#111827" : "#9ca3af"}">${esc(label)}</text>`;
}

/**
 * Draw the certificate.
 *
 * Every value is supplied by the caller from receipts and the bound GENIE manifest;
 * this function decides layout and nothing else.
 */
function certificateSvg({
  designId, orderNumber, designName, vehicle,
  verifiedBy, approvedAtIso, preflightQc, finalQc, surfaces,
}) {
  const rows = Array.isArray(surfaces) ? surfaces : [];
  const vehicleLine = [vehicle?.year, vehicle?.make, vehicle?.model]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const subTitle = [orderNumber ? `Order ${orderNumber}` : "", vehicleLine]
    .filter(Boolean).join("  ·  ");

  // Header block, then two check groups, then the table, then the stamp footer.
  // Every following block is placed from the running cursor rather than from a
  // precomputed guess -- the guess is what makes a heading land on top of the
  // last check when the list length changes.
  let y = PAD + 200;
  const groups = [];
  groups.push(`<text x="${PAD}" y="${y}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#111827">PanelPro preflight</text>`);
  y += 30;
  for (const [key, label] of PREFLIGHT_LABELS) {
    groups.push(checkRow(y, label, preflightQc?.[key] === true));
    y += 28;
  }
  y += 20;
  groups.push(`<text x="${PAD}" y="${y}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#111827">Final production QC</text>`);
  y += 30;
  for (const [key, label] of FINAL_LABELS) {
    groups.push(checkRow(y, label, finalQc?.[key] === true));
    y += 28;
  }

  const tableTop = y + 30;
  const tableBottom = tableTop + 52 + rows.length * 26;
  // The stamp sits to the right of the sign-off lines, not over them.
  const stampTop = tableBottom + 36;
  const stampCentreY = stampTop + 94;
  const height = stampTop + 188 + PAD;

  const columns = [PAD, PAD + 210, PAD + 360, PAD + 510, PAD + 660];
  const table = [
    `<text x="${PAD}" y="${tableTop}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#111827">Panel sizes</text>`,
    `<line x1="${PAD}" y1="${tableTop + 30}" x2="${W - PAD}" y2="${tableTop + 30}" stroke="#e5e7eb" stroke-width="1"/>`,
    ...["Side", "Trim", "Print (+5\" bleed)", "Sq ft", "Bleed"].map((heading, index) =>
      `<text x="${columns[index]}" y="${tableTop + 22}" font-family="sans-serif" font-size="12" font-weight="bold" fill="#6b7280">${esc(heading)}</text>`),
  ];
  rows.forEach((row, index) => {
    const rowY = tableTop + 52 + index * 26;
    const cells = [
      String(row.label || row.surfaceKey || ""),
      `${inches(row.trimWidthIn)} × ${inches(row.trimHeightIn)}`,
      `${inches(row.printWidthIn)} × ${inches(row.printHeightIn)}`,
      sqft(row.surfaceSqFt),
      `5" all round`,
    ];
    cells.forEach((cell, column) => {
      table.push(`<text x="${columns[column]}" y="${rowY}" font-family="${column === 0 ? "sans-serif" : "monospace"}" font-size="13" fill="#111827">${esc(cell)}</text>`);
    });
  });

  const stamp = `<g transform="translate(${W - PAD - 96}, ${stampCentreY}) rotate(-9.2)">
    <defs><linearGradient id="stampGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient></defs>
    <circle r="88" fill="none" stroke="url(#stampGrad)" stroke-width="6"/>
    <circle r="76" fill="none" stroke="url(#stampGrad)" stroke-width="2"/>
    <text y="-16" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="bold" fill="#2563eb">DesignProAI</text>
    <text y="9" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="bold" fill="#2563eb">QUALITY</text>
    <text y="33" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#2563eb">★ APPROVED ★</text>
  </g>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
  <rect x="0" y="0" width="${W}" height="${height}" fill="#ffffff"/>
  <rect x="24" y="24" width="${W - 48}" height="${height - 48}" fill="none" stroke="#1e3a8a" stroke-width="4"/>
  <text x="${PAD}" y="${PAD + 42}" font-family="sans-serif" font-size="40" font-weight="bold" fill="#0a0a0a">DesignProAI Quality</text>
  <text x="${PAD}" y="${PAD + 80}" font-family="sans-serif" font-size="21" font-weight="bold" fill="#2563eb">Production Pack — Quality Control Certificate</text>
  <text x="${PAD}" y="${PAD + 110}" font-family="sans-serif" font-size="15" fill="#6b7280">${esc(subTitle)}</text>
  <text x="${PAD}" y="${PAD + 136}" font-family="monospace" font-size="16" font-weight="bold" fill="#2563eb">${esc(designId)}</text>
  ${designName ? `<text x="${PAD}" y="${PAD + 162}" font-family="sans-serif" font-size="15" fill="#6b7280">Design: ${esc(designName)}</text>` : ""}
  ${groups.join("\n  ")}
  ${table.join("\n  ")}
  ${stamp}
  <text x="${PAD}" y="${stampCentreY - 6}" font-family="sans-serif" font-size="14" fill="#111827">Quality checked by ${esc(verifiedBy)}</text>
  <text x="${PAD}" y="${stampCentreY + 16}" font-family="sans-serif" font-size="13" fill="#6b7280">${esc(approvedAtIso)}</text>
</svg>`);
}

async function buildQcCertificatePng(input) {
  for (const field of ["designId", "orderNumber", "verifiedBy", "approvedAtIso"]) {
    if (!String(input?.[field] || "").trim()) {
      throw new Error(`qc_certificate_${field}_required`);
    }
  }
  if (!input?.preflightQc || !input?.finalQc) throw new Error("qc_certificate_checks_required");
  return sharp(certificateSvg(input)).png().toBuffer();
}

module.exports = {
  CERTIFICATE_CONTRACT,
  FINAL_LABELS,
  PREFLIGHT_LABELS,
  buildQcCertificatePng,
  _test: { certificateSvg, esc, inches, sqft },
};
