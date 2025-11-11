import React from "react";

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "warning" | "info";
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "danger",
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      header: "bg-red-50 border-red-200",
      headerText: "text-red-900",
      confirmBtn: "bg-red-600 hover:bg-red-700 text-white",
    },
    warning: {
      header: "bg-amber-50 border-amber-200",
      headerText: "text-amber-900",
      confirmBtn: "bg-amber-600 hover:bg-amber-700 text-white",
    },
    info: {
      header: "bg-blue-50 border-blue-200",
      headerText: "text-blue-900",
      confirmBtn: "bg-blue-600 hover:bg-blue-700 text-white",
    },
  };

  const styles = variantStyles[variant];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div 
        className="card max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`rounded-t-2xl border-b-2 px-6 py-4 -mx-6 -mt-6 mb-4 ${styles.header}`}>
          <h2 className={`text-lg font-bold ${styles.headerText}`}>{title}</h2>
        </div>
        
        <p className="text-gray-700 mb-6">{message}</p>
        
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-100 font-semibold transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onCancel();
            }}
            className={`px-4 py-2 rounded-xl font-semibold transition ${styles.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
