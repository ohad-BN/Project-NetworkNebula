import { Globe, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

interface FooterProps {
  version?: string;
}

export function Footer({ version = "1.0.0" }: FooterProps) {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <Globe className="h-4 w-4" />
              GitHub
            </a>
            <Link to="/docs" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="h-4 w-4" />
              Documentation
            </Link>
            <Link to="/about" className="text-muted-foreground hover:text-foreground transition-colors">About</Link>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>v{version}</span>
            <span className="hidden md:inline">|</span>
            <span>Powered by Network Nebula</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
