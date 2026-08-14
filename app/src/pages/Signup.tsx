import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackCompleteRegistration } from "@/lib/pixel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Trash2, ChevronDown, ChevronUp } from "lucide-react";

const Signup = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Klaviyo "claim your dashboard" deep-link:
  //   /signup?email=jane@example.com&wpw=1
  // - email: prefill the email field
  // - wpw=1: after signup, auto-run the WPW link flow and land on
  //   /designpro so they can spend their 3 welcome tokens immediately.
  //   (Previously sent them to /dashboard/my-orders which is empty for
  //   anyone whose signup email doesn't match a Woo customer record —
  //   that was 7 of 8 first-day signups.)
  const prefillEmail = searchParams.get("email") || "";
  const isWpwFlow = searchParams.get("wpw") === "1";

  const returnTo =
    (location.state as { from?: string } | null)?.from ||
    (isWpwFlow ? "/designpro" : "/designpro/premium");

  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [taxId, setTaxId] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [showShopDetails, setShowShopDetails] = useState(false);

  // If the user changes the URL email param (e.g. follows a different
  // Klaviyo link), keep the form in sync without overwriting their typing.
  useEffect(() => {
    if (prefillEmail && !email) setEmail(prefillEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillEmail]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${returnTo}`,
          data: {
            company_name: companyName.trim() || undefined,
            owner_name: ownerName.trim() || undefined,
            address: address.trim() || undefined,
            phone: phone.trim() || undefined,
            sms_opt_in: smsOptIn,
            tax_id: taxId.trim() || undefined,
            country: country.trim() || undefined,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        trackCompleteRegistration();
        // Create shop profile with company name and logo
        if (companyName.trim() || logoFile) {
          let logoUrl: string | null = null;

          if (logoFile) {
            const fileExt = logoFile.name.split('.').pop();
            const fileName = `${data.user.id}/shop-logo.${fileExt}`;
            const { error: uploadError } = await supabase.storage
              .from('renders')
              .upload(fileName, logoFile, { upsert: true });

            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage
                .from('renders')
                .getPublicUrl(fileName);
              logoUrl = publicUrl;
            }
          }

          await supabase.from("shop_profiles").upsert({
            user_id: data.user.id,
            shop_name: companyName.trim() || null,
            shop_logo_url: logoUrl,
            owner_name: ownerName.trim() || null,
            address: address.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            sms_opt_in: smsOptIn,
          }, { onConflict: "user_id" });
        } else {
          // Even without logo/companyName, persist contact + SMS opt-in
          await supabase.from("shop_profiles").upsert({
            user_id: data.user.id,
            owner_name: ownerName.trim() || null,
            address: address.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            sms_opt_in: smsOptIn,
          }, { onConflict: "user_id" });
        }

        // Grant the 3-token welcome bundle to every new signup. The edge
        // function is idempotent — a re-run from a network retry won't
        // double-grant. WPW-linked users get their separate wpw_signup_grant
        // via useAutoLinkWpw after wpw-oauth-link confirms a woo_customer_id.
        try {
          await supabase.functions.invoke("grant-welcome-tokens");
        } catch (grantErr) {
          console.warn("[signup] welcome token grant failed", grantErr);
          // Non-fatal — useAutoLinkWpw / dashboard hooks will retry.
        }

        // If this signup came from the Klaviyo "claim your dashboard"
        // flow (?wpw=1), auto-run the WPW link step so the customer's
        // order history shows up immediately on /dashboard/my-orders.
        // We fire-and-forget — the dashboard page will re-check if the
        // link isn't ready yet.
        if (isWpwFlow) {
          try {
            await supabase.functions.invoke("wpw-oauth-link", {
              body: { mode: "lookup" },
            });
          } catch (linkErr) {
            console.warn("[signup] wpw auto-link failed", linkErr);
            // Non-fatal — user can still link manually from /dashboard/my-orders
          }
          toast.success("Account created — pulling in your WePrintWraps orders… Use code WELCOME10 for 10% off any plan.");
        } else {
          toast.success("Account created — 3 free design tokens are in your dashboard. Use code WELCOME10 for 10% off any plan. Check your email to confirm.");
        }
        navigate(returnTo);
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      toast.error(error.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Create Account - RestyleProAI | AI Vehicle Wrap Design</title>
        <meta name="description" content="Create your free RestyleProAI account. Start designing professional vehicle wraps with AI in 60 seconds. No design skills required." />
        <link rel="canonical" href="https://www.restyleproai.com/signup" />
        <meta property="og:title" content="Get Started Free - RestyleProAI" />
        <meta property="og:description" content="Create your free account and start designing vehicle wraps with AI. From prompt to print-ready files in minutes." />
      </Helmet>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="text-center mb-4">
              <div className="text-[11px] font-semibold tracking-[0.2em] uppercase text-cyan-300/90">
                WPW × RestylePro Connect Portal
              </div>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <img src="/characters/sproket/sproket-rocket-wave.png" alt="SPROKET" className="w-12 h-12 object-contain" />
              <h1 className="text-2xl font-bold text-foreground">
                Create Account
              </h1>
            </div>

            <div className="mb-5 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs leading-relaxed">
              <div className="font-semibold text-cyan-300 mb-1">
                Ordered from WePrintWraps before? Use the same email.
              </div>
              <div className="text-muted-foreground">
                Sign up with the same email you've used at WePrintWraps.com and
                we'll auto-link your account — your full WPW order history and
                3 free design tokens ($75 value) will be waiting in your
                dashboard.
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1"
                />
                <p className="text-xs text-cyan-300/80 mt-1">
                  Use the same email as your WePrintWraps.com account so we can
                  auto-link your past orders.
                </p>
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum 6 characters
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Checkbox
                  id="sms-opt-in"
                  checked={smsOptIn}
                  onCheckedChange={(checked) => setSmsOptIn(checked === true)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <Label htmlFor="sms-opt-in" className="text-sm font-medium cursor-pointer">
                    Text me updates, freebies, and design drops
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    We'll text you when new tools ship, when free render credits drop, and when we send out sample wraps. Reply STOP anytime.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowShopDetails((v) => !v)}
                className="flex items-center justify-between w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
                aria-expanded={showShopDetails}
              >
                <span>
                  Add shop details <span className="text-muted-foreground/70 font-normal">(optional — speeds up freebies + samples)</span>
                </span>
                {showShopDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showShopDetails && (
                <div className="space-y-4 border-l-2 border-border pl-4">
                  <div>
                    <Label htmlFor="company-name">Shop Name</Label>
                    <Input
                      id="company-name"
                      type="text"
                      placeholder="Your wrap shop or business name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="owner-name">Your Name</Label>
                    <Input
                      id="owner-name"
                      type="text"
                      placeholder="First and last name"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      type="text"
                      placeholder="Street, City, State, ZIP"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      We ship freebies + sample drops to this address.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 555-5555"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label>Shop Logo</Label>
                    <div className="flex items-center gap-3 mt-1">
                      {logoPreview ? (
                        <div className="relative">
                          <img
                            src={logoPreview}
                            alt="Logo preview"
                            className="h-12 w-auto max-w-[140px] object-contain border rounded-lg p-1"
                          />
                          <button
                            type="button"
                            onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                            className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-destructive text-white rounded-full flex items-center justify-center"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <Label htmlFor="signup-logo-upload" className="cursor-pointer">
                          <div className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-muted transition-colors text-sm">
                            <Upload className="h-4 w-4" />
                            Upload Logo
                          </div>
                          <input
                            id="signup-logo-upload"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLogoChange}
                          />
                        </Label>
                      )}
                      <p className="text-xs text-muted-foreground">
                        PNG or SVG, transparent background recommended
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="tax-id">Tax ID / EIN</Label>
                    <Input
                      id="tax-id"
                      type="text"
                      placeholder="e.g., 12-3456789"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      type="text"
                      placeholder="e.g., United States"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? "Creating account..." : "Start Free — 3 Tokens Inside"}
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                Free account · 3 design tokens ($75 value) · No card required
              </p>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
};

export default Signup;
