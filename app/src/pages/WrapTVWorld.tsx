import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WRAPTV_SHOWS, WRAPTV_TALENT } from "@/data/wraptvShows";

/**
 * /wraptv — the WrapTVWorld network home (Fuel/MTV-style, dark network UI).
 * This page IS a distribution channel: content-deploy publishes approved
 * agent_social_posts (platform 'wraptv_site') into wraptv_site_content on a
 * schedule, and this page reads the live rotation anonymously. Styled to the
 * same brand language as /wraptv/submit (League Spartan, #05070a, cyan/orange).
 */

export interface SiteEntry {
  id: string;
  show_slug: string;
  title: string | null;
  caption: string | null;
  media_url: string;
  thumbnail_url: string | null;
  media_type: string;
  credit: string | null;
  published_at: string;
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "'League Spartan',Arial,Helvetica,sans-serif", background: "#05070a", color: "#fff", minHeight: "100vh" },
  wrap: { maxWidth: 1120, margin: "0 auto", padding: "0 20px 90px" },
  kick: { fontSize: 13, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", color: "#17A5BE" },
  h1: { fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, margin: "10px 0 0", fontSize: "clamp(38px,8vw,84px)", letterSpacing: -2 },
  sub: { color: "#8b97a1", fontSize: 17, lineHeight: 1.6, margin: "18px 0 0", maxWidth: 640 },
  sectionKick: { fontSize: 12, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase", color: "#8b97a1" },
  h2: { fontWeight: 900, textTransform: "uppercase", fontSize: "clamp(22px,4vw,34px)", letterSpacing: -0.5, margin: "6px 0 22px" },
  btn: { display: "inline-block", border: 0, cursor: "pointer", background: "linear-gradient(180deg,#f68d63,#e06336)", borderRadius: 999, padding: "16px 40px", color: "#fff", fontWeight: 900, fontSize: 15, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "inherit", textDecoration: "none" },
  card: { border: "1px solid #1c2329", borderRadius: 14, background: "#0c1014", overflow: "hidden", textDecoration: "none", color: "#fff", display: "block" },
};

export function ShowArt({ image, accent, title, ratio = "56%" }: { image: string; accent: string; title: string; ratio?: string }) {
  // Real show art drops into /public/wraptv/shows/; until then the gradient
  // tile carries the show identity.
  return (
    <div style={{ position: "relative", paddingBottom: ratio, background: `linear-gradient(135deg,${accent}33,#05070a 70%)` }}>
      <img
        src={image}
        alt={title}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div style={{ position: "absolute", left: 14, bottom: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, fontSize: 18, textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>
        {title}
      </div>
    </div>
  );
}

export function EpisodeCard({ entry }: { entry: SiteEntry }) {
  const showTitle = WRAPTV_SHOWS.find((s) => s.slug === entry.show_slug)?.title || entry.show_slug;
  return (
    <div style={S.card}>
      <div style={{ position: "relative", paddingBottom: "56%", background: "#0c1014" }}>
        {entry.media_type === "video" ? (
          <video
            src={entry.media_url}
            poster={entry.thumbnail_url || undefined}
            controls
            preload="metadata"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
          />
        ) : (
          <img src={entry.media_url} alt={entry.title || showTitle} loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#17A5BE" }}>{showTitle}</div>
        {entry.title && <div style={{ fontWeight: 800, fontSize: 16, marginTop: 6 }}>{entry.title}</div>}
        {entry.caption && (
          <div style={{ color: "#8b97a1", fontSize: 13, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {entry.caption}
          </div>
        )}
        {entry.credit && <div style={{ color: "#f68d63", fontSize: 12, fontWeight: 700, marginTop: 8 }}>🎬 {entry.credit}</div>}
      </div>
    </div>
  );
}

export function useWrapTVFeed(showSlug?: string) {
  return useQuery({
    queryKey: ["wraptv-site-content", showSlug ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("wraptv_site_content" as never)
        .select("id, show_slug, title, caption, media_url, thumbnail_url, media_type, credit, published_at")
        .eq("status", "live")
        .order("published_at", { ascending: false })
        .limit(24);
      if (showSlug) q = q.eq("show_slug", showSlug);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as SiteEntry[];
    },
  });
}

export default function WrapTVWorld() {
  const { data: feed = [], isLoading } = useWrapTVFeed();
  const hero = feed[0];

  return (
    <div style={S.page}>
      {/* Network header */}
      <div style={{ borderBottom: "1px solid #1c2329" }}>
        <div style={{ ...S.wrap, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: 2, fontSize: 18 }}>
            Wrap<span style={{ color: "#17A5BE" }}>TV</span>World
          </div>
          <Link to="/wraptv/submit" style={{ ...S.btn, padding: "10px 22px", fontSize: 12 }}>Get on the show »</Link>
        </div>
      </div>

      <div style={{ ...S.wrap, paddingTop: 56 }}>
        {/* Hero */}
        <div style={S.kick}>Wrap Culture, On Camera</div>
        <h1 style={S.h1}>The wrap industry's<br />entertainment channel.</h1>
        <p style={S.sub}>
          Creator spotlights, viral builds, transformations and behind-the-shop life — music-TV energy,
          produced network-style from footage submitted by installers worldwide. Home base: WrapTVWorld Studio at Royalty Wraps OC.
        </p>

        {/* On now — latest from the rotation */}
        {hero && (
          <div style={{ marginTop: 44 }}>
            <div style={S.sectionKick}>On now</div>
            <h2 style={S.h2}>Latest on the network</h2>
            <div style={{ maxWidth: 760 }}>
              <EpisodeCard entry={hero} />
            </div>
          </div>
        )}

        {/* Show rail */}
        <div style={{ marginTop: 54 }}>
          <div style={S.sectionKick}>The programming slate</div>
          <h2 style={S.h2}>Shows</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
            {WRAPTV_SHOWS.map((show) => (
              <Link key={show.slug} to={`/wraptv/shows/${show.slug}`} style={S.card}>
                <ShowArt image={show.heroImage} accent={show.accent} title={show.title} />
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: show.accent }}>{show.kicker}</div>
                  <div style={{ color: "#8b97a1", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{show.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Episode grid */}
        <div style={{ marginTop: 54 }}>
          <div style={S.sectionKick}>Fresh from the shops</div>
          <h2 style={S.h2}>Latest episodes</h2>
          {isLoading && <p style={{ color: "#8b97a1" }}>Loading the rotation…</p>}
          {!isLoading && feed.length === 0 && (
            <p style={{ color: "#8b97a1" }}>
              New episodes are in the edit bay. Want yours here?{" "}
              <Link to="/wraptv/submit" style={{ color: "#17A5BE", fontWeight: 800 }}>Submit your install »</Link>
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {feed.slice(hero ? 1 : 0).map((entry) => (
              <EpisodeCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>

        {/* Talent strip */}
        <div style={{ marginTop: 54 }}>
          <div style={S.sectionKick}>Real people from real shops</div>
          <h2 style={S.h2}>The talent</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {WRAPTV_TALENT.map((t) => (
              <div key={t.name} style={{ border: "1px solid #1c2329", borderRadius: 999, background: "#0c1014", padding: "10px 18px" }}>
                <span style={{ fontWeight: 800 }}>{t.name}</span>
                <span style={{ color: "#8b97a1", fontSize: 13 }}> · {t.show}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Submit CTA */}
        <div style={{ marginTop: 64, border: "1px solid #1c2329", borderRadius: 18, background: "linear-gradient(135deg,rgba(23,165,190,.12),#0c1014 70%)", padding: "40px 28px", textAlign: "center" }}>
          <div style={S.kick}>The show mechanic</div>
          <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: "clamp(24px,5vw,40px)", letterSpacing: -1, margin: "10px 0 14px" }}>
            Submit your build. It airs.
          </div>
          <p style={{ ...S.sub, margin: "0 auto 26px" }}>
            Film your install on your phone — rough footage is perfect. We produce it network-style with
            MTV-style captions and a licensed soundtrack, credited to your shop and tagged.
          </p>
          <Link to="/wraptv/submit" style={S.btn}>Submit your install »</Link>
        </div>
      </div>
    </div>
  );
}
