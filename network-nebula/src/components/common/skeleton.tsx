import { cn } from "@/lib/utils";

interface SkeletonProps {
  variant?: "text" | "circular" | "rectangular";
  width?: number | string;
  height?: number | string;
  className?: string;
}

const variantStyles = {
  text: "h-4 w-full rounded",
  circular: "rounded-full aspect-square",
  rectangular: "w-full h-32 rounded-lg",
};

export function Skeleton({
  variant = "text",
  width,
  height,
  className,
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-muted",
        variantStyles[variant],
        className
      )}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}
