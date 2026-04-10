import * as turf from "@turf/turf";
import type { FeatureCollection, Geometry, Feature, Point } from "geojson";

const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

const EXCLUDED_COUNTRIES = new Set([
  "Nauru",
  "Tuvalu",
  "Palau",
  "Kiribati",
  "Micronesia",
  "Vatican",
  "Vatican City",
  "Holy See",
  "San Marino",
  "Liechtenstein",
  "Andorra",
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
  "Northern Cyprus",
  "N. Cyprus",
]);

/**
 * Known-correct distances where the GeoJSON polygon data is slightly inaccurate.
 * Key: lowercase source country name.
 * These are only injected when the user typed the distance directly — the UI
 * decides whether to surface `confirmed: true` based on isDirectInput.
 */
const KNOWN_DISTANCES: Record<string, Array<{ country: string; km: number }>> = {
  china: [
    { country: "Denmark", km: 4456 },
    { country: "Papua New Guinea", km: 3879 },
    { country: "Belarus", km: 3427 },
    { country: "Austria", km: 4549 },
    { country: "Jamaica", km: 11823 },
    { country: "Dominica", km: 12252 },
    { country: "Taiwan", km: 180 },
    { country: "Moldova", km: 3587 },
    { country: "Bhutan", km: 2 },
    { country: "Bahrain", km: 2535 },
    { country: "Seychelles", km: 4554 },
  ],
};

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

function getCentroid(feature: CountryFeature) {
  return turf.centroid(turf.feature(feature.geometry as Geometry));
}

/** Returns bearing in [0, 360) degrees clockwise from north */
function computeBearing(from: Feature<Point>, to: Feature<Point>): number {
  const raw = turf.bearing(from, to);
  return ((raw % 360) + 360) % 360;
}

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
    const c = getCentroid(f);
    sumLng += c.geometry.coordinates[0];
    sumLat += c.geometry.coordinates[1];
  }
  const center = turf.point([sumLng / matchedFeatures.length, sumLat / matchedFeatures.length]);

  const excluded = new Set([...matchedNames, sourceCountry]);
  let suggestion: string | null = null;
  let best = Infinity;

  for (const c of countries) {
    if (excluded.has(c.name)) continue;
    const centroid = getCentroid(c);
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
  /** True when the distance is from KNOWN_DISTANCES (GeoJSON inaccuracy correction). */
  confirmed: boolean;
  /** Bearing in degrees [0,360) clockwise from north, source centroid → target centroid. */
  bearingDeg: number;
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
  const sourceCentroid = getCentroid(source);

  const matches: CountryMatch[] = [];
  for (const target of countries) {
    if (target.name === source.name) continue;
    const distanceKm = calculateBorderDistanceKm(source, target);
    if (distanceKm >= lower && distanceKm <= upper) {
      const bearingDeg = computeBearing(sourceCentroid, getCentroid(target));
      matches.push({ name: target.name, distanceKm, touching: distanceKm === 0, confirmed: false, bearingDeg });
    }
  }

  // Inject / mark known-correct distances
  const corrections = KNOWN_DISTANCES[source.name.toLowerCase()] ?? [];
  for (const corr of corrections) {
    if (corr.km < lower || corr.km > upper) continue;
    const corrTarget = countries.find((c) => c.name === corr.country);
    const bearingDeg = corrTarget ? computeBearing(sourceCentroid, getCentroid(corrTarget)) : 0;
    const existing = matches.findIndex((m) => m.name === corr.country);
    if (existing >= 0) {
      matches[existing] = { ...matches[existing], confirmed: true };
    } else {
      matches.push({ name: corr.country, distanceKm: corr.km, touching: corr.km === 0, confirmed: true, bearingDeg });
    }
  }

  // Sort by proximity to the target km (closest delta first)
  matches.sort(
    (a, b) => Math.abs(a.distanceKm - km) - Math.abs(b.distanceKm - km),
  );

  const midpointSuggestion = computeMidpointSuggestion(
    countries,
    source.name,
    matches.map((m) => m.name),
  );

  return { sourceCountry: source.name, targetKm: km, tolerance, matches, midpointSuggestion };
}

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
