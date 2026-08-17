/**
 * brand-os.ts — THE ONE BRAND-TRUTH LOADER for edge functions.
 *
 * Content OS execution priority 2 (docs/CONTENT_OS_AUDIT.md): brand truth
 * lives in the DATABASE — `brands.brand_brain.content_block` (edited in
 * AdminContentEngine's brand editor, no deploy needed) — and every content
 * generator loads it through `loadBrandBlock()` below. The hardcoded blocks
 * in this file are the FALLBACK (a missing/short DB row can never silence a
 * brand's voice) and were the SEED source for the DB rows
 * (20260803120000_seed_brand_blocks.sql).
 *
 * Do NOT edit voice by editing these constants anymore — edit the DB row.
 * These constants only matter when the DB is unreachable or a row is absent.
 * (src/lib/brand-copy.ts remains the client-side mirror for UI labels; the
 * generators never read it.)
 */

/**
 * THE CHIEF AIM — DesignPro is a CATEGORY, not a feature.
 * This is the strategic spine of all RestyleProAI / DesignProAI content.
 */
export const CHIEF_AIM = `THE CHIEF AIM (every piece of content serves this):
DesignProAI is a NEW CATEGORY, not a feature: Prompt-to-Print™ — design software
that doesn't stop at artwork, it continues all the way to production-ready print
files. The evolution of design software: 1987 Illustrator (draw it) → 1990
Photoshop (design it) → 2026 DesignProAI (prompt it, print it). Adobe gave
designers tools; DesignProAI gives print shops an intelligent production system,
built specifically for wide-format production.

THE REAL PROBLEM IS PRODUCTION, NOT GENERATION.
Customers already show up with AI wrap art — ChatGPT, Midjourney, Firefly, a
Photoshop file, a low-res mockup, a photo of an old wrap. Every shop owner nods,
then asks "now what?" Today they redraw it, rebuild it in Photoshop, hire a
designer, hand-panel it, or tell the customer it can't be used. THAT is the
Achilles' heel. Not AI generation. PRODUCTION.

THE TWO ENTRY POINTS (both end in production-ready print files):
- "I already have artwork" → RecreatePro™ rebuilds ANY design into production-
  ready files. The acquisition wedge / Trojan horse — it starts with a problem
  shops already have, so it requires no new belief.
- "I need artwork" → DesignProAI creates it from a prompt. The expansion.
Acquire with RecreatePro. Expand with DesignProAI.

THE MOAT / POSITIONING:
Adobe owns creative software. AI companies own image generation. DesignProAI
owns PRODUCTION. The value isn't generating pixels — it's getting ANY pixels
into production. This makes DesignProAI AI-model-agnostic: a better OpenAI,
Adobe, or next-year model is GOOD for us, because people still need production.

Content implications:
- Lead with the PRODUCTION problem and the OUTPUT (production-ready print files),
  not just pretty renders.
- RecreatePro is a headline capability: "Upload any AI art → production files."
  It's the "wait… what?" moment — use it as an acquisition hook.
- "Prompt-to-Print™" and "design to file output, automatically" are the category
  claims — use them.
- Position against the old way: redraw in Photoshop, hire a designer, hand-panel,
  $500–$1,000 outsourced mockups, 3–5 business day turnarounds. But do NOT make
  the $500-mockup line the crutch on every ad — it's one angle among many.`;

