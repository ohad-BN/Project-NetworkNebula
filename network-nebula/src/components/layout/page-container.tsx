import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageContainerProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageContainer({
  title,
  description,
  children,
  actions,
  className,
}: PageContainerProps) {
  return (
    <div className={cn("container mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8", className)}>
      {/* Page Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Page Content */}
      <div className="min-h-[calc(100vh-12rem)]">{children}</div>
    </div>
  );
}
