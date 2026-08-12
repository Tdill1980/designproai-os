/**
 * Launch / Blitz campaign — cold-traffic friendly email + SMS for Meta Ads,
 * Google Ads, organic social, etc. Mirrors the WPW campaign structurally
 * but drops "WPW Family" branding and the "free dashboard + 1 tool" promise.
 *
 * The standalone /launch and /launch-vertical pages were retired in #1496;
 * both routes redirect to /pricing. The drip still fires via admin tooling
 * and links land on /pricing.
 *
 * Sender functions:
 *   supabase/functions/send-email-campaign
 *   supabase/functions/send-sms-campaign
 *
 * Merge tags: {{customer_name}} {{customer_email}} {{current_year}} {{unsubscribe_url}}
 */

export const LAUNCH_OFFER_URL = "https://restyleproai.com/pricing";
export const LAUNCH_OFFER_URL_VERTICAL = "https://restyleproai.com/pricing";

export const LAUNCH_EMAIL_SUBJECT =
  "{{customer_name}}, the design + marketing engine for wrap shops is live";

export const LAUNCH_EMAIL_PREVIEW =
  "From $350/mo. Photoreal AI mocks → branded quotes → print-ready files.";

export const LAUNCH_EMAIL_FROM_NAME = "RestylePro";
export const LAUNCH_EMAIL_FROM_EMAIL = "hello@restyleproai.com";

export const LAUNCH_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The design + marketing engine for wrap shops</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;color:#EAEAEA;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0A0A0A;">
  From $350/mo. Photoreal AI mocks → branded quotes → print-ready files.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0A;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- Badge + Hero -->
        <tr>
          <td align="center" style="padding:8px 0 20px;">
            <span style="display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(0,229,255,0.10);border:1px solid rgba(0,229,255,0.35);color:#00E5FF;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">
              LIVE NOW — DESIGN. OUTPUT. PROFIT.
            </span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 8px 16px;">
            <h1 style="margin:0;font-size:34px;line-height:1.15;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">
              The <span style="background:linear-gradient(135deg,#E040FB,#8B5CF6,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#8B5CF6;">design &amp; marketing</span><br/>engine for wrap shops.
            </h1>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 16px 28px;">
            <p style="margin:0;font-size:16px;line-height:1.55;color:#999999;max-width:480px;">
              Photoreal AI mocks, branded quotes, client approvals, and print-ready panels.
              <strong style="color:#FFFFFF;">One platform. From prompt to production.</strong>
            </p>
          </td>
        </tr>

        <!-- Video card -->
        <tr>
          <td align="center" style="padding:0 0 28px;">
            <a href="${LAUNCH_OFFER_URL}" style="display:block;text-decoration:none;border-radius:16px;overflow:hidden;border:1px solid #1A1A1A;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
                <tr>
                  <td>
                    <img src="https://restyleproai.com/screenshots/porsche-distressed-hero.png" alt="Watch the 2-minute demo" width="600" style="display:block;width:100%;height:auto;opacity:0.75;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 16px;background:#0A0A0A;">
                    <div style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#E040FB,#8B5CF6,#3B82F6);color:#FFFFFF;font-size:14px;font-weight:700;">
                      ▶  Watch the 2-min demo
                    </div>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>

        <!-- Three pillars -->
        <tr>
          <td style="padding:0 8px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:14px 16px;background:#111111;border:1px solid #1A1A1A;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#FFFFFF;font-size:15px;font-weight:700;">DesignIQ</p>
                  <p style="margin:0;color:#888888;font-size:13px;line-height:1.55;">Type a prompt, get a photoreal wrap mock in seconds. ColorPro for every Avery &amp; 3M finish, FadeWraps, Universal Panelizer.</p>
                </td>
              </tr>
              <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#111111;border:1px solid #1A1A1A;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#FFFFFF;font-size:15px;font-weight:700;">MarketingHub</p>
                  <p style="margin:0;color:#888888;font-size:13px;line-height:1.55;">Branded quotes, MightyMail email campaigns, SMS retargeting, gallery-driven SEO pages, and a content calendar built for wrap shops.</p>
                </td>
              </tr>
              <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:14px 16px;background:#111111;border:1px solid #1A1A1A;border-radius:14px;">
                  <p style="margin:0 0 4px;color:#FFFFFF;font-size:15px;font-weight:700;">ProductionFlow</p>
                  <p style="margin:0;color:#888888;font-size:13px;line-height:1.55;">From the approved design straight to print-ready panels. ApprovePro client sign-off, WrapBox install kits, PrintPro fulfillment.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Pre-sale CTA -->
        <tr>
          <td style="padding:24px 0 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F0F0F;border:1.5px solid #8B5CF6;border-radius:18px;">
              <tr>
                <td align="center" style="padding:30px 22px 24px;">
                  <p style="margin:0 0 10px;color:#00E5FF;font-size:11px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">FOUR PLANS — FROM $350/mo</p>
                  <h2 style="margin:0 0 10px;color:#FFFFFF;font-size:24px;line-height:1.25;font-weight:800;">
                    Pick your plan.<br/>
                    <span style="background:linear-gradient(135deg,#E040FB,#8B5CF6,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#8B5CF6;">Cancel anytime.</span>
                  </h2>
                  <p style="margin:0 0 20px;color:#999999;font-size:14px;line-height:1.55;">
                    Starter $350 · DesignPro Lite $499 · Studio $699 (real human designer) · Plus $995 (24-hr priority). Production Packs sold separately; subscribers get discounted rates. Render quotas shared across the entire suite.
                  </p>
                  <a href="${LAUNCH_OFFER_URL}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#E040FB,#8B5CF6,#3B82F6);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">
                    See all plans →
                  </a>
                  <p style="margin:14px 0 0;color:#555555;font-size:11px;font-family:'Courier New',monospace;">
                    No card to start. Cancel anytime.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:32px 16px 8px;border-top:1px solid #1A1A1A;">
            <p style="margin:24px 0 8px;color:#CCCCCC;font-size:14px;line-height:1.6;">
              Questions? Just hit reply — a real person answers.
            </p>
            <p style="margin:0;color:#888888;font-size:14px;line-height:1.6;">
              — The RestylePro team
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:28px 16px;">
            <p style="margin:0;color:#444444;font-size:11px;line-height:1.6;">
              <a href="{{unsubscribe_url}}" style="color:#666666;text-decoration:underline;">Unsubscribe</a>
              &nbsp;•&nbsp;
              © {{current_year}} RestylePro
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
 * SMS — single-segment friendly. {{customer_name}} substituted server-side.
 */
export const LAUNCH_SMS = `Hey {{customer_name}} — RestylePro is live. Design + marketing engine for wrap shops. From $350/mo, cancel anytime: ${LAUNCH_OFFER_URL}  Reply STOP to opt out.`;

export const LAUNCH_SMS_FOLLOWUP = `{{customer_name}}, RestylePro: photoreal AI mocks, branded quotes, print-ready panels. Starter $350/mo. See all plans: ${LAUNCH_OFFER_URL}`;
