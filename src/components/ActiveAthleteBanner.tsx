import React from "react";
import { useLocation } from "react-router-dom";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

const HIDDEN_PREFIXES = ["/exercises", "/program-outline"];

export default function ActiveAthleteBanner() {
  const location = useLocation();
  const { activeAthlete, clearActiveAthlete, isCoach, loading } = useActiveAthlete();

  if (loading || !isCoach || !activeAthlete) return null;
  if (HIDDEN_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))) {
    return null;
  }

  const name =
    [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") ||
    "Unnamed athlete";

  return (
    <div className="border-b border-indigo-100 bg-indigo-50 text-indigo-900">
      <div className="container flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div className="space-y-1">
          <div className="font-semibold uppercase tracking-wide text-xs text-indigo-700">
            Active athlete
          </div>
          <div className="text-base font-semibold">{name}</div>
          {(activeAthlete.team || activeAthlete.unit) && (
            <div className="text-xs text-indigo-700">
              {[activeAthlete.team, activeAthlete.unit].filter(Boolean).join(" • ")}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100"
          onClick={clearActiveAthlete}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}

