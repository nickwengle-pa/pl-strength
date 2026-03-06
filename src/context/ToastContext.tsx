import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

type ToastType = "success" | "error" | "info" | "warning";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

const AUTO_DISMISS_MS: Record<ToastType, number | null> = {
  success: 3000,
  info: 3500,
  warning: 5000,
  error: null, // errors stay until dismissed
};

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

const STYLES: Record<ToastType, string> = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  warning: "bg-amber-500 text-white",
  info: "bg-indigo-600 text-white",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      const delay = AUTO_DISMISS_MS[type];
      if (delay !== null) {
        setTimeout(() => dismiss(id), delay);
      }
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-2xl px-4 py-3 shadow-xl pointer-events-auto text-sm font-medium ${STYLES[toast.type]}`}
            >
              <span className="mt-px font-bold shrink-0">{ICONS[toast.type]}</span>
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 opacity-70 hover:opacity-100 transition-opacity text-base leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.showToast;
}
