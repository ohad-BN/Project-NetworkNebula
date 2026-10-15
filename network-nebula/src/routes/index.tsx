import { createBrowserRouter } from "react-router-dom";
import type { ReactNode } from "react";
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

// Wrapper component for protected routes
function ProtectedRouteWrapper({
  children,
  allowedRoles
}: {
  children: ReactNode;
  allowedRoles?: ("creator" | "worker")[]
}) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      {children}
    </ProtectedRoute>
  );
}

// Route configuration
export const routes = [
  {
    path: "/",
    element: <TrainingStudioPage />,
  },
  {
    path: "/training",
    element: <TrainingStudioPage />,
  },
  {
    path: "/inference",
    element: <InferenceHubPage />,
  },
  {
    path: "/api-tokens",
    element: <ApiTokensPage />,
  },
  {
    path: "/cluster",
    element: <ClusterStatusPage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    path: "/register/worker",
    element: <RegisterWorkerPage />,
  },
  {
    path: "/create-job",
    element: (
      <ProtectedRouteWrapper allowedRoles={["creator"]}>
        <CreateJobPage />
      </ProtectedRouteWrapper>
    ),
  },
  {
    path: "/job-status/:taskId",
    element: <JobStatusPage />,
  },
  {
    path: "/jobs",
    element: (
      <ProtectedRouteWrapper allowedRoles={["creator"]}>
        <JobHistoryPage />
      </ProtectedRouteWrapper>
    ),
  },
  {
    path: "/worker",
    element: (
      <ProtectedRouteWrapper allowedRoles={["worker"]}>
        <WorkerDashboardPage />
      </ProtectedRouteWrapper>
    ),
  },
  {
    path: "/worker/earnings",
    element: (
      <ProtectedRouteWrapper allowedRoles={["worker"]}>
        <WorkerEarningsPage />
      </ProtectedRouteWrapper>
    ),
  },
  {
    path: "/wallet",
    element: (
      <ProtectedRouteWrapper>
        <WalletPage />
      </ProtectedRouteWrapper>
    ),
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
];

// Create the router
export const router = createBrowserRouter(routes);
