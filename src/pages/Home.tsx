import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Search, Globe, X, RefreshCw, Compass, Star, Lightbulb, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { findCountriesNearby, findNearestResultKm, type NearbyResult } from "@/lib/geo";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuessEntry {
  id: string;
  result: NearbyResult;
}

const TOLERANCE_OPTIONS = [25, 50, 75, 100, 150, 200];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseInput(raw: string): { country: string; km: number } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const country = match[1].trim();
  const km = parseFloat(match[2]);
  if (!country || isNaN(km) || km < 0) return null;
  return { country, km };
}

function guessKey(r: NearbyResult) {
  return `${r.sourceCountry}|${r.targetKm}|${r.tolerance}`;
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
  const { result } = entry;
  const confirmedMatches = result.matches.filter((m) => m.confirmed);
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
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">
            {result.sourceCountry}
          </span>
          <span className="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
            {result.targetKm.toLocaleString()} km
          </span>
          <span className="shrink-0 text-xs text-muted-foreground/60">
            ±{result.tolerance} km
          </span>
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

      {/* "Is this it?" banner for confirmed countries */}
      {hasConfirmed && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-2.5 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {confirmedMatches.length === 1
              ? `Is it ${confirmedMatches[0].name}?`
              : `Possible: ${confirmedMatches.map((m) => m.name).join(", ")}`}
          </span>
          <span className="text-xs text-emerald-600/60 dark:text-emerald-500/60">
            verified distance
          </span>
        </motion.div>
      )}

      {/* Country chips */}
      {result.matches.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">No countries in this range</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {result.matches.map((m) => {
            const isCrossRef = crossReferenced.has(m.name);
            const isConfirmed = m.confirmed;

            let chipClass = "bg-muted/50 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground";
            if (isConfirmed) {
              chipClass = "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 font-semibold";
            } else if (isCrossRef) {
              chipClass = "bg-amber-400/15 border-amber-400/50 text-amber-600 dark:text-amber-400";
            }

            return (
              <Tooltip key={m.name}>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border cursor-default transition-colors ${chipClass}`}
                  >
                    {isConfirmed && <Sparkles className="w-2.5 h-2.5 shrink-0" />}
                    {!isConfirmed && isCrossRef && <Star className="w-2.5 h-2.5 fill-current shrink-0" />}
                    {m.name}
                    {m.touching && <span className="opacity-50 ml-0.5">·B</span>}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {m.name} · {m.distanceKm.toLocaleString()} km away
                  {isConfirmed && " (verified)"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* Midpoint suggestion */}
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
  const [query, setQuery] = useState<{ country: string; km: number } | null>(null);
  const [parseError, setParseError] = useState(false);
  const [guesses, setGuesses] = useState<GuessEntry[]>([]);
  const [tolerance, setTolerance] = useState(50);
  const [isFindingNearest, setIsFindingNearest] = useState(false);
  const [autoFindNearest, setAutoFindNearest] = useState(false);
  const autoFindTriggeredRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Main search query ──────────────────────────────────────────────────────
  const { data, isFetching, error } = useQuery({
    queryKey: ["nearby", query?.country, query?.km, tolerance],
    queryFn: () => findCountriesNearby(query!.country, query!.km, tolerance),
    enabled: !!query,
    retry: false,
  });

  // Auto-save successful results to guess history
  useEffect(() => {
    if (!data || isFetching) return;
    setGuesses((prev) => {
      const key = guessKey(data);
      if (prev.some((g) => guessKey(g.result) === key)) return prev;
      return [{ id: crypto.randomUUID(), result: data }, ...prev];
    });
  }, [data, isFetching]);

  // ── Auto-find nearest when toggle is on and result is empty ───────────────
  const handleFindNearest = useCallback(async (sourceQuery?: { country: string; km: number }) => {
    const q = sourceQuery ?? query;
    if (!q || isFindingNearest) return;
    setIsFindingNearest(true);
    try {
      const nearest = await findNearestResultKm(q.country, q.km);
      setInputValue(`${nearest.sourceCountry} ${nearest.targetKm}`);
      setQuery({ country: nearest.sourceCountry, km: nearest.targetKm });
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

  // ── Cross-referencing ──────────────────────────────────────────────────────
  const crossReferenced = useMemo<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const g of guesses) {
      for (const m of g.result.matches) {
        counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
      }
    }
    return new Set(
      [...counts.entries()].filter(([, c]) => c >= 2).map(([n]) => n),
    );
  }, [guesses]);

  // ── Submit / parse ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const parsed = parseInput(inputValue);
    if (!parsed) {
      setParseError(true);
      return;
    }
    setParseError(false);
    setQuery(parsed);
  }, [inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setParseError(false);
  };

  // ── Remove / new round ─────────────────────────────────────────────────────
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
    !isFetching &&
    !isFindingNearest &&
    !autoFindNearest &&
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

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl bg-primary/10 text-primary border border-primary/20 mb-1">
            <Globe className="w-6 h-6" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Border Search
          </h1>
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

          {/* Controls row: tolerance + auto-find toggle */}
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
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Auto-find nearest</span>
              <Switch
                checked={autoFindNearest}
                onCheckedChange={setAutoFindNearest}
                aria-label="Auto-find nearest country"
              />
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

        {/* ── Manual find-nearest button (only shown when auto-find is off) ── */}
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
          {guesses.length === 0 && !isActive && !error && (
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
