import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";

// Build stamp shown in the UI so you can tell which build is live.
// Stamp the checked-out source, including exact-SHA workflow checkouts where
// GITHUB_SHA can refer to a different merge or dispatch commit.
const sourceSha = (() => {
  try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return ""; }
})() || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
function buildId(): string {
  const sha = sourceSha;
  const short = sha ? sha.slice(0, 7) : "";
  const time = new Date().toISOString().slice(0, 16).replace("T", " ");
  return short ? `${short} · ${time} UTC` : `${time} UTC`;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), {
    name: "designpro-release-identity",
    generateBundle() {
      this.emitFile({type: "asset", fileName: "release.json", source: JSON.stringify({
        sourceSha: /^[0-9a-f]{40}$/.test(sourceSha) ? sourceSha : null,
      })});
    },
  }].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Deduplicate shared Radix internals so only one copy exists.
    // Multiple copies cause circular initialization (TDZ errors).
    dedupe: [
      "react",
      "react-dom",
      "@radix-ui/react-primitive",
      "@radix-ui/react-compose-refs",
      "@radix-ui/react-context",
      "@radix-ui/react-slot",
      "@radix-ui/react-collection",
      "@radix-ui/react-presence",
      "@radix-ui/react-dismissable-layer",
      "@radix-ui/react-focus-scope",
      "@radix-ui/react-portal",
      "@radix-ui/react-popper",
    ],
  },
  build: {
    rollupOptions: {
      treeshake: {
        // Treat all modules as having side effects to prevent Rollup
        // from reordering Radix UI / recharts initialization in a way
        // that causes TDZ "Cannot access before initialization" errors.
        moduleSideEffects: true,
      },
      output: {
        // Force recharts + d3 into their own vendor chunk so their
        // circular internal deps initialize together, preventing TDZ.
        manualChunks(id) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "recharts-vendor";
          }
        },
      },
    },
  },
}));
