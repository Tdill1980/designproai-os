/**
 * Stock Vehicle Photos for MyVehiclePro Deploy Pipeline
 *
 * Photos are stored in Supabase Storage at:
 *   wrap-files/admin/deploy-photos/
 *
 * Upload real vehicle photos matching the file names below.
 * The deploy pipeline fetches them server-side (no CORS issues).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function storageUrl(filename: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/wrap-files/admin/deploy-photos/${filename}`;
}

export interface StockVehiclePhoto {
  id: string;
  url: string;
  filename: string;
  label: string;
  make: string;
  model: string;
  year: string;
  bodyStyle: string;
}

export const STOCK_VEHICLE_PHOTOS: StockVehiclePhoto[] = [
  {
    id: "svp_01",
    url: storageUrl("white-f150-side.jpg"),
    filename: "white-f150-side.jpg",
    label: "White Ford F-150 - Side View",
    make: "Ford",
    model: "F-150",
    year: "2024",
    bodyStyle: "truck",
  },
  {
    id: "svp_02",
    url: storageUrl("black-ram-1500-side.jpg"),
    filename: "black-ram-1500-side.jpg",
    label: "Black Ram 1500 - Side View",
    make: "Ram",
    model: "1500",
    year: "2024",
    bodyStyle: "truck",
  },
  {
    id: "svp_03",
    url: storageUrl("white-model-3-side.jpg"),
    filename: "white-model-3-side.jpg",
    label: "White Tesla Model 3 - Side View",
    make: "Tesla",
    model: "Model 3",
    year: "2024",
    bodyStyle: "sedan",
  },
  {
    id: "svp_04",
    url: storageUrl("silver-corvette-c8-34.jpg"),
    filename: "silver-corvette-c8-34.jpg",
    label: "Silver Corvette C8 - 3/4 Front",
    make: "Chevrolet",
    model: "Corvette C8",
    year: "2024",
    bodyStyle: "sports",
  },
  {
    id: "svp_05",
    url: storageUrl("white-bmw-m4-side.jpg"),
    filename: "white-bmw-m4-side.jpg",
    label: "White BMW M4 - Side View",
    make: "BMW",
    model: "M4",
    year: "2024",
    bodyStyle: "sports",
  },
  {
    id: "svp_06",
    url: storageUrl("black-mustang-gt-side.jpg"),
    filename: "black-mustang-gt-side.jpg",
    label: "Black Ford Mustang GT - Side View",
    make: "Ford",
    model: "Mustang GT",
    year: "2024",
    bodyStyle: "sports",
  },
  {
    id: "svp_07",
    url: storageUrl("white-rav4-side.jpg"),
    filename: "white-rav4-side.jpg",
    label: "White Toyota RAV4 - Side View",
    make: "Toyota",
    model: "RAV4",
    year: "2024",
    bodyStyle: "suv",
  },
  {
    id: "svp_08",
    url: storageUrl("gray-tahoe-side.jpg"),
    filename: "gray-tahoe-side.jpg",
    label: "Gray Chevrolet Tahoe - Side View",
    make: "Chevrolet",
    model: "Tahoe",
    year: "2024",
    bodyStyle: "suv",
  },
  {
    id: "svp_09",
    url: storageUrl("white-sprinter-van-side.jpg"),
    filename: "white-sprinter-van-side.jpg",
    label: "White Mercedes Sprinter - Side View",
    make: "Mercedes-Benz",
    model: "Sprinter",
    year: "2024",
    bodyStyle: "van",
  },
  {
    id: "svp_10",
    url: storageUrl("white-transit-van-side.jpg"),
    filename: "white-transit-van-side.jpg",
    label: "White Ford Transit - Side View",
    make: "Ford",
    model: "Transit",
    year: "2024",
    bodyStyle: "van",
  },
  {
    id: "svp_11",
    url: storageUrl("white-camry-side.jpg"),
    filename: "white-camry-side.jpg",
    label: "White Toyota Camry - Side View",
    make: "Toyota",
    model: "Camry",
    year: "2024",
    bodyStyle: "sedan",
  },
  {
    id: "svp_12",
    url: storageUrl("white-wrangler-side.jpg"),
    filename: "white-wrangler-side.jpg",
    label: "White Jeep Wrangler - Side View",
    make: "Jeep",
    model: "Wrangler",
    year: "2024",
    bodyStyle: "suv",
  },
];

/** Get photos filtered by body style */
export function getPhotosByBodyStyle(style: string): StockVehiclePhoto[] {
  return STOCK_VEHICLE_PHOTOS.filter((p) => p.bodyStyle === style);
}

/** Get all unique body styles */
export function getBodyStyles(): string[] {
  return [...new Set(STOCK_VEHICLE_PHOTOS.map((p) => p.bodyStyle))];
}
