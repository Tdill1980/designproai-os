/**
 * WPW Offer campaign — single source of truth for the WPW Family
 * subscribe drip (email + SMS).
 *
 * The standalone selling pages (/wpw-offer, /launch) were retired in
 * #1496 — both routes now redirect to /pricing. The drip still fires
 * via /admin/wpw-enroll → fireWpwOfferSeries() and links land on
 * /pricing.
 *
 * Email sender:  supabase/functions/send-email-campaign
 * SMS sender:    supabase/functions/send-sms-campaign
 *
 * Merge tags supported by both senders:
 *   {{customer_name}}  {{customer_email}}  {{current_year}}  {{unsubscribe_url}}
 */

export const WPW_OFFER_URL = "https://restyleproai.com/pricing";
export const WPW_OFFER_URL_VERTICAL = "https://restyleproai.com/pricing";

export const WPW_OFFER_EMAIL_SUBJECT =
  "{{customer_name}}, try a design tool free — WPW Family pricing $50/mo off for life";

export const WPW_OFFER_EMAIL_PREVIEW =
  "Visualizer → DesignPro → 2D + 3D proof → Production Pack → print-ready files in 48 hours.";

export const WPW_OFFER_EMAIL_FROM_NAME = "Trish at WePrintWraps";
export const WPW_OFFER_EMAIL_FROM_EMAIL = "trish@weprintwraps.com";

/**
 * Self-contained HTML email — table-based, inline styles, light theme to match
 * the white-UI selling page. Renders in Gmail / Outlook / Apple Mail without a
 * CSS reset. Uses the same blue gradient (#0ea5e9 → #3b82f6 → #6366f1) and
 * messaging order as /wpw-offer.
 */