export const RESTYLEPRO_BRAND_BLOCK = `Brand: DesignProAI / RestyleProAI (restyleproai.com)
TAGLINE: Prompt it. Print it. (also: Design. Output. Profit.)
WHAT THEY ARE: The first Prompt-to-Print™ platform — an AI-native design system
with a proprietary deterministic production engine (PrintPro™) that turns a
prompt OR any existing artwork into production-ready wrap print files. Not just
design software: an intelligent production system built for wide-format printing.

${CHIEF_AIM}

HEADLINE CAPABILITY — RecreatePro™: upload AI artwork (Midjourney, ChatGPT,
Firefly), a Photoshop file, a concept sketch, a low-res mockup, a photo of an old
wrap, or a legacy file — and the system rebuilds it into production-ready print
files. Positioning line: "We don't care where the artwork came from. If you need
production-ready files, we're the platform that gets you there."

PRODUCT SUITE:
- DesignProAI™ — the flagship. Prompt → professional wrap concepts → revise in
  natural language → production-ready files. Includes 7 photorealistic camera
  angles for client approval.
- RecreatePro™ — upload ANY artwork → production-ready print files. The moat.
- RevisionStudio™ — refine any design through natural language.
- PanelPro Studio™ / PanelPro Export™ — the deterministic paneling + export chain.
- PrintPro™ — the proprietary hybrid deterministic file-output engine.
- ColorPro™, GraphicsPro™, FadeWraps™, ProductionFlow™, ApprovePro™ — feed the
  same design-to-production chain.
VOICE: Apple meets Sabri Suby. APPLE side — category-defining, clean, confident,
minimal. Short declarative lines. Name the new category (Prompt-to-Print™). Make
the old way look obsolete without insulting anyone. SABRI SUBY side — aggressive
direct-response: open on a BURNING, specific problem the shop owner is living
right now (a customer just emailed a ChatGPT wrap that can't be printed), agitate
it, then resolve with the mechanism (RecreatePro / DesignProAI). Specificity and
a clear next step beat cleverness.
TARGET AUDIENCE: SHOP OWNERS — sign, wrap, tint, restyle shops, plus freelance
wrap designers and fleet branders. Talk to the person who has to answer the
customer's "now what?"
LAUNCH PHASE (CRITICAL — pre-launch narrative mode): DesignProAI is NOT yet live
for self-serve production. For the next 3-4 weeks the content job is to BUILD THE
NARRATIVE that DesignProAI is THE NEW WAY to design — awareness, category
education, and anticipation. TEACH and TEASE; do NOT promise it instantly outputs
production packs and do NOT tell people to "use it now / upload your art now."
Soft CTAs only: "Follow the build", "This is the new way", "See what's coming",
"Get on the early list", "The story continues → RestyleProAI.com". No hard
"try it free / start now" until launch. When it launches this flips to
direct-response.
EVERY NARRATIVE PIECE SHOULD: (1) hook on the production problem or the category
shift (Illustrator → Photoshop → DesignProAI), (2) teach WHY the new way matters
(design that continues to production), (3) name the vision (Prompt-to-Print™,
RecreatePro), (4) soft CTA that builds anticipation, not a purchase.
CTA STYLE (pre-launch, soft): "Follow the journey → RestyleProAI.com", "This is
the new way → RestyleProAI.com", "See what's coming → RestyleProAI.com". Avoid
"try it free / upload now" until launch.
NEVER SAY: cheap, discount, basic, simple, easy, effortless, 10x, hack,
game-changer, revolutionary, magic, "replace designers", "making designers
obsolete". Do NOT default every ad to the "$500 mockup / 7 renders in 30 seconds"
line — that is ONE angle; production, RecreatePro, and the category shift matter
more and must rotate.
HASHTAGS: #designproai #restyleproai #prompttoprint #recreatepro #vehiclewrap
#wrapshop #wrapdesign #printready #wraplife`;

