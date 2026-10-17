import { Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/layout/navbar";
import { useAuthStore } from "@/stores/auth-store";
import { ProtectedRoute } from "@/components/common/protected-route";
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
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="min-h-screen bg-background">
      <Navbar user={user} onLogout={logout} />
      <main>
        <Routes>
          <Route path="/" element={<TrainingStudioPage />} />
          <Route path="/training" element={<TrainingStudioPage />} />
          <Route path="/inference" element={<InferenceHubPage />} />
          <Route path="/api-tokens" element={<ApiTokensPage />} />
          <Route path="/cluster" element={<ClusterStatusPage />} />
          <Route path="/governance" element={<GovernancePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/worker" element={<RegisterWorkerPage />} />
          <Route path="/create-job" element={<CreateJobPage />} />
          <Route path="/job-status/:taskId" element={<JobStatusPage />} />
          <Route path="/jobs" element={<JobHistoryPage />} />
          <Route path="/worker" element={<WorkerDashboardPage />} />
          <Route path="/worker/earnings" element={<WorkerEarningsPage />} />
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
