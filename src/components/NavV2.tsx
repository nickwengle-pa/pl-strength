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
  defaultReportSettings,
  loadReportSettings,
  saveReportSettings,
  uploadReportLogo,
  deleteReportLogo,
  type Team,
  type CustomQuote,
  type FeaturedQuote,
  type EquipmentSettings,
  type BarOption,
  type Profile,
  type Unit,
  type ReportSettings,
  type ReportRangePreset,
  type ReportPageSize,
} from "../lib/db";
import { useAuth } from "../lib/auth";
import { useDevice } from "../lib/device";
import { ConfirmModal } from "./ConfirmModal";

type Status = "checking" | "connected" | "offline" | "syncing";
type Theme = "light" | "dark";
type SettingsTab = "general" | "quotes" | "equipment" | "reports";

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

// Inline SVG icons (24x24 viewBox, stroke-current)
const IconGear = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 1.75h5l.73 2.2a7.5 7.5 0 012 .84l2.19-.79 2.5 4.33-1.85 1.33a7.6 7.6 0 010 2.68l1.85 1.33-2.5 4.33-2.19-.79a7.5 7.5 0 01-2 .84l-.73 2.2h-5l-.73-2.2a7.5 7.5 0 01-2-.84l-2.19.79-2.5-4.33 1.85-1.33a7.6 7.6 0 010-2.68l-1.85-1.33 2.5-4.33 2.19.79a7.5 7.5 0 012-.84l.73-2.2Z" />
    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconMenu = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
