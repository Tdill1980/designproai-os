import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Type } from "lucide-react";
import { FONT_PRESETS } from "./types";

interface FontSelectorProps {
  value: string;
  onChange: (font: string) => void;
  label?: string;
}

export function FontSelector({ value, onChange, label = "Font" }: FontSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allFonts = FONT_PRESETS.flatMap((cat) => cat.fonts);
  const filtered = search
    ? allFonts.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : [];

  const handleSelect = (font: string) => {
    onChange(font);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="relative">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between h-9 px-3 rounded-md border border-border/30 bg-secondary text-sm text-left hover:border-border transition-colors"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground/60"}>
            {value || "Select or type a font..."}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-secondary border border-border/30 rounded-lg shadow-xl max-h-[320px] overflow-hidden flex flex-col">
            {/* Search / Custom input */}
            <div className="p-2 border-b border-border/30">
              <div className="relative">
                <Type className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                <Input
                  value={search || value}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    onChange(e.target.value);
                  }}
                  placeholder="Search or type custom font..."
                  className="h-8 pl-8 text-xs bg-secondary border-border/30"
                  autoFocus
                />
              </div>
            </div>

            {/* Font list */}
            <div className="overflow-y-auto flex-1">
              {search ? (
                // Filtered results
                filtered.length > 0 ? (
                  <div className="p-1">
                    {filtered.map((font) => (
                      <button
                        key={font}
                        onClick={() => handleSelect(font)}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-blue-500/10 transition-colors ${
                          value === font ? "text-blue-500 bg-blue-500/20" : "text-foreground"
                        }`}
                      >
                        {font}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    Using custom font: "{search}"
                  </p>
                )
              ) : (
                // Categorized list
                FONT_PRESETS.map((cat) => (
                  <div key={cat.category}>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {cat.category}
                    </p>
                    {cat.fonts.map((font) => (
                      <button
                        key={font}
                        onClick={() => handleSelect(font)}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-blue-500/10 transition-colors ${
                          value === font ? "text-blue-500 bg-blue-500/20" : "text-foreground"
                        }`}
                      >
                        {font}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Count */}
            <div className="p-2 border-t border-border/30 text-center">
              <p className="text-[10px] text-muted-foreground/60">
                {allFonts.length} preset fonts — or type any custom font name
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Click-outside to close */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
      )}
    </div>
  );
}
