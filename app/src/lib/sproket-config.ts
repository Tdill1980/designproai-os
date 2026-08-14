/**
 * SPROKET — Brand mascot configuration
 * All page greetings, tips, FAQ content, and filler messages.
 */

// ── Page Greetings (Layer 1: SproketGreeter) ──────────────────────

export interface SproketGreeting {
  image: string;
  headline: string;
  subtext: string;
}

export const PAGE_GREETINGS: Record<string, SproketGreeting> = {
  "/": {
    image: "/characters/sproket/sproket-welcome.png",
    headline: "Welcome to Ground Control.",
    subtext: "SPROKET here — your mission guide to the wrap universe.",
  },
  "/colorpro": {
    image: "/characters/sproket/sproket-launch.png",
    headline: "Ready to launch some color?",
    subtext: "Pick a shade, pick a finish — SPROKET handles the rest.",
  },
  "/designpro": {
    image: "/characters/sproket/sproket-unicorn.png",
    headline: "Time to design something legendary.",
    subtext: "Describe your dream wrap. ACE and I will bring it to life.",
  },
  "/fadewraps": {
    image: "/characters/sproket/sproket-boombox.png",
    headline: "Fade it up.",
    subtext: "Gradient wraps that flow like a mixtape. Let's build yours.",
  },
  "/wbty": {
    image: "/characters/sproket/sproket-tips.png",
    headline: "Wrap By The Yard? Smart move.",
    subtext: "Calculate exactly how much material you need. No waste.",
  },
  "/approvemode": {
    image: "/characters/sproket/sproket-milestone.png",
    headline: "Approval time.",
    subtext: "Send your client a proof they can't say no to.",
  },
  "/approvepro": {
    image: "/characters/sproket/sproket-clipboard.png",
    headline: "Welcome to ApprovePro.",
    subtext: "Where designs become signed approvals. Pick a job from the rails, send the link, and watch the status update live.",
  },
  "/graphicspro": {
    image: "/characters/sproket/sproket-loves-it.png",
    headline: "Graphics mode: activated.",
    subtext: "Upload a logo or let AI generate custom graphics.",
  },
  "/visualize": {
    image: "/characters/sproket/sproket-launch.png",
    headline: "Welcome to the spin zone.",
    subtext: "360-degree visualization. See every angle.",
  },
  "/material": {
    image: "/characters/sproket/sproket-zen.png",
    headline: "Feel the material.",
    subtext: "Textures, finishes, and premium vinyl previews.",
  },
  "/printpro": {
    image: "/characters/sproket/sproket-loading.png",
    headline: "Print-ready in seconds.",
    subtext: "From screen to printer — SPROKET's got your files.",
  },
  "/gallery": {
    image: "/characters/sproket/sproket-star-rating.png",
    headline: "Welcome to the gallery.",
    subtext: "The best wraps from the DesignProAI community.",
  },
  "/my-renders": {
    image: "/characters/sproket/sproket-loves-it.png",
    headline: "Your personal collection.",
    subtext: "Every render you've ever created, right here.",
  },
  "/my-designs": {
    image: "/characters/sproket/sproket-milestone.png",
    headline: "Your design vault.",
    subtext: "Saved designs ready for another round.",
  },
  "/pricing": {
    image: "/characters/sproket/sproket-announce.png",
    headline: "Let's find your plan.",
    subtext: "More renders, more tools, more wow. Pick your tier.",
  },
  "/designvault": {
    image: "/characters/sproket/sproket-tips.png",
    headline: "Welcome to the DesignVault.",
    subtext: "Your private library of saved designs and renders.",
  },
  "/wrapbox": {
    image: "/characters/sproket/sproket-loading.png",
    headline: "WrapBox is ready.",
    subtext: "Your production files, organized and downloadable.",
  },
  "/productionflow": {
    image: "/characters/sproket/sproket-launch.png",
    headline: "Production pipeline: online.",
    subtext: "GENIE is processing your wrap for print.",
  },
  "/recreatepro": {
    image: "/characters/sproket/sproket-unicorn.png",
    headline: "Recreate magic.",
    subtext: "Upload a photo and we'll rebuild the wrap digitally.",
  },
  // /revision-studio uses inline SproketTipsSlideshow instead of greeter overlay
  "/creatormarket": {
    image: "/characters/sproket/sproket-moneybag.png",
    headline: "Welcome to Creator Market.",
    subtext: "Design once. Earn every time it sells. You keep 60%, we drive the buyers.",
  },
};

