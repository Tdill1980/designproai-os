import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

/**
 * /wraptv/submit — Behind the Install public submission tool.
 * Installers anywhere in the world upload install footage (long videos OK —
 * resumable TUS uploads to the wtw-footage bucket), enter the credit info for
 * the MTV-style caption, and pick a commercially-licensed soundtrack from
 * the Openverse CC audio catalog (openverse.org — no API key required;
 * licenses filtered to BY / BY-SA / CC0, all commercial-use with attribution).
 * Public page: no login. Styled to the Wrap TV World brand (dark network UI).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const GENRES = ["Rap", "Rock", "Alternative", "Synthwave", "Electronic", "Metal", "Chill", "Latin", "Country", "Pop"];
// UI genre -> Openverse search query (mapped to terms with catalog coverage)
const GENRE_QUERY: Record<string, string> = {
  Rap: "hip hop", Rock: "rock", Alternative: "alternative rock", Synthwave: "synth",
  Electronic: "electronic", Metal: "metal", Chill: "chill", Latin: "latin",
  Country: "country", Pop: "pop",
};
// UI genre -> WPW Originals storage folder (wrap-files/wtw-music/{folder}).
// Our own Suno-made tracks, auto-listed and offered ABOVE the CC catalog.
const WPW_MUSIC_FOLDER: Record<string, string> = { Rap: "rap", Rock: "rock", Alternative: "alternative" };
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|aac)$/i;

type Track = {
  id: string;
  name: string;
  artist: string;
  duration: number;
  audio: string;
  license_url: string;
  attribution: string;
  source: string;
};

type UploadItem = {
  file: File;
  progress: number;
  path?: string;
  error?: string;
};

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "'League Spartan',Arial,Helvetica,sans-serif", background: "#05070a", color: "#fff", minHeight: "100vh" },
  wrap: { maxWidth: 760, margin: "0 auto", padding: "56px 20px 90px" },
  kick: { fontSize: 13, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", color: "#17A5BE" },
  h1: { fontWeight: 900, textTransform: "uppercase", lineHeight: 1, margin: "10px 0 0", fontSize: "clamp(30px,7vw,54px)", letterSpacing: -1 },
  sub: { color: "#8b97a1", fontSize: 16, lineHeight: 1.6, margin: "16px 0 0" },
  label: { display: "block", fontSize: 12, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", color: "#8b97a1", margin: "26px 0 8px" },
  input: { width: "100%", background: "#0c1014", border: "1px solid #1c2329", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 15, fontFamily: "inherit" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  btn: { display: "inline-block", border: 0, cursor: "pointer", background: "linear-gradient(180deg,#f68d63,#e06336)", borderRadius: 999, padding: "16px 40px", color: "#fff", fontWeight: 900, fontSize: 15, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "inherit" },
  card: { border: "1px solid #1c2329", borderRadius: 14, background: "#0c1014", padding: 16 },
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    cursor: "pointer", borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 800,
    letterSpacing: 1.5, textTransform: "uppercase", border: `1px solid ${active ? "#17A5BE" : "#1c2329"}`,
    background: active ? "rgba(23,165,190,.18)" : "#0c1014", color: active ? "#7fd6e5" : "#c4ccd3",
  };
}

export default function WrapTVSubmit() {
  const [form, setForm] = useState({
    shop_name: "", wrappers: "", location: "", vehicle: "", design_name: "",
    instagram: "", tiktok: "", youtube: "", contact_email: "", notes: "",
  });
  const [genre, setGenre] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [wpwTracks, setWpwTracks] = useState<Track[]>([]);
  const [catalog, setCatalog] = useState<"jamendo" | "offline" | "loading" | "">("");
  const [track, setTrack] = useState<Track | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [release, setRelease] = useState(false);
  const [optIn, setOptIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // fetch licensed tracks whenever the genre changes — Openverse CC audio
  // catalog, filtered to commercial-use licenses (BY / BY-SA / CC0).
  // No API key: anonymous limit is 200 searches/day per visitor IP.
  // WPW Originals (our own Suno-made tracks) for this genre — listed straight
  // from wrap-files/wtw-music/{folder} and offered ABOVE the CC catalog.
  useEffect(() => {
    setWpwTracks([]);
    const folder = WPW_MUSIC_FOLDER[genre];
    if (!folder) return;
    supabase.storage.from("wrap-files").list(`wtw-music/${folder}`, { limit: 50, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data }) => {
        const orig: Track[] = (data || [])
          .filter((f) => AUDIO_EXT_RE.test(f.name))
          .map((f) => ({
            id: `wpw-${folder}-${f.name}`,
            name: f.name.replace(/^\d+-/, "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
            artist: "WPW Original",
            duration: 0,
            audio: supabase.storage.from("wrap-files").getPublicUrl(`wtw-music/${folder}/${f.name}`).data.publicUrl,
            license_url: "", attribution: "WePrintWraps Original (Suno)", source: "wpw-original",
          }));
        setWpwTracks(orig);
      })
      .catch(() => setWpwTracks([]));
  }, [genre]);

  useEffect(() => {
    if (!genre) return;
    setCatalog("loading");
    setTracks([]);
    const params = new URLSearchParams({
      q: GENRE_QUERY[genre] ?? genre.toLowerCase(), category: "music",
      license: "by,by-sa,cc0", page_size: "12",
    });
    fetch(`https://api.openverse.org/v1/audio/?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const list: Track[] = (data?.results ?? [])
          .filter((t: Record<string, unknown>) => t.url)
          .map((t: Record<string, unknown>) => ({
            id: String(t.id), name: String(t.title), artist: String(t.creator ?? "Unknown artist"),
            duration: Math.round((Number(t.duration) || 0) / 1000), audio: String(t.url),
            license_url: String(t.license_url ?? ""),
            attribution: String(t.attribution ?? `"${t.title}" by ${t.creator} (${t.license_url})`),
            source: "openverse",
          }));
        setTracks(list);
        setCatalog(list.length ? "jamendo" : "offline");
      })
      .catch(() => setCatalog("offline"));
  }, [genre]);

  const preview = (t: Track) => {
    if (audioRef.current) audioRef.current.pause();
    if (playingId === t.id) { setPlayingId(null); return; }
    const a = new Audio(t.audio);
    audioRef.current = a;
    a.play().catch(() => undefined);
    setPlayingId(t.id);
    a.onended = () => setPlayingId(null);
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const items: UploadItem[] = Array.from(files).map((file) => ({ file, progress: 0 }));
    setUploads((u) => [...u, ...items]);
    items.forEach((item) => {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}/${item.file.name.replace(/[^\w.\-]+/g, "_")}`;
      const upload = new tus.Upload(item.file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 8000, 15000, 30000],
        chunkSize: 6 * 1024 * 1024, // required by Supabase TUS
        headers: { authorization: `Bearer ${SUPABASE_ANON}`, "x-upsert": "false" },
        metadata: { bucketName: "wtw-footage", objectName: path, contentType: item.file.type || "video/mp4" },
        onError: (err) => setUploads((u) => u.map((x) => (x.file === item.file ? { ...x, error: String(err) } : x))),
        onProgress: (sent, total) =>
          setUploads((u) => u.map((x) => (x.file === item.file ? { ...x, progress: Math.round((sent / total) * 100) } : x))),
        onSuccess: () =>
          setUploads((u) => u.map((x) => (x.file === item.file ? { ...x, progress: 100, path } : x))),
      });
      upload.findPreviousUploads().then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      });
    });
  };

  const uploadedPaths = uploads.filter((u) => u.path).map((u) => u.path!) as string[];
  const uploading = uploads.some((u) => !u.path && !u.error);

  const submit = async () => {
    setError(null);
    if (!form.shop_name || !form.wrappers || !form.location || !form.contact_email)
      return setError("Shop, wrappers, location and email are required — that's your on-screen credit.");
    if (!genre) return setError("Pick your soundtrack genre.");
    if (uploadedPaths.length === 0) return setError("Upload at least one video (wait for uploads to finish).");
    if (!release) return setError("Please accept the usage release so we can publish your episode.");
    setSubmitting(true);
    try {
      // Direct RLS-guarded insert (anon may INSERT only; an Engine Room intake
      // card is planted by the wtw_submission_intake trigger).
      const { error: insErr } = await supabase.from("wtw_submissions").insert({
        shop_name: form.shop_name, wrappers: form.wrappers, location: form.location,
        vehicle: form.vehicle || null, design_name: form.design_name || null,
        instagram: form.instagram || null, tiktok: form.tiktok || null, youtube: form.youtube || null,
        contact_email: form.contact_email, marketing_opt_in: optIn,
        notes: form.notes || null, music_genre: genre, music_track: track,
        video_paths: uploadedPaths, release_accepted: release, status: "submitted",
      });
      if (insErr) throw new Error(insErr.message);
      setDone("received");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={S.page}>
        <div style={{ ...S.wrap, textAlign: "center", paddingTop: 120 }}>
          <div style={S.kick}>Submission received</div>
          <h1 style={S.h1}>You're in the queue 🎬</h1>
          <p style={S.sub}>
            Our team cuts your footage into your Behind the Install episode — full credit to{" "}
            <strong style={{ color: "#fff" }}>{form.shop_name}</strong>. Watch {form.contact_email} for your sneak peek.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.kick}>Wrap TV World · Behind the Install</div>
        <h1 style={S.h1}>Submit your install.<br />Get your episode.</h1>
        <p style={S.sub}>
          Film your install on your phone — rough footage is perfect. Pick your soundtrack, tell us who gets the
          credit, and our team cuts it into your own music-video episode of Behind the Install.
        </p>

        <label style={S.label}>Shop name *</label>
        <input style={S.input} value={form.shop_name} onChange={set("shop_name")} placeholder="Wrapsesh AZ" />
        <label style={S.label}>Wrappers (who's on the credit) *</label>
        <input style={S.input} value={form.wrappers} onChange={set("wrappers")} placeholder={'Jess "Vinyl Vixen" & Mike Shedd'} />
        <label style={S.label}>Location *</label>
        <input style={S.input} value={form.location} onChange={set("location")} placeholder="Phoenix, Arizona" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={S.label}>Vehicle</label>
            <input style={S.input} value={form.vehicle} onChange={set("vehicle")} placeholder="Yamaha MT-07" />
          </div>
          <div>
            <label style={S.label}>Design / wrap name</label>
            <input style={S.input} value={form.design_name} onChange={set("design_name")} placeholder="Aurora Borealis" />
          </div>
        </div>
        <label style={S.label}>Email * (sneak peek + episode link land here)</label>
        <input style={S.input} type="email" value={form.contact_email} onChange={set("contact_email")} placeholder="you@yourshop.com" />
        <label style={S.label}>Social handles (we tag you everywhere the episode runs)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          <input style={S.input} value={form.instagram} onChange={set("instagram")} placeholder="Instagram @wrapsesh_az" />
          <input style={S.input} value={form.tiktok} onChange={set("tiktok")} placeholder="TikTok @handle" />
          <input style={S.input} value={form.youtube} onChange={set("youtube")} placeholder="YouTube @channel" />
        </div>

        <label style={S.label}>Pick your soundtrack genre *</label>
        <div style={S.chipRow}>
          {GENRES.map((g) => (
            <span key={g} style={chipStyle(genre === g)} onClick={() => { setGenre(g); setTrack(null); }}>{g}</span>
          ))}
        </div>

        {genre && (
          <div style={{ marginTop: 14 }}>
            {wpwTracks.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#f68d63", marginBottom: 8 }}>
                ★ WPW Originals
              </div>
            )}
            {catalog === "loading" && <p style={{ color: "#8b97a1", fontSize: 14 }}>Loading {genre} tracks…</p>}
            {catalog === "offline" && wpwTracks.length === 0 && (
              <p style={{ color: "#8b97a1", fontSize: 14 }}>
                Track picker is warming up — no problem: our editors will pick a licensed {genre} track for your cut.
              </p>
            )}
            {(wpwTracks.length > 0 || tracks.length > 0) && (
              <div style={{ display: "grid", gap: 8 }}>
                {[...wpwTracks, ...tracks].map((t) => {
                  const active = track?.id === t.id;
                  const isOriginal = t.source === "wpw-original";
                  return (
                    <div key={t.id} style={{ ...S.card, display: "flex", alignItems: "center", gap: 12, borderColor: active ? "#17A5BE" : isOriginal ? "#3a2a1e" : "#1c2329" }}>
                      <button type="button" onClick={() => preview(t)} style={{ ...S.btn, padding: "10px 14px", fontSize: 13, background: isOriginal ? "linear-gradient(180deg,#f68d63,#e06336)" : "linear-gradient(180deg,#1fb9d4,#0d7d90)" }}>
                        {playingId === t.id ? "⏸" : "▶"}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isOriginal && <span style={{ color: "#f68d63" }}>★ </span>}{t.name}
                        </div>
                        <div style={{ color: "#8b97a1", fontSize: 13 }}>
                          {isOriginal ? "WePrintWraps Original · exclusive" : `${t.artist} · ${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")} · CC licensed`}
                        </div>
                      </div>
                      <span style={chipStyle(active)} onClick={() => setTrack(active ? null : t)}>{active ? "Picked ✓" : "Pick"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label style={S.label}>Your install footage * (long videos welcome — uploads resume if your connection drops)</label>
        <div
          style={{ ...S.card, textAlign: "center", padding: 30, borderStyle: "dashed", cursor: "pointer" }}
          onClick={() => document.getElementById("wtw-file-input")?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        >
          <div style={{ fontSize: 30 }}>🎥</div>
          <div style={{ fontWeight: 800, marginTop: 8 }}>Drop videos here or tap to choose</div>
          <div style={{ color: "#5c6870", fontSize: 13, marginTop: 6 }}>MP4 / MOV · up to 5GB per file · phone footage is perfect</div>
          <input id="wtw-file-input" type="file" accept="video/*" multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
        </div>
        {uploads.map((u, i) => (
          <div key={i} style={{ ...S.card, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file.name}</span>
              <span style={{ color: u.error ? "#f9038c" : u.path ? "#C2D832" : "#8b97a1" }}>
                {u.error ? "failed" : u.path ? "uploaded ✓" : `${u.progress}%`}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 5, background: "#1c2329" }}>
              <div style={{ height: 5, borderRadius: 5, width: `${u.progress}%`, background: u.error ? "#f9038c" : "linear-gradient(90deg,#17A5BE,#C2D832)" }} />
            </div>
          </div>
        ))}

        <label style={S.label}>Anything we should know?</label>
        <textarea style={{ ...S.input, minHeight: 80 }} value={form.notes} onChange={set("notes")} placeholder="Timeline, shout-outs, sponsor mentions…" />

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "26px 0 0", fontSize: 14, color: "#c4ccd3", cursor: "pointer" }}>
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Send me freebies, giveaways and The Edge — the monthly newsletter from WePrintWraps. No spam, unsubscribe anytime.
          </span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 0 0", fontSize: 14, color: "#c4ccd3", cursor: "pointer" }}>
          <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I own this footage and give Wrap TV World / WePrintWraps permission to edit and publish it as a Behind
            the Install episode with full credit to my shop. *
          </span>
        </label>

        {error && <p style={{ color: "#f9038c", fontWeight: 700, marginTop: 18 }}>{error}</p>}
        <div style={{ marginTop: 28 }}>
          <button type="button" style={{ ...S.btn, opacity: submitting || uploading ? 0.6 : 1 }} disabled={submitting || uploading} onClick={submit}>
            {uploading ? "Uploading…" : submitting ? "Submitting…" : "Submit Your Install »"}
          </button>
        </div>
        <p style={{ color: "#5c6870", fontSize: 12, marginTop: 14 }}>
          Music comes from a commercially-licensed Creative Commons catalog; artist attribution appears in your episode credits.
        </p>
      </div>
    </div>
  );
}
