import { useWalletStore } from '@/stores/wallet-store';

export const useWallet = () => {
  const store = useWalletStore();
  return {
    balance: store.balance,
    currency: store.currency,
    transactions: store.transactions,
    isLoading: store.isLoading,
    error: store.error,
    fetchBalance: store.fetchBalance,
    fetchTransactions: store.fetchTransactions,
    deposit: store.deposit,
    withdraw: store.withdraw,
    clearError: store.clearError,
    reset: store.reset,
  };
};

export { useWalletStore };
