const STORAGE_KEY = "pl.ui.version";

type UiVersion = "v1" | "v2";

/**
 * EMERGENCY KILLSWITCH — set to "v1" to force every user back to v1
 * regardless of URL params, localStorage, or the default below.
 *
 * Intended use: after flipping the default to v2, if production breaks,
 * change `KILLSWITCH` to "v1", bump APP_VERSION (src/App.tsx) and
 * CACHE_NAME (public/sw.js), and deploy. Every user lands on v1 on
 * their next page load — including testers whose localStorage is
 * already pinned to "v2".
 *
 * Set back to `null` to restore normal flag-driven behavior.
 */
const KILLSWITCH: UiVersion | null = null;

/**
 * The default UI version when no URL param or localStorage opt-in is
 * present. Flip from "v1" to "v2" to make v2 the default.
 */
const DEFAULT_VERSION: UiVersion = "v1";

function resolve(): UiVersion {
  // Killswitch wins over everything — URL, localStorage, default.
  if (KILLSWITCH !== null) return KILLSWITCH;

  if (typeof window === "undefined") return DEFAULT_VERSION;

  const url = new URL(window.location.href);
  const param = url.searchParams.get("ui");

  if (param === "v2") {
    try { window.localStorage.setItem(STORAGE_KEY, "v2"); } catch {}
    return "v2";
  }
  if (param === "v1") {
    try { window.localStorage.setItem(STORAGE_KEY, "v1"); } catch {}
    return "v1";
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "v2") return "v2";
    if (stored === "v1") return "v1";
    return DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

export const UI_VERSION: UiVersion = resolve();
export const isV2 = (): boolean => UI_VERSION === "v2";
