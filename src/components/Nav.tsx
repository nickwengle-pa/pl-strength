import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { hasFirebase, isCoach, isAdmin } from "../lib/db";
import { useAuth } from "../lib/auth";
import { useDevice } from "../lib/device";

type Status = "checking" | "connected" | "offline";

export default function Nav() {
  const { user, signOut } = useAuth();
  const device = useDevice();
  const location = useLocation();
  const [status, setStatus] = useState<Status>("checking");
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [friendlyName, setFriendlyName] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);

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
      setAdmin(false);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const [coachFlag, adminFlag] = await Promise.all([
          isCoach(),
          isAdmin(),
        ]);
        if (active) {
          setCoach(coachFlag);
          setAdmin(adminFlag);
        }
      } catch {
        if (active) {
          setCoach(false);
          setAdmin(false);
        }
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

  const athleteLinks = [
    { to: "/calculator", label: "Calculator" },
    { to: "/session", label: "Session" },
    { to: "/sheets", label: "Sheets" },
    { to: "/exercises", label: "Exercises" },
    { to: "/summary", label: "Summary" },
    { to: "/profile", label: "Profile" },
  ];

  const coachLinks = [
    { to: "/roster", label: "Roster" },
    { to: "/calculator", label: "Calculator" },
    { to: "/session", label: "Session" },
    { to: "/sheets", label: "Sheets" },
    { to: "/program-outline", label: "Program Outline" },
    { to: "/exercises", label: "Exercises" },
    { to: "/summary", label: "Summary" },
    { to: "/profile", label: "Profile" },
  ];

  const baseLinks = coach ? coachLinks : athleteLinks;
  const links = admin ? [...baseLinks, { to: "/admin", label: "Admin" }] : baseLinks;

  const isMobile = device.isMobile || (device.isTouch && !device.isDesktop);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
    }
  }, [isMobile]);

  const navLinkClass = (active: boolean) => {
    if (isMobile) {
      return [
        "flex items-center justify-between rounded-xl border px-4 py-2 text-base font-medium transition-colors",
        active
          ? "border-brand-200 bg-brand-50 text-brand-700 shadow-sm"
          : "border-gray-200 bg-white text-gray-700 hover:bg-brand-50 hover:text-brand-700",
      ].join(" ");
    }
    return active ? "nav-link nav-link-active" : "nav-link";
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="relative border-b border-gray-200/70 bg-white/90 backdrop-blur">
      <div className="container flex items-center gap-3 py-3 md:h-16 md:py-0">
        <Link to="/" className="flex items-center gap-2 text-gray-900 hover:opacity-90">
          <img src="/assets/dragon.png" alt="Dragon" className="h-8 w-8 object-contain" />
          <span className="text-xl font-bold tracking-tight">PL Strength</span>
        </Link>
        {!isMobile && (
          <span className={`${statusClass} leading-none`}>{statusLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {isMobile ? (
            <>
              {friendlyName && (
                <span className="badge badge-muted text-xs">{friendlyName}</span>
              )}
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-soft transition hover:border-brand-200 hover:text-brand-700"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
              >
                <span className="sr-only">Toggle navigation</span>
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm1 4a1 1 0 100 2h12a1 1 0 100-2H4z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </>
          ) : (
            <nav className="flex items-center gap-2 md:gap-3">
              {links.map(({ to, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => navLinkClass(isActive)}>
                  {label}
                </NavLink>
              ))}
              {coach && (
                <span className="badge badge-muted text-xs md:text-sm">Coach</span>
              )}
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
            </nav>
          )}
        </div>
      </div>
      {isMobile && (
        <div
          id="mobile-navigation"
          className={[
            "pointer-events-none transition-[max-height,opacity] duration-200 ease-out",
            menuOpen ? "pointer-events-auto max-h-[480px] opacity-100" : "max-h-0 opacity-0",
          ].join(" ")}
        >
          <div className="container pb-3">
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-soft">
              <span className={`${statusClass} leading-none`}>{statusLabel}</span>
              <nav className="space-y-2">
                {links.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => navLinkClass(isActive)}
                    onClick={closeMenu}
                  >
                    {label}
                  </NavLink>
                ))}
                {coach && (
                  <span className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-2 text-base font-medium text-gray-700">
                    Coach mode
                  </span>
                )}
              </nav>
              <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                {friendlyName && (
                  <span className="badge badge-muted self-start text-xs">
                    {friendlyName}
                  </span>
                )}
                <button
                  className="flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-base font-medium text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  type="button"
                  onClick={() => {
                    closeMenu();
                    signOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}




