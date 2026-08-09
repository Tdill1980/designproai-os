# DesignProAI OS

This private repository is the standalone DesignProAI production operating
system. It has no Railway, RestylePro, Slack-agent, or browser-conductor
runtime dependency.

The server owns the durable automatic chain:

1. Verify seven distinct private source views.
2. Resolve human-validated Universal GENIE geometry.
3. Build the flat two-dimensional proof from per-surface masters.
4. Bind six unique driver, passenger, hood, roof, front, and rear panels to
   the proof, exact trim dimensions, five-inch bleed on every edge, and square
   footage calculated from raw dimensions.
5. Verify the frozen expected logo inventory.
6. Create the ProductionFlow job automatically.
7. Pause only for PanelPro preflight approval.
8. Build and verify the exact production file matrix.
9. Pause for final human QC, create the visible server stamp containing the
   canonical `DID-XXXXXXXX` DesignID and registered business Order #, build the
   deterministic ZIP, and deliver it through customer WrapBox.

Two fenced workers run independently of the browser. Closing a browser or
restarting a worker cannot discard completed stage receipts. The white web UI
only submits immutable inputs, reports status, shows private review artifacts,
approves the two human gates, and requests an explicit resume.

## Isolation

- Runtime and gateway deploy under `/opt/designproai`.
- Runtime ports `3001` and `3002`, and gateway `8787`, bind to loopback only.
- Caddy exposes the white UI and `/api/*`; `/worker/*` is an explicit 404.
- Calls 8–11 and production-file execution run inside the two fenced DesignProAI runtimes; no external VectorizIt, Railway conductor, or browser worker is required.
- No script in this repository stops RP processes, edits `/opt/restylepro`, or runs PR #4119.

## Validation and deployment

`npm test` runs the runtime, schema, gateway, UI, output, delivery, and server
boundary suites. GitHub Actions additionally applies every migration to a
fresh local Supabase shadow stack before producing a Git-SHA-bound release
archive. See [`ops/README.md`](ops/README.md) for the exact server sequence.

No release is production-proven until the real seven-view distressed-Porsche
canary completes through proof, six panels, logos, both QC gates, verified
outputs, stamped deterministic ZIP, and WrapBox delivery—then survives an
intentional worker interruption and resumes without regenerating accepted
artifacts.
