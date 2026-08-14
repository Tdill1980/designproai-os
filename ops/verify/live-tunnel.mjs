/**
 * Local TLS reverse proxy so a browser in this sandbox can drive the real
 * production site. Chromium here has no outbound egress but can reach
 * localhost; Node can reach the internet. Chromium is started with
 * --host-resolver-rules mapping the real hostnames at this listener, so the
 * page believes it is talking to os.designproai.com and every byte it renders
 * is the deployed artifact.
 */
import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const DIR = process.env.TUNNEL_CERT_DIR || ".";
const PORT = 8443;
const UPSTREAM = {
  "os.designproai.com": "https://os.designproai.com",
  "designproai.com": "https://designproai.com",
  "www.designproai.com": "https://www.designproai.com",
  "wozyamlnygaddievzuwn.supabase.co": "https://wozyamlnygaddievzuwn.supabase.co",
};

createServer(
  { key: readFileSync(`${DIR}/key.pem`), cert: readFileSync(`${DIR}/cert.pem`) },
  async (req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    const base = UPSTREAM[host];
    if (!base) { res.writeHead(502).end("unmapped host " + host); return; }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    // Forward the client's headers untouched apart from hop-by-hop ones. The
    // browser already believes it is on the production origin, so Origin and
    // Referer are correct as sent -- rewriting them made Supabase answer with
    // an Access-Control-Allow-Origin the page did not match, which the browser
    // rejected and which looked exactly like a broken login.
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "connection", "content-length", "accept-encoding"].includes(k)) continue;
      headers[k] = v;
    }

    try {
      const upstream = await fetch(base + req.url, {
        method: req.method,
        headers,
        body,
        redirect: "manual",
      });
      const out = {};
      upstream.headers.forEach((v, k) => {
        if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) return;
        // Rewrite redirects back through the tunnel.
        if (k === "location") { out[k] = v.replace(/^https:\/\//, "https://"); return; }
        out[k] = v;
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, out);
      res.end(buf);
    } catch (err) {
      res.writeHead(502).end("tunnel error: " + err.message);
    }
  },
).listen(PORT, "127.0.0.1", () => console.log("tunnel listening on", PORT));
