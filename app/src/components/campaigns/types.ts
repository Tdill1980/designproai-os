export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  from_name: string | null;
  from_email: string | null;
  audience: 'all_users' | 'subscribers' | 'custom';
  subscriber_source: string | null;
  custom_emails: string[] | null;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  scheduled_at: string | null;
  sent_at: string | null;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  total_opened: number;
  total_clicked: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignSend {
  id: string;
  campaign_id: string;
  recipient_email: string;
  recipient_user_id: string | null;
  status: 'pending' | 'sent' | 'failed' | 'bounced';
  resend_message_id: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface CampaignEvent {
  id: string;
  campaign_id: string;
  send_id: string | null;
  event_type: 'open' | 'click' | 'unsubscribe';
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export type AudienceType = 'all_users' | 'subscribers' | 'custom';

export interface SmsTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  category: 'promo' | 'announcement' | 'followup';
}

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  html: string;
  category: 'announcement' | 'promotion' | 'newsletter' | 'welcome' | 'blank';
}

// Pre-built campaign templates
export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    description: 'Start from scratch with a clean layout',
    thumbnail: '',
    category: 'blank',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:32px;border-radius:12px">
  <h1 style="color:#06b6d4;margin:0 0 16px">Your Heading Here</h1>
  <p style="color:#ccc;line-height:1.6">Your content goes here. Use the editor to customize this template.</p>
  <a href="https://restyleproai.com" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;margin:24px 0">Call to Action</a>
  <hr style="border:none;border-top:1px solid #333;margin:24px 0"/>
  <p style="color:#666;font-size:12px;margin:0">RestyleProAI — <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
