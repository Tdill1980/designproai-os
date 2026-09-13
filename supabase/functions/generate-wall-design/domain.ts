// WallPro professional design-domain classification (owner directive,
// 2026-09-13: "Commercial + Residential Design Engine"). Pure, deterministic,
// no I/O and no AI call — the same principle RULE "THE PERSONA WILL BE
// MEDIUM-AWARE. NOT YET." already states for medium selection: "Medium
// selection is deterministic and local... Do NOT add an LLM classification
// or persona-selection stage — that is latency on the critical path before
// the customer sees anything." Domain (commercial vs residential) is the
// same kind of routing decision, one level down, and gets the same answer:
// code decides, the model designs.
//
// This module never overrides what the customer actually asked for. It only
// decides WHICH of the two professional personas leads, and — advisory only
// — what space type and residential style vocabulary to hand that persona as
// composition guidance. The typed WallDesignContract's requiredSubjects /
// requiredElements / requiredColors / mustPreserve stay the literal, binding
// truth regardless of domain.

export type DesignDomain = 'commercial' | 'residential';

export const COMMERCIAL_SPACE_TYPES = [
  'retail', 'restaurant', 'bar', 'cafe', 'corporate_office', 'coworking',
  'apartment_complex', 'multifamily', 'hotel', 'hospitality', 'spa', 'salon',
  'medspa', 'dental', 'medical', 'gym', 'fitness', 'church', 'worship',
  'school', 'university', 'daycare', 'healthcare', 'bank', 'financial',
  'law_office', 'real_estate', 'auto_dealership', 'showroom', 'event_space',
  'museum', 'entertainment', 'government', 'nonprofit', 'other',
] as const;
export type CommercialSpaceType = typeof COMMERCIAL_SPACE_TYPES[number];

export const RESIDENTIAL_SPACE_TYPES = [
  'living_room', 'bedroom', 'nursery', 'kids_room', 'dining_room', 'kitchen',
  'bathroom', 'powder_room', 'home_office', 'entryway', 'hallway',
  'staircase', 'media_room', 'game_room', 'laundry', 'dressing_room',
  'guest_room', 'other',
] as const;
export type ResidentialSpaceType = typeof RESIDENTIAL_SPACE_TYPES[number];

/** The current residential/wallcovering style vocabulary (owner spec, section
 * 3). Guidance only — see the module header. Kept as one flat list so a
 * customer's own word ("boho", "quiet luxury") can be matched directly. */
export const RESIDENTIAL_STYLE_TAXONOMY = [
  'Boho', 'Contemporary Boho', 'Organic Modern', 'Japandi', 'Scandinavian',
  'Soft Minimalism', 'Quiet Luxury', 'Modern Luxe', 'Glam', 'Luxe',
  'Contemporary Classic', 'Transitional', 'Modern Traditional',
  'European Contemporary', 'French Country', 'Grandmillennial', 'Coastal',
  'Modern Coastal', 'Mediterranean', 'Modern Mediterranean',
  'Mid-Century Modern', 'Art Deco', 'Modern Art Deco', 'Maximalist',
  'Moody Maximalist', 'Vintage Botanical', 'Chinoiserie', 'Modern Chinoiserie',
  'Cottagecore', 'Dark Academia', 'Light Academia', 'Industrial',
  'Modern Rustic', 'Southwestern', 'Desert Modern', 'Tropical',
  'Modern Tropical', 'Biophilic', 'Wabi-Sabi', 'Warm Minimalist', 'Eclectic',
  'Kids Editorial', 'Nursery Editorial', 'Whimsical', 'Feminine Luxe',
  'Masculine Modern', 'Abstract Organic', 'Geometric Modern',
  'Textural', 'Plaster', 'Limewash', 'Architectural Slat', 'Wood Look',
  'Stone', 'Marble', 'Travertine',
] as const;

export type WallDomainClassification = {
  designDomain: DesignDomain;
  commercialSpaceType: CommercialSpaceType | null;
  residentialSpaceType: ResidentialSpaceType | null;
  designStyle: string | null;
  /** Where the answer came from, for logging — never read by the model. */
  source: 'override' | 'library' | 'prompt' | 'default';
};

