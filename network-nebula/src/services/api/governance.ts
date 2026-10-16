import { apiClient } from "./client";

export interface LatencyQuantiles {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  sample_count: number;
}

export interface MetricsSummaryResponse {
  status: string;
  sla_target_uptime_pct: number;
  current_uptime_pct: number;
  uptime_seconds: number;
  fleet: {
    total_nodes: number;
    online_nodes: number;
    offline_nodes: number;
    total_vram_gb: number;
    allocated_vram_gb: number;
    avg_utilization_pct: number;
  };
  latency_quantiles_ms: LatencyQuantiles;
  throughput: {
    tokens_generated_total: number;
    tokens_per_second: number;
    inference_requests_total: number;
  };
  governance: {
    slashing_events_total: number;
    active_distributed_shards: number;
  };
  timestamp: string;
}

export interface AuditLogEntry {
  id: number;
  log_id: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  actor_id: string | null;
  target_id: string | null;
  action: string;
  details: Record<string, any>;
  ip_address: string;
  created_at: string;
}

export interface AuditLogsResponse {
  status: string;
  total_count: number;
  returned_count: number;
  limit: number;
  logs: AuditLogEntry[];
}

export interface StakingLeaderboardItem {
  worker_id: string;
  name: string;
  staked_amount_usd: number;
  slashed_amount_usd: number;
  reputation_score: number;
  status: string;
  region: string;
  tier: "High-Priority Enterprise Cluster" | "Standard Dedicated Worker" | "Unstaked Node";
}

export const governanceService = {
  getMetricsSummary: async (): Promise<MetricsSummaryResponse> => {
    const res = await apiClient.get("/api/v1/metrics/summary");
    return res.data;
  },

  getAuditLogs: async (params?: {
    event_type?: string;
    severity?: string;
    actor_id?: string;
    target_id?: string;
    limit?: number;
  }): Promise<AuditLogsResponse> => {
    const res = await apiClient.get("/api/v1/audit/logs", { params });
    return res.data;
  },

  getStakingLeaderboard: async (): Promise<{ status: string; total_staked_usd: number; leaderboard: StakingLeaderboardItem[] }> => {
    const res = await apiClient.get("/api/v1/staking/leaderboard");
    return res.data;
  },

  submitDispute: async (payload: {
    dispute_id?: string;
    challenger_id: string;
    target_worker_id: string;
    job_id?: string;
    fraud_reason: string;
  }) => {
    const auditRes = await apiClient.post("/api/v1/audit/logs", {
      event_type: "DISPUTE_SUBMITTED",
      action: `Challenged worker ${payload.target_worker_id}: ${payload.fraud_reason}`,
      severity: "warning",
      actor_id: payload.challenger_id,
      target_id: payload.target_worker_id,
      details: {
        job_id: payload.job_id,
        fraud_reason: payload.fraud_reason,
      },
    });
    return {
      status: "disputed",
      dispute_id: auditRes.data?.log?.log_id || `disp-${Date.now()}`,
      penalty_action: "Under Active Spot-Check Review",
      message: "Fraud challenge registered and logged to governance trail",
    };
  },
};
