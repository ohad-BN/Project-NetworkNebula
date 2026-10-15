import { cn } from "@/lib/utils";

type StatusVariant = "success" | "warning" | "error" | "info" | "neutral";

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  size?: "sm" | "md";
  className?: string;
}

const statusVariantMap: Record<string, StatusVariant> = {
  // Task statuses
  queued: "info",
  pending: "info",
  processing: "warning",
  running: "warning",
  completed: "success",
  success: "success",
  failed: "error",
  error: "error",
  // Worker statuses
  online: "success",
  offline: "neutral",
  busy: "warning",
  idle: "neutral",
};

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-muted text-muted-foreground border-muted",
};

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export function StatusBadge({
  status,
  variant,
  size = "md",
  className,
}: StatusBadgeProps) {
  const resolvedVariant = variant ?? statusVariantMap[status.toLowerCase()] ?? "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium capitalize",
        variantStyles[resolvedVariant],
        sizeStyles[size],
        className
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}
