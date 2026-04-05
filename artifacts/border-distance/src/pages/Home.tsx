import React, { useState, useEffect } from "react";
import { Map, ArrowRightLeft, Route as RouteIcon, Earth, Globe, MapPin, Navigation } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetCountryDistance, getGetCountryDistanceQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CountryCombobox } from "@/components/CountryCombobox";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [countryA, setCountryA] = useState("");
  const [countryB, setCountryB] = useState("");
  const [isCalculated, setIsCalculated] = useState(false);
  const queryClient = useQueryClient();

  const { data: distanceData, isFetching, error } = useGetCountryDistance(
    { countryA, countryB },
    {
      query: {
        enabled: isCalculated && !!countryA && !!countryB,
        queryKey: getGetCountryDistanceQueryKey({ countryA, countryB }),
        retry: false,
      },
    }
  );

  const handleCalculate = (e: React.FormEvent) => {
    e.preventDefault();
    if (countryA && countryB) {
      setIsCalculated(true);
      // Invalidate to force refetch if already calculated
      queryClient.invalidateQueries({
        queryKey: getGetCountryDistanceQueryKey({ countryA, countryB }),
      });
    }
  };

  // Reset calculated state when inputs change
  useEffect(() => {
    setIsCalculated(false);
  }, [countryA, countryB]);

  const swapCountries = () => {
    const temp = countryA;
    setCountryA(countryB);
    setCountryB(temp);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center py-12 px-4 sm:px-6 md:py-24 relative overflow-hidden bg-background">
      {/* Decorative background map lines */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] flex items-center justify-center">
        <svg viewBox="0 0 800 800" className="w-[120%] h-[120%] max-w-none text-primary" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4">
          <circle cx="400" cy="400" r="100" />
          <circle cx="400" cy="400" r="200" />
          <circle cx="400" cy="400" r="300" />
          <line x1="400" y1="0" x2="400" y2="800" />
          <line x1="0" y1="400" x2="800" y2="400" />
        </svg>
      </div>

      <div className="w-full max-w-2xl relative z-10 space-y-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-2 shadow-sm border border-primary/20">
            <Globe className="w-8 h-8" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Border Distance
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Discover the exact distance between the borders of any two countries. Precision geographic measurement.
          </p>
        </div>

        <Card className="shadow-lg border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleCalculate} className="space-y-6">
              <div className="flex flex-col sm:flex-row items-stretch gap-4 sm:gap-2">
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium text-foreground ml-1">Origin</label>
                  <CountryCombobox
                    value={countryA}
                    onChange={setCountryA}
                    placeholder="E.g. Canada"
                  />
                </div>
                
                <div className="flex items-end justify-center pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={swapCountries}
                    className="h-10 w-10 rounded-full hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                    title="Swap countries"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium text-foreground ml-1">Destination</label>
                  <CountryCombobox
                    value={countryB}
                    onChange={setCountryB}
                    placeholder="E.g. Japan"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button 
                  type="submit" 
                  className="w-full h-12 text-base font-medium shadow-md transition-all hover:shadow-lg active:scale-[0.99]"
                  disabled={!countryA || !countryB || isFetching}
                >
                  {isFetching ? "Calculating..." : "Calculate Distance"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="min-h-[250px] w-full">
          <AnimatePresence mode="wait">
            {!isCalculated && !isFetching && !distanceData && !error && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="h-full flex flex-col items-center justify-center text-center p-8 rounded-xl border border-dashed border-border bg-card/30"
              >
                <Map className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">Select two countries</h3>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
                  Choose an origin and destination to calculate the shortest distance between their borders.
                </p>
              </motion.div>
            )}

            {isFetching && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <Card className="overflow-hidden border-border/50">
                  <CardContent className="p-8 flex flex-col items-center justify-center space-y-6">
                    <Skeleton className="h-8 w-48 rounded-full" />
                    <div className="flex items-center gap-4 w-full max-w-md">
                      <Skeleton className="h-16 w-full rounded-xl" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {error && !isFetching && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-6 text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive mx-auto flex items-center justify-center mb-4">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold text-destructive">Calculation Failed</h3>
                    <p className="text-sm text-destructive/80">
                      {error?.error || "We couldn't calculate the distance between these countries. Please check the names and try again."}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {distanceData && !isFetching && !error && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, staggerChildren: 0.1 }}
                className="space-y-4"
              >
                <Card className="overflow-hidden border-primary/20 bg-card shadow-xl">
                  <CardContent className="p-0">
                    <div className="bg-primary/5 border-b border-primary/10 px-6 py-4 flex justify-between items-center">
                      <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Result</span>
                      {distanceData.touching && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                          Bordering
                        </span>
                      )}
                    </div>
                    <div className="p-6 sm:p-8 flex flex-col items-center">
                      <div className="flex items-center justify-center gap-4 w-full mb-8">
                        <div className="flex-1 text-right">
                          <h3 className="text-xl sm:text-2xl font-semibold text-foreground truncate" title={distanceData.countryA}>
                            {distanceData.countryA}
                          </h3>
                        </div>
                        <div className="w-12 h-12 shrink-0 rounded-full bg-accent text-accent-foreground flex items-center justify-center relative">
                          <RouteIcon className="w-5 h-5" />
                          <div className="absolute -left-1/2 right-full h-px bg-border top-1/2 -z-10" />
                          <div className="absolute left-full -right-1/2 h-px bg-border top-1/2 -z-10" />
                        </div>
                        <div className="flex-1 text-left">
                          <h3 className="text-xl sm:text-2xl font-semibold text-foreground truncate" title={distanceData.countryB}>
                            {distanceData.countryB}
                          </h3>
                        </div>
                      </div>

                      <motion.div 
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2, type: "spring" }}
                        className="text-center"
                      >
                        <div className="text-5xl sm:text-7xl font-bold tracking-tighter text-primary mb-2 flex items-baseline justify-center gap-2">
                          {distanceData.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          <span className="text-2xl sm:text-3xl font-medium text-muted-foreground tracking-normal">km</span>
                        </div>
                        <p className="text-muted-foreground mt-2 font-medium">
                          {distanceData.touching 
                            ? "These countries share a land border." 
                            : "Shortest distance between borders."}
                        </p>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
