import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface WalletBalanceProps {
  balance: number;
  currency?: string;
  showLink?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function WalletBalance({
  balance,
  currency = "USD",
  showLink = false,
  size = "md",
  className,
}: WalletBalanceProps) {
  const formattedBalance = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(balance);

  const sizeClasses = { sm: "text-sm", md: "text-base", lg: "text-2xl font-bold" };
  const iconSizes = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" };

  const content = (
    <div className={cn("inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2", sizeClasses[size], className)}>
      <Wallet className={iconSizes[size]} />
      <span>{formattedBalance}</span>
    </div>
  );

  return showLink ? <Link to="/wallet" className="inline-block">{content}</Link> : content;
}
