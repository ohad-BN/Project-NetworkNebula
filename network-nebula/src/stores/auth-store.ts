import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  apiKey: string | null;
  apiSecret: string | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    role: "creator" | "worker",
    inviteCode?: string
  ) => Promise<{ is_verified?: boolean; message?: string; dev_otp?: string | null; mailer_active?: boolean }>;
  verifyEmail: (email: string, code: string) => Promise<{ balance?: number; message?: string }>;
  resendVerificationCode: (email: string) => Promise<void>;
  validateInviteCode: (code: string) => Promise<boolean>;
  claimFaucet: () => Promise<{ amount: number; balance: number; message: string }>;
  logout: () => void;
  verifySession: () => Promise<boolean>;
  clearError: () => void;
  setUser: (user: User | null) => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      apiKey: null,
      apiSecret: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch("http://localhost:8000/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Login failed");
          }

          const data = await response.json();
          const userRole = data.user.role || (data.user.is_worker ? "worker" : "creator");
          const userObj = { ...data.user, role: userRole };

          if (data.api_key) localStorage.setItem("api_key", data.api_key);
          if (data.api_secret) localStorage.setItem("api_secret", data.api_secret);

          set({
            user: userObj,
            isAuthenticated: true,
            apiKey: data.api_key,
            apiSecret: data.api_secret,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Login failed",
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (
        email: string,
        password: string,
        role: "creator" | "worker",
        inviteCode?: string
      ) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch("http://localhost:8000/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password,
              confirm_password: password,
              role,
              invite_code: inviteCode || undefined,
            }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Registration failed");
          }

          const data = await response.json();
          const userRole = data.user.role || role || (data.user.is_worker ? "worker" : "creator");
          const userObj = { ...data.user, role: userRole };

          if (data.api_key) localStorage.setItem("api_key", data.api_key);
          if (data.api_secret) localStorage.setItem("api_secret", data.api_secret);

          set({
            user: userObj,
            isAuthenticated: true,
            apiKey: data.api_key,
            apiSecret: data.api_secret,
            isLoading: false,
            error: null,
          });

          return { is_verified: data.user.is_verified, message: data.message, dev_otp: data.dev_otp, mailer_active: data.mailer_active };
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Registration failed",
            isLoading: false,
          });
          throw error;
        }
      },

      verifyEmail: async (email: string, code: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch("http://localhost:8000/auth/verify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Verification failed");
          }

          const data = await response.json();
          const currentUser = get().user;
          if (currentUser) {
            set({
              user: {
                ...currentUser,
                balance: data.balance ?? currentUser.balance,
              },
              isLoading: false,
              error: null,
            });
          } else {
            set({ isLoading: false, error: null });
          }
          return { balance: data.balance, message: data.message };
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Verification failed",
            isLoading: false,
          });
          throw error;
        }
      },

      resendVerificationCode: async (email: string) => {
        try {
          await fetch("http://localhost:8000/auth/resend-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
        } catch {
          // ignore error
        }
      },

      validateInviteCode: async (code: string) => {
        try {
          const response = await fetch("http://localhost:8000/api/v1/invites/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (!response.ok) return false;
          const data = await response.json();
          return Boolean(data.valid);
        } catch {
          return false;
        }
      },

      claimFaucet: async () => {
        const { apiKey } = get();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["X-API-Key"] = apiKey;

        const response = await fetch("http://localhost:8000/api/wallet/faucet", {
          method: "POST",
          headers,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || "Faucet claim failed");
        }

        const data = await response.json();
        const currentUser = get().user;
        if (currentUser) {
          set({
            user: { ...currentUser, balance: data.balance },
          });
        }
        return data;
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          apiKey: null,
          apiSecret: null,
          error: null,
        });
        localStorage.removeItem("api_key");
        localStorage.removeItem("api_secret");
        localStorage.removeItem("auth-storage");
      },

      verifySession: async () => {
        const { apiKey } = get();
        if (!apiKey) return false;

        try {
          const response = await fetch("http://localhost:8000/health", {
            headers: { "X-API-Key": apiKey },
          });
          return response.ok;
        } catch {
          return false;
        }
      },

      clearError: () => set({ error: null }),

      setUser: (user: User | null) => set({ user, isAuthenticated: !!user }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        apiKey: state.apiKey,
        apiSecret: state.apiSecret,
      }),
    }
  )
);

export const selectUser = (state: AuthStore) => state.user;
export const selectIsAuthenticated = (state: AuthStore) => state.isAuthenticated;
export const selectIsLoading = (state: AuthStore) => state.isLoading;
export const selectError = (state: AuthStore) => state.error;
