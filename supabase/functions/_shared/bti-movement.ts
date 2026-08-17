/**
 * bti-movement.ts — THE Behind the Install™ recruitment framework
 * (owner spec, Trish 2026-08-04).
 *
 * Every BTI post has a JOB beyond promoting the episode: recruit the
 * industry into the movement, WORLDWIDE. Every generated asset must carry
 * all FIVE movement blocks:
 *   1. WHAT  — what Behind the Install is
 *   2. WHY   — why it exists (people only see the finished vehicle)
 *   3. INVITE — a clear invitation to submit footage
 *   4. LINK  — the submission link
 *   5. SHOWROOM — shops can play BTI in their showroom/lobby
 *
 * This module is PURE (no Deno APIs) so the vitest lock
 * (tests/bti-movement.test.ts) imports it directly and fails the build if
 * any channel's output drops a block. Copy is seeded from the owner's
 * approved launch copy — worldwide framing ("around the world", never
 * "across the country").
 *
 * Consumed by supabase/functions/bti-episode-pack (auto-fired on every
 * BTI episode approval). Deterministic on purpose: the movement blocks are
 * doctrine, not something an AI should paraphrase per-post.
 */

/** Swap here when the final URL lands — every channel reads this constant. */
export const BTI_SUBMIT_URL = "https://wraptvworld.com/behind-the-install";

export const BTI_BRAND = "wraptvworld";
export const BTI_SHOW_SLUG = "behind-the-install";

export interface BtiEpisode {
  /** Episode display title, e.g. "Behind the Install — Episode 12". */
  title: string;
  /** Public URL of the episode (video or watch page), if known. */
  episodeUrl?: string | null;
}

export interface BtiPackItem {
  /** agent_social_posts.platform value, or the special kinds below. */
  platform:
    | "instagram"
    | "facebook"
    | "linkedin"
    | "x"
    | "threads"
    | "youtube"
    | "instagram_story"
    | "blog";
  post_type: string;
  caption: string;
  hashtags: string[];
}

export interface BtiEmailItem {
  campaign_name: string;
  subject_line: string;
  preview_text: string;
  body_text: string;
  body_html: string;
}

const HASHTAGS = ["#BehindTheInstall", "#WrapTVWorld", "#PaintIsDead", "#CarWraps", "#VinylWrap"];

const watchLine = (ep: BtiEpisode) => (ep.episodeUrl ? `\n▶️ Watch: ${ep.episodeUrl}\n` : "");

/** The long-form movement body — IG/FB/blog/site. Owner launch copy, worldwide. */
function longBody(ep: BtiEpisode): string {
  return `BEHIND THE INSTALL IS HERE.

Every day, thousands of wraps are installed around the world.
Most people only ever see the finished vehicle.
They never see the skill, precision, teamwork, and problem-solving that happen behind the bay doors.

That's why we created Behind the Install™.

Every episode is a fast-cut mashup of real installation footage from real wrap shops, paired with original WrapTVWorld music inspired by the wrap industry.

No actors.
No staged scenes.
Just the work.
${watchLine(ep)}
Want your shop included?
Upload your installation footage and your shop could appear in an upcoming episode — we're featuring shops from around the world.

🎥 Submit your footage:
${BTI_SUBMIT_URL}

If your clips are selected:
• Your shop receives on-screen credit.
• Your installers are featured.
• Your work becomes part of the industry's story.

And if you own a wrap shop…
Play Behind the Install in your showroom or lobby.
Let customers see the craftsmanship, teamwork, and energy that define our industry while they wait.

This isn't about one shop.
It's about all of us.`;
}

function linkedinBody(ep: BtiEpisode): string {
  return `The wrap industry produces incredible work every single day, but most customers only see the finished vehicle.

Behind the Install was created to showcase the process behind the product through original music and real installation footage submitted by shops around the world.
${watchLine(ep)}
We're inviting wrap shops and installers everywhere to contribute footage for future episodes. If selected, your work will be credited and become part of a growing library of content celebrating the people behind the craft.

If you operate a shop, consider playing Behind the Install on your showroom or lobby displays to help customers better understand the work that goes into every project.

Submit footage:
👉 ${BTI_SUBMIT_URL}`;
}

/** ≤280 chars and still carries all five blocks. */
function xBody(): string {
  return `Most people only see the finished wrap, never the skill behind the bay doors. Behind the Install™ = real install footage from shops around the world + original music.

🎥 Submit yours: ${BTI_SUBMIT_URL}
📺 Shops: play it in your showroom or lobby.`;
}