// ── Per-page pose pools (rotation) ───────────────────────────────
//
// Lists of context-appropriate SPROKET poses for each page. SproketHelper
// picks a different one each time the panel opens so he never feels static.
// Falls back to PAGE_GREETINGS[path].image when a path isn't listed here.
//
// All paths point at /characters/sproket/ which has 61 poses available.

export const PAGE_POSE_POOLS: Record<string, string[]> = {
  "/": [
    "/characters/sproket/sproket-welcome.png",
    "/characters/sproket/sproket-tips.png",
    "/characters/sproket/sproket-presenting.png",
    "/characters/sproket/sproket-clipboard.png",
  ],
  "/dashboard": [
    "/characters/sproket/sproket-welcome.png",
    "/characters/sproket/sproket-tips.png",
    "/characters/sproket/sproket-presenting.png",
  ],
  "/colorpro": [
    "/characters/sproket/sproket-launch.png",
    "/characters/sproket/sproket-loves-it.png",
    "/characters/sproket/sproket-pencil.png",
    "/characters/sproket/sproket-zen.png",
  ],
  "/designpro": [
    "/characters/sproket/sproket-unicorn.png",
    "/characters/sproket/sproket-designmasterpiece.png",
    "/characters/sproket/sproket-designmasterpiece2.png",
    "/characters/sproket/sproket-pencil-ride.png",
    "/characters/sproket/sproket-ace-duo.png",
  ],
  "/fadewraps": [
    "/characters/sproket/sproket-boombox.png",
    "/characters/sproket/sproket-loves-it.png",
    "/characters/sproket/sproket-zen.png",
  ],
  "/wbty": [
    "/characters/sproket/sproket-tips.png",
    "/characters/sproket/sproket-clipboard.png",
    "/characters/sproket/sproket-time.png",
  ],
  "/approvemode": [
    "/characters/sproket/sproket-milestone.png",
    "/characters/sproket/sproket-clipboard.png",
    "/characters/sproket/sproket-mobile.png",
    "/characters/sproket/sproket-rating.png",
  ],
  "/approvepro": [
    "/characters/sproket/sproket-clipboard.png",
    "/characters/sproket/sproket-milestone.png",
    "/characters/sproket/sproket-mobile.png",
    "/characters/sproket/sproket-rating.png",
    "/characters/sproket/sproket-presenting.png",
    "/characters/sproket/sproket-starred.png",
  ],
  "/graphicspro": [
    "/characters/sproket/sproket-loves-it.png",
    "/characters/sproket/sproket-camera.png",
    "/characters/sproket/sproket-camera2.png",
    "/characters/sproket/sproket-presenting.png",
    "/characters/sproket/sproket-pencil.png",
  ],
  "/visualize": [
    "/characters/sproket/sproket-launch.png",
    "/characters/sproket/sproket-jetpack.png",
    "/characters/sproket/sproket-rocket-wave.png",
  ],
  "/material": [
    "/characters/sproket/sproket-zen.png",
    "/characters/sproket/sproket-loves-it.png",
    "/characters/sproket/sproket-presenting.png",
  ],
  "/printpro": [
    "/characters/sproket/sproket-loading.png",
    "/characters/sproket/sproket-treadmill-loading.png",
    "/characters/sproket/sproket-time.png",
    "/characters/sproket/sproket-loves-it.png",
  ],
  "/gallery": [
    "/characters/sproket/sproket-star-rating.png",
    "/characters/sproket/sproket-starred.png",
    "/characters/sproket/sproket-loves-it.png",
  ],
  "/my-renders": [
    "/characters/sproket/sproket-loves-it.png",
    "/characters/sproket/sproket-starred.png",
    "/characters/sproket/sproket-presenting.png",
  ],
  "/my-designs": [
    "/characters/sproket/sproket-milestone.png",
    "/characters/sproket/sproket-vault.png",
    "/characters/sproket/sproket-clipboard.png",
  ],
  "/pricing": [
    "/characters/sproket/sproket-announce.png",
    "/characters/sproket/sproket-moneybag.png",
    "/characters/sproket/sproket-moneybag2.png",
  ],
  "/designvault": [
    "/characters/sproket/sproket-vault.png",
    "/characters/sproket/sproket-vault-cash.png",
    "/characters/sproket/sproket-tips.png",
  ],
  "/wrapbox": [
    "/characters/sproket/sproket-vault.png",
    "/characters/sproket/sproket-loading.png",
    "/characters/sproket/sproket-presenting.png",
  ],
  "/productionflow": [
    "/characters/sproket/sproket-launch.png",
    "/characters/sproket/sproket-rocket-launch.png",
    "/characters/sproket/sproket-jetpack.png",
    "/characters/sproket/sproket-treadmill-loading.png",
    "/characters/sproket/sproket-time.png",
  ],
  "/recreatepro": [
    "/characters/sproket/sproket-unicorn.png",
    "/characters/sproket/sproket-designmasterpiece.png",
    "/characters/sproket/sproket-pencil.png",
  ],
  "/creatormarket": [
    "/characters/sproket/sproket-moneybag.png",
    "/characters/sproket/sproket-moneybag2.png",
    "/characters/sproket/sproket-vault-cash.png",
    "/characters/sproket/sproket-announce.png",
  ],
  "/revision-studio": [
    "/characters/sproket/sproket-revision.png",
    "/characters/sproket/sproket-pencil.png",
    "/characters/sproket/sproket-clipboard.png",
  ],
};

