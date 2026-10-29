import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, KeyRound, MailCheck, Sparkles, CheckCircle2, Info, Trash2 } from "lucide-react";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register, verifyEmail, resendVerificationCode, isLoading, error, clearError } = useAuth();
  
  // Step 1 State: Account Details & Alpha Code
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"creator" | "worker">("creator");
  const [inviteCode, setInviteCode] = useState("NEBULA-ALPHA-2026");
  const [acceptTerms, setAcceptTerms] = useState(true);
  const [passwordError, setPasswordError] = useState("");

  // Step 2 State: 6-Digit Email OTP Verification
  const [step, setStep] = useState<"register" | "verify">("register");
  const [otpCode, setOtpCode] = useState("");
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendStatus, setResendStatus] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setPasswordError("");

    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    if (!acceptTerms) {
      setPasswordError("Please accept the terms and conditions");
      return;
    }

    try {
      const res = await register(email, password, role, inviteCode);
      if (res && res.is_verified) {
        navigate(role === "worker" ? "/worker" : "/");
      } else {
        if (res?.dev_otp) {
          setOtpCode(res.dev_otp);
          setDevOtp(res.dev_otp);
        }
        // Transition to 6-digit email OTP verification step
        setStep("verify");
      }
    } catch {
      // Error handled by store
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError("");
    setIsVerifying(true);

    try {
      await verifyEmail(email, otpCode);
      setVerifySuccess(true);
      setTimeout(() => {
        navigate(role === "worker" ? "/worker" : "/");
      }, 1500);
    } catch (err: any) {
      setVerifyError(err.message || "Failed to verify code. Please double-check the 6-digit code.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setResendStatus("Resending code...");
    try {
      await resendVerificationCode(email);
      setResendStatus("New 6-digit OTP code sent!");
      setTimeout(() => setResendStatus(""), 4000);
    } catch {
      setResendStatus("Failed to resend code.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md border-border/80 shadow-2xl">
        {step === "register" ? (
          <>
            <CardHeader className="space-y-1 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/25 mb-2">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <CardTitle className="text-2xl font-bold">Join Closed Alpha</CardTitle>
              <CardDescription>
                Create your account to access decentralized AI compute
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
                    {error}
                  </div>
                )}

                {passwordError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
                    {passwordError}
                  </div>
                )}

                {/* Closed Alpha Invite Code */}
                <div className="space-y-1.5 p-3 rounded-lg bg-muted/40 border border-indigo-500/30">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="invite-code" className="text-xs font-semibold flex items-center gap-1.5 text-indigo-400">
                      <KeyRound className="h-3.5 w-3.5" />
                      Alpha Access Code
                    </Label>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                      Required
                    </span>
                  </div>
                  <Input
                    id="invite-code"
                    type="text"
                    placeholder="NEBULA-ALPHA-2026"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    required
                    disabled={isLoading}
                    className="font-mono text-xs uppercase tracking-wider bg-background"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Grants instant verification + $100.00 Alpha Compute Credits faucet.
                  </p>
                </div>

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
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Workspace Role</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole("creator")}
                      className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-medium transition-all ${
                        role === "creator"
                          ? "border-indigo-500 bg-indigo-500/10 text-foreground font-semibold"
                          : "border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="font-bold text-sm">💻 Creator</span>
                      <span className="text-[11px] text-muted-foreground mt-0.5 text-center">Run AI jobs & models</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("worker")}
                      className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-medium transition-all ${
                        role === "worker"
                          ? "border-emerald-500 bg-emerald-500/10 text-foreground font-semibold"
                          : "border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="font-bold text-sm">⚡ Worker</span>
                      <span className="text-[11px] text-muted-foreground mt-0.5 text-center">Share GPU & earn</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-start space-x-2 pt-1">
                  <input
                    id="terms"
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="mt-1 rounded border-input"
                    disabled={isLoading}
                  />
                  <Label htmlFor="terms" className="text-xs font-normal text-muted-foreground leading-tight cursor-pointer">
                    I agree to the Alpha Testing Terms of Service and acknowledge all transactions utilize testnet credits.
                  </Label>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col space-y-4">
                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium shadow-md shadow-indigo-500/20"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    "Create Account & Continue"
                  )}
                </Button>

                <p className="text-sm text-muted-foreground text-center">
                  Already have an account?{" "}
                  <Link to="/login" className="text-primary hover:underline font-medium">
                    Sign in
                  </Link>
                </p>
              </CardFooter>
            </form>
          </>
        ) : (
          /* Step 2: 6-Digit OTP Verification Screen */
          <>
            <CardHeader className="space-y-1 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 mb-2">
                <MailCheck className="h-6 w-6 text-white" />
              </div>
              <CardTitle className="text-2xl font-bold">Verify Your Email</CardTitle>
              <CardDescription>
                We sent a 6-digit verification code to{" "}
                <span className="font-mono text-foreground font-semibold">{email}</span>
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleVerifyOtp}>
              <CardContent className="space-y-4">
                {devOtp && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                    <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-semibold text-amber-200">Local Dev Simulation Mode:</span> No external email provider configured in <code className="bg-black/40 px-1 py-0.5 rounded text-[11px] font-mono">.env</code>.
                      <br />
                      Your 6-digit OTP code is: <strong className="font-mono text-sm tracking-wider text-amber-100">{devOtp}</strong> (pre-filled).
                    </div>
                  </div>
                )}

                {verifySuccess ? (
                  <div className="p-4 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-center flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400 animate-bounce" />
                    <div className="font-bold text-sm">Account Verified!</div>
                    <div className="text-xs text-emerald-300">+$100.00 Alpha Compute Credits added to your wallet. Redirecting...</div>
                  </div>
                ) : (
                  <>
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
                        Check your inbox or console for the 6-digit OTP code (valid for 15 mins).
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <button
                        type="button"
                        onClick={handleResend}
                        className="text-indigo-400 hover:underline font-medium"
                      >
                        Resend verification code
                      </button>
                      {resendStatus && (
                        <span className="text-muted-foreground">{resendStatus}</span>
                      )}
                    </div>
                  </>
                )}
              </CardContent>

              <CardFooter className="flex flex-col space-y-3">
                {!verifySuccess && (
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-medium"
                    disabled={isVerifying || otpCode.length !== 6}
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying & Claiming Credits...
                      </>
                    ) : (
                      "Verify & Claim $100 Credits"
                    )}
                  </Button>
                )}

                <div className="flex items-center justify-between w-full pt-2 border-t border-border/60 text-xs">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Cancel pending registration for ${email}? All unverified details will be completely deleted.`)) return;
                      try {
                        await apiClient.post("/auth/cancel-registration", { email });
                        toast.success("Unverified registration cancelled. Details purged.");
                        setStep("register");
                        setOtpCode("");
                      } catch {
                        toast.error("Failed to cancel registration");
                      }
                    }}
                    className="text-destructive hover:underline flex items-center gap-1 font-medium"
                  >
                    <Trash2 className="h-3 w-3" />
                    Cancel & Delete Registration
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="text-xs text-muted-foreground hover:text-foreground text-center"
                  >
                    Back to sign in
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
