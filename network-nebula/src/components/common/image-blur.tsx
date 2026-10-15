import { useState } from "react";
import { cn } from "@/lib/utils";

interface ImageBlurProps {
  src?: string;
  alt: string;
  className?: string;
  blurClassName?: string;
}

export function ImageBlur({ src, alt, className, blurClassName }: ImageBlurProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-0 bg-muted transition-opacity duration-300",
          isLoaded ? "opacity-0" : "opacity-100",
          blurClassName
        )}
      />
      {src && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setIsLoaded(true)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
