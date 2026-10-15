import { apiClient } from "./client";
import type {
  WorkerRegistration,
  WorkerStats,
  HeartbeatResponse,
} from "@/types";

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

  deregister: async (workerId: string): Promise<void> => {
    await apiClient.post(`/workers/${workerId}/deregister`);
  },
};
