// artifacts/border-distance/src/pages/Home.tsx
import { useState, useRef, useCallback } from "react";
import { Search, Globe, MapPin, AlertCircle, X, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueries } from "@tanstack/react-query"; // Use useQueries for multiple API calls
import { getGetCountriesNearbyQueryKey, Api } from "@workspace/api-client-react";

// Reuse the existing parseInput function
function parseInput(raw: string): { country: string; km: number } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const country = match[1].trim();
  const km = parseFloat(match[2]);
  if (!country || isNaN(km) || km < 0) return null;
  return { country, km };
}

// Define the type for our queries
type QueryType = { country: string; km: number };

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [queries, setQueries] = useState<QueryType[]>([]);
  const [parseError, setParseError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // State for managing tolerance bump attempts per query index
  const [needsRefetch100, setNeedsRefetch100] = useState<Set<number>>(new Set());
  // State for storing secondary results (from tolerance bump refetches)
  const [secondaryResults, setSecondaryResults] = useState<(Api.GetCountriesNearbyResponse | null)[]>([]);

  // Function to add a new query
  const addQuery = useCallback(() => {
    const parsed = parseInput(inputValue);
    if (!parsed) {
      setParseError(true);
      return;
    }
    setParseError(false);
    // Avoid duplicates
    if (!queries.some(q => q.country === parsed.country && q.km === parsed.km)) {
      setQueries(prev => [...prev, parsed]);
      // Also update secondary results array to accommodate the new query
      setSecondaryResults(prev => [...prev, null]);
    }
    setInputValue(""); // Clear input after adding
  }, [inputValue, queries]);

  // Function to remove a specific query
  const removeQuery = useCallback((indexToRemove: number) => {
    setQueries(prev => prev.filter((_, index) => index !== indexToRemove));
    // Update secondary results array accordingly
    setSecondaryResults(prev => prev.filter((_, idx) => idx !== indexToRemove));
    // Update needsRefetch100 set to remove references to indices that shifted
    setNeedsRefetch100(prev => {
      const newSet = new Set<number>();
      for (const idx of prev) {
        if (idx < indexToRemove) {
          newSet.add(idx);
        } else if (idx > indexToRemove) {
          newSet.add(idx - 1); // Shift index down
        }
        // indexToRemove itself is removed
      }
      return newSet;
    });
  }, []);

  // Function to clear all queries (New Round)
  const clearAllQueries = useCallback(() => {
    setQueries([]);
    setInputValue("");
    setSecondaryResults([]);
    setNeedsRefetch100(new Set()); // Reset tolerance bump tracking
  }, []);

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      addQuery();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setParseError(false); // Reset error when user types
  };

  // Trigger API calls for each active query using useQueries
  const queryResults = useQueries({
    queries: queries.map((query, index) => ({
      queryKey: getGetCountriesNearbyQueryKey({ country: query.country, km: query.km, tolerance: 50 }), // Initial tolerance
      queryFn: async () => {
        // Fetch using the primary endpoint with tolerance 50
        const response = await fetch(`/api/countries/nearby?country=${encodeURIComponent(query.country)}&km=${query.km}&tolerance=50`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return response.json();
      },
      enabled: !!query.country && query.km >= 0, // Enable only if query is valid
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      retry: 1, // Retry once on failure
      meta: { index }, // Attach index for identifying the result
    })),
  });

  // Determine loading states
  const isFetchingAnyPrimary = queryResults.some(result => result.isFetching);
  const isFetchingAnySecondary = needsRefetch100.size > 0; // Simplified check
  const isFetchingAny = isFetchingAnyPrimary || isFetchingAnySecondary;

  // Effect to trigger refetch with tolerance 100 if primary result is 0 matches
  React.useEffect(() => {
    queryResults.forEach((result, idx) => {
      if (
        result.isSuccess &&
        result.data.matches.length === 0 &&
        !needsRefetch100.has(idx)
      ) {
        // Mark this index as needing a refetch
        setNeedsRefetch100(prev => new Set(prev).add(idx));

        // Perform the refetch manually using fetch
        const fetchData = async () => {
          try {
            const response = await fetch(`/api/countries/nearby?country=${encodeURIComponent(queries[idx].country)}&km=${queries[idx].km}&tolerance=100`);
            if (!response.ok) {
              throw new Error(`Failed to refetch with tolerance 100 for query ${idx}`);
            }
            const data = await response.json();
            // Update the secondary results state for this specific index
            setSecondaryResults(prev => {
              const newState = [...prev];
              newState[idx] = data;
              return newState;
            });
          } catch (error) {
            console.error("Error refetching with tolerance 100:", error);
            // Optionally, set an error state for this specific query
            setSecondaryResults(prev => {
              const newState = [...prev];
              newState[idx] = null; // Or some error marker
              return newState;
            });
          }
        };

        fetchData();
      }
    });
  }, [queryResults, queries, needsRefetch100]);

  // Process results to find common countries and handle tolerances
  const { commonCountries, processedResults } = React.useMemo(() => {
    if (queries.length === 0) {
      return { commonCountries: [], processedResults: [] };
    }

    const resultsData = queryResults.map((result, idx) => ({
      query: queries[idx],
      data: result.data,
      isError: result.isError,
      error: result.error,
      isFetching: result.isFetching,
      // Use secondary result if available and primary had 0 matches, otherwise use primary
      effectiveData: (
        result.data && result.data.matches.length > 0
          ? result.data
          : (secondaryResults[idx] ? secondaryResults[idx] : result.data)
      ),
    }));

    // Store processed results including potential tolerance increase info
    const processed = resultsData.map((res, idx) => {
      const effectiveMatches = res.effectiveData?.matches || [];
      const originalMatches = res.data?.matches || [];
      const hasSecondaryResult = !!secondaryResults[idx];

      // Determine adjusted tolerance based on which data was used
      let adjustedTolerance = 50;
      if (hasSecondaryResult) {
        adjustedTolerance = 100;
      } else if (res.data) {
        // If no secondary, use the tolerance from the adjustedTolerance = res.data.tolerance || 50;
      }

      return {
        ...res,
        adjustedMatches: effectiveMatches,
        adjustedTolerance,
        originalMatches,
        hasSecondaryResult, // Flag if tolerance bump was used
      };
    });

    // Calculate the intersection of effective matches from all queries
    // Only consider queries that successfully fetched data and have non-zero effective matches
    const validMatchLists = processed
        .filter(res => res.effectiveData && !res.isError && res.adjustedMatches.length > 0)
        .map(res => new Set(res.adjustedMatches.map(m => m.name)));

    let commonCountriesSet: Set<string> = new Set();
    if (validMatchLists.length > 0) {
        // Start with the first list
        commonCountriesSet = new Set(validMatchLists[0]);
        // Intersect with all subsequent lists
        for (let i = 1; i < validMatchLists.length; i++) {
            commonCountriesSet = new Set([...commonCountriesSet].filter(country => validMatchLists[i].has(country)));
        }
    } else {
         // If any query definitively has 0 effective matches (after tolerance attempts), or any query fails/error,
         // the intersection is empty.
         commonCountriesSet = new Set();
    }

    const commonCountries = Array.from(commonCountriesSet).sort(); // Sort the final list

    return { commonCountries, processedResults: processed };
  }, [queries, queryResults, secondaryResults]); // Recalculate when queries, their results, or secondary results change


  // Memoize the final combined results list (common only)
  const finalResults = React.useMemo(() => {
     return commonCountries.map(name => ({ name, type: 'common' }));
  }, [commonCountries]);

  const hasActiveQueries = queries.length > 0;
  const hasCommonResults = commonCountries.length > 0;
  const hasAnyResults = finalResults.length > 0;

  // Render function for individual query rows
  const renderQueryRow = (query: QueryType, index: number, resultInfo: any) => {
    const isPending = resultInfo.isFetching || (needsRefetch100.has(index) && !secondaryResults[index] && queryResults[index].data?.matches?.length === 0);
    const hasError = resultInfo.isError;
    const adjustedMatches = resultInfo.adjustedMatches || [];
    const adjustedTolerance = resultInfo.adjustedTolerance || 50;
    const originalMatches = resultInfo.originalMatches || [];
    const hasSecondaryResult = resultInfo.hasSecondaryResult;

    return (
      <motion.div
        key={`${query.country}-${query.km}-${index}`} // Unique key including index
        layout // Animate layout changes when items are added/removed
        className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 mb-2"
      >
        <span className="font-mono text-sm font-medium text-foreground">
          {query.country} {query.km}
        </span>
        <span className="text-xs text-muted-foreground">
          (±{adjustedTolerance}km)
          {hasSecondaryResult && <span className="text-orange-500"> *</span>} {/* Indicate tolerance bump */}
        </span>
        {isPending && <span className="text-xs text-muted-foreground">...</span>}
        {!isPending && hasError && (
          <span className="text-xs text-destructive">Error</span>
        )}
        {!isPending && !hasError && (
          <span className="text-xs text-muted-foreground">
            {adjustedMatches.length} match{adjustedMatches.length !== 1 ? 'es' : ''}
            {hasSecondaryResult && originalMatches.length === 0 && <span> (from ±100km)</span>} {/* Clarify source if bumped */}
          </span>
        )}
        {/* Button to remove this specific query */}
        <button
          onClick={() => removeQuery(index)}
          className="ml-auto p-1 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Remove query: ${query.country} ${query.km}`}
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    );
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center py-8 px-4 bg-background relative overflow-hidden">
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

      <div className="w-full max-w-2xl relative z-10 flex flex-col flex-grow">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary border border-primary/20 mb-1">
            <Globe className="w-6 h-6" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Multi-Border Search
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto">
            Add multiple country-distance pairs. Find countries matching all criteria.
          </p>
        </div>

        {/* Input Section */}
        <div className="bg-muted/30 rounded-xl p-4 mb-6">
          <div className="relative mb-3">
            <div
              className={`flex items-center gap-3 bg-card border rounded-lg px-3 py-2 shadow-sm transition-all ${
                parseError ? "border-destructive ring-2 ring-destructive/20" : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
              }`}
            >
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleChange}
                onKeyDown={handleAddKeyDown}
                placeholder="e.g., France 550"
                data-testid="input-search"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/50 text-sm outline-none min-w-0"
              />
              <button
                onClick={addQuery}
                disabled={isFetchingAny || !inputValue.trim()} // Disable while any query is fetching or input is empty
                data-testid="button-add-query"
                className="shrink-0 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Add
              </button>
            </div>
            <AnimatePresence>
              {parseError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-1 text-xs text-destructive flex items-center gap-1 ml-1"
                >
                  <AlertCircle className="w-3 h-3" />
                  Format: Country KM
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <p className="text-xs text-muted-foreground/60 ml-1 mb-2">
            Press Enter or click "Add". Example: <span className="font-mono">Germany 800</span>
          </p>

          {/* New Round Button */}
          {hasActiveQueries && (
            <div className="flex justify-end mt-2">
              <button
                onClick={clearAllQueries}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New Round
              </button>
            </div>
          )}
        </div>

        {/* Active Queries Display */}
        {hasActiveQueries && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-foreground mb-2">Active Queries:</h3>
            <AnimatePresence initial={false}>
              {queries.map((query, index) => renderQueryRow(query, index, queryResults[index]))}
            </AnimatePresence>
          </div>
        )}

        {/* Results Area */}
        <div className="flex-grow min-h-0">
          <AnimatePresence mode="wait">
            {/* Loading State */}
            {isFetchingAny && (
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
                    className="h-10 rounded-md bg-muted/40 animate-pulse"
                    style={{ animationDelay: `${i * 50}ms` }}
                  />
                ))}
              </motion.div>
            )}

            {/* Error State - Simplified for this example */}
            {/* You might want to show errors per query or overall */}

            {/* No Active Queries */}
            {!hasActiveQueries && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full py-16 text-center"
              >
                <MapPin className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground/50 text-sm">Add some country-distance pairs to begin.</p>
              </motion.div>
            )}

            {/* Results State (Common only) */}
            {hasActiveQueries && !isFetchingAny && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col h-full"
              >
                {/* Summary Header */}
                <div className="flex items-center justify-between mb-4">
                   {hasCommonResults ? (
                     <>
                       <h2 className="text-lg font-semibold text-foreground">
                         Common Matches ({commonCountries.length})
                       </h2>
                       <p className="text-xs text-muted-foreground">
                         Found in all queries
                       </p>
                     </>
                   ) : (
                     <>
                       <h2 className="text-lg font-semibold text-foreground">
                         No Common Matches
                       </h2>
                       <p className="text-xs text-muted-foreground">
                         No country fits all criteria
                       </p>
                     </>
                   )}
                </div>

                {/* Results List */}
                {hasAnyResults ? (
                  <motion.ul
                    className="space-y-2 flex-grow overflow-y-auto"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      visible: { transition: { staggerChildren: 0.03 } },
                      hidden: {},
                    }}
                  >
                    {finalResults.map((item, index) => (
                      <motion.li
                        key={`${item.name}-${item.type}-${index}`}
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0 },
                        }}
                        className="flex items-center justify-between bg-card border border-border rounded-md px-3 py-2.5 hover:border-primary/30 hover:bg-primary/5 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${item.type === 'common' ? 'bg-green-500' : 'bg-blue-500'} shrink-0`} />
                          <span className="font-medium text-foreground truncate">{item.name}</span>
                          {item.type === 'common' && (
                            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-:text-green-400 font-medium">
                              Common
                            </span>
                          )}
                        </div>
                      </motion.li>
                    ))}
                  </motion.ul>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center flex-grow py-10 text-center"
                  >
                    <MapPin className="w-8 h-8 text-muted-foreground/20 mb-2" />
                    <p className="text-muted-foreground font-medium">No common matches found</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Try adjusting distances or broadening tolerance.
                    </p>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
