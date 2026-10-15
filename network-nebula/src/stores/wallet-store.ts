import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletService, type WalletBalance, type Transaction } from '@/services/api/wallet';

interface WalletState {
  balance: number;
  currency: string;
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
}

interface WalletActions {
  fetchBalance: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  deposit: (amount: number, paymentMethod?: string) => Promise<Transaction>;
  withdraw: (amount: number, destination?: string) => Promise<Transaction>;
  clearError: () => void;
  reset: () => void;
}

type WalletStore = WalletState & WalletActions;

const initialState: WalletState = {
  balance: 0,
  currency: 'USD',
  transactions: [],
  isLoading: false,
  error: null,
};

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      fetchBalance: async () => {
        set({ isLoading: true, error: null });
        try {
          const data: WalletBalance = await walletService.getBalance();
          set({ balance: data.balance, currency: data.currency, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch balance',
            isLoading: false,
          });
        }
      },

      fetchTransactions: async () => {
        set({ isLoading: true, error: null });
        try {
          const transactions: Transaction[] = await walletService.getTransactions();
          set({ transactions, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch transactions',
            isLoading: false,
          });
        }
      },

      deposit: async (amount: number, paymentMethod?: string) => {
        set({ isLoading: true, error: null });
        try {
          const transaction: Transaction = await walletService.deposit({ amount, payment_method: paymentMethod });
          const { balance } = get();
          set({
            balance: balance + amount,
            transactions: [transaction, ...get().transactions],
            isLoading: false,
          });
          return transaction;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Deposit failed',
            isLoading: false,
          });
          throw error;
        }
      },

      withdraw: async (amount: number, destination?: string) => {
        set({ isLoading: true, error: null });
        try {
          if (amount > get().balance) {
            throw new Error('Insufficient balance');
          }
          const transaction: Transaction = await walletService.withdraw({ amount, destination });
          const { balance } = get();
          set({
            balance: balance - amount,
            transactions: [transaction, ...get().transactions],
            isLoading: false,
          });
          return transaction;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Withdrawal failed',
            isLoading: false,
          });
          throw error;
        }
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: 'wallet-storage',
      partialize: (state) => ({
        balance: state.balance,
        currency: state.currency,
      }),
    }
  )
);

export const selectBalance = (state: WalletStore) => state.balance;
export const selectCurrency = (state: WalletStore) => state.currency;
export const selectTransactions = (state: WalletStore) => state.transactions;
export const selectIsLoading = (state: WalletStore) => state.isLoading;
export const selectError = (state: WalletStore) => state.error;
