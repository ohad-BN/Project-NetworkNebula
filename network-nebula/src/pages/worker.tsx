import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  Radio,
  Sliders,
  Wallet,
  Copy,
  Check,
  RotateCw,
  HardDrive,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  workersService,
  type ClusterNodeTelemetry,
} from "@/services/api/workers";
import { toast } from "sonner";

export function WorkerDashboardPage() {
  const [node, setNode] = useState<ClusterNodeTelemetry | null>(null);
  const [allNodes, setAllNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("node-gpu-local-01");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(new Date());

  const loadWorkerData = useCallback(async (targetId?: string) => {
    try {
      const data = await workersService.getClusterTelemetry();
      const nodesList = data.nodes || [];
      setAllNodes(nodesList);

      const searchId = targetId || selectedWorkerId;
      let active = nodesList.find(
        (n) => n.node_id === searchId || n.id === searchId
      );
      if (!active && nodesList.length > 0) {
        active = nodesList.find((n) => n.node_id === "node-gpu-local-01") || nodesList[0];
      }

      if (active) {
        setNode(active);
        setSelectedWorkerId(active.node_id);
      }
      setLastHeartbeat(new Date());
    } catch (err) {
      console.error("Failed to load worker telemetry:", err);
      toast.error("Failed to fetch worker node telemetry");
    } finally {
      setIsLoading(false);
    }
  }, [selectedWorkerId]);

  useEffect(() => {
    loadWorkerData();
    const interval = setInterval(() => loadWorkerData(), 20000);
    return () => clearInterval(interval);
  }, [loadWorkerData]);

  // Handle slider adjustment
  const handleSliderChange = async (newPct: number) => {
    if (!node) return;
    const workerId = node.node_id || node.id;

    // Optimistic update
    setNode((prev) =>
      prev
        ? {
            ...prev,
            vram_allocation_pct: newPct,
            vram_allocated_gb: Number(
              ((prev.vram_total_gb * newPct) / 100).toFixed(2)
            ),
          }
        : null
    );

    try {
      setIsUpdating(true);
      const res = await workersService.updateConfig(workerId, {
        vram_allocation_pct: newPct,
      });
      toast.success(
        `Throttled ${workerId} to ${newPct}% (${res.vram_allocated_gb} GB VRAM ceiling)`
      );
    } catch (err) {
      console.error("Failed to update contribution slider:", err);
      toast.error("Failed to update GPU contribution percentage");
      loadWorkerData(workerId);
    } finally {
      setIsUpdating(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    toast.success("Command copied to clipboard");
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Connecting to GPU worker node...</p>
        </div>
      </div>
    );
  }

  const vramTotal = node?.vram_total_gb || 8.0;
  const vramPct = node?.vram_allocation_pct ?? 80;
  const vramAlloc = node?.vram_allocated_gb || (vramTotal * vramPct) / 100;
  const earnings = node?.total_earnings_usd || 0.0;
  const completedTasks = node?.total_tasks_completed || 0;
  const hourlyRate = node?.hourly_rate_usd || 0.45;
  const isOnline = node?.status === "online";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Cpu className="h-6 w-6 text-primary" />
                Contributor GPU Control Panel
              </h1>
              {node?.tunnel_active && (
                <Badge variant="default" className="bg-emerald-600 gap-1 text-xs">
                  <Radio className="h-3 w-3 animate-pulse" /> WebSocket Tunnel
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your GPU hardware contribution, throttle VRAM limits, and audit accrued earnings
            </p>
          </div>

          <div className="flex items-center gap-2">
            {allNodes.length > 1 && (
              <select
                value={selectedWorkerId}
                onChange={(e) => {
                  setSelectedWorkerId(e.target.value);
                  loadWorkerData(e.target.value);
                }}
                className="text-xs bg-muted border border-border rounded-md px-2.5 py-1.5 font-mono text-foreground"
              >
                {allNodes.map((n) => (
                  <option key={n.node_id} value={n.node_id}>
                    {n.name} ({n.node_id.slice(0, 16)})
                  </option>
                ))}
              </select>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadWorkerData()}
              className="gap-1.5 h-8 text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Sync
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
        {/* Top 3 Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Node Status Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Hardware Node Status
                </span>
                <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-emerald-600 text-xs gap-1" : ""}>
                  {isOnline ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Online
                    </>
                  ) : (
                    "Offline"
                  )}
                </Badge>
              </CardTitle>
              <CardDescription>Live physical telemetry</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">GPU Model</p>
                <p className="font-semibold text-sm">{node?.gpu_model || "NVIDIA CUDA Accelerator"}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">CUDA Version:</span>
                  <p className="font-mono">{node?.cuda_version || "12.4"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Compute Role:</span>
                  <p className="font-medium truncate">{node?.role || "LoRA & Serving"}</p>
                </div>
              </div>

              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1">Worker Node Identifier</p>
                <p className="font-mono text-xs bg-muted p-2 rounded truncate">
                  {node?.node_id || selectedWorkerId}
                </p>
              </div>

              {lastHeartbeat && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Last heartbeat: {lastHeartbeat.toLocaleTimeString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Interactive GPU Contribution Slider Card */}
          <Card className="border-primary/40 bg-card/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                GPU Contribution Slider
              </CardTitle>
              <CardDescription>
                Throttling ceiling enforced via PyTorch memory fraction
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/40 p-3 rounded-lg border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Active Ceiling:</span>
                  <span className="font-bold text-lg text-primary">{vramPct}%</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Allocated Compute VRAM:</span>
                  <span className="font-semibold text-foreground">
                    {vramAlloc.toFixed(1)} / {vramTotal.toFixed(1)} GB
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <Slider
                  value={vramPct}
                  min={10}
                  max={100}
                  step={5}
                  disabled={isUpdating}
                  onValueChange={handleSliderChange}
                />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>10% (Low)</span>
                  <span>50% (Balanced)</span>
                  <span>100% (Full Mesh)</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>Zero-Trust: Host processes retain {100 - vramPct}% reserved VRAM</span>
              </div>
            </CardContent>
          </Card>

          {/* Accrued Earnings Summary Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-emerald-500" />
                  Accrued Earnings
                </span>
                <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/40">
                  70% Host Share
                </Badge>
              </CardTitle>
              <CardDescription>Automated SLA task accounting</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Accrued USD</p>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-5 w-5 text-emerald-500" />
                    <span className="text-2xl font-bold font-mono text-emerald-500">
                      ${earnings.toFixed(4)}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Compute Rate</p>
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="text-xl font-bold font-mono">
                      ${hourlyRate.toFixed(2)}
                      <span className="text-xs font-normal text-muted-foreground">/hr</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SLA Tasks Processed:</span>
                  <span className="font-semibold font-mono">{completedTasks} completed</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawable Status:</span>
                  <span className="font-medium text-emerald-500">
                    {earnings >= 10 ? "Eligible (Min $10.00)" : "Accumulating"}
                  </span>
                </div>
              </div>

              <Link to="/wallet" className="block pt-1">
                <Button variant="outline" size="sm" className="w-full">
                  Withdraw to Wallet
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Quick CLI Commands Widget */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" />
              Worker Node CLI Commands (Windows PowerShell / Linux)
            </CardTitle>
            <CardDescription>
              Launch or reconfigure the standalone daemon directly from your command line
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-md font-mono text-xs border border-slate-800">
              <span className="truncate mr-2">
                python nebula_worker.py join --worker-id {node?.node_id || "node-gpu-local-01"} --vram-pct {vramPct} --tunnel
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-300 hover:text-white shrink-0"
                onClick={() =>
                  copyToClipboard(
                    `python nebula_worker.py join --worker-id ${node?.node_id || "node-gpu-local-01"} --vram-pct ${vramPct} --tunnel`,
                    "join"
                  )
                }
              >
                {copiedCmd === "join" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-md font-mono text-xs border border-slate-800">
              <span className="truncate mr-2">
                python nebula_worker.py set-limit --worker-id {node?.node_id || "node-gpu-local-01"} --vram-pct {vramPct}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-300 hover:text-white shrink-0"
                onClick={() =>
                  copyToClipboard(
                    `python nebula_worker.py set-limit --worker-id ${node?.node_id || "node-gpu-local-01"} --vram-pct ${vramPct}`,
                    "limit"
                  )
                }
              >
                {copiedCmd === "limit" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link to="/cluster" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Activity className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Cluster Fleet</p>
                    <p className="text-sm text-muted-foreground">View all mesh nodes & telemetry</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/wallet" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-emerald-500/10 p-3">
                    <DollarSign className="h-6 w-6 text-emerald-500" />
                  </div>
                  <div>
                    <p className="font-medium">Host Wallet</p>
                    <p className="text-sm text-muted-foreground">Audit transactions & withdraw funds</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/training" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-purple-500/10 p-3">
                    <Cpu className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="font-medium">Training Studio</p>
                    <p className="text-sm text-muted-foreground">Run enterprise LoRA fine-tuning</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}

export default WorkerDashboardPage;
