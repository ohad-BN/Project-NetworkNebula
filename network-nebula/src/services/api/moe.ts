import { apiClient } from "./client";

// ==============================================================================
// Sparse Mixture-of-Experts (MoE) Interfaces
// ==============================================================================

export interface MoeModelSpec {
  model_id: string;
  name: string;
  total_experts: number;
  active_experts: number;
  num_layers: number;
  expert_size_mb: number;
  total_params_b: number;
  active_params_b: number;
  consumer_gpu_compatible: boolean;
  recommended_pairing: number[][];
  quantization_support: string[];
}

export interface WorkerPairAssignment {
  worker_id: string;
  expert_pair: [number, number];
  vram_gb: number;
  status: string;
  assigned_at: string;
}

export interface MoePipelineInfo {
  pipeline_id: string;
  name: string;
  model_id: string;
  total_experts: number;
  active_experts: number;
  quantization: string;
  worker_assignments: Record<string, WorkerPairAssignment>;
  coverage_pct: number;
  is_ready: boolean;
  status: string;
  created_at: string;
}

export interface GatingDispatchResult {
  token_idx: number;
  token_id: number;
  active_experts: number[];
  weights: number[];
  worker_dispatches: {
    expert_id: number;
    worker_id: string;
    weight: number;
  }[];
}

export interface TokenRouteResponse {
  pipeline_id: string;
  total_tokens: number;
  top_k: number;
  diversity_score: number;
  entropy: number;
  dispatches: GatingDispatchResult[];
}

export interface MoeTelemetry {
  pipeline_id: string;
  total_tokens_routed: number;
  expert_hit_counts: Record<string, number>;
  worker_load_distribution: Record<string, number>;
  expert_entropy: number;
  average_dispatch_latency_ms: number;
}

// ==============================================================================
// Decentralized Speculative Decoding (DSD) Interfaces
// ==============================================================================

export interface DraftToken {
  token_id: number;
  token_text: string;
  probability: number;
}

export interface DraftResponse {
  draft_tokens: DraftToken[];
  window_size: number;
  draft_model: string;
  latency_ms: number;
}

export interface VerificationStep {
  step: number;
  draft_token: DraftToken;
  target_prob: number;
  accepted: boolean;
  token_accepted: {
    token_id: number;
    token_text: string;
  };
  bonus_token?: {
    token_id: number;
    token_text: string;
  } | null;
}

export interface SpeculativeVerifyResponse {
  total_draft_tokens: number;
  accepted_tokens_count: number;
  bonus_token: any | null;
  acceptance_rate: number;
  verification_steps: VerificationStep[];
  target_latency_ms: number;
}

export interface SpeculativeGenerationResult {
  status: string;
  prompt: string;
  completion_text: string;
  tokens_generated: number;
  target_forward_passes: number;
  draft_tokens_evaluated: number;
  tokens_accepted: number;
  bonus_tokens_awarded: number;
  effective_speedup_factor: number;
  wan_round_trips_saved: number;
  savings_pct: number;
  acceptance_rate_pct: number;
  telemetry_history: any[];
}

export interface SpeculativeStats {
  status: string;
  draft_model: string;
  target_model: string;
  draft_window_k: number;
  total_runs: number;
  avg_speedup: number;
  avg_acceptance_rate: number;
}

// ==============================================================================
// P2P Kademlia DHT Mesh Interfaces
// ==============================================================================

export interface KademliaContact {
  node_id: string;
  worker_id: string;
  endpoint: string;
  last_seen: string;
}

export interface KademliaNodeInfo {
  node_id: string;
  node_id_int: string;
  total_contacts: number;
  total_buckets: number;
  k_bucket_capacity: number;
  total_provider_keys: number;
  total_provider_records: number;
}

export interface KademliaBucketInfo {
  bucket_index: number;
  distance_range: string;
  contact_count: number;
  contacts: KademliaContact[];
}

export interface RoutingTableInfo {
  local_node_id: string;
  total_contacts: number;
  active_buckets_count: number;
  buckets: KademliaBucketInfo[];
}

export interface ProviderRecord {
  provider_id: string;
  endpoint: string;
  vram_gb: number;
  metadata: Record<string, any>;
  announced_at: string;
  expires_at: string;
}

export interface ProviderLookupResponse {
  content_key: string;
  has_providers: boolean;
  provider_count: number;
  providers: ProviderRecord[];
}

export interface IterativeLookupResult {
  lookup: {
    target_key: string;
    converged: boolean;
    total_hops: number;
    total_nodes_contacted: number;
    total_providers_found: number;
    providers: ProviderRecord[];
  };
}

// ==============================================================================
// Commercial Billing & Escrow Rails Interfaces
// ==============================================================================

