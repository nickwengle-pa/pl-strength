import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { hasFirebase, isCoach } from "../lib/db";
import { useAuth } from "../lib/auth";

type Status = "checking" | "connected" | "offline";

export default function Nav() {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<Status>("checking");
  const [coach, setCoach] = useState(false);
  const [friendlyName, setFriendlyName] = useState<string>("");

  useEffect(() => {
    let active = true;
    let ready = false;
    try {
      ready = hasFirebase();
      setStatus(ready ? "connected" : "offline");
    } catch {
      ready = false;
      setStatus("offline");
    }

    if (!ready || !user) {
      setCoach(false);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const flag = await isCoach();
        if (active) setCoach(flag);
      } catch {
        if (active) setCoach(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const handler: EventListener = (event) => {
      const custom = event as CustomEvent<string | null>;
      const detail = custom.detail;
      if (typeof detail === "string") {
        setFriendlyName(detail);
      } else {
        const stored = window.localStorage.getItem("pl-strength-display-name");
        setFriendlyName(stored ?? "");
      }
    };

    window.addEventListener("pl-display-name-change", handler);
    return () => {
      window.removeEventListener("pl-display-name-change", handler);
    };
  }, []);



  useEffect(() => {
    if (!user) {
      setFriendlyName("");
      return;
    }
    if (user.displayName) {
      setFriendlyName(user.displayName);
      return;
    }
    const stored = window.localStorage.getItem("pl-strength-display-name");
    if (stored) {
      setFriendlyName(stored);
      return;
    }
    if (user.email?.endsWith("@pl.strength")) {
      const base = user.email.replace("@pl.strength", "");
      const pretty = base
        .replace(/[^a-z]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      setFriendlyName(pretty ? pretty.replace(/\b\w/g, (c) => c.toUpperCase()) : base);
    } else if (user.email) {
      setFriendlyName(user.email);
    }
  }, [user]);

  const statusLabel =
    status === "connected"
      ? "Connected to Firebase"
      : status === "checking"
      ? "Checking Firebase..."
      : "Offline mode";

  const statusClass =
    status === "connected"
      ? "badge badge-success"
      : status === "checking"
      ? "badge badge-warning"
      : "badge badge-muted";

  const links = [
    { to: "/session", label: "Session" },
    { to: "/calculator", label: "Calculator" },
    { to: "/sheets", label: "Sheets" },
    { to: "/summary", label: "Summary" },
    { to: "/profile", label: "Profile" },
    { to: "/roster", label: "Roster" },
    { to: "/admin", label: "Admin" },
  ];

  return (
    <header className="border-b border-gray-200/70 bg-white/90 backdrop-blur">
      <div className="container flex flex-wrap items-center gap-3 py-3 md:h-16 md:py-0">
        <Link to="/" className="flex items-center gap-2 text-gray-900 hover:opacity-90">
          <img src="/assets/dragon.png" alt="Dragon" className="h-8 w-8 object-contain" />
          <span className="text-xl font-bold tracking-tight">PL Strength</span>
        </Link>
        <span className={`${statusClass} leading-none`}>{statusLabel}</span>
        <nav className="ml-auto flex flex-wrap items-center gap-2 md:gap-3">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              {label}
            </NavLink>
          ))}
          {coach && (
            <a
              target="_blank"
              rel="noreferrer"
              className="nav-link"
            >
            </a>
          )}
          <div className="flex items-center gap-2">
            {friendlyName && (
              <span className="badge badge-muted text-xs md:text-sm">
                {friendlyName}
              </span>
            )}
            <button
              className="nav-link"
              type="button"
              onClick={() => signOut()}
            >
              Sign out
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}