</div>`,
  },
  {
    id: 'launch-announcement',
    name: 'Launch Announcement',
    description: 'Announce a new feature or product launch',
    thumbnail: '',
    category: 'announcement',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#06b6d4,#8b5cf6);padding:40px 32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px">Something Big Just Dropped</h1>
    <p style="color:rgba(255,255,255,0.85);margin:12px 0 0;font-size:16px">RestylePro just got a major upgrade</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">We've been working on something incredible and it's finally here. Our new visualization tools are now live — giving you photorealistic wrap renders in seconds.</p>
    <div style="text-align:center;margin:32px 0">
      <a href="https://restyleproai.com/colorpro" style="display:inline-block;background:#06b6d4;color:#000;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Try It Now →</a>
    </div>
    <p style="color:#ccc;line-height:1.7;font-size:15px">This is the tool your shop has been waiting for. Sell more wraps, close more deals, impress every customer.</p>
    <p style="color:#06b6d4;font-weight:600;margin-top:24px">— The RestylePro Team</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'promo-offer',
    name: 'Promo / Special Offer',
    description: 'Drive urgency with a limited-time promotion',
    thumbnail: '',
    category: 'promotion',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:#0a0a0a;padding:32px;text-align:center;border-bottom:2px solid #06b6d4">
    <p style="color:#06b6d4;font-weight:700;font-size:14px;letter-spacing:2px;margin:0">LIMITED TIME OFFER</p>
    <h1 style="color:#fff;margin:12px 0 0;font-size:36px">50% OFF</h1>
    <p style="color:#999;margin:8px 0 0;font-size:16px">Your first month of RestylePro</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">For the next 48 hours, get 50% off any RestylePro subscription plan. Create stunning wrap visualizations, close more deals, and wow your customers with photorealistic renders.</p>
    <div style="background:#111;border:1px solid #333;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
      <p style="color:#06b6d4;font-size:24px;font-weight:700;margin:0">Use code: WRAP50</p>
      <p style="color:#999;font-size:13px;margin:8px 0 0">Expires in 48 hours</p>
    </div>
    <div style="text-align:center">
      <a href="https://restyleproai.com/pricing" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#000;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Claim Your Discount →</a>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'newsletter',
    name: 'Newsletter / Update',
    description: 'Share news, tips, and showcase gallery highlights',
    thumbnail: '',
    category: 'newsletter',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="padding:32px 32px 20px;border-bottom:1px solid #222">
    <h1 style="color:#06b6d4;margin:0;font-size:20px">RestylePro Weekly</h1>
    <p style="color:#666;font-size:13px;margin:4px 0 0">Your wrap industry digest</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 12px">What's New This Week</h2>
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}}, here's what's been happening at RestylePro this week:</p>

    <div style="background:#111;border-left:3px solid #06b6d4;padding:16px;margin:20px 0;border-radius:0 8px 8px 0">
      <h3 style="color:#06b6d4;margin:0 0 8px;font-size:15px">New Feature: DesignPro Upgrade</h3>
      <p style="color:#999;margin:0;font-size:14px;line-height:1.5">Create custom panel designs with our new AI-powered design tool. Upload any reference and watch it come to life.</p>
    </div>

    <div style="background:#111;border-left:3px solid #8b5cf6;padding:16px;margin:20px 0;border-radius:0 8px 8px 0">
      <h3 style="color:#8b5cf6;margin:0 0 8px;font-size:15px">Tip: Get Better Renders</h3>
      <p style="color:#999;margin:0;font-size:14px;line-height:1.5">Add specific details to your prompts — material type, finish, and color — for the most photorealistic results.</p>
    </div>

    <div style="text-align:center;margin:32px 0">
      <a href="https://restyleproai.com/gallery" style="display:inline-block;background:#06b6d4;color:#000;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600">View Gallery →</a>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'welcome-series',
    name: 'Welcome / Onboarding',
    description: 'Welcome new signups and guide them to their first render',
    thumbnail: '',
    category: 'welcome',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#06b6d4 0%,#8b5cf6 50%,#d946ef 100%);padding:48px 32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:32px">Welcome to RestylePro</h1>
    <p style="color:rgba(255,255,255,0.9);margin:12px 0 0;font-size:16px">Your wrap visualization journey starts now</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">Welcome aboard! You just joined the most powerful wrap visualization platform in the industry. Here's how to get started:</p>

    <div style="margin:28px 0">
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="background:#06b6d4;color:#000;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">1</div>
        <div><h3 style="color:#fff;margin:4px 0 4px;font-size:15px">Pick a Vehicle</h3><p style="color:#999;margin:0;font-size:14px">Choose from our library of vehicles or enter any year, make, and model.</p></div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="background:#8b5cf6;color:#fff;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">2</div>
        <div><h3 style="color:#fff;margin:4px 0 4px;font-size:15px">Choose a Color or Design</h3><p style="color:#999;margin:0;font-size:14px">Browse manufacturer colors, custom wraps, or create your own design.</p></div>
      </div>
      <div style="display:flex;gap:16px">
        <div style="background:#d946ef;color:#fff;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">3</div>
        <div><h3 style="color:#fff;margin:4px 0 4px;font-size:15px">Generate & Share</h3><p style="color:#999;margin:0;font-size:14px">Get a photorealistic render in seconds. Share with customers to close the deal.</p></div>
      </div>
    </div>

    <div style="text-align:center;margin:32px 0">
      <a href="https://restyleproai.com/colorpro" style="display:inline-block;background:#06b6d4;color:#000;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Create Your First Render →</a>
    </div>
    <p style="color:#999;font-size:14px;text-align:center">Questions? Just reply to this email — we read every one.</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 're-engagement',
    name: 'Re-Engagement',
    description: 'Win back users who haven\'t visited recently',
    thumbnail: '',
    category: 'promotion',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="padding:40px 32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px">We Miss You, {{customer_name}}</h1>
    <p style="color:#999;margin:12px 0 0;font-size:16px">A lot has changed since you've been away</p>
  </div>
  <div style="padding:0 32px 32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">It's been a while since your last visit. We've been busy building some incredible new features:</p>

    <ul style="color:#ccc;line-height:2;font-size:15px;padding-left:20px">
      <li>New AI-powered DesignPro tool</li>
      <li>360° vehicle visualization</li>
      <li>Print-ready production packs</li>
      <li>Expanded vehicle library</li>
    </ul>

    <p style="color:#ccc;line-height:1.7;font-size:15px">Come back and see what's new — your next render is on us.</p>

    <div style="text-align:center;margin:32px 0">
      <a href="https://restyleproai.com" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Come Back & Explore →</a>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI · restyleproai.com · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'wpw-friends-family-intro',
    name: 'WPW Friends & Family — Visual Platform Intro',
    description: 'Visual-first email showcasing real UI screenshots, renders, logo, video link, personal story, and WPW PreSale pricing',
    thumbnail: '',
    category: 'promotion',
    html: `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:12px;overflow:hidden">

  <!-- LOGO HEADER -->
  <div style="background:#000;padding:24px 32px;text-align:center;border-bottom:2px solid #111">
    <img src="https://restyleproai.com/sproket-rocket-logo.png" alt="RestyleProAI" style="height:56px;display:inline-block" />
    <div style="margin-top:8px">
      <img src="https://restyleproai.com/restyleproai-logo-full.png" alt="RestyleProAI" style="height:28px;display:inline-block" />
    </div>
  </div>

  <!-- WPW BADGE -->
  <div style="text-align:center;padding:20px 32px 0">
    <span style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#F5E6A3,#D4AF37);color:#000;font-size:11px;font-weight:800;letter-spacing:2px;padding:6px 20px;border-radius:20px">WPW FRIENDS &amp; FAMILY — EXCLUSIVE PRESALE</span>
  </div>

  <!-- HERO: Porsche Martini with SPROKET hook -->
  <div style="padding:16px 0 0">
    <img src="https://restyleproai.com/email-assets/porsche-martini-hook.png" alt="Porsche 911 Distressed Martini Wrap — AI-designed wraps. Photorealistic in seconds." style="width:100%;display:block" />
  </div>

  <!-- HEADLINE -->
  <div style="padding:20px 32px 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px;line-height:1.3">Your Wrap Shop Just Got a<br/><span style="color:#06b6d4">Full-Time AI Designer</span></h1>
    <p style="color:#bbb;font-size:16px;margin:14px 0 0;line-height:1.5">7 photorealistic renders in 30 seconds. Not 3 days. Not $975.</p>
  </div>

  <!-- RENDER: Mini Cooper commercial wrap -->
  <div style="padding:20px 0 0">
    <img src="https://restyleproai.com/email-assets/mini-cooper-hook.png" alt="Mini Cooper Practical Magic Day Spa Wrap — From concept to print-ready. One platform." style="width:100%;display:block" />
  </div>

  <!-- RENDER: Lambo X-Ray with SPROKET hook -->
  <div style="padding:4px 0 0">
    <img src="https://restyleproai.com/email-assets/lambo-xray-hook.png" alt="Lamborghini X-Ray Engine Wrap — 10,000+ renders trained DesignIQ." style="width:100%;display:block" />
  </div>

  <!-- MINI CTA -->
  <div style="padding:20px 32px;text-align:center">
    <p style="color:#999;font-size:14px;margin:0 0 16px;line-height:1.5">Every image above was generated by AI on RestyleProAI.<br/>Not designed by a human. Not outsourced. Not $975.</p>
    <a href="https://restyleproai.com/gallery" style="display:inline-block;background:#111;border:2px solid #06b6d4;padding:14px 28px;border-radius:10px;text-decoration:none;color:#06b6d4;font-weight:700;font-size:15px">&#9654; See More Renders in the Gallery</a>
  </div>

  <!-- RENDER: BBQ Sprinter Van -->
  <div style="padding:16px 0 0">
    <img src="https://restyleproai.com/email-assets/bbq-sprinter-hook.png" alt="Pitmaster Jack BBQ Sprinter Van Wrap — Every design is unique. DesignIQ was engineered using 10+ years of real wrap data." style="width:100%;display:block" />
  </div>

  <!-- SECTION: SEE THE ACTUAL PLATFORM -->
  <div style="padding:28px 20px 8px;text-align:center">
    <p style="color:#D4AF37;font-size:11px;font-weight:800;letter-spacing:2px;margin:0 0 4px">SEE THE ACTUAL PLATFORM</p>
    <p style="color:#999;font-size:13px;margin:0 0 16px">This is what you see when you log in.</p>
  </div>

  <!-- UI: DesignVault Gallery -->
  <div style="padding:0 8px 8px">
    <div style="border:1px solid #222;border-radius:12px;overflow:hidden;background:#111">
      <img src="https://restyleproai.com/email-assets/designvault-gallery.png" alt="DesignVault — QC'd by real designers. Stamped with your DesignID." style="width:100%;display:block" />
      <div style="padding:12px 16px">
        <p style="color:#06b6d4;font-size:14px;font-weight:700;margin:0">DesignVault&#8482; &amp; Gallery</p>
        <p style="color:#999;font-size:12px;margin:4px 0 0;line-height:1.4">Browse, search, and manage every design you create. QC'd by real designers. Stamped with your DesignID.</p>
      </div>
    </div>
  </div>

  <!-- UI: Pricing Page Screenshot -->
  <div style="padding:0 8px 8px">
    <div style="border:1px solid #222;border-radius:12px;overflow:hidden;background:#111">
      <img src="https://restyleproai.com/email-assets/pricing-page.png" alt="RestyleProAI Pricing — Pre-Sale Ends April 7" style="width:100%;display:block" />
      <div style="padding:12px 16px">
        <p style="color:#D4AF37;font-size:14px;font-weight:700;margin:0">Pre-Sale is LIVE — Ends April 7th</p>
        <p style="color:#999;font-size:12px;margin:4px 0 0;line-height:1.4">The ONLY system that gives you a vehicle wrap designer at your fingertips. Prompt to production.</p>
      </div>
    </div>
  </div>

  <!-- UI: ProductionFlow Screenshot -->
  <div style="padding:0 8px 8px">
    <div style="border:1px solid #222;border-radius:12px;overflow:hidden;background:#111">
      <img src="https://restyleproai.com/screenshots/productionflow-system.png" alt="ProductionFlow — Print-Ready Panel Output" style="width:100%;display:block" />
      <div style="padding:12px 16px">
        <p style="color:#d946ef;font-size:14px;font-weight:700;margin:0">ProductionFlow&#8482;</p>
        <p style="color:#999;font-size:12px;margin:4px 0 0;line-height:1.4">8K print-ready panel files + PDF proof — sized to the exact vehicle. Send straight to your printer.</p>
      </div>
    </div>
  </div>

  <!-- WHAT'S INSIDE — COMPACT TOOL LIST -->
  <div style="padding:16px 24px 20px">
    <p style="color:#D4AF37;font-size:11px;font-weight:800;letter-spacing:2px;margin:0 0 12px;text-align:center">EVERYTHING INSIDE THE PLATFORM</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
      <tr>
        <td style="padding:10px 14px;background:#111;border-radius:8px 8px 0 0;border-bottom:1px solid #1a1a1a">
          <strong style="color:#06b6d4;font-size:14px">ColorPro&#8482;</strong>
          <span style="color:#999;font-size:12px;display:block;margin-top:2px">Photorealistic color changes — any color, any vehicle, 7 camera angles</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#111;border-bottom:1px solid #1a1a1a">
          <strong style="color:#8b5cf6;font-size:14px">DesignProAI&#8482;</strong>
          <span style="color:#999;font-size:12px;display:block;margin-top:2px">Custom wrap designs from a text prompt — stealth, carbon, camo, anything</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#111;border-bottom:1px solid #1a1a1a">
          <strong style="color:#d946ef;font-size:14px">ProductionFlow&#8482;</strong>
          <span style="color:#999;font-size:12px;display:block;margin-top:2px">8K print-ready panel files + PDF proof — sized to the exact vehicle</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#111;border-bottom:1px solid #1a1a1a">
          <strong style="color:#22c55e;font-size:14px">RevisionStudio&#8482;</strong>
          <span style="color:#999;font-size:12px;display:block;margin-top:2px">Dial in every detail — adjust colors, finishes, and materials before printing</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#111;border-radius:0 0 8px 8px">
          <strong style="color:#f59e0b;font-size:14px">CreatorMarket&#8482;</strong>
          <span style="color:#999;font-size:12px;display:block;margin-top:2px">Buy &amp; sell wrap designs — you keep 60% on every sale, we drive buyers</span>
        </td>
      </tr>
    </table>
  </div>

  <!-- TRISH'S PERSONAL STORY -->
  <div style="padding:0 20px 24px">
    <div style="background:#111;border:1px solid #333;border-radius:12px;padding:24px;border-left:4px solid #D4AF37">
      <p style="color:#D4AF37;font-size:11px;font-weight:800;letter-spacing:2px;margin:0 0 12px">WHY I BUILT THIS</p>
      <p style="color:#ccc;font-size:14px;line-height:1.7;margin:0 0 12px">If your designer is constantly behind — or you don't have one at all — I built this for you.</p>
      <p style="color:#ccc;font-size:14px;line-height:1.7;margin:0 0 12px">At WePrintWraps.com, we had to raise our custom wrap design price from $500 to $975 just to keep up with demand. I kept getting emails from friends in the industry fed up with our turnaround and price increases. That told me everything — thousands of shops have the same problem. <strong style="color:#fff">Design is the bottleneck.</strong></p>
      <p style="color:#ccc;font-size:14px;line-height:1.7;margin:0 0 12px">I built RestyleProAI to solve my own problems at WePrintWraps.com — but also for my friends across the graphics industry. Whether you own a sign company or a restyling shop, this is for you.</p>
      <p style="color:#fff;font-size:15px;line-height:1.7;margin:0 0 4px;font-weight:600">RestyleProAI will 10X your existing designer's output. And if you don't have a designer, you can finally say goodbye to overpriced outsourcing.</p>
      <p style="color:#D4AF37;font-size:14px;font-weight:600;margin:16px 0 0">— Trish Dill, Co-Founder</p>
    </div>
  </div>

  <!-- PRESALE PRICING HEADER -->
  <div style="padding:0 32px 8px;text-align:center">
    <p style="color:#D4AF37;font-size:12px;font-weight:800;letter-spacing:2px;margin:0 0 8px">WPW FAMILY PRICING — $50/mo OFF FOR LIFE</p>
    <p style="color:#fff;font-size:15px;margin:0 0 16px">Render quotas shared across the entire suite. No designs/seats caps.</p>
  </div>

  <!-- PRICE TABLE -->
  <div style="padding:0 20px 24px">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
      <tr>
        <td style="padding:12px 16px;background:#111;border:1px solid #222;border-radius:8px 8px 0 0;border-bottom:none">
          <strong style="color:#fff;font-size:15px">Starter</strong>
          <span style="color:#D4AF37;font-size:18px;font-weight:800;float:right">$300<span style="color:#666;font-size:12px;font-weight:400">/mo</span></span>
          <span style="display:block;color:#666;font-size:12px;margin-top:2px">Solo wrapper · 50 renders / mo combined</span>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;background:#111;border:1px solid #222;border-bottom:none">
          <strong style="color:#fff;font-size:15px">DesignPro Lite</strong>
          <span style="color:#D4AF37;font-size:18px;font-weight:800;float:right">$449<span style="color:#666;font-size:12px;font-weight:400">/mo</span></span>
          <span style="display:block;color:#666;font-size:12px;margin-top:2px">Brick-and-mortar · 75 renders + MyVehiclePro</span>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;background:#0d1117;border:2px solid #D4AF37;border-bottom:none">
          <strong style="color:#fff;font-size:16px">DesignPro Studio</strong>
          <span style="color:#D4AF37;font-size:20px;font-weight:800;float:right">$649<span style="color:#666;font-size:12px;font-weight:400">/mo</span></span>
          <span style="display:block;color:#999;font-size:12px;margin-top:2px">Working wrap shop · 150 renders + human designer + 1 Pack</span>
          <span style="display:inline-block;background:#D4AF37;color:#000;font-size:9px;font-weight:800;padding:3px 10px;border-radius:10px;margin-top:6px">MOST POPULAR</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 16px;background:#111;border:1px solid #222;border-radius:0 0 8px 8px">
          <strong style="color:#fff;font-size:15px">DesignPro Plus</strong>
          <span style="color:#D4AF37;font-size:18px;font-weight:800;float:right">$945<span style="color:#666;font-size:12px;font-weight:400">/mo</span></span>
          <span style="display:block;color:#666;font-size:12px;margin-top:2px">High-volume · 300 renders + 24-hr priority + 3 Packs</span>
        </td>
      </tr>
    </table>
    <p style="text-align:center;color:#666;font-size:11px;margin:8px 0 0">$5/render after monthly cap. WPW Family rate locked for life.</p>
  </div>

  <!-- BIG GOLD CTA -->
  <div style="text-align:center;padding:8px 32px 32px">
    <a href="https://restyleproai.com/pricing" style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#F5E6A3,#D4AF37);color:#000;padding:18px 48px;text-decoration:none;border-radius:10px;font-weight:800;font-size:18px;letter-spacing:0.5px">Lock In WPW Family Pricing &#8594;</a>
    <p style="color:#999;font-size:12px;margin:12px 0 0">Pre-Sale ends April 7th · No credit card to explore free tools</p>
  </div>

  <!-- FOOTER -->
  <div style="padding:20px 32px;border-top:1px solid #222;text-align:center">
    <img src="https://restyleproai.com/sproket-rocket-logo.png" alt="RestyleProAI" style="height:28px;margin-bottom:8px" />
    <p style="color:#666;font-size:11px;margin:0">RestyleProAI&#8482; by LoopMighty · WePrintWraps.com Family</p>
    <p style="color:#555;font-size:11px;margin:6px 0 0"><a href="{{unsubscribe_url}}" style="color:#555">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'subscriber-platform-launch',
    name: 'Platform Launch - Subscribers',
    description: 'Launch announcement for email list subscribers with early-bird offer',
    thumbnail: '',
    category: 'announcement',
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <!-- Header -->
  <div style="background:#0a0a0a;padding:40px 32px 0;text-align:center">
    <p style="color:#06b6d4;font-size:13px;letter-spacing:3px;margin:0 0 12px;text-transform:uppercase;font-weight:600">It's Finally Here</p>
    <h1 style="color:#fff;margin:0;font-size:32px;line-height:1.2">The Future of Wrap Sales<br/>Just Went Live</h1>
  </div>

  <!-- Gradient divider -->
  <div style="height:3px;background:linear-gradient(90deg,transparent,#06b6d4,#8b5cf6,transparent);margin:24px 32px"></div>

  <!-- Body -->
  <div style="padding:8px 32px 32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>

    <p style="color:#ccc;line-height:1.7;font-size:15px">You signed up because you knew something better was coming for the wrap industry. <strong style="color:#fff">Today it's here.</strong></p>

    <p style="color:#ccc;line-height:1.7;font-size:15px"><strong style="color:#06b6d4">RestylePro</strong> is the first AI-powered wrap visualization platform built by wrap professionals, for wrap professionals. Show any customer a photorealistic preview of their vehicle wrapped &mdash; any color, any design, any finish &mdash; in seconds.</p>

    <!-- Feature Grid -->
    <div style="margin:28px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td width="50%" style="padding:8px 8px 8px 0;vertical-align:top">
            <div style="background:#111;border:1px solid #222;border-radius:10px;padding:20px;height:100%">
              <p style="color:#06b6d4;font-size:22px;margin:0 0 8px">7+</p>
              <p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 4px">Pro Tools</p>
              <p style="color:#999;font-size:13px;margin:0;line-height:1.4">ColorPro, DesignPro, FadeWraps, GraphicsPro &amp; more</p>
            </div>
          </td>
          <td width="50%" style="padding:8px 0 8px 8px;vertical-align:top">
            <div style="background:#111;border:1px solid #222;border-radius:10px;padding:20px;height:100%">
              <p style="color:#8b5cf6;font-size:22px;margin:0 0 8px">4K</p>
              <p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 4px">AI Renders</p>
              <p style="color:#999;font-size:13px;margin:0;line-height:1.4">Photorealistic quality that closes deals on the spot</p>
            </div>
          </td>
        </tr>
        <tr>
          <td width="50%" style="padding:8px 8px 8px 0;vertical-align:top">
            <div style="background:#111;border:1px solid #222;border-radius:10px;padding:20px;height:100%">
              <p style="color:#d946ef;font-size:22px;margin:0 0 8px">360&deg;</p>
              <p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 4px">Every Angle</p>
              <p style="color:#999;font-size:13px;margin:0;line-height:1.4">Show wraps from 7 camera angles including full spin</p>
            </div>
          </td>
          <td width="50%" style="padding:8px 0 8px 8px;vertical-align:top">
            <div style="background:#111;border:1px solid #222;border-radius:10px;padding:20px;height:100%">
              <p style="color:#06b6d4;font-size:22px;margin:0 0 8px">$0</p>
              <p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 4px">Free to Start</p>
              <p style="color:#999;font-size:13px;margin:0;line-height:1.4">No credit card. Try the full platform free today.</p>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <p style="color:#ccc;line-height:1.7;font-size:15px">Wrap shops using RestylePro are closing deals faster, upselling more finishes, and eliminating costly remakes. You signed up early &mdash; so we're giving you first access.</p>

    <!-- Early Bird Box -->
    <div style="background:#111;border:2px solid #06b6d4;border-radius:12px;padding:24px;text-align:center;margin:28px 0">
      <p style="color:#06b6d4;font-weight:700;font-size:14px;letter-spacing:1px;margin:0 0 6px;text-transform:uppercase">Early Subscriber Bonus</p>
      <p style="color:#fff;font-size:28px;font-weight:800;margin:0">30% OFF Any Plan</p>
      <p style="color:#999;font-size:14px;margin:8px 0 0">For the first 100 subscribers only</p>
      <div style="background:#06b6d4;border-radius:8px;padding:10px 20px;display:inline-block;margin-top:16px">
        <p style="color:#000;font-size:18px;font-weight:700;margin:0;letter-spacing:2px">EARLY30</p>
      </div>
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="https://restyleproai.com/signup" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#fff;padding:16px 36px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Claim Your Spot &rarr;</a>
    </div>

    <p style="color:#999;font-size:14px;text-align:center;line-height:1.6">Join the wrap shops already using RestylePro to win more business.</p>

    <p style="color:#06b6d4;font-weight:600;margin-top:24px">&mdash; Trish &amp; the RestylePro Team</p>
  </div>

  <!-- Footer -->
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">RestyleProAI &middot; restyleproai.com &middot; <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'creatormarket-new-designs',
    name: 'CreatorMarket — New Designs Drop',
    description: 'Showcase hot new wrap designs your customers can buy. You earn commission + print the job.',
    thumbnail: '',
    category: 'marketplace',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#d946ef 0%,#8b5cf6 50%,#06b6d4 100%);padding:40px 32px;text-align:center">
    <p style="color:rgba(255,255,255,0.8);font-size:12px;letter-spacing:2px;margin:0 0 8px;text-transform:uppercase">New This Week</p>
    <h1 style="color:#fff;margin:0;font-size:28px">Fresh Wrap Designs Just Dropped</h1>
    <p style="color:rgba(255,255,255,0.85);margin:12px 0 0;font-size:16px">Production-ready designs starting at $299</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">New designs just hit the marketplace — commercial wraps, exotic restyles, and custom art ready to print. Pick any design, enter your vehicle, and see it rendered in 4K before you buy.</p>

    <div style="margin:24px 0;text-align:center">
      <p style="color:#d946ef;font-size:13px;font-weight:700;margin:0 0 12px">POPULAR THIS WEEK</p>
      <div style="display:inline-block;background:#111;border:1px solid #333;border-radius:12px;padding:16px 24px;text-align:left">
        <p style="color:#fff;font-size:14px;margin:0 0 4px;font-weight:600">🔥 Racing Stripes Collection</p>
        <p style="color:#fff;font-size:14px;margin:0 0 4px;font-weight:600">🔥 Stealth Matte Series</p>
        <p style="color:#fff;font-size:14px;margin:0 0 4px;font-weight:600">🔥 Commercial Fleet Pack</p>
        <p style="color:#fff;font-size:14px;margin:0;font-weight:600">🔥 Carbon Fiber Exotics</p>
      </div>
    </div>

    <p style="color:#ccc;line-height:1.7;font-size:15px">Every design comes with 7 studio-quality renders, production files, and a 2D proof sheet. See it on YOUR vehicle before you commit.</p>

    <div style="text-align:center;margin:32px 0">
      <a href="{{shop_creatormarket_url}}" style="display:inline-block;background:linear-gradient(135deg,#d946ef,#8b5cf6);color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Browse Designs →</a>
    </div>
    <p style="color:#06b6d4;font-weight:600;margin-top:24px;text-align:center">— {{shop_name}}</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">{{shop_name}} · {{shop_website}} · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'creatormarket-vehicle-match',
    name: 'CreatorMarket — Designs For Your Vehicle',
    description: 'Personalized email showing designs available for the customer\'s specific vehicle.',
    thumbnail: '',
    category: 'marketplace',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="padding:40px 32px;text-align:center;border-bottom:2px solid #d946ef">
    <p style="color:#d946ef;font-weight:700;font-size:14px;letter-spacing:2px;margin:0">PICKED FOR YOU</p>
    <h1 style="color:#fff;margin:12px 0 0;font-size:28px">Wraps For Your {{vehicle_name}}</h1>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">Hey {{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">We found designs that look incredible on your {{vehicle_name}}. Each one is production-ready — pick a style, preview it on your exact vehicle in 4K, and we'll handle the rest.</p>

    <div style="background:#111;border:1px solid #333;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
      <p style="color:#d946ef;font-size:20px;font-weight:700;margin:0">Starting at $299</p>
      <p style="color:#999;font-size:13px;margin:8px 0 0">Design + 7 renders + production files included</p>
    </div>

    <p style="color:#ccc;line-height:1.7;font-size:15px">Want something custom? We can design a one-of-a-kind wrap just for your {{vehicle_name}}. Just reply to this email and tell us what you're thinking.</p>

    <div style="text-align:center;margin:32px 0">
      <a href="{{shop_creatormarket_url}}" style="display:inline-block;background:linear-gradient(135deg,#d946ef,#06b6d4);color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">See Designs For My Vehicle →</a>
    </div>
    <p style="color:#06b6d4;font-weight:600;margin-top:24px;text-align:center">— {{shop_name}}</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">{{shop_name}} · {{shop_website}} · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
  {
    id: 'creatormarket-flash-sale',
    name: 'CreatorMarket — Flash Sale',
    description: 'Limited-time discount on wrap designs. Urgency-driven, time-boxed.',
    thumbnail: '',
    category: 'marketplace',
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:#0a0a0a;padding:40px 32px;text-align:center;border-bottom:3px solid #d946ef">
    <p style="color:#d946ef;font-weight:700;font-size:14px;letter-spacing:3px;margin:0">⚡ 48-HOUR FLASH SALE ⚡</p>
    <h1 style="color:#fff;margin:12px 0 0;font-size:36px">25% OFF All Designs</h1>
    <p style="color:#999;margin:8px 0 0;font-size:16px">Ends {{sale_end_date}}</p>
  </div>
  <div style="padding:32px">
    <p style="color:#ccc;line-height:1.7;font-size:15px">{{customer_name}},</p>
    <p style="color:#ccc;line-height:1.7;font-size:15px">For the next 48 hours, every design in our marketplace is 25% off. That's production-ready wraps — 7 studio renders, print files, 2D proof — starting at just $120.</p>

    <div style="background:linear-gradient(135deg,#1a0a2e,#0a1628);border:2px solid #d946ef;border-radius:16px;padding:28px;margin:24px 0;text-align:center">
      <p style="color:#d946ef;font-size:14px;font-weight:700;letter-spacing:1px;margin:0">USE CODE AT CHECKOUT</p>
      <p style="color:#fff;font-size:32px;font-weight:800;margin:8px 0;letter-spacing:3px">WRAP25</p>
      <p style="color:#999;font-size:13px;margin:0">Valid for 48 hours only</p>
    </div>

    <div style="text-align:center;margin:32px 0">
      <a href="{{shop_creatormarket_url}}" style="display:inline-block;background:linear-gradient(135deg,#d946ef,#f97316);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-weight:800;font-size:18px">Shop The Sale →</a>
    </div>
    <p style="color:#06b6d4;font-weight:600;margin-top:24px;text-align:center">— {{shop_name}}</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #222">
    <p style="color:#666;font-size:12px;margin:0;text-align:center">{{shop_name}} · {{shop_website}} · <a href="{{unsubscribe_url}}" style="color:#666">Unsubscribe</a></p>
  </div>
</div>`,
  },
];

// ===== SMS / TEXT MESSAGE TEMPLATES =====
export const SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: 'sms-weprintwraps-promo',
    name: 'WePrintWraps Promo Text',
    description: 'Short promo SMS for WePrintWraps.com customers',
    category: 'promo',
    body: `Hey {{customer_name}}! Trish here from RestylePro. We built an AI tool that shows your wrap customers a photorealistic preview BEFORE you print. WePrintWraps fam gets 40% off first 3 months - code WRAPFAM40 at restyleproai.com/pricing. Free to try, no card needed. Reply STOP to opt out.`,
  },
  {
    id: 'sms-subscriber-launch',
    name: 'Subscriber Launch Text',
    description: 'Launch announcement SMS for email list subscribers',
    category: 'announcement',
    body: `{{customer_name}}, it's live! RestylePro - the AI wrap visualizer you signed up for - is now open. Show customers photorealistic wrap previews in seconds. Early subscriber bonus: 30% off any plan with code EARLY30. See plans: restyleproai.com/pricing. Reply STOP to opt out.`,
  },
];
