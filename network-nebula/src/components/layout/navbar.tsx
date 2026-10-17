import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  X,
  User,
  Wallet,
  LogOut,
  Settings,
  ChevronDown,
  Terminal,
  Server,
  Cpu,
  Layers,
  Sparkles,
  Key,
  Clock,
  Activity,
  Coins,
  Network,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type WorkspaceMode = "developer" | "host";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const DEVELOPER_LINKS: NavItem[] = [
  { href: "/training", label: "Training Studio", icon: Cpu, badge: "LoRA" },
  { href: "/inference", label: "Model Serving", icon: Zap, badge: "OpenAI" },
  { href: "/moe", label: "MoE & Speculative", icon: Sparkles, badge: "3.8x" },
  { href: "/swarm", label: "Swarm Studio", icon: Layers, badge: "70B" },
  { href: "/api-tokens", label: "API Keys", icon: Key },
  { href: "/jobs", label: "History", icon: Clock },
];

const HOST_LINKS: NavItem[] = [
  { href: "/worker", label: "Worker Node", icon: Activity, badge: "CLI" },
  { href: "/worker/earnings", label: "Earnings & Payouts", icon: Coins, badge: "USDC" },
  { href: "/cluster", label: "GPU Fleet Mesh", icon: Network, badge: "P2P" },
  { href: "/governance", label: "Governance & SLA", icon: ShieldCheck, badge: "99.9%" },
];

interface NavbarProps {
  user?: {
    email: string;
    role: "creator" | "worker";
  } | null;
  onLogout?: () => void;
}