// ── Hover Tips (Layer 2: SproketHelper) ───────────────────────────

export const PAGE_TIPS: Record<string, string[]> = {
  "/": [
    "This is mission control. Your stats, recent missions, and flight log all live here.",
    "Check your transmissions. That\u2019s notifications. We only ping when it matters.",
    "New here? Start with ColorPro \u2014 it\u2019s the quickest win.",
  ],
  "/colorpro": [
    "Complementary colors create contrast. Red and green, blue and orange. Design 101. You\u2019re welcome.",
    "Blue means trust. Red means energy. Black means premium. Yellow means \u2018look at me.\u2019 Choose wisely.",
    "Lock in your palette BEFORE you design. Or don\u2019t, and enjoy doing it twice.",
    "Need an exact brand color? ColorPro can match it. Down to the decimal.",
    "The human eye can distinguish about 10 million colors. Ace uses all of them.",
    "Save your palettes. Ace remembers them, but it\u2019s nice when you do too.",
    "Fleet consistency across 50 trucks is hard. That\u2019s why ColorPro exists.",
    "Warm colors advance, cool colors recede. Use that to create depth on a flat wrap.",
  ],
  "/designpro": [
    "Include the business type in your prompt. \u2018Blue truck\u2019 tells Ace nothing. \u2018Plumbing company blue truck\u2019 tells him everything.",
    "Ace renders faster on simpler prompts. Save the novel for revisions.",
    "GENIE works best when you describe feelings, not just colors. \u2018Professional and trustworthy\u2019 beats \u2018blue and gray\u2019 every time.",
    "Add \u2018bold typography\u2019 or \u2018minimal and clean\u2019 to steer the style. Ace appreciates direction.",
    "Higher quality renders take a bit longer. Patience is a virtue. I wouldn\u2019t know personally, but I\u2019ve heard.",
    "Star your best renders. They go to your Brightest Stars collection.",
    "Use VisionBoardIQ to upload inspiration. Ace studies your references.",
    "You can toggle between Studio and My Vehicle view. Studio is Ace\u2019s playground.",
  ],
  "/fadewraps": [
    "Pick your start and end colors, then choose a fade style.",
    "Diagonal fades look great on sedans and coupes.",
    "Try a three-tone fade for maximum impact.",
  ],
  "/wbty": [
    "Enter your vehicle dimensions for an exact material estimate.",
    "Add 10% overage for complex curves and mistakes.",
    "WBTY calculates by the linear foot \u2014 no more guessing.",
  ],
  "/approvemode": [
    "Clients get a clean approval link. No login required. Easy for them, smart for you.",
    "You can send a reminder nudge. It\u2019s gentle. Okay, maybe a sonic boom.",
    "Revision requests come straight to Ace. He pretends he\u2019s not offended.",
    "Approved designs auto-move to ProductionFlow. The pipeline flows itself.",
  ],
  "/approvepro": [
    "Three rails on the left \u2014 QC jobs, recent renders, and WPW orders. Tap any to start a proof. Everything\u2019s pre-filled.",
    "Click Claim on a proof to put your avatar on it. The team knows it\u2019s yours.",
    "The orange NEW pulse means there\u2019s been an update since you last opened that proof. Click to clear it.",
    "Status badge says it all: draft \u2192 sent \u2192 viewed \u2192 revising \u2192 approved. Live as it happens.",
    "Customer asked for changes? Push New Version, status flips back to sent automatically.",
    "Delivery failed means the email bounced. Edit the customer email and resend \u2014 don\u2019t panic.",
    "Mine counter at the top shows how many proofs are on your plate right now. First thing every morning.",
  ],
  "/productionflow": [
    "The Panelizer breaks your design into print-ready panels in under 30 seconds. I timed it.",
    "59.5 inch roll width. 150 DPI. 10% scale. Industry standard. GENIE knows.",
    "Average production pack cost: about $2.55. Your markup is whatever you want.",
    "GENIE labels every panel by side and dimension. He\u2019s thorough like that.",
    "Your ZIP includes panels, TIFFs, EPS, PNGs, and info pages. Everything your printer needs.",
    "Rush order? Warp speed activated. It costs more but GENIE doesn\u2019t complain.",
    "QC happens automatically. Even magic gets inspected before it ships.",
  ],
  "/revision-studio": [
    "Compare versions side by side. Ace calls them \u2018evolution.\u2019 We call them \u2018fixes.\u2019",
    "Each revision is logged in your flight recorder. Version history is built in.",
    "Ace actually likes revisions. Says it \u2018refines his process.\u2019 We let him believe that.",
  ],
  "/designvault": [
    "Search the cosmos. That\u2019s the search bar. Use it.",
    "Archive old designs to deep space. You can always pull them back.",
    "Your Brightest Stars collection is your starred favorites. Curate it.",
    "Every design you\u2019ve ever launched lives here. Ace organized it. He was very thorough.",
  ],
  "/creatormarket": [
    "You keep 60% of every sale. The 40% platform cut funds Google + Meta ads that drive buyers to your listing.",
    "Top sellers upload at least 3 designs per week. Stay in orbit.",
    "Your designs go live in the marketplace instantly. Real buyers, real money.",
    "Trending designs get featured. Make something that stands out.",
  ],
  "/graphicspro": [
    "Upload your logo as a PNG with transparent background.",
    "Use zones to place graphics precisely on the vehicle.",
    "AI can generate custom graphics from a text description.",
  ],
  "/printpro": [
    "Download print-ready files at 150 DPI for large format.",
    "Production packs include cut lines and bleed margins.",
    "Check your material dimensions before printing.",
  ],
  "/gallery": [
    "Star your favorites to save them.",
    "Click any design to see it in full detail.",
    "Filter by vehicle type or wrap style.",
  ],
  "/my-renders": [
    "Click any render to see all views.",
    "Download renders individually or as a batch.",
    "Use the star to feature your best work.",
  ],
  "/pricing": [
    "Starter ($350) is the entry plan — solo wrappers and mobile installers.",
    "DesignPro Lite ($499) adds MyVehiclePro for customer-photo demos.",
    "DesignPro Studio ($699) gets you a real human designer in 48 hrs.",
    "Extra renders are $5 each on any plan.",
  ],
};

