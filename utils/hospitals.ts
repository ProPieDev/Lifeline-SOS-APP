import { formatDistance, haversineDistance } from "./distance";

export interface Hospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance: number;
  distanceFormatted: string;
  rating?: number | null;
  type: "hospital" | "clinic" | "pharmacy";
}

let cache:
  | { lat: number; lng: number; radius: number; data: Hospital[]; time: number }
  | null = null;

const CACHE_TTL = 5 * 60 * 1000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

export async function fetchNearbyHospitals(
  lat: number,
  lng: number,
  radiusMeters = 5000
): Promise<Hospital[]> {
  if (
    cache &&
    cache.radius === radiusMeters &&
    Date.now() - cache.time < CACHE_TTL &&
    haversineDistance(lat, lng, cache.lat, cache.lng) < 250
  ) {
    return cache.data;
  }

  const query = buildHospitalQuery(lat, lng, radiusMeters);
  const json = await fetchOverpass(query);
  const data = parseHospitalResults(json, lat, lng).slice(0, 20);

  cache = { lat, lng, radius: radiusMeters, data, time: Date.now() };
  return data;
}

function buildHospitalQuery(lat: number, lng: number, radiusMeters: number) {
  return `
    [out:json][timeout:25];
    (
      node["amenity"~"hospital|clinic|pharmacy"](around:${radiusMeters},${lat},${lng});
      way["amenity"~"hospital|clinic|pharmacy"](around:${radiusMeters},${lat},${lng});
      relation["amenity"~"hospital|clinic|pharmacy"](around:${radiusMeters},${lat},${lng});
      node["healthcare"~"hospital|clinic|doctor|centre"](around:${radiusMeters},${lat},${lng});
      way["healthcare"~"hospital|clinic|doctor|centre"](around:${radiusMeters},${lat},${lng});
      relation["healthcare"~"hospital|clinic|doctor|centre"](around:${radiusMeters},${lat},${lng});
      node["emergency"="ambulance_station"](around:${radiusMeters},${lat},${lng});
      way["emergency"="ambulance_station"](around:${radiusMeters},${lat},${lng});
    );
    out center tags;
  `;
}

async function fetchOverpass(query: string) {
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);

      if (!res.ok) {
        lastError = new Error(`Hospital server returned ${res.status}`);
        continue;
      }

      return await res.json();
    } catch (error: any) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Unable to load hospitals right now");
}

function parseHospitalResults(json: any, lat: number, lng: number): Hospital[] {
  return (json.elements || [])
    .map((el: any) => {
      const placeLat = el.lat ?? el.center?.lat;
      const placeLng = el.lon ?? el.center?.lon;
      const name =
        el.tags?.name ||
        el.tags?.["name:en"] ||
        el.tags?.operator ||
        readableType(el.tags);
      const amenity = el.tags?.amenity;
      const healthcare = el.tags?.healthcare;

      if (!placeLat || !placeLng || !name) return null;

      const distance = haversineDistance(lat, lng, placeLat, placeLng);

      return {
        id: String(el.id),
        name,
        lat: placeLat,
        lng: placeLng,
        distance,
        distanceFormatted: formatDistance(distance),
        rating: null,
        type:
          amenity === "clinic" || healthcare === "clinic"
            ? "clinic"
            : amenity === "pharmacy"
            ? "pharmacy"
            : "hospital",
      };
    })
    .filter(Boolean)
    .sort((a: Hospital, b: Hospital) => a.distance - b.distance);
}

function readableType(tags: any) {
  if (tags?.emergency === "ambulance_station") return "Ambulance station";
  if (tags?.healthcare === "doctor") return "Doctor";
  if (tags?.healthcare === "centre") return "Healthcare centre";
  return "";
}