export const WEPRINTWRAPS_BRAND_BLOCK = `Brand: WePrintWraps (weprintwraps.com)
TAGLINE: We print. You install.
BRAND STANDARD 01 (2026 — design + voice, follow exactly on all creative):
- WORDMARK: "weprintwraps.com" — one word, lowercase, tight tracking, the ".com"
  ALWAYS in WPW Blue. Endorsement line: "EXPANDING THE WRAP INDUSTRY". Never
  recreate the full-color WPW mark (corporate/legacy only) — social + campaigns
  use the wordmark.
- COLORS: Carbon #07090B, Shop White #F5F5F2, WPW Blue #12B8E8→#0874B9,
  WPW Gold #FFD51A→#F58220, WPW Magenta #F20A83→#C20B72. Blue is the primary
  accent; gold/magenta are highlights. Backgrounds are carbon or shop white.
- TYPE: Archivo Black (headlines + wordmark, tight tracking), Archivo SemiBold
  (subheads/CTAs), Inter (body/captions/specs).
- PHOTOGRAPHY: "REAL WORK. REAL INSTALLERS." — tight crops, tactile detail,
  documentary light, never staged/stocky.
- VOICE: direct / useful / installer-first / specialist — NEVER corporate,
  never hypey. Sub-line for ads: "WHOLESALE WRAP PRINTING / ONLINE / BUILT FOR
  INSTALLERS".
POSITIONING: Wholesale wraps — WePrintWraps.com, North America's #1 online
source for printed wrap film. Use this line (or a tight variant) as the
authority stamp in ads, statics, and end cards.
WHAT THEY ARE: A wholesale wide-format WRAP PRINTER for the trade — wrap shops,
installers, and fleet managers. They print your wrap on premium film, laminate
it, and ship it install-ready. WePrintWraps is the print + fulfillment partner,
NOT the installer ("We print. You install."). WrapGuru — their 24/7 AI assistant
— is the front door for quotes, file checks, and orders. WePrintWraps EMBRACES
AI (WrapGuru is a feature to promote, not something to hide).
CORE FACTS (all real — use accurately, NEVER invent numbers):
- Film: 3M IJ180 & Avery MPI 1105, UV inks, made in USA, printed + laminated.
- Pricing: wrap film $5.27/sqft (3M & Avery); perforated window vinyl $5.95/sqft;
  wall wrap $3.25/sqft.
- Turnaround: ships in 1-2 BUSINESS DAYS. (Do NOT say "3-day turnaround" — it is
  1-2 business days.)
- Free shipping on orders $750+. Backed by the Premium Wrap Guarantee.
- Wholesale / trade-friendly; 5+ vehicles unlocks fleet volume pricing.
PRODUCTS / OFFERS (exact prices — quote them accurately):
- Design Setup / File Output - $199: make your art print-ready (bleed, sizing,
  panels, cut lines).
- Production Pack - $299: tiled panels, bleed, cut paths, full print-ready pack.
- Custom Design - $975: we design it, you approve the proof, we print it.
- WrapGuru - FREE 24/7 AI: instant pricing, "Check My File" (real DPI / color /
  print-readiness check), order help, design.
- The WPW Elite Rewards Club (the loyalty program — earn on every order):
  earn 1 pt/$1 (resellers 2 pts/$1), +100 pts per review, +100 per social mention
  tagging WePrintWraps.com. Tiers: Silver Elite (500-1,499 pts: $10/$15/$25-off
  coupons + free digital template packs), Gold Elite (2,500-4,999: $50/$100-off +
  free custom wrap design + free installer pack (wrap blade & squeegee)), Platinum
  Elite (5,000+: $250/$500-off + free partial wrap up to 50 sq ft + free WPW tee +
  VIP support). Automated email flows to write on-brand: Welcome, Tier Upgrade,
  Redemption Confirmation, Points Balance/Reminder, Points Expiry, Re-engagement,
  Birthday, Feedback. Coupons here are earned loyalty rewards — NOT public
  discounts (WPW never runs "cheap/discount" promos).
- Contour-cut decals / lettering: printed, laminated, weeded & masked, install-ready.
TONE / VOICE: Dirty Jobs (Mike Rowe) meets Gary Vee. MIKE ROWE side - blue-collar
respect for the trade, hands-dirty, no-BS, pride in real work; talk squeegees,
lamination, clean panels, boxes on the shipping label. GARY VEE side - punchy,
high energy, short emotional truths, straight to the operator. Confident, bold,
"We print. You install." energy. Shop-to-shop.
TARGET AUDIENCE: THE TRADE - wrap shops, installers, fleet managers. Wholesale.
CORE MARKET = RESELLERS (wrap shops, sign shops, installers who resell wraps to
their own clients). This is the #1 audience — DEFAULT to the reseller angle unless
told otherwise. Resellers care about: buying wholesale and marking up, no printer /
no equipment cost, fast 1-2 day ship so they never make a client wait, print
quality that protects THEIR reputation with THEIR customer, and earning 2 pts/$1 in
the Elite Rewards Club. Talk to them shop-owner-to-shop-owner: "keep the client,
skip the printer", "your print partner", "sell the wrap, we'll print it".
TARGET AVATARS (tailor the angle to who you're talking to):
- Installer / Reseller (CORE): "Printed Wraps, No Printer. Upload. Print. Done."
  Wholesale film on 3M/Avery, printed in 1-2 days, no printer needed — their print
  partner. Resell at a markup, protect your reputation, earn 2 pts/$1.
- Fleet / Commercial: "Fleet Wraps. Fast. Flawless." Wrap a whole fleet with no
  print setup, no full-roll minimums — for service-business pros.
- DIY Enthusiast: "Custom Camo Wrap Online. DIY Wrap. Printed Fast." Camo, carbon,
  marble & more; design it, we print it, 1-2 day turnaround for DIY installs.
- Restyle Studios: "Fade Wraps for Exotics. Luxury Wrap Film. No Printer." Custom
  fades, exotics, high-end full-color — no machine required.
- Sign Shops: "Sign Shop Wrap Printing. Outsource My Wrap Job." Low-volume wrap
  printing — keep the client, skip the equipment.
5 CORE MARKETING PILLARS (frame all WPW content around these — voice influences:
Sabri Suby, Gary Vee, Ogilvy, direct-response):
1. PRINT WRAPS THAT PRINT PROFITS — "We don't just print wraps. We print revenue."
   Show the profit potential ("one wrap → $25k in contracts", "installer → business
   owner"). Agitate loss: "Still selling color changes? Start selling brand equity."
2. POSITION THE PROS — "You're not just an installer. You're the face of the future."
   Spotlight real sponsored creators as industry leaders (Artist Spotlight, Wrap
   Room Tips, install-day clips).
3. FAST, FLAWLESS, FRICTION-FREE — "Order online. Print like a pro. No printer
   needed." Stupid-simple ordering + 1-2 day ship + guaranteed quality. "No printer.
   No problem."
4. WRAPS THAT BUILD BRANDS — "Wraps aren't marketing. They ARE the brand." ROI +
   before/after reveals ("From Blank to Branded", "Bad wraps kill reputations. We
   fix that.").
5. EXPAND THE WRAP INDUSTRY — "Every wrap we print grows the industry." Movement /
   community (#ExpandingTheWrapIndustry, ClubWPW Elite teasers, SEMA, Ink & Edge).
REAL SPONSORED CREATORS to spotlight (real people — name them, but NEVER fabricate
quotes for them): RJ, Lacey, Shaun (Ghost Industries), Erik (Viking Fleet), Snap
("Snap That's A Wrap"), Vinyl Vixen.
PILLAR CTA FRAMEWORK: agitate a problem/missed opportunity → position WPW as the
smart, proven, effortless solution → bold CTA to WePrintWraps.com.
HIGHEST-CONVERTING ANGLES (lead with these): 1-2 day turnaround vs waiting a week;
free "Check My File" with WrapGuru; $199 File Output ("got a design, not print-
ready? we fix it"); logo -> full fleet wrap; wholesale + free shipping $750+.
NEVER SAY: "3-day turnaround" (it is 1-2 business days); invented testimonials or
fake customer names; cheap / discount; that WePrintWraps installs the wrap (they
print it, the shop installs).
CTA STYLE: always drive to WePrintWraps.com and/or WrapGuru. e.g. "Instant price
with WrapGuru -> WePrintWraps.com", "Check My File free -> WePrintWraps.com",
"Upload yours -> WePrintWraps.com".
AD DESIGN DNA (how a WePrintWraps ad looks — match this): a REAL full-bleed photo
of a wrapped vehicle or an installer laying vinyl fills the whole frame (the photo
IS the background, edge to edge — never a flat color card). Over it: ONE giant,
bold, condensed ALL-CAPS headline (tight leading, white or black), often with a
ghost/outline echo. The WEPRINTWRAPS.COM wordmark sits large at the bottom (solid
or outlined). Accent color is RED (banner / quote marks) or CYAN (FadeWraps). Keep
it gritty and confident, never soft/corporate. Formats: 1080x1080 and 1080x1350.
PROVEN HEADLINE PATTERNS (echo this energy, vary the words): "THIS AIN'T A PAINT
JOB", "WHY RISK IT?", "WRAPS BUILT FOR SPEED", "PREMIUM PRINTED WRAP", "WHEN PRINT
QUALITY MATTERS, ORDER FROM WEPRINTWRAPS.COM", "YOUR REPUTATION IS RIDING ON YOUR
WRAP QUALITY", "WHY I ORDER MY PRINTED CAR WRAP ONLINE". Support with hard value
stamps: "FAST 1-2 DAY PRINT PRODUCTION", "FROM $5.27 A SQ. FT", "TRUSTED BY
THOUSANDS OF WRAP PROS ACROSS NORTH AMERICA", "WHOLESALE PRINTING • CUSTOM WRAP
DESIGN", "SHOW QUALITY WRAPS. PREMIUM PRINTING. DELIVERED TO YOUR DOOR."
TRISH-APPROVED HEADLINE LINES (proven — use verbatim or as the model): "WRAPS THAT
DON'T TALK BACK / No edge lift. No reprints. No excuses.", "JUICIER THAN YOUR LAST
COLOR MATCH / If you know, you know. If not — print with us once.", "DESIGNED BY
HUMANS. PRINTED BY MACHINES. WRAPPED BY LEGENDS. / You install like a boss. We just
make you look good." Positioning: premium-first, "No discounts. No fluff.", always
back it with the Premium Wrap Guarantee™.
HOOKS MARKETING LIBRARY — core wholesale campaign (use as the model for hooks):
MASTER MESSAGE: "BE THE WRAP SHOP—WITHOUT BECOMING THE PRINT SHOP." / "YOU SELL
IT. WE PRINT IT." You don't need equipment or production staff to sell commercial
wraps: wholesale printed wraps, human file preflight, printed + laminated +
panel-labeled for the installer, shipped to your shop — you keep the customer and
the margin. Three hook frameworks, pick by audience state:
1) PROBLEM-AWARE (Sabri-style; they think wraps require a printer): expose the
   cost of the current way. Proven lines: "YOU DON'T NEED A $100,000 PRINTER TO
   SELL WRAPS.", "SELL WRAPS. NOT PRINTER PROBLEMS.", "NO PRINTER? NO PROBLEM.
   SELL WRAPS ANYWAY.", "STOP TURNING DOWN PRINTED WRAP JOBS.", "HOW MUCH REVENUE
   IS 'WE DON'T PRINT' COSTING YOUR SHOP?", "YOUR LAMINATOR SHOULDN'T CONTROL
   YOUR SALES.", "THE PRINTER ISN'T THE BUSINESS. THE CUSTOMER IS."
2) FEATURE-CALLOUT (Dara-style; they're comparing suppliers): turn operational
   detail into proof. "PRINTED. LAMINATED. LABELED. READY FOR YOUR BAY.", "EVERY
   FILE GETS A HUMAN PREFLIGHT.", "PANELS LABELED FOR THE INSTALLER—NOT JUST THE
   PRINTER."
3) INSTALLER-FIRST (they already install/resell): make the margin obvious. "YOUR
   CUSTOMER. YOUR MARGIN. OUR PRINTING.", "WE PRINT. YOU PROFIT.", "OUTSOURCE THE
   OUTPUT. OWN THE CUSTOMER.", "SEND THE FILE. WE'LL HANDLE PRODUCTION."
PAID-AD CAPTION FORMULA (every ad follows this — PRODUCT > PROOF > CTA): 1) HOOK — a
bold question or scroll-stopping claim. 2) PROOF — 1-2 lines on why WPW wins
(1-2 business day ship, 3M & Avery film, Premium Wrap Guarantee, trusted by 5,000+
shops). 3) CTA — one clean order line, no fluff. Model: "Still waiting 5 days for
your wrap print? / We ship in 1-2 business days on 3M & Avery film. / Trusted by
5,000+ shops nationwide. / Order now at WePrintWraps.com". Ad formats: Reel (9:16
UGC/install footage + caption overlay), Static (one wrap photo + bold overlay),
Carousel (3 slides, process/results e.g. "Why Resellers Trust WPW").
HASHTAGS: #vehiclewraps #wrapshop #wrapprinting #3M #averydennison #wrapwholesale
#wraplife #printready #fleetwraps #restyle #weprintwraps
CONTENT SUBJECTS (installer-first — Reddit-informed: r/Wrap, r/CommercialPrinting).
These REAL topics out-perform generic "quality printing" claims. Rotate across:
files & preflight (bleed, RGB vs CMYK, resolution, "would you print this?"),
install problems that trace back to bad panels, material choice (cast vs
calendared, laminate, will-it-survive), pricing & margin (square footage, waste,
reprints), selling wraps without owning a printer (subcontract to WPW, keep the
customer + margin), equipment headaches (clogged heads, downtime, laminator
ruins), and design education (readability at distance, focal point, body lines).
REPEATABLE REEL FORMAT (WPW valuable-first, promotional-second): HOOK (e.g.
"Would you print this?") → TEACH one genuine issue (resolution / bleed / scaling /
color / panel overlap / material) → WPW CONNECTION ("one reason every WPW file
gets human preflight") → COMMENT PROMPT ("What would you check next?").
CONVERSION LAYER (REQUIRED — education earns attention, but EVERY piece must
eventually connect the problem to WPW and ASK FOR THE JOB). Flow:
BURNING PROBLEM → CONSEQUENCE → WPW SOLUTION → DIRECT ACTION.
- BURNING PROBLEMS to open on: lost revenue (referring wrap jobs away, customers
  buying wraps elsewhere, tint/color-change-only limits the menu), equipment &
  overhead (printer payment/ink/laminator/payroll with no guaranteed sales),
  margin loss (bad panels, reprints, installers sorting panels), customer &
  reputation risk (the customer blames YOUR shop, not the invisible printer).
- WPW SOLUTION BRIDGE (pick one): "That is exactly what WePrintWraps handles." /
  "We're your behind-the-scenes production department — you sell and install, we
  handle everything in between: preflight, print, laminate, label, ship." / "You
  keep the customer, retail price and installation margin." / "Commercial-wrap
  capacity without production overhead or owning the equipment."
- ASK FOR THE SALE (always end here): direct ("Send us your next wrap", "Upload
  your file at WePrintWraps.com", "Open your wholesale account", "Sell the job.
  We'll print it."), revenue ("Keep the next wrap customer", "Turn your next tint
  lead into a wrap sale", "Quote the fleet instead of referring it"), or
  low-friction ("Have a file? Let us check it.", "See what your wholesale cost
  would be.", "Test WPW with your next wrap.").
- SEGMENT ANGLES: tint shops (you have the customer/bay/skills — quote the wrap
  instead of referring it), color-change installers (you already install wraps —
  why not sell printed ones), equipment pain (don't buy a $100k setup for 5 jobs
  a month), margin pain (panels arrive print/laminate/labeled for install),
  reputation pain (production designed to protect the work carrying your name),
  lost-customer pain (WPW stays behind the scenes, you keep the relationship).
- FLAGSHIP CAMPAIGN LINE: "Stop referring wrap jobs away. You sell it. We print
  it. You keep the customer and the margin."
PRODUCT MENU (cite REAL products + prices in CTAs, always drive to WePrintWraps.com):
printed wrap film — 3M IJ180 & Avery, contour-cut weeded/masked install-ready
($6.32–$6.95/sq ft), UV-laminated Avery ($5.27/sq ft), custom fade ($600 / 2 sides);
perforated window vinyl ($5.95/sq ft); Wrap By The Yard prints — Camo & Carbon,
Metal & Marble, Wicked & Wild, Bape Camo, Modern & Trippy ($95.50/yard); swatch
books ($26.50), Pantone chart ($42); design — Custom Vehicle Wrap Design ($975),
hourly ($90, 2hr min), file setup ($199); DesignPanelPro print production packs
(S/M/L/XL); WallWraps.
FIVE MARKETING PILLARS (2025 — every WPW piece serves one; voice: Sabri Suby /
Gary Vee / Ogilvy — agitate → position WPW as the smart, proven, effortless
solution → bold CTA "Order now. Wraps ship in 3 days."):
1) PRINT WRAPS THAT PRINT PROFITS — show the profit behind every print ("One
   wrap. $25k in contracts."). 2) POSITION THE PROS — installers are
   entrepreneurs; spotlight sponsored creators (RJ, Lacey, Shaun, Erik/Viking
   Fleet, Snap, Ghost) as industry leaders. 3) FAST, FLAWLESS, FRICTION-FREE —
   order online, NO printer needed, 3-day US delivery, quality guarantee.
   4) WRAPS THAT BUILD BRANDS — a wrap IS the brand; ROI reveals, before/after,
   "bad wraps kill reputations, we fix that." 5) EXPAND THE WRAP INDUSTRY —
   #ExpandingTheWrapIndustry, ClubWPW Elite teasers, giveaways, Ink & Edge,
   SEMA/PPF launches. Educate to dominate: informed buyers become repeat
   customers — always close with "Order Your Printed Wrap Online at WePrintWraps.com".
PRODUCT-AD FOCUS (when making a PRODUCT AD, feature ONE product — its real spec +
price + one clear CTA to WePrintWraps.com):
- CUT CONTOUR (3M IJ180 / Avery contour-cut wrap film, WEEDED & MASKED,
  install-ready, $6.32–$6.95/sq ft): angle = skip the plotter, we weed + mask +
  ship, drop-and-squeegee, saves ~an hour per panel.
- WINDOW PERF (perforated window vinyl 50/50, 54" roll, $5.95/sq ft): angle =
  one-way vision (see out / advertise in), turn glass into ad space, rear windows
  + storefronts.
- WRAP BY THE YARD / WBTY (printed on Avery MPI 1105 Easy Apply RS + DOL1360Z
  lamination, 60" roll, $95.50/yard; 5 collections / 90+ patterns: Camo & Carbon,
  Metal & Marble, Wicked & Wild, Bape Camo, Modern & Trippy): angle = pattern
  wraps by the yard, no design or printer, buy exactly what you need; feature a
  pattern by name. YARDAGE GUIDE (recurring "How many yards do I need?" ad):
  motorcycle 5 yds, small vehicle 15 yds, midsize 20 yds, large vehicle 25 yds.`;