export const WPW_OFFER_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Try a design tool free — WPW Family pricing $50/mo off for life</title>
</head>
<body style="margin:0;padding:0;background:#FAFAFA;color:#0F172A;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FAFAFA;">
  Visualizer → DesignPro → 2D + 3D proof → Production Pack → print-ready files in 48 hours.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFA;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- Badge + Hero -->
        <tr>
          <td align="center" style="padding:8px 0 20px;">
            <span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(14,165,233,0.10);border:1px solid rgba(14,165,233,0.30);color:#0369A1;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">
              WPW CUSTOMER — EXCLUSIVE OFFER
            </span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 8px 16px;">
            <h1 style="margin:0;font-size:34px;line-height:1.15;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">
              Hey {{customer_name}} —<br/>
              try a <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">design tool free</span>.
            </h1>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 16px 28px;">
            <p style="margin:0;font-size:16px;line-height:1.55;color:#475569;max-width:520px;">
              Visualizer to DesignPro. Pick the customer's vehicle, prompt the design, revise until it's right, and walk away with print-ready files <strong style="color:#0F172A;">you own</strong>.
            </p>
          </td>
        </tr>

        <!-- Video card -->
        <tr>
          <td align="center" style="padding:0 0 28px;">
            <a href="${WPW_OFFER_URL}" style="display:block;text-decoration:none;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;background:#FFFFFF;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
                <tr>
                  <td style="position:relative;">
                    <img src="https://restyleproai.com/screenshots/porsche-distressed-hero.png" alt="Watch the 2-minute walkthrough" width="600" style="display:block;width:100%;height:auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 16px;background:#FFFFFF;">
                    <div style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:14px;font-weight:700;">
                      ▶  Watch the 2-min walkthrough
                    </div>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>

        <!-- Six-step flow -->
        <tr>
          <td style="padding:8px 8px 16px;">
            <p style="margin:0 0 14px;color:#64748B;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;text-align:center;">
              HOW IT WORKS
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 01</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">Pick the vehicle in Visualizer</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">Choose any year, make, and model — load it into the studio with one click.</p>
                </td>
              </tr>
              <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 02</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">Prompt the design in DesignPro</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">Type what you want — get a photoreal AI mock of the wrap on the vehicle in seconds.</p>
                </td>
              </tr>
              <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 03</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">Revise until it's right</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">Tweak colors, layouts, panels, and finishes. Keep iterating — it's all included.</p>
                </td>
              </tr>
              <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 04</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">ApprovePro — order approval, signed off</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">ApprovePro ties the approval to the specific order. Your client taps the link, sees the 2D + 3D proof, leaves in-line notes, requests revisions, and signs — every action time + date stamped. The approved order rolls straight into the Production Pack.</p>
                </td>
              </tr>
              <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 05</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">Buy a Production Pack</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">Hand the approved AI design to our real human design team. $299 per order standalone — or $249 if you're on DesignPro Studio (1 incl) and $199 on DesignPro Plus (3 incl). Universal Panelizer, PrepMyFile, and CutMap turn it into print-ready files. You own them forever — print once, reprint, or resell. Your design equity.</p>
                </td>
              </tr>
              <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#0369A1;font-size:11px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">STEP 06</p>
                  <p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">48 hours → files in your WrapBox</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">Print-ready files delivered to your WrapBox in 48 hours. Yours outright — print them yourself, send to PrintPro, or hand them to any printer.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Free offer card -->
        <tr>
          <td style="padding:24px 0 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1.5px solid #3B82F6;border-radius:18px;">
              <tr>
                <td align="center" style="padding:28px 22px 22px;">
                  <p style="margin:0 0 10px;color:#0284C7;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">FREE TO START — NO CARD</p>
                  <h2 style="margin:0 0 10px;color:#0F172A;font-size:24px;line-height:1.25;font-weight:800;">
                    Free dashboard +<br/>
                    <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">one design tool, on us.</span>
                  </h2>
                  <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.55;">
                    Pick the one you want to test-drive. We'll wire it to your dashboard.
                  </p>

                  <!-- Tool picker buttons -->
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                    <tr>
                      <td style="padding:5px;">
                        <a href="${WPW_OFFER_URL}?tool=colorpro" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;color:#0F172A;font-size:13px;font-weight:700;text-decoration:none;">ColorPro</a>
                      </td>
                      <td style="padding:5px;">
                        <a href="${WPW_OFFER_URL}?tool=designpro" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;color:#0F172A;font-size:13px;font-weight:700;text-decoration:none;">DesignPro</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:5px;">
                        <a href="${WPW_OFFER_URL}?tool=patternpro" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;color:#0F172A;font-size:13px;font-weight:700;text-decoration:none;">PatternPro</a>
                      </td>
                      <td style="padding:5px;">
                        <a href="${WPW_OFFER_URL}?tool=restylelibrary" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;color:#0F172A;font-size:13px;font-weight:700;text-decoration:none;">RestyleLibrary</a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:18px 0 14px;color:#64748B;font-size:12px;">— or —</p>

                  <a href="${WPW_OFFER_URL}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">
                    See the whole engine →
                  </a>
                  <p style="margin:14px 0 0;color:#64748B;font-size:11px;font-family:'Courier New',monospace;">
                    No card. No spam. Yours to keep.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Tier pricing pitch -->
        <tr>
          <td align="center" style="padding:24px 16px 8px;">
            <p style="margin:0 0 8px;color:#B45309;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">
              WPW FAMILY PRICING — LOCKED IN FOR LIFE
            </p>
            <h3 style="margin:0 0 8px;color:#0F172A;font-size:22px;line-height:1.25;font-weight:800;">
              <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$50/mo off every tier</span> — forever.
            </h3>
            <p style="margin:0;color:#475569;font-size:14px;line-height:1.55;max-width:520px;">
              Render quotas are shared across the entire suite — one counter for ColorPro, DesignProAI, GraphicsPro, PatternPro, FadeWraps, RestyleLibrary, MyVehiclePro, and RevisionStudioIQ.
            </p>
          </td>
        </tr>

        <!-- Tier mini-grid: 4 tiers in a 2x2 layout (email-friendly) -->
        <tr>
          <td style="padding:18px 8px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="50%" valign="top" style="padding:6px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                    <tr>
                      <td align="center" style="padding:18px 12px;">
                        <p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Starter</p>
                        <p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$350/mo</p>
                        <p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$300<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p>
                        <p style="margin:6px 0 0;color:#475569;font-size:11px;">50 renders / mo combined</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="50%" valign="top" style="padding:6px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                    <tr>
                      <td align="center" style="padding:18px 12px;">
                        <p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Lite</p>
                        <p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$499/mo</p>
                        <p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$449<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p>
                        <p style="margin:6px 0 0;color:#475569;font-size:11px;">75 renders + MyVehiclePro</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td width="50%" valign="top" style="padding:6px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:2px solid #3B82F6;border-radius:14px;">
                    <tr>
                      <td align="center" style="padding:6px 12px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);border-radius:12px 12px 0 0;">
                        <p style="margin:0;color:#FFFFFF;font-size:10px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">MOST POPULAR</p>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding:14px 12px 18px;">
                        <p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Studio</p>
                        <p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$699/mo</p>
                        <p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$649<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p>
                        <p style="margin:6px 0 0;color:#475569;font-size:11px;">150 renders + human designer + 1 Pack</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="50%" valign="top" style="padding:6px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;">
                    <tr>
                      <td align="center" style="padding:18px 12px;">
                        <p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Plus</p>
                        <p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$995/mo</p>
                        <p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$945<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p>
                        <p style="margin:6px 0 0;color:#475569;font-size:11px;">300 renders + 24-hr priority + 3 Packs</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;text-align:center;">
              <a href="${WPW_OFFER_URL}" style="display:inline-block;padding:12px 24px;border-radius:10px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;">
                Lock in WPW Family pricing →
              </a>
            </p>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:32px 16px 8px;border-top:1px solid #E2E8F0;margin-top:24px;">
            <p style="margin:24px 0 8px;color:#334155;font-size:14px;line-height:1.6;">
              Questions? Just hit reply — a real person from the WPW team answers.
            </p>
            <p style="margin:0;color:#64748B;font-size:14px;line-height:1.6;">
              — Trish &amp; the WePrintWraps team
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:28px 16px;">
            <p style="margin:0 0 8px;color:#94A3B8;font-size:11px;line-height:1.6;font-family:'Courier New',monospace;">
              You're getting this because you've ordered prints from WePrintWraps.
            </p>
            <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6;">
              <a href="{{unsubscribe_url}}" style="color:#64748B;text-decoration:underline;">Unsubscribe</a>
              &nbsp;•&nbsp;
              © {{current_year}} RestylePro / WePrintWraps
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

