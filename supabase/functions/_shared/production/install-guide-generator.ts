/**
 * Installer Guide Generator for Production Pipeline
 * Creates professional installation instructions from design data
 */

interface InstallerGuide {
  materials: string[];
  panels: string[];
  layers: string[];
  sequence: string[];
  notes: string[];
  estimatedTime: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

interface GuideInput {
  prompt: string;
  vehicleType?: string;
  designType?: string;
  zones?: string[];
}

/**
 * Generate professional installer guide from design data
 */
export async function generateInstallerGuide(input: GuideInput): Promise<InstallerGuide> {
  const { prompt, vehicleType, designType } = input;
  const promptLower = prompt.toLowerCase();

  // Detect design type from prompt
  const isTwoTone = promptLower.includes('two-tone') || 
                    promptLower.includes('top half') || 
                    promptLower.includes('bottom half');
  const hasStripes = promptLower.includes('stripe') || promptLower.includes('racing');
  const hasChromeDelete = promptLower.includes('chrome delete') || promptLower.includes('blackout');
  const hasAccents = promptLower.includes('accent') || promptLower.includes('mirror') || 
                     promptLower.includes('handle') || promptLower.includes('trim');

  // Extract materials from prompt
  const materials = extractMaterials(promptLower);

  // Determine panels based on design
  const panels = determinePanels(promptLower, isTwoTone, hasStripes, hasChromeDelete, hasAccents);

  // Generate layer order
  const layers = generateLayerOrder(isTwoTone, hasStripes);

  // Generate install sequence
  const sequence = generateInstallSequence(panels, isTwoTone);

  // Generate notes
  const notes = generateNotes(promptLower, isTwoTone, hasStripes, hasChromeDelete);

  // Estimate time and difficulty
  const { time, difficulty } = estimateInstall(panels, isTwoTone, hasStripes);

  return {
    materials,
    panels,
    layers,
    sequence,
    notes,
    estimatedTime: time,
    difficulty
  };
}

function extractMaterials(prompt: string): string[] {
  const materials: string[] = [];
  
  // Common vinyl finishes
  const finishes = ['chrome', 'satin', 'matte', 'gloss', 'metallic', 'carbon fiber', 'brushed'];
  // Common colors
  const colors = ['gold', 'black', 'white', 'red', 'blue', 'silver', 'copper', 'purple'];

  for (const finish of finishes) {
    if (prompt.includes(finish)) {
      for (const color of colors) {
        if (prompt.includes(color)) {
          materials.push(`${color.charAt(0).toUpperCase() + color.slice(1)} ${finish.charAt(0).toUpperCase() + finish.slice(1)} Film`);
        }
      }
      if (materials.length === 0) {
        materials.push(`${finish.charAt(0).toUpperCase() + finish.slice(1)} Film`);
      }
    }
  }

  if (materials.length === 0) {
    materials.push('Color-Change Vinyl Film');
  }

  return [...new Set(materials)];
}

function determinePanels(
  prompt: string, 
  isTwoTone: boolean, 
  hasStripes: boolean,
  hasChromeDelete: boolean,
  hasAccents: boolean
): string[] {
  const panels: string[] = [];

  if (isTwoTone) {
    panels.push('Hood (Upper Zone)', 'Hood (Lower Zone)');
    panels.push('Roof', 'Trunk');
    panels.push('Doors - Left (Upper/Lower)', 'Doors - Right (Upper/Lower)');
    panels.push('Fenders', 'Quarter Panels');
  } else if (hasStripes) {
    panels.push('Hood - Center Stripe');
    panels.push('Roof - Center Stripe');
    panels.push('Trunk - Center Stripe');
  } else if (hasChromeDelete) {
    panels.push('Window Surrounds', 'Grille Frame', 'Door Handles');
    panels.push('Mirror Caps', 'Badges', 'Exhaust Tips');
  } else if (hasAccents) {
    if (prompt.includes('mirror')) panels.push('Mirror Caps');
    if (prompt.includes('handle')) panels.push('Door Handles');
    if (prompt.includes('roof')) panels.push('Roof Panel');
    if (prompt.includes('badge')) panels.push('Badges');
  } else {
    panels.push('Hood', 'Roof', 'Trunk', 'Doors', 'Fenders', 'Quarters', 'Bumpers');
  }

  return panels;
}

function generateLayerOrder(isTwoTone: boolean, hasStripes: boolean): string[] {
  if (isTwoTone) {
    return ['Base Layer (Lower Zone)', 'Mid Layer (Upper Zone)', 'Transition Line'];
  }
  if (hasStripes) {
    return ['Body Color (if any)', 'Stripe Base', 'Stripe Outline (if dual)'];
  }
  return ['Base Color', 'Accents/Details'];
}

function generateInstallSequence(panels: string[], isTwoTone: boolean): string[] {
  if (isTwoTone) {
    return [
      'Clean and prep all surfaces',
      'Mask transition line with 3M Fine Line tape',
      'Apply lower zone film (work hood → doors → quarters)',
      'Apply upper zone film (work hood → roof → trunk)',
      'Remove masking, seal transition',
      'Apply door jambs and edges',
      'Final inspection and detail work'
    ];
  }

  return [
    'Clean and prep all surfaces with IPA',
    'Start with hood - work from center outward',
    'Continue to roof - use center anchoring',
    'Apply trunk lid',
    'Install driver side panels (fender → door → quarter)',
    'Install passenger side panels',
    'Apply bumpers (complex curves last)',
    'Install trim pieces and accents',
    'Post-heat all edges and curves',
    'Final inspection'
  ];
}

function generateNotes(
  prompt: string,
  isTwoTone: boolean,
  hasStripes: boolean,
  hasChromeDelete: boolean
): string[] {
  const notes: string[] = [];

  if (isTwoTone) {
    notes.push('Ensure transition line is perfectly level across all panels');
    notes.push('Use laser level for consistent horizontal alignment');
  }

  if (hasStripes) {
    notes.push('Maintain stripe width consistency: measure at multiple points');
    notes.push('Align stripes across panel gaps (hood-to-roof, roof-to-trunk)');
  }

  if (hasChromeDelete) {
    notes.push('Pre-form film for complex chrome trim shapes');
    notes.push('Use heat gun carefully on plastic trim pieces');
  }

  if (prompt.includes('chrome')) {
    notes.push('Chrome film requires extra post-heat for adhesion');
    notes.push('Avoid stretching chrome more than 15% to prevent delamination');
  }

  if (prompt.includes('caliper')) {
    notes.push('Brake calipers require high-temp ceramic coating, not vinyl');
  }

  notes.push('Ambient temperature: 65-75°F (18-24°C) recommended');
  notes.push('Allow 24-48 hours cure time before washing');

  return notes;
}

function estimateInstall(
  panels: string[],
  isTwoTone: boolean,
  hasStripes: boolean
): { time: string; difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert' } {
  let hours = panels.length * 0.5; // Base: 30 min per panel

  if (isTwoTone) {
    hours += 4; // Extra time for transition alignment
  }
  if (hasStripes) {
    hours += 2; // Extra time for stripe precision
  }

  // Determine difficulty
  let difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert' = 'intermediate';
  if (isTwoTone && hasStripes) {
    difficulty = 'expert';
  } else if (isTwoTone || hasStripes) {
    difficulty = 'advanced';
  } else if (panels.length <= 4) {
    difficulty = 'beginner';
  }

  return {
    time: `${Math.round(hours)}-${Math.round(hours * 1.5)} hours`,
    difficulty
  };
}
