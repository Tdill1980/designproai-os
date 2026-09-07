/// <reference types="vite/client" />

// Injected by vite.config.ts `define` — the live build id (commit + time).
declare const __BUILD_ID__: string;

// The full commit SHA this bundle was built from, from git at build time.
// Empty string when git is unavailable; never a hand-edited literal.
declare const __COMMIT_SHA__: string;