/**
 * SMS — kept under 160 chars after merge tag substitution so it sends as a
 * single segment. Replace {{customer_name}} server-side before send.
 */
export const WPW_OFFER_SMS = `{{customer_name}} — try a design tool free. WPW Family pricing $50/mo off every tier, for life. Print-ready files in 48hrs: ${WPW_OFFER_URL}  STOP to opt out.`;

/**
 * Optional follow-up SMS for non-clickers (send 3 days later).
 */
export const WPW_OFFER_SMS_FOLLOWUP = `{{customer_name}}, still time to lock in WPW Family pricing — $50/mo off every tier, Starter just $300/mo. Try a design tool free: ${WPW_OFFER_URL}`;

// ─────────────────────────────────────────────────────────────────────
// CAMPAIGN SERIES — 5-email drip + 4-message SMS drip
// ─────────────────────────────────────────────────────────────────────
//
// Two variants per email: 16:9 horizontal (uses /wpw-offer landing) and
// 9:16 vertical / Reels (uses /wpw-offer-vertical landing). Same body
// content, only the hero poster + landing URL differ.
//
// Send schedule (days since enrollment):
//   Email 1 — Day 0  · Intro: "Try a design tool free"
//   Email 2 — Day 2  · Walkthrough: "Watch the 2-min demo"
//   Email 3 — Day 5  · Features: "The full toolkit (no upcharges)"
//   Email 4 — Day 8  · Pricing: "WPW Family pricing — $50/mo off every tier"
//   Email 5 — Day 12 · Last call: "Lock it in before standard kicks in"
//
//   SMS 1   — Day 0  · Initial nudge
//   SMS 2   — Day 3  · Walkthrough nudge
//   SMS 3   — Day 7  · Pricing nudge
//   SMS 4   — Day 11 · Last-call nudge
//
// Wire to the Campaign Studio (/admin/campaign-videos) by importing
// WPW_OFFER_EMAIL_SERIES_HORIZONTAL / _VERTICAL and WPW_OFFER_SMS_SERIES.
// ─────────────────────────────────────────────────────────────────────

