export interface User {
  id: string;
  email: string;
  role: "creator" | "worker";
  balance?: number;
  is_verified?: boolean;
  name?: string;
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
  status: "online" | "busy" | "offline";
  specs?: {
    gpu?: string;
    vram?: number;
    cpu?: string;
    ram?: number;
  };
  current_task?: string;
  total_tasks_completed: number;
  total_earned: number;
  last_heartbeat: string;
}

export interface PayoutRequest {
  id: string;
  worker_id: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "completed";
  method: "crypto" | "bank_transfer";
  destination: string;
  created_at: string;
  processed_at?: string;
}
