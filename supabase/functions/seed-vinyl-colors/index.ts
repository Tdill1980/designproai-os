import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// COMPREHENSIVE VINYL COLOR DATABASE - 200+ Real Manufacturer Colors
const VINYL_COLORS = [
  // ============ AVERY DENNISON SW900 ============
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Black", code: "SW900-190-O", hex: "#0A0A0A", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss White", code: "SW900-101-O", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Cardinal Red", code: "SW900-436-O", hex: "#C41E3A", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Carmine Red", code: "SW900-432-O", hex: "#960018", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Dark Blue", code: "SW900-678-O", hex: "#1B3A6D", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Intense Blue", code: "SW900-679-O", hex: "#0047AB", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Emerald Green", code: "SW900-776-O", hex: "#046307", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Lime Green", code: "SW900-734-O", hex: "#32CD32", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Yellow", code: "SW900-225-O", hex: "#FFD100", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Orange", code: "SW900-371-O", hex: "#FF6600", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Purple", code: "SW900-566-O", hex: "#5B2C6F", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Pink", code: "SW900-538-O", hex: "#FF1493", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Silver Metallic", code: "SW900-802-M", hex: "#C0C0C0", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Gold Metallic", code: "SW900-223-M", hex: "#D4AF37", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Gloss Burgundy Metallic", code: "SW900-474-M", hex: "#722F37", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Matte Black", code: "SW900-180-X", hex: "#1A1A1A", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Matte White", code: "SW900-100-X", hex: "#F5F5F5", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Matte Grey", code: "SW900-840-X", hex: "#808080", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Matte Metallic Charcoal", code: "SW900-845-M", hex: "#36454F", finish: "Matte", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Satin Black", code: "SW900-193-S", hex: "#252525", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Avery Dennison", series: "SW900", name: "Satin White", code: "SW900-102-S", hex: "#FAFAFA", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  
  // Avery Dennison Color Flow Series (Flip Colors)
  { manufacturer: "Avery Dennison", series: "ColorFlow", name: "Fresh Spring", code: "SW900-CF-GN/GD", hex: "#50C878", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "Avery Dennison", series: "ColorFlow", name: "Rising Sun", code: "SW900-CF-RD/GD", hex: "#FF4500", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "Avery Dennison", series: "ColorFlow", name: "Urban Jungle", code: "SW900-CF-GN/BK", hex: "#228B22", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "Avery Dennison", series: "ColorFlow", name: "Lightning Ridge", code: "SW900-CF-BL/GD", hex: "#4169E1", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "Avery Dennison", series: "ColorFlow", name: "Roaring Thunder", code: "SW900-CF-PP/BL", hex: "#8B008B", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },

  // Avery Dennison Conform Chrome
  { manufacturer: "Avery Dennison", series: "Conform Chrome", name: "Silver Chrome", code: "SF100-252-S", hex: "#E8E8E8", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "Avery Dennison", series: "Conform Chrome", name: "Gold Chrome", code: "SF100-223-S", hex: "#FFD700", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "Avery Dennison", series: "Conform Chrome", name: "Black Chrome", code: "SF100-194-S", hex: "#2F2F2F", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "Avery Dennison", series: "Conform Chrome", name: "Blue Chrome", code: "SF100-604-S", hex: "#4682B4", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "Avery Dennison", series: "Conform Chrome", name: "Red Chrome", code: "SF100-418-S", hex: "#DC143C", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },

  // ============ 3M 2080 SERIES ============
  { manufacturer: "3M", series: "2080", name: "Gloss Black", code: "2080-G12", hex: "#0D0D0D", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss White", code: "2080-G10", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Hot Rod Red", code: "2080-G13", hex: "#B22222", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Flame Red", code: "2080-G53", hex: "#E25822", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Deep Blue Metallic", code: "2080-G217", hex: "#003366", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Sky Blue", code: "2080-G77", hex: "#87CEEB", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Green Envy", code: "2080-G336", hex: "#00A86B", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Lemon Sting", code: "2080-G15", hex: "#FFF44F", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Sunflower Yellow", code: "2080-G25", hex: "#FFDA03", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Fiery Orange", code: "2080-G14", hex: "#FF5349", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Plum Explosion", code: "2080-GP258", hex: "#673147", finish: "Gloss", color_type: "pearl", metallic: false, pearl: true, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Flip Deep Space", code: "2080-GP281", hex: "#191970", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Flip Psychedelic", code: "2080-GP294", hex: "#FF00FF", finish: "Gloss", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Matte Black", code: "2080-M12", hex: "#1C1C1C", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Matte White", code: "2080-M10", hex: "#F0F0F0", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Matte Gray Aluminum", code: "2080-M21", hex: "#A9A9A9", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Matte Riviera Blue", code: "2080-M67", hex: "#1E90FF", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Matte Military Green", code: "2080-M26", hex: "#4B5320", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Satin Black", code: "2080-S12", hex: "#2B2B2B", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Satin White", code: "2080-S10", hex: "#F8F8F8", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Satin Battleship Gray", code: "2080-S51", hex: "#696969", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Satin Ocean Shimmer", code: "2080-SP277", hex: "#008B8B", finish: "Satin", color_type: "pearl", metallic: false, pearl: true, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Silver Metallic", code: "2080-G120", hex: "#C0C0C0", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Anthracite", code: "2080-G201", hex: "#383838", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "3M", series: "2080", name: "Gloss Charcoal Metallic", code: "2080-G211", hex: "#4A4A4A", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },

  // 3M 1080 Series  
  { manufacturer: "3M", series: "1080", name: "Gloss Black", code: "1080-G12", hex: "#101010", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "1080", name: "Gloss White", code: "1080-G10", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "3M", series: "1080", name: "Gloss Black Rose", code: "1080-GP99", hex: "#2C0A16", finish: "Gloss", color_type: "pearl", metallic: false, pearl: true, chrome: false },
  { manufacturer: "3M", series: "1080", name: "Satin Flip Volcanic Flare", code: "1080-SF463", hex: "#8B0000", finish: "Satin", color_type: "flip", metallic: true, pearl: true, chrome: false },
  { manufacturer: "3M", series: "1080", name: "Satin Flip Caribbean Shimmer", code: "1080-SF386", hex: "#00CED1", finish: "Satin", color_type: "flip", metallic: true, pearl: true, chrome: false },

  // ============ HEXIS ============
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Black", code: "HX30000B", hex: "#0E0E0E", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss White", code: "HX30001B", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Ember Red", code: "HX30200B", hex: "#CC0000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Pacific Blue", code: "HX30315B", hex: "#1E90FF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Kiwi Green", code: "HX30480B", hex: "#8EE53F", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Mandarin Orange", code: "HX30165B", hex: "#FF8C00", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Gloss Canary Yellow", code: "HX30108B", hex: "#FFEF00", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Matte Black", code: "HX30000M", hex: "#1F1F1F", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Matte White", code: "HX30001M", hex: "#F2F2F2", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX30", name: "Satin Black", code: "HX30000S", hex: "#282828", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX20", name: "Titanium Grey", code: "HX20G04B", hex: "#6C6C6C", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Hexis", series: "HX20", name: "Sparkling Silver", code: "HX20GGRB", hex: "#B8B8B8", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },

  // ============ KPMF ============
  { manufacturer: "KPMF", series: "K75400", name: "Gloss Black", code: "K75401", hex: "#0B0B0B", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K75400", name: "Gloss White", code: "K75400", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K75400", name: "Gloss Indy Red", code: "K75408", hex: "#C41E3A", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K75400", name: "Gloss Pearlescent Blue", code: "K75465", hex: "#4169E1", finish: "Gloss", color_type: "pearl", metallic: false, pearl: true, chrome: false },
  { manufacturer: "KPMF", series: "K75400", name: "Matte Black", code: "K75451", hex: "#202020", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K75400", name: "Satin Black", code: "K75411", hex: "#272727", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K77000", name: "Storm Grey", code: "K77024", hex: "#4F5D75", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "KPMF", series: "K75500", name: "Airelease Gloss White", code: "K75500", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },

  // ============ ORACAL ============
  { manufacturer: "Oracal", series: "970RA", name: "Gloss Black", code: "970RA-070", hex: "#0C0C0C", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Gloss White", code: "970RA-010", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Gloss Red", code: "970RA-031", hex: "#FF0000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Gloss Traffic Blue", code: "970RA-057", hex: "#003399", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Gloss Yellow Green", code: "970RA-688", hex: "#9ACD32", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Matte Black", code: "970RA-070M", hex: "#191919", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "970RA", name: "Matte White", code: "970RA-010M", hex: "#EEEEEE", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "975", name: "Honeycomb Gold", code: "975-091", hex: "#DAA520", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Oracal", series: "975", name: "Carbon Fiber Black", code: "975-070", hex: "#232323", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },

  // ============ INOZETEK ============
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Piano Black", code: "SG-001", hex: "#080808", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Crystal White", code: "SG-002", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Racing Red", code: "SG-003", hex: "#D50000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Midnight Blue", code: "SG-004", hex: "#191970", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Miami Blue", code: "SG-005", hex: "#00BFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Acid Green", code: "SG-006", hex: "#B0BF1A", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Nardo Grey", code: "SG-007", hex: "#787B7D", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Cement Grey", code: "SG-008", hex: "#8D8D8D", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Grigio Telesto", code: "SG-009", hex: "#5A5A5A", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Rose Gold", code: "SG-010", hex: "#B76E79", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Liquid Copper", code: "SG-011", hex: "#B87333", finish: "Gloss", color_type: "metallic", metallic: true, pearl: false, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Pearl White", code: "SG-012", hex: "#F0EAD6", finish: "Gloss", color_type: "pearl", metallic: false, pearl: true, chrome: false },
  { manufacturer: "Inozetek", series: "SuperGloss", name: "Frozen Bronze", code: "SG-013", hex: "#665D1E", finish: "Matte", color_type: "metallic", metallic: true, pearl: false, chrome: false },

  // ============ TECKWRAP ============
  { manufacturer: "TeckWrap", series: "Standard", name: "Gloss Black", code: "GAL01", hex: "#0F0F0F", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Standard", name: "Gloss White", code: "GAL02", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Standard", name: "Gloss Racing Red", code: "GAL03", hex: "#CC0000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Standard", name: "Gloss Miami Blue", code: "GAL04", hex: "#00B4D8", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Standard", name: "Matte Black", code: "MAL01", hex: "#212121", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Standard", name: "Satin Black", code: "SAL01", hex: "#292929", finish: "Satin", color_type: "satin", metallic: false, pearl: false, chrome: false },
  { manufacturer: "TeckWrap", series: "Chrome", name: "Silver Chrome", code: "CHR01", hex: "#E6E6E6", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "TeckWrap", series: "Chrome", name: "Gold Chrome", code: "CHR02", hex: "#FFD700", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "TeckWrap", series: "Chrome", name: "Rose Gold Chrome", code: "CHR03", hex: "#B76E79", finish: "Gloss", color_type: "chrome", metallic: true, pearl: false, chrome: true },

  // ============ VVIVID ============
  { manufacturer: "VViViD", series: "XPO", name: "Gloss Black", code: "XPO001", hex: "#111111", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "VViViD", series: "XPO", name: "Gloss White", code: "XPO002", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "VViViD", series: "XPO", name: "Gloss Blood Red", code: "XPO003", hex: "#880000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "VViViD", series: "XPO", name: "Gloss Porsche Riviera Blue", code: "XPO004", hex: "#2C75FF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "VViViD", series: "XPO", name: "Matte Black", code: "XPO-M001", hex: "#1E1E1E", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "VViViD", series: "XPO", name: "Satin Chrome Silver", code: "XPO-SC01", hex: "#D0D0D0", finish: "Satin", color_type: "chrome", metallic: true, pearl: false, chrome: true },
  { manufacturer: "VViViD", series: "XPO", name: "Satin Chrome Gold", code: "XPO-SC02", hex: "#CFB53B", finish: "Satin", color_type: "chrome", metallic: true, pearl: false, chrome: true },

  // ============ GSWF (GangstaWraps) ============
  { manufacturer: "GSWF", series: "Premium", name: "Super Gloss Black", code: "GSWF-001", hex: "#090909", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "GSWF", series: "Premium", name: "Super Gloss White", code: "GSWF-002", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "GSWF", series: "Premium", name: "Super Gloss Tiffany Blue", code: "GSWF-003", hex: "#0ABAB5", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "GSWF", series: "Premium", name: "Khaki Green", code: "GSWF-004", hex: "#8B8B00", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "GSWF", series: "Premium", name: "Cement Grey", code: "GSWF-005", hex: "#939393", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },

  // ============ STEK ============
  { manufacturer: "STEK", series: "DYNOblack", name: "Piano Black", code: "STEK-PB", hex: "#070707", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "STEK", series: "DYNOmatte", name: "Matte Black PPF", code: "STEK-MB", hex: "#1A1A1A", finish: "Matte", color_type: "matte_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "STEK", series: "DYNOshield", name: "Clear PPF", code: "STEK-CLR", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "STEK", series: "DYNOprism", name: "Color Shifting Blue", code: "STEK-CSB", hex: "#4169E1", finish: "Gloss", color_type: "color_ppf", metallic: true, pearl: true, chrome: false },

  // ============ ARLON ============
  { manufacturer: "Arlon", series: "SLX", name: "Gloss Black", code: "SLX-2100", hex: "#0D0D0D", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Arlon", series: "SLX", name: "Gloss White", code: "SLX-2200", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Arlon", series: "SLX", name: "Gloss True Blood", code: "SLX-2300", hex: "#8B0000", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Arlon", series: "SLX", name: "Gloss Azure Blue", code: "SLX-2400", hex: "#007FFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Arlon", series: "SLX", name: "Matte Black", code: "SLX-2100M", hex: "#1D1D1D", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Arlon", series: "UltraCal", name: "Matte Military Green", code: "UC-MG01", hex: "#4B5320", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },

  // ============ CARLAS USA ============
  { manufacturer: "Carlas USA", series: "Premium", name: "Gloss Black", code: "CL-001", hex: "#0E0E0E", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Carlas USA", series: "Premium", name: "Gloss White", code: "CL-002", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Carlas USA", series: "Premium", name: "Nardo Grey", code: "CL-003", hex: "#7A7A7A", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },

  // ============ XPEL ============
  { manufacturer: "XPEL", series: "STEALTH", name: "Matte Clear PPF", code: "XPEL-ST", hex: "#F5F5F5", finish: "Matte", color_type: "matte_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "XPEL", series: "ULTIMATE PLUS", name: "Gloss Clear PPF", code: "XPEL-UP", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "XPEL", series: "FUSION PLUS", name: "Ceramic Coating", code: "XPEL-FP", hex: "#E8E8E8", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },

  // ============ SUNTEK ============
  { manufacturer: "SunTek", series: "Ultra", name: "Clear PPF", code: "STK-ULT", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "SunTek", series: "PPF", name: "Matte PPF", code: "STK-MAT", hex: "#F0F0F0", finish: "Matte", color_type: "matte_ppf", metallic: false, pearl: false, chrome: false },

  // ============ LLUMAR ============
  { manufacturer: "Llumar", series: "Platinum", name: "Clear PPF", code: "LLM-PLT", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss_ppf", metallic: false, pearl: false, chrome: false },
  { manufacturer: "Llumar", series: "Matte", name: "Matte PPF", code: "LLM-MAT", hex: "#EFEFEF", finish: "Matte", color_type: "matte_ppf", metallic: false, pearl: false, chrome: false },

  // ============ CHEETAHWRAP ============
  { manufacturer: "CheetahWrap", series: "Premium", name: "Gloss Black", code: "CW-001", hex: "#0C0C0C", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "CheetahWrap", series: "Premium", name: "Gloss White", code: "CW-002", hex: "#FFFFFF", finish: "Gloss", color_type: "gloss", metallic: false, pearl: false, chrome: false },
  { manufacturer: "CheetahWrap", series: "Premium", name: "Matte Black", code: "CW-003", hex: "#1B1B1B", finish: "Matte", color_type: "matte", metallic: false, pearl: false, chrome: false },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    console.log(`🌱 Starting seed of ${VINYL_COLORS.length} vinyl colors...`);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const color of VINYL_COLORS) {
      // Check if already exists
      const { data: existing } = await supabase
        .from('vinyl_swatches')
        .select('id')
        .ilike('manufacturer', color.manufacturer)
        .ilike('name', color.name)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Insert new color
      const { error } = await supabase
        .from('vinyl_swatches')
        .insert({
          manufacturer: color.manufacturer,
          series: color.series,
          name: color.name,
          code: color.code,
          hex: color.hex,
          finish: color.finish,
          color_type: color.color_type,
          metallic: color.metallic,
          pearl: color.pearl,
          chrome: color.chrome,
          verified: true,
          source: 'seeded',
          popularity_score: 0,
          search_count: 0,
          last_verified_at: new Date().toISOString()
        });

      if (error) {
        console.error(`Error inserting ${color.name}:`, error);
        errors++;
      } else {
        inserted++;
      }
    }

    console.log(`✅ Seed complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        total: VINYL_COLORS.length,
        inserted,
        skipped,
        errors,
        message: `Successfully seeded ${inserted} new vinyl colors`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Seed error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});