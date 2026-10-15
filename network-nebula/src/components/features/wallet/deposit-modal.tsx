import { useState } from "react";
import { useWalletStore } from "@/stores/wallet-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Bitcoin, Loader2, CheckCircle2 } from "lucide-react";

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_AMOUNTS = [10, 25, 50, 100];

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const [amount, setAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "crypto">("card");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { deposit } = useWalletStore();

  const handlePresetClick = (value: number) => {
    setAmount(value.toString());
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d+\.?\d{0,2}$/.test(value)) {
      setAmount(value);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      await deposit(numAmount, paymentMethod);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setAmount("");
        onOpenChange(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("");
      setError(null);
      setIsSuccess(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Funds</DialogTitle>
          <DialogDescription>
            Deposit funds into your wallet to create AI rendering tasks.
          </DialogDescription>
        </DialogHeader>

        {isSuccess ? (
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
            <p className="text-lg font-medium text-green-600">Deposit Successful!</p>
            <p className="text-sm text-muted-foreground">
              ${amount} has been added to your wallet.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label>Quick Amount</Label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AMOUNTS.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={amount === value.toString() ? "default" : "outline"}
                      onClick={() => handlePresetClick(value)}
                      disabled={isProcessing}
                    >
                      ${value}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Custom Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={handleAmountChange}
                    className="pl-7"
                    disabled={isProcessing}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={paymentMethod === "card" ? "default" : "outline"}
                    onClick={() => setPaymentMethod("card")}
                    disabled={isProcessing}
                    className="flex gap-2"
                  >
                    <CreditCard className="h-4 w-4" />
                    Card
                  </Button>
                  <Button
                    type="button"
                    variant={paymentMethod === "crypto" ? "default" : "outline"}
                    onClick={() => setPaymentMethod("crypto")}
                    disabled={isProcessing}
                    className="flex gap-2"
                  >
                    <Bitcoin className="h-4 w-4" />
                    Crypto
                  </Button>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isProcessing || !amount || parseFloat(amount) <= 0}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>Deposit ${amount || "0"}</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
