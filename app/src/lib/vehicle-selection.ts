// Top 20 Vehicles for Auto-Selection across product renders
// Includes mix of Exotic, European, American (Muscle + Trucks), Japanese, SUVs, and Vintage

export interface Vehicle {
  year: string;
  make: string;
  model: string;
  category: 'exotic' | 'european' | 'american_muscle' | 'truck' | 'suv' | 'japanese' | 'vintage';
}

export const TOP_20_VEHICLES: Vehicle[] = [
  // EXOTIC (4)
  { year: '2024', make: 'Ferrari', model: 'F8 Tributo', category: 'exotic' },
  { year: '2024', make: 'Lamborghini', model: 'Huracán', category: 'exotic' },
  { year: '2024', make: 'McLaren', model: '720S', category: 'exotic' },
  { year: '2024', make: 'Porsche', model: '911 GT3', category: 'exotic' },
  
  // EUROPEAN (2)
  { year: '2024', make: 'BMW', model: 'M4', category: 'european' },
  { year: '2024', make: 'Mercedes-AMG', model: 'GT', category: 'european' },
  
  // AMERICAN MUSCLE (2)
  { year: '2024', make: 'Chevrolet', model: 'Corvette C8', category: 'american_muscle' },
  { year: '2024', make: 'Ford', model: 'Mustang GT', category: 'american_muscle' },
  
  // AMERICAN TRUCKS (2)
  { year: '2024', make: 'Ford', model: 'F-150 Raptor', category: 'truck' },
  { year: '2024', make: 'Chevrolet', model: 'Silverado', category: 'truck' },
  
  // SUV (12)
  { year: '2024', make: 'Range Rover', model: 'Sport', category: 'suv' },
  { year: '2024', make: 'Lamborghini', model: 'Urus', category: 'suv' },
  { year: '2024', make: 'Cadillac', model: 'Escalade', category: 'suv' },
  { year: '2024', make: 'Jeep', model: 'Grand Cherokee Trackhawk', category: 'suv' },
  { year: '2024', make: 'Ford', model: 'Bronco Raptor', category: 'suv' },
  { year: '2024', make: 'Chevrolet', model: 'Tahoe Z71', category: 'suv' },
  { year: '2024', make: 'Toyota', model: '4Runner TRD Pro', category: 'suv' },
  { year: '2024', make: 'BMW', model: 'X5 M', category: 'suv' },
  { year: '2024', make: 'Mercedes-Benz', model: 'GLE 63 AMG', category: 'suv' },
  { year: '2024', make: 'Porsche', model: 'Cayenne Turbo GT', category: 'suv' },
  { year: '2024', make: 'GMC', model: 'Yukon Denali', category: 'suv' },
  { year: '2024', make: 'Audi', model: 'RS Q8', category: 'suv' },
  
  // JAPANESE (3)
  { year: '2024', make: 'Nissan', model: 'Z', category: 'japanese' },
  { year: '2024', make: 'Toyota', model: 'Supra', category: 'japanese' },
  { year: '2024', make: 'Lexus', model: 'LC 500', category: 'japanese' },
  
  // VINTAGE (3)
  { year: '1969', make: 'Ford', model: 'Mustang Boss 302', category: 'vintage' },
  { year: '1970', make: 'Chevrolet', model: 'Chevelle SS', category: 'vintage' },
  { year: '1963', make: 'Chevrolet', model: 'Corvette Stingray', category: 'vintage' }
];

/**
 * Get a vehicle from Top 20 list based on index
 * Use for cycling through vehicles in bulk generation
 */
export const getVehicleByIndex = (index: number): Vehicle => {
  return TOP_20_VEHICLES[index % TOP_20_VEHICLES.length];
};

/**
 * Get a random vehicle from Top 20 list
 */
export const getRandomVehicle = (): Vehicle => {
  const randomIndex = Math.floor(Math.random() * TOP_20_VEHICLES.length);
  return TOP_20_VEHICLES[randomIndex];
};

/**
 * Get vehicles by category
 */
export const getVehiclesByCategory = (category: Vehicle['category']): Vehicle[] => {
  return TOP_20_VEHICLES.filter(v => v.category === category);
};

/**
 * AI-powered vehicle selection based on design characteristics
 * Analyzes design style and recommends best vehicle category
 */
export const selectVehicleForDesign = (designAnalysis: {
  style?: string;
  colors?: string[];
  isAggressive?: boolean;
  isElegant?: boolean;
  isRugged?: boolean;
  isClassic?: boolean;
}): Vehicle => {
  const { style, isAggressive, isElegant, isRugged, isClassic } = designAnalysis;
  
  // Style-based category selection logic
  if (isClassic || style?.toLowerCase().includes('vintage') || style?.toLowerCase().includes('retro')) {
    const vintage = getVehiclesByCategory('vintage');
    return vintage[Math.floor(Math.random() * vintage.length)];
  }
  
  if (isRugged || style?.toLowerCase().includes('tactical') || style?.toLowerCase().includes('camo')) {
    const combined = [...getVehiclesByCategory('truck'), ...getVehiclesByCategory('suv')];
    return combined[Math.floor(Math.random() * combined.length)];
  }
  
  if (isAggressive || style?.toLowerCase().includes('bold') || style?.toLowerCase().includes('racing')) {
    const combined = [...getVehiclesByCategory('exotic'), ...getVehiclesByCategory('american_muscle')];
    return combined[Math.floor(Math.random() * combined.length)];
  }
  
  if (isElegant || style?.toLowerCase().includes('refined') || style?.toLowerCase().includes('luxury')) {
    const combined = [...getVehiclesByCategory('european'), ...getVehiclesByCategory('suv')];
    return combined[Math.floor(Math.random() * combined.length)];
  }
  
  // Default: pick random vehicle from entire list
  return getRandomVehicle();
};

/**
 * Format vehicle for display
 */
export const formatVehicleName = (vehicle: Vehicle): string => {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
};