/** Maps the 500-prompt library's `industry` field (B2B rows) to a commercial
 * space type. Approximate by design: the curator can always override, and an
 * unmapped industry falls back to 'other' rather than guessing wrong. */
const INDUSTRY_TO_COMMERCIAL_SPACE_TYPE: Record<string, CommercialSpaceType> = {
  'Automotive, Dealerships & Wrap Shops': 'auto_dealership',
  'Bars, Lounges & Breweries': 'bar',
  'Cafes & Coffee Shops': 'cafe',
  'Construction, Trades & Architecture': 'showroom',
  'Corporate Offices & Coworking': 'corporate_office',
  'Entertainment, Gaming & Casino': 'entertainment',
  'Event, Wedding & Experiential Venues': 'event_space',
  'Faith, Senior Living & Community': 'worship',
  'Finance, Law & Professional Services': 'financial',
  'Grocery, Food Hall & Specialty Food': 'retail',
  'Gyms & Performance Fitness': 'fitness',
  'Home Builders & Model Homes': 'real_estate',
  'Hotels & Resorts': 'hotel',
  'Manufacturing, Warehouse & Industrial': 'other',
  'Med Spas & Beauty Clinics': 'medspa',
  'Medical, Dental & Healthcare': 'medical',
  'Multifamily & Apartments': 'multifamily',
  'Pediatric, Daycare & Kids Commercial': 'daycare',
  'Restaurants & Dining': 'restaurant',
  'Retail & Boutiques': 'retail',
  'Salons, Barbers & Nail Studios': 'salon',
  'Schools, Universities & Learning': 'school',
  'Spas & Wellness': 'spa',
  'Sports, Dance & Recreation': 'fitness',
  'Tech, SaaS & Innovation Spaces': 'corporate_office',
  'Travel, Airport & Tourism': 'other',
  'Veterinary & Pet Businesses': 'medical',
  'Yoga, Pilates & Boutique Fitness': 'fitness',
};
/** Room-level overrides applied on top of the industry mapping above, tested
 * as case-insensitive substrings of the library `room` field. */
const ROOM_COMMERCIAL_OVERRIDES: [RegExp, CommercialSpaceType][] = [
  [/cowork/i, 'coworking'],
  [/senior living|memory care/i, 'nonprofit'],
  [/\blaw\b/i, 'law_office'],
  [/real estate/i, 'real_estate'],
  [/restaurant/i, 'restaurant'],
  [/\bdental\b/i, 'dental'],
  [/university|college/i, 'university'],
  [/exam room|hospital|therapy room/i, 'healthcare'],
];
const RESIDENTIAL_INDUSTRIES = new Set(['Homeowner Residential', 'Nursery, Kids & Teen Residential']);
const ROOM_RESIDENTIAL: [RegExp, ResidentialSpaceType][] = [
  [/nursery/i, 'nursery'],
  [/\b(boys?|girls?|toddler|teen|kids?|playroom|homework|gaming|sports)\b.*room|room.*\b(boys?|girls?|toddler|kids?)\b/i, 'kids_room'],
  [/guest bedroom|guest room/i, 'guest_room'],
  [/bedroom/i, 'bedroom'],
  [/dining/i, 'dining_room'],
  [/kitchen/i, 'kitchen'],
  [/powder/i, 'powder_room'],
  [/bath/i, 'bathroom'],
  [/office/i, 'home_office'],
  [/entry|foyer/i, 'entryway'],
  [/hallway/i, 'hallway'],
  [/stair/i, 'staircase'],
  [/media room/i, 'media_room'],
  [/game room/i, 'game_room'],
  [/laundry|mudroom/i, 'laundry'],
  [/dressing/i, 'dressing_room'],
  [/living room|great room|casita|sunroom|loft/i, 'living_room'],
];

/** Prompt-text signal, used only when there is no library metadata to read
 * (a live customer request). Deliberately coarse: this only decides which
 * professional leads, never what the design contains. */
