"use client";

import * as React from "react";

import { NO_SEASON, type Season } from "@/lib/seasonal";

/**
 * The resolved season for this request (see src/lib/seasonal.ts), decided
 * once on the server in the root layout so every decoration agrees and the
 * first paint is already right. Outside a provider: no season.
 */
const SeasonContext = React.createContext<Season>(NO_SEASON);

export function SeasonProvider({ season, children }: { season: Season; children: React.ReactNode }) {
  return <SeasonContext.Provider value={season}>{children}</SeasonContext.Provider>;
}

/** Admin console: decorated only when the owner allows it (season.admin). */
export function AdminSeasonScope({ children }: { children: React.ReactNode }) {
  const season = React.useContext(SeasonContext);
  return (
    <SeasonContext.Provider value={season.admin ? season : NO_SEASON}>{children}</SeasonContext.Provider>
  );
}

export function useSeason(): Season {
  return React.useContext(SeasonContext);
}
