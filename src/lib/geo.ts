import * as turf from "@turf/turf";
import type { FeatureCollection, Geometry } from "geojson";

const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

// Only these micro-states are excluded. All other countries (including Antarctica) are included.
const EXCLUDED_COUNTRIES = new Set([
  "Nauru",
  "Tuvalu",
  "Palau",
  "Kiribati",
  "Micronesia",
  // Micro-states/city-states
  "Vatican",
  "Vatican City",
  "Holy See",
  "San Marino",
  "Liechtenstein",
  "Andorra",
  // Small island nations
  "Marshall Islands",
  "Marshall Is.",
  "Saint Kitts and Nevis",
  "St. Kitts and Nevis",
  "Maldives",
  "Grenada",
  "Antigua and Barbuda",
  "Antigua and Barb.",
  "Saint Lucia",
  "St. Lucia",
  "Tonga",
  "Sao Tome and Principe",
  "São Tomé and Príncipe",
  "Comoros",
  "Timor-Leste",
  "East Timor",
]);

export interface CountryFeature {
  name: string;
  geometry: turf.AllGeoJSON;
}

let cachedCountries: CountryFeature[] | null = null;

export async function loadCountries(): Promise<CountryFeature[]> {
  if (cachedCountries) return cachedCountries;

  const response = await fetch(WORLD_GEOJSON_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch world data: ${response.statusText}`);
  }

  const geojson = (await response.json()) as FeatureCollection;

  const countries: CountryFeature[] = [];
  for (const feature of geojson.features) {
    const name = feature.properties?.name as string | undefined;
    if (!name || EXCLUDED_COUNTRIES.has(name)) continue;
    countries.push({ name, geometry: feature.geometry as turf.AllGeoJSON });
  }

  cachedCountries = countries;
  return countries;
}

export function findCountry(
  query: string,
  countries: CountryFeature[],
): CountryFeature | null {
  const lower = query.toLowerCase();
  return countries.find((c) => c.name.toLowerCase().includes(lower)) ?? null;
}

export function calculateBorderDistanceKm(
  a: CountryFeature,
  b: CountryFeature,
): number {
  const geoA = a.geometry as Geometry;
  const geoB = b.geometry as Geometry;

  const featureA = turf.feature(geoA);
  const featureB = turf.feature(geoB);

  const coordsA = flattenCoords(geoA);
  const coordsB = flattenCoords(geoB);

  let minDist = Infinity;

  for (const coordA of coordsA) {
    const ptA = turf.point(coordA);
    for (const coordB of coordsB) {
      const ptB = turf.point(coordB);
      const d = turf.distance(ptA, ptB, { units: "kilometers" });
      if (d < minDist) minDist = d;
    }
    if (minDist === 0) return 0;
  }

  if (!isFinite(minDist)) {
    const centroidA = turf.centroid(featureA);
    const centroidB = turf.centroid(featureB);
    return Math.round(
      turf.distance(centroidA, centroidB, { units: "kilometers" }),
    );
  }

  return Math.round(minDist);
}

function flattenCoords(geometry: Geometry): number[][] {
  const coords: number[][] = [];

  function walk(g: Geometry) {
    switch (g.type) {
      case "Point":
        coords.push(g.coordinates as number[]);
        break;
      case "MultiPoint":
      case "LineString":
        for (const c of g.coordinates as number[][]) coords.push(c);
        break;
      case "MultiLineString":
      case "Polygon":
        for (const ring of g.coordinates as number[][][]) {
          sampleRing(ring, coords);
        }
        break;
      case "MultiPolygon":
        for (const poly of g.coordinates as number[][][][]) {
          for (const ring of poly) {
            sampleRing(ring, coords);
          }
        }
        break;
      case "GeometryCollection":
        for (const child of g.geometries) walk(child as Geometry);
        break;
    }
  }

  walk(geometry);
  return coords;
}

function sampleRing(ring: number[][], out: number[][]): void {
  const step = Math.max(1, Math.floor(ring.length / 40));
  for (let i = 0; i < ring.length; i += step) {
    out.push(ring[i]);
  }
}

/**
 * When 3+ countries match, find the geographic centroid of all matches
 * and return the nearest country to that point (not already in the matches).
 * This gives a smart "next guess" suggestion.
 */
function computeMidpointSuggestion(
  countries: CountryFeature[],
  sourceCountry: string,
  matchedNames: string[],
): string | null {
  if (matchedNames.length < 3) return null;

  const matchedFeatures = matchedNames
    .map((n) => countries.find((c) => c.name === n))
    .filter((c): c is CountryFeature => !!c);

  if (matchedFeatures.length < 3) return null;

  let sumLng = 0;
  let sumLat = 0;
  for (const f of matchedFeatures) {
    const centroid = turf.centroid(turf.feature(f.geometry as Geometry));
    sumLng += centroid.geometry.coordinates[0];
    sumLat += centroid.geometry.coordinates[1];
  }
  const center = turf.point([sumLng / matchedFeatures.length, sumLat / matchedFeatures.length]);

  const excluded = new Set([...matchedNames, sourceCountry]);
  let suggestion: string | null = null;
  let best = Infinity;

  for (const c of countries) {
    if (excluded.has(c.name)) continue;
    const centroid = turf.centroid(turf.feature(c.geometry as Geometry));
    const d = turf.distance(center, centroid, { units: "kilometers" });
    if (d < best) {
      best = d;
      suggestion = c.name;
    }
  }

  return suggestion;
}

export interface CountryMatch {
  name: string;
  distanceKm: number;
  touching: boolean;
}

export interface NearbyResult {
  sourceCountry: string;
  targetKm: number;
  tolerance: number;
  matches: CountryMatch[];
  midpointSuggestion: string | null;
}

export async function findCountriesNearby(
  country: string,
  km: number,
  tolerance = 50,
): Promise<NearbyResult> {
  const countries = await loadCountries();
  const source = findCountry(country, countries);

  if (!source) {
    throw new Error(`Country not found: "${country}"`);
  }

  const lower = km - tolerance;
  const upper = km + tolerance;

  const matches: CountryMatch[] = [];
  for (const target of countries) {
    if (target.name === source.name) continue;
    const distanceKm = calculateBorderDistanceKm(source, target);
    if (distanceKm >= lower && distanceKm <= upper) {
      matches.push({ name: target.name, distanceKm, touching: distanceKm === 0 });
    }
  }

  matches.sort((a, b) => a.distanceKm - b.distanceKm);

  const midpointSuggestion = computeMidpointSuggestion(
    countries,
    source.name,
    matches.map((m) => m.name),
  );

  return { sourceCountry: source.name, targetKm: km, tolerance, matches, midpointSuggestion };
}

/**
 * Compute all border distances from one country to every other country.
 * Expensive on first call; result is cached per source country.
 */
const allDistancesCache = new Map<string, { name: string; distanceKm: number }[]>();

export async function getAllDistancesFrom(
  country: string,
): Promise<{ name: string; distanceKm: number }[]> {
  const countries = await loadCountries();
  const source = findCountry(country, countries);
  if (!source) throw new Error(`Country not found: "${country}"`);

  const cached = allDistancesCache.get(source.name);
  if (cached) return cached;

  const results: { name: string; distanceKm: number }[] = [];
  for (const target of countries) {
    if (target.name === source.name) continue;
    results.push({
      name: target.name,
      distanceKm: calculateBorderDistanceKm(source, target),
    });
  }

  allDistancesCache.set(source.name, results);
  return results;
}

/**
 * Find the nearest km value that actually has country matches.
 * Scans all distances from source, finds which actual distance is closest to targetKm,
 * then returns a NearbyResult centered on that distance.
 */
export async function findNearestResultKm(
  country: string,
  targetKm: number,
): Promise<NearbyResult> {
  const allDistances = await getAllDistancesFrom(country);

  let closest = allDistances[0];
  for (const d of allDistances) {
    if (Math.abs(d.distanceKm - targetKm) < Math.abs(closest.distanceKm - targetKm)) {
      closest = d;
    }
  }

  return findCountriesNearby(country, closest.distanceKm, 50);
}