const IconClose = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const IconSignOut = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 16l4-4-4-4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H9" />
  </svg>
);
const IconSun = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const IconMoon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconCalc = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" />
  </svg>
);
const IconBarbell = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12" />
  </svg>
);
const IconStar = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} fill-current stroke-current`} strokeWidth={1} aria-hidden="true">
    <path d="M12 2l2.9 6.9 7.5.6-5.7 4.9 1.8 7.3L12 17.8 5.5 21.7l1.8-7.3L1.6 9.5l7.5-.6L12 2z" />
  </svg>
);

export default function NavV2() {
  const { user, signOut } = useAuth();
  const device = useDevice();
  const [deleteQuoteConfirm, setDeleteQuoteConfirm] = useState<string | null>(null);
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
  const [reportSettings, setReportSettings] = useState<ReportSettings>(() => defaultReportSettings());
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false);
  const [reportSettingsSaving, setReportSettingsSaving] = useState(false);
  const [reportSettingsDirty, setReportSettingsDirty] = useState(false);
  const [reportSettingsMessage, setReportSettingsMessage] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = React.useRef<HTMLInputElement | null>(null);

  const reportSettingsTeam = (teamSelection || teamScopes[0] || "") as Team | "";

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

  const statusDotClass =
    status === "connected"
      ? "bg-v2-success-500"
      : status === "syncing" || status === "checking"
      ? "bg-v2-warn-500 animate-pulse"
      : "bg-v2-danger-500";

  const renderStatusIndicator = () => {
    if (status === "connected") {
      return (
        <span
          className="inline-flex h-3 w-3 items-center justify-center"
          aria-label="Connected To Firebase"
          title="Connected To Firebase"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-v2-success-500" aria-hidden="true" />
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
          <span className="h-2.5 w-2.5 rounded-full bg-v2-warn-500 animate-pulse" aria-hidden="true" />
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-2 text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400"
        aria-label={statusLabel}
        title={statusLabel}
      >
        <span className={`h-2 w-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
        <span>{statusLabel}</span>
      </span>
    );
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

  // role-adaptive accent color for link underline + pills
  const accentBorderClass = (coach || admin)
    ? "border-v2-info-600"
    : "border-v2-accent-600";
  const accentHoverTextClass = (coach || admin)
    ? "hover:text-v2-info-400"
    : "hover:text-v2-accent-400";
  const accentBarBgClass = (coach || admin)
    ? "bg-v2-info-600"
    : "bg-v2-accent-600";

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

  const handleDeleteQuote = (quoteId: string) => {
    setDeleteQuoteConfirm(quoteId);
  };

  const doDeleteQuote = async (quoteId: string) => {
    setDeleteQuoteConfirm(null);
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
    if (!settingsOpen || settingsTab !== "reports" || !coach) return;
    let active = true;
    setReportSettingsMessage("");

    if (!reportSettingsTeam) {
      setReportSettings(defaultReportSettings());
      setReportSettingsDirty(false);
      return () => {
        active = false;
      };
    }

    setReportSettingsLoading(true);
    loadReportSettings(reportSettingsTeam)
      .then((settings) => {
        if (!active) return;
        setReportSettings(settings);
        setReportSettingsDirty(false);
      })
      .catch((err) => {
        if (!active) return;
        console.warn("Failed to load report settings", err);
        setReportSettings(defaultReportSettings(reportSettingsTeam));
        setReportSettingsDirty(false);
        setReportSettingsMessage("Report settings could not be loaded.");
      })
      .finally(() => {
        if (active) setReportSettingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [settingsOpen, settingsTab, coach, reportSettingsTeam]);

  const updateReportSettingsDraft = (updates: Partial<ReportSettings>) => {
    setReportSettings((prev) => ({ ...prev, ...updates }));
    setReportSettingsDirty(true);
    setReportSettingsMessage("");
  };

  const persistReportSettingsChanges = async () => {
    if (!reportSettingsTeam || reportSettingsSaving) return;
    setReportSettingsSaving(true);
    setReportSettingsMessage("");
    try {
      const saved = await saveReportSettings(reportSettingsTeam, reportSettings, user?.uid);
      setReportSettings(saved);
      setReportSettingsDirty(false);
      setReportSettingsMessage("Report settings saved.");
    } catch (err) {
      console.warn("Failed to save report settings", err);
      setReportSettingsMessage("Report settings could not be saved.");
    } finally {
      setReportSettingsSaving(false);
    }
  };

  const handleLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !reportSettingsTeam || logoUploading) return;
    setLogoUploading(true);
    setReportSettingsMessage("");
    try {
      const url = await uploadReportLogo(reportSettingsTeam, file);
      updateReportSettingsDraft({ logoUrl: url });
      setReportSettingsMessage("Logo uploaded. Save to apply to reports.");
    } catch (err: any) {
      console.warn("Logo upload failed", err);
      setReportSettingsMessage(err?.message ?? "Logo upload failed.");
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!reportSettingsTeam || logoUploading) return;
    setLogoUploading(true);
    setReportSettingsMessage("");
    try {
      await deleteReportLogo(reportSettingsTeam);
      updateReportSettingsDraft({ logoUrl: "" });
      setReportSettingsMessage("Logo removed. Save to apply to reports.");
    } catch (err: any) {
      console.warn("Logo remove failed", err);
      setReportSettingsMessage(err?.message ?? "Could not remove logo.");
    } finally {
      setLogoUploading(false);
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

  // Desktop: uppercase tracked editorial label; active = underline accent
  const navLinkClass = (active: boolean) => {
    if (isMobile) {
      return [
        "flex items-center gap-3 min-h-touch-lg px-4 py-3 text-base font-medium transition-colors",
        "border-l-2",
        active
          ? `${accentBorderClass} bg-v2-surface-900 text-v2-ink-50 dark:bg-v2-surface-900`
          : `border-transparent text-v2-ink-300 hover:bg-v2-surface-900 hover:text-v2-ink-50`,
      ].join(" ");
    }
    return [
      "relative min-h-touch inline-flex items-center px-1 py-4 text-v2-xs font-semibold uppercase tracking-[0.18em] transition-colors",
      "focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950",
      active
        ? `text-v2-ink-50 border-b-2 ${accentBorderClass}`
        : `text-v2-ink-400 border-b-2 border-transparent ${accentHoverTextClass}`,
    ].join(" ");
  };

  const drawerLinkClass = (active: boolean) =>
    [
      "flex items-center justify-between min-h-touch rounded-v2-sm border px-3 py-2 text-sm font-medium transition-colors",
      "focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950",
      active
        ? `border-v2-surface-700 bg-v2-surface-900 text-v2-ink-50`
        : `border-v2-surface-800 bg-v2-surface-950 text-v2-ink-300 hover:border-v2-surface-700 hover:bg-v2-surface-900 hover:text-v2-ink-50`,
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
    const wrapperClass =
      variant === "desktop"
        ? "inline-flex items-center gap-2 min-h-touch rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-3 py-1.5 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-300 transition hover:border-v2-surface-700 hover:text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
        : "flex items-center justify-between min-h-touch-lg rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 px-4 py-2 text-base font-medium text-v2-ink-200 transition hover:border-v2-surface-700 hover:bg-v2-surface-900 hover:text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950";
    return (
      <button
        className={wrapperClass}
        type="button"
        onClick={toggleTheme}
        role="switch"
        aria-checked={isDark}
        aria-label="Toggle Dark Mode"
      >
        <span className="inline-flex items-center gap-2">
          {isDark ? <IconMoon className="w-4 h-4" /> : <IconSun className="w-4 h-4" />}
          <span>{isDark ? "Dark" : "Light"}</span>
        </span>
        <span
          className={[
            "relative inline-flex h-5 w-9 items-center rounded-full border transition",
            isDark ? "bg-v2-accent-700 border-v2-accent-600" : "bg-v2-surface-700 border-v2-surface-600",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-4 w-4 transform rounded-full bg-v2-ink-50 shadow transition",
              isDark ? "translate-x-4" : "translate-x-1",
            ].join(" ")}
          />
        </span>
      </button>
    );
  };

  const renderTeamPicker = (variant: "desktop" | "mobile") => {
    if (teamScopes.length <= 1) return null;
    const wrapperClass =
      variant === "desktop"
        ? "flex flex-col gap-1 text-v2-xs text-v2-ink-400"
        : "flex flex-col gap-1 text-xs text-v2-ink-400";
    return (
      <div className={wrapperClass}>
        <span className="font-semibold uppercase tracking-[0.18em] text-v2-ink-500">Active Team</span>
        <select
          className="field-v2 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
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

  const rolePillClass = admin
    ? "bg-v2-warn-600 text-v2-ink-950"
    : coach
    ? "bg-v2-info-700 text-v2-ink-50"
    : "bg-v2-accent-800 text-v2-ink-50";

  const roleLabel = admin ? "Admin" : coach ? "Coach" : "Athlete";

  const tabBtn = (active: boolean) =>
    [
      "flex-1 min-h-touch px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] transition",
      active
        ? `border-b-2 ${accentBorderClass} text-v2-ink-50`
        : "border-b-2 border-transparent text-v2-ink-400 hover:text-v2-ink-100",
    ].join(" ");

  const settingsFieldClass =
    "field-v2 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 px-3 py-2 text-sm text-v2-ink-100 placeholder:text-v2-ink-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950";

  const settingsDialog =
    settingsOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="false">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={closeSettings}
            />
            <div
              className="absolute left-1/2 top-1/2 w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-2"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-v2-surface-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-px w-5 ${accentBarBgClass}`} aria-hidden="true" />
                  <div>
                    <div className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-50">Settings</div>
                    {friendlyName && (
                      <div className="text-xs text-v2-ink-400 mt-0.5">{friendlyName}</div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-v2-sm border border-v2-surface-800 text-v2-ink-300 transition hover:border-v2-surface-700 hover:text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                  onClick={closeSettings}
                  aria-label="Close Settings"
                >
                  <span className="sr-only">Close Settings</span>
                  <IconClose className="h-4 w-4" />
                </button>
              </div>

              {/* Tab Navigation — segmented with accent underline */}
              <div className="flex border-b border-v2-surface-800">
                <button
                  type="button"
                  className={tabBtn(settingsTab === "general")}
                  onClick={() => setSettingsTab("general")}
                >
                  General
                </button>
                {coach && (
                  <button
                    type="button"
                    className={tabBtn(settingsTab === "quotes")}
                    onClick={() => setSettingsTab("quotes")}
                  >
                    Quotes
                  </button>
                )}
                {coach && (
                  <button
                    type="button"
                    className={tabBtn(settingsTab === "reports")}
                    onClick={() => setSettingsTab("reports")}
                  >
                    Reports
                  </button>
                )}
                <button
                  type="button"
                  className={tabBtn(settingsTab === "equipment")}
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
                          <span className="inline-flex items-center rounded-full bg-v2-warn-600 text-v2-ink-950 px-2 py-0.5 text-v2-xs font-semibold uppercase tracking-[0.18em]">
                            Admin
                          </span>
                        )}
                        {coach && !admin && (
                          <span className="inline-flex items-center rounded-full bg-v2-info-700 text-v2-ink-50 px-2 py-0.5 text-v2-xs font-semibold uppercase tracking-[0.18em]">
                            Coach
                          </span>
                        )}
                      </div>
                    )}
                    {gearLinks.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                          <span className={`h-px w-5 ${accentBarBgClass}`} aria-hidden="true" />
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
                    <div className="text-xs text-v2-ink-400">
                      Add custom quotes to display on the NFC welcome screen. These will rotate daily with the built-in quotes.
                    </div>

                    {/* Today's Featured Quote */}
                    {todaysFeatured && (
                      <div className="rounded-v2-sm border border-v2-warn-500 bg-v2-warn-900/30 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="inline-flex items-center gap-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-warn-300">
                            <IconStar className="w-3.5 h-3.5" />
                            Today's Featured Quote
                          </div>
                          <button
                            type="button"
                            className="text-xs text-v2-warn-300 hover:text-v2-warn-100 uppercase tracking-[0.18em]"
                            onClick={handleClearFeatured}
                          >
                            Clear
                          </button>
                        </div>
                        <p className="text-sm text-v2-ink-100 italic">"{todaysFeatured.text}"</p>
                        <p className="text-xs text-v2-warn-300">&mdash; {todaysFeatured.author}</p>
                      </div>
                    )}

                    {/* Add New Quote Form */}
                    <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 p-3 space-y-3">
                      <div className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                        Add New Quote
                      </div>
                      <textarea
                        className="field-v2 w-full rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 resize-none"
                        rows={2}
                        placeholder="Enter your motivational quote..."
                        value={newQuoteText}
                        onChange={(e) => setNewQuoteText(e.target.value)}
                      />
                      <input
                        type="text"
                        className="field-v2 w-full rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        placeholder="Author (optional, defaults to 'Coach')"
                        value={newQuoteAuthor}
                        onChange={(e) => setNewQuoteAuthor(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200 transition hover:border-v2-surface-600 hover:text-v2-ink-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                          onClick={() => handleSaveQuote(false)}
                          disabled={!newQuoteText.trim() || savingQuote}
                        >
                          {savingQuote ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="flex-1 min-h-touch rounded-v2-sm bg-v2-warn-600 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-950 transition hover:bg-v2-warn-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-v2-warn-400 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                          onClick={() => handleSaveQuote(true)}
                          disabled={!newQuoteText.trim() || savingQuote}
                        >
                          Save &amp; Set Today
                        </button>
                      </div>
                    </div>

                    {/* Existing Quotes */}
                    <div className="space-y-2">
                      <div className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                        Your Custom Quotes ({customQuotes.length})
                      </div>
                      {quotesLoading ? (
                        <div className="text-sm text-v2-ink-400 text-center py-4">Loading...</div>
                      ) : customQuotes.length === 0 ? (
                        <div className="text-sm text-v2-ink-500 text-center py-4 italic">
                          No custom quotes yet. Add one above!
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {customQuotes.map((quote) => (
                            <div
                              key={quote.id}
                              className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 p-3 text-sm group"
                            >
                              <div className="flex justify-between gap-2">
                                <div className="flex-1">
                                  <p className="text-v2-ink-100 italic">"{quote.text}"</p>
                                  <p className="text-xs text-v2-ink-400 mt-1">&mdash; {quote.author}</p>
                                </div>
                                <div className="flex flex-col gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    className="text-v2-warn-400 hover:text-v2-warn-200 text-v2-xs uppercase tracking-[0.18em]"
                                    onClick={() => handleSetExistingAsToday(quote)}
                                  >
                                    Set Today
                                  </button>
                                  <button
                                    type="button"
                                    className="text-v2-danger-400 hover:text-v2-danger-200 text-v2-xs uppercase tracking-[0.18em]"
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
                      <div className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                        Built-in Quotes ({DEFAULT_QUOTES.length})
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {DEFAULT_QUOTES.map((quote, index) => (
                          <div
                            key={index}
                            className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-sm group"
                          >
                            <div className="flex justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-v2-ink-300 italic">"{quote.text}"</p>
                                <p className="text-xs text-v2-ink-500 mt-1">&mdash; {quote.author}</p>
                              </div>
                              <button
                                type="button"
                                className="md:opacity-0 md:group-hover:opacity-100 text-v2-warn-400 hover:text-v2-warn-200 text-v2-xs uppercase tracking-[0.18em] transition-opacity"
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
                ) : settingsTab === "reports" ? (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 px-3 py-2">
                      <div>
                        <div className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                          Active Report Team
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-v2-ink-100">
                          {reportSettingsTeam ? formatTeamLabel(reportSettingsTeam) : "No Team Selected"}
                        </div>
                      </div>
                      {reportSettingsTeam && teamScopes.length > 1 && (
                        <div className="min-w-44">{renderTeamPicker("mobile")}</div>
                      )}
                    </div>

                    {!reportSettingsTeam ? (
                      <div className="rounded-v2-sm border border-v2-warn-600/60 bg-v2-warn-600/10 px-3 py-3 text-sm text-v2-warn-300">
                        Select a team before saving report settings.
                      </div>
                    ) : reportSettingsLoading ? (
                      <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 px-3 py-6 text-center text-sm text-v2-ink-400">
                        Loading report settings...
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            School
                            <input
                              type="text"
                              className={settingsFieldClass}
                              value={reportSettings.schoolName}
                              onChange={(event) =>
                                updateReportSettingsDraft({ schoolName: event.target.value })
                              }
                              placeholder="School name"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            Program
                            <input
                              type="text"
                              className={settingsFieldClass}
                              value={reportSettings.programName}
                              onChange={(event) =>
                                updateReportSettingsDraft({ programName: event.target.value })
                              }
                              placeholder={formatTeamLabel(reportSettingsTeam)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            Coach
                            <input
                              type="text"
                              className={settingsFieldClass}
                              value={reportSettings.coachName}
                              onChange={(event) =>
                                updateReportSettingsDraft({ coachName: event.target.value })
                              }
                              placeholder="Coach name"
                            />
                          </label>
                          <div className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            Logo
                            <div className="flex items-center gap-3 rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 px-3 py-2">
                              {reportSettings.logoUrl ? (
                                <img
                                  src={reportSettings.logoUrl}
                                  alt="Report logo preview"
                                  className="h-10 w-10 rounded object-contain bg-white/5"
                                />
                              ) : (
                                <div className="h-10 w-10 rounded border border-dashed border-v2-surface-700 flex items-center justify-center text-[10px] text-v2-ink-500 normal-case tracking-normal">
                                  None
                                </div>
                              )}
                              <input
                                ref={logoInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleLogoFileChange}
                              />
                              <button
                                type="button"
                                onClick={() => logoInputRef.current?.click()}
                                disabled={logoUploading}
                                className="text-v2-xs uppercase tracking-[0.18em] font-semibold text-v2-ink-100 px-3 py-1 rounded-v2-sm border border-v2-surface-700 hover:bg-v2-surface-800 transition disabled:opacity-50"
                              >
                                {logoUploading ? "..." : reportSettings.logoUrl ? "Replace" : "Upload"}
                              </button>
                              {reportSettings.logoUrl && (
                                <button
                                  type="button"
                                  onClick={handleLogoRemove}
                                  disabled={logoUploading}
                                  className="text-v2-xs uppercase tracking-[0.18em] font-semibold text-v2-danger-300 px-2 py-1 rounded-v2-sm hover:bg-v2-danger-600/10 transition disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <span className="text-[10px] normal-case tracking-normal text-v2-ink-500 font-normal">PNG/JPG, under 2 MB.</span>
                          </div>
                        </div>

                        <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                          Footer Note
                          <textarea
                            className={`${settingsFieldClass} min-h-20 resize-none`}
                            rows={3}
                            value={reportSettings.footerNote}
                            onChange={(event) =>
                              updateReportSettingsDraft({ footerNote: event.target.value })
                            }
                            placeholder="Prepared by PL Strength."
                          />
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            Default Range
                            <select
                              className={settingsFieldClass}
                              value={reportSettings.defaultRangePreset}
                              onChange={(event) =>
                                updateReportSettingsDraft({
                                  defaultRangePreset: event.target.value as ReportRangePreset,
                                })
                              }
                            >
                              <option value="last30">Last 30 Days</option>
                              <option value="last60">Last 60 Days</option>
                              <option value="season">Season</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">
                            PDF Size
                            <select
                              className={settingsFieldClass}
                              value={reportSettings.pageSize}
                              onChange={(event) =>
                                updateReportSettingsDraft({
                                  pageSize: event.target.value as ReportPageSize,
                                })
                              }
                            >
                              <option value="letter">Letter</option>
                              <option value="a4">A4</option>
                            </select>
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 border-t border-v2-surface-800 pt-3">
                          {reportSettingsMessage && (
                            <span className="text-sm text-v2-ink-300">{reportSettingsMessage}</span>
                          )}
                          <div className="flex-1" />
                          <button
                            type="button"
                            onClick={() => {
                              setReportSettings(defaultReportSettings(reportSettingsTeam));
                              setReportSettingsDirty(true);
                              setReportSettingsMessage("");
                            }}
                            className="text-v2-xs uppercase tracking-[0.18em] text-v2-ink-500 transition hover:text-v2-ink-200"
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            onClick={persistReportSettingsChanges}
                            disabled={!reportSettingsDirty || reportSettingsSaving}
                            className="min-h-touch rounded-v2-sm bg-v2-accent-700 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-50 transition hover:bg-v2-accent-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                          >
                            {reportSettingsSaving ? "Saving..." : "Save Reports"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : settingsTab === "equipment" ? (
                  <div className="space-y-6">
                    {/* Unit Toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-400">Units</span>
                      <div className="inline-flex rounded-v2-sm border border-v2-surface-700 overflow-hidden">
                        <button
                          type="button"
                          className={`min-h-touch px-4 py-1.5 text-v2-xs font-semibold uppercase tracking-[0.18em] transition ${
                            equipmentUnit === "lb"
                              ? "bg-v2-accent-700 text-v2-ink-50"
                              : "bg-v2-surface-900 text-v2-ink-400 hover:bg-v2-surface-800"
                          }`}
                          onClick={() => setEquipmentUnit("lb")}
                        >
                          lb
                        </button>
                        <button
                          type="button"
                          className={`min-h-touch px-4 py-1.5 text-v2-xs font-semibold uppercase tracking-[0.18em] transition ${
                            equipmentUnit === "kg"
                              ? "bg-v2-accent-700 text-v2-ink-50"
                              : "bg-v2-surface-900 text-v2-ink-400 hover:bg-v2-surface-800"
                          }`}
                          onClick={() => setEquipmentUnit("kg")}
                        >
                          kg
                        </button>
                      </div>
                    </div>

                    {/* Plates Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                        <span className={`h-px w-5 ${accentBarBgClass}`} aria-hidden="true" />
                        Plates ({equipmentUnit})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(equipment.plates[equipmentUnit] ?? []).map((w, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full border border-v2-surface-700 bg-v2-surface-900 px-3 py-1 text-sm font-medium text-v2-ink-200"
                          >
                            {formatNumber(w)}
                            <button
                              type="button"
                              onClick={() => handleRemovePlate(w)}
                              className="ml-1 text-v2-ink-500 hover:text-v2-danger-400"
                              aria-label={`Remove ${formatNumber(w)} ${equipmentUnit} plate`}
                            >
                              <IconClose className="w-3 h-3" />
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
                          className="field-v2 flex-1 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        />
                        <button
                          type="button"
                          onClick={handleAddPlate}
                          className="min-h-touch rounded-v2-sm bg-v2-accent-700 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-50 hover:bg-v2-accent-600 transition focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Bars Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-500">
                        <span className={`h-px w-5 ${accentBarBgClass}`} aria-hidden="true" />
                        Bars ({equipmentUnit})
                      </div>
                      <div className="space-y-2">
                        {(equipment.bars[equipmentUnit] ?? []).map((bar) => (
                          <div
                            key={bar.id}
                            className={`flex items-center justify-between rounded-v2-sm border p-3 transition cursor-pointer ${
                              equipment.activeBarId[equipmentUnit] === bar.id
                                ? "border-v2-accent-600 bg-v2-accent-900/30"
                                : "border-v2-surface-800 hover:border-v2-surface-700"
                            }`}
                            onClick={() => handleSelectBar(bar.id)}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                  equipment.activeBarId[equipmentUnit] === bar.id
                                    ? "border-v2-accent-500"
                                    : "border-v2-surface-600"
                                }`}
                              >
                                {equipment.activeBarId[equipmentUnit] === bar.id && (
                                  <div className="w-2 h-2 rounded-full bg-v2-accent-500" />
                                )}
                              </div>
                              <span className="font-medium text-v2-ink-100">{bar.label}</span>
                              <span className="text-sm text-v2-ink-400">
                                {formatNumber(bar.weight)} {equipmentUnit}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveBar(bar.id);
                              }}
                              className="text-v2-ink-500 hover:text-v2-danger-400 transition"
                              aria-label={`Remove ${bar.label} bar`}
                            >
                              <IconClose className="w-4 h-4" />
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
                          className="field-v2 flex-1 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        />
                        <input
                          type="number"
                          value={newBarWeight}
                          onChange={(e) => setNewBarWeight(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddBar()}
                          placeholder={`Weight (${equipmentUnit})`}
                          className="field-v2 w-24 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-100 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        />
                        <button
                          type="button"
                          onClick={handleAddBar}
                          className="min-h-touch rounded-v2-sm bg-v2-accent-700 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-50 hover:bg-v2-accent-600 transition focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3 pt-2 border-t border-v2-surface-800">
                      <button
                        type="button"
                        onClick={handleResetEquipment}
                        className="text-v2-xs uppercase tracking-[0.18em] text-v2-ink-500 hover:text-v2-ink-200 transition"
                      >
                        Reset to Defaults
                      </button>
                      <div className="flex-1" />
                      {equipmentDirty && (
                        <button
                          type="button"
                          onClick={persistEquipmentChanges}
                          disabled={equipmentSaving}
                          className="min-h-touch rounded-v2-sm bg-v2-accent-700 px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-50 hover:bg-v2-accent-600 disabled:opacity-50 transition focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
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

  const deleteQuoteTarget = deleteQuoteConfirm
    ? customQuotes.find((q) => q.id === deleteQuoteConfirm)
    : null;

  // Icon button base
  const iconBtn =
    "inline-flex h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 text-v2-ink-200 transition hover:border-v2-surface-700 hover:bg-v2-surface-800 hover:text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950";

  return (
    <>
    <ConfirmModal
      isOpen={deleteQuoteConfirm !== null}
      title="Delete Quote"
      message={deleteQuoteTarget ? `Delete "${deleteQuoteTarget.text.slice(0, 80)}${deleteQuoteTarget.text.length > 80 ? "..." : ""}"?` : "Delete this quote?"}
      confirmLabel="Delete"
      onConfirm={() => deleteQuoteConfirm && doDeleteQuote(deleteQuoteConfirm)}
      onCancel={() => setDeleteQuoteConfirm(null)}
      variant="danger"
    />
    <header className="relative z-50 border-b border-v2-surface-800 bg-v2-surface-950">
      <div className="container flex items-center gap-3 py-3 md:h-16 md:py-0">
        <Link
          to="/"
          className="flex items-center gap-3 text-v2-ink-50 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 rounded-v2-sm"
        >
          <img src="/assets/dragon.png" alt="Dragon" className="h-8 w-8 object-contain" />
          <span className="flex items-center gap-2">
            <span className="h-5 w-0.5 bg-v2-accent-600" aria-hidden="true" />
            <span className="font-v2-heading uppercase tracking-tight text-xl font-bold">PL Strength</span>
          </span>
        </Link>
        {!isMobile && <span className="ml-2">{renderStatusIndicator()}</span>}
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {isMobile ? (
            <>
              {friendlyName && (
                <span className="hidden sm:inline-flex items-center rounded-full border border-v2-surface-800 bg-v2-surface-900 px-2 py-0.5 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200">
                  {friendlyName}
                </span>
              )}
              <button
                type="button"
                className={iconBtn}
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                aria-label="Sign Out"
              >
                <span className="sr-only">Sign Out</span>
                <IconSignOut />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen((prev) => !prev);
                }}
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
                aria-label="Open Settings"
              >
                <span className="sr-only">Open Settings</span>
                <IconGear />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => {
                  setSettingsOpen(false);
                  setMenuOpen((prev) => !prev);
                }}
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
                aria-label="Toggle Navigation"
              >
                <span className="sr-only">Toggle Navigation</span>
                {menuOpen ? <IconClose /> : <IconMenu />}
              </button>
            </>
          ) : (
            <nav className="flex items-center gap-4 md:gap-5">
              {links.map(({ to, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => navLinkClass(isActive)}>
                  {label}
                </NavLink>
              ))}
              <button
                className="min-h-touch inline-flex items-center gap-2 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-3 py-1.5 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-300 transition hover:border-v2-danger-600 hover:text-v2-danger-300 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                type="button"
                onClick={() => signOut()}
                aria-label="Sign Out"
              >
                <IconSignOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => setSettingsOpen((prev) => !prev)}
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
                aria-label="Open Settings"
              >
                <span className="sr-only">Open Settings</span>
                <IconGear />
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
            <div className="space-y-4 rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 p-3 shadow-v2-elev-2">
              {/* Quick actions row with Gear and Calculator */}
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
                    className="flex items-center gap-2 min-h-touch rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-3 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200 hover:border-v2-surface-700 hover:text-v2-ink-50 transition focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                    aria-label="Open Equipment Settings"
                  >
                    <IconBarbell className="w-4 h-4" />
                    <span>Gear</span>
                  </button>
                  <NavLink
                    to="/calculator"
                    onClick={closeMenu}
                    className="flex items-center gap-2 min-h-touch rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-3 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200 hover:border-v2-surface-700 hover:text-v2-ink-50 transition focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
                    aria-label="Calculator"
                  >
                    <IconCalc className="w-4 h-4" />
                    <span>Calc</span>
                  </NavLink>
                </div>
              </div>
              {renderTeamPicker("mobile")}
              <nav className="space-y-1">
                {mobileLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => {
                      const classes = navLinkClass(isActive);
                      return classes;
                    }}
                    onClick={closeMenu}
                  >
                    <span className="flex items-center gap-3 w-full">
                      <span className={`h-px w-5 ${accentBarBgClass}`} aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                    </span>
                  </NavLink>
                ))}
                {admin && (
                  <span className="flex items-center gap-2 rounded-v2-sm bg-v2-warn-600 px-4 py-2 text-base font-semibold uppercase tracking-[0.18em] text-v2-ink-950">
                    Admin Mode
                  </span>
                )}
                {coach && !admin && (
                  <span className="flex items-center gap-2 rounded-v2-sm bg-v2-info-700 px-4 py-2 text-base font-semibold uppercase tracking-[0.18em] text-v2-ink-50">
                    Coach Mode
                  </span>
                )}
              </nav>
              <div className="flex flex-col gap-2 border-t border-v2-surface-800 pt-3">
                {friendlyName && (
                  <span className="inline-flex self-start items-center rounded-full border border-v2-surface-800 bg-v2-surface-900 px-2.5 py-0.5 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200">
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
    </>
  );
}
