import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const sizeStyles = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-3",
};

const sizeLabels = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function LoadingSpinner({
  size = "md",
  label,
  className,
}: LoadingSpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn(
          "animate-spin rounded-full border-primary border-t-transparent",
          sizeStyles[size]
        )}
        role="status"
        aria-label={label || "Loading"}
      />
      {label && (
        <span className={cn("text-muted-foreground", sizeLabels[size])}>
          {label}
        </span>
      )}
    </div>
  );
}
