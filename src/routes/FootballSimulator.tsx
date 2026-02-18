import React, { useEffect, useState } from "react";
import { isCoach } from "../lib/db";

export default function FootballSimulator() {
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
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading...
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <iframe
      src={`${import.meta.env.BASE_URL}football-simulator.html`}
      title="Football Power Points Simulator"
      className="w-full border-0"
      style={{ height: "calc(100vh - 5rem)" }}
    />
  );
}
