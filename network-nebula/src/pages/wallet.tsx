import { useEffect, useState } from "react";
import {
  Wallet,
  ArrowUpRight,
  FileText,
  Printer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useWalletStore } from "@/stores/wallet-store";
import { useAuthStore } from "@/stores/auth-store";
import { BalanceCard } from "@/components/features/wallet/balance-card";
import { DepositModal } from "@/components/features/wallet/deposit-modal";
import { WithdrawModal } from "@/components/features/wallet/withdraw-modal";
import { TransactionList } from "@/components/features/wallet/transaction-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";
import type { Transaction } from "@/services/api/wallet";


interface PayoutItem {
  id: number;
  payout_id: string;
  amount: number;
  status: string;
  payment_method?: string;
  payment_address?: string;
  created_at: string;
  processed_at?: string;
}

interface BillingReceipt {
  invoice_number: string;
  receipt_id: string;
  job_id: string;
  job_type: string;
  model: string;
  status: string;
  customer_id: string;
  issue_date: string;
  completion_date?: string;
  compute_duration_seconds: number;
  allocated_gpus: number;
  epochs_completed: number;
  line_items: Array<{
    description: string;
    quantity: number;
    unit: string;
    unit_price_usd: number;
    amount_usd: number;
  }>;
  subtotal_usd: number;
  tax_usd: number;
  total_usd: number;
  currency: string;
  payment_status: string;
  provider: string;
}

