import { Router, type IRouter } from "express";
import {
  GetCountriesNearbyQueryParams,
  GetCountriesNearbyResponse,
  ListCountriesResponse,
} from "@workspace/api-zod";
import { loadCountries, findCountry, calculateBorderDistanceKm } from "../lib/geo";

const router: IRouter = Router();

router.get("/countries", async (req, res): Promise<void> => {
  const countries = await loadCountries();
  const names = countries.map((c) => c.name).sort();
  res.json(ListCountriesResponse.parse({ countries: names }));
});

router.get("/countries/nearby", async (req, res): Promise<void> => {
  const parsed = GetCountriesNearbyQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { country, km, tolerance = 50 } = parsed.data;
  const countries = await loadCountries();

  const sourceFeature = findCountry(country, countries);
  if (!sourceFeature) {
    res.status(404).json({ error: `Country not found: "${country}"` });
    return;
  }

  const lower = km - tolerance;
  const upper = km + tolerance;

  const matches = [];
  for (const target of countries) {
    if (target.name === sourceFeature.name) continue;

    const distanceKm = calculateBorderDistanceKm(sourceFeature, target);
    if (distanceKm >= lower && distanceKm <= upper) {
      matches.push({
        name: target.name,
        distanceKm,
        touching: distanceKm === 0,
      });
    }
  }

  matches.sort((a, b) => a.distanceKm - b.distanceKm);

  req.log.info(
    { source: sourceFeature.name, km, tolerance, matchCount: matches.length },
    "Nearby countries calculated",
  );

  res.json(
    GetCountriesNearbyResponse.parse({
      sourceCountry: sourceFeature.name,
      targetKm: km,
      tolerance,
      matches,
    }),
  );
});

export default router;
