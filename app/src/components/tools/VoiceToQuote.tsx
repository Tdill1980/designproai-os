/**
 * VoiceToQuote — Push-button speech-to-form autofill (Dark theme)
 *
 * Uses the browser's built-in Web Speech API (SpeechRecognition).
 * Zero cost, no AI, no API calls. Works in Chrome, Edge, Safari.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getUniqueMakes, getModelsForMake } from "@/data/vehicle-measurements";

// ── Types ──────────────────────────────────────────────────────────

interface VoiceToQuoteResult {
  year: string | null;
  make: string | null;
  model: string | null;
  finish: string | null;
  service: string | null;
  colorName: string | null;
  raw: string;
}

interface VoiceToQuoteProps {
  onResult: (result: VoiceToQuoteResult) => void;
  className?: string;
}

// ── Make aliases for speech recognition ────────────────────────────

const MAKE_ALIASES: Record<string, string[]> = {
  "BMW": ["bmw", "beamer", "bimmer", "b m w"],
  "Mercedes-Benz": ["mercedes", "benz", "merc", "mercedes benz"],
  "Porsche": ["porsche"],
  "Audi": ["audi"],
  "Tesla": ["tesla"],
  "Ford": ["ford"],
  "Chevrolet": ["chevy", "chevrolet", "chev"],
  "Dodge": ["dodge"],
  "Toyota": ["toyota"],
  "Honda": ["honda"],
  "Lexus": ["lexus"],
  "Infiniti": ["infiniti", "infinity"],
  "Nissan": ["nissan"],
  "Jeep": ["jeep"],
  "Ram": ["ram"],
  "GMC": ["gmc", "g m c"],
  "Cadillac": ["cadillac", "caddy"],
  "Volkswagen": ["volkswagen", "vw", "v w"],
  "Hyundai": ["hyundai", "hyundai"],
  "Kia": ["kia"],
  "Subaru": ["subaru"],
  "Mazda": ["mazda"],
  "Acura": ["acura"],
  "Lamborghini": ["lamborghini", "lambo"],
  "Ferrari": ["ferrari"],
  "McLaren": ["mclaren", "mcclarren"],
  "Rolls-Royce": ["rolls royce", "rolls"],
  "Bentley": ["bentley"],
  "Maserati": ["maserati"],
  "Land Rover": ["land rover", "range rover"],
  "Jaguar": ["jaguar", "jag"],
  "Volvo": ["volvo"],
  "Lincoln": ["lincoln"],
  "Chrysler": ["chrysler"],
  "Buick": ["buick"],
  "Genesis": ["genesis"],
  "Rivian": ["rivian"],
  "Lucid": ["lucid"],
};

const MODEL_ALIASES: Record<string, string[]> = {
  "Mustang": ["mustang"], "F-150": ["f150", "f 150", "f one fifty"],
  "Camaro": ["camaro"], "Corvette": ["corvette", "vette"],
  "Challenger": ["challenger"], "Charger": ["charger"],
  "Model 3": ["model 3", "model three"], "Model Y": ["model y", "model why"],
  "Model S": ["model s"], "Model X": ["model x"],
  "Cybertruck": ["cybertruck", "cyber truck"],
  "Civic": ["civic"], "Accord": ["accord"],
  "Camry": ["camry"], "Supra": ["supra"], "4Runner": ["4runner", "4 runner", "forerunner"],
  "Wrangler": ["wrangler"], "Grand Cherokee": ["grand cherokee"],
  "911": ["911", "nine eleven", "nine one one"],
  "Cayenne": ["cayenne"], "Macan": ["macan"], "Taycan": ["taycan"],
  "M3": ["m3", "m three"], "M4": ["m4", "m four"], "M5": ["m5"],
  "X5": ["x5", "x five"], "X3": ["x3"],
  "C-Class": ["c class", "c300", "c43", "c63"],
  "E-Class": ["e class", "e350", "e63"],
  "S-Class": ["s class", "s500", "s580"],
  "GLE": ["gle"], "AMG GT": ["amg gt", "amg"],
  "Urus": ["urus"], "Huracan": ["huracan"],
  "Silverado": ["silverado"], "Tahoe": ["tahoe"],
  "Escalade": ["escalade"], "Navigator": ["navigator"],
  "Range Rover": ["range rover"], "Defender": ["defender"],
  "Bronco": ["bronco"], "Raptor": ["raptor"],
  "Tacoma": ["tacoma"], "Tundra": ["tundra"],
  "Type R": ["type r"],
};

const FINISH_KEYWORDS: Record<string, string[]> = {
  "Gloss": ["gloss", "glossy", "shiny"],
  "Satin": ["satin"],
  "Matte": ["matte", "mat", "flat"],
  "Metallic": ["metallic", "metal"],
  "Chrome": ["chrome", "mirror"],
  "Color Flip": ["color flip", "color shift", "flip", "chameleon"],
  "Brushed": ["brushed", "brushed metal"],
  "Carbon": ["carbon", "carbon fiber"],
  "Textured": ["textured", "texture"],
};

const SERVICE_KEYWORDS: Record<string, string[]> = {
  "Full Wrap": ["full wrap", "full body", "color change", "whole car", "complete wrap"],
  "Partial Wrap": ["partial wrap", "partial", "half wrap"],
  "Chrome Delete": ["chrome delete", "de-chrome", "blackout"],
  "Roof Wrap": ["roof wrap", "roof"],
  "Hood Wrap": ["hood wrap", "hood"],
  "PPF": ["ppf", "paint protection", "clear bra"],
};

const COLOR_KEYWORDS: Record<string, string[]> = {
  "Nardo Gray": ["nardo", "nardo gray", "nardo grey"],
  "Midnight Blue": ["midnight blue"],
  "Satin Black": ["satin black"],
  "Gloss Black": ["gloss black"],
  "Matte Black": ["matte black", "flat black"],
  "Racing Red": ["red", "racing red"],
  "Pearl White": ["pearl white", "white pearl"],
  "Miami Blue": ["miami blue"],
  "Riviera Blue": ["riviera blue"],
  "Army Green": ["army green", "military green", "olive"],
  "Orange": ["orange"],
  "Yellow": ["yellow"],
  "Purple": ["purple"],
  "Pink": ["pink"],
  "Teal": ["teal"],
  "Khaki Green": ["khaki", "khaki green"],
};

// ── Parser ─────────────────────────────────────────────────────────

function parseVoiceInput(transcript: string): VoiceToQuoteResult {
  const text = transcript.toLowerCase().trim();
  const allMakes = getUniqueMakes();

  const maxYear = new Date().getFullYear() + 2;
  const yearMatch = text.match(/\b(19[9]\d|20[0-3]\d)\b/);
  const year = yearMatch && parseInt(yearMatch[1]) <= maxYear ? yearMatch[1] : null;

  let make: string | null = null;
  for (const [canonical, aliases] of Object.entries(MAKE_ALIASES)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        const dbMatch = allMakes.find(m => m.toLowerCase() === canonical.toLowerCase());
        if (dbMatch) { make = dbMatch; break; }
      }
    }
    if (make) break;
  }
  if (!make) {
    for (const dbMake of allMakes) {
      if (text.includes(dbMake.toLowerCase())) { make = dbMake; break; }
    }
  }

  let model: string | null = null;
  if (make) {
    const dbModels = getModelsForMake(make);
    for (const [canonical, aliases] of Object.entries(MODEL_ALIASES)) {
      for (const alias of aliases) {
        if (text.includes(alias)) {
          const dbMatch = dbModels.find(m => m.toLowerCase() === canonical.toLowerCase());
          if (dbMatch) { model = dbMatch; break; }
        }
      }
      if (model) break;
    }
    if (!model) {
      const sorted = [...dbModels].sort((a, b) => b.length - a.length);
      for (const dbModel of sorted) {
        if (text.includes(dbModel.toLowerCase())) { model = dbModel; break; }
      }
    }
  }

  let finish: string | null = null;
  for (const [canonical, keywords] of Object.entries(FINISH_KEYWORDS)) {
    for (const kw of keywords) { if (text.includes(kw)) { finish = canonical; break; } }
    if (finish) break;
  }

  let service: string | null = null;
  for (const [canonical, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    for (const kw of keywords) { if (text.includes(kw)) { service = canonical; break; } }
    if (service) break;
  }

  let colorName: string | null = null;
  for (const [canonical, keywords] of Object.entries(COLOR_KEYWORDS)) {
    for (const kw of keywords) { if (text.includes(kw)) { colorName = canonical; break; } }
    if (colorName) break;
  }

  return { year, make, model, finish, service, colorName, raw: transcript };
}

// ── Component ──────────────────────────────────────────────────────

type ListenState = "idle" | "listening" | "processing" | "done" | "error";

export const VoiceToQuote = ({ onResult, className }: VoiceToQuoteProps) => {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  const [parsedFields, setParsedFields] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const isSupported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setErrorMsg("Speech recognition not supported. Use Chrome, Edge, or Safari.");
      setState("error");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState("listening");
      setTranscript("");
      setParsedFields([]);
      setErrorMsg("");
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else interimTranscript += event.results[i][0].transcript;
      }
      setTranscript(finalTranscript || interimTranscript);
      transcriptRef.current = finalTranscript || interimTranscript;
    };

    recognition.onend = () => {
      setState("processing");
      const finalText = transcriptRef.current;
      if (!finalText.trim()) { setState("idle"); return; }

      const result = parseVoiceInput(finalText);
      const fields: string[] = [];
      if (result.year) fields.push(`Year: ${result.year}`);
      if (result.make) fields.push(`Make: ${result.make}`);
      if (result.model) fields.push(`Model: ${result.model}`);
      if (result.finish) fields.push(`Finish: ${result.finish}`);
      if (result.colorName) fields.push(`Color: ${result.colorName}`);
      if (result.service) fields.push(`Service: ${result.service}`);
      setParsedFields(fields);

      onResultRef.current(result);
      setState("done");
      timeoutRef.current = setTimeout(() => { setState("idle"); setParsedFields([]); }, 3000);
    };

    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed") setErrorMsg("Microphone access denied.");
      else if (event.error === "no-speech") setErrorMsg("No speech detected. Tap and speak.");
      else setErrorMsg(`Error: ${event.error}`);
      setState("error");
      timeoutRef.current = setTimeout(() => setState("idle"), 3000);
    };

    recognitionRef.current = recognition;
    recognition.start();
    timeoutRef.current = setTimeout(() => { try { recognition.stop(); } catch {} }, 10000);
  }, [isSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleClick = () => {
    if (state === "listening") stopListening();
    else startListening();
  };

  if (!isSupported) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <button
        onClick={handleClick}
        type="button"
        disabled={state === "processing"}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all",
          state === "idle" && "bg-[#0d0d0d] border-[#1a1a1a] text-[#00C7FF] hover:bg-[#111] hover:border-[#00C7FF]/30",
          state === "listening" && "bg-red-500/10 border-red-500/30 text-red-400 animate-pulse",
          state === "processing" && "bg-[#0d0d0d] border-[#1a1a1a] text-white/40 cursor-wait",
          state === "done" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
          state === "error" && "bg-red-500/10 border-red-500/20 text-red-400",
        )}
      >
        {state === "idle" && (
          <>
            <Mic className="w-5 h-5 text-[#00C7FF]" />
            Voice to Quote — Tap & Speak
          </>
        )}
        {state === "listening" && (
          <>
            <MicOff className="w-5 h-5" />
            Listening... Tap to stop
            <span className="flex gap-1 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </>
        )}
        {state === "processing" && (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Parsing...
          </>
        )}
        {state === "done" && (
          <>
            <Check className="w-5 h-5" />
            Fields auto-filled!
          </>
        )}
        {state === "error" && (
          <>
            <AlertCircle className="w-5 h-5" />
            {errorMsg || "Try again"}
          </>
        )}
      </button>

      {/* Live transcript */}
      {state === "listening" && transcript && (
        <div className="bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2">
          <p className="text-xs text-white/50 italic">"{transcript}"</p>
        </div>
      )}

      {/* Parsed fields feedback */}
      {parsedFields.length > 0 && (state === "done" || state === "processing") && (
        <div className="flex flex-wrap gap-1.5">
          {parsedFields.map((field) => (
            <span key={field} className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
              {field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
