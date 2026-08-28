export function canonicalizeVehicle(
  make?: string | null,
  model?: string | null,
  _year?: string | null,
): string | null {
  if (!make && !model) return null;
  const m = (make || "").toLowerCase().trim();
  const mo = (model || "").toLowerCase().trim();

  const makeAliases: Record<string, string> = {
    "tesla": "Tesla",
    "chevy": "Chevrolet",
    "chevrolet": "Chevrolet",
    "gmc": "GMC",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "bmw": "BMW",
    "mercedes": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mb": "Mercedes-Benz",
    "ford": "Ford",
    "ram": "RAM",
    "dodge": "Dodge",
    "toyota": "Toyota",
    "honda": "Honda",
    "nissan": "Nissan",
    "porsche": "Porsche",
    "audi": "Audi",
    "lexus": "Lexus",
    "kia": "Kia",
    "hyundai": "Hyundai",
    "subaru": "Subaru",
    "jeep": "Jeep",
    "cadillac": "Cadillac",
    "buick": "Buick",
    "rivian": "Rivian",
    "lucid": "Lucid",
    "polestar": "Polestar",
  };

  // Brand-specific model normalizations — only the ones that actually
  // matter for vehicle SHAPE (so Gemini renders the correct geometry).
  const modelAliases: Record<string, Record<string, string>> = {
    "Tesla": {
      "cyber truck": "Cybertruck",
      "cybertruck": "Cybertruck",
      "cyber-truck": "Cybertruck",
      "ct": "Cybertruck",
      "model s": "Model S",
      "model 3": "Model 3",
      "model x": "Model X",
      "model y": "Model Y",
      "roadster": "Roadster",
      "semi": "Semi",
    },
    "Chevrolet": {
      "silverado": "Silverado 1500",
      "silverado 1500": "Silverado 1500",
      "silverado 2500": "Silverado 2500 HD",
      "silverado 3500": "Silverado 3500 HD",
      "corvette": "Corvette",
      "camaro": "Camaro",
      "tahoe": "Tahoe",
      "suburban": "Suburban",
    },
    "Ford": {
      "f150": "F-150",
      "f 150": "F-150",
      "f-150": "F-150",
      "f250": "F-250",
      "f-250": "F-250",
      "f350": "F-350",
      "f-350": "F-350",
      "mustang": "Mustang",
      "bronco": "Bronco",
    },
    "RAM": {
      "1500": "1500",
      "2500": "2500",
      "3500": "3500",
      "trx": "1500 TRX",
    },
    "GMC": {
      "sierra": "Sierra 1500",
      "sierra 1500": "Sierra 1500",
      "yukon": "Yukon",
      "hummer ev": "Hummer EV",
    },
  };

  const canonicalMake = makeAliases[m] ?? titleCase(m);

  let canonicalModel = "";
  if (mo) {
    const brandTable = modelAliases[canonicalMake];
    canonicalModel = brandTable?.[mo] ?? titleCase(mo);
  }

  const out = [canonicalMake, canonicalModel].filter(Boolean).join(" ");
  return out || null;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
