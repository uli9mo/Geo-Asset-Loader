# Border Distance Calculator

## Overview

Single-page web app where users type `[Country] [KM]` (e.g. "France 550") and see all countries approximately that distance away (±50 km tolerance). All geospatial computation runs in the browser using `@turf/turf`.

## Architecture

The root is a **flat, standalone Vite + React app** — ready for zero-config Vercel deployment.

- **Root `src/`** — React frontend (the deployable app)
- **Root `vite.config.ts`** — Standard Vite config, no PORT env var required
- **Root `package.json`** — Single package with all dependencies
- **Root `tsconfig.json`** — Standard Vite/React TypeScript config
- **`vercel.json`** — Points Vercel at `dist/` output, uses `npm run build`

## Stack

- **Framework**: React 19 + Vite 7
- **Routing**: wouter
- **Data fetching**: TanStack React Query (client-side geo queries)
- **Geospatial**: @turf/turf (runs fully in-browser)
- **GeoJSON data**: Fetched at runtime from `raw.githubusercontent.com/johan/world.geo.json`
- **Styling**: Tailwind CSS v4, shadcn/ui components, framer-motion
- **TypeScript**: 5.9

## Key Commands (root)

```sh
npx vite          # dev server on port 5173
npx vite build    # production build → dist/
npx tsc --noEmit  # typecheck
```

## Vercel Deployment

Push to GitHub, import on Vercel — it auto-detects the Vite framework and uses the `vercel.json` settings. No environment variables required.

## Excluded Countries

Nauru, Western Sahara, Tuvalu, Palau, Kiribati, Micronesia.

## Workspace (legacy, kept for Replit dev)

The `artifacts/` and `lib/` pnpm workspace packages still exist for local Replit development but are not part of the Vercel build.
