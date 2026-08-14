/**
 * ExtractElementsModal — click-to-select tool for ProductionFlow.
 *
 * The user uploads a wrap image, clicks on each logo / text block they want
 * removed, and the edge function (extract-elements) erases those spots and
 * AI-fills the area so the wrap art is left clean.
 *
 * No "AI guess what you mean" — the user tells the tool exactly which
 * regions to erase by clicking them. Each click becomes a circle on a
 * binary mask that LaMa-Cleaner uses for inpainting.
 */

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Point = { x: number; y: number }; // normalized 0..1

interface ExtractResult {
  background_url: string;
  mask_url: string;
  image_dimensions: { width: number; height: number };
  points_used: number;
  radius_px: number;
  processing_ms: number;
}

interface Props {
  fileUrl: string;
  fileName?: string;
  onClose: () => void;
}

export default function ExtractElementsModal({ fileUrl, fileName, onClose }: Props) {
  const { toast } = useToast();
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [points, setPoints] = useState<Point[]>([]);
  const [radius, setRadius] = useState(0.05); // 0..0.15 normalized to image diagonal
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgRect, setImgRect] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  // Inline error panel — shows the actual step + message from extract-elements
  // when the function returns a 4xx. supabase-js swallows the body on errors,
  // so we call the edge function with fetch directly and parse the body
  // ourselves to surface the real error to the user.
  const [errorDetail, setErrorDetail] = useState<{ step?: string; error: string; debug?: any } | null>(null);

  // Track image element rect so we can position click markers correctly
  // even when the image is letterboxed inside the container.
  useEffect(() => {
    const update = () => {
      if (!imgRef.current) return;
      const r = imgRef.current.getBoundingClientRect();
      const c = containerRef.current?.getBoundingClientRect();
      if (!c) return;
      setImgRect({
        width: r.width,
        height: r.height,
        left: r.left - c.left,
        top: r.top - c.top,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [imgLoaded]);

  const handleImageClick = (ev: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPoints((prev) => [...prev, { x, y }]);
  };

  const undoLast = () => setPoints((prev) => prev.slice(0, -1));
  const clearAll = () => setPoints([]);

  const runExtract = async () => {
    if (points.length === 0) {
      toast({ title: "Click on each thing to remove first", description: "Tap on every logo / text block before running.", variant: "destructive" });
      return;
    }
    setRunning(true);
    setResult(null);
    setErrorDetail(null);
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error("Not authenticated");
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      // Call the edge function with raw fetch so we can read the response
      // body even on 4xx (supabase.functions.invoke swallows it). The
      // anon key + bearer token both work — Supabase routes by either.
      const projectUrl = (supabase as any).supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL;
      const anonKey = (supabase as any).supabaseKey || (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
      const fnUrl = `${projectUrl}/functions/v1/extract-elements`;

      const resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(anonKey ? { "apikey": anonKey } : {}),
          ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          user_id: user.id,
          file_url: fileUrl,
          file_name: fileName || "file",
          points,
          radius_norm: radius,
        }),
      });

      let body: any = null;
      try { body = await resp.json(); } catch { /* non-JSON response */ }

      if (!resp.ok || !body?.success) {
        const detail = {
          step: body?.step,
          error: body?.error || `HTTP ${resp.status} ${resp.statusText}`,
          debug: body?.debug,
        };
        setErrorDetail(detail);
        toast({
          title: detail.step ? `Extract failed [${detail.step}]` : "Extract failed",
          description: detail.error,
          variant: "destructive",
        });
        return;
      }

      setResult({
        background_url: body.background_url,
        mask_url: body.mask_url,
        image_dimensions: body.image_dimensions,
        points_used: body.points_used,
        radius_px: body.radius_px,
        processing_ms: body.processing_ms,
      });
      toast({ title: "Extraction complete", description: `${body.points_used} regions cleaned in ${(body.processing_ms / 1000).toFixed(1)}s.` });
    } catch (err: any) {
      const detail = { error: err?.message || "Network error reaching extract-elements" };
      setErrorDetail(detail);
      toast({ title: "Extract failed", description: detail.error, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const reuseResult = () => {
    setResult(null);
    // keep points so the user can adjust radius and re-run, or click clear to reset
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ color: "#fff" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Extract Elements</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Click each logo / text block to remove. Adjust brush size if needed. Then press Extract.
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid #555", color: "#fff", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}
        >
          Close
        </button>
      </div>

      {!result && (
        <>
          <div
            ref={containerRef}
            style={{
              flex: 1,
              position: "relative",
              background: "#1a1a1a",
              borderRadius: 8,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              ref={imgRef}
              src={fileUrl}
              alt={fileName}
              onLoad={() => setImgLoaded(true)}
              onClick={handleImageClick}
              style={{ maxWidth: "100%", maxHeight: "100%", cursor: "crosshair", userSelect: "none" }}
              draggable={false}
            />
            {imgRect && imgLoaded && points.map((pt, i) => {
              const px = imgRect.left + pt.x * imgRect.width;
              const py = imgRect.top + pt.y * imgRect.height;
              const radiusPx = radius * Math.sqrt(imgRect.width * imgRect.width + imgRect.height * imgRect.height);
              return (
                <div key={i}>
                  {/* radius preview circle */}
                  <div
                    style={{
                      position: "absolute",
                      left: px - radiusPx,
                      top: py - radiusPx,
                      width: radiusPx * 2,
                      height: radiusPx * 2,
                      borderRadius: "50%",
                      background: "rgba(255, 0, 255, 0.25)",
                      border: "2px solid rgba(255, 0, 255, 0.8)",
                      pointerEvents: "none",
                    }}
                  />
                  {/* click marker */}
                  <div
                    style={{
                      position: "absolute",
                      left: px - 12,
                      top: py - 12,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "#FF00FF",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      boxShadow: "0 0 0 2px #fff",
                    }}
                  >
                    {i + 1}
                  </div>
                </div>
              );
            })}
          </div>

          {errorDetail && (
            <div style={{
              marginTop: 12, padding: "12px 16px", borderRadius: 8,
              background: "#3a1010", border: "1px solid #7a2424", color: "#ffb4b4",
              fontSize: 13, fontFamily: "monospace",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Extract failed{errorDetail.step ? ` at step: ${errorDetail.step}` : ""}
              </div>
              <div style={{ wordBreak: "break-word" }}>{errorDetail.error}</div>
              {errorDetail.debug && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.8 }}>debug info</summary>
                  <pre style={{ margin: "6px 0 0", fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.85 }}>
                    {JSON.stringify(errorDetail.debug, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", color: "#fff" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Brush size: {(radius * 100).toFixed(1)}% of image
              </div>
              <input
                type="range"
                min="0.01"
                max="0.15"
                step="0.005"
                value={radius}
                onChange={(e) => setRadius(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <button
              onClick={undoLast}
              disabled={points.length === 0 || running}
              style={{
                background: "transparent", border: "1px solid #555", color: "#fff",
                padding: "8px 16px", borderRadius: 6, cursor: points.length === 0 || running ? "not-allowed" : "pointer",
                opacity: points.length === 0 || running ? 0.5 : 1,
              }}
            >
              Undo
            </button>
            <button
              onClick={clearAll}
              disabled={points.length === 0 || running}
              style={{
                background: "transparent", border: "1px solid #555", color: "#fff",
                padding: "8px 16px", borderRadius: 6, cursor: points.length === 0 || running ? "not-allowed" : "pointer",
                opacity: points.length === 0 || running ? 0.5 : 1,
              }}
            >
              Clear all
            </button>
            <button
              onClick={runExtract}
              disabled={running || points.length === 0}
              style={{
                background: running || points.length === 0 ? "#555" : "#00C7FF",
                border: "none",
                color: running || points.length === 0 ? "#999" : "#000",
                padding: "10px 24px",
                borderRadius: 6,
                fontWeight: 700,
                cursor: running || points.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {running ? "Extracting..." : `Extract (${points.length})`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", color: "#fff" }}>
          <div style={{ marginBottom: 8, fontSize: 14 }}>
            Background cleaned — {result.points_used} regions erased in {(result.processing_ms / 1000).toFixed(1)}s.
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Original</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <img src={fileUrl} alt="original" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </div>
            </div>
            <div style={{ background: "#1a1a1a", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Cleaned background</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <img src={result.background_url} alt="cleaned" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
            <a
              href={result.background_url}
              download="background-cleaned.png"
              style={{
                background: "#00C7FF", color: "#000", padding: "10px 24px",
                borderRadius: 6, fontWeight: 700, textDecoration: "none",
              }}
            >
              Download cleaned background
            </a>
            <button
              onClick={reuseResult}
              style={{
                background: "transparent", border: "1px solid #555", color: "#fff",
                padding: "10px 16px", borderRadius: 6, cursor: "pointer",
              }}
            >
              Add more clicks
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: "1px solid #555", color: "#fff",
                padding: "10px 16px", borderRadius: 6, cursor: "pointer", marginLeft: "auto",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
