import { Routes, Route, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/layout/navbar";
import { useAuthStore } from "@/stores/auth-store";
import { ProtectedRoute } from "@/components/common/protected-route";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { CreateJobPage } from "@/pages/create-job";
import { JobStatusPage } from "@/pages/job-status";
import { JobHistoryPage } from "@/pages/job-history";
import { RegisterWorkerPage } from "@/pages/register-worker";
import { WorkerDashboardPage } from "@/pages/worker";
import { WorkerEarningsPage } from "@/pages/worker-earnings";
import { WalletPage } from "@/pages/wallet";
import { NotFoundPage } from "@/pages/not-found";
import { TrainingStudioPage } from "@/pages/training-studio";
import { InferenceHubPage } from "@/pages/inference-hub";
import { ApiTokensPage } from "@/pages/api-tokens";
import { ClusterStatusPage } from "@/pages/cluster-status";
import { GovernancePage } from "@/pages/governance";
import { SwarmStudioPage } from "@/pages/swarm-studio";
import { MoeStudioPage } from "@/pages/moe-studio";
import type { ReactNode } from "react";

function ProtectedRouteWrapper({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: ("creator" | "worker")[];
}) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles}>{children}</ProtectedRoute>
  );
}

function App() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar user={user} onLogout={handleLogout} />
      <main>
        <Routes>
          {/* Public SaaS & Auth Routes */}
          <Route
            path="/"
            element={
              isAuthenticated ? (
                user?.role === "worker" ? <WorkerDashboardPage /> : <TrainingStudioPage />
              ) : (
                <HomePage />
              )
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/worker" element={<RegisterWorkerPage />} />

          {/* Protected Studio & Developer Console Routes */}
          <Route
            path="/training"
            element={
              <ProtectedRouteWrapper>
                <TrainingStudioPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/inference"
            element={
              <ProtectedRouteWrapper>
                <InferenceHubPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/swarm"
            element={
              <ProtectedRouteWrapper>
                <SwarmStudioPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/moe"
            element={
              <ProtectedRouteWrapper>
                <MoeStudioPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/api-tokens"
            element={
              <ProtectedRouteWrapper>
                <ApiTokensPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/cluster"
            element={
              <ProtectedRouteWrapper>
                <ClusterStatusPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/governance"
            element={
              <ProtectedRouteWrapper>
                <GovernancePage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/create-job"
            element={
              <ProtectedRouteWrapper>
                <CreateJobPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/job-status/:taskId"
            element={
              <ProtectedRouteWrapper>
                <JobStatusPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/jobs"
            element={
              <ProtectedRouteWrapper>
                <JobHistoryPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/worker"
            element={
              <ProtectedRouteWrapper allowedRoles={["worker"]}>
                <WorkerDashboardPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/worker/earnings"
            element={
              <ProtectedRouteWrapper allowedRoles={["worker"]}>
                <WorkerEarningsPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRouteWrapper>
                <WalletPage />
              </ProtectedRouteWrapper>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}

export default App;