export interface StripeCheckoutSession {
  id: string;
  amount_total: number;
  currency: string;
  status: string;
  payment_intent: string;
  url: string;
  customer_email: string;
}

export interface ChainInfo {
  chain_name: string;
  chain_id: number;
  usdc_contract: string;
  deposit_address: string;
  native_gas_symbol: string;
  explorer_url: string;
}

export interface CryptoDepositAddressResponse {
  user_id: string;
  supported_chains: Record<string, ChainInfo>;
  accepted_token: string;
  conversion_rate: string;
}

export interface CryptoDepositVerifyResponse {
  status: string;
  chain: string;
  chain_id: number;
  tx_hash: string;
  sender: string;
  recipient: string;
  amount_usdc: number;
  user_id: string;
  new_balance_usd: number;
  transaction_id: string;
  eip712_digest: string;
  confirmed_at: string;
}

export interface WorkerPayoutReceipt {
  receipt_id: string;
  worker_id: string;
  worker_name: string;
  amount_gross_usd: number;
  fee_usd: number;
  amount_net_usd: number;
  currency: string;
  payout_method: string;
  destination_address: string;
  settlement_tx_hash: string;
  hmac_signature: string;
  status: string;
  timestamp: string;
}

export interface WorkerPayoutResponse {
  status: string;
  receipt: WorkerPayoutReceipt;
  remaining_earnings_usd: number;
}

export interface UserTransaction {
  transaction_id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

export interface UserLedgerResponse {
  user_id: string;
  current_balance_usd: number;
  total_transactions: number;
  transactions: UserTransaction[];
}

export interface BillingSystemStats {
  status: string;
  supported_fiat_rails: string[];
  supported_crypto_rails: string[];
  supported_chains: Record<string, any>;
  min_payout_threshold_usd: number;
  network_fees_usd: Record<string, number>;
  settlement_frequency: string;
}

// ==============================================================================
// MoE & Speculative API Service Class
// ==============================================================================

class MoeApiService {
  // ----------------------------------------------------------------------------
  // MoE Engine Endpoints
  // ----------------------------------------------------------------------------
  async getSupportedMoEModels(): Promise<{ models: MoeModelSpec[] }> {
    const res = await apiClient.get("/api/v1/moe/models/supported");
    return res.data;
  }

  async createMoEPipeline(
    modelId: string,
    name?: string,
    quantization?: string
  ): Promise<{ status: string; pipeline: MoePipelineInfo }> {
    const res = await apiClient.post("/api/v1/moe/pipelines", {
      model_id: modelId,
      name: name || undefined,
      quantization: quantization || "4bit",
    });
    return res.data;
  }

  async listMoEPipelines(): Promise<{ total_pipelines: number; pipelines: MoePipelineInfo[] }> {
    const res = await apiClient.get("/api/v1/moe/pipelines");
    return res.data;
  }

  async getMoEPipeline(pipelineId: string): Promise<{ pipeline: MoePipelineInfo }> {
    const res = await apiClient.get(`/api/v1/moe/pipelines/${pipelineId}`);
    return res.data;
  }

  async assignExpertPair(
    pipelineId: string,
    workerId: string,
    expertPair: [number, number],
    vramGb?: number
  ): Promise<{ status: string; assignment: WorkerPairAssignment; pipeline: MoePipelineInfo }> {
    const res = await apiClient.post("/api/v1/moe/workers/assign-pair", {
      pipeline_id: pipelineId,
      worker_id: workerId,
      expert_pair: expertPair,
      vram_gb: vramGb || 8.0,
    });
    return res.data;
  }

  async routeTokens(
    pipelineId: string,
    tokenIds: number[],
    topK?: number
  ): Promise<TokenRouteResponse> {
    const res = await apiClient.post(`/api/v1/moe/pipelines/${pipelineId}/route-tokens`, {
      token_ids: tokenIds,
      top_k: topK || 2,
    });
    return res.data;
  }

  async getMoETelemetry(pipelineId: string): Promise<MoeTelemetry> {
    const res = await apiClient.get(`/api/v1/moe/pipelines/${pipelineId}/telemetry`);
    return res.data;
  }

  // ----------------------------------------------------------------------------
  // Decentralized Speculative Decoding (DSD) Endpoints
  // ----------------------------------------------------------------------------
  async generateDraft(
    prompt: string,
    maxDraftTokens?: number
  ): Promise<DraftResponse> {
    const res = await apiClient.post("/api/v1/speculative/draft", {
      prompt,
      max_draft_tokens: maxDraftTokens || 4,
    });
    return res.data;
  }