export interface CampaignEmail {
  /** Stable id (used as React key + DB FK). */
  id: "intro" | "walkthrough" | "features" | "pricing" | "lastcall";
  /** Days since campaign start (used for scheduling). */
  daySinceStart: number;
  subject: string;
  preview: string;
  fromName: string;
  fromEmail: string;
  /** Full self-contained HTML email body. */
  bodyHtml: string;
}

export interface CampaignSMS {
  id: "intro" | "walkthrough" | "pricing" | "lastcall";
  daySinceStart: number;
  /** ≤160 chars after merge-tag substitution to stay single-segment. */
  body: string;
}

interface OrientationConfig {
  /** Hero poster image URL — full https path, baked into the email. */
  posterUrl: string;
  /** CSS aspect-ratio in "W/H" form for the poster card. */
  posterAspect: "16/9" | "9/16";
  /** Landing-page URL the email links to. */
  landingUrl: string;
}

const HORIZONTAL_CONFIG: OrientationConfig = {
  posterUrl: "https://restyleproai.com/screenshots/porsche-distressed-hero.png",
  posterAspect: "16/9",
  landingUrl: WPW_OFFER_URL,
};

const VERTICAL_CONFIG: OrientationConfig = {
  // TODO: swap to a true 9:16 poster when one's available. Until then,
  // the same hero image renders with a 9:16 frame around it (letterboxed).
  posterUrl: "https://restyleproai.com/screenshots/porsche-distressed-hero.png",
  posterAspect: "9/16",
  landingUrl: WPW_OFFER_URL_VERTICAL,
};

// ── Email body templates (orientation placeholders) ──────────────────
// {{POSTER_URL}}  — hero poster image src
// {{POSTER_W}}    — poster img width attribute
// {{LANDING_URL}} — landing page URL
// {{BAR_CTA_TEXT}}— text inside the play-button pill

interface EmailTemplate {
  id: CampaignEmail["id"];
  daySinceStart: number;
  subject: string;
  preview: string;
  bodyHtml: string;
}

