import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ShieldCheck,
  Wallet,
  Key,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Activity,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/services/api/client";
import { useAuthStore } from "@/stores/auth-store";

interface UserProfileData {
  id: string;
  email: string;
  name: string;
  role: "creator" | "worker";
  is_worker: boolean;
  balance: number;
  total_earned: number;
  is_verified: boolean;
  invited_by_code: string;
  api_key: string;
  api_key_masked: string;
  created_at: string;
  stats: {
    total_tasks: number;
    completed_tasks: number;
    total_training_jobs: number;
    completed_training_jobs: number;
    active_api_tokens: number;
  };
}

interface ActivityEvent {
  id: string;
  category: "security" | "wallet" | "training" | "task";
  title: string;
  description: string;
  timestamp: string;
  status: "success" | "pending" | "running" | "info" | "warning";
  metadata?: Record<string, any>;
}

export function ProfilePage() {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [profRes, actRes] = await Promise.all([
        apiClient.get<UserProfileData>("/api/v1/user/profile"),
        apiClient.get<ActivityEvent[]>("/api/v1/user/activity"),
      ]);
      setProfile(profRes.data);
      setActivity(actRes.data);
    } catch {
      toast.error("Failed to load profile data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCopyKey = () => {
    if (!profile?.api_key) return;
    navigator.clipboard.writeText(profile.api_key);
    setCopiedKey(true);
    toast.success("API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyId = () => {
    if (!profile?.id) return;
    navigator.clipboard.writeText(profile.id);
    setCopiedId(true);
    toast.success("User UUID copied");
    setTimeout(() => setCopiedId(false), 2000);
  };

  const filteredActivity =
    categoryFilter === "all"
      ? activity
      : activity.filter((item) => item.category === categoryFilter);

  const displayUser = profile || user;

  return (
    <div className="container mx-auto max-w-6xl py-8 px-4 sm:px-6 space-y-8">
      {/* 1. Header Profile Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-background to-card p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-black text-white shadow-lg shadow-indigo-500/25">
              {displayUser?.email ? displayUser.email.charAt(0).toUpperCase() : "U"}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {displayUser?.name || displayUser?.email?.split("@")[0]}
                </h1>
                <Badge
                  variant="outline"
                  className={
                    displayUser?.role === "worker"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[11px]"
                      : "border-indigo-500/30 bg-indigo-500/10 text-indigo-400 font-mono text-[11px]"
                  }
                >
                  {displayUser?.role === "worker" ? "⚡ GPU Host Provider" : "💻 AI Creator & Developer"}
                </Badge>
                {profile?.is_verified && (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[11px] gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Verified Alpha Tester
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                <span className="font-mono text-foreground/80">{displayUser?.email}</span>
                <span>•</span>
                <span>UUID: <span className="font-mono">{displayUser?.id ? `${displayUser.id.substring(0, 8)}...` : ""}</span></span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="hover:text-foreground text-muted-foreground transition-colors"
                  title="Copy User ID"
                >
                  {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </button>
                <span>•</span>
                <span>Joined: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "Active"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading} className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Link to="/wallet">
              <Button size="sm" className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium shadow-sm">
                <Wallet className="h-3.5 w-3.5" />
                <span>Wallet (${profile?.balance?.toFixed(2) ?? "0.00"})</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 2. Key Resource Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Compute Balance</CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-amber-400">
              ${profile?.balance?.toFixed(2) ?? "0.00"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Includes faucet grants</span>
            <Link to="/wallet" className="text-primary hover:underline flex items-center gap-0.5">
              Refill <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Fine-Tuning Runs</CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-indigo-400">
              {profile?.stats.total_training_jobs ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{profile?.stats.completed_training_jobs ?? 0} completed</span>
            <Link to="/training" className="text-primary hover:underline flex items-center gap-0.5">
              Launch <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Inference Tasks</CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-purple-400">
              {profile?.stats.total_tasks ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{profile?.stats.completed_tasks ?? 0} completed</span>
            <Link to="/jobs" className="text-primary hover:underline flex items-center gap-0.5">
              History <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">API Tokens</CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-emerald-400">
              {profile?.stats.active_api_tokens ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Scoped keys</span>
            <Link to="/api-tokens" className="text-primary hover:underline flex items-center gap-0.5">
              Manage <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* 3. Credentials & Quick-Connect SDK */}
      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            Active Master API Key & OpenAI Drop-In Configuration
          </CardTitle>
          <CardDescription>
            Use this key to authenticate any OpenAI SDK or automated cURL script from external machines
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-xs flex items-center justify-between">
              <span className="text-foreground tracking-wider">{profile?.api_key || "No key available"}</span>
              <Badge variant="outline" className="text-[10px] uppercase font-mono">Master Key</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyKey}
              className="gap-1.5 h-9 shrink-0"
            >
              {copiedKey ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              <span>{copiedKey ? "Copied" : "Copy Key"}</span>
            </Button>
          </div>

          <div className="p-3.5 rounded-xl bg-black/40 border border-border/80 font-mono text-xs text-muted-foreground space-y-1">
            <div className="text-[11px] font-semibold text-indigo-400"># Drop-in OpenAI Client Example (Python)</div>
            <div className="text-foreground font-mono">
              from openai import OpenAI<br />
              client = OpenAI(base_url="http://localhost:8000/v1", api_key="{profile?.api_key ? `${profile.api_key.substring(0, 16)}...` : 'sk-...'}")
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Unified Activity Timeline (Chronological Cross-Device History) */}
      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-400" />
                Account Activity & Audit Timeline
              </CardTitle>
              <CardDescription>
                Chronological ledger of logins, fine-tuning jobs, compute grants, and inference tasks
              </CardDescription>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg text-xs font-medium self-start sm:self-auto">
              {["all", "wallet", "training", "task", "security"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-md transition-all uppercase tracking-wider text-[10px] ${
                    categoryFilter === cat
                      ? "bg-background text-foreground shadow-sm font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && activity.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs flex flex-col items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span>Loading activity ledger...</span>
            </div>
          ) : filteredActivity.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs flex flex-col items-center gap-2">
              <AlertCircle className="h-6 w-6 text-muted-foreground/60" />
              <span>No activity recorded under this filter yet.</span>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-border/60">
              {filteredActivity.map((event) => {
                const dateStr = new Date(event.timestamp).toLocaleString();
                const isWallet = event.category === "wallet";
                const isTraining = event.category === "training";
                const isTask = event.category === "task";

                return (
                  <div key={event.id} className="relative group">
                    {/* Timeline bullet dot */}
                    <div
                      className={`absolute -left-[27px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background transition-transform group-hover:scale-125 ${
                        isWallet
                          ? "bg-amber-400"
                          : isTraining
                          ? "bg-indigo-400"
                          : isTask
                          ? "bg-purple-400"
                          : "bg-emerald-400"
                      }`}
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <span>{event.title}</span>
                        <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider py-0 px-1.5">
                          {event.category}
                        </Badge>
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground">{dateStr}</span>
                    </div>

                    <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
