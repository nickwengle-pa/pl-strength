import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export type FirebaseHandles = {
  app: ReturnType<typeof initializeApp>;
  auth: ReturnType<typeof getAuth>;
  db: ReturnType<typeof getFirestore>;
  storage: ReturnType<typeof getStorage>;
};

let cached: FirebaseHandles | null = null;

const resolveConfig = (): Record<string, any> | null => {
  const globalConfig =
    typeof window !== "undefined" ? (window as any).__FBCONFIG__ : undefined;
  if (globalConfig?.apiKey) return globalConfig;

  const env: Record<string, any> | undefined = (import.meta as any)?.env;
  if (env?.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
    };
  }

  const globalThisConfig =
    typeof globalThis !== "undefined"
      ? (globalThis as any).__FBCONFIG__
      : undefined;
  if (globalThisConfig?.apiKey) return globalThisConfig;

  return null;
};

export function tryInitFirebase(): FirebaseHandles | null {
  if (cached) return cached;
  const cfg = resolveConfig();
  if (!cfg?.apiKey || !cfg.projectId) return null;
  try {
    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp(cfg);
    cached = {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
      storage: getStorage(app),
    };
    return cached;
  } catch (err) {
    console.warn("Firebase init failed", err);
    return null;
  }
}

export function resetFirebaseCache() {
  cached = null;
}
