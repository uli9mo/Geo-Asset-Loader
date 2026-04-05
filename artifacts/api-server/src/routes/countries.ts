import { Router, type IRouter } from "express";
import {
  GetCountryDistanceQueryParams,
  GetCountryDistanceResponse,
  ListCountriesResponse,
} from "@workspace/api-zod";
import { loadCountries, findCountry, calculateBorderDistanceKm } from "../lib/geo";

const router: IRouter = Router();

router.get("/countries", async (req, res): Promise<void> => {
  const countries = await loadCountries();
  const names = countries.map((c) => c.name).sort();
  res.json(ListCountriesResponse.parse({ countries: names }));
});

router.get("/countries/distance", async (req, res): Promise<void> => {
  const parsed = GetCountryDistanceQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { countryA, countryB } = parsed.data;
  const countries = await loadCountries();

  const featureA = findCountry(countryA, countries);
  const featureB = findCountry(countryB, countries);

  if (!featureA) {
    res.status(404).json({ error: `Country not found: "${countryA}"` });
    return;
  }

  if (!featureB) {
    res.status(404).json({ error: `Country not found: "${countryB}"` });
    return;
  }

  const distanceKm = calculateBorderDistanceKm(featureA, featureB);
  const touching = distanceKm === 0;

  req.log.info(
    { countryA: featureA.name, countryB: featureB.name, distanceKm, touching },
    "Distance calculated",
  );

  res.json(
    GetCountryDistanceResponse.parse({
      countryA: featureA.name,
      countryB: featureB.name,
      distanceKm,
      touching,
    }),
  );
});

export default router;
