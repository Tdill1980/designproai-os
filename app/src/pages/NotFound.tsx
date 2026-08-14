import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, Factory } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Helmet>
        <title>Page Not Found - DesignProAI</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="text-center max-w-md">
        {/* Sproket character */}
        <img
          src="/characters/ace-v2.png"
          alt="Sproket"
          className="w-32 h-32 mx-auto mb-6 rounded-full border-2 border-cyan-500/30 shadow-[0_0_20px_rgba(0,200,255,0.15)] object-cover"
        />

        <h1 className="text-6xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent mb-3">
          404
        </h1>
        <p className="text-lg font-semibold text-foreground mb-2">
          Whoa, wrong turn!
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          Looks like this page took a detour. Don't worry — I'll get you back on track.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            asChild
            className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white gap-2"
          >
            <Link to="/designpro/jobs">
              <Factory className="w-4 h-4" />
              Production jobs
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2 border-border">
            <Link to="/">
              <Home className="w-4 h-4" />
              Home
            </Link>
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-border"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Button>
        </div>

        {/* The shell was copied from a suite with far more surfaces than this
            system serves, so an old link can still land here. Name the
            operating path explicitly rather than leaving the operator to
            guess which of the old tools survived. */}
        <div className="mt-8 border-t border-border pt-6 text-left">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            The DesignProAI operating path
          </p>
          <ul className="space-y-2 text-sm">
            {[
              ["/designpro/generate", "Generate a design — seven photoreal source views"],
              ["/designpro/revisions/new", "Upload seven views you already own"],
              ["/designpro/jobs", "Production jobs — proof, panels, QC and output"],
              ["/designpro/genie-qc", "GENIE exact geometry validation"],
              ["/designpro/wrapbox", "WrapBox — delivered production packs"],
            ].map(([route, label]) => (
              <li key={route}>
                <Link to={route} className="text-primary hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
