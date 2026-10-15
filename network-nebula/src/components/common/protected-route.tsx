import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import type { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: ("creator" | "worker")[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const userRole = user?.role || ((user as { is_worker?: boolean } | null)?.is_worker ? "worker" : "creator");
  if (allowedRoles && user && !allowedRoles.includes(userRole as "creator" | "worker")) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
