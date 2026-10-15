import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "earning" | "payout";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  created_at: string;
  description?: string;
}

interface TransactionListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  filterType?: "all" | "deposit" | "withdraw" | "earning" | "payout";
  onFilterChange?: (type: "all" | "deposit" | "withdraw" | "earning" | "payout") => void;
  pageSize?: number;
}

const transactionTypeConfig = {
  deposit: {
    label: "Deposit",
    badgeClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    amountPrefix: "+",
    amountClass: "text-green-600 dark:text-green-400",
  },
  withdraw: {
    label: "Withdrawal",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    amountPrefix: "-",
    amountClass: "text-red-600 dark:text-red-400",
  },
  earning: {
    label: "Earning",
    badgeClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    amountPrefix: "+",
    amountClass: "text-green-600 dark:text-green-400",
  },
  payout: {
    label: "Payout",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    amountPrefix: "-",
    amountClass: "text-red-600 dark:text-red-400",
  },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function TransactionSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center justify-between py-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="text-right space-y-2">
            <Skeleton className="h-4 w-16 ml-auto" />
            <Skeleton className="h-3 w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TransactionList({
  transactions,
  isLoading = false,
  filterType = "all",
  onFilterChange,
  pageSize = 10,
}: TransactionListProps) {
  const [currentPage, setCurrentPage] = useState(1);

  const filteredTransactions = transactions.filter(
    (tx) => filterType === "all" || tx.type === filterType
  );

  const totalPages = Math.ceil(filteredTransactions.length / pageSize);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleFilterChange = (type: "all" | "deposit" | "withdraw" | "earning" | "payout") => {
    setCurrentPage(1);
    onFilterChange?.(type);
  };

  const filters: Array<{ value: "all" | "deposit" | "withdraw" | "earning" | "payout"; label: string }> = [
    { value: "all", label: "All" },
    { value: "deposit", label: "Deposits" },
    { value: "earning", label: "Earnings" },
    { value: "withdraw", label: "Withdrawals" },
    { value: "payout", label: "Payouts" },
  ];

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <TransactionSkeleton />
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Transaction History</h3>
        <div className="text-center py-8 text-muted-foreground">
          <p>No transactions yet</p>
          <p className="text-sm mt-1">Your transaction history will appear here</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Transaction History</h3>

      <div className="flex flex-wrap gap-2 mb-4">
        {filters.map(({ value, label }) => (
          <Button
            key={value}
            variant={filterType === value ? "default" : "outline"}
            size="sm"
            onClick={() => handleFilterChange(value)}
            className={cn(
              "text-xs",
              filterType === value && "bg-primary text-primary-foreground"
            )}
          >
            {label}
          </Button>
        ))}
      </div>

      <Separator className="my-4" />

      {paginatedTransactions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No transactions found for this filter</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {paginatedTransactions.map((transaction) => {
              const config = transactionTypeConfig[transaction.type];
              return (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn("text-xs", config.badgeClass)}>
                        {config.label}
                      </Badge>
                      {transaction.status === "pending" && (
                        <Badge variant="secondary" className="text-xs">
                          Pending
                        </Badge>
                      )}
                    </div>
                    {transaction.description && (
                      <p className="text-sm text-muted-foreground">{transaction.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{formatDate(transaction.created_at)}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className={cn("font-semibold", config.amountClass)}>
                      {config.amountPrefix}${transaction.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{transaction.currency}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
