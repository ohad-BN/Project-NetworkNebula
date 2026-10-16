import { apiClient } from "./client";
import type {
  WorkerRegistration,
  WorkerStats,
  HeartbeatResponse,
} from "@/types";

export interface ClusterNodeTelemetry {
  id: string;
  node_id: string;
  worker_id: string;
  user_id: string | null;
  name: string;
  gpu_model: string;
  gpu_info: string;
  vram_total_gb: number;
  gpu_memory_gb: number;
  vram_allocated_gb: number;
  vram_used_gb: number;
  vram_allocation_pct: number;
  gpu_utilization_pct: number;
  cpu_cores: number;
  memory_gb: number;
  cuda_version: string;
  role: string;
  status: "online" | "offline" | "busy" | "idle";
  is_available: boolean;
  current_task_id: string | null;
  total_tasks_completed: number;
  hourly_rate_usd: number;
  total_earnings_usd: number;
  tunnel_active: boolean;
  last_heartbeat: string;
}

export interface ClusterTelemetryResponse {
  status: string;
  active_nodes: number;
  total_vram_gb: number;
  allocated_vram_gb: number;
  used_vram_gb: number;
  avg_utilization_pct: number;
  redis_latency_ms: number;
  compute_isolation: string;
  nodes: ClusterNodeTelemetry[];
}

export interface WorkerConfigUpdateResponse {
  status: string;
  worker_id: string;
  vram_allocation_pct: number;
  vram_allocated_gb: number;
  cuda_fraction_enforced: boolean;
  tunnel_pushed: boolean;
}

export const workersService = {
  register: async (
    data: WorkerRegistration,
  ): Promise<{ worker_id: string }> => {
    const response = await apiClient.post("/workers/register", data);
    return response.data;
  },

  heartbeat: async (workerId: string): Promise<HeartbeatResponse> => {
    const response = await apiClient.post(`/workers/${workerId}/heartbeat`);
    return response.data;
  },

  stats: async (workerId: string): Promise<WorkerStats> => {
    const response = await apiClient.get(`/workers/${workerId}/stats`);
    return response.data;
  },

  getClusterTelemetry: async (): Promise<ClusterTelemetryResponse> => {
    const response = await apiClient.get("/api/v1/cluster/telemetry");
    return response.data;
  },

  updateConfig: async (
    workerId: string,
    config: {
      vram_allocation_pct?: number;
      is_available?: boolean;
      hourly_rate_usd?: number;
    }
  ): Promise<WorkerConfigUpdateResponse> => {
    const response = await apiClient.patch(
      `/api/v1/workers/${workerId}/config`,
      config
    );
    return response.data;
  },

  deregister: async (workerId: string): Promise<void> => {
    await apiClient.post(`/workers/${workerId}/deregister`);
  },
};
