import { apiClient } from "./client";

export interface ShardedModelSpec {
  model_id: string;
  name: string;
  total_layers: number;
  hidden_size: number;
  num_heads: number;
  num_kv_heads: number;
  vocab_size: number;
  total_params_b: number;
  default_quantization: string;
  vram_gb: {
    fp16: number;
    "8bit": number;
    "4bit": number;
  };
}

export interface FailoverRecord {
  stage_idx: number;
  old_primary: string | null;
  new_primary: string;
  timestamp: number;
  iso_time?: string;
  reason: string;
  session_id?: string | null;
  remaining_standbys: number;
}

export interface PipelineStageInfo {
  stage_idx: number;
  start_layer: number;
  end_layer: number;
  layer_count: number;
  estimated_vram_gb: number;
  has_embeddings: boolean;
  has_lm_head: boolean;
  primary_worker_id: string | null;
  standby_worker_ids: string[];
  offline_worker_ids: string[];
  failover_history: FailoverRecord[];
  status: string;
  is_covered: boolean;
  redundancy_count: number;
}

export interface SwarmPipelineInfo {
  pipeline_id: string;
  name: string;
  model_id: string;
  total_layers: number;
  quantization: string;
  num_stages: number;
  status: string;
  is_complete: boolean;
  health_score: number;
  redundancy_level: "optimal" | "degraded" | "none";
  stages_with_standby: number;
  total_standbys: number;
  total_failovers: number;
  total_vram_budget_gb: number;
  created_at: string;
  updated_at: string;
  stages: PipelineStageInfo[];
}

export interface RouteHopInfo {
  hop_idx: number;
  stage_idx: number;
  start_layer: number;
  end_layer: number;
  worker_id: string;
  standby_worker_ids: string[];
  role: string;
  estimated_hop_latency_ms: number;
}

export interface FaultToleranceReport {
  pipeline_id: string;
  model_id: string;
  name: string;
  redundancy_level: "optimal" | "degraded" | "none";
  stages_with_standby: number;
  total_stages: number;
  total_standbys: number;
  total_failovers: number;
  health_score: number;
  status: string;
  stage_breakdown: {
    stage_idx: number;
    start_layer: number;
    end_layer: number;
    primary_worker_id: string | null;
    standby_worker_ids: string[];
    offline_worker_ids: string[];
    has_standby: boolean;
    failover_count: number;
    last_failover: FailoverRecord | null;
  }[];
}

export interface KVCacheTelemetry {
  active_sessions: number;
  total_memory_mb: number;
  max_memory_mb: number;
  memory_utilization_pct: number;
  total_tokens_cached: number;
  total_hits: number;
  total_misses: number;
  cache_hit_rate_pct: number;
  eviction_count: number;
  ttl_seconds: number;
}

export interface GenerationStepChunk {
  token: string;
  token_id: number;
  step: number;
  session_id: string;
  pipeline_id: string;
  latency_ms: number;
  is_decode: boolean;
  hops: number;
  wire_bytes: number;
  failovers?: FailoverRecord[];
}

export interface SwarmGenerationResult {
  completion: string;
  tokens_generated: number;
  session_id: string;
  pipeline_id: string;
  total_latency_ms: number;
  avg_decode_latency_ms: number;
  total_wire_bytes: number;
  total_failovers_handled?: number;
  failover_records?: FailoverRecord[];
  steps: GenerationStepChunk[];
}

export const swarmService = {
  getSupportedModels: async (): Promise<{ status: string; models: ShardedModelSpec[] }> => {
    const res = await apiClient.get("/api/v1/swarm/models/supported");
    return res.data;
  },

  listPipelines: async (): Promise<{ status: string; total: number; pipelines: SwarmPipelineInfo[] }> => {
    const res = await apiClient.get("/api/v1/swarm/pipelines");
    return res.data;
  },

  getPipeline: async (pipelineId: string): Promise<{ status: string; pipeline: SwarmPipelineInfo }> => {
    const res = await apiClient.get(`/api/v1/swarm/pipelines/${pipelineId}`);
    return res.data;
  },

  createPipeline: async (payload: {
    model_id: string;
    num_stages: number;
    quantization?: string;
    worker_ids?: string[];
    standby_worker_ids?: string[];
    name?: string;
  }): Promise<{ status: string; pipeline: SwarmPipelineInfo }> => {
    const res = await apiClient.post("/api/v1/swarm/pipelines", payload);
    return res.data;
  },

  deletePipeline: async (pipelineId: string): Promise<{ status: string; deleted: boolean }> => {
    const res = await apiClient.delete(`/api/v1/swarm/pipelines/${pipelineId}`);
    return res.data;
  },

  getPipelineRoute: async (pipelineId: string): Promise<{ status: string; pipeline_id: string; route_hops: RouteHopInfo[] }> => {
    const res = await apiClient.get(`/api/v1/swarm/pipelines/${pipelineId}/route`);
    return res.data;
  },

  getFaultTolerance: async (pipelineId: string): Promise<{ status: string; pipeline_id: string; fault_tolerance: FaultToleranceReport }> => {
    const res = await apiClient.get(`/api/v1/swarm/pipelines/${pipelineId}/fault-tolerance`);
    return res.data;
  },

  triggerFailover: async (
    pipelineId: string,
    stageIdx: number,
    reason: string = "manual_studio_trigger",
    sessionId?: string
  ): Promise<{ status: string; failover: FailoverRecord }> => {
    const res = await apiClient.post(`/api/v1/swarm/pipelines/${pipelineId}/stages/${stageIdx}/failover`, {
      reason,
      session_id: sessionId,
    });
    return res.data;
  },

  getKVCacheStats: async (): Promise<{ status: string; telemetry: KVCacheTelemetry }> => {
    const res = await apiClient.get("/api/v1/swarm/kv-cache/stats");
    return res.data;
  },

  simulateDropout: async (
    pipelineId: string,
    payload: {
      prompt?: string;
      max_tokens?: number;
      drop_stage_idx: number;
      drop_at_step: number;
    }
  ): Promise<{ status: string; simulation: SwarmGenerationResult }> => {
    const res = await apiClient.post(`/api/v1/swarm/pipelines/${pipelineId}/simulate-dropout`, payload);
    return res.data;
  },

  generateSwarm: async (
    pipelineId: string,
    payload: {
      prompt?: string;
      max_tokens?: number;
      temperature?: number;
      session_id?: string;
    }
  ): Promise<{ status: string; generation: SwarmGenerationResult }> => {
    const res = await apiClient.post(`/api/v1/swarm/pipelines/${pipelineId}/generate`, payload);
    return res.data;
  },

  computePartitionPlan: async (payload: {
    model_id: string;
    num_stages: number;
    quantization?: string;
  }): Promise<{ status: string; stages: any[]; total_vram_budget_gb: number }> => {
    const res = await apiClient.post("/api/v1/swarm/partition-plan", payload);
    return res.data;
  },
};