  async generateSpeculative(
    prompt: string,
    maxNewTokens?: number,
    draftK?: number,
    temperature?: number
  ): Promise<SpeculativeGenerationResult> {
    const res = await apiClient.post("/api/v1/speculative/generate", {
      prompt,
      max_new_tokens: maxNewTokens || 16,
      draft_k: draftK || 4,
      temperature: temperature || 0.7,
    });
    return res.data;
  }

  async getSpeculativeStats(): Promise<SpeculativeStats> {
    const res = await apiClient.get("/api/v1/speculative/stats");
    return res.data;
  }

  // ----------------------------------------------------------------------------
  // P2P Kademlia DHT Mesh Endpoints
  // ----------------------------------------------------------------------------
  async getDHTNodeInfo(): Promise<KademliaNodeInfo> {
    const res = await apiClient.get("/api/v1/dht/node/info");
    return res.data;
  }

  async getDHTRoutingTable(): Promise<RoutingTableInfo> {
    const res = await apiClient.get("/api/v1/dht/routing-table");
    return res.data;
  }

  async announceDHTProvider(
    contentKey: string,
    providerId: string,
    endpoint: string,
    vramGb?: number,
    metadata?: Record<string, any>
  ): Promise<any> {
    const res = await apiClient.post("/api/v1/dht/providers/announce", {
      content_key: contentKey,
      provider_id: providerId,
      endpoint,
      vram_gb: vramGb || 8.0,
      metadata: metadata || {},
    });
    return res.data;
  }

  async getDHTProviders(contentKey: string): Promise<ProviderLookupResponse> {
    const res = await apiClient.get(`/api/v1/dht/providers/${encodeURIComponent(contentKey)}`);
    return res.data;
  }

  async lookupDHT(contentKey: string, alpha?: number): Promise<IterativeLookupResult> {
    const res = await apiClient.post("/api/v1/dht/lookup", {
      content_key: contentKey,
      alpha: alpha || 3,
    });
    return res.data;
  }

  // ----------------------------------------------------------------------------
  // Commercial Billing & Escrow Rails Endpoints
  // ----------------------------------------------------------------------------
  async createStripeCheckoutSession(
    amountUsd: number,
    customerEmail?: string,
    userId?: string
  ): Promise<{ status: string; session: StripeCheckoutSession }> {
    const res = await apiClient.post("/api/v1/billing/stripe/create-checkout-session", {
      amount_usd: amountUsd,
      customer_email: customerEmail || undefined,
      user_id: userId || undefined,
    });
    return res.data;
  }

  async getCryptoDepositAddresses(userId?: string): Promise<CryptoDepositAddressResponse> {
    const params = userId ? { user_id: userId } : {};
    const res = await apiClient.get("/api/v1/billing/crypto/deposit-address", { params });
    return res.data;
  }

  async verifyCryptoDeposit(
    chain: string,
    txHash: string,
    amountUsdc: number,
    senderAddress: string,
    recipientAddress: string,
    signature: string,
    nonce: number,
    userId?: string
  ): Promise<CryptoDepositVerifyResponse> {
    const res = await apiClient.post("/api/v1/billing/crypto/verify-deposit", {
      chain,
      tx_hash: txHash,
      amount_usdc: amountUsdc,
      sender_address: senderAddress,
      recipient_address: recipientAddress,
      signature,
      nonce,
      user_id: userId || undefined,
    });
    return res.data;
  }

  async processWorkerPayout(
    workerId: string,
    amountUsd: number,
    payoutMethod: string,
    destinationAddress: string
  ): Promise<WorkerPayoutResponse> {
    const res = await apiClient.post("/api/v1/billing/payouts/process", {
      worker_id: workerId,
      amount_usd: amountUsd,
      payout_method: payoutMethod,
      destination_address: destinationAddress,
    });
    return res.data;
  }

  async getWorkerPayouts(workerId: string): Promise<{ worker_id: string; total_payouts: number; history: any[] }> {
    const res = await apiClient.get(`/api/v1/billing/payouts/${workerId}`);
    return res.data;
  }

  async getDisbursementReceipt(receiptId: string): Promise<{ receipt: WorkerPayoutReceipt; is_signature_authentic: boolean }> {
    const res = await apiClient.get(`/api/v1/billing/receipts/disbursement/${receiptId}`);
    return res.data;
  }

  async getUserLedger(userId: string): Promise<UserLedgerResponse> {
    const res = await apiClient.get(`/api/v1/billing/ledger/${userId}`);
    return res.data;
  }

  async getBillingStats(): Promise<BillingSystemStats> {
    const res = await apiClient.get("/api/v1/billing/stats");
    return res.data;
  }
}

export const moeService = new MoeApiService();
