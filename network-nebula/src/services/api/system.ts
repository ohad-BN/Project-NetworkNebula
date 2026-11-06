import { apiClient } from "./client";

export interface SystemGitInfo {
  commit: string;
  full_commit: string;
  branch: string;
  message: string;
  timestamp: string;
  is_dirty: boolean;
}

export interface SystemResourceMetrics {
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  memory_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
}

export interface SystemStatusData {
  status: string;
  uptime_seconds: number;
  uptime_human: string;
  hostname: string;
  os: string;
  platform_system: string;
  local_ips: string[];
  tailscale_ip?: string;
  git: SystemGitInfo;
  resources: SystemResourceMetrics;
  cluster_overview: {
    total_workers: number;
    online_workers: number;
    always_silent_workers: number;
    total_users: number;
    active_tasks: number;
  };
}

export interface GitCheckUpdateData {
  update_available: boolean;
  local_commit: string;
  remote_commit: string;
  commits_behind: number;
  pending_commits: string[];
  message: string;
}

export interface GitApplyUpdateData {
  success: boolean;
  previous_commit: string;
  new_commit: string;
  output: string;
  restart_recommended: boolean;
  message: string;
}

export const systemService = {
  getStatus: async (): Promise<SystemStatusData> => {
    const res = await apiClient.get<SystemStatusData>("/api/v1/system/status");
    return res.data;
  },

  checkUpdate: async (): Promise<GitCheckUpdateData> => {
    const res = await apiClient.get<GitCheckUpdateData>("/api/v1/system/check-update");
    return res.data;
  },

  applyUpdate: async (): Promise<GitApplyUpdateData> => {
    const res = await apiClient.post<GitApplyUpdateData>("/api/v1/system/update");
    return res.data;
  },
};
