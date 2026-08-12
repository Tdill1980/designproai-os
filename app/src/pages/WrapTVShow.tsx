import { Link, useParams } from "react-router-dom";
import { getWrapTVShow } from "@/data/wraptvShows";
import { EpisodeCard, ShowArt, useWrapTVFeed } from "@/pages/WrapTVWorld";

/**
 * /wraptv/shows/:slug — a single show's page on the WrapTVWorld network.
 * Episode grid comes from the same wraptv_site_content rotation, filtered to
 * this show. Show art drops into /public/wraptv/shows/<slug>.jpg.
 */

export default function WrapTVShow() {
  const { slug = "" } = useParams();
  const show = getWrapTVShow(slug);
  const { data: feed = [], isLoading } = useWrapTVFeed(slug);

  const page: React.CSSProperties = { fontFamily: "'League Spartan',Arial,Helvetica,sans-serif", background: "#05070a", color: "#fff", minHeight: "100vh" };
  const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 20px 90px" };

  if (!show) {
    return (
      <div style={page}>
        <div style={{ ...wrap, paddingTop: 120, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", color: "#17A5BE" }}>Off air</div>
          <h1 style={{ fontWeight: 900, textTransform: "uppercase", fontSize: "clamp(30px,6vw,54px)" }}>That show isn't on the slate</h1>
          <Link to="/wraptv" style={{ color: "#17A5BE", fontWeight: 800 }}>« Back to WrapTVWorld</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ borderBottom: "1px solid #1c2329" }}>
        <div style={{ ...wrap, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link to="/wraptv" style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: 2, fontSize: 18, color: "#fff", textDecoration: "none" }}>
            Wrap<span style={{ color: "#17A5BE" }}>TV</span>World
          </Link>
          <Link
            to="/wraptv/submit"
            style={{ background: "linear-gradient(180deg,#f68d63,#e06336)", borderRadius: 999, padding: "10px 22px", color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", textDecoration: "none" }}
          >
            Get on the show »
          </Link>
        </div>
      </div>

      <div style={{ ...wrap, paddingTop: 40 }}>
        <div style={{ border: "1px solid #1c2329", borderRadius: 18, overflow: "hidden", background: "#0c1014" }}>
          <ShowArt image={show.heroImage} accent={show.accent} title="" ratio="34%" />
          <div style={{ padding: "26px 28px 30px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", color: show.accent }}>{show.kicker}</div>
            <h1 style={{ fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, margin: "8px 0 0", fontSize: "clamp(32px,6vw,62px)", letterSpacing: -1.5 }}>
              {show.title}
            </h1>
            <p style={{ color: "#8b97a1", fontSize: 16, lineHeight: 1.6, margin: "16px 0 0", maxWidth: 640 }}>{show.description}</p>
          </div>
        </div>

        <div style={{ marginTop: 44 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase", color: "#8b97a1" }}>In the rotation</div>
          <h2 style={{ fontWeight: 900, textTransform: "uppercase", fontSize: "clamp(22px,4vw,34px)", margin: "6px 0 22px" }}>Episodes</h2>
          {isLoading && <p style={{ color: "#8b97a1" }}>Loading episodes…</p>}
          {!isLoading && feed.length === 0 && (
            <p style={{ color: "#8b97a1" }}>
              This show's next episode is in the edit bay.{" "}
              <Link to="/wraptv/submit" style={{ color: "#17A5BE", fontWeight: 800 }}>Submit your install »</Link>
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {feed.map((entry) => (
              <EpisodeCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
