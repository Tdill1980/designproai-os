/**
 * Content Pack Templates — Spin-off content from source assets
 *
 * When a series Reel (or Blog) is completed, these templates
 * define the derivative content pieces that should be created.
 * Each template has a specific content ANGLE — not just a repost.
 */

// ── Reel Spin-Off Template ──────────────────────────────────────
// Applied when any recurring series Reel is marked complete.
// dayOffset is relative to the Reel's scheduled date (Day 0).

export interface SpinOffTemplate {
  id: string;
  title: string;          // Uses {series} and {owner} placeholders
  taskType: string;       // slack_agent_tasks.task_type
  assignedTo: string;     // "series_owner" | "carley" | "trish" | "jackson"
  platform: string;
  format: string;
  dayOffset: number;      // -1 = day before, 0 = same day, +1 = next day
  contentAngle: string;   // The specific creative direction
  description: string;    // Full brief for the creator
}

export const REEL_SPINOFF_TEMPLATE: SpinOffTemplate[] = [
  {
    id: "teaser-story",
    title: "Series Dropping Story — {series} teaser",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "stories",
    dayOffset: -1,
    contentAngle: "HYPE / TEASER",
    description: "New {series} dropping tomorrow 👀 — teaser clip from the reel, countdown sticker, swipe-up anticipation. Quick 3-frame story: hook text → 2-sec clip → 'Tomorrow' with countdown.",
  },
  {
    id: "the-reel",
    title: "{series} — {owner} (Original Reel)",
    taskType: "social_post",
    assignedTo: "series_owner",
    platform: "instagram",
    format: "9:16 reel",
    dayOffset: 0,
    contentAngle: "ORIGINAL EPISODE",
    description: "The main series episode. Full reel. This is the source asset — everything else spins from this.",
  },
  {
    id: "us-vs-them",
    title: "Us vs Them — {series} angle",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "4:5 carousel",
    dayOffset: 1,
    contentAngle: "US VS THEM / COMPARISON",
    description: "How most shops do it vs How we do it — side by side comparison using content from the reel. Slide 1: 'Most shops...' Slide 2: shows the old/slow way. Slide 3: 'We built...' Slide 4: shows the RP way. Slide 5: Design. Output. Profit. Pull real examples from the reel.",
  },
  {
    id: "feature-callout",
    title: "Feature Callout — {tool} from {series}",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "instagram",
    format: "1080x1080 post",
    dayOffset: 1,
    contentAngle: "PRODUCT SPOTLIGHT",
    description: "Spotlight the specific DesignProAI tool shown in the reel — what it does, why it matters, one clear benefit. Not a pitch — a reveal. Use a screenshot or still from the reel. Single image post with strong caption.",
  },
  {
    id: "quote-card-story",
    title: "Quote Card — best line from {series}",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "stories",
    dayOffset: 1,
    contentAngle: "QUOTE CARD / SHAREABLE",
    description: "Pull the single best one-liner from the reel and turn it into a bold text graphic. Clean, minimal, shareable. Examples: 'If the file isn't right, the install won't be' / 'You don't need more designers. You need a better system.' Add series logo/watermark.",
  },
  {
    id: "x-hot-take",
    title: "X Hot Take — {series} angle",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "x",
    format: "text post",
    dayOffset: 2,
    contentAngle: "HOT TAKE / CONVERSATION STARTER",
    description: "Controversial or sharp opinion pulled from the reel. Short, punchy, designed to start a conversation. No link, no CTA — just the take. Let people agree or disagree. Example: 'Most shops are 7-10 days out on designs and think that's normal. It's not. It's a bottleneck.'",
  },
  {
    id: "linkedin-authority",
    title: "LinkedIn Authority — {series} lesson",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "linkedin",
    format: "text + still",
    dayOffset: 2,
    contentAngle: "AUTHORITY / LESSON LEARNED",
    description: "Longer writeup on the lesson from the episode. Founder or team voice. Tell the story behind the reel — why it matters, what it proves, what the industry gets wrong. Tag the series owner. Include best still from the reel.",
  },
  {
    id: "behind-process",
    title: "Behind the Process — {series} BTS",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "carousel or reel",
    dayOffset: 3,
    contentAngle: "BEHIND THE SCENES / PROCESS",
    description: "Show what happened before/during/after the reel — the actual screen recordings, the actual files, the actual output. Not polished — real. The audience sees the work behind the content. Screen grabs, B-roll, raw process.",
  },
  {
    id: "meta-ad",
    title: "Meta Ad — {series} best clip (4:5)",
    taskType: "ad_campaign",
    assignedTo: "jackson",
    platform: "facebook",
    format: "4:5 video ad",
    dayOffset: 3,
    contentAngle: "PAID / BEST HOOK",
    description: "Best 15-second hook from the reel, reformatted to 4:5 with headline overlay and CTA. The clip that makes people stop scrolling. Add: DesignProAI logo bug, 'Learn more' CTA. Target wrap shop owners.",
  },
  {
    id: "recap-cta",
    title: "Recap + CTA — {series} this week",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "instagram",
    format: "story + X post",
    dayOffset: 4,
    contentAngle: "RECAP / MISSED IT",
    description: "Missed this week's {series}? Here's what you need to know — 3 key takeaways from the episode + link to watch. Story format: Takeaway 1 → Takeaway 2 → Takeaway 3 → Swipe to watch. Also post condensed version on X.",
  },
];

