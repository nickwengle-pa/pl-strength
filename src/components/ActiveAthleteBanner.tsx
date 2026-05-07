import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatTeamLabel, type Team } from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { generateAthleteReport } from "../lib/athleteReport";

const HIDDEN_PREFIXES = ["/exercises", "/program-outline"];

export default function ActiveAthleteBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeAthlete, clearActiveAthlete, isCoach, isAdmin, loading } = useActiveAthlete();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleOpenReview = () => {
    if (!activeAthlete.uid) return;
    setError(null);
    navigate(`/roster?openUid=${encodeURIComponent(activeAthlete.uid)}`);
  };

  const handleGenerateReport = async () => {
    if (!activeAthlete.uid || generating) return;
    setError(null);
    setGenerating(true);
    try {
      await generateAthleteReport({
        uid: activeAthlete.uid,
        team: (activeAthlete.team ?? null) as Team | null,
      });
    } catch (err: any) {
      setError(err?.message ?? "Could not generate report.");
    } finally {
      setGenerating(false);
    }
  };

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
              {[teamLabel, activeAthlete.unit].filter(Boolean).join(" • ")}
            </div>
          )}
          {error && (
            <div className="text-[11px] text-rose-700 sm:text-xs">{error}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-sm border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 sm:text-sm"
            onClick={handleOpenReview}
          >
            Review
          </button>
          <button
            type="button"
            className="btn btn-sm border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 sm:text-sm disabled:opacity-50"
            onClick={handleGenerateReport}
            disabled={generating}
          >
            {generating ? "Generating..." : "Report"}
          </button>
          <button
            type="button"
            className="btn btn-sm border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 sm:text-sm"
            onClick={clearActiveAthlete}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
