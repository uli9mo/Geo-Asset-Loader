import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Search, Globe, X, RefreshCw, Compass, Star, Lightbulb, Sparkles, Palette, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  findCountriesNearby,
  findNearestResultKm,
  findCountriesByRange,
  type NearbyResult,
  type RangeMatch,
} from "@/lib/geo";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuessEntry {
  id: string;
  result: NearbyResult;
  isDirectInput: boolean;
}

interface ActiveQuery {
  country: string;
  km: number;
  direct: boolean;
}

const TOLERANCE_OPTIONS = [25, 50, 75, 100, 150, 200];

// ─── Compass helpers ─────────────────────────────────────────────────────────

type CompassDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

function bearingToDir(deg: number): CompassDir {
  const n = ((deg % 360) + 360) % 360;
  if (n >= 337.5 || n < 22.5) return "N";
  if (n < 67.5) return "NE";
  if (n < 112.5) return "E";
  if (n < 157.5) return "SE";
  if (n < 202.5) return "S";
  if (n < 247.5) return "SW";
  if (n < 292.5) return "W";
  return "NW";
}

const COMPASS_GRID: ReadonlyArray<ReadonlyArray<CompassDir | "">> = [
  ["NW", "N", "NE"],
  ["W",  "",  "E" ],
  ["SW", "S", "SE"],
];

// ─── Colour estimation helpers ───────────────────────────────────────────────

const LABEL_PRESETS: Record<string, { hex: string; km: number; range: [number, number] }> = {
  "Very Close": { hex: "#ff5e74", km: 264,  range: [0,    528]  },
  "Close":      { hex: "#ff9aaa", km: 1506, range: [400,  2800] },
  "Far":        { hex: "#fff2f4", km: 4890, range: [2400, 7000] },
  "Very Far":   { hex: "#fffcff", km: 9000, range: [6500, 20000] },
};

/**
 * Piecewise-linear anchor points: { km, g, b }
 * R is always 255 in this gradient.
 * Derived from the label anchors provided by the user.
 */
const ANCHORS = [
  { km: 0,    g: 94,  b: 116 },  // #ff5e74  Very Close
  { km: 653,  g: 154, b: 170 },  // #ff9aaa  Close
  { km: 2882, g: 242, b: 244 },  // #fff2f4  Far
  { km: 7224, g: 252, b: 255 },  // #fffcff  Very Far (plateau beyond here)
];

function colorToKmEstimate(hex: string): { km: number; range: [number, number]; label: string } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // If R is far from 255 the colour is very different — treat as unknown
  if (r < 200) return { km: 3000, range: [0, 20000], label: "Unknown" };

  // Clamp g to known range
  const gClamped = Math.max(ANCHORS[0].g, Math.min(ANCHORS[ANCHORS.length - 1].g, g));

  // Find which segment g falls into
  let km = 0;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i];
    const hi = ANCHORS[i + 1];
    if (gClamped >= lo.g && gClamped <= hi.g) {
      const t = (gClamped - lo.g) / (hi.g - lo.g);
      km = Math.round(lo.km + t * (hi.km - lo.km));
      break;
    }
  }

  // Beyond plateau
  if (g >= ANCHORS[ANCHORS.length - 1].g) km = 7224;

  // Tolerance grows as colour becomes more saturated (less reliable at far distances)
  const tFactor = (g - ANCHORS[0].g) / (ANCHORS[ANCHORS.length - 1].g - ANCHORS[0].g);
  const tol = Math.round(300 + tFactor * 2700); // 300 km near, 3000 km far

  // Label
  let label = "Very Close";
  if (km > 528) label = "Close";
  if (km > 2359) label = "Far";
  if (km > 6899) label = "Very Far";

  // Also factor in b channel for b-heavy colours (slight correction)
  const bClamped = Math.max(ANCHORS[0].b, Math.min(ANCHORS[ANCHORS.length - 1].b, b));
  const bFactor = (bClamped - ANCHORS[0].b) / (ANCHORS[ANCHORS.length - 1].b - ANCHORS[0].b);
  const blendedFactor = (tFactor + bFactor) / 2;
  const kmBlended = Math.round(blendedFactor * 7224);
  const kmFinal = Math.round((km + kmBlended) / 2);

  return {
    km: kmFinal,
    range: [Math.max(0, kmFinal - tol), kmFinal + tol],
    label,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseInput(raw: string): { country: string; km: number } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+([\d,]+(?:\.\d+)?)$/);
  if (!match) return null;
  const country = match[1].trim();
  const km = parseFloat(match[2].replace(/,/g, ""));
  if (!country || isNaN(km) || km < 0) return null;
  return { country, km };
}

