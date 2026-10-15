import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
  History,
  Plus,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Transaction, PayoutRequest } from "@/types";

interface DailyEarnings {
  day: string;
  amount: number;
}

function EarningsChart({ data }: { data: DailyEarnings[] }) {
  const maxAmount = Math.max(...data.map((d) => d.amount), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Daily Earnings
        </CardTitle>
        <CardDescription>Earnings for the last 7 days</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2 h-40 pt-4">
          {data.map((item, index) => {
            const heightPercent = (item.amount / maxAmount) * 100;
            return (
              <div key={index} className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full bg-muted rounded-t-sm relative" style={{ height: "120px" }}>
                  <div
                    className="absolute bottom-0 w-full bg-primary rounded-t-sm transition-all duration-300"
                    style={{ height: `${heightPercent}%`, minHeight: item.amount > 0 ? "4px" : "0" }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{item.day}</span>
                <span className="text-xs font-medium">${item.amount.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionList({ transactions }: { transactions: Transaction[] }) {
  const getIcon = (type: string) => {
    switch (type) {
      case "earning":
        return <ArrowDownCircle className="h-4 w-4 text-green-500" />;
      case "payout":
        return <ArrowUpCircle className="h-4 w-4 text-blue-500" />;
      case "deposit":
        return <Plus className="h-4 w-4 text-green-500" />;
      case "withdraw":
        return <ArrowUpCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <DollarSign className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "default";
      case "pending":
        return "secondary";
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" />
          Recent Transactions
        </CardTitle>
        <CardDescription>Your recent earnings and payouts</CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between pb-4 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-2">{getIcon(tx.type)}</div>
                  <div>
                    <p className="text-sm font-medium capitalize">{tx.type}</p>
                    <p className="text-xs text-muted-foreground">{tx.description || tx.created_at}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${tx.type === "earning" ? "text-green-600" : ""}`}>
                    {tx.type === "earning" ? "+" : "-"}${Math.abs(tx.amount).toFixed(2)}
                  </p>
                  <Badge variant={getStatusColor(tx.status)} className="text-xs">
                    {tx.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PayoutRequestForm({
  pendingPayout,
  onSubmit,
}: {
  pendingPayout: number;
  onSubmit: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (numAmount > pendingPayout) {
      setError(`Amount exceeds available balance ($${pendingPayout.toFixed(2)})`);
      return;
    }

    setIsSubmitting(true);
    try {
      onSubmit(numAmount);
      setAmount("");
    } catch {
      setError("Failed to submit payout request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Request Payout
        </CardTitle>
        <CardDescription>Withdraw your earnings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 rounded-lg bg-muted">
          <p className="text-sm text-muted-foreground">Available for withdrawal</p>
          <p className="text-2xl font-bold">${pendingPayout.toFixed(2)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={pendingPayout.toString()}
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAmount((pendingPayout * 0.5).toFixed(2))}
              disabled={isSubmitting}
            >
              50%
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAmount(pendingPayout.toFixed(2))}
              disabled={isSubmitting}
            >
              Max
            </Button>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || pendingPayout <= 0}>
            {isSubmitting ? "Submitting..." : "Request Payout"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function WorkerEarningsPage() {
  const [payoutRequests] = useState<PayoutRequest[]>([]);

  const last7Days: DailyEarnings[] = [
    { day: "Mon", amount: 12.5 },
    { day: "Tue", amount: 18.75 },
    { day: "Wed", amount: 8.25 },
    { day: "Thu", amount: 22.0 },
    { day: "Fri", amount: 15.5 },
    { day: "Sat", amount: 28.0 },
    { day: "Sun", amount: 19.25 },
  ];

  const transactions: Transaction[] = [
    {
      id: "tx-001",
      user_id: "user-123",
      type: "earning",
      amount: 2.5,
      currency: "USD",
      status: "completed",
      created_at: "2024-01-15T10:30:00Z",
      description: "Task #task-001 completed",
    },
    {
      id: "tx-002",
      user_id: "user-123",
      type: "earning",
      amount: 3.75,
      currency: "USD",
      status: "completed",
      created_at: "2024-01-15T14:20:00Z",
      description: "Task #task-002 completed",
    },
    {
      id: "tx-003",
      user_id: "user-123",
      type: "payout",
      amount: 25.0,
      currency: "USD",
      status: "completed",
      created_at: "2024-01-14T09:00:00Z",
      description: "Payout to wallet",
    },
    {
      id: "tx-004",
      user_id: "user-123",
      type: "earning",
      amount: 1.25,
      currency: "USD",
      status: "pending",
      created_at: "2024-01-16T08:15:00Z",
      description: "Task #task-003 in progress",
    },
  ];

  const totalEarnings = transactions.filter((t) => t.type === "earning").reduce((sum, t) => sum + t.amount, 0);
  const pendingPayout = totalEarnings * 0.7;

  const handlePayoutRequest = (amount: number) => {
    console.log("Payout requested:", amount);
    alert(`Payout request for $${amount.toFixed(2)} submitted successfully!`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Earnings</h1>
          <p className="text-sm text-muted-foreground">Track your earnings and request payouts</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <EarningsChart data={last7Days} />
            <TransactionList transactions={transactions} />
          </div>

          <div className="space-y-6">
            <PayoutRequestForm pendingPayout={pendingPayout} onSubmit={handlePayoutRequest} />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payout History</CardTitle>
              </CardHeader>
              <CardContent>
                {payoutRequests.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No payout requests</p>
                ) : (
                  <div className="space-y-3">
                    {payoutRequests.map((request) => (
                      <div key={request.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{request.created_at}</span>
                        <span className="font-medium">${request.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
