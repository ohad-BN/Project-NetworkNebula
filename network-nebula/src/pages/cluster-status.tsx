import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  HardDrive,
  Cpu,
  Server,
  RotateCw,
  Copy,
  Check,
  Sliders,
  DollarSign,
  Play,
  Pause,
  Trash2,
  Moon,
  Zap,
  Gamepad2,
  VolumeX,
  GitBranch,
  ArrowUpCircle,
  RefreshCw,
  Globe,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  workersService,
  type ClusterNodeTelemetry,
} from "@/services/api/workers";
import { systemService, type SystemStatusData, type GitCheckUpdateData } from "@/services/api/system";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

export function ClusterStatusPage() {
  const { apiKey: storeApiKey } = useAuthStore();
  const apiKey = storeApiKey || localStorage.getItem("api_key") || "YOUR_API_KEY";

  const [nodes, setNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedJoinCmd, setCopiedJoinCmd] = useState(false);
  const [updatingNodeId, setUpdatingNodeId] = useState<string | null>(null);

  // Central Server & Zero-Touch Deployment state
  const [systemStatus, setSystemStatus] = useState<SystemStatusData | null>(null);
  const [updateCheck, setUpdateCheck] = useState<GitCheckUpdateData | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDeployingUpdate, setIsDeployingUpdate] = useState(false);

  // Fetch Central Server status
  const fetchSystemStatus = useCallback(async () => {
    try {
      const data = await systemService.getStatus();
      setSystemStatus(data);
    } catch {
      // non-blocking
    }
  }, []);

  const handleCheckUpdate = async () => {
    try {
      setIsCheckingUpdate(true);
      const res = await systemService.checkUpdate();
      setUpdateCheck(res);
      if (res.update_available) {
        toast.info(`New update available (${res.commits_behind} commit${res.commits_behind === 1 ? "" : "s"} behind)`);
      } else {
        toast.success("Server is up to date with origin/main");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to check for updates");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleDeployUpdate = async () => {
    try {
      setIsDeployingUpdate(true);
      const res = await systemService.applyUpdate();
      if (res.success) {
        toast.success(`Server updated to ${res.new_commit}! Reloading status...`);
        setUpdateCheck(null);
        await fetchSystemStatus();
      } else {
        toast.error(`Update failed: ${res.message}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to deploy update");
    } finally {
      setIsDeployingUpdate(false);
    }
  };

  // Fetch strictly user's fleet
  const fetchTelemetry = useCallback(async (showToast = false) => {
    try {
      setIsRefreshing(true);
      const res = await workersService.getUserWorkers();
      const userNodes = res.nodes || [];
      setNodes(userNodes);
      if (showToast) {
        toast.success(`Fleet synchronized (${userNodes.length} machine${userNodes.length === 1 ? "" : "s"} active)`);
      }
    } catch (err) {
      console.error("Failed to fetch user fleet telemetry:", err);
      if (showToast) {
        toast.error("Failed to connect to cluster orchestrator");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry(false);
    fetchSystemStatus();
    const interval = setInterval(() => {
      fetchTelemetry(false);
      fetchSystemStatus();
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchTelemetry, fetchSystemStatus]);

  // Handle remote slider adjustment per GPU
  const handleSliderChange = async (targetWorkerId: string, newPct: number, gpuIndex?: number) => {
    try {
      setUpdatingNodeId(`${targetWorkerId}-${gpuIndex ?? 0}`);
      await workersService.updateConfig(targetWorkerId, {
        vram_allocation_pct: newPct,
        gpu_index: gpuIndex,
      });
      toast.success(`Updated ${targetWorkerId}${gpuIndex !== undefined ? ` (GPU ${gpuIndex})` : ""} to ${newPct}% VRAM`);
      await fetchTelemetry(false);
    } catch {
      toast.error("Failed to update GPU allocation limit");
    } finally {
      setUpdatingNodeId(null);
    }
  };

  // Toggle availability (Pause / Resume)
  const handleToggleAvailability = async (targetWorkerId: string, currentAvailable: boolean) => {
    try {
      await workersService.updateConfig(targetWorkerId, {
        is_available: !currentAvailable,
      });
      toast.success(currentAvailable ? "Machine paused (offline for compute)" : "Machine resumed & active");
      await fetchTelemetry(false);
    } catch {
      toast.error("Failed to update machine status");
    }
  };

  // Remove machine
  const handleDeregister = async (targetWorkerId: string) => {
    if (!confirm(`Are you sure you want to remove machine '${targetWorkerId}' from your account?`)) return;
    try {
      await workersService.deregister(targetWorkerId);
      toast.success("Machine removed");
      await fetchTelemetry(false);
    } catch {
      toast.error("Failed to remove machine");
    }
  };

  // Flatten systems into individual GPU rows
  const gpuRows = nodes.flatMap((node) => {
    const gpus = node.gpus && node.gpus.length > 0
      ? node.gpus
      : [{
          index: 0,
          name: node.gpu_model || "GPU Accelerator",
          vram_total_gb: node.gpu_memory_gb || node.vram_total_gb || 8.0,
          vram_allocated_gb: node.vram_allocated_gb || 6.4,
          vram_used_gb: node.vram_used_gb || 0.95,
          vram_allocation_pct: node.vram_allocation_pct || 80,
          gpu_utilization_pct: node.gpu_utilization_pct || 10.0,
          status: node.status,
          is_available: node.is_available,
        }];

    return gpus.map((gpu) => ({
      node,
      gpu,
      key: `${node.node_id || node.id}-gpu-${gpu.index}`,
    }));
  });

  const totalVram = nodes.reduce((acc, n) => acc + (n.vram_total_gb || n.gpu_memory_gb || 0), 0);
  const allocatedVram = nodes.reduce((acc, n) => acc + (n.vram_allocated_gb || 0), 0);
  const totalEarnings = nodes.reduce((acc, n) => acc + (n.total_earnings_usd || 0), 0);
  const totalRate = nodes.reduce((acc, n) => acc + (n.hourly_rate_usd || 0.45), 0);
  const activeMachines = nodes.filter((n) => (n.status === "online" || n.status === "busy") && (n.is_available ?? true)).length;
  const stealthCount = nodes.filter((n) => Boolean(n.is_always_silent) || n.work_capacity_state === "stealth_regulated").length;
  const unleashedCount = nodes.filter((n) => !Boolean(n.is_always_silent) && n.work_capacity_state !== "stealth_regulated").length;

  const originUrl = window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin;
  const joinCmd = `powershell -c "irm ${originUrl}/connect.ps1?key=${apiKey} | iex"`;

  const copyJoinCommand = () => {
    navigator.clipboard.writeText(joinCmd);
    setCopiedJoinCmd(true);
    toast.success("Command copied to clipboard!");
    setTimeout(() => setCopiedJoinCmd(false), 2500);
  };

  return (
    <div className="container max-w-7xl mx-auto py-8 px-4 text-foreground pb-16 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-3xl font-extrabold tracking-tight">
              My GPU Fleet Inventory & Controls
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Real-time management and per-card VRAM contribution controls for all physical GPU accelerators across your connected systems.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchTelemetry(true)}
            disabled={isRefreshing}
            className="gap-2 h-9 text-xs"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Fleet
          </Button>
          <Link to="/worker">
            <Button size="sm" className="gap-2 h-9 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
              <Cpu className="h-4 w-4" />
              Worker Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Fleet Overview Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-primary" />
              Connected Systems
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{nodes.length} Active</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
            {activeMachines} online machine{nodes.length === 1 ? "" : "s"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              Physical GPUs
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-primary">
              {gpuRows.length} Units
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
            Independent accelerators
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-purple-400" />
              Contributed VRAM
            </CardDescription>
            <CardTitle className="text-xl font-bold font-mono">
              {allocatedVram.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ {totalVram.toFixed(1)} GB</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
            Active allocation ceiling
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <VolumeX className="h-3.5 w-3.5 text-cyan-400" />
              Regulation State
            </CardDescription>
            <CardTitle className="text-lg font-bold text-cyan-300 font-mono">
              {stealthCount > 0 ? `${stealthCount} Silent` : "All Burst"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground flex justify-between items-center">
            <span>{unleashedCount} Burst • {stealthCount} Silent</span>
            <Link to="/worker" className="text-cyan-400 hover:underline">Manage</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              Fleet Hourly Rate
            </CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-400 font-mono">
              ${totalRate.toFixed(2)}/hr
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
            Automatic SLA earnings
          </CardContent>
        </Card>

        <Card className="col-span-2 md:col-span-1">
          <CardHeader className="p-4 sm:p-5 pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
              Accrued Revenue
            </CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-400 font-mono">
              ${totalEarnings.toFixed(4)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground flex justify-between items-center">
            <span>SLA balance</span>
            <Link to="/wallet" className="text-emerald-400 hover:underline">Wallet</Link>
          </CardContent>
        </Card>
      </div>

      {/* Quick Join CLI Terminal Widget (Pre-authenticated) */}
      <Card className="border-primary/30 bg-card/70 backdrop-blur-sm">
        <CardHeader className="p-4 sm:p-5 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              Connect Another Machine to Your Fleet
            </CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={copyJoinCommand}
              className="gap-1.5 h-7 text-xs font-mono"
            >
              {copiedJoinCmd ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Command
                </>
              )}
            </Button>
          </div>
          <CardDescription className="text-xs">
            Run this pre-authenticated command in PowerShell on any Windows machine to link it automatically:
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-2">
          <div className="bg-slate-950 text-emerald-400 p-3 rounded-md font-mono text-xs overflow-x-auto border border-slate-800 break-all select-all">
            <code>{joinCmd}</code>
          </div>
        </CardContent>
      </Card>

      {/* Zero-Touch Central Server & In-Browser Remote Deployment */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="p-4 sm:p-5 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Globe className="h-4 w-4 text-cyan-400" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  Central Server & Zero-Touch Deployment
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1" />
                    Online
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Headless host: <span className="font-mono text-foreground font-medium">{systemStatus?.hostname || "Local Node"}</span> • {systemStatus?.os || "Loading..."} • Uptime: {systemStatus?.uptime_human || "..."}
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate || isDeployingUpdate}
                className="gap-1.5 text-xs h-8"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? "animate-spin text-cyan-400" : ""}`} />
                {isCheckingUpdate ? "Checking..." : "Check Updates"}
              </Button>

              {updateCheck?.update_available ? (
                <Button
                  size="sm"
                  onClick={handleDeployUpdate}
                  disabled={isDeployingUpdate}
                  className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <ArrowUpCircle className={`h-3.5 w-3.5 ${isDeployingUpdate ? "animate-spin" : ""}`} />
                  {isDeployingUpdate ? "Deploying..." : "1-Click Deploy & Update"}
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 pt-0 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-md border bg-background/50 space-y-1">
              <span className="text-muted-foreground flex items-center gap-1">
                <GitBranch className="h-3 w-3 text-primary" /> Active Branch & Commit
              </span>
              <p className="font-mono font-medium truncate text-foreground">
                {systemStatus?.git?.branch || "main"} @ {systemStatus?.git?.commit || "..."}
              </p>
            </div>

            <div className="p-2.5 rounded-md border bg-background/50 space-y-1">
              <span className="text-muted-foreground flex items-center gap-1">
                <Cpu className="h-3 w-3 text-cyan-400" /> Server CPU Load
              </span>
              <p className="font-mono font-medium text-foreground">
                {systemStatus?.resources?.cpu_percent ?? 0}%
              </p>
            </div>

            <div className="p-2.5 rounded-md border bg-background/50 space-y-1">
              <span className="text-muted-foreground flex items-center gap-1">
                <HardDrive className="h-3 w-3 text-purple-400" /> Host Memory
              </span>
              <p className="font-mono font-medium text-foreground">
                {systemStatus?.resources?.memory_used_gb ?? 0} / {systemStatus?.resources?.memory_total_gb ?? 0} GB ({systemStatus?.resources?.memory_percent ?? 0}%)
              </p>
            </div>

            <div className="p-2.5 rounded-md border bg-background/50 space-y-1">
              <span className="text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3 text-emerald-400" /> Remote Access
              </span>
              <p className="font-mono font-medium text-foreground truncate">
                {systemStatus?.tailscale_ip ? `Tailscale: ${systemStatus.tailscale_ip}` : (systemStatus?.local_ips?.[0] ? `LAN: ${systemStatus.local_ips[0]}` : "Local")}
              </p>
            </div>
          </div>

          {updateCheck?.update_available ? (
            <div className="p-3 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="font-semibold text-cyan-300">
                  New Code Commit Available: {updateCheck.remote_commit} ({updateCheck.commits_behind} commit{updateCheck.commits_behind === 1 ? "" : "s"} behind)
                </p>
                {updateCheck.pending_commits?.[0] && (
                  <p className="text-muted-foreground font-mono text-[11px] truncate">
                    &bull; {updateCheck.pending_commits[0]}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={handleDeployUpdate}
                disabled={isDeployingUpdate}
                className="gap-1.5 text-xs h-7 self-start sm:self-auto bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <ArrowUpCircle className="h-3.5 w-3.5" />
                Deploy Now
              </Button>
            </div>
          ) : updateCheck && !updateCheck.update_available ? (
            <div className="p-2.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 text-xs flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Server is fully up to date with origin/main. Zero physical maintenance needed.</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Active GPU Nodes Table */}
      <Card>
        <CardHeader className="p-4 sm:p-5 pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Sliders className="h-4 w-4 text-primary" />
                GPU Accelerator Units & Contribution Controls
              </CardTitle>
              <CardDescription className="text-xs">
                Adjust each GPU card's individual memory contribution percentage (10%–100%) in real time
              </CardDescription>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {gpuRows.length} GPU unit{gpuRows.length === 1 ? "" : "s"} across {nodes.length} system{nodes.length === 1 ? "" : "s"}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[11px] uppercase bg-muted/50 text-muted-foreground border-b font-mono">
                <tr>
                  <th className="py-3 px-4">System / Machine</th>
                  <th className="py-3 px-4">GPU Accelerator</th>
                  <th className="py-3 px-4">Region & Latency</th>
                  <th className="py-3 px-4 min-w-[200px]">GPU Contribution Slider (10%-100%)</th>
                  <th className="py-3 px-4">VRAM Ceiling</th>
                  <th className="py-3 px-4">Rate & Earned</th>
                  <th className="py-3 px-4 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {gpuRows.length > 0 ? (
                  gpuRows.map(({ node, gpu, key }) => {
                    const allocPct = gpu.vram_allocation_pct ?? 80;
                    const isUpdating = updatingNodeId === `${node.node_id || node.id}-${gpu.index}`;
                    const ping = node.latency_ping_ms ?? 12.0;
                    const isAvailable = node.is_available ?? true;
                    const isBusy = isAvailable && (node.status === "busy" || Boolean(node.current_task_id));
                    const isOnline = isAvailable && node.status === "online" && !isBusy;
                    const isPaused = !isAvailable;
                    const dotColor = isBusy
                      ? "bg-blue-400 animate-ping"
                      : isOnline
                      ? "bg-emerald-400 animate-pulse"
                      : isPaused
                      ? "bg-amber-500"
                      : "bg-zinc-500";
                    const vramAlloc = gpu.vram_allocated_gb || (gpu.vram_total_gb * allocPct / 100);

                    return (
                      <tr key={key} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-foreground flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                            {node.system_name || node.name}
                            {isBusy && (
                              <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/30 font-mono py-0 px-1">
                                BUSY
                              </Badge>
                            )}
                            {isPaused && (
                              <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/30 font-mono py-0 px-1">
                                PAUSED
                              </Badge>
                            )}
                            {node.work_capacity_state === "restricted_pause" ? (
                              <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-300 border-amber-500/30 font-mono py-0 px-1 flex items-center gap-0.5">
                                <Gamepad2 className="h-2.5 w-2.5 text-amber-400" />
                                GAMING YIELD
                              </Badge>
                            ) : node.work_capacity_state === "stealth_regulated" || Boolean(node.is_always_silent) ? (
                              <Badge variant="outline" className="text-[9px] bg-cyan-500/10 text-cyan-300 border-cyan-500/30 font-mono py-0 px-1 flex items-center gap-0.5">
                                <Moon className="h-2.5 w-2.5 text-cyan-400" />
                                SILENT ({node.duty_cycle_pct ?? 33}%)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono py-0 px-1 flex items-center gap-0.5">
                                <Zap className="h-2.5 w-2.5 text-emerald-400" />
                                BURST
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {node.node_id || node.id}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] font-mono py-0 px-1">
                              GPU {gpu.index}
                            </Badge>
                            <span>{gpu.name}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {gpu.vram_total_gb} GB VRAM • {node.cuda_version || "Metal / MPS"}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] uppercase font-mono">
                              {node.region || "us-east"}
                            </Badge>
                            <span className="text-[11px] text-emerald-400 font-semibold">
                              ⚡ {ping.toFixed(1)}ms
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="space-y-1 max-w-[220px]">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-bold text-primary">
                                {allocPct}%
                              </span>
                              <span className="text-muted-foreground font-mono text-[11px]">
                                {vramAlloc.toFixed(1)} / {gpu.vram_total_gb.toFixed(1)} GB
                              </span>
                            </div>
                            <Slider
                              value={allocPct}
                              min={10}
                              max={100}
                              step={5}
                              disabled={isUpdating || isPaused}
                              onValueChange={(val) => handleSliderChange(node.node_id || node.id, val, gpu.index)}
                              className="cursor-pointer"
                            />
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs font-semibold text-foreground">
                          {vramAlloc.toFixed(1)} GB
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs">
                          <span className="text-emerald-400 font-bold">${(node.total_earnings_usd || 0).toFixed(4)}</span>
                          <span className="text-muted-foreground block text-[10px]">${(node.hourly_rate_usd || 0.45).toFixed(2)}/hr</span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              title={isPaused ? "Resume Node (Start accepting tasks)" : "Pause Node (Stop receiving tasks)"}
                              onClick={() => handleToggleAvailability(node.node_id || node.id, isAvailable)}
                            >
                              {isPaused ? <Play className="h-3 w-3 text-emerald-400" /> : <Pause className="h-3 w-3 text-amber-400" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              title="Remove Machine"
                              onClick={() => handleDeregister(node.node_id || node.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No machines currently registered under your account. Launch the agent above to link your hardware.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