function guessKey(r: NearbyResult) {
  return `${r.sourceCountry}|${r.targetKm}|${r.tolerance}`;
}

// ─── Direction Picker ────────────────────────────────────────────────────────

function DirectionPicker({
  selected,
  onChange,
  compact = false,
}: {
  selected: CompassDir | null;
  onChange: (dir: CompassDir | null) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "" : "mt-2.5"}`}>
      {!compact && <span className="text-xs text-muted-foreground/60 shrink-0 leading-none">Direction hint</span>}
      <div className="grid grid-cols-3 gap-0.5" style={{ width: 72 }}>
        {COMPASS_GRID.map((row, ri) =>
          row.map((dir, ci) => {
            if (dir === "") {
              return (
                <button
                  key={`${ri}-${ci}`}
                  onClick={() => onChange(null)}
                  title="Clear direction"
                  className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors
                    ${selected ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/30"}`}
                >
                  ·
                </button>
              );
            }
            const isActive = selected === dir;
            return (
              <button
                key={`${ri}-${ci}`}
                onClick={() => onChange(isActive ? null : (dir as CompassDir))}
                title={dir}
                className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold transition-colors
                  ${isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
              >
                {dir}
              </button>
            );
          })
        )}
      </div>
      {selected && (
        <span className="text-xs text-primary font-semibold">
          {compact ? selected : `Filtering ${selected}`}
        </span>
      )}
    </div>
  );
}

// ─── Colour Estimator ────────────────────────────────────────────────────────