export function WalletPage() {
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "deposit" | "withdraw" | "earning" | "payout">("all");

  // Host Payout Tracking State
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);

  // Invoice / Receipt Lookup State
  const [searchJobId, setSearchJobId] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<BillingReceipt | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);

  const { transactions, isLoading, fetchBalance, fetchTransactions } = useWalletStore();
  const { user } = useAuthStore();
  const isWorker = user?.role === "worker";

  const fetchPayouts = async () => {
    try {
      const res = await apiClient.get<PayoutItem[]>("/api/v1/wallet/payouts");
      setPayouts(res.data);
    } catch {
      // Fallback or unauthenticated
    }
  };


  useEffect(() => {
    fetchBalance();
    fetchTransactions();
    fetchPayouts();
  }, [fetchBalance, fetchTransactions]);

  const handleFetchReceipt = async (jobId: string) => {
    if (!jobId.trim()) return;
    try {
      setIsLoadingReceipt(true);
      const res = await apiClient.get<BillingReceipt>(`/api/v1/billing/receipts/${jobId.trim()}`);
      setSelectedReceipt(res.data);
      setIsReceiptModalOpen(true);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || `No billing receipt found for job '${jobId}'`);
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
            <Wallet className="h-8 w-8 text-primary" />
            Enterprise Wallet & Compute Billing
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage compute earnings, submit node withdrawals (min $10.00), and download enterprise billing receipts
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={async () => {
              try {
                const res = await apiClient.post<any>("/api/wallet/faucet");
                toast.success(res.data.message || "Claimed +$25.00 Alpha Compute Credits!");
                fetchBalance();
                fetchTransactions();
              } catch (err: any) {
                toast.error(err.response?.data?.detail || "Daily faucet already claimed or unavailable");
              }
            }}
            className="gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            <span>Alpha Faucet (+$25)</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchBalance();
              fetchTransactions();
              fetchPayouts();
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Balance & Instant Action Card */}
        <BalanceCard
          onDepositClick={() => setDepositModalOpen(true)}
          onWithdrawClick={() => setWithdrawModalOpen(true)}
          isWorker={Boolean(isWorker)}
        />

        {/* Enterprise Compute Invoice Lookup Bar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Enterprise Compute Billing Invoice Lookup
            </CardTitle>
            <CardDescription>
              Retrieve official tax-compliant invoices and compute receipts by Training Job ID or Task UUID
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFetchReceipt(searchJobId);
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="Enter Job or Task ID (e.g. 6e609a64-b0cf-46c5...)"
                value={searchJobId}
                onChange={(e) => setSearchJobId(e.target.value)}
                className="font-mono text-sm"
              />
              <Button type="submit" disabled={isLoadingReceipt} className="gap-2 shrink-0">
                <FileText className="h-4 w-4" />
                {isLoadingReceipt ? "Locating..." : "View Receipt"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Payout Requests Tracker */}
        {payouts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-emerald-500" />
                  Host Node Payout Requests
                </span>
                <Badge variant="outline">{payouts.length} Requests</Badge>
              </CardTitle>
              <CardDescription>
                Live tracking of withdrawal disbursements to destination wallets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Payout ID</th>
                      <th className="pb-2 font-medium">Amount</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Destination</th>
                      <th className="pb-2 font-medium">Method</th>
                      <th className="pb-2 text-right">Requested</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {payouts.map((p) => (
                      <tr key={p.payout_id} className="hover:bg-muted/50">
                        <td className="py-2.5 font-mono text-xs text-muted-foreground">{p.payout_id.slice(0, 12)}...</td>
                        <td className="py-2.5 font-mono font-semibold text-emerald-400">${p.amount.toFixed(2)}</td>
                        <td className="py-2.5 text-xs">
                          <Badge
                            variant={p.status.toUpperCase() === "PAID" ? "default" : "secondary"}
                            className="text-[10px] uppercase font-mono"
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-xs font-mono text-muted-foreground">{p.payment_address || "Default"}</td>
                        <td className="py-2.5 text-xs text-muted-foreground">{p.payment_method || "Crypto/USDC"}</td>
                        <td className="py-2.5 text-xs text-muted-foreground text-right">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transaction History Ledger */}
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
        onOpenChange={(open) => {
          setWithdrawModalOpen(open);
          if (!open) {
            fetchBalance();
            fetchTransactions();
            fetchPayouts();
          }
        }}
      />

      {/* Printable Invoice Dialog */}
      <Dialog open={isReceiptModalOpen} onOpenChange={setIsReceiptModalOpen}>
        <DialogContent className="max-w-2xl print:max-w-full">
          {selectedReceipt && (
            <div className="space-y-6 p-2">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <div className="text-xl font-bold tracking-tight text-primary">Project NetworkNebula</div>
                  <div className="text-xs text-muted-foreground">Decentralized GPU Compute Network</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1">{selectedReceipt.provider}</div>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="font-mono text-xs uppercase mb-1">
                    {selectedReceipt.invoice_number}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    Date: {new Date(selectedReceipt.issue_date).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-emerald-500 font-semibold uppercase mt-0.5">
                    {selectedReceipt.payment_status}
                  </div>
                </div>
              </div>

              {/* Job Metadata */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-muted/30 p-3 rounded-lg border">
                <div>
                  <span className="text-muted-foreground">Compute Job ID:</span>
                  <div className="font-mono font-medium truncate">{selectedReceipt.job_id}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Model / Workload:</span>
                  <div className="font-medium">{selectedReceipt.model}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Compute Duration:</span>
                  <div className="font-mono">{selectedReceipt.compute_duration_seconds} seconds</div>
                </div>
                <div>
                  <span className="text-muted-foreground">GPUs Allocated:</span>
                  <div className="font-mono">{selectedReceipt.allocated_gpus} Node(s)</div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/60 text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-right">Qty</th>
                      <th className="py-2 px-3 text-right">Rate</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedReceipt.line_items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 font-medium">{item.description}</td>
                        <td className="py-2 px-3 text-right font-mono">{item.quantity} {item.unit}</td>
                        <td className="py-2 px-3 text-right font-mono">${item.unit_price_usd.toFixed(4)}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">${item.amount_usd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total Summary */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span className="font-mono">${selectedReceipt.subtotal_usd.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Platform Tax (0%):</span>
                    <span className="font-mono">$0.00</span>
                  </div>
                  <div className="flex justify-between font-bold text-sm border-t pt-1">
                    <span>Total Settled:</span>
                    <span className="font-mono text-emerald-400">${selectedReceipt.total_usd.toFixed(4)} USD</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 print:hidden border-t">
                <Button variant="outline" size="sm" onClick={() => setIsReceiptModalOpen(false)}>
                  Close
                </Button>
                <Button size="sm" onClick={handlePrintReceipt} className="gap-2">
                  <Printer className="h-4 w-4" />
                  Print / Save PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