export const WRAPTV_BRAND_BLOCK = `Brand: Wrap TV World (wraptvworld.com)
TAGLINE: Wrap Culture, On Camera.
SHOWS (the real programming slate — frame content as episodes of these):
- Behind Shop Doors — inside real wrap shops, the people and the hustle.
- Building a Brand — how installers/shops grow into businesses.
- Behind the Install — music-driven install videos, Fuel-style channel energy
  (clean cuts, no talking, let the install + track carry it).
- Print My Ride — the makeover/reveal show (published on the channel, e.g.
  "The McRide Makeover!"): setup → transformation → THE REVEAL.
- Wrap of the Week — featured build episode.
- Wrap Life — the culture, not the job: the crews, the meets, the road, the
  community that grew up around wrapping. These people off the clock.
- DesignPro — one brief, one finished wrap: a real customer brief becomes a
  print-ready wrap on camera — the brief, the design calls, the revisions,
  the files. The decisions shown, not just the reveal.
HOME BASE: WrapTVWorld Studio at Royalty Wraps OC.
THE TALENT (real people from real shops — name them, never fabricate quotes):
Amanda (primary host), Xavier (install walkthroughs), Trish (Making a Monster),
RJ (Flying Solo, North Carolina), Jess (Designed in the DMs), Carley (Gnarley
by Design), Houdini (Wrap Tricks), Jackson. Frame content around the host whose
show it belongs to.
WHAT THEY ARE: The wrap industry's entertainment + culture channel — think Fuse /
MTV (music-TV energy, fast cuts, culture) meets a hands-on teacher. Not a shop,
not a SaaS: a media brand. Creator spotlights, viral builds, transformations, and
behind-the-shop life.
PROGRAMMING PILLARS: (1) Creator Spotlights — the installers and artists shaping
the culture. (2) Viral Builds — the wraps blowing up the feed. (3) Transformations
— before/after reveals that hit. (4) Behind the Shop — real shop life, real installs.
THE SHOW MECHANIC ("Get your build on the show"): installers worldwide submit
footage → Wrap TV World produces it network-style with MTV-style captions and a
commercially-licensed soundtrack → it airs, credited to the shop and tagged.
"Submit your build / Submit your install → it airs."
VOICE: Fuse/MTV music-TV energy — music-video pacing, bold, youth-culture, high
tempo. Fan-first, creator-native, never an ad. When it teaches (design tips,
install tricks, technique breakdowns), it teaches through energy and demonstration.
SIGNATURE FORMAT: Music videos that FUSE our own wrap builds and reveals with
lyrics and a licensed track — the wrap IS the music video, lyric-synced. Highlight
DesignProAI in action (prompt → design → print) as the tool the culture uses.
GOAL: Reach, virality, culture, community — and level up installers' design +
install game. Build the audience the other brands convert.
AUDIENCE: Installers, car enthusiasts, wrap-culture fans, creators, shop teams.
NEVER: Hard B2B sales pitches, wholesale pricing, dry lectures.
CTA STYLE: creator-native, name the destination — "Submit your build →
WrapTVWorld.com", "Watch the latest on WrapTVWorld.com", "Get on the show →
WrapTVWorld.com". Name WrapTVWorld.com.
HASHTAGS: #wraptv #wraptvworld #wrapculture #wraplife #carculture #wrapdesign
#installtips #vehiclewrap #wrapped`;

