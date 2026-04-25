import React, { useEffect, useState } from "react";
import { isCoach } from "../lib/db";

export default function FootballSimulatorV2() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    isCoach().then((ok) => {
      if (active) setAllowed(ok);
    });
    return () => { active = false; };
  }, []);

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950 px-4">
        <div className="max-w-sm text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="h-px w-5 bg-v2-danger-600" />
            <span className="font-v2-body text-v2-xs text-v2-danger-300 uppercase tracking-[0.24em] font-semibold">
              Restricted
            </span>
          </div>
          <p className="font-v2-heading text-v2-xl text-v2-ink-100 uppercase tracking-tight">
            You do not have access to this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-v2-surface-950">
      <iframe
        src={`${import.meta.env.BASE_URL}football-simulator.html`}
        title="Football Power Points Simulator"
        className="w-full border-0"
        style={{ height: "calc(100vh - 5rem)" }}
      />
    </div>
  );
}
