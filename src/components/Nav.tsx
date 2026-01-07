import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  formatTeamLabel,
  getStoredTeamSelection,
  getStoredTeamScopes,
  setStoredTeamScopes,
  hasFirebase,
  isCoach,
  isAdmin,
  loadProfileRemote,
  subscribeToRoleChanges,
  setStoredTeamSelection,
  loadCustomQuotes,
  saveCustomQuote,
  deleteCustomQuote,
  type Team,
  type CustomQuote,
} from "../lib/db";
import { useAuth } from "../lib/auth";
import { useDevice } from "../lib/device";

type Status = "checking" | "connected" | "offline";
type Theme = "light" | "dark";
type SettingsTab = "general" | "quotes";

const THEME_STORAGE_KEY = "pl-strength-theme";

/** Built-in motivational quotes (same as Welcome page) */
const DEFAULT_QUOTES: Array<{ text: string; author: string }> = [
  { text: "The only bad workout is the one that didn't happen.", author: "Unknown" },
  { text: "Strength does not come from the physical capacity. It comes from an indomitable will.", author: "Mahatma Gandhi" },
  { text: "The iron never lies to you.", author: "Henry Rollins" },
  { text: "What hurts today makes you stronger tomorrow.", author: "Jay Cutler" },
  { text: "The last three or four reps is what makes the muscle grow.", author: "Arnold Schwarzenegger" },
  { text: "Success isn't always about greatness. It's about consistency.", author: "Dwayne Johnson" },
  { text: "The pain you feel today will be the strength you feel tomorrow.", author: "Unknown" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "The body achieves what the mind believes.", author: "Napoleon Hill" },
  { text: "No pain, no gain. Shut up and train.", author: "Unknown" },
  { text: "Be stronger than your strongest excuse.", author: "Unknown" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Champions aren't made in the gym. Champions are made from something deep inside them.", author: "Muhammad Ali" },
];

export default function Nav() {
  const { user, signOut } = useAuth();
  const device = useDevice();
  const location = useLocation();
  const [status, setStatus] = useState<Status>("checking");
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [friendlyName, setFriendlyName] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  });
  const [teamSelection, setTeamSelection] = useState<Team | "">("");
  const [teamScopes, setTeamScopes] = useState<Team[]>([]);
  
  // Quote management state (coaches only)
  const [customQuotes, setCustomQuotes] = useState<CustomQuote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [newQuoteText, setNewQuoteText] = useState("");
  const [newQuoteAuthor, setNewQuoteAuthor] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);

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
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

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

    // Attempt to recover name from profile if missing from local storage
    loadProfileRemote(user.uid).then((p) => {
      if (p && p.firstName && p.lastName) {
        const name = `${p.firstName} ${p.lastName}`.trim();
        window.localStorage.setItem("pl-strength-display-name", name);
        setFriendlyName(name);
      }
    });

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

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      const nextAdmin = roles.includes("admin");
      setAdmin(nextAdmin);
      setCoach(nextAdmin || roles.includes("coach"));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const readScopes = () => {
      setTeamSelection(getStoredTeamSelection());
      setTeamScopes(getStoredTeamScopes());
    };
    readScopes();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pl-strength-team") {
        setTeamSelection(getStoredTeamSelection());
      }
      if (event.key === "pl-strength-team-scopes") {
        setTeamScopes(getStoredTeamScopes());
      }
    };
    const handleTeamChange = () => setTeamSelection(getStoredTeamSelection());
    const handleScopeChange = (event: Event) => {
      const detail = (event as CustomEvent<Team[]>).detail;
      if (Array.isArray(detail)) {
        setTeamScopes(detail);
      } else {
        setTeamScopes(getStoredTeamScopes());
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pl-team-change", handleTeamChange as EventListener);
    window.addEventListener(
      "pl-team-scopes-change",
      handleScopeChange as EventListener
    );
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pl-team-change", handleTeamChange as EventListener);
      window.removeEventListener(
        "pl-team-scopes-change",
        handleScopeChange as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (!user || coach) return;
    if (teamScopes.length > 0) return;
    loadProfileRemote(user.uid).then((profile) => {
      if (!profile) return;
      if (profile.teamScopes && profile.teamScopes.length > 0) {
        setStoredTeamScopes(profile.teamScopes);
      } else if (profile.team) {
        setStoredTeamScopes([profile.team]);
      }
      const currentSelection = getStoredTeamSelection();
      if (!currentSelection && profile.team) {
        setStoredTeamSelection(profile.team);
      }
    });
  }, [user, coach, teamScopes.length]);

  const statusLabel =
    status === "connected"
      ? "Connected To Firebase"
      : status === "checking"
      ? "Checking Firebase..."
      : "Offline Mode";

  const statusClass =
    status === "connected"
      ? "badge badge-success"
      : status === "checking"
      ? "badge badge-warning"
      : "badge badge-muted";

  const renderStatusIndicator = () => {
    if (status === "connected") {
      return (
        <span
          className="inline-flex h-3 w-3 items-center justify-center"
          aria-label="Connected To Firebase"
          title="Connected To Firebase"
        >
          <span className="h-3 w-3 rounded-full bg-emerald-500" aria-hidden="true" />
        </span>
      );
    }
    return <span className={`${statusClass} leading-none`}>{statusLabel}</span>;
  };

  const athleteLinks = [
    { to: "/program-outline", label: "Daily Lifts" },
    { to: "/calculator", label: "Calculator" },
    { to: "/session", label: "Session" },
    { to: "/exercises", label: "Exercises" },
  ];

  const coachLinks = [
    { to: "/attendance", label: "Attendance" },
    { to: "/roster", label: "Roster" },
    { to: "/program-outline", label: "Daily Lifts" },
    { to: "/calculator", label: "Calculator" },
    { to: "/session", label: "Session" },
    { to: "/sheets", label: "Sheets" },
    { to: "/exercises", label: "Exercises" },
  ];

  const baseLinks = coach ? coachLinks : athleteLinks;
  const links = baseLinks;

  const isMobile = device.isMobile || (device.isTouch && !device.isDesktop);

  useEffect(() => {
    setMenuOpen(false);
    setSettingsOpen(false);
    setSettingsTab("general");
  }, [location.pathname]);

  // Load quotes when quotes tab is opened
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "quotes" || !coach) return;
    let active = true;
    setQuotesLoading(true);
    loadCustomQuotes()
      .then((quotes) => {
        if (active) setCustomQuotes(quotes);
      })
      .catch(() => {
        if (active) setCustomQuotes([]);
      })
      .finally(() => {
        if (active) setQuotesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settingsOpen, settingsTab, coach]);

  const handleSaveQuote = async () => {
    if (!newQuoteText.trim() || savingQuote) return;
    setSavingQuote(true);
    try {
      const id = await saveCustomQuote(
        { text: newQuoteText.trim(), author: newQuoteAuthor.trim() || "Coach" },
        user?.uid
      );
      if (id) {
        setCustomQuotes((prev) => [
          { id, text: newQuoteText.trim(), author: newQuoteAuthor.trim() || "Coach" },
          ...prev,
        ]);
        setNewQuoteText("");
        setNewQuoteAuthor("");
      }
    } catch (err) {
      console.warn("Failed to save quote", err);
    } finally {
      setSavingQuote(false);
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!window.confirm("Delete this quote?")) return;
    const success = await deleteCustomQuote(quoteId);
    if (success) {
      setCustomQuotes((prev) => prev.filter((q) => q.id !== quoteId));
    }
  };

  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [settingsOpen]);

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

  const drawerLinkClass = (active: boolean) =>
    [
      "flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "border-brand-200 bg-brand-50 text-brand-700"
        : "border-gray-200 bg-white text-gray-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700",
    ].join(" ");

  const handleTeamScopeChange = (next: Team) => {
    if (!next || next === teamSelection) return;
    setTeamSelection(next);
    setStoredTeamSelection(next);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const renderThemeToggle = (variant: "desktop" | "mobile") => {
    const isDark = theme === "dark";
    const labelClass = variant === "desktop" ? "text-xs" : "text-sm";
    const wrapperClass =
      variant === "desktop"
        ? "inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
        : "flex items-center justify-between rounded-xl border border-gray-200 px-4 py-2 text-base font-medium text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700";
    const trackClass = [
      "relative inline-flex h-5 w-9 items-center rounded-full border transition",
      isDark ? "bg-brand-600 border-brand-500" : "bg-gray-200 border-gray-300",
    ].join(" ");
    const knobClass = [
      "inline-block h-4 w-4 transform rounded-full bg-white shadow transition",
      isDark ? "translate-x-4" : "translate-x-1",
    ].join(" ");
    return (
      <button
        className={wrapperClass}
        type="button"
        onClick={toggleTheme}
        role="switch"
        aria-checked={isDark}
        aria-label="Toggle Dark Mode"
      >
        <span className={labelClass}>Theme</span>
        <span className={trackClass}>
          <span className={knobClass} />
        </span>
      </button>
    );
  };

  const renderTeamPicker = (variant: "desktop" | "mobile") => {
    if (teamScopes.length <= 1) return null;
    const wrapperClass =
      variant === "desktop"
        ? "flex flex-col gap-1 text-[11px] text-gray-500"
        : "flex flex-col gap-1 text-xs text-gray-500";
    return (
      <div className={wrapperClass}>
        <span className="font-semibold uppercase tracking-wide">Active Team</span>
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-none"
          value={teamSelection || ""}
          onChange={(event) => handleTeamScopeChange(event.target.value as Team)}
        >
          {teamScopes.map((teamId) => (
            <option key={teamId} value={teamId}>
              {formatTeamLabel(teamId)}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const closeMenu = () => setMenuOpen(false);
  const closeSettings = () => setSettingsOpen(false);

  const gearLinks = [
    { to: "/profile", label: "Profile" },
    ...(coach || admin
      ? [
          { to: "/summary", label: "Summary" },
          { to: "/admin", label: admin ? "Admin" : "Team" },
        ]
      : [{ to: "/progress", label: "Progress" }]),
  ];

  const settingsDialog =
    settingsOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="false">
            <div
              className="absolute inset-0 bg-black/80"
              onClick={closeSettings}
            />
            <div
              className="absolute left-1/2 top-1/2 w-[min(90vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Settings</div>
                  {friendlyName && (
                    <div className="text-xs text-gray-500">{friendlyName}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-full border border-gray-200 p-2 text-gray-600 transition hover:border-brand-200 hover:text-brand-700"
                  onClick={closeSettings}
                >
                  <span className="sr-only">Close Settings</span>
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              {/* Tab Navigation (only show if coach) */}
              {coach && (
                <div className="flex border-b border-gray-200">
                  <button
                    type="button"
                    className={`flex-1 px-4 py-2 text-sm font-medium transition ${
                      settingsTab === "general"
                        ? "border-b-2 border-brand-600 text-brand-700"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => setSettingsTab("general")}
                  >
                    General
                  </button>
                  <button
                    type="button"
                    className={`flex-1 px-4 py-2 text-sm font-medium transition ${
                      settingsTab === "quotes"
                        ? "border-b-2 border-brand-600 text-brand-700"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => setSettingsTab("quotes")}
                  >
                    Quotes
                  </button>
                </div>
              )}

              <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-4 py-4">
                {settingsTab === "general" ? (
                  <div className="space-y-4">
                    {(admin || coach) && (
                      <div className="flex flex-wrap gap-2">
                        {admin && (
                          <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                            Admin
                          </span>
                        )}
                        {coach && !admin && (
                          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                            Coach
                          </span>
                        )}
                      </div>
                    )}
                    {gearLinks.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Quick Links
                        </div>
                        {gearLinks.map((link) => (
                          <NavLink
                            key={link.to}
                            to={link.to}
                            className={({ isActive }) => drawerLinkClass(isActive)}
                            onClick={closeSettings}
                          >
                            {link.label}
                          </NavLink>
                        ))}
                      </div>
                    )}
                    <div className="space-y-3">
                      {renderTeamPicker("mobile")}
                      {renderThemeToggle("mobile")}
                    </div>
                  </div>
                ) : (
                  /* Quotes Tab */
                  <div className="space-y-4">
                    <div className="text-xs text-gray-500">
                      Add custom quotes to display on the NFC welcome screen. These will rotate daily with the built-in quotes.
                    </div>

                    {/* Add New Quote Form */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Add New Quote
                      </div>
                      <textarea
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none resize-none"
                        rows={2}
                        placeholder="Enter your motivational quote..."
                        value={newQuoteText}
                        onChange={(e) => setNewQuoteText(e.target.value)}
                      />
                      <input
                        type="text"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none"
                        placeholder="Author (optional, defaults to 'Coach')"
                        value={newQuoteAuthor}
                        onChange={(e) => setNewQuoteAuthor(e.target.value)}
                      />
                      <button
                        type="button"
                        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
                        onClick={handleSaveQuote}
                        disabled={!newQuoteText.trim() || savingQuote}
                      >
                        {savingQuote ? "Saving..." : "Add Quote"}
                      </button>
                    </div>

                    {/* Existing Quotes */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Your Custom Quotes ({customQuotes.length})
                      </div>
                      {quotesLoading ? (
                        <div className="text-sm text-gray-500 text-center py-4">Loading...</div>
                      ) : customQuotes.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-4 italic">
                          No custom quotes yet. Add one above!
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {customQuotes.map((quote) => (
                            <div
                              key={quote.id}
                              className="rounded-lg border border-gray-200 bg-white p-3 text-sm group"
                            >
                              <div className="flex justify-between gap-2">
                                <div className="flex-1">
                                  <p className="text-gray-800 italic">"{quote.text}"</p>
                                  <p className="text-xs text-gray-500 mt-1">— {quote.author}</p>
                                </div>
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 text-xs transition-opacity"
                                  onClick={() => quote.id && handleDeleteQuote(quote.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Built-in Default Quotes */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Built-in Quotes ({DEFAULT_QUOTES.length})
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {DEFAULT_QUOTES.map((quote, index) => (
                          <div
                            key={index}
                            className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm"
                          >
                            <p className="text-gray-600 italic">"{quote.text}"</p>
                            <p className="text-xs text-gray-400 mt-1">— {quote.author}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <header className="relative z-50 border-b border-gray-200/70 bg-white/90 backdrop-blur">
      <div className="container flex items-center gap-3 py-3 md:h-16 md:py-0">
        <Link to="/" className="flex items-center gap-2 text-gray-900 hover:opacity-90">
          <img src="/assets/dragon.png" alt="Dragon" className="h-8 w-8 object-contain" />
          <span className="text-xl font-bold tracking-tight">PL Strength</span>
        </Link>
        {!isMobile && renderStatusIndicator()}
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {isMobile ? (
            <>
              {friendlyName && (
                <span className="badge badge-muted text-xs">{friendlyName}</span>
              )}
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-soft transition hover:border-brand-200 hover:text-brand-700"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
              >
                <span className="sr-only">Sign Out</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 16l4-4-4-4" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H9" />
                </svg>
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-soft transition hover:border-brand-200 hover:text-brand-700"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen((prev) => !prev);
                }}
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
              >
                <span className="sr-only">Open Settings</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.5 1.75h5l.73 2.2a7.5 7.5 0 012 .84l2.19-.79 2.5 4.33-1.85 1.33a7.6 7.6 0 010 2.68l1.85 1.33-2.5 4.33-2.19-.79a7.5 7.5 0 01-2 .84l-.73 2.2h-5l-.73-2.2a7.5 7.5 0 01-2-.84l-2.19.79-2.5-4.33 1.85-1.33a7.6 7.6 0 010-2.68l-1.85-1.33 2.5-4.33 2.19.79a7.5 7.5 0 012-.84l.73-2.2Z"
                  />
                  <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-soft transition hover:border-brand-200 hover:text-brand-700"
                onClick={() => {
                  setSettingsOpen(false);
                  setMenuOpen((prev) => !prev);
                }}
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
              >
                <span className="sr-only">Toggle Navigation</span>
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
              <button
                className="nav-link"
                type="button"
                onClick={() => signOut()}
              >
                Sign Out
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-soft transition hover:border-brand-200 hover:text-brand-700"
                onClick={() => setSettingsOpen((prev) => !prev)}
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
              >
                <span className="sr-only">Open Settings</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.5 1.75h5l.73 2.2a7.5 7.5 0 012 .84l2.19-.79 2.5 4.33-1.85 1.33a7.6 7.6 0 010 2.68l1.85 1.33-2.5 4.33-2.19-.79a7.5 7.5 0 01-2 .84l-.73 2.2h-5l-.73-2.2a7.5 7.5 0 01-2-.84l-2.19.79-2.5-4.33 1.85-1.33a7.6 7.6 0 010-2.68l-1.85-1.33 2.5-4.33 2.19.79a7.5 7.5 0 012-.84l.73-2.2Z"
                  />
                  <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </nav>
          )}
        </div>
      </div>
      {settingsDialog}
      {isMobile && (
        <div
          id="mobile-navigation"
          className={[
            "pointer-events-none overflow-y-auto transition-[max-height,opacity] duration-200 ease-out",
            menuOpen
              ? "pointer-events-auto max-h-[calc(100vh-5rem)] opacity-100"
              : "max-h-0 opacity-0",
          ].join(" ")}
        >
          <div className="container pb-3">
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-soft">
              <div>{renderStatusIndicator()}</div>
              {renderTeamPicker("mobile")}
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
                {admin && (
                  <span className="flex items-center justify-between rounded-xl border-2 border-purple-300 bg-purple-100 px-4 py-2 text-base font-semibold text-purple-700">
                    Admin Mode
                  </span>
                )}
                {coach && !admin && (
                  <span className="flex items-center justify-between rounded-xl border-2 border-brand-300 bg-brand-100 px-4 py-2 text-base font-semibold text-brand-700">
                    Coach Mode
                  </span>
                )}
              </nav>
              <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
                {friendlyName && (
                  <span className="badge badge-muted self-start text-xs">
                    {friendlyName}
                  </span>
                )}
                {renderThemeToggle("mobile")}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
