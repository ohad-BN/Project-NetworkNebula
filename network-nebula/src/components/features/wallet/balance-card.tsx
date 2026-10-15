import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWalletStore, selectBalance, selectCurrency, selectIsLoading } from "@/stores/wallet-store";
import { Loader2, Wallet, Plus, ArrowDownRight } from "lucide-react";

interface BalanceCardProps {
  onDepositClick: () => void;
  onWithdrawClick: () => void;
  isWorker?: boolean;
}

export function BalanceCard({ onDepositClick, onWithdrawClick, isWorker = false }: BalanceCardProps) {
  const balance = useWalletStore(selectBalance);
  const currency = useWalletStore(selectCurrency);
  const isLoading = useWalletStore(selectIsLoading);

  const formattedBalance = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(balance);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Wallet Balance
        </CardTitle>
        <Wallet className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-4xl font-bold">{formattedBalance}</span>
            <span className="text-xs text-muted-foreground">
              Available for tasks and withdrawals
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={onDepositClick}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Funds
                </>
              )}
            </Button>

            {isWorker && (
              <Button
                onClick={onWithdrawClick}
                variant="outline"
                disabled={isLoading || balance <= 0}
                className="flex-1"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowDownRight className="h-4 w-4 mr-2" />
                    Withdraw
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
