import { useAuthStore } from "@/stores/auth-store";
import type { User } from "@/types";

export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    apiKey,
    apiSecret,
    login,
    register,
    verifyEmail,
    resendVerificationCode,
    validateInviteCode,
    claimFaucet,
    logout,
    verifySession,
    clearError,
    setUser,
  } = useAuthStore();

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    apiKey,
    apiSecret,
    login,
    register,
    verifyEmail,
    resendVerificationCode,
    validateInviteCode,
    claimFaucet,
    logout,
    verifySession,
    clearError,
    setUser,
  };
}

export type { User };