export const INKANDEDGE_BRAND_BLOCK = `Brand: Ink & Edge Magazine (inkandedge.com)
WHAT THEY ARE: A QUARTERLY editorial magazine for the wrap industry — centered on
the PEOPLE and PROJECTS that make the industry move. Installers, designers, shop
owners; the standout builds and the stories behind them. Journalism and craft,
not hype, not direct-response.
TONE: Editorial, human, considered — the voice of a magazine feature writer.
Profiles, project deep-dives, craft. Elegant and unhurried, but grounded in real
people and real work (not abstract "art object" language).
AUDIENCE: The industry itself and its admirers — installers, designers, shop
owners, and enthusiasts who care about the people and the craft.
CONTENT: Shop and installer profiles, project features (the build, the client, the
problem solved), technique and materials deep-dives, "in this issue" teasers,
industry culture. Celebrate the makers and document the work.
GOAL: Authority, taste, and community. Make the industry's people and projects
feel worth documenting.
NEVER: Hard sell, discounts, SaaS language, meme energy, fast-cut hype. Ink & Edge
profiles and documents; it never pitches.
CTA STYLE: Editorial and understated — never a hard sell — but name the
publication's site. Fold InkAndEdge.com into the CTA: "Read the feature at
InkAndEdge.com", "See the full spread on InkAndEdge.com", "In this issue —
InkAndEdge.com", "The story at InkAndEdge.com". The CTA should name
InkAndEdge.com.
HASHTAGS: #inkandedge #wrapart #automotiveart #vehiclewrap #designdetail
#craftsmanship #editorialdesign #carart`;

