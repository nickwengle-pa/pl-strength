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
  setFeaturedQuote,
  getFeaturedQuote,
  clearFeaturedQuote,
  syncLocalSessionsToFirebase,
  defaultEquipment,
  normalizeEquipment,
  saveProfile,
  type Team,
  type CustomQuote,
  type FeaturedQuote,
  type EquipmentSettings,
  type BarOption,
  type Profile,
  type Unit,
} from "../lib/db";
import { useAuth } from "../lib/auth";
import { useDevice } from "../lib/device";

type Status = "checking" | "connected" | "offline" | "syncing";
type Theme = "light" | "dark";
type SettingsTab = "general" | "quotes" | "equipment";

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
  const [todaysFeatured, setTodaysFeatured] = useState<FeaturedQuote | null>(null);

  // Equipment management state
  const [equipmentProfile, setEquipmentProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<EquipmentSettings>(defaultEquipment());
  const [equipmentUnit, setEquipmentUnit] = useState<Unit>("lb");
  const [equipmentDirty, setEquipmentDirty] = useState(false);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [newPlateWeight, setNewPlateWeight] = useState("");
  const [newBarLabel, setNewBarLabel] = useState("");
  const [newBarWeight, setNewBarWeight] = useState("");

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

  // Listen for online/offline events and attempt sync when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      if (hasFirebase()) {
        setStatus("syncing");
        // Attempt to sync any local data when coming back online
        try {
          const count = await syncLocalSessionsToFirebase();
          if (count > 0) {
            console.log(`Synced ${count} session(s) after coming online`);
          }
        } catch (err) {
          console.warn("Online sync failed:", err);
        }
        setStatus("connected");
      }
    };
    
    const handleOffline = () => {
      setStatus("offline");
    };
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    // Set initial status based on navigator.onLine
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
    }
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
      : status === "syncing"
      ? "Syncing..."
      : status === "checking"
      ? "Checking Firebase..."
      : "Offline Mode";

  const statusClass =
    status === "connected"
      ? "badge badge-success"
      : status === "syncing"
      ? "badge badge-warning"
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
    if (status === "syncing") {
      return (
        <span
          className="inline-flex h-3 w-3 items-center justify-center"
          aria-label="Syncing..."
          title="Syncing data..."
        >
          <span className="h-3 w-3 rounded-full bg-yellow-500 animate-pulse" aria-hidden="true" />
        </span>
      );
    }
    return <span className={`${statusClass} leading-none`}>{statusLabel}</span>;
  };

  const athleteLinks = [
    { to: "/program-outline", label: "Daily Lifts" },
    { to: "/turf", label: "Warmup / Plyo" },
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
  // For mobile, filter out Calculator (shown as icon instead)
  const mobileLinks = baseLinks.filter(l => l.to !== "/calculator");

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
    
    // Load both custom quotes and today's featured quote
    Promise.all([loadCustomQuotes(), getFeaturedQuote()])
      .then(([quotes, featured]) => {
        if (active) {
          setCustomQuotes(quotes);
          setTodaysFeatured(featured);
        }
      })
      .catch(() => {
        if (active) {
          setCustomQuotes([]);
          setTodaysFeatured(null);
        }
      })
      .finally(() => {
        if (active) setQuotesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settingsOpen, settingsTab, coach]);

  const handleSaveQuote = async (setAsToday: boolean = false) => {
    if (!newQuoteText.trim() || savingQuote) return;
    setSavingQuote(true);
    try {
      const quoteData = { text: newQuoteText.trim(), author: newQuoteAuthor.trim() || "Coach" };
      
      // Save to custom quotes collection
      const id = await saveCustomQuote(quoteData, user?.uid);
      if (id) {
        setCustomQuotes((prev) => [
          { id, text: quoteData.text, author: quoteData.author },
          ...prev,
        ]);
      }
      
      // If "Save & Set Today" was clicked, also set as featured
      if (setAsToday) {
        const success = await setFeaturedQuote(quoteData, user?.uid);
        if (success) {
          setTodaysFeatured({
            text: quoteData.text,
            author: quoteData.author,
            date: new Date().toISOString().split("T")[0],
          });
        }
      }
      
      setNewQuoteText("");
      setNewQuoteAuthor("");
    } catch (err) {
      console.warn("Failed to save quote", err);
    } finally {
      setSavingQuote(false);
    }
  };

  const handleSetExistingAsToday = async (quote: { text: string; author: string }) => {
    const success = await setFeaturedQuote(quote, user?.uid);
    if (success) {
      setTodaysFeatured({
        text: quote.text,
        author: quote.author,
        date: new Date().toISOString().split("T")[0],
      });
    }
  };

  const handleClearFeatured = async () => {
    const success = await clearFeaturedQuote();
    if (success) {
      setTodaysFeatured(null);
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!window.confirm("Delete this quote?")) return;
    const success = await deleteCustomQuote(quoteId);
    if (success) {
      setCustomQuotes((prev) => prev.filter((q) => q.id !== quoteId));
    }
  };

  // Load equipment when equipment tab is opened
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "equipment") return;
    let active = true;
    
    loadProfileRemote()
      .then((profile) => {
        if (!active) return;
        if (profile) {
          setEquipmentProfile(profile);
          const normalizedEquip = normalizeEquipment(profile.equipment as EquipmentSettings | undefined);
          setEquipment(normalizedEquip);
          setEquipmentUnit((profile.unit as Unit) || "lb");
        }
      })
      .catch((err) => {
        if (!active) return;
        console.warn("Failed to load equipment profile", err);
      });
    
    return () => { active = false; };
  }, [settingsOpen, settingsTab]);

  // Equipment handlers
  const formatNumber = (value: number, digits = 2): string => {
    const fixed = value.toFixed(digits);
    return Number(fixed).toString();
  };

  const parseNumeric = (value: string): number | "" => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? num : "";
  };

  const applyEquipmentUpdate = (fn: (prev: EquipmentSettings) => EquipmentSettings) => {
    setEquipment((prev) => {
      const next = normalizeEquipment(fn(prev));
      setEquipmentDirty(true);
      return next;
    });
  };

  const handleAddPlate = () => {
    const parsed = parseNumeric(newPlateWeight);
    if (typeof parsed !== "number" || parsed <= 0) return;
    applyEquipmentUpdate((prev) => {
      const current = prev.plates[equipmentUnit] ?? [];
      return { ...prev, plates: { ...prev.plates, [equipmentUnit]: [...current, parsed] } };
    });
    setNewPlateWeight("");
  };

  const handleRemovePlate = (weight: number) => {
    applyEquipmentUpdate((prev) => {
      const current = prev.plates[equipmentUnit] ?? [];
      const nextList = current.filter((v) => Math.abs(v - weight) > 1e-6);
      return { ...prev, plates: { ...prev.plates, [equipmentUnit]: nextList } };
    });
  };

  const handleAddBar = () => {
    const parsedWeight = parseNumeric(newBarWeight);
    if (typeof parsedWeight !== "number" || parsedWeight <= 0) return;
    const label = newBarLabel.trim() || `${formatNumber(parsedWeight)} ${equipmentUnit} bar`;
    applyEquipmentUpdate((prev) => {
      const current = prev.bars[equipmentUnit] ?? [];
      return { ...prev, bars: { ...prev.bars, [equipmentUnit]: [...current, { id: "", label, weight: parsedWeight }] } };
    });
    setNewBarLabel("");
    setNewBarWeight("");
  };

  const handleRemoveBar = (id: string) => {
    applyEquipmentUpdate((prev) => {
      const current = prev.bars[equipmentUnit] ?? [];
      const nextList = current.filter((bar) => bar.id !== id);
      const wasActive = prev.activeBarId[equipmentUnit] === id;
      return {
        ...prev,
        bars: { ...prev.bars, [equipmentUnit]: nextList },
        activeBarId: { ...prev.activeBarId, [equipmentUnit]: wasActive ? nextList[0]?.id ?? null : prev.activeBarId[equipmentUnit] },
      };
    });
  };

  const handleSelectBar = (id: string) => {
    applyEquipmentUpdate((prev) => ({ ...prev, activeBarId: { ...prev.activeBarId, [equipmentUnit]: id } }));
  };

  const handleResetEquipment = () => {
    applyEquipmentUpdate(() => defaultEquipment());
  };

  const persistEquipmentChanges = async () => {
    if (!equipmentProfile) return;
    setEquipmentSaving(true);
    const nextProfile: Profile = { ...equipmentProfile, equipment };
    try {
      await saveProfile(nextProfile, { requireRemote: true });
      setEquipmentProfile(nextProfile);
      setEquipmentDirty(false);
    } catch (err) {
      console.warn("Failed to save equipment", err);
    } finally {
      setEquipmentSaving(false);
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
        <span className={labelClass}>{isDark ? "🌙 Dark" : "☀️ Light"}</span>
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
    ...(admin
      ? [
          { to: "/summary", label: "Summary" },
          { to: "/admin", label: "Admin" },
          { to: "/football", label: "Football Sim" },
        ]
      : coach
      ? [{ to: "/football", label: "Football Sim" }]
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

              {/* Tab Navigation */}
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
                {coach && (
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
                )}
                <button
                  type="button"
                  className={`flex-1 px-4 py-2 text-sm font-medium transition ${
                    settingsTab === "equipment"
                      ? "border-b-2 border-brand-600 text-brand-700"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                  onClick={() => setSettingsTab("equipment")}
                >
                  Equipment
                </button>
              </div>

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
                ) : settingsTab === "quotes" ? (
                  /* Quotes Tab */
                  <div className="space-y-4">
                    <div className="text-xs text-gray-500">
                      Add custom quotes to display on the NFC welcome screen. These will rotate daily with the built-in quotes.
                    </div>

                    {/* Today's Featured Quote */}
                    {todaysFeatured && (
                      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                            ⭐ Today's Featured Quote
                          </div>
                          <button
                            type="button"
                            className="text-xs text-amber-600 hover:text-amber-800"
                            onClick={handleClearFeatured}
                          >
                            Clear
                          </button>
                        </div>
                        <p className="text-sm text-amber-900 italic">"{todaysFeatured.text}"</p>
                        <p className="text-xs text-amber-700">— {todaysFeatured.author}</p>
                      </div>
                    )}

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
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300 disabled:opacity-50"
                          onClick={() => handleSaveQuote(false)}
                          disabled={!newQuoteText.trim() || savingQuote}
                        >
                          {savingQuote ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
                          onClick={() => handleSaveQuote(true)}
                          disabled={!newQuoteText.trim() || savingQuote}
                        >
                          Save & Set Today
                        </button>
                      </div>
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
                                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    className="text-amber-600 hover:text-amber-800 text-xs"
                                    onClick={() => handleSetExistingAsToday(quote)}
                                  >
                                    Set Today
                                  </button>
                                  <button
                                    type="button"
                                    className="text-red-500 hover:text-red-700 text-xs"
                                    onClick={() => quote.id && handleDeleteQuote(quote.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
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
                            className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm group"
                          >
                            <div className="flex justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-gray-600 italic">"{quote.text}"</p>
                                <p className="text-xs text-gray-400 mt-1">— {quote.author}</p>
                              </div>
                              <button
                                type="button"
                                className="opacity-0 group-hover:opacity-100 text-amber-600 hover:text-amber-800 text-xs transition-opacity"
                                onClick={() => handleSetExistingAsToday(quote)}
                              >
                                Set Today
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : settingsTab === "equipment" ? (
                  <div className="space-y-6">
                    {/* Unit Toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Units</span>
                      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                        <button
                          type="button"
                          className={`px-4 py-1.5 text-sm font-medium transition ${
                            equipmentUnit === "lb"
                              ? "bg-brand-600 text-white"
                              : "bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                          onClick={() => setEquipmentUnit("lb")}
                        >
                          lb
                        </button>
                        <button
                          type="button"
                          className={`px-4 py-1.5 text-sm font-medium transition ${
                            equipmentUnit === "kg"
                              ? "bg-brand-600 text-white"
                              : "bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                          onClick={() => setEquipmentUnit("kg")}
                        >
                          kg
                        </button>
                      </div>
                    </div>

                    {/* Plates Section */}
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Plates ({equipmentUnit})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(equipment.plates[equipmentUnit] ?? []).map((w, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                          >
                            {formatNumber(w)}
                            <button
                              type="button"
                              onClick={() => handleRemovePlate(w)}
                              className="ml-1 text-gray-400 hover:text-red-500"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={newPlateWeight}
                          onChange={(e) => setNewPlateWeight(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddPlate()}
                          placeholder={`Add plate (${equipmentUnit})`}
                          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                        />
                        <button
                          type="button"
                          onClick={handleAddPlate}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Bars Section */}
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Bars ({equipmentUnit})
                      </div>
                      <div className="space-y-2">
                        {(equipment.bars[equipmentUnit] ?? []).map((bar) => (
                          <div
                            key={bar.id}
                            className={`flex items-center justify-between rounded-lg border p-3 transition cursor-pointer ${
                              equipment.activeBarId[equipmentUnit] === bar.id
                                ? "border-brand-400 bg-brand-50"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                            onClick={() => handleSelectBar(bar.id)}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                  equipment.activeBarId[equipmentUnit] === bar.id
                                    ? "border-brand-600"
                                    : "border-gray-300"
                                }`}
                              >
                                {equipment.activeBarId[equipmentUnit] === bar.id && (
                                  <div className="w-2 h-2 rounded-full bg-brand-600" />
                                )}
                              </div>
                              <span className="font-medium text-gray-700">{bar.label}</span>
                              <span className="text-sm text-gray-500">
                                {formatNumber(bar.weight)} {equipmentUnit}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveBar(bar.id);
                              }}
                              className="text-gray-400 hover:text-red-500 transition"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newBarLabel}
                          onChange={(e) => setNewBarLabel(e.target.value)}
                          placeholder="Bar name (optional)"
                          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                        />
                        <input
                          type="number"
                          value={newBarWeight}
                          onChange={(e) => setNewBarWeight(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddBar()}
                          placeholder={`Weight (${equipmentUnit})`}
                          className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                        />
                        <button
                          type="button"
                          onClick={handleAddBar}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={handleResetEquipment}
                        className="text-sm text-gray-500 hover:text-gray-700 transition"
                      >
                        Reset to Defaults
                      </button>
                      <div className="flex-1" />
                      {equipmentDirty && (
                        <button
                          type="button"
                          onClick={persistEquipmentChanges}
                          disabled={equipmentSaving}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition"
                        >
                          {equipmentSaving ? "Saving..." : "Save Changes"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
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
              {/* Quick actions row with Calculator and Equipment icons */}
              <div className="flex items-center justify-between">
                <div>{renderStatusIndicator()}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      setSettingsTab("equipment");
                      setSettingsOpen(true);
                    }}
                    className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-brand-100 hover:text-brand-700 transition-colors"
                  >
                    <span className="text-lg">🏋️</span>
                    <span>Gear</span>
                  </button>
                  <NavLink
                    to="/calculator"
                    onClick={closeMenu}
                    className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-brand-100 hover:text-brand-700 transition-colors"
                  >
                    <span className="text-lg">🧮</span>
                    <span>Calc</span>
                  </NavLink>
                </div>
              </div>
              {renderTeamPicker("mobile")}
              <nav className="space-y-2">
                {mobileLinks.map(({ to, label }) => (
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