// ── Blog Spin-Off Template ──────────────────────────────────────
// Applied when a weekly blog is published (Sunday).

export const BLOG_SPINOFF_TEMPLATE: SpinOffTemplate[] = [
  {
    id: "blog-publish",
    title: "Blog — {blogTitle} (Substack)",
    taskType: "blog_post",
    assignedTo: "trish",
    platform: "substack",
    format: "article",
    dayOffset: 0,
    contentAngle: "ORIGINAL BLOG",
    description: "Publish the blog on Substack. This is the source — everything else pulls from this.",
  },
  {
    id: "blog-linkedin-1",
    title: "LinkedIn — Authority angle from blog",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "linkedin",
    format: "text + carousel",
    dayOffset: 1,
    contentAngle: "FOUNDER STORY / AUTHORITY",
    description: "Pull the strongest narrative from the blog. Tell it as a LinkedIn story. Hook → struggle → insight → system. End with Design. Output. Profit.",
  },
  {
    id: "blog-email",
    title: "Email — Blog hook (MightyMail)",
    taskType: "email_campaign",
    assignedTo: "trish",
    platform: "mightymail",
    format: "email",
    dayOffset: 1,
    contentAngle: "EMAIL HOOK → READ MORE",
    description: "Subject line = blog's strongest hook. Short body (5-6 lines max). Link to full blog. Include one image if available.",
  },
  {
    id: "blog-x-thread",
    title: "X Thread — Blog breakdown",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "x",
    format: "thread (6-8 tweets)",
    dayOffset: 2,
    contentAngle: "THREAD / BREAKDOWN",
    description: "Break the blog into a 6-8 tweet thread. Each tweet = one sharp point. No fluff. End with the CTA or tagline.",
  },
  {
    id: "blog-ig-main",
    title: "IG Main Post — Blog founder angle",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "instagram",
    format: "post",
    dayOffset: 2,
    contentAngle: "FOUNDER PERSONAL",
    description: "Full founder post pulling from the blog. Personal voice, real story. The IG version of the LinkedIn post but more raw.",
  },
  {
    id: "blog-carousel",
    title: "IG Carousel — Blog key points (4:5)",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "4:5 carousel",
    dayOffset: 3,
    contentAngle: "CAROUSEL / KEY POINTS",
    description: "8-10 slide carousel pulling the strongest lines from the blog. One idea per slide. Bold text, clean design. End with Design. Output. Profit.",
  },
  {
    id: "blog-reel",
    title: "IG Reel — Blog hook (9:16)",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "9:16 reel",
    dayOffset: 3,
    contentAngle: "REEL / HOOK + STORY",
    description: "Turn the blog's hook into a 30-60 sec reel. Quick cuts, text overlays, strong opening line. B-roll or screen recordings.",
  },
  {
    id: "blog-stories",
    title: "IG + FB Stories — Blog engagement",
    taskType: "social_post",
    assignedTo: "carley",
    platform: "instagram",
    format: "stories (5-6 frames)",
    dayOffset: 3,
    contentAngle: "STORIES / ENGAGEMENT + POLL",
    description: "5-6 story frames pulling highlights from the blog. End with a poll or question sticker to drive engagement.",
  },
  {
    id: "blog-fb-ad",
    title: "Facebook Ad — Blog angle (4:5)",
    taskType: "ad_campaign",
    assignedTo: "jackson",
    platform: "facebook",
    format: "4:5 ad",
    dayOffset: 4,
    contentAngle: "PAID / PROBLEM→SOLUTION",
    description: "Primary text: the problem from the blog. Headline: the solution. Use strongest image or still. Target wrap shop owners.",
  },
  {
    id: "blog-spotlights",
    title: "Component Spotlights — tools from blog",
    taskType: "social_post",
    assignedTo: "trish",
    platform: "instagram",
    format: "3 short posts",
    dayOffset: 5,
    contentAngle: "PRODUCT SPOTLIGHT / NATURAL",
    description: "2-3 short posts each highlighting a specific RP tool mentioned in the blog. Not a pitch — a natural reveal. One tool per post.",
  },
];
