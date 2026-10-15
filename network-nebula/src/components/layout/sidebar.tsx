import { Link, useLocation } from "react-router-dom";
import {
  Home,
  Briefcase,
  Users,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  user?: {
    role: "creator" | "worker";
  } | null;
  isCollapsed?: boolean;
  onToggle?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  workerOnly?: boolean;
  creatorOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/workers", label: "Workers", icon: Users, creatorOnly: true },
  { href: "/worker", label: "Worker Dashboard", icon: Users, workerOnly: true },
  { href: "/worker/earnings", label: "Earnings", icon: Wallet, workerOnly: true },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ user, isCollapsed = false, onToggle }: SidebarProps) {
  const location = useLocation();

  const filteredItems = navItems.filter((item) => {
    if (item.workerOnly && user?.role !== "worker") return false;
    if (item.creatorOnly && user?.role !== "creator") return false;
    return true;
  });

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "sticky top-16 flex h-[calc(100vh-4rem)] flex-col border-r border-border bg-background transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-end p-2 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-8 w-8"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "border-l-2 border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    isCollapsed && "justify-center px-2"
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  {!isCollapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!isCollapsed && (
        <div className="border-t border-border p-4">
          <p className="text-xs text-muted-foreground text-center">
            Network Nebula v1.0
          </p>
        </div>
      )}
    </aside>
  );
}
