import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { apiClient } from "@/services/api/client";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, verifyEmail, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Unverified Account Step State
  const [step, setStep] = useState<"login" | "verify">("login");
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setVerifyError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("not verified") || msg.toLowerCase().includes("verification required")) {
        setStep("verify");
      }
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError("");
    setIsVerifying(true);
    try {
      await verifyEmail(email, otpCode);
      toast.success("Account verified! +$100.00 credits added to your wallet.");
      // Re-login with credentials
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setVerifyError(err.message || "Failed to verify code. Please check your OTP.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (!confirm(`Are you sure you want to cancel registration for ${email}? All unverified details will be completely deleted.`)) {
      return;
    }
    setIsCancelling(true);
    try {
      await apiClient.post("/auth/cancel-registration", { email });
      toast.success("Pending unverified registration cancelled. Details purged.");
      setStep("login");
      setEmail("");
      setPassword("");
      setOtpCode("");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to cancel registration");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md border-border/80 shadow-2xl">
        {step === "login" ? (
          <>
            <CardHeader className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
              <CardDescription>
                Sign in to your Network Nebula developer console or host portal
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="remember"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-input text-primary"
                      disabled={isLoading}
                    />
                    <span className="text-muted-foreground">Remember me</span>
                  </label>
                  <Link to="/register" className="text-primary hover:underline font-medium">
                    Need an account?
                  </Link>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col space-y-4">
                <Button type="submit" className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>

                <p className="text-sm text-muted-foreground text-center">
                  Don't have an account?{" "}
                  <Link to="/register" className="text-primary hover:underline font-medium">
                    Join Closed Alpha
                  </Link>
                </p>
              </CardFooter>
            </form>
          </>
        ) : (
          /* Step: Unverified Account OTP Screen */
          <>
            <CardHeader className="space-y-1 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 mb-2">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl font-bold">Verification Required</CardTitle>
              <CardDescription>
                Account <span className="font-mono text-foreground font-semibold">{email}</span> has not been verified yet.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleVerifyOtp}>
              <CardContent className="space-y-4">
                {verifyError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
                    {verifyError}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-xs font-semibold">6-Digit Verification Code</Label>
                  <Input
                    id="otp"
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    required
                    disabled={isVerifying}
                    className="text-center font-mono text-2xl tracking-[0.5em] py-6"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Check your email inbox or server console for the 6-digit OTP code.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col space-y-3">
                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium"
                  disabled={isVerifying || otpCode.length !== 6}
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying & Activating...
                    </>
                  ) : (
                    "Verify Email & Unlock Account"
                  )}
                </Button>

                <div className="flex items-center justify-between w-full pt-2 border-t border-border/60 text-xs">
                  <button
                    type="button"
                    onClick={() => setStep("login")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Back to login
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelRegistration}
                    disabled={isCancelling}
                    className="text-destructive hover:underline flex items-center gap-1 font-medium"
                  >
                    <Trash2 className="h-3 w-3" />
                    Cancel & Delete Registration
                  </button>
                </div>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