function threadsBody(ep: BtiEpisode): string {
  return `Most people only see the finished vehicle. Behind the Install™ exists to show the skill behind the bay doors — real installation footage from wrap shops around the world, cut to original WrapTVWorld music. No actors. Just the work.
${watchLine(ep)}
🎥 Want your shop featured in a future episode? Submit your footage: ${BTI_SUBMIT_URL}

📺 Own a shop? Play Behind the Install in your showroom or lobby while customers wait.`;
}

function youtubeDescription(ep: BtiEpisode): string {
  return `Every Behind the Install™ episode features real installation footage submitted by wrap shops and installers around the world, combined with original WrapTVWorld music. Why? Because most people only ever see the finished vehicle — never the skill, precision, and teamwork behind the bay doors.

Want your shop featured in a future episode?
Submit your clips here:
👉 ${BTI_SUBMIT_URL}

If your clips are selected, your shop receives on-screen credit, your installers are featured, and your work becomes part of the industry's story.

Whether you're wrapping exotics, fleet vehicles, walls, boats, trailers, or storefronts, we want to help tell the story of this industry.

Shop owners: play Behind the Install on your showroom or lobby displays and let customers see the craftsmanship behind every project.

${HASHTAGS.join(" ")}`;
}

/** IG Story slide script — one caption, slides delimited for the designer. */
function storyBody(): string {
  return `SLIDE 1: 🎥 We're building something for the wrap industry.
SLIDE 2: Behind the Install™ — real install footage, original music. Because customers only ever see the finished vehicle.
SLIDE 3: Got install footage? Upload it.
SLIDE 4: We'll feature shops from around the world in future episodes — with on-screen credit.
SLIDE 5: 👉 Submit at: ${BTI_SUBMIT_URL}
SLIDE 6: 📺 Shop owners — play Behind the Install in your showroom or lobby.`;
}

/** Master article (markdown) — the blog/website long-form. */
function blogBody(ep: BtiEpisode): string {
  return `# ${ep.title}: The Industry's Story, Told By The People Who Install It

Every day, thousands of wraps are installed around the world — and most people only ever see the finished vehicle. They never see the skill, precision, teamwork, and problem-solving that happen behind the bay doors.

**That's why Behind the Install™ exists.** Every episode is a fast-cut mashup of real installation footage from real wrap shops, paired with original WrapTVWorld music inspired by the wrap industry. No actors. No staged scenes. Just the work.
${ep.episodeUrl ? `\n[Watch the latest episode](${ep.episodeUrl})\n` : ""}
## Get your shop in an episode

Upload your installation footage and your shop could appear in an upcoming episode — we're featuring shops from around the world.

**[Submit your footage →](${BTI_SUBMIT_URL})**

If your clips are selected:

- Your shop receives on-screen credit.
- Your installers are featured.
- Your work becomes part of the industry's story.

## Play it in your showroom

If you own a wrap shop, play Behind the Install in your showroom or lobby. Let customers see the craftsmanship, teamwork, and energy that define our industry while they wait.

This isn't about one shop. It's about all of us.`;
}

export function buildBtiSocialPack(ep: BtiEpisode): BtiPackItem[] {
  return [
    { platform: "instagram", post_type: "static", caption: longBody(ep), hashtags: HASHTAGS },
    { platform: "facebook", post_type: "static", caption: longBody(ep), hashtags: [] },
    { platform: "linkedin", post_type: "static", caption: linkedinBody(ep), hashtags: [] },
    { platform: "x", post_type: "static", caption: xBody(), hashtags: [] },
    { platform: "threads", post_type: "static", caption: threadsBody(ep), hashtags: [] },
    { platform: "youtube", post_type: "description", caption: youtubeDescription(ep), hashtags: [] },
    { platform: "instagram_story", post_type: "story", caption: storyBody(), hashtags: [] },
    { platform: "blog", post_type: "article", caption: blogBody(ep), hashtags: [] },
  ];
}

export function buildBtiEmail(ep: BtiEpisode): BtiEmailItem {
  const text = longBody(ep);
  return {
    campaign_name: `BTI — ${ep.title}`,
    subject_line: `New Behind the Install episode — and your shop could be in the next one`,
    preview_text: "Real install footage from shops around the world. Submit yours.",
    body_text: text,
    body_html: text
      .split("\n\n")
      .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
      .join("\n")
      .replace(
        BTI_SUBMIT_URL,
        `<a href="${BTI_SUBMIT_URL}">${BTI_SUBMIT_URL}</a>`,
      ),
  };
}