const COMMERCIAL_PROMPT_SIGNAL = [
  // "dining room" alone is deliberately NOT a commercial signal here — it is
  // exactly as often a residential room name, and RESIDENTIAL_PROMPT_SIGNAL
  // below reads it that way. "restaurant"/"bistro"/"eatery" are unambiguous.
  [/\b(restaurant|bistro|eatery)\b/i, 'restaurant'],
  [/\bbar\b|\btaproom\b|\bbrewery\b|\bspeakeasy\b|\bcocktail lounge\b/i, 'bar'],
  [/\bcafe\b|\bcoffee shop\b/i, 'cafe'],
  [/\bcoworking\b|\bco-working\b/i, 'coworking'],
  [/\bcorporate office\b|\boffice lobby\b|\breception\b/i, 'corporate_office'],
  [/\bapartment\b|\bleasing office\b|\bclubhouse\b/i, 'multifamily'],
  [/\bhotel\b|\bresort\b/i, 'hotel'],
  [/\bspa\b(?!ce)/i, 'spa'],
  [/\bsalon\b|\bbarber\b/i, 'salon'],
  [/\bmed ?spa\b/i, 'medspa'],
  [/\bdental\b|\bdentist\b/i, 'dental'],
  [/\bclinic\b|\bmedical office\b|\bhealthcare\b/i, 'medical'],
  [/\bgym\b|\bfitness studio\b|\byoga studio\b|\bpilates\b/i, 'fitness'],
  [/\bchurch\b|\bworship\b|\bministry\b|\bsanctuary\b/i, 'worship'],
  [/\buniversity\b|\bcollege\b/i, 'university'],
  [/\bschool\b|\bclassroom\b/i, 'school'],
  [/\bdaycare\b|\bpreschool\b/i, 'daycare'],
  [/\bbank\b/i, 'bank'],
  [/\blaw firm\b|\battorney\b/i, 'law_office'],
  [/\breal estate office\b/i, 'real_estate'],
  [/\bdealership\b|\bshowroom\b/i, 'auto_dealership'],
  [/\bevent space\b|\bballroom\b|\bbanquet\b/i, 'event_space'],
  [/\bmuseum\b/i, 'museum'],
  [/\bretail\b|\bboutique\b|\bstorefront\b/i, 'retail'],
] as [RegExp, CommercialSpaceType][];
const RESIDENTIAL_PROMPT_SIGNAL = [
  [/\bliving room\b/i, 'living_room'],
  [/\bbedroom\b/i, 'bedroom'],
  [/\bnursery\b/i, 'nursery'],
  [/\bkids? room\b|\bplayroom\b/i, 'kids_room'],
  [/\bdining room\b/i, 'dining_room'],
  [/\bkitchen\b/i, 'kitchen'],
  [/\bbathroom\b|\bpowder room\b/i, 'bathroom'],
  [/\bhome office\b/i, 'home_office'],
  [/\bentryway\b|\bfoyer\b/i, 'entryway'],
  [/\bhallway\b/i, 'hallway'],
  [/\bstaircase\b/i, 'staircase'],
  [/\bmedia room\b/i, 'media_room'],
  [/\bgame room\b/i, 'game_room'],
  [/\blaundry room\b/i, 'laundry'],
  [/\bdressing room\b/i, 'dressing_room'],
  [/\bguest room\b/i, 'guest_room'],
] as [RegExp, ResidentialSpaceType][];

const isCommercialSpaceType = (v: unknown): v is CommercialSpaceType => (COMMERCIAL_SPACE_TYPES as readonly string[]).includes(v as string);
const isResidentialSpaceType = (v: unknown): v is ResidentialSpaceType => (RESIDENTIAL_SPACE_TYPES as readonly string[]).includes(v as string);

/** The current residential style, matched from the longest (most specific)
 * taxonomy entry first so "Contemporary Boho" wins over "Boho". Reads the
 * customer's own words or the library's `style` field; never invents one. */