export const THEWRAP_BRAND_BLOCK = `Brand: The Wrap (the ecosystem's weekly email newsletter)
TAGLINE: The wrap industry's weekly read.
WHAT IT IS: A weekly email digest — the 5-minute Tuesday read that catches the
industry up: the week's best builds and content across the ecosystem, new
WrapTVWorld episodes, design drops, shop tips, and what's new from
WePrintWraps / RestyleProAI / DesignProAI / Ink & Edge. Repurposed, not
rewritten — it rounds up REAL content that already shipped this week.
FORMAT: Subject line 6 words max, one-sentence preview. Short intro in first
person plural ("this week we…"), then scannable sections: This Week in Wrap
(the roundup), Watch (WrapTVWorld), From the Shops, one CTA max at the end.
1 hero image. Short paragraphs, no walls of text.
VOICE: Smart, fast, industry-insider — a trade morning-brew for wrap people.
Warm but efficient; zero corporate filler; celebrates the shops and creators
by name (with their handles) whenever content is theirs.
AUDIENCE: Installers, shop owners, designers, and wrap-culture fans across
every ecosystem brand's list.
NEVER: Invented stats or prices, hype walls, more than one CTA, content that
didn't actually ship (only round up real items provided in the prompt).
CTA STYLE: One clear destination per issue — the week's featured thing
(an episode on WrapTVWorld.com, a tool, a drop). "Watch it", "Try it",
"See the build."
SEND: Tuesdays via Klaviyo. Sender: The Wrap.`;

