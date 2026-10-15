export interface User {
  id: string;
  email: string;
  role: "creator" | "worker";
  created_at: string;
}

export interface Wallet {
  balance: number;
  currency: string;
  user_id: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: "deposit" | "withdraw" | "earning" | "payout";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  created_at: string;
  description?: string;
}

export interface Task {
  id: string;
  user_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  num_images?: number;
  cost?: number;
  result?: TaskResult;
  created_at: string;
  completed_at?: string;
}

export interface TaskResult {
  image_url?: string;
  output?: string;
  error?: string;
}

export interface Worker {
  id: string;
  user_id: string;
  hostname: string;
  ip_address: string;
  cpu_model: string;
  cpu_cores: number;
  ram_gb: number;
  gpu_model?: string;
  status: "online" | "offline" | "busy";
  earnings: number;
  created_at: string;
  last_seen?: string;
}

export interface WorkerStats {
  worker_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  earnings: number;
  uptime_seconds: number;
}

export interface PayoutRequest {
  id: string;
  worker_id: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "paid";
  created_at: string;
  paid_at?: string;
}