// Reuses the same shared header + footer. Each template is a complete,
// table-based HTML doc (so it renders standalone in Gmail/Outlook/etc).
const EMAIL_HEADER_OPEN = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{{TITLE}}</title>
</head>
<body style="margin:0;padding:0;background:#FAFAFA;color:#0F172A;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FAFAFA;">{{PREVIEW}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFA;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">`;

const EMAIL_FOOTER = `
        <!-- Sign-off -->
        <tr>
          <td style="padding:32px 16px 8px;border-top:1px solid #E2E8F0;">
            <p style="margin:24px 0 8px;color:#334155;font-size:14px;line-height:1.6;">Questions? Just hit reply — a real person from the WPW team answers.</p>
            <p style="margin:0;color:#64748B;font-size:14px;line-height:1.6;">— Trish &amp; the WePrintWraps team</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding:28px 16px;">
            <p style="margin:0 0 8px;color:#94A3B8;font-size:11px;line-height:1.6;font-family:'Courier New',monospace;">
              You're getting this because you've ordered prints from WePrintWraps.
            </p>
            <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6;">
              <a href="{{unsubscribe_url}}" style="color:#64748B;text-decoration:underline;">Unsubscribe</a>
              &nbsp;•&nbsp;
              © {{current_year}} RestylePro / WePrintWraps
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

// Hero poster card (orientation-aware). Uses a wrapper <td> with
// aspect-ratio inline style. Outlook ignores aspect-ratio but the
// poster img still renders at its natural size — acceptable fallback.
const POSTER_CARD = `
        <tr>
          <td align="center" style="padding:0 0 28px;">
            <a href="{{LANDING_URL}}" style="display:block;text-decoration:none;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;background:#FFFFFF;max-width:{{POSTER_MAX_W}}px;margin:0 auto;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
                <tr>
                  <td style="position:relative;">
                    <img src="{{POSTER_URL}}" alt="Watch the walkthrough" width="{{POSTER_W}}" style="display:block;width:100%;height:auto;aspect-ratio:{{POSTER_ASPECT}};object-fit:cover;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 16px;background:#FFFFFF;">
                    <div style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:14px;font-weight:700;">
                      ▶  {{BAR_CTA_TEXT}}
                    </div>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>`;

// Email 1 — INTRO (Day 0): "Try a design tool free"
// Reuses the same kitchen-sink layout as WPW_OFFER_EMAIL_HTML.
const TEMPLATE_INTRO: EmailTemplate = {
  id: "intro",
  daySinceStart: 0,
  subject: "{{customer_name}}, try a design tool free — WPW Family pricing $50/mo off for life",
  preview: "Visualizer → DesignPro → 2D + 3D proof → Production Pack → print-ready files in 48 hours.",
  bodyHtml: WPW_OFFER_EMAIL_HTML, // The current full email is already perfectly tuned for Day 0.
};

// Email 2 — WALKTHROUGH (Day 2): "Watch the 2-min demo"
const TEMPLATE_WALKTHROUGH: EmailTemplate = {
  id: "walkthrough",
  daySinceStart: 2,
  subject: "{{customer_name}}, see the engine in 2 minutes",
  preview: "Real shops, real wraps, real files you own forever. Tap to watch.",
  bodyHtml: `${EMAIL_HEADER_OPEN.replace("{{TITLE}}", "See the engine in 2 minutes").replace("{{PREVIEW}}", "Real shops, real wraps, real files you own forever.")}
        <tr><td align="center" style="padding:8px 0 20px;"><span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(14,165,233,0.10);border:1px solid rgba(14,165,233,0.30);color:#0369A1;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">WPW CUSTOMER — DAY 2</span></td></tr>
        <tr><td align="center" style="padding:0 8px 16px;">
          <h1 style="margin:0;font-size:32px;line-height:1.15;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">
            Hey {{customer_name}} — see the <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">engine in 2 minutes</span>.
          </h1>
        </td></tr>
        <tr><td align="center" style="padding:0 16px 24px;">
          <p style="margin:0;font-size:16px;line-height:1.55;color:#475569;max-width:520px;">
            Real shops. Real wraps. Real print-ready files <strong style="color:#0F172A;">you own forever</strong>. The whole flow — Visualizer → DesignPro → ApprovePro → Production Pack → 48hr to your WrapBox — in one walkthrough.
          </p>
        </td></tr>
        ${POSTER_CARD.replace("{{BAR_CTA_TEXT}}", "Watch the 2-min walkthrough")}
        <tr><td align="center" style="padding:8px 16px 24px;">
          <a href="{{LANDING_URL}}#tiers" style="display:inline-block;padding:12px 24px;border-radius:10px;background:transparent;border:1px solid #3B82F6;color:#1D4ED8;font-size:13px;font-weight:700;text-decoration:none;">
            Or jump to WPW pricing tiers →
          </a>
        </td></tr>${EMAIL_FOOTER}`,
};

// Email 3 — FEATURES (Day 5): "The full toolkit, no upcharges"
const TEMPLATE_FEATURES: EmailTemplate = {
  id: "features",
  daySinceStart: 5,
  subject: "{{customer_name}}, the full toolkit (no upcharges, no add-ons)",
  preview: "Shop CMS + quote builder + design suite + ProductionFlow + MarketingHub. Every tier.",
  bodyHtml: `${EMAIL_HEADER_OPEN.replace("{{TITLE}}", "The full toolkit").replace("{{PREVIEW}}", "Shop CMS + quote builder + design suite + ProductionFlow + MarketingHub. Every tier.")}
        <tr><td align="center" style="padding:8px 0 20px;"><span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(14,165,233,0.10);border:1px solid rgba(14,165,233,0.30);color:#0369A1;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">FULL TOOLKIT — INCLUDED</span></td></tr>
        <tr><td align="center" style="padding:0 8px 12px;">
          <h1 style="margin:0;font-size:30px;line-height:1.2;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">
            {{customer_name}} — every tier ships with <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">the whole engine</span>.
          </h1>
        </td></tr>
        <tr><td align="center" style="padding:0 16px 24px;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;max-width:540px;">No upsells. No "add-on packs." You can't opt out of features for a discount — the price is the price, and it includes everything below.</p>
        </td></tr>
        <!-- Three pillars -->
        <tr><td style="padding:0 8px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">DesignIQ</p><p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">DesignPro prompt-based AI mocks · ColorPro for every Avery &amp; 3M finish · FadeWraps · RestyleLibrary panels · GraphicsPro (vehicle, walls, windows + cut-contour) · Universal Panelizer.</p></td></tr>
          <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
          <tr><td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">MarketingHub</p><p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">MightyMail email campaigns · SMS retargeting · branded quote builder with your shop pricing · Shop CMS · gallery-driven SEO pages · wrap-shop content calendar.</p></td></tr>
          <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
          <tr><td style="padding:14px 16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><p style="margin:0 0 4px;color:#0F172A;font-size:15px;font-weight:700;">ProductionFlow</p><p style="margin:0;color:#475569;font-size:13px;line-height:1.55;">ApprovePro order-tied client sign-off · Production Pack with the human design team ($299 standalone, $249 on Studio, $199 on Plus) · Universal Panelizer · PrepMyFile · CutMap · WrapBox install kits · PrintPro fulfillment.</p></td></tr>
        </table></td></tr>
        <tr><td align="center" style="padding:24px 16px;">
          <a href="{{LANDING_URL}}#tiers" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">See the full toolkit + tiers →</a>
        </td></tr>${EMAIL_FOOTER}`,
};

// Email 4 — PRICING (Day 8): "WPW Family pricing — $50/mo off every tier"
const TEMPLATE_PRICING: EmailTemplate = {
  id: "pricing",
  daySinceStart: 8,
  subject: "{{customer_name}}, $50/mo off every tier — locked for life",
  preview: "WPW Family pricing — $50/mo off every tier, for life.",
  bodyHtml: `${EMAIL_HEADER_OPEN.replace("{{TITLE}}", "WPW Family pricing locked").replace("{{PREVIEW}}", "WPW Family pricing — $50/mo off every tier, for life.")}
        <tr><td align="center" style="padding:8px 0 20px;"><span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(180,83,9,0.10);border:1px solid rgba(180,83,9,0.30);color:#B45309;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">WPW FAMILY PRICING — LOCKED FOR LIFE</span></td></tr>
        <tr><td align="center" style="padding:0 8px 12px;">
          <h1 style="margin:0;font-size:30px;line-height:1.2;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">
            {{customer_name}}, save <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$50/mo for life</span> on every tier.
          </h1>
        </td></tr>
        <tr><td align="center" style="padding:0 16px 24px;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;max-width:540px;">Render quotas are shared across the entire suite — one counter for ColorPro, DesignProAI, GraphicsPro, PatternPro, FadeWraps, RestyleLibrary, MyVehiclePro, and RevisionStudioIQ.</p>
        </td></tr>
        <!-- 4-tier 2x2 mini grid -->
        <tr><td style="padding:0 8px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><tr><td align="center" style="padding:18px 12px;"><p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Starter</p><p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$350/mo</p><p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$300<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p><p style="margin:6px 0 0;color:#475569;font-size:11px;">50 renders / mo combined</p></td></tr></table></td>
            <td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><tr><td align="center" style="padding:18px 12px;"><p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Lite</p><p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$499/mo</p><p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$449<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p><p style="margin:6px 0 0;color:#475569;font-size:11px;">75 renders + MyVehiclePro</p></td></tr></table></td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:2px solid #3B82F6;border-radius:14px;"><tr><td align="center" style="padding:6px 12px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);border-radius:12px 12px 0 0;"><p style="margin:0;color:#FFFFFF;font-size:10px;font-weight:700;letter-spacing:1.5px;font-family:'Courier New',monospace;">MOST POPULAR</p></td></tr><tr><td align="center" style="padding:14px 12px 18px;"><p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Studio</p><p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$699/mo</p><p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$649<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p><p style="margin:6px 0 0;color:#475569;font-size:11px;">150 renders + human designer + 1 Pack</p></td></tr></table></td>
            <td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;"><tr><td align="center" style="padding:18px 12px;"><p style="margin:0 0 4px;color:#64748B;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">DesignPro Plus</p><p style="margin:0 0 2px;color:#94A3B8;font-size:11px;text-decoration:line-through;font-family:'Courier New',monospace;">$995/mo</p><p style="margin:0;font-size:24px;font-weight:800;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$945<span style="font-size:12px;color:#64748B;font-weight:600;">/mo</span></p><p style="margin:6px 0 0;color:#475569;font-size:11px;">300 renders + 24-hr priority + 3 Packs</p></td></tr></table></td>
          </tr>
        </table></td></tr>
        <tr><td align="center" style="padding:18px 16px;">
          <a href="{{LANDING_URL}}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">Lock in WPW Family pricing →</a>
        </td></tr>${EMAIL_FOOTER}`,
};

// Email 5 — LAST CALL (Day 12): single-CTA urgency push
const TEMPLATE_LASTCALL: EmailTemplate = {
  id: "lastcall",
  daySinceStart: 12,
  subject: "{{customer_name}}, last call — WPW Family pricing $50/mo off for life",
  preview: "Lock in WPW Family pricing now — $50/mo off every tier, for life.",
  bodyHtml: `${EMAIL_HEADER_OPEN.replace("{{TITLE}}", "Last call — lock in WPW Family pricing").replace("{{PREVIEW}}", "Lock in $50/mo off every tier — for life.")}
        <tr><td align="center" style="padding:8px 0 20px;"><span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(225,29,72,0.10);border:1px solid rgba(225,29,72,0.30);color:#BE123C;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">LAST CALL — WPW FAMILY OFFER</span></td></tr>
        <tr><td align="center" style="padding:0 8px 12px;">
          <h1 style="margin:0;font-size:32px;line-height:1.2;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">
            {{customer_name}}, lock in <span style="background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#3B82F6;">$50/mo off every tier</span>, for life.
          </h1>
        </td></tr>
        <tr><td align="center" style="padding:0 16px 24px;">
          <p style="margin:0;font-size:16px;line-height:1.6;color:#475569;max-width:520px;">Starter $300/mo, DesignPro Lite $449/mo, Studio $649/mo, Plus $945/mo. Subscribe today and your WPW Family rate stays — for life.</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 16px 32px;">
          <a href="{{LANDING_URL}}" style="display:inline-block;padding:16px 36px;border-radius:14px;background:linear-gradient(135deg,#0ea5e9,#3b82f6,#6366f1);color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none;box-shadow:0 8px 24px rgba(59,130,246,0.30);">Lock in WPW Family pricing →</a>
        </td></tr>
        <tr><td align="center" style="padding:0 16px 24px;">
          <p style="margin:0;color:#64748B;font-size:13px;line-height:1.55;">Reply with any questions — Trish answers personally.</p>
        </td></tr>${EMAIL_FOOTER}`,
};

const SERIES_TEMPLATES: EmailTemplate[] = [
  TEMPLATE_INTRO,
  TEMPLATE_WALKTHROUGH,
  TEMPLATE_FEATURES,
  TEMPLATE_PRICING,
  TEMPLATE_LASTCALL,
];

// Render a template into a CampaignEmail by substituting orientation
// placeholders. The intro template (id="intro") is special-cased
// because its body is the existing WPW_OFFER_EMAIL_HTML which already
// has the horizontal landing URL baked in — we re-target it for the
// vertical variant by replacing the URL.
const renderEmail = (
  template: EmailTemplate,
  orientation: OrientationConfig,
): CampaignEmail => {
  const posterMaxWidth = orientation.posterAspect === "9/16" ? 340 : 600;
  const body = template.bodyHtml
    .replace(/\{\{POSTER_URL\}\}/g, orientation.posterUrl)
    .replace(/\{\{POSTER_ASPECT\}\}/g, orientation.posterAspect)
    .replace(/\{\{POSTER_W\}\}/g, String(posterMaxWidth))
    .replace(/\{\{POSTER_MAX_W\}\}/g, String(posterMaxWidth))
    .replace(/\{\{LANDING_URL\}\}/g, orientation.landingUrl)
    // The intro reuses WPW_OFFER_EMAIL_HTML which has WPW_OFFER_URL
    // baked in via template literal. For the vertical variant, retarget
    // any /wpw-offer link that isn't already /wpw-offer-vertical.
    .replace(
      orientation === VERTICAL_CONFIG
        ? /https:\/\/restyleproai\.com\/wpw-offer(?!-vertical)/g
        : /__never_match__/g,
      orientation.landingUrl,
    );
  return {
    id: template.id,
    daySinceStart: template.daySinceStart,
    subject: template.subject,
    preview: template.preview,
    fromName: WPW_OFFER_EMAIL_FROM_NAME,
    fromEmail: WPW_OFFER_EMAIL_FROM_EMAIL,
    bodyHtml: body,
  };
};

/**
 * 5-email drip campaign for the 16:9 horizontal landing variant
 * (/wpw-offer). Send order matches array order; daySinceStart on each
 * entry tells the scheduler how many days after enrollment to fire.
 */
export const WPW_OFFER_EMAIL_SERIES_HORIZONTAL: CampaignEmail[] =
  SERIES_TEMPLATES.map((t) => renderEmail(t, HORIZONTAL_CONFIG));

/**
 * 5-email drip campaign for the 9:16 Reels-style landing variant
 * (/wpw-offer-vertical). Identical content to the horizontal series;
 * differs only in hero poster aspect and landing URL.
 */
export const WPW_OFFER_EMAIL_SERIES_VERTICAL: CampaignEmail[] =
  SERIES_TEMPLATES.map((t) => renderEmail(t, VERTICAL_CONFIG));

// ── SMS series (orientation-agnostic) ────────────────────────────────
// Each message is single-segment-safe (≤160 chars after merge-tag
// substitution with most short customer names).

export const WPW_OFFER_SMS_SERIES: CampaignSMS[] = [
  {
    id: "intro",
    daySinceStart: 0,
    body: `{{customer_name}} — try a design tool free. WPW Family pricing $50/mo off every tier, for life. Print-ready files in 48hrs: ${WPW_OFFER_URL}  STOP to opt out.`,
  },
  {
    id: "walkthrough",
    daySinceStart: 3,
    body: `{{customer_name}}, did you watch the 2-min walkthrough yet? Visualizer → DesignPro → 48hr WrapBox files: ${WPW_OFFER_URL}`,
  },
  {
    id: "pricing",
    daySinceStart: 7,
    body: `{{customer_name}} — WPW Family pricing locks $50/mo off every tier for life: Starter $300, DesignPro Lite $449, Studio $649, Plus $945. Subscribe: ${WPW_OFFER_URL}`,
  },
  {
    id: "lastcall",
    daySinceStart: 11,
    body: `Last call {{customer_name}} — WPW Family pricing locks $50/mo off every tier for life. Starter just $300/mo. Lock it in: ${WPW_OFFER_URL}`,
  },
];