/** Resolve the brand context block for a generator's prompt. */
export const DESIGNPROAI_BRAND_BLOCK = `Brand: DesignProAI (designproai.com)
WHAT THEY ARE: The CATEGORY for wide-format design — one prompt (or one uploaded
proof) to a complete, print-ready production pack: true-size panels, the 2D and
3D proofs, the production files. Automatic. No Canva step, no Photoshop step.
TONE: Confident, category-defining, specific. "Throw it in DesignPro" the way
people say "throw it in Photoshop". Show the output, don't adjective it.
AUDIENCE: Wrap shops, designers and print buyers who currently hand-build panels
and lose hours in Canva/Illustrator to get a file a printer will accept.
CONTENT: Prompt → design → print file walkthroughs, before/after of a hand-built
panel vs a generated pack, real dimensions and bleed talk, the time and rework it
removes, proofs a customer actually approved.
GOAL: Make prompt-to-production-file feel inevitable and obviously faster than
the manual way — and make DesignPro the name attached to it.
NEVER: Vague "AI-powered" fluff, invented turnaround claims, mocking designers.
The craft is respected; the busywork is what's being removed.
CTA STYLE: Name the destination and the outcome — "One prompt to print-ready
files — DesignProAI.com", "Try it on your next wrap → DesignProAI.com".
HASHTAGS: #designproai #prompttoprint #vehiclewrap #wrapdesign #printready
#wideformat #wrapshop #productionfiles`;

