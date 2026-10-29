import { apiClient } from "./client";
import type { User, AuthResponse } from "@/types";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirm_password: string;
  role?: "creator" | "worker";
  invite_code?: string;
}

export const authService = {
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>("/auth/login", data);
    if (response.data.api_key) {
      localStorage.setItem("api_key", response.data.api_key);
    }
    if (response.data.api_secret) {
      localStorage.setItem("api_secret", response.data.api_secret);
    }
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>("/auth/register", data);
    if (response.data.api_key) {
      localStorage.setItem("api_key", response.data.api_key);
    }
    if (response.data.api_secret) {
      localStorage.setItem("api_secret", response.data.api_secret);
    }
    return response.data;
  },

  verifyEmail: async (email: string, code: string): Promise<any> => {
    const response = await apiClient.post("/auth/verify-email", { email, code });
    return response.data;
  },

  resendVerificationCode: async (email: string): Promise<any> => {
    const response = await apiClient.post("/auth/resend-code", { email });
    return response.data;
  },

  validateInviteCode: async (code: string): Promise<any> => {
    const response = await apiClient.post("/api/v1/invites/validate", { code });
    return response.data;
  },

  claimFaucet: async (): Promise<any> => {
    const response = await apiClient.post("/api/wallet/faucet", {});
    return response.data;
  },

  logout: () => {
    localStorage.removeItem("api_key");
    localStorage.removeItem("api_secret");
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>("/auth/me");
    return response.data;
  },

  verifySession: async (): Promise<boolean> => {
    try {
      await apiClient.get("/auth/verify");
      return true;
    } catch {
      return false;
    }
  },
};
