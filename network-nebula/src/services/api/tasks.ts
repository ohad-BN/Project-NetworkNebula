import { apiClient } from "./client";
import type { Task, TaskSubmission, TaskStatus } from "@/types";

export const taskService = {
  submit: async (data: TaskSubmission): Promise<Task> => {
    const response = await apiClient.post<Task>("/api/tasks", data);
    return response.data;
  },

  status: async (taskId: string): Promise<TaskStatus> => {
    const response = await apiClient.get<TaskStatus>(`/api/tasks/${taskId}`);
    return response.data;
  },

  list: async (params?: { page?: number; limit?: number; status?: string }): Promise<{ tasks: Task[]; total: number }> => {
    const response = await apiClient.get<{ tasks: Task[]; total: number }>("/api/tasks", { params });
    return response.data;
  },
};