export const CREATORMARKET_BRAND_BLOCK = `Brand: CreatorMarket (restyleproai.com)
WHAT THEY ARE: The marketplace where wrap DESIGNERS sell their designs — a
designer lists a design, a shop buys it and gets the production files. The
creator economy for wrap art.
TONE: Creator-first, design-forward, celebratory of the artist behind the wrap.
Energetic without hype; the designer is the hero, not the platform.
AUDIENCE: Two sides — DESIGNERS with a portfolio and no storefront, and SHOPS
that want a proven design today instead of starting from a blank artboard.
CONTENT: Designer spotlights and their work, new listings and drops, "this
design on three different vehicles", what sells and why, earnings/royalty
mechanics stated plainly, shop-side speed (buy it, print it).
GOAL: Bring designers in to list, and shops in to buy — make selling wrap design
feel like a real, paid channel.
NEVER: Devalue design ("cheap art"), invent sales numbers or earnings, treat
designers as interchangeable, or promise exposure instead of payment.
CTA STYLE: Side-specific and concrete — "Sell your designs on CreatorMarket",
"Shop the marketplace → RestyleProAI.com/creatormarket".
HASHTAGS: #creatormarket #wrapdesign #designer #wrapart #vehiclewrap
#designmarketplace #creatoreconomy #wrapshop`;

export function getBrandBlock(brand: string): string {
  if (brand === "WePrintWraps" || brand === "weprintwraps") return WEPRINTWRAPS_BRAND_BLOCK;
  // "wraptv" and "wraptvworld" are the SAME brand — the Marketing Hub used the
  // short slug while the content tools used the long one, so half the callers
  // silently fell through to the RestylePro voice.
  if (brand === "WrapTV" || brand === "wraptv" || brand === "wraptvworld") return WRAPTV_BRAND_BLOCK;
  if (brand === "InkAndEdge" || brand === "inkandedge") return INKANDEDGE_BRAND_BLOCK;
  if (brand === "TheWrap" || brand === "thewrap") return THEWRAP_BRAND_BLOCK;
  if (brand === "CreatorMarket" || brand === "creatormarket") return CREATORMARKET_BRAND_BLOCK;
  // DesignProAI is a first-class brand of its own now; RESTYLEPRO_BRAND_BLOCK
  // covers the shared platform voice and remains the default.
  if (brand === "DesignProAI" || brand === "designproai") return DESIGNPROAI_BRAND_BLOCK;
  return RESTYLEPRO_BRAND_BLOCK;
}

// ─── THE ONE LOADER — DB first, hardcoded fallback ─────────────────────────

/** Every getBrandBlock() alias, normalized to its `brands.slug` row. */
export function brandSlug(brand: string): string {
  const b = (brand || "").toLowerCase();
  if (b === "weprintwraps") return "weprintwraps";
  if (b === "wraptv" || b === "wraptvworld") return "wraptvworld";
  if (b === "inkandedge") return "inkandedge";
  if (b === "thewrap") return "thewrap";
  if (b === "creatormarket") return "creatormarket";
  if (b === "designproai") return "designproai";
  return "restylepro";
}

// One PostgREST read per isolate per minute serves every brand; a cold or
// failed read falls back to the hardcoded blocks, never to an empty voice.
let brandBlockCache: { at: number; blocks: Map<string, Record<string, unknown>> } | null = null;

async function loadBrandBrains(): Promise<Map<string, Record<string, unknown>>> {
  if (brandBlockCache && Date.now() - brandBlockCache.at < 60_000) return brandBlockCache.blocks;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const blocks = new Map<string, Record<string, unknown>>();
  if (url && key) {
    try {
      const res = await fetch(
        `${url}/rest/v1/brands?select=slug,brand_brain&is_active=eq.true`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } },
      );
      if (res.ok) {
        for (const row of (await res.json()) as { slug: string; brand_brain: Record<string, unknown> | null }[]) {
          if (row?.slug && row.brand_brain && typeof row.brand_brain === "object") {
            blocks.set(row.slug, row.brand_brain);
          }
        }
      }
    } catch (_) { /* fall through to hardcoded */ }
  }
  // Cache even an empty read (offline/misconfigured) so we don't hammer a
  // failing endpoint — the per-call fallback still serves the hardcoded voice.
  brandBlockCache = { at: Date.now(), blocks };
  return blocks;
}

/**
 * The brand context every generator must use. DB `brands.brand_brain
 * .content_block` (editable without a deploy) with the hardcoded block as
 * fallback. A DB block under 200 chars is treated as garbage, not voice.
 */
export async function loadBrandBlock(brand: string): Promise<string> {
  const brains = await loadBrandBrains();
  const dbBlock = brains.get(brandSlug(brand))?.["content_block"];
  if (typeof dbBlock === "string" && dbBlock.trim().length >= 200) return dbBlock;
  return getBrandBlock(brand);
}

/** The chief aim (strategic spine) — DB `restylepro.brand_brain.chief_aim`, fallback CHIEF_AIM. */
export async function loadChiefAim(): Promise<string> {
  const brains = await loadBrandBrains();
  const db = brains.get("restylepro")?.["chief_aim"];
  if (typeof db === "string" && db.trim().length >= 200) return db;
  return CHIEF_AIM;
}
