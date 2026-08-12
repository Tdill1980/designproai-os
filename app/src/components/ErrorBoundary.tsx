import { Component, type ReactNode } from "react";
import { captureError } from "@/lib/errorCapture";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkError(error: Error | null): boolean {
  const msg = error?.message || "";
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("ChunkLoadError")
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App error boundary caught:", error, info.componentStack);

    // Persist React render errors to error_events (skips chunk/noise internally).
    // 'fatal' — a render error took down the page.
    if (!isChunkError(error)) {
      void captureError(error, {
        source: "react",
        severity: "fatal",
        componentStack: info.componentStack,
      });
    }

    // Auto-refresh on stale chunk load failures (e.g. after a new Vercel deploy)
    if (isChunkError(error)) {
      const hasRefreshed = sessionStorage.getItem("chunk-refresh");
      if (!hasRefreshed) {
        sessionStorage.setItem("chunk-refresh", "1");
        window.location.reload();
        return;
      }
      // Already tried refresh — clear flag for next time and show the error UI
      sessionStorage.removeItem("chunk-refresh");
    }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when children change (i.e. route navigation)
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ textAlign: "center", maxWidth: 480, padding: 32 }}>
            <h1 style={{ fontSize: 24, marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ color: "#999", marginBottom: 24 }}>
              {isChunkError(this.state.error)
                ? "A new version was deployed. Click below to load the latest version."
                : "We're working on fixing this. Please try refreshing the page."}
            </p>
            {this.state.error && !isChunkError(this.state.error) && (
              <p style={{ color: "#666", fontSize: 12, marginBottom: 16, fontFamily: "monospace", maxHeight: 120, overflow: "auto", textAlign: "left", background: "#1a1a1a", padding: 12, borderRadius: 6 }}>
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => {
                sessionStorage.removeItem("chunk-refresh");
                sessionStorage.removeItem("chunk_reload");
                window.location.reload();
              }}
              style={{ padding: "10px 24px", background: "#06b6d4", color: "#000", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
            >
              {isChunkError(this.state.error) ? "Load Latest Version" : "Refresh Page"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