// ── FAQ Content (Layer 2: SproketHelper slide-out) ────────────────

export interface SproketFAQ {
  q: string;
  a: string;
}

// Global FAQ shown on pages without page-specific FAQ
export const GLOBAL_FAQ: SproketFAQ[] = [
  {
    q: "What is DesignProAI?",
    a: "DesignProAI is a complete Vehicle Wrap Design System — it's like having a custom vehicle wrap designer at your fingertips. From prompt to production. No designer. No outsourcing. No waiting.",
  },
  {
    q: "How do I get started?",
    a: "Get started by signing up for a tier level — you then get access to the system which includes DesignProAI, ColorPro, ApprovePro, plus production tools.",
  },
  {
    q: "Who is SPROKET?",
    a: "That's me! I'm your dedicated DesignProAI Systems Guide. I'm here to guide you so that you skyrocket your design abilities.",
  },
  {
    q: "Who is ACE?",
    a: "ACE is your dedicated AI Designer, trained on the proprietary DesignIQ system. Describe a wrap concept and ACE creates it — photorealistic, production-ready designs.",
  },
  {
    q: "What is GENIE?",
    a: "GENIE is our Universal Panelizer. It takes 3D renders and converts them into flat, print-ready production panels.",
  },
  {
    q: "How many renders do I get?",
    a: "Render quotas are shared across the entire suite. Starter ($350) gets 50/mo, DesignPro Lite ($499) gets 75/mo, DesignPro Studio ($699) gets 150/mo, and DesignPro Plus ($995) gets 300/mo. Extra renders are $5 each on every tier; à la carte single renders are $25.",
  },
  {
    q: "What if I don't have a way to print the wrap designs?",
    a: "Just click on PrintPro Suite — a dedicated wholesale printing service from trusted WePrintWraps.com. Ships all over the USA.",
  },
  {
    q: "What is CreatorMarket?",
    a: "CreatorMarket is a way to generate additional revenue on your designs. Use your DesignVault design equity and get paid! Sell unlimited times in CreatorMarket — 60% to you and 40% to the platform on every sale.",
  },
];