function matchResidentialStyle(text: string): string | null {
  const haystack = text.toLowerCase();
  const sorted = [...RESIDENTIAL_STYLE_TAXONOMY].sort((a, b) => b.length - a.length);
  for (const style of sorted) if (haystack.includes(style.toLowerCase())) return style;
  return null;
}

export type WallDomainInput = {
  prompt: string;
  businessContext?: string | null;
  libraryIndustry?: string | null;
  libraryRoom?: string | null;
  libraryStyle?: string | null;
  /** Explicit curator/customer override. Wins over every inference. */
  overrideDomain?: DesignDomain | null;
  overrideCommercialSpaceType?: string | null;
  overrideResidentialSpaceType?: string | null;
};

/**
 * Classifies the design domain (commercial vs residential), the space type
 * within it, and — residential only — the current design style, from
 * whatever combination of library metadata, business context and the
 * customer's own prompt text is available. Never invents a subject: this
 * only routes which professional persona composes and what vocabulary it is
 * handed as guidance (section 4 of the owner spec — style is guidance, not
 * the design).
 */
export function classifyWallDomain(input: WallDomainInput): WallDomainClassification {
  const prompt = (input.prompt || '').trim();
  const context = (input.businessContext || '').trim();
  const combinedText = [prompt, context].filter(Boolean).join(' ');
  const style = matchResidentialStyle([input.libraryStyle || '', combinedText].filter(Boolean).join(' '));

  if (input.overrideDomain === 'commercial' || input.overrideDomain === 'residential') {
    const domain = input.overrideDomain;
    return {
      designDomain: domain,
      commercialSpaceType: domain === 'commercial' ? (isCommercialSpaceType(input.overrideCommercialSpaceType) ? input.overrideCommercialSpaceType : 'other') : null,
      residentialSpaceType: domain === 'residential' ? (isResidentialSpaceType(input.overrideResidentialSpaceType) ? input.overrideResidentialSpaceType : 'other') : null,
      designStyle: domain === 'residential' ? style : null,
      source: 'override',
    };
  }

  if (input.libraryIndustry) {
    if (RESIDENTIAL_INDUSTRIES.has(input.libraryIndustry)) {
      let spaceType: ResidentialSpaceType = 'other';
      for (const [re, value] of ROOM_RESIDENTIAL) if (re.test(input.libraryRoom || '')) { spaceType = value; break; }
      return { designDomain: 'residential', commercialSpaceType: null, residentialSpaceType: spaceType, designStyle: style, source: 'library' };
    }
    const base = INDUSTRY_TO_COMMERCIAL_SPACE_TYPE[input.libraryIndustry];
    if (base) {
      let spaceType = base;
      for (const [re, value] of ROOM_COMMERCIAL_OVERRIDES) if (re.test(input.libraryRoom || '')) { spaceType = value; break; }
      return { designDomain: 'commercial', commercialSpaceType: spaceType, residentialSpaceType: null, designStyle: null, source: 'library' };
    }
  }

  // No library metadata: read the customer's own words. Commercial signal is
  // checked first because a named business type is the more specific claim;
  // "the living room of my restaurant" does not occur in practice, but
  // "restaurant" alone should not be read as residential.
  for (const [re, value] of COMMERCIAL_PROMPT_SIGNAL) if (re.test(combinedText)) return { designDomain: 'commercial', commercialSpaceType: value, residentialSpaceType: null, designStyle: null, source: 'prompt' };
  for (const [re, value] of RESIDENTIAL_PROMPT_SIGNAL) if (re.test(combinedText)) return { designDomain: 'residential', commercialSpaceType: null, residentialSpaceType: value, designStyle: style, source: 'prompt' };

  // Default: commercial. This is a compatibility decision, not a market
  // judgement — WallPro's existing designer persona (WALL_DESIGNER) has
  // always been commercial-flavored ("environmental graphics and large-format
  // wrap design"), and every prompt without a domain signal must keep
  // producing exactly the output it produced before this change existed.
  return { designDomain: 'commercial', commercialSpaceType: 'other', residentialSpaceType: null, designStyle: null, source: 'default' };
}
