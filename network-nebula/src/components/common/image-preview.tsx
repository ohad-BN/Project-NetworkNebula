import { useState } from "react";
import { Download, X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  onDownload?: () => void;
  className?: string;
}

export function ImagePreview({ src, alt = "Preview", onDownload, className }: ImagePreviewProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      const link = document.createElement("a");
      link.href = src;
      link.download = alt.replace(/\s+/g, "_") || "download";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <>
      <div className={cn("relative group", className)}>
        <img
          src={src}
          alt={alt}
          className="w-full h-auto rounded-lg object-contain bg-muted cursor-pointer transition-opacity hover:opacity-90"
          onClick={() => setIsLightboxOpen(true)}
        />
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-lg">
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(true);
            }}
          >
            <ZoomIn className="h-4 w-4 mr-1" />
            Zoom
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
        </div>
      </div>

      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setIsLightboxOpen(false)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:bg-white/20"
            onClick={() => setIsLightboxOpen(false)}
          >
            <X className="h-6 w-6" />
          </Button>
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 flex gap-2">
            <Button variant="secondary" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
