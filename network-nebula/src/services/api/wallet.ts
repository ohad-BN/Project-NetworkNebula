import { apiClient } from "./client";

export interface WalletBalance {
  balance: number;
  currency: string;
}

export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "earning" | "payout";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  created_at: string;
  description?: string;
}

export interface DepositRequest {
  amount: number;
  payment_method?: string;
}

export interface WithdrawRequest {
  amount: number;
  destination?: string;
}

export const walletService = {
  getBalance: async (): Promise<WalletBalance> => {
    const response = await apiClient.get("/api/wallet/balance");
    return response.data;
  },

  deposit: async (data: DepositRequest): Promise<Transaction> => {
    const response = await apiClient.post("/api/wallet/deposit", data);
    return response.data;
  },

  withdraw: async (data: WithdrawRequest): Promise<Transaction> => {
    const response = await apiClient.post("/api/wallet/withdraw", data);
    return response.data;
  },

  getTransactions: async (limit = 50): Promise<Transaction[]> => {
    const response = await apiClient.get(`/api/wallet/transactions?limit=${limit}`);
    return response.data;
  },
};