function ColourEstimator({ crossReferenced }: { crossReferenced: Set<string> }) {
  const [source, setSource] = useState("");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [colorHex, setColorHex] = useState("#ff9aaa");
  const [direction, setDirection] = useState<CompassDir | null>(null);
  const [searched, setSearched] = useState(false);

  const { km, range, label: autoLabel } = useMemo(() => colorToKmEstimate(colorHex), [colorHex]);

  const queryKey = useMemo(
    () => ["colorRange", source.trim().toLowerCase(), range[0], range[1]],
    [source, range],
  );

  const { data: rawMatches, isFetching, error } = useQuery<RangeMatch[]>({
    queryKey,
    queryFn: () => findCountriesByRange(source.trim(), range[0], range[1]),
    enabled: searched && !!source.trim(),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const sortedResults = useMemo(() => {
    if (!rawMatches) return [];
    return rawMatches
      .map((r) => ({
        ...r,
        dir: bearingToDir(r.bearingDeg),
        dirMatch: direction ? bearingToDir(r.bearingDeg) === direction : true,
        isCross: crossReferenced.has(r.name),
      }))
      .sort((a, b) => {
        if (a.dirMatch !== b.dirMatch) return a.dirMatch ? -1 : 1;
        if (a.isCross !== b.isCross) return a.isCross ? -1 : 1;
        return Math.abs(a.distanceKm - km) - Math.abs(b.distanceKm - km);
      });
  }, [rawMatches, direction, crossReferenced, km]);

  function handleLabelClick(lbl: string) {
    setActiveLabel(lbl);
    setColorHex(LABEL_PRESETS[lbl].hex);
  }

  function handleColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    setActiveLabel(null);
    setColorHex(e.target.value);
  }

  function handleSearch() {
    if (!source.trim()) return;
    setSearched(true);
  }

  // Re-run when source or range changes after initial search
  useEffect(() => {
    if (searched && source.trim()) setSearched(true);
  }, [source, range]);

  const directionMatches = sortedResults.filter((r) => r.dirMatch);
  const topGuesses = directionMatches.slice(0, 10);
  const restGuesses = direction ? [] : sortedResults.slice(10);

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-primary/70" />
        <span className="text-sm font-semibold text-foreground">Colour Estimator</span>
        <span className="text-xs text-muted-foreground/60">— use the colour shown in the game to estimate distance</span>
      </div>

      {/* Source country */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0 w-16">From:</span>
        <input
          type="text"
          value={source}
          onChange={(e) => { setSource(e.target.value); setSearched(false); }}
          placeholder="e.g. China"
          className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Label picker */}
      <div className="flex items-start gap-2">
        <span className="text-xs text-muted-foreground shrink-0 w-16 pt-1">Label:</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(LABEL_PRESETS).map((lbl) => (
            <button
              key={lbl}
              onClick={() => handleLabelClick(lbl)}
              className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors
                ${activeLabel === lbl
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Colour picker + preview */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground shrink-0 w-16">Colour:</span>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="color"
              value={colorHex}
              onChange={handleColorChange}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
              title="Pick the colour you see in the game"
            />
          </div>
          <div
            className="w-8 h-8 rounded-lg border border-border/60 shadow-inner"
            style={{ backgroundColor: colorHex }}
          />
          <span className="text-xs font-mono text-muted-foreground">{colorHex}</span>
          <span className="text-xs text-muted-foreground/60">→</span>
          <span className="text-xs font-semibold text-foreground">
            ~{km.toLocaleString()} km
          </span>
          <span className="text-xs text-muted-foreground/60">
            ({autoLabel}, ±{Math.round((range[1] - range[0]) / 2).toLocaleString()} km)
          </span>
        </div>
      </div>

      {/* Range bar visualisation */}
      <div className="flex items-center gap-2 pl-[4.5rem]">
        <div className="flex-1 h-2 rounded-full bg-muted relative overflow-hidden">
          {/* gradient strip */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: "linear-gradient(to right, #ff5e74, #ff9aaa, #fff2f4, #fffcff)" }}
          />
          {/* selected range window */}
          <div
            className="absolute top-0 h-full rounded-full border-2 border-primary bg-primary/20"
            style={{
              left: `${Math.min(100, (range[0] / 20000) * 100)}%`,
              width: `${Math.min(100 - (range[0] / 20000) * 100, ((range[1] - range[0]) / 20000) * 100)}%`,
            }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground/50 shrink-0">20 000 km</span>
      </div>

      {/* Direction picker */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0 w-16">Direction:</span>
        <DirectionPicker selected={direction} onChange={setDirection} compact />
        {!direction && (
          <span className="text-xs text-muted-foreground/50">optional — narrows results</span>
        )}
      </div>

      {/* Find button */}
      <div className="pl-[4.5rem]">
        <button
          onClick={handleSearch}
          disabled={!source.trim() || isFetching}
          className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {isFetching ? "Scanning…" : "Find Best Guesses"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive pl-[4.5rem]">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      )}

      {/* Results */}
      <AnimatePresence>
        {searched && !isFetching && rawMatches && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                Best guesses
              </span>
              <span className="text-xs text-muted-foreground/60">
                {direction
                  ? `${directionMatches.length} match${directionMatches.length !== 1 ? "es" : ""} heading ${direction}`
                  : `${sortedResults.length} countries in range`}
              </span>
            </div>

            {sortedResults.length === 0 && (
              <p className="text-xs text-muted-foreground/60 italic">
                No countries found in this range from {source}. Try adjusting the colour or tolerance.
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {topGuesses.map((r, i) => (
                <Tooltip key={r.name}>
                  <TooltipTrigger asChild>
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border cursor-default transition-colors
                        ${r.isCross
                          ? "bg-amber-400/15 border-amber-400/50 text-amber-600 dark:text-amber-400"
                          : i === 0 && r.dirMatch
                          ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                          : "bg-muted/50 border-border/60 text-muted-foreground"}`}
                    >
                      {i === 0 && r.dirMatch && <Sparkles className="w-2.5 h-2.5 shrink-0" />}
                      {r.isCross && <Star className="w-2.5 h-2.5 fill-current shrink-0" />}
                      {r.name}
                      <span className="opacity-50 ml-0.5">{r.dir}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {r.name} · {r.distanceKm.toLocaleString()} km · {r.dir}
                    {r.isCross ? " · cross-ref ★" : ""}
                  </TooltipContent>
                </Tooltip>
              ))}
              {restGuesses.length > 0 && (
                <span className="text-xs text-muted-foreground/50 self-center">
                  +{restGuesses.length} more
                </span>
              )}
            </div>

            {topGuesses.length > 0 && (
              <p className="text-xs text-muted-foreground/50">
                Hover for exact km · Top result is best match for colour{direction ? ` + ${direction} direction` : ""}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Guess Card ──────────────────────────────────────────────────────────────

function GuessCard({
  entry,
  crossReferenced,
  onRemove,
  isNewest,
}: {
  entry: GuessEntry;
  crossReferenced: Set<string>;
  onRemove: (id: string) => void;
  isNewest: boolean;
}) {
  const { result, isDirectInput } = entry;
  const [directionHint, setDirectionHint] = useState<CompassDir | null>(null);

  const confirmedMatches = isDirectInput
    ? result.matches.filter((m) => m.confirmed)
    : [];
  const hasConfirmed = confirmedMatches.length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      className={`relative rounded-xl border px-4 py-3 group transition-colors
        ${isNewest
          ? "bg-card/70 border-primary/30 shadow-sm shadow-primary/10"
          : "bg-muted/20 border-border/40 backdrop-blur-sm"}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{result.sourceCountry}</span>
          <span className="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
            {result.targetKm.toLocaleString()} km
          </span>
          <span className="shrink-0 text-xs text-muted-foreground/60">±{result.tolerance} km</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {result.matches.length === 0
              ? "no matches"
              : `${result.matches.length} match${result.matches.length !== 1 ? "es" : ""}`}
          </span>
        </div>
        <button
          onClick={() => onRemove(entry.id)}
          aria-label="Remove guess"
          className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {hasConfirmed && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-2.5 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {confirmedMatches.length === 1
              ? `Could this be ${confirmedMatches[0].name}?`
              : `Strong candidates: ${confirmedMatches.map((m) => m.name).join(", ")}`}
          </span>
          <span className="text-xs text-emerald-600/50 dark:text-emerald-500/50">(known distance)</span>
        </motion.div>
      )}

      {result.matches.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">No countries in this range</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {result.matches.map((m) => {
            const isCrossRef = crossReferenced.has(m.name);
            const isConfirmed = isDirectInput && m.confirmed;
            const chipDir = bearingToDir(m.bearingDeg);
            const isDimmed = directionHint !== null && chipDir !== directionHint;

            let chipClass = "bg-muted/50 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground";
            if (isConfirmed) chipClass = "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 font-semibold";
            else if (isCrossRef) chipClass = "bg-amber-400/15 border-amber-400/50 text-amber-600 dark:text-amber-400";

            return (
              <Tooltip key={m.name}>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border cursor-default transition-all ${chipClass}`}
                    style={{ opacity: isDimmed ? 0.25 : 1 }}
                  >
                    {isConfirmed && <Sparkles className="w-2.5 h-2.5 shrink-0" />}
                    {!isConfirmed && isCrossRef && <Star className="w-2.5 h-2.5 fill-current shrink-0" />}
                    {m.name}
                    {m.touching && <span className="opacity-50 ml-0.5">·B</span>}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {m.name} · {m.distanceKm.toLocaleString()} km · {chipDir}
                  {isConfirmed && " · known distance"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {result.matches.length > 0 && (
        <DirectionPicker selected={directionHint} onChange={setDirectionHint} />
      )}

      {result.midpointSuggestion && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Lightbulb className="w-3 h-3 text-yellow-500/70 shrink-0" />
          <span>Try guessing from</span>
          <span className="font-semibold text-foreground/80">{result.midpointSuggestion}</span>
          <span className="text-muted-foreground/50">to narrow it down</span>
        </div>
      )}
    </motion.div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState<ActiveQuery | null>(null);
  const [parseError, setParseError] = useState(false);
  const [guesses, setGuesses] = useState<GuessEntry[]>([]);
  const [tolerance, setTolerance] = useState(50);
  const [isFindingNearest, setIsFindingNearest] = useState(false);
  const [autoFindNearest, setAutoFindNearest] = useState(false);
  const [showEstimator, setShowEstimator] = useState(false);
  const autoFindTriggeredRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<ActiveQuery | null>(null);
  useEffect(() => { queryRef.current = query; }, [query]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["nearby", query?.country, query?.km, tolerance],
    queryFn: () => findCountriesNearby(query!.country, query!.km, tolerance),
    enabled: !!query,
    retry: false,
  });

  useEffect(() => {
    if (!data || isFetching) return;
    const isDirect = queryRef.current?.direct ?? false;
    setGuesses((prev) => {
      const key = guessKey(data);
      if (prev.some((g) => guessKey(g.result) === key)) return prev;
      return [{ id: crypto.randomUUID(), result: data, isDirectInput: isDirect }, ...prev];
    });
  }, [data, isFetching]);

  const handleFindNearest = useCallback(async (sourceQuery?: { country: string; km: number }) => {
    const q = sourceQuery ?? query;
    if (!q || isFindingNearest) return;
    setIsFindingNearest(true);
    try {
      const nearest = await findNearestResultKm(q.country, q.km);
      setInputValue(`${nearest.sourceCountry} ${nearest.targetKm}`);
      setQuery({ country: nearest.sourceCountry, km: nearest.targetKm, direct: false });
    } finally {
      setIsFindingNearest(false);
    }
  }, [query, isFindingNearest]);

  useEffect(() => {
    if (!data || isFetching || isFindingNearest || !autoFindNearest) return;
    if (data.matches.length > 0) return;
    const key = guessKey(data);
    if (autoFindTriggeredRef.current === key) return;
    autoFindTriggeredRef.current = key;
    handleFindNearest({ country: data.sourceCountry, km: data.targetKm });
  }, [data, isFetching, isFindingNearest, autoFindNearest, handleFindNearest]);

  const crossReferenced = useMemo<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const g of guesses) {
      for (const m of g.result.matches) {
        counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, c]) => c >= 2).map(([n]) => n));
  }, [guesses]);

  const handleSubmit = useCallback(() => {
    const parsed = parseInput(inputValue);
    if (!parsed) { setParseError(true); return; }
    setParseError(false);
    setQuery({ ...parsed, direct: true });
  }, [inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setParseError(false);
  };

  const removeGuess = useCallback((id: string) => {
    setGuesses((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const newRound = useCallback(() => {
    setGuesses([]);
    setQuery(null);
    setInputValue("");
    setParseError(false);
    autoFindTriggeredRef.current = null;
    inputRef.current?.focus();
  }, []);

  const mostRecentGuess = guesses[0] ?? null;
  const showFindNearestButton =
    !isFetching && !isFindingNearest && !autoFindNearest &&
    mostRecentGuess?.result.matches.length === 0;
  const isActive = isFetching || isFindingNearest;

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center py-14 px-4 bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.025]">
        <svg viewBox="0 0 800 800" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="400" cy="400" r="120" />
          <circle cx="400" cy="400" r="240" />
          <circle cx="400" cy="400" r="360" />
          <line x1="400" y1="0" x2="400" y2="800" />
          <line x1="0" y1="400" x2="800" y2="400" />
          <line x1="80" y1="80" x2="720" y2="720" />
          <line x1="720" y1="80" x2="80" y2="720" />
        </svg>
      </div>

      <div className="w-full max-w-2xl relative z-10 flex flex-col gap-5">

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl bg-primary/10 text-primary border border-primary/20 mb-1">
            <Globe className="w-6 h-6" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Border Search</h1>
          <p className="text-muted-foreground text-base">
            Type <span className="font-mono text-foreground/70">Country&nbsp;KM</span> and hit Enter to find countries at that distance.
          </p>
        </div>

        {/* ── Search input ─────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div
            className={`flex items-center gap-3 bg-card border rounded-xl px-4 py-3 shadow-md transition-all
              ${parseError
                ? "border-destructive ring-2 ring-destructive/20"
                : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"}`}
          >
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="France 550"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/40 text-lg font-medium outline-none min-w-0"
            />
            {guesses.length > 0 && (
              <button
                onClick={newRound}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                New Round
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={isActive || !inputValue.trim()}
              className="shrink-0 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {isActive ? "…" : "Search"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">±km:</span>
              <div className="flex gap-1">
                {TOLERANCE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTolerance(t)}
                    className={`text-xs px-2 py-0.5 rounded-md font-medium transition-colors
                      ${tolerance === t
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEstimator((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Palette className="w-3.5 h-3.5" />
                Colour Estimator
                {showEstimator ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Auto-find</span>
                <Switch
                  checked={autoFindNearest}
                  onCheckedChange={setAutoFindNearest}
                  aria-label="Auto-find nearest country"
                />
              </div>
            </div>
          </div>

          <AnimatePresence>
            {parseError && (
              <motion.p
                key="parse-error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-destructive ml-1 flex items-center gap-1"
              >
                Format: <span className="font-mono font-semibold">Country&nbsp;KM</span> e.g. <span className="font-mono font-semibold">France&nbsp;550</span>
              </motion.p>
            )}
          </AnimatePresence>

          {crossReferenced.size > 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-amber-600 dark:text-amber-400 ml-1 flex items-center gap-1.5"
            >
              <Star className="w-3 h-3 fill-current" />
              <span>
                <span className="font-semibold">{crossReferenced.size}</span>{" "}
                {crossReferenced.size === 1 ? "country" : "countries"} confirmed across multiple guesses
              </span>
            </motion.p>
          )}
        </div>

        {/* ── Colour Estimator (collapsible) ───────────────────────────────── */}
        <AnimatePresence>
          {showEstimator && (
            <motion.div
              key="estimator"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <ColourEstimator crossReferenced={crossReferenced} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error ────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && !isFetching && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error instanceof Error ? error.message : "Something went wrong. Try a different spelling."}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Loading skeleton ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {isActive && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <div className="h-4 w-28 rounded bg-muted animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
                {isFindingNearest && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Compass className="w-3 h-3 animate-spin" />
                    Scanning distances…
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {[60, 80, 70, 90, 55].map((w, i) => (
                  <div
                    key={i}
                    className="h-5 rounded-full bg-muted animate-pulse"
                    style={{ width: w, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Manual find-nearest button ────────────────────────────────────── */}
        <AnimatePresence>
          {showFindNearestButton && (
            <motion.div
              key="find-nearest"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 py-1"
            >
              <p className="text-sm text-muted-foreground">
                No countries found at{" "}
                <span className="font-mono font-medium text-foreground">
                  {mostRecentGuess.result.targetKm.toLocaleString()} km
                </span>
              </p>
              <button
                onClick={() => handleFindNearest()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
              >
                <Compass className="w-4 h-4" />
                Find Nearest Country
              </button>
              <p className="text-xs text-muted-foreground/50">
                Or toggle Auto-find to do this automatically
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Guess history ─────────────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {guesses.length > 0 && (
            <motion.div
              key="guess-list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-2"
            >
              <AnimatePresence mode="popLayout">
                {guesses.map((entry, i) => (
                  <GuessCard
                    key={entry.id}
                    entry={entry}
                    crossReferenced={crossReferenced}
                    onRemove={removeGuess}
                    isNewest={i === 0}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Idle empty state ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {guesses.length === 0 && !isActive && !error && !showEstimator && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center gap-2"
            >
              <div className="text-4xl opacity-20 select-none">🌍</div>
              <p className="text-muted-foreground/50 text-sm">Your guesses will appear here</p>
              <p className="text-muted-foreground/35 text-xs">
                Countries confirmed in multiple guesses glow{" "}
                <span className="text-amber-500/60">gold ★</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