// Page-specific FAQ with SPROKET's dry wit voice. Falls back to GLOBAL_FAQ
// for pages not listed here.
export const PAGE_FAQ: Record<string, SproketFAQ[]> = {
  "/fadewraps": [
    {
      q: "How do I pick fade colors that don’t look like a sunset gone wrong?",
      a: "Stick to colors that already touch on the color wheel — blue → purple → pink works. Red → green is a Christmas tragedy. ColorPro has a palette tool. Use it before Ace cries.",
    },
    {
      q: "Diagonal, vertical, or horizontal fade?",
      a: "Diagonal flatters sedans and coupes. Vertical works on box trucks. Horizontal is the safe pick. Three-tone fades belong on muscle cars and people who want attention. You know who you are.",
    },
    {
      q: "Will the fade print exactly like the screen?",
      a: "Close but not perfect. Screens use light, vinyl uses ink. ColorPro maps your fade to print-safe colors so you don’t end up with ‘surprise teal.’",
    },
    {
      q: "Can I save a fade I like?",
      a: "Star it. Goes to your Brightest Stars. Reuse on the next ten trucks. Customers don’t talk to each other. Probably.",
    },
  ],
  "/wbty": [
    {
      q: "How accurate is the linear-foot estimate?",
      a: "Within a few inches if your dimensions are right. Garbage in, garbage out — that’s a SPROKET law of physics.",
    },
    {
      q: "Should I add overage?",
      a: "Yes. 10% for clean panels, 15% if your truck has more curves than a roller coaster. Vinyl scrap is cheaper than reordering at 4pm on a Friday.",
    },
    {
      q: "Cast vs calendared — which one?",
      a: "Cast for curves and full wraps. Calendared for flat panels and short-term promo. Don’t use calendared on a Sprinter unless you enjoy lifting and re-installing.",
    },
  ],
  "/graphicspro": [
    {
      q: "Vehicle, wall, or window — what’s the difference?",
      a: "Vehicle = panels around curves with a finish. Wall = flat-ish texture (drywall to brick). Window = perspective + glass + day/night view. Each has its own trick. I handle all three.",
    },
    {
      q: "Do storefront windows really work in AI mockups?",
      a: "That’s actually my superpower. Perspective correction, perforated vs frosted vs cut vinyl, glass reflection, day AND night views — all baked in. Things human designers spend hours fudging.",
    },
    {
      q: "Can I upload my customer’s actual vehicle photo?",
      a: "Yes. Drop in driver, passenger, rear, and front shots. I’ll apply the design to all four with consistent lighting and perspective. That’s the close-the-deal mockup.",
    },
    {
      q: "What format should my logo be in?",
      a: "PNG with a transparent background. Vector (SVG, AI, EPS) is even better. JPGs of a logo are a cry for help — but VectorizeIt can rescue them.",
    },
    {
      q: "Will the cut contour really go straight to my plotter?",
      a: "Yes. Magenta #FF00FF spot color, 1/16\" offset, RIP-compatible (VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery). Drop into Illustrator, send to plotter, weed, mask, install.",
    },
  ],
  "/printpro": [
    {
      q: "What’s in a PrintPro production pack?",
      a: "Cut-tiled panels, TIFFs, EPS, PNGs, install info pages, and the cut contour layer. Everything labeled by side and dimension. Your printer will love you. Mine, anyway.",
    },
    {
      q: "Do I need to be a print shop to use this?",
      a: "No. PrintPro routes your job to WePrintWraps and ships you the finished vinyl. You install. Customer pays you. You’re welcome.",
    },
    {
      q: "What DPI do you output?",
      a: "150 DPI at print size, which translates to 1500 DPI at 10% scale. Industry standard for large-format. Anything more is showing off and slows your printer down.",
    },
  ],
  "/recreatepro": [
    {
      q: "What does RecreatePro actually do?",
      a: "You drop in a wrap photo — even a phone snap of a competitor’s truck — and I rebuild it as a clean, panelized design on YOUR vehicle. Like recasting a movie with your customer in the lead role.",
    },
    {
      q: "Can I use it on my own past wraps?",
      a: "That’s actually the best use. Take a photo of a wrap you did 5 years ago, recreate it on a new vehicle for a different customer. The original took you a weekend. This takes 90 seconds.",
    },
    {
      q: "Is it copying someone else’s design?",
      a: "Stylistically inspired, not pixel-copied. I rebuild the layout and color story — the artwork is fresh. Use your judgment on whether you want to recreate a logo you don’t own.",
    },
  ],
  "/wrapbox": [
    {
      q: "Where do my files come from?",
      a: "Anything you generate — production packs, cut contour packs, single tool outputs — lands here, organized by order number. WrapBox is your filing cabinet, minus the dust.",
    },
    {
      q: "Can I share a folder with my installer?",
      a: "Each order has a download link your installer can hit. No login, no account. Send it on Friday, they cut on Monday.",
    },
    {
      q: "How long are files kept?",
      a: "Production packs stick around for 30 days on your default plan. Star the ones you want forever — starred files don’t expire.",
    },
  ],
  "/visualize": [
    {
      q: "What does the 360 spin actually show?",
      a: "Your wrapped vehicle from every angle. Driver, passenger, rear, front, three-quarters — all in one rotation. Perfect for closing a hesitant customer.",
    },
    {
      q: "Can I share the spin with a customer?",
      a: "Yes — send the link, no login required. They drag, they orbit, they say yes.",
    },
  ],
  "/material": [
    {
      q: "What finishes can I preview?",
      a: "Gloss, matte, satin, brushed, carbon, chrome, color-shift, and a few I’m not legally allowed to mention until launch. Toggle and see.",
    },
    {
      q: "Will the finish I pick affect the cut files?",
      a: "Cut path stays the same — finish only changes the visual mockup. The plotter doesn’t care about gloss vs matte. Your customer cares a lot.",
    },
  ],
  "/gallery": [
    {
      q: "Can I use a gallery design for my own customer?",
      a: "Use it as inspiration, then run RecreatePro to rebuild it on your customer’s vehicle. Don’t pixel-copy — build something new from the energy.",
    },
    {
      q: "How do I get my design featured?",
      a: "Quality, originality, and the algorithm’s mood. Star your best work, mark it public, keep shipping. Featured designs drive Creator Market sales.",
    },
  ],
  "/my-renders": [
    {
      q: "Can I download a batch?",
      a: "Multi-select then hit Download. Goes out as a ZIP. Faster than clicking one at a time.",
    },
    {
      q: "How do I keep my best renders forever?",
      a: "Star them. They go to Brightest Stars. Unstarred renders rotate out after 90 days to keep your dashboard tidy.",
    },
  ],
  "/pricing": [
    {
      q: "Which plan is right for me?",
      a: "Solo wrapper or mobile installer — Starter ($350). Want MyVehiclePro for customer demos — DesignPro Lite ($499). Want a real human designer in 48 hours — Studio ($699). Running a shop — Plus ($995).",
    },
    {
      q: "Are extra renders really $5?",
      a: "Yes, on every plan. Single à la carte renders without a plan are $25. Math says: get a plan.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. No contracts. We’re a tool, not a marriage. Your designs stay in your DesignVault either way.",
    },
  ],
  "/designpro": [
    {
      q: "How do I get the best results?",
      a: "Be specific. \u2018Blue truck\u2019 tells Ace nothing. \u2018Plumbing company blue truck with bold typography and flame accents on the hood\u2019 tells him everything. GENIE refines your words but he\u2019s not a mind reader. Well, he says he is. He\u2019s not.",
    },
    {
      q: "How long does a render take?",
      a: "Usually under 60 seconds. Complex prompts take longer. Ace is a perfectionist. It\u2019s a feature, not a bug.",
    },
    {
      q: "Can I use my own vehicle photo?",
      a: "Yes. Toggle to \u2018My Vehicle\u2019 mode. Ace will design on YOUR actual vehicle instead of the studio model.",
    },
    {
      q: "Why does my design look different each time?",
      a: "Every design is unique. Like a real designer, Ace interprets fresh each time. That\u2019s the point. Star the ones you love.",
    },
    {
      q: "What\u2019s VisionBoardIQ?",
      a: "Upload inspiration photos, sketches, or brand assets. Ace studies them. Think of it as a mood board that actually does something.",
    },
  ],
  "/colorpro": [
    {
      q: "Can I match a specific brand color?",
      a: "Enter the hex code, Pantone number, or upload a logo. Ace doesn\u2019t do \u2018close enough.\u2019",
    },
    {
      q: "Why do my colors look different when printed?",
      a: "Screen colors lie. Print colors don\u2019t. That\u2019s why ColorPro does Pantone matching \u2014 so your red is actually red and not \u2018surprise salmon.\u2019",
    },
    {
      q: "How do I save a palette?",
      a: "Star it. It goes to your Brightest Stars. It\u2019ll be there next time.",
    },
    {
      q: "Does palette choice affect the render?",
      a: "Absolutely. Lock in colors first and Ace uses YOUR palette, not his own taste. Although his taste is excellent.",
    },
  ],
  "/productionflow": [
    {
      q: "What\u2019s in the production pack?",
      a: "Panels, TIFFs, EPS, PNGs, and info pages. Everything labeled by side and dimension. GENIE is thorough.",
    },
    {
      q: "What size are the panels?",
      a: "59.5 inch roll width, 150 DPI, 10% scale. Industry standard. Your installer trims to fit.",
    },
    {
      q: "How much does a production pack cost?",
      a: "About $2.55. Your markup is your business. Literally.",
    },
    {
      q: "What if my file gets rejected by the printer?",
      a: "Nine times out of ten: wrong DPI, wrong color space, or someone saved a PowerPoint as a PDF. RecreatePro exists for exactly this. Upload the disaster. GENIE rebuilds it.",
    },
    {
      q: "Can I rush an order?",
      a: "Yes. Warp speed activated. GENIE doesn\u2019t complain but it costs more.",
    },
  ],
  "/approvemode": [
    {
      q: "Does my client need to log in?",
      a: "No. Clean approval link. Click, view, approve or request changes. No account needed.",
    },
    {
      q: "What happens after approval?",
      a: "Auto-moves to ProductionFlow. GENIE takes over. The pipeline flows itself.",
    },
    {
      q: "Can I send a reminder?",
      a: "One click. Gentle nudge. Okay, maybe a sonic boom.",
    },
    {
      q: "What if the client keeps requesting revisions?",
      a: "Ace loves revisions. He calls them \u2018creative evolution.\u2019 We call them \u2018Tuesday.\u2019 RevisionStudioIQ tracks every version. At some point you gently remind the client that revision 47 looks remarkably similar to revision 2.",
    },
  ],
  "/approvepro": [
    {
      q: "What are the three rails on the left?",
      a: "QC Artboard Jobs (designs you ran through QC / Panelizer), Recent Renders (ColorPro / DesignPro / FadeWraps from the last 30 days), and WPW Orders (paid WeePrintWraps design orders, auto-ingested as drafts). Tap any one \u2014 vehicle, render, and customer info are pre-filled. No re-typing.",
    },
    {
      q: "I clicked a job and nothing seems to send. Where do I see status?",
      a: "Right pane. Once a proof is selected, the detail card shows the status badge on the hero (top-left: draft / sent / viewed / revising / approved), the designer assignment box right above the title, a progress stepper, every email sent, every version pushed, and the full audit log. If you\u2019re on a phone, scroll down \u2014 it stacks below the rails.",
    },
    {
      q: "How do I claim a proof for myself?",
      a: "The gray box right above the design title. Hit Claim. Your avatar shows on the row in the left list so the rest of the team knows it\u2019s yours. Use Reassign to hand off, Unassign to send it back to the queue.",
    },
    {
      q: "Why is there an orange NEW pulse on a row?",
      a: "That proof has been updated since YOU (specifically \u2014 it\u2019s per-user) last opened it. Could be a viewed event, a revision request, an approval. Click the row to clear it.",
    },
    {
      q: "Customer asked for changes. What now?",
      a: "Status flips to \u2018revising\u2019 \u2014 their change request shows in the message thread on the detail pane. Push a new version with Push New Version. The status flips back to \u2018sent\u2019 automatically and they get notified.",
    },
    {
      q: "A proof says delivery_failed. What broke?",
      a: "Email bounced. Bad address, full mailbox, or a domain blocking us. Open the proof, edit the customer email, click Resend.",
    },
    {
      q: "Send button is greyed out.",
      a: "You\u2019re at your tier\u2019s proof cap for the month. Check the proofs-remaining meter at the top. Upgrade or wait for the monthly reset.",
    },
    {
      q: "Can the client run AI revisions themselves?",
      a: "On Starter+ tiers, yes. They get a button on the approval page that fires Ace directly. Each one counts against ai_revisions_allowed for that proof.",
    },
    {
      q: "What does approved mean for production?",
      a: "Status flips green, signature image is stored on the proof_approvals row, the revision loop closes, and the approved version is what production uses. Hand off to ProductionFlow.",
    },
    {
      q: "Is this whitelabeled for my clients?",
      a: "Yes. Your shop logo + name on the approval page, in the email subject, in the PDF. Override the logo per-proof in the Send dialog if you want.",
    },
  ],
  "/revision-studio": [
    {
      q: "How many revisions can I do?",
      a: "Depends on your plan. But each one is logged in your flight recorder. Version history is built in.",
    },
    {
      q: "Can I compare versions?",
      a: "Side by side. Ace calls them \u2018evolution.\u2019 We call them \u2018fixes.\u2019",
    },
  ],
  "/designvault": [
    {
      q: "Where are my archived designs?",
      a: "Deep space. Click \u2018Pull from deep space\u2019 to retrieve them. They\u2019ve been floating there quietly. They\u2019re fine.",
    },
    {
      q: "Can I search by style or color?",
      a: "Search the cosmos. That\u2019s the search bar. Filter by constellation \u2014 that\u2019s the filter dropdown. Use them.",
    },
  ],
  "/creatormarket": [
    {
      q: "How much do I earn per sale?",
      a: "You keep 60%. Designs listed at $299 means about $179 per sale to you. The 40% platform cut funds Google + Meta ads that drive buyers to your listing.",
    },
    {
      q: "Who buys my designs?",
      a: "Wrap shops, fleet managers, sign shops \u2014 anyone who needs a professional wrap design fast and doesn\u2019t have Ace on staff.",
    },
    {
      q: "Can I wrap a boat?",
      a: "We get this a lot. Ace doesn\u2019t judge. GENIE panels anything.",
    },
  ],
};

