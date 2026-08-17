/**
 * artboard-template-os.ts — Artboard panel template (the "angles" for artboard
 * mode). Instead of camera angles (view-angles-os.ts, used for 3D), this resolves
 * the FLAT PANEL layout + real per-side dimensions from our vehicle-dimensions
 * (PVO) database, keyed off the year/make/model entered in DesignPro.
 *
 * Used ONLY by design-panel-ai-generate's mode==='artboard' path.
 */

export interface ArtboardPanel {
  label: string;
  widthInches?: number;
  heightInches?: number;
}

const DEFAULT_PANELS: ArtboardPanel[] = [
  { label: "DRIVER SIDE" }, { label: "PASSENGER SIDE" }, { label: "HOOD" },
  { label: "ROOF" }, { label: "FRONT" }, { label: "REAR" },
];

const r1 = (n: number | null | undefined) => (n ? Math.round(n * 10) / 10 : undefined);

/**
 * Resolve every side's flat panel + real inches from the vehicle_dimensions
 * (PVO) table. Returns one panel per side of the entered make/model.
 */
export async function resolveArtboardPanels(
  client: any,
  year: string | number | undefined,
  make: string | undefined,
  model: string | undefined,
): Promise<ArtboardPanel[]> {
  try {
    if (!make || !model) return DEFAULT_PANELS;
    const yr = parseInt(String(year || "")) || 0;
    const { data } = await client
      .from("vehicle_dimensions")
      .select("year_start,year_end,side_width,side_height,hood_width,hood_length,roof_width,roof_length,back_width,back_height")
      .ilike("make", make)
      .ilike("model", `%${model}%`)
      .limit(25);
    if (!data || !data.length) return DEFAULT_PANELS;
    const row =
      data.find((r: any) => yr && r.year_start && r.year_end && yr >= r.year_start && yr <= r.year_end) ||
      data[0];
    if (!row?.side_width) return DEFAULT_PANELS;
    return [
      { label: "DRIVER SIDE", widthInches: r1(row.side_width), heightInches: r1(row.side_height) },
      { label: "PASSENGER SIDE", widthInches: r1(row.side_width), heightInches: r1(row.side_height) },
      { label: "HOOD", widthInches: r1(row.hood_width), heightInches: r1(row.hood_length) },
      { label: "ROOF", widthInches: r1(row.roof_width), heightInches: r1(row.roof_length) },
      { label: "FRONT", widthInches: r1(row.back_width), heightInches: r1(row.back_height) },
      { label: "REAR", widthInches: r1(row.back_width), heightInches: r1(row.back_height) },
    ];
  } catch (_e) {
    return DEFAULT_PANELS;
  }
}

/**
 * Load the gold-standard example artboards (clean + branded) from the
 * "wrap-files flat panel" bucket as Gemini inlineData parts (few-shot).
 */
export async function loadArtboardExamples(
  client: any,
  max = 2,
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const out: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  try {
    const { data: files } = await client.storage.from("wrap-files flat panel").list("", { limit: 10 });
    const imgs = (files || []).filter((f: any) => /\.(png|jpe?g|webp)$/i.test(f.name)).slice(0, max);
    for (const f of imgs) {
      const { data: blob } = await client.storage.from("wrap-files flat panel").download(f.name);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) continue;
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      out.push({ inlineData: { mimeType: (blob as any).type || "image/png", data: btoa(bin) } });
    }
  } catch (_e) { /* non-fatal */ }
  return out;
}
