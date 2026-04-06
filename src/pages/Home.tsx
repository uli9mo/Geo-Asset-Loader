// artifacts/border-distance/src/pages/Home.tsx
import { useState, useRef, useCallback } from "react";
import { Search, Globe, MapPin, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetCountriesNearby, getGetCountriesNearbyQueryKey } from "@workspace/api-client-react";

function parseInput(raw: string): { country: string; km: number } | null {
  const trimmed = raw.trim();
  // Match everything before the last number (to allow multi-word country names)
  const match = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const country = match[1].trim();
  const km = parseFloat(match[2]);
  if (!country || isNaN(km) || km < 0) return null;
  return { country, km };
}

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState<{ country: string; km: number } | null>(null);
  const [parseError, setParseError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching, error } = useGetCountriesNearby(
    { country: query?.country ?? "", km: query?.km ?? 0 },
    {
      query: {
        enabled: !!query,
        queryKey: getGetCountriesNearbyQueryKey({
          country: query?.country ?? "",
          km: query?.km ?? 0,
        }),
        retry: false,
      },
    },
  );

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
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setParseError(false);
  };

  const hasResult = !!data && !isFetching;

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center py-16 px-4 bg-background relative overflow-hidden">
      {/* Background decoration */}
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

      <div className="w-full max-w-2xl relative z-10">
        {/* Header */}
        <div className="text-center mb-10 space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary border border-primary/20 mb-1">
            <Globe className="w-7 h-7" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Border Search
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
            Type a country and distance to find all countries at that range.
          </p>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <div
            className={`flex items-center gap-3 bg-card border rounded-xl px-4 py-3 shadow-md transition-all
${parseError || error ? "border-destructive ring-2 ring-destructive/20" : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"}`}
          >
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="France 550"
              data-testid="input-search"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/50 text-lg font-medium outline-none min-w-0"
            />
            <button
              onClick={handleSubmit}
              disabled={isFetching || !inputValue.trim()}
              data-testid="button-search"
              className="shrink-0 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {isFetching ? "Searching…" : "Search"}
            </button>
          </div>
          <AnimatePresence>
            {parseError && (
              <motion.p
                key="parse-error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-sm text-destructive flex items-center gap-1.5 ml-1"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Format: <span className="font-mono font-semibold">Country&nbsp;KM</span> — e.g.
                <span className="font-mono font-semibold">France&nbsp;550</span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <p className="text-xs text-muted-foreground/60 ml-1 mb-10">
          Press Enter or click Search. Example: <span className="font-mono">Germany 800</span>, <span className="font-mono">Japan 1200</span>
        </p>

        {/* Results area */}
        <AnimatePresence mode="wait">
          {/* Idle state */}
          {!query && !isFetching && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <MapPin className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-muted-foreground/50 text-sm">Results will appear here</p>
            </motion.div>
          )}

          {/* Loading */}
          {isFetching && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-lg bg-muted/40 animate-pulse"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
              ))}
            </motion.div>
          )}

          {/* API error */}
          {error && !isFetching && (
            <motion.div
              key="api-error"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Country not found</p>
                <p className="text-sm text-destructive/70 mt-0.5">
                  {error?.message ?? "Could not find that country. Try a different spelling."}
                </p>
              </div>
            </motion.div>
          )}

          {/* Results */}
          {hasResult && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Summary header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Countries ~{data.targetKm.toLocaleString()} km from{" "}
                    <span className="text-primary">{data.sourceCountry}</span>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ±{data.tolerance} km tolerance · {data.matches.length} match
                    {data.matches.length !== 1 ? "es" : ""}
                  </p>
                </div>
              </div>

              {data.matches.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center py-14 text-center"
                >
                  <MapPin className="w-10 h-10 text-muted-foreground/20 mb-3" />
                  <p className="text-muted-foreground font-medium">No countries found</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">
                    Try a different distance or increase the tolerance.
                  </p>
                </motion.div>
              ) : (
                <motion.ul
                  className="space-y-2"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    visible: { transition: { staggerChildren: 0.04 } },
                    hidden: {},
                  }}
                >
                  {data.matches.map((match) => (
                    <motion.li
                      key={match.name}
                      data-testid={`result-country-${match.name}`}
                      variants={{
                        hidden: { opacity: 0, y: 8 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/30 hover:bg-primary/5 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                        <span className="font-medium text-foreground truncate">{match.name}</span>
                        {match.touching && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                            Bordering
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground text-sm font-mono shrink-0 ml-3">
                        {match.distanceKm.toLocaleString()} km
                      </span>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