// ── Filler Messages (Layer 3: SproketFiller) ──────────────────────

export const LOADING_MESSAGES = [
  { image: "/characters/sproket/sproket-loading.png", text: "SPROKET is calibrating the color matrix..." },
  { image: "/characters/sproket/planet-purple.png", text: "Orbiting the design galaxy..." },
  { image: "/characters/sproket/sproket-treadmill.png", text: "Running the render pipeline at maximum speed..." },
  { image: "/characters/sproket/planet-blue.png", text: "Navigating the wrap nebula..." },
  { image: "/characters/sproket/sproket-zen.png", text: "Achieving pixel-perfect harmony..." },
  { image: "/characters/sproket/sproket-fitness.png", text: "Flexing those GPU muscles..." },
  { image: "/characters/sproket/planet-teal.png", text: "Approaching the finish line at warp speed..." },
  { image: "/characters/sproket/sproket-tips.png", text: "Reading the design manual one more time..." },
  { image: "/characters/sproket/sproket-time.png", text: "Solving the wrap equation..." },
  { image: "/characters/sproket/sproket-time.png", text: "Almost there — just a few more seconds..." },
  { image: "/characters/sproket/sproket-lunch.png", text: "Quick snack break... just kidding, still rendering." },
  { image: "/characters/sproket/sproket-boombox.png", text: "Vibing while your design comes to life..." },
];

