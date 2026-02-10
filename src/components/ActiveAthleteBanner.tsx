import React from "react";
import { useLocation } from "react-router-dom";
import { formatTeamLabel } from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

const HIDDEN_PREFIXES = ["/exercises", "/program-outline"];

export default function ActiveAthleteBanner() {
  const location = useLocation();
  const { activeAthlete, clearActiveAthlete, isCoach, isAdmin, loading } = useActiveAthlete();

  if (loading || !isCoach || !activeAthlete) return null;
  if (HIDDEN_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))) {
    return null;
  }

  const name =
    [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") ||
    "Unnamed Athlete";
  const teamLabel = activeAthlete.team
    ? formatTeamLabel(activeAthlete.team, undefined)
    : null;

  return (
    <div className="border-b border-indigo-100 bg-indigo-50 text-indigo-900 text-xs sm:text-sm">
      <div className="container flex flex-col gap-3 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4 sm:py-3">
        <div className="space-y-1">
          <div className="font-semibold uppercase tracking-[0.2em] text-[10px] text-indigo-600 sm:text-xs sm:tracking-wide">
            Active Athlete
          </div>
          <div className="text-sm font-semibold sm:text-base">{name}</div>
          {isAdmin && activeAthlete.uid && (
            <div className="text-[11px] text-indigo-700 sm:text-xs">
              UID: <code className="rounded bg-white/70 px-1 py-[1px]">{activeAthlete.uid}</code>
            </div>
          )}
          {(teamLabel || activeAthlete.unit) && (
            <div className="text-[11px] text-indigo-700 sm:text-xs">
              {[teamLabel, activeAthlete.unit].filter(Boolean).join(" \u2022 ")}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 sm:text-sm"
          onClick={clearActiveAthlete}
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
