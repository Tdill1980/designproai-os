/**
 * The second entry into production: seven views the operator already owns.
 *
 * Every file is hashed in the browser, stored through a single-use signed
 * intent, and verified byte-for-byte by the server before the job exists. The
 * seven must be seven different files — a duplicate is refused here and again
 * in the database.
 *
 * The expected logo inventory is frozen at the same moment. A zero-logo
 * inventory is only valid when the operator explicitly attests to it, because
 * "no logos found" and "no logos expected" are not the same claim.
 */
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import {
  ApiError,
  AssetIdentity,
  dpApi,
  GenieSurfaceKey,
  PRODUCTION_SURFACES,
  RenderRole,
  RENDER_ROLES,
  SURFACE_LABEL,
  uploadRevisionAsset,
} from "@/lib/designpro-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Notice, PageHead, Panel } from "@/components/designpro/surface";

type ExpectedLogo = {
  id: string;
  displayName: string;
  surfaceKey: GenieSurfaceKey;
  file?: File;
};

function Field({
  label,
  name,
  wide,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={name} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input id={name} name={name} className="mt-1.5" {...rest} />
    </div>
  );
}

export default function NewRevisionSource() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Partial<Record<RenderRole, File>>>({});
  const [logoMode, setLogoMode] = useState<"" | "none" | "listed">("");
  const [logos, setLogos] = useState<ExpectedLogo[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const allFiles = RENDER_ROLES.every((role) => files[role]);
  const logoInventoryComplete =
    logoMode === "none" ||
    (logoMode === "listed" &&
      logos.length > 0 &&
      logos.every((logo) => logo.displayName.trim() && logo.file));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allFiles) return setError("All seven distinct source views are required.");
    if (!logoInventoryComplete) {
      return setError("Explicitly confirm no logos or list and upload every expected logo.");
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const revisionId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const visualizationId = crypto.randomUUID();
    const renderAssets = {} as Record<RenderRole, AssetIdentity>;
    try {
      setProgress("Registering the confirmed WrapBox recipient…");
      const { delivery } = await dpApi.registerDeliveryRecipient({
        customerEmail: String(form.get("customerEmail") || "").trim().toLowerCase(),
        customerReference: String(form.get("customerReference") || "").trim(),
        verificationReference: String(form.get("verificationReference") || "").trim(),
        orderNumber: String(form.get("orderNumber") || "").trim(),
        designName: String(form.get("designName") || "").trim(),
      });

      for (const [index, role] of RENDER_ROLES.entries()) {
        setProgress(`Hashing and storing ${SURFACE_LABEL[role]} (${index + 1} of 7)…`);
        renderAssets[role] = await uploadRevisionAsset(revisionId, role, files[role]!);
      }
      if (new Set(Object.values(renderAssets).map((asset) => asset.contentHash)).size !== 7) {
        throw new Error("Every source view must be a different file.");
      }

      const expectedLogoInventory: Array<Record<string, unknown>> = [];
      if (logoMode === "listed") {
        for (const [index, logo] of logos.entries()) {
          setProgress(`Hashing and storing logo ${index + 1} of ${logos.length}…`);
          const asset = await uploadRevisionAsset(revisionId, "logo", logo.file!);
          const identityKey = `logo-${asset.contentHash.slice(0, 32)}`;
          expectedLogoInventory.push({
            placementKey: `${identityKey}@${logo.surfaceKey}`,
            identityKey,
            displayName: logo.displayName.trim(),
            surfaceKey: logo.surfaceKey,
            ...asset,
          });
        }
        const placements = expectedLogoInventory.map((logo) => logo.placementKey);
        if (new Set(placements).size !== placements.length) {
          throw new Error(
            "The same logo can appear on several surfaces, but each logo/surface placement must be unique.",
          );
        }
      }

      setProgress("Freezing the revision and starting the automatic build…");
      await dpApi.submitRevision({
        revisionId,
        generationId,
        visualizationId,
        expectedUpdatedAt: new Date().toISOString(),
        renderAssets,
        view: "all",
        instruction: String(form.get("instruction") || ""),
        idempotencyKey: `revision:${revisionId}`,
        revisionSnapshot: {
          contractVersion: "designpro.revision-snapshot.v1",
          vehicle: {
            year: String(form.get("year") || ""),
            make: String(form.get("make") || ""),
            model: String(form.get("model") || ""),
            type: String(form.get("type") || "car"),
          },
          surfaceOptions: { required: [...PRODUCTION_SURFACES] },
          finish: String(form.get("finish") || "standard"),
          bodyText: String(form.get("bodyText") || ""),
          orderNumber: delivery.orderNumber,
          logoInventoryAttestation: { mode: logoMode, attested: true },
          expectedLogoInventory,
          delivery,
        },
      });
      navigate(`/designpro/jobs/${generationId}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `The revision was refused (${cause.code}).`
          : cause instanceof Error
            ? cause.message
            : "The revision could not be submitted.",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="Immutable source"
        title="New revision source"
        description="These seven files become immutable inputs. The server builds the 2D proof and panels automatically."
        backTo="/designpro/jobs"
        backLabel="Production jobs"
      />

      <form className="flex flex-col gap-5" onSubmit={submit}>
        <Panel eyebrow="Vehicle identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Year" name="year" required />
            <Field label="Make" name="make" required />
            <Field label="Model" name="model" required />
            <div>
              <Label
                htmlFor="type"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Vehicle type
              </Label>
              <select
                id="type"
                name="type"
                defaultValue="car"
                required
                className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {["car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv", "trailer", "aircraft", "heavy_equipment"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {value.split("_").join(" ")}
                    </option>
                  ),
                )}
              </select>
            </div>
            <Field label="Finish" name="finish" defaultValue="standard" required />
            <div className="sm:col-span-2">
              <Label htmlFor="bodyText" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Required body text
              </Label>
              <Textarea id="bodyText" name="bodyText" rows={3} className="mt-1.5" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="instruction" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Revision instruction
              </Label>
              <Textarea id="instruction" name="instruction" rows={3} className="mt-1.5" />
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Immutable order + WrapBox recipient"
          title="Freeze the business order and confirmed customer account"
          description="Enter normal business information — never database IDs or hashes. The server normalizes the email, requires its confirmed DesignPro account, and hashes the order or payment reference without storing or returning the original."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Order #"
              name="orderNumber"
              pattern="[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}"
              maxLength={120}
              required
            />
            <Field
              label="Confirmed customer email"
              name="customerEmail"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
            />
            <Field label="Customer reference / name" name="customerReference" minLength={1} maxLength={160} required />
            <Field
              label="Order or payment verification reference"
              name="verificationReference"
              minLength={3}
              maxLength={256}
              autoComplete="off"
              spellCheck={false}
              required
              wide
            />
            <Field label="Design name" name="designName" maxLength={240} required wide />
          </div>
        </Panel>

        <Panel
          eyebrow="Seven distinct source views"
          title="Upload each actual view"
          description="PNG, JPEG or WebP. Maximum 25 MiB per file. The server verifies every byte hash before the job is created."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RENDER_ROLES.map((role) => (
              <label
                key={role}
                className={cn(
                  "cursor-pointer rounded-lg border border-dashed border-border bg-background p-4 transition hover:border-primary/60",
                  files[role] && "border-solid border-emerald-500/50 bg-emerald-500/5",
                )}
              >
                <span className="block text-sm font-semibold">{SURFACE_LABEL[role]}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  className="sr-only"
                  onChange={(event) =>
                    setFiles((current) => ({ ...current, [role]: event.target.files?.[0] }))
                  }
                />
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {files[role]?.name || "Choose file"}
                </span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Expected logo inventory · Call 10"
          title="Freeze the exact logo set"
          description="A zero-logo inventory is valid only when you explicitly attest that this design contains no logos."
        >
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="logoMode"
                className="mt-1"
                checked={logoMode === "none"}
                onChange={() => {
                  setLogoMode("none");
                  setLogos([]);
                }}
              />
              <span className="leading-6">This design has no logos.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="logoMode"
                className="mt-1"
                checked={logoMode === "listed"}
                onChange={() => {
                  setLogoMode("listed");
                  setLogos((current) =>
                    current.length
                      ? current
                      : [{ id: crypto.randomUUID(), displayName: "", surfaceKey: "driver" }],
                  );
                }}
              />
              <span className="leading-6">
                This design contains logos; I will list every required logo and surface.
              </span>
            </label>
          </div>

          {logoMode === "listed" && (
            <div className="mt-5 space-y-4">
              {logos.map((logo, index) => (
                <div key={logo.id} className="grid gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Logo identity / name
                    </Label>
                    <Input
                      className="mt-1.5"
                      value={logo.displayName}
                      required
                      placeholder="Example: Porsche wordmark"
                      onChange={(event) =>
                        setLogos((current) =>
                          current.map((item) =>
                            item.id === logo.id ? { ...item, displayName: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Required surface
                    </Label>
                    <select
                      value={logo.surfaceKey}
                      className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      onChange={(event) =>
                        setLogos((current) =>
                          current.map((item) =>
                            item.id === logo.id
                              ? { ...item, surfaceKey: event.target.value as GenieSurfaceKey }
                              : item,
                          ),
                        )
                      }
                    >
                      {PRODUCTION_SURFACES.map((key) => (
                        <option key={key} value={key}>
                          {SURFACE_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Exact stored logo file
                    </Label>
                    <Input
                      className="mt-1.5"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                      required
                      onChange={(event) =>
                        setLogos((current) =>
                          current.map((item) =>
                            item.id === logo.id ? { ...item, file: event.target.files?.[0] } : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogos((current) => current.filter((item) => item.id !== logo.id))}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove logo {index + 1}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setLogos((current) => [
                    ...current,
                    { id: crypto.randomUUID(), displayName: "", surfaceKey: "driver" },
                  ])
                }
              >
                Add another logo placement
              </Button>
            </div>
          )}
        </Panel>

        {error && <Notice tone="error">{error}</Notice>}
        {progress && <Notice>{progress}</Notice>}

        <div>
          <Button type="submit" size="lg" disabled={busy || !allFiles || !logoInventoryComplete}>
            {busy ? "Starting automatic build…" : "Freeze sources and start automatic build"}
          </Button>
        </div>
      </form>
    </div>
  );
}
