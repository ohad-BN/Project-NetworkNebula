import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const typeStyles: Record<ToastType, string> = {
  success: "bg-success text-success-foreground border-success/30",
  error: "bg-destructive text-destructive-foreground border-destructive/30",
  warning: "bg-warning text-warning-foreground border-warning/30",
  info: "bg-primary text-primary-foreground border-primary/30",
};

const typeIcons: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(onDismiss, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onDismiss]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-top-2",
        typeStyles[toast.type]
      )}
    >
      <span className="font-bold">{typeIcons[toast.type]}</span>
      <p className="flex-1 text-sm">{toast.message}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: ToastType, message: string, duration?: number) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return {
    toasts,
    addToast,
    dismissToast,
    success: (msg: string, duration?: number) => addToast("success", msg, duration),
    error: (msg: string, duration?: number) => addToast("error", msg, duration),
    warning: (msg: string, duration?: number) => addToast("warning", msg, duration),
    info: (msg: string, duration?: number) => addToast("info", msg, duration),
  };
}