export const SUCCESS_MESSAGES = [
  { image: "/characters/sproket/sproket-success.png", text: "Mission complete! Your render is ready." },
  { image: "/characters/sproket/sproket-loves-it.png", text: "SPROKET loves this one. Check it out!" },
  { image: "/characters/sproket/sproket-planet-balloons.png", text: "Houston, we have a masterpiece." },
  { image: "/characters/sproket/sproket-birthday.png", text: "It's like your vehicle's birthday. Celebrate!" },
];

export const ERROR_MESSAGES = [
  { image: "/characters/sproket/sproket-error.png", text: "Even SPROKET needs a breather sometimes. Let's try again." },
  { image: "/characters/sproket/sproket-error.png", text: "Something went sideways. SPROKET's on it." },
  { image: "/characters/sproket/sproket-question.png", text: "Hmm, that didn't work. Want to give it another shot?" },
];

export const WRAP_FACTS = [
  "A single vehicle wrap generates up to 70,000 impressions per day.",
  "The average ROI on a commercial wrap is 3,400%.",
  "Cast vinyl conforms to curves without lifting or cracking.",
  "Matte and satin finishes reduce glare for better street visibility.",
  "A well-designed wrap lasts 5–7 years with proper care.",
  "Fleet wraps cost less per impression than any other advertising.",
  "Glossy finishes reflect light and make colors appear more vibrant.",
  "The wrap industry is growing at over 20% annually worldwide.",
  "Every inch of letter height gives 10 feet of readability distance.",
  "Partial wraps can cover 25–75% of a vehicle at half the cost.",
];

// ── Star Rating Prompt ────────────────────────────────────────────

export const STAR_RATING_CONFIG = {
  image: "/characters/sproket/sproket-rating.png",
  headline: "How'd we do?",
  subtext: "Rate this render — SPROKET wants to know.",
  delayMs: 10_000, // show 10s after render completes
};

// ── localStorage Keys ─────────────────────────────────────────────

export const SPROKET_STORAGE = {
  GREETER_DISMISSED: "sproket_greeter_dismissed",       // JSON object: { "/path": true }
  HELPER_COLLAPSED: "sproket_helper_collapsed",         // "true" | "false"
  TIPS_SEEN: "sproket_tips_seen",                       // JSON object: { "/path": [0,1,2] }
  FIRST_VISIT: "sproket_first_visit",                   // JSON object: { "/path": timestamp }
} as const;
