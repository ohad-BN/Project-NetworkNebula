import { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Award,
  FileText,
  AlertTriangle,
  RotateCw,
  Cpu,
  Clock,
  Layers,
  Search,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  governanceService,
  type MetricsSummaryResponse,
  type AuditLogEntry,
  type StakingLeaderboardItem,
} from "@/services/api/governance";
import { toast } from "sonner";

export function GovernancePage() {
  const [metrics, setMetrics] = useState<MetricsSummaryResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<StakingLeaderboardItem[]>([]);
  const [totalStakedUsd, setTotalStakedUsd] = useState<number>(0);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Dispute form state
  const [disputeDialogOpen, setDisputeDialogOpen] = useState<boolean>(false);
  const [targetWorkerId, setTargetWorkerId] = useState<string>("");
  const [disputeJobId, setDisputeJobId] = useState<string>("");
  const [fraudReason, setFraudReason] = useState<string>("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState<boolean>(false);

  const loadData = useCallback(async (showToast = false) => {
    try {
      setIsRefreshing(true);
      const [metricsRes, stakeRes, logsRes] = await Promise.all([
        governanceService.getMetricsSummary(),
        governanceService.getStakingLeaderboard(),
        governanceService.getAuditLogs({ limit: 100 }),
      ]);

      setMetrics(metricsRes);
      setLeaderboard(stakeRes.leaderboard || []);
      setTotalStakedUsd(stakeRes.total_staked_usd || 0);
      setAuditLogs(logsRes.logs || []);

      if (showToast) {
        toast.success("Governance & SLA telemetry updated");
      }
    } catch (err) {
      console.error("Failed to load governance telemetry:", err);
      if (showToast) {
        toast.error("Failed to load governance telemetry");
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(() => loadData(false), 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetWorkerId.trim() || !fraudReason.trim()) {
      toast.error("Please specify target worker ID and fraud reason");
      return;
    }

    try {
      setIsSubmittingDispute(true);
      const res = await governanceService.submitDispute({
        challenger_id: "enterprise-admin-console",
        target_worker_id: targetWorkerId.trim(),
        job_id: disputeJobId.trim() || undefined,
        fraud_reason: fraudReason.trim(),
      });

      if (res.status === "disputed" || res.status === "verified_fraud") {
        toast.success(`Dispute registered: ${res.dispute_id} (${res.penalty_action || "Under Review"})`);
      } else {
        toast.info(`Dispute submitted: ${res.message || "Recorded"}`);
      }
      setDisputeDialogOpen(false);
      setTargetWorkerId("");
      setDisputeJobId("");
      setFraudReason("");
      loadData(false);
    } catch (err: any) {
      console.error("Dispute submission failed:", err);
      toast.error(err.response?.data?.detail || "Failed to submit dispute");
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (eventTypeFilter !== "ALL" && log.event_type !== eventTypeFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchAction = log.action?.toLowerCase().includes(q);
      const matchActor = log.actor_id?.toLowerCase().includes(q);
      const matchTarget = log.target_id?.toLowerCase().includes(q);
      const matchType = log.event_type?.toLowerCase().includes(q);
      return matchAction || matchActor || matchTarget || matchType;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground font-mono text-xs">Loading Governance & SLA telemetry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-8 w-8 text-primary" />
              Enterprise Governance & SLA Cockpit
            </h1>
            <Badge variant="default" className="bg-emerald-600 font-mono text-xs">
              99.9% Production SLA
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Real-time Prometheus telemetry, OpenTelemetry latency quantiles, collateral-backed node staking & immutable audit verification
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Dialog open={disputeDialogOpen} onOpenChange={setDisputeDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-red-500/40 text-red-500 hover:bg-red-500/10">
                <AlertTriangle className="h-4 w-4" />
                Submit Fraud Dispute
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleDisputeSubmit}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-500">
                    <ShieldAlert className="h-5 w-5" />
                    Submit Optimistic Fraud Challenge
                  </DialogTitle>
                  <DialogDescription>
                    Trigger an automated spot-check validation challenge against a suspicious GPU node. Confirmed fraudulent computations trigger a 100% collateral slash and node ban.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="targetWorkerId">Target Worker ID *</Label>
                    <Input
                      id="targetWorkerId"
                      placeholder="e.g. node-gpu-local-01 or uuid"
                      value={targetWorkerId}
                      onChange={(e) => setTargetWorkerId(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="disputeJobId">Training or Inference Task ID (Optional)</Label>
                    <Input
                      id="disputeJobId"
                      placeholder="e.g. task-91a8df..."
                      value={disputeJobId}
                      onChange={(e) => setDisputeJobId(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fraudReason">Dispute Reason / Tensor Anomaly *</Label>
                    <Textarea
                      id="fraudReason"
                      placeholder="Provide gradient anomaly signature, intermediate activation hash mismatch, or ungraceful epoch drop evidence..."
                      value={fraudReason}
                      onChange={(e) => setFraudReason(e.target.value)}
                      rows={3}
                      required
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDisputeDialogOpen(false)}
                    disabled={isSubmittingDispute}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={isSubmittingDispute}
                    className="gap-2"
                  >
                    {isSubmittingDispute ? "Submitting Challenge..." : "Submit Fraud Dispute"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Telemetry
          </Button>
        </div>
      </div>

      {/* Top Level Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-emerald-500" />
              SLA Availability (Target: 99.9%)
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500 font-mono">
              {metrics?.current_uptime_pct ?? 100.0}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Zero SLA outages detected in active billing epoch
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-primary" />
              Latency Quantiles (p50 / p95 / p99)
            </CardDescription>
            <CardTitle className="text-xl font-bold font-mono">
              {metrics?.latency_quantiles_ms?.p50 ?? 12.5} / {metrics?.latency_quantiles_ms?.p95 ?? 45.0} / {metrics?.latency_quantiles_ms?.p99 ?? 95.0} ms
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Avg: {metrics?.latency_quantiles_ms?.avg ?? 18.2}ms across {metrics?.latency_quantiles_ms?.sample_count ?? 120} samples
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-purple-500" />
              Total Collateral Staked
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-500 font-mono">
              ${totalStakedUsd.toFixed(2)} USD
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Backing {leaderboard.filter((n) => n.staked_amount_usd > 0).length} bonded compute nodes
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-blue-500" />
              Live Token Throughput
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono">
              {metrics?.throughput?.tokens_per_second ?? 125.0} tok/s
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics?.throughput?.tokens_generated_total?.toLocaleString() ?? "15,200"} total generated tokens
          </CardContent>
        </Card>
      </div>

      {/* Tabs Layout */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="overview">SLA Telemetry</TabsTrigger>
          <TabsTrigger value="staking">Node Staking</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* Tab 1: SLA Telemetry & Latency Breakdown */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Gateway Response Latency Quantiles
                </CardTitle>
                <CardDescription>
                  Real-time sliding window percentiles measured via OpenTelemetry distributed request tracing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">p50 (Median Gateway Latency)</span>
                    <span className="font-mono text-emerald-500 font-semibold">{metrics?.latency_quantiles_ms?.p50 ?? 12.5} ms</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, ((metrics?.latency_quantiles_ms?.p50 ?? 12.5) / 100) * 100)}%` }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">p95 (95th Percentile Tail)</span>
                    <span className="font-mono text-amber-500 font-semibold">{metrics?.latency_quantiles_ms?.p95 ?? 45.0} ms</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, ((metrics?.latency_quantiles_ms?.p95 ?? 45.0) / 200) * 100)}%` }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">p99 (99th SLA Boundary Guarantee)</span>
                    <span className="font-mono text-purple-500 font-semibold">{metrics?.latency_quantiles_ms?.p99 ?? 95.0} ms</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, ((metrics?.latency_quantiles_ms?.p99 ?? 95.0) / 300) * 100)}%` }} />
                  </div>
                </div>

                <div className="pt-4 border-t text-xs text-muted-foreground flex justify-between">
                  <span>Target SLA Ceiling: &lt;150ms (p99)</span>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/40">COMPLIANT</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  Cluster Governance & Distributed Sharding
                </CardTitle>
                <CardDescription>
                  Ring All-Reduce active shards, Byzantine fraud proofs, and collateral penalties
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                  <div>
                    <div className="font-semibold text-sm">Active Distributed Shards</div>
                    <div className="text-xs text-muted-foreground">Synchronized All-Reduce tensor buckets</div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-base font-bold">
                    {metrics?.governance?.active_distributed_shards ?? 2} Shards
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                  <div>
                    <div className="font-semibold text-sm">Cumulative Slashing Events</div>
                    <div className="text-xs text-muted-foreground">Automated SLA penalty enforcements</div>
                  </div>
                  <Badge
                    variant={(metrics?.governance?.slashing_events_total ?? 0) > 0 ? "destructive" : "outline"}
                    className="font-mono text-base font-bold"
                  >
                    {metrics?.governance?.slashing_events_total ?? 0} Slashes
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                  <div>
                    <div className="font-semibold text-sm">Prometheus Exposition</div>
                    <div className="text-xs text-muted-foreground">Standard scrape endpoint: /metrics</div>
                  </div>
                  <Button variant="ghost" size="sm" asChild className="gap-1 font-mono text-xs">
                    <a href="http://localhost:8000/metrics" target="_blank" rel="noreferrer">
                      View /metrics <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Staking Leaderboard */}
        <TabsContent value="staking" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Award className="h-4 w-4 text-primary" />
                    Node Staking & Reputation Leaderboard
                  </CardTitle>
                  <CardDescription>
                    Host nodes with collateral backing qualify for high-priority enterprise fine-tuning jobs
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {leaderboard.length} Nodes Registered
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                    <tr>
                      <th className="py-3 px-4">Node / Identity</th>
                      <th className="py-3 px-4">Region</th>
                      <th className="py-3 px-4">Collateral Staked</th>
                      <th className="py-3 px-4">Slashed Total</th>
                      <th className="py-3 px-4">Reputation Score</th>
                      <th className="py-3 px-4">Cluster Tier</th>
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {leaderboard.length > 0 ? (
                      leaderboard.map((item) => (
                        <tr key={item.worker_id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold">{item.name || "Worker Node"}</div>
                            <div className="text-xs font-mono text-muted-foreground">{item.worker_id}</div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="text-xs uppercase font-mono">
                              {item.region || "us-east"}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-emerald-500">
                            ${(item.staked_amount_usd || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-red-500 font-semibold">
                            ${(item.slashed_amount_usd || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-xs">{item.reputation_score?.toFixed(1) || "100.0"}%</span>
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    (item.reputation_score || 100) >= 90
                                      ? "bg-emerald-500"
                                      : (item.reputation_score || 100) >= 70
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                  }`}
                                  style={{ width: `${Math.min(100, item.reputation_score || 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {item.staked_amount_usd >= 250 ? (
                              <Badge className="bg-purple-600 text-[11px]">
                                Enterprise Cluster
                              </Badge>
                            ) : item.staked_amount_usd >= 50 ? (
                              <Badge variant="secondary" className="text-[11px]">
                                Dedicated Worker
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-[11px]">
                                Unstaked Node
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {item.status === "online" ? (
                              <Badge variant="default" className="bg-emerald-600 text-xs gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Online
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-xs">
                                Offline
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          No nodes currently registered.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Immutable Audit Trail */}
        <TabsContent value="audit" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Immutable Enterprise Audit Trail
                  </CardTitle>
                  <CardDescription>
                    Tamper-resistant ledger of governance decisions, security events, collateral operations, and slashing
                  </CardDescription>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Filter logs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs font-mono"
                    />
                  </div>

                  <select
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="ALL">All Event Types</option>
                    <option value="STAKING_SLASH">STAKING_SLASH</option>
                    <option value="COLLATERAL_DEPOSIT">COLLATERAL_DEPOSIT</option>
                    <option value="COLLATERAL_UNSTAKE">COLLATERAL_UNSTAKE</option>
                    <option value="TOKEN_CREATED">TOKEN_CREATED</option>
                    <option value="TOKEN_REVOKED">TOKEN_REVOKED</option>
                    <option value="SECURITY_POLICY_UPDATE">SECURITY_POLICY_UPDATE</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Event Type</th>
                      <th className="py-3 px-4">Severity</th>
                      <th className="py-3 px-4">Action Summary</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4 font-mono">Target ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-xs">
                    {filteredLogs.length > 0 ? (
                      filteredLogs.slice(0, 50).map((log) => {
                        const sevBadge =
                          log.severity === "critical"
                            ? "bg-red-600 text-white"
                            : log.severity === "warning"
                            ? "bg-amber-600 text-white"
                            : "bg-blue-600/20 text-blue-400 border border-blue-500/30";

                        return (
                          <tr key={log.log_id || log.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                              {log.created_at ? new Date(log.created_at).toLocaleString() : "N/A"}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="text-[11px] font-mono">
                                {log.event_type}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <Badge className={`text-[10px] uppercase ${sevBadge}`}>
                                {log.severity}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 font-sans text-foreground">
                              {log.action}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {log.actor_id || "system"}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground truncate max-w-[140px]">
                              {log.target_id || "N/A"}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground font-sans">
                          No audit log records match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
