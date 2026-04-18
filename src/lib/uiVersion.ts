const STORAGE_KEY = "pl.ui.version";

type UiVersion = "v1" | "v2";

function resolve(): UiVersion {
  if (typeof window === "undefined") return "v1";

  const url = new URL(window.location.href);
  const param = url.searchParams.get("ui");

  if (param === "v2") {
    try { window.localStorage.setItem(STORAGE_KEY, "v2"); } catch {}
    return "v2";
  }
  if (param === "v1") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
    return "v1";
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) === "v2" ? "v2" : "v1";
  } catch {
    return "v1";
  }
}

export const UI_VERSION: UiVersion = resolve();
export const isV2 = (): boolean => UI_VERSION === "v2";
