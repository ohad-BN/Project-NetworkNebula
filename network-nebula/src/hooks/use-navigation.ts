import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

export interface UseNavigationReturn {
  creatorNavItems: NavItem[];
  workerNavItems: NavItem[];
  mobileNavItems: NavItem[];
  isActive: (href: string) => boolean;
}

export function useNavigation(): UseNavigationReturn {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const creatorNavItems: NavItem[] = useMemo(
    () => [
      { href: "/create-job", label: "Create Job" },
      { href: "/jobs", label: "My Jobs" },
      { href: "/wallet", label: "Wallet" },
    ],
    []
  );

  const workerNavItems: NavItem[] = useMemo(
    () => [
      { href: "/worker", label: "Dashboard" },
      { href: "/worker/earnings", label: "Earnings" },
      { href: "/wallet", label: "Wallet" },
    ],
    []
  );

  const mobileNavItems: NavItem[] = useMemo(() => {
    if (user?.role === "worker") {
      return [
        { href: "/", label: "Dashboard" },
        { href: "/worker", label: "Dashboard" },
        { href: "/worker/earnings", label: "Earnings" },
        { href: "/wallet", label: "Wallet" },
      ];
    }
    return [
      { href: "/", label: "Dashboard" },
      { href: "/create-job", label: "Create Job" },
      { href: "/jobs", label: "My Jobs" },
      { href: "/wallet", label: "Wallet" },
    ];
  }, [user?.role]);

  const isActive = (href: string): boolean => {
    if (href === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(href);
  };

  return {
    creatorNavItems,
    workerNavItems,
    mobileNavItems,
    isActive,
  };
}