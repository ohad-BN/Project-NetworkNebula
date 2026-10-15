import { useState } from "react";
import { useWalletStore } from "@/stores/wallet-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WithdrawModal({ open, onOpenChange }: WithdrawModalProps) {
  const { balance, withdraw, isLoading, error } = useWalletStore();
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const minWithdraw = 10;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      setValidationError(null);
    }
  };

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAddress(e.target.value);
    setValidationError(null);
  };

  const validate = (): boolean => {
    if (amountNum < minWithdraw) {
      setValidationError("Minimum withdrawal is $" + minWithdraw);
      return false;
    }
    if (amountNum > balance) {
      setValidationError("Insufficient balance");
      return false;
    }
    if (!address.trim()) {
      setValidationError("Please enter a payment address");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await withdraw(amountNum, address);
      setAmount("");
      setAddress("");
      onOpenChange(false);
    } catch {
      // Error is handled by the store
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setAmount("");
      setAddress("");
      setValidationError(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Withdraw Funds</DialogTitle>
            <DialogDescription>
              Enter the amount and destination address to withdraw your earnings.
              Minimum withdrawal: $${minWithdraw}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Amount (USD)</Label>
              <Input
                id="withdraw-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={handleAmountChange}
                disabled={isLoading}
              />
              <p className="text-sm text-muted-foreground">
                Available: $${balance.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdraw-address">Payment Address</Label>
              <Input
                id="withdraw-address"
                type="text"
                placeholder="Enter wallet or payment address"
                value={address}
                onChange={handleAddressChange}
                disabled={isLoading}
              />
            </div>

            {(validationError || error) && (
              <p className="text-sm text-red-500">
                {validationError || error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={isLoading || amountNum <= 0 || !address.trim()}
              className="w-full"
            >
              {isLoading ? "Processing..." : "Withdraw $" + amountNum.toFixed(2)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
