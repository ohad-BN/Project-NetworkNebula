import { apiClient } from "./client";
import type {
  WorkerRegistration,
  WorkerStats,
  HeartbeatResponse,
} from "@/types";

export interface GpuCardTelemetry {
  index: number;
  name: string;
  vram_total_gb: number;
  vram_allocated_gb: number;
  vram_used_gb: number;
  vram_allocation_pct: number;
  gpu_utilization_pct: number;
  status?: string;
  is_available?: boolean;
}

export interface ClusterNodeTelemetry {
  id: string;
  node_id: string;
  worker_id: string;
  user_id: string | null;
  name: string;
  system_name?: string;
  gpu_model: string;
  gpu_info: string;
  gpu_count?: number;
  gpus?: GpuCardTelemetry[];
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
  staked_amount_usd?: number;
  slashed_amount_usd?: number;
  reputation_score?: number;
  min_stake_required?: number;
  region?: string;
  latency_ping_ms?: number;
  is_always_silent?: boolean;
  work_capacity_state?: "unleashed" | "stealth_regulated" | "restricted_pause" | string;
  input_idle_sec?: number;
  gpu_temp_c?: number;
  duty_cycle_pct?: number;
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

export interface StakingInfoResponse {
  status: string;
  worker_id: string;
  staked_amount_usd: number;
  slashed_amount_usd: number;
  reputation_score: number;
  min_stake_required: number;
  is_qualified_for_training: boolean;
  slash_history: Array<{
    type: string;
    penalty_pct: number;
    amount_slashed: number;
    reason: string;
    timestamp: string;
  }>;
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

  getClusterTelemetry: async (scope?: string): Promise<ClusterTelemetryResponse> => {
    const response = await apiClient.get("/api/v1/cluster/telemetry", {
      params: scope ? { scope } : {},
    });
    return response.data;
  },

  getUserWorkers: async (): Promise<{
    status: string;
    total_nodes: number;
    active_nodes: number;
    total_vram_gb: number;
    allocated_vram_gb: number;
    used_vram_gb: number;
    total_earnings_usd: number;
    nodes: ClusterNodeTelemetry[];
  }> => {
    const response = await apiClient.get("/api/v1/user/workers");
    return response.data;
  },

  updateConfig: async (
    workerId: string,
    config: {
      vram_allocation_pct?: number;
      gpu_index?: number;
      is_available?: boolean;
      hourly_rate_usd?: number;
      is_always_silent?: boolean;
      always_silent?: boolean;
    }
  ): Promise<WorkerConfigUpdateResponse> => {
    const response = await apiClient.patch(
      `/api/v1/workers/${workerId}/config`,
      config
    );
    return response.data;
  },

  deregister: async (workerId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/workers/${encodeURIComponent(workerId)}`);
  },

  stakeCollateral: async (
    workerId: string,
    amount: number
  ): Promise<{ status: string; staked_amount_usd: number; message: string }> => {
    const response = await apiClient.post(`/api/v1/workers/${workerId}/stake`, { amount });
    return response.data;
  },

  unstakeCollateral: async (
    workerId: string,
    amount: number
  ): Promise<{ status: string; remaining_stake_usd: number; message: string }> => {
    const response = await apiClient.post(`/api/v1/workers/${workerId}/unstake`, { amount });
    return response.data;
  },

  getStakingInfo: async (workerId: string): Promise<StakingInfoResponse> => {
    const response = await apiClient.get(`/api/v1/workers/${workerId}/staking`);
    return response.data;
  },

  getSlashingHistory: async (
    workerId: string
  ): Promise<{ status: string; worker_id: string; total_slashed_usd: number; events: any[] }> => {
    const response = await apiClient.get(`/api/v1/workers/${workerId}/slashing-history`);
    return response.data;
  },
};
