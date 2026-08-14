# Live verification

Three scripts used to prove the deployed product against production, kept
because the next person to change the shell will need them.

- `live-operating-flow.mjs` — signs in with a real supabase-js grant and drives
  the operating flow through the gateway using the exact request shapes the
  shell's client builds (`app/src/lib/designpro-api.ts`): register the WrapBox
  recipient, create the Calls 1-7 request, poll to `outputs_ready`, read the
  signed views, hand off to Calls 8-12.

- `live-ui-check.mjs` — renders the deployed site in Chromium and asserts the
  UI requirements: DesignProAI title and branding, no RestylePro product names,
  no 404s, no failing `/api` calls, and the mobile shell. Screenshots land in
  the scratchpad.

- `live-tunnel.mjs` — a local TLS reverse proxy for the production hostnames.
  A sandboxed browser usually has no outbound egress while Node does, so
  Chromium is started with
  `--host-resolver-rules="MAP os.designproai.com 127.0.0.1:8443, ..."`,
  `--ignore-certificate-errors` and `--no-proxy-server`, and every byte it
  renders still comes from the live host.

  Do not rewrite Origin in the tunnel. Pointing it at the upstream makes
  Supabase answer with an Access-Control-Allow-Origin the page does not match,
  and the browser rejects the token exchange -- which presents as a broken
  login rather than as a proxy fault.

Run them from `app/` so `playwright-core` resolves:

    node ../ops/verify/live-tunnel.mjs &
    OP_EMAIL=... OP_PASSWORD=... node ../ops/verify/live-ui-check.mjs
