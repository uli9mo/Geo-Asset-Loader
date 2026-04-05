import * as turf from "@turf/turf";
import type { FeatureCollection, Geometry } from "geojson";
import { logger } from "./logger";

const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

const EXCLUDED_COUNTRIES = new Set([
  "Nauru",
  "Western Sahara",
  "Tuvalu",
  "Palau",
  "Kiribati",
  "Micronesia",
]);

export interface CountryFeature {
  name: string;
  geometry: turf.AllGeoJSON;
}

let cachedCountries: CountryFeature[] | null = null;

export async function loadCountries(): Promise<CountryFeature[]> {
  if (cachedCountries) return cachedCountries;

  logger.info("Loading world GeoJSON data...");

  const response = await fetch(WORLD_GEOJSON_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch world GeoJSON: ${response.statusText}`);
  }

  const geojson = (await response.json()) as FeatureCollection;

  const countries: CountryFeature[] = [];
  for (const feature of geojson.features) {
    const name = feature.properties?.name as string | undefined;
    if (!name || EXCLUDED_COUNTRIES.has(name)) continue;
    countries.push({ name, geometry: feature.geometry as turf.AllGeoJSON });
  }

  cachedCountries = countries;
  logger.info({ count: countries.length }, "World GeoJSON loaded and cached");
  return countries;
}

export function findCountry(
  query: string,
  countries: CountryFeature[],
): CountryFeature | null {
  const lower = query.toLowerCase();
  const match = countries.find((c) => c.name.toLowerCase().includes(lower));
  return match ?? null;
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
    return Math.round(turf.distance(centroidA, centroidB, { units: "kilometers" }));
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