export function Navbar({ user, onLogout }: NavbarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Determine current active mode based on route
  const isHostPath =
    location.pathname.startsWith("/worker") ||
    location.pathname === "/cluster" ||
    location.pathname === "/governance";

  const activeMode: WorkspaceMode = isHostPath ? "host" : "developer";

  const handleSwitchMode = (mode: WorkspaceMode) => {
    if (mode === "developer" && isHostPath) {
      navigate("/training");
    } else if (mode === "host" && !isHostPath) {
      navigate("/worker");
    }
  };

  const currentLinks = activeMode === "developer" ? DEVELOPER_LINKS : HOST_LINKS;
  const isActive = (href: string) => location.pathname === href;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Left: Brand Logo & Segmented Mode Switcher */}
          <div className="flex items-center gap-4 sm:gap-6 shrink-0">
            <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                <span className="text-base font-black text-white">N</span>
              </div>
              <div className="hidden sm:block">
                <span className="font-extrabold text-sm tracking-tight text-foreground block">
                  Network Nebula
                </span>
                <span className="block text-[9px] text-muted-foreground font-mono -mt-0.5 tracking-wider uppercase">
                  Decentralized AI Cloud
                </span>
              </div>
            </Link>

            {/* Segmented Workspace Mode Switcher (Desktop) */}
            <div className="hidden lg:flex items-center p-1 rounded-xl bg-muted/60 border border-border/80 text-xs font-medium">
              <button
                type="button"
                onClick={() => handleSwitchMode("developer")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all",
                  activeMode === "developer"
                    ? "bg-background text-foreground shadow-sm font-semibold border border-indigo-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                <span>Developer Console</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode("host")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all",
                  activeMode === "host"
                    ? "bg-background text-foreground shadow-sm font-semibold border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <Server className="h-3.5 w-3.5 text-emerald-400" />
                <span>Host Provider</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
              </button>
            </div>
          </div>

          {/* Center: Contextual Nav Links based on Mode */}
          <div className="hidden md:flex items-center gap-1">
            {currentLinks.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all rounded-lg shrink-0",
                    active
                      ? "text-foreground bg-muted font-semibold shadow-sm border border-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground")} />
                  <span>{link.label}</span>
                  {link.badge && (
                    <span
                      className={cn(
                        "ml-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none",
                        activeMode === "developer"
                          ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      )}
                    >
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right Side: Quick Mode Pill for smaller screens + Wallet + User Profile */}
          <div className="hidden md:flex items-center gap-2">
            {/* Quick Mode Toggle Icon for medium screens */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSwitchMode(activeMode === "developer" ? "host" : "developer")}
              className="lg:hidden text-xs gap-1.5 h-8 border-border"
            >
              {activeMode === "developer" ? (
                <>
                  <Server className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Host View</span>
                </>
              ) : (
                <>
                  <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Dev View</span>
                </>
              )}
            </Button>

            {user ? (
              <>
                <Link to="/wallet">
                  <Button variant="ghost" size="sm" className="gap-2 h-8 text-xs font-medium">
                    <Wallet className="h-3.5 w-3.5 text-amber-400" />
                    <span>Wallet</span>
                  </Button>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs">
                      <User className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline max-w-[120px] truncate">{user.email}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 text-xs">
                    <div className="px-2 py-1.5 font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                      Signed in as
                    </div>
                    <div className="px-2 pb-1.5 text-foreground truncate font-mono text-xs">
                      {user.email}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/settings" className="cursor-pointer">
                        <Settings className="mr-2 h-3.5 w-3.5" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleSwitchMode(activeMode === "developer" ? "host" : "developer")}
                      className="cursor-pointer"
                    >
                      {activeMode === "developer" ? (
                        <>
                          <Server className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                          Switch to Host Portal
                        </>
                      ) : (
                        <>
                          <Terminal className="mr-2 h-3.5 w-3.5 text-indigo-400" />
                          Switch to Developer Console
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onLogout}
                      className="text-destructive focus:text-destructive cursor-pointer"
                    >
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm" className="h-8 text-xs">
                    Login
                  </Button>
                </Link>
                <Link to="/register">
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-sm"
                  >
                    Register
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Hamburger */}
          <div className="flex items-center md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="border-t border-border bg-background/95 backdrop-blur md:hidden max-h-[85vh] overflow-y-auto">
          {/* Mode Switcher Buttons */}
          <div className="p-3 border-b border-border/80 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={activeMode === "developer" ? "default" : "outline"}
              onClick={() => {
                handleSwitchMode("developer");
                setIsMobileMenuOpen(false);
              }}
              className={cn(
                "gap-1.5 text-xs h-9 justify-center",
                activeMode === "developer" ? "bg-indigo-600 text-white" : ""
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              Developer
            </Button>
            <Button
              size="sm"
              variant={activeMode === "host" ? "default" : "outline"}
              onClick={() => {
                handleSwitchMode("host");
                setIsMobileMenuOpen(false);
              }}
              className={cn(
                "gap-1.5 text-xs h-9 justify-center",
                activeMode === "host" ? "bg-emerald-600 text-white" : ""
              )}
            >
              <Server className="h-3.5 w-3.5" />
              Host Provider
            </Button>
          </div>

          {/* Active Navigation Category Links */}
          <div className="p-3 space-y-1">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {activeMode === "developer" ? "💻 Developer Workspaces" : "⚡ Host & Compute Nodes"}
            </div>
            {currentLinks.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-sm font-medium transition-colors rounded-lg",
                    active
                      ? "text-foreground bg-muted font-semibold"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <span>{link.label}</span>
                  </div>
                  {link.badge && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* User Account & Session Actions */}
          <div className="p-3 border-t border-border space-y-2 bg-muted/20">
            {user ? (
              <>
                <div className="px-3 py-1 text-xs text-muted-foreground">
                  Logged in as <strong className="text-foreground">{user.email}</strong>
                </div>
                <Link
                  to="/wallet"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted rounded-lg"
                >
                  <Wallet className="h-4 w-4 text-amber-400" />
                  <span>Wallet & Credits</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onLogout?.();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-destructive hover:bg-muted rounded-lg text-left"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link
                  to="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block px-3 py-2 text-sm font-medium text-center border rounded-lg hover:bg-muted"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block px-3 py-2 text-sm font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg text-center"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
