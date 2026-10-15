import { useEffect, useState } from "react";
import { useWalletStore } from "@/stores/wallet-store";
import { useAuthStore } from "@/stores/auth-store";
import { BalanceCard } from "@/components/features/wallet/balance-card";
import { DepositModal } from "@/components/features/wallet/deposit-modal";
import { WithdrawModal } from "@/components/features/wallet/withdraw-modal";
import { TransactionList } from "@/components/features/wallet/transaction-list";
import { Skeleton } from "@/components/ui/skeleton";
import type { Transaction } from "@/services/api/wallet";

export function WalletPage() {
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "deposit" | "withdraw" | "earning" | "payout">("all");

  const { transactions, isLoading, fetchBalance, fetchTransactions } = useWalletStore();
  const { user } = useAuthStore();
  const isWorker = user?.role === "worker";

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
  }, [fetchBalance, fetchTransactions]);

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-muted-foreground mt-1">
          Manage your funds and view transaction history
        </p>
      </div>

      <div className="grid gap-6">
        <BalanceCard
          onDepositClick={() => setDepositModalOpen(true)}
          onWithdrawClick={() => setWithdrawModalOpen(true)}
          isWorker={isWorker}
        />

        {isLoading && transactions.length === 0 ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <TransactionList
            transactions={transactions as Transaction[]}
            isLoading={isLoading}
            filterType={filterType}
            onFilterChange={setFilterType}
          />
        )}
      </div>

      <DepositModal
        open={depositModalOpen}
        onOpenChange={setDepositModalOpen}
      />

      <WithdrawModal
        open={withdrawModalOpen}
        onOpenChange={setWithdrawModalOpen}
      />
    </div>
  );
}
