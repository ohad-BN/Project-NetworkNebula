export interface User {
  id: string;
  email: string;
  role: "creator" | "worker";
  created_at: string;
}

export interface AuthResponse {
  user: User;
  api_key: string;
  api_secret: string;
}

export interface Task {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  result?: TaskResult;
  created_at: string;
  completed_at?: string;
}

export interface TaskResult {
  image_url?: string;
  output?: string;
  error?: string;
}

export interface TaskSubmission {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  num_images?: number;
}

export interface TaskStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  result?: TaskResult;
  created_at: string;
  completed_at?: string;
}

export interface WorkerRegistration {
  system_info: {
    hostname: string;
    ip_address: string;
    cpu_model: string;
    cpu_cores: number;
    ram_gb: number;
    gpu_model?: string;
  };
  wallet_address?: string;
}

export interface WorkerStats {
  worker_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  earnings: number;
  uptime_seconds: number;
}

export interface HeartbeatResponse {
  status: string;
  current_task?: string;
}
